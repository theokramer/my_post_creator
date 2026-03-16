require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db = require('./db');

const isProd = process.env.NODE_ENV === 'production';
const requiredEnv = ['JWT_SECRET', 'CLIENT_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
    console.warn(`[Config] Missing required env vars: ${missingEnv.join(', ')}`);
    if (isProd) {
        console.error('[Config] Refusing to start without required production env vars.');
        process.exit(1);
    }
}

const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const allowTestStripe = process.env.STRIPE_ALLOW_TEST === 'true';
if (stripeKey.startsWith('sk_test_') && !allowTestStripe) {
    const msg = '[Stripe] Test key detected. Provide a live key to disable sandbox mode.';
    if (isProd) {
        console.error(msg);
        process.exit(1);
    } else {
        console.warn(msg);
    }
}
const stripe = require('stripe')(stripeKey);
const stripeEnabled = Boolean(stripeKey && process.env.STRIPE_WEBHOOK_SECRET);
const STRIPE_PRICE_PRO_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY || '';
const STRIPE_PRICE_CREDITS_100 = process.env.STRIPE_PRICE_CREDITS_100 || '';
const STRIPE_PRICE_CREDITS_1000 = process.env.STRIPE_PRICE_CREDITS_1000 || '';
const STRIPE_PRICE_CREDITS_10000 = process.env.STRIPE_PRICE_CREDITS_10000 || '';
const PORT = process.env.PORT || 3000;
const SUBPATH = '/viralstack';
const CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}${SUBPATH}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini';
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
let CLIENT_ORIGIN = '';
try {
    CLIENT_ORIGIN = new URL(CLIENT_URL).origin;
} catch {
    CLIENT_ORIGIN = '';
}

// --- Email Sending (via Resend API) ---
// We use the HTTP API instead of SMTP to bypass VPS port blocks.
async function sendVerificationEmail(email, token) {
    const api_key = process.env.SMTP_PASS; // Using the key from your .env
    const from_email = process.env.SMTP_FROM || 'ViralStack <noreply@kramerapps.de>';
    const verifyUrl = `${CLIENT_URL}/api/verify-email?token=${token}`;

    if (!api_key || api_key.startsWith('your_')) {
        console.warn('[Email] Skipping email send: No valid API key in SMTP_PASS');
        return;
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${api_key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: from_email,
                to: [email],
                subject: 'Verify your ViralStack account',
                html: `
                    <div style="font-family: 'Instrument Sans', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
                        <div style="text-align: center; margin-bottom: 32px;">
                            <div style="display: inline-block; background: linear-gradient(135deg, #1f3a5f, #c26b3f); width: 48px; height: 48px; border-radius: 12px; line-height: 48px; font-size: 24px; color: white;">&#9889;</div>
                            <h1 style="font-size: 22px; font-weight: 700; color: #111; margin: 16px 0 4px;">Welcome to ViralStack</h1>
                            <p style="color: #666; font-size: 14px;">Verify your email to get started</p>
                        </div>
                        <a href="${verifyUrl}" style="display: block; text-align: center; padding: 14px 28px; background: linear-gradient(135deg, #1f3a5f, #c26b3f); color: #fff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 24px 0;">Verify Email Address</a>
                        <p style="color: #999; font-size: 12px; text-align: center;">If you didn't create this account, you can ignore this email.</p>
                    </div>
                `
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'API Error');

        console.log(`[Email] Verification sent to ${email} (ID: ${data.id})`);
    } catch (err) {
        console.error('[Email] Failed to send verification:', err.message);
    }
}

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGINS || CLIENT_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
const corsOptions = {
    origin: (origin, cb) => {
        if (!origin || allowedOrigins.length === 0) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    }
};
app.use(cors(corsOptions));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
});

// --- Stripe Webhook MUST be before express.json() ---
app.post(`${SUBPATH}/api/webhook`, express.raw({type: 'application/json'}), async (req, res) => {
    if (!stripeEnabled) {
        return res.status(503).send('Stripe is not configured');
    }
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const userId = parseInt(session.client_reference_id, 10);
            if (isNaN(userId)) {
                console.warn('[Stripe Webhook] No client_reference_id found in session.');
            } else {
                if (session.customer) {
                    db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(session.customer, userId);
                }
                if (session.mode === 'subscription' && session.subscription) {
                    db.prepare('UPDATE users SET is_pro = 1, stripe_subscription_status = ? WHERE id = ?')
                        .run('active', userId);
                    console.log(`[Stripe Webhook] Subscription active for user ${userId}`);
                }
                if (session.mode === 'payment') {
                    console.log(`[Stripe Webhook] One-time checkout completed for user ${userId}`);
                    if (stripeEnabled) {
                        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
                        let creditsToAdd = 0;
                        for (const item of lineItems.data || []) {
                            const priceId = item.price?.id;
                            const qty = item.quantity || 1;
                            if (priceId === STRIPE_PRICE_CREDITS_100) creditsToAdd += 100 * qty;
                            if (priceId === STRIPE_PRICE_CREDITS_1000) creditsToAdd += 1000 * qty;
                            if (priceId === STRIPE_PRICE_CREDITS_10000) creditsToAdd += 10000 * qty;
                        }
                        if (creditsToAdd > 0) {
                            db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(creditsToAdd, userId);
                            console.log(`[Stripe Webhook] Added ${creditsToAdd} credits to user ${userId}`);
                        }
                    }
                }
            }
        }

        if (event.type === 'invoice.payment_succeeded') {
            const invoice = event.data.object;
            const customerId = invoice.customer;
            if (customerId && STRIPE_PRICE_PRO_MONTHLY) {
                let isProInvoice = false;
                for (const line of invoice.lines?.data || []) {
                    if (line.price?.id === STRIPE_PRICE_PRO_MONTHLY) {
                        isProInvoice = true;
                        break;
                    }
                }
                if (isProInvoice) {
                    const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId);
                    if (user) {
                        db.prepare('UPDATE users SET is_pro = 1, stripe_subscription_status = ?, credits = credits + 300 WHERE id = ?')
                            .run('active', user.id);
                        console.log(`[Stripe Webhook] Added 300 subscription credits to user ${user.id}`);
                    }
                }
            }
        }

        if (event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object;
            const customerId = subscription.customer;
            if (customerId) {
                const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').get(customerId);
                if (user) {
                    db.prepare('UPDATE users SET is_pro = 0, stripe_subscription_status = ? WHERE id = ?')
                        .run('canceled', user.id);
                    console.log(`[Stripe Webhook] Subscription canceled for user ${user.id}`);
                }
            }
        }
        res.json({ received: true });
    } catch (err) {
        console.error('[Stripe Webhook] Error processing event:', err);
        res.status(500).json({ error: 'Internal server error processing webhook' });
    }
});

app.use(express.json({ limit: '50mb' }));

// Health check for root
app.get('/', (req, res) => res.send('ViralStack Server is running. Access via /viralstack'));

// Serve the frontend static files
const staticOptions = isProd ? {
    index: 'index.html',
    maxAge: '7d',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store');
        }
    }
} : { index: 'index.html' };
app.use(SUBPATH, express.static(path.join(__dirname), staticOptions));

// Specific handler for the subpath root to ensure index.html is served
app.get(SUBPATH, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get(`${SUBPATH}/`, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Auth Middleware ---
const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
        if (!req.user) throw new Error('User not found');
        console.log(`[Auth] User ${req.user.id} logged in. is_pro=${req.user.is_pro}`);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// --- API Routes ---
app.post(`${SUBPATH}/api/auth/register`, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const hash = await bcrypt.hash(password, 10);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const info = db.prepare('INSERT INTO users (email, password_hash, verification_token) VALUES (?, ?, ?)').run(email, hash, verificationToken);
        const token = jwt.sign({ id: info.lastInsertRowid }, process.env.JWT_SECRET, { expiresIn: '30d' });
        
        // Send verification email (non-blocking)
        sendVerificationEmail(email, verificationToken);
        
        res.json({ token, user: { id: info.lastInsertRowid, email, is_pro: 0, email_verified: 0, batch_processes: 0, credits: 0 } });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Email already exists' });
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post(`${SUBPATH}/api/auth/login`, async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: { id: user.id, email: user.email, is_pro: user.is_pro, email_verified: user.email_verified, batch_processes: user.batch_processes, credits: user.credits || 0 } });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get(`${SUBPATH}/api/user/me`, requireAuth, (req, res) => {
    res.json({ user: { id: req.user.id, email: req.user.email, is_pro: req.user.is_pro, email_verified: req.user.email_verified, batch_processes: req.user.batch_processes, credits: req.user.credits || 0 } });
});

// --- Email Verification ---
app.get(`${SUBPATH}/api/verify-email`, (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send('Missing token');
    const user = db.prepare('SELECT id FROM users WHERE verification_token = ?').get(token);
    if (!user) return res.status(400).send('Invalid or expired token');
    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').run(user.id);
    console.log(`[Email] User ${user.id} verified their email`);
    res.redirect(`${CLIENT_URL}?verified=1`);
});

app.post(`${SUBPATH}/api/resend-verification`, requireAuth, (req, res) => {
    if (req.user.email_verified) return res.json({ message: 'Already verified' });
    const newToken = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE users SET verification_token = ? WHERE id = ?').run(newToken, req.user.id);
    sendVerificationEmail(req.user.email, newToken);
    res.json({ message: 'Verification email sent' });
});

app.post(`${SUBPATH}/api/create-checkout-session`, requireAuth, async (req, res) => {
    try {
        if (!stripeEnabled) {
            return res.status(503).json({ error: 'Stripe is not configured' });
        }
        if (!STRIPE_PRICE_PRO_MONTHLY) {
            return res.status(400).json({ error: 'Missing STRIPE_PRICE_PRO_MONTHLY' });
        }
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            client_reference_id: req.user.id.toString(),
            customer: req.user.stripe_customer_id || undefined,
            customer_email: req.user.stripe_customer_id ? undefined : req.user.email,
            line_items: [{
                price: STRIPE_PRICE_PRO_MONTHLY,
                quantity: 1,
            }],
            success_url: `${CLIENT_URL}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${CLIENT_URL}`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('Stripe error:', err);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

app.post(`${SUBPATH}/api/buy-credits`, requireAuth, async (req, res) => {
    try {
        if (!stripeEnabled) {
            return res.status(503).json({ error: 'Stripe is not configured' });
        }
        const { pack } = req.body || {};
        const priceMap = {
            100: STRIPE_PRICE_CREDITS_100,
            1000: STRIPE_PRICE_CREDITS_1000,
            10000: STRIPE_PRICE_CREDITS_10000
        };
        const priceId = priceMap[pack];
        if (!priceId) {
            return res.status(400).json({ error: 'Invalid credit pack' });
        }
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            client_reference_id: req.user.id.toString(),
            customer: req.user.stripe_customer_id || undefined,
            customer_email: req.user.stripe_customer_id ? undefined : req.user.email,
            line_items: [{
                price: priceId,
                quantity: 1,
            }],
            success_url: `${CLIENT_URL}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${CLIENT_URL}`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('Stripe error:', err);
        res.status(500).json({ error: 'Failed to create credit checkout session' });
    }
});

app.post(`${SUBPATH}/api/generate/track`, requireAuth, (req, res) => {
    const { captionCount } = req.body;
    
    // Robust check for is_pro (check for number 1 or truthy boolean)
    const isPro = Number(req.user.is_pro) === 1 || req.user.is_pro === true;
    console.log(`[Track] User ${req.user.id} - is_pro in DB: ${req.user.is_pro}, evaluated as Pro: ${isPro}`);

    if (isPro) {
        // Increase limit from 50 to 500 for Pro users
        if (captionCount > 500) return res.status(400).json({ error: 'Pro limits batch size to 500 at a time to prevent server overload.' });
        res.json({ success: true, is_pro: true });
    } else {
        if (req.user.batch_processes >= 1) return res.status(403).json({ error: 'Free tier limit reached. Please upgrade to Pro.', requires_upgrade: true });
        db.prepare('UPDATE users SET batch_processes = batch_processes + 1 WHERE id = ?').run(req.user.id);
        res.json({ success: true, is_pro: false, quota_used: true });
    }
});

const AI_TEMPLATES = {
    custom: {
        name: 'Custom',
        captionGuide: 'Clear, modern social post captions. Avoid hashtags unless requested.',
        imageStyle: 'Clean editorial photography, cinematic light, no text in the image.'
    },
    ranking: {
        name: 'Ranking',
        captionGuide: 'Ranked list with numbers and short punchy lines. Each caption begins with a number.',
        imageStyle: 'Bold visual metaphor, high contrast, dynamic composition, no text in the image.'
    },
    infotainment: {
        name: 'Infotainment',
        captionGuide: 'Educational but entertaining tone. One fact per caption, human and friendly.',
        imageStyle: 'Bright, playful infographic vibe without actual text, colorful shapes, clean depth.'
    },
    product: {
        name: 'Product Spotlight',
        captionGuide: 'Product benefits focused, premium tone, concise and benefit-driven.',
        imageStyle: 'Studio product photography, soft shadows, glossy highlights, premium minimal set.'
    },
    quote: {
        name: 'Quote Card',
        captionGuide: 'Short quote-style captions. Keep under 100 characters.',
        imageStyle: 'Abstract atmospheric background, gradients, subtle texture, no text in the image.'
    }
};

function extractJson(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('AI response missing JSON payload');
    const sliced = text.slice(start, end + 1);
    return JSON.parse(sliced);
}

async function openaiRequest(path, payload) {
    if (!OPENAI_API_KEY) {
        throw new Error('Missing OpenAI API key. Set OPENAI_API_KEY on the server.');
    }
    const resp = await fetch(`${OPENAI_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify(payload)
    });
    let data;
    try {
        data = await resp.json();
    } catch (err) {
        throw new Error('OpenAI returned a non-JSON response.');
    }
    if (!resp.ok) {
        const msg = data?.error?.message || 'OpenAI request failed';
        throw new Error(msg);
    }
    return data;
}

async function generateTextPlan({ idea, count, template, style, includeLogo }) {
    const preset = AI_TEMPLATES[template] || AI_TEMPLATES.custom;
    const system = [
        'You create social media post packages.',
        'Return ONLY valid JSON with keys: captions, image_prompts, logo_prompt.',
        'captions and image_prompts are arrays with exactly the requested length.',
        'Captions must be concise and suitable for a vertical video intro.',
        'Never include emojis unless the user asked for them.',
        'Image prompts must describe visuals only and must not include text overlays.'
    ].join(' ');
    const user = [
        `Idea: ${idea}`,
        `Count: ${count}`,
        `Template: ${preset.name}`,
        `Caption style: ${preset.captionGuide}`,
        `Image style: ${preset.imageStyle}`,
        style ? `Extra style notes: ${style}` : 'Extra style notes: none',
        includeLogo ? 'Include a simple brand logo prompt.' : 'No logo prompt needed.'
    ].join('\n');

    const payload = {
        model: OPENAI_TEXT_MODEL,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ],
        temperature: 0.7
    };

    const data = await openaiRequest('/chat/completions', payload);
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(content);
    return parsed;
}

async function generateImage(prompt, size) {
    const payload = {
        model: OPENAI_IMAGE_MODEL,
        prompt,
        size,
        response_format: 'b64_json'
    };
    const data = await openaiRequest('/images/generations', payload);
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI image response missing base64 data.');
    return `data:image/png;base64,${b64}`;
}

app.post(`${SUBPATH}/api/ai/generate`, requireAuth, async (req, res) => {
    const { idea, count, template, style, includeLogo } = req.body || {};
    const safeCount = Math.max(1, Math.min(20, parseInt(count || '0', 10) || 6));
    const costPerImage = 20;
    const costPerCaption = 1;
    const logoCost = 20;
    const totalCost = safeCount * (costPerImage + costPerCaption) + (includeLogo ? logoCost : 0);
    if (!idea || typeof idea !== 'string') {
        return res.status(400).json({ error: 'Idea is required.' });
    }
    if (!OPENAI_API_KEY) {
        return res.status(503).json({ error: 'OpenAI is not configured on the server.' });
    }
    if ((req.user.credits || 0) < totalCost) {
        return res.status(402).json({
            error: 'Not enough credits for AI generation.',
            credits_required: totalCost,
            credits_available: req.user.credits || 0
        });
    }

    try {
        const plan = await generateTextPlan({
            idea: idea.trim(),
            count: safeCount,
            template: template || 'custom',
            style: style || '',
            includeLogo: !!includeLogo
        });

        let captions = Array.isArray(plan.captions) ? plan.captions.slice(0, safeCount) : [];
        let imagePrompts = Array.isArray(plan.image_prompts) ? plan.image_prompts.slice(0, safeCount) : [];
        if (captions.length < safeCount) {
            captions = captions.concat(Array.from({ length: safeCount - captions.length }, (_, i) => `Post ${captions.length + i + 1}`));
        }
        if (imagePrompts.length < safeCount) {
            const preset = AI_TEMPLATES[template] || AI_TEMPLATES.custom;
            imagePrompts = imagePrompts.concat(
                captions.slice(imagePrompts.length).map((cap) => `${preset.imageStyle} Visual inspired by: ${cap}`)
            );
        }

        const images = [];
        for (let i = 0; i < safeCount; i++) {
            const dataUrl = await generateImage(imagePrompts[i], '1024x1536');
            images.push(dataUrl);
        }

        let logo = null;
        if (includeLogo) {
            const logoPrompt = plan.logo_prompt || `Minimal brand logo for: ${idea}. Clean vector style, transparent background.`;
            logo = await generateImage(logoPrompt, '1024x1024');
        }

        db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(totalCost, req.user.id);
        const updated = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
        res.json({ captions, images, logo, credits: updated?.credits ?? 0, credits_spent: totalCost });
    } catch (err) {
        console.error('[AI] Generation failed:', err.message);
        res.status(500).json({ error: err.message || 'AI generation failed' });
    }
});


app.post(`${SUBPATH}/api/generate`, async (req, res) => {
    const { caption, imageUrl, logoUrl, settings, override } = req.body;

    if (!caption || !imageUrl) {
        return res.status(400).json({ error: 'caption and imageUrl are required.' });
    }

    let browser;
    try {
        console.log(`[API] Starting browser for render...`);
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--autoplay-policy=no-user-gesture-required'
            ]
        });
        const page = await browser.newPage();
        
        // We load the exact same frontend the user sees, but we'll inject values via JS
        await page.goto(`http://localhost:${PORT}${SUBPATH}/index.html`, { waitUntil: 'networkidle0' });

        // Evaluate the payload directly into the browser context
        console.log(`[API] Injecting payload into browser...`);
        const videoDataUri = await page.evaluate(async (payload) => {
            return new Promise(async (resolve, reject) => {
                try {
                    // 1. Fetch external images into Blob URIs for the Canvas
                    const fetchAsBlobUrl = async (url) => {
                        const r = await fetch(url);
                        const b = await r.blob();
                        return URL.createObjectURL(b);
                    };

                    const loadImgNode = (url) => new Promise((res, rej) => {
                        const img = new Image();
                        img.crossOrigin = "anonymous";
                        img.onload = () => res(img);
                        img.onerror = rej;
                        img.src = url;
                    });

                    // 2. Load Assets
                    const imgUrl = await fetchAsBlobUrl(payload.imageUrl);
                    const loadedImg = await loadImgNode(imgUrl);
                    
                    let loadedLogo = null;
                    if (payload.logoUrl) {
                        const logoBlobUrl = await fetchAsBlobUrl(payload.logoUrl);
                        loadedLogo = await loadImgNode(logoBlobUrl);
                    }

                    // 3. Instead of interacting with the DOM, we directly call the global engine functions
                    // But since app.js is wrapped in an IIFE, we must attach the core generator to window
                    // Wait, App.js might not expose it. We will write a custom headless generator here
                    // using the exact same math, or we'll inject into the DOM and click the buttons.
                    
                    // The easiest and most robust headless approach is to write the generate logic here
                    // referencing the same canvas on the page.
                    
                    const canvas = document.getElementById('render-canvas');
                    const ctx = canvas.getContext('2d');
                    const W = 1080, H = 1920;

                    // Apply polyfill
                    if (!CanvasRenderingContext2D.prototype.roundRect) {
                        CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
                            r = Math.min(r, w/2, h/2);
                            this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r);
                            this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r);
                            this.arcTo(x, y, x + w, y, r); return this;
                        };
                    }

                    const getWrappedLines = (c, text, maxWidth) => {
                        const words = text.split(' '); const lines = []; let cur = '';
                        for (const w of words) {
                            const test = cur ? cur + ' ' + w : w;
                            if (c.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; } else cur = test;
                        }
                        if (cur) lines.push(cur); return lines;
                    };

                    const drawFrame = (caption, contentImg, logoImg, imageAlpha, over, zoomScale) => {
                        const s = payload.settings || {
                            imageFit: 'contain', imageScale: 100, imageRotate: 0,
                            captionPadding: 60, logoScale: 60, imagePadding: 0, logoPadding: 220,
                            imageBorderRadius: 0, captionFontSize: 46, captionFontWeight: '600',
                            captionAlign: 'center', bgColor: '#111111', captionBgColor: '#1A1A1A',
                            captionTextColor: '#FFFFFF', imageBgColor: '#000000', cinemaZoom: false
                        };
                        const overSettings = payload.override || {};
                        
                        const lineH = s.captionFontSize * 1.4;
                        ctx.font = `${s.captionFontWeight} ${s.captionFontSize}px 'Instrument Sans', sans-serif`;
                        const lines = getWrappedLines(ctx, caption, W - s.captionPadding * 2);
                        const captionAreaHeight = Math.max(300, lines.length * lineH + s.captionPadding * 2);
                        const logoAreaH = s.logoPadding;
                        const imageAreaTop = captionAreaHeight;
                        const imageAreaHeight = H - captionAreaHeight - logoAreaH;

                        ctx.fillStyle = s.bgColor; ctx.fillRect(0, 0, W, H);
                        ctx.fillStyle = s.captionBgColor; ctx.fillRect(0, 0, W, captionAreaHeight);

                        ctx.fillStyle = s.captionTextColor;
                        ctx.textAlign = s.captionAlign; ctx.textBaseline = 'middle';
                        let textX = W / 2;
                        if (s.captionAlign === 'left') textX = s.captionPadding;
                        if (s.captionAlign === 'right') textX = W - s.captionPadding;
                        
                        textX += (overSettings.captionPanX || 0);
                        const startY = (captionAreaHeight / 2) - (lines.length * lineH) / 2 + lineH / 2 + (overSettings.captionPanY || 0);
                        lines.forEach((line, i) => ctx.fillText(line, textX, startY + i * lineH));

                        if (contentImg) {
                            ctx.save();
                            ctx.globalAlpha = imageAlpha;
                            const pad = s.imagePadding; const r = s.imageBorderRadius;
                            
                            const areaW = W - pad * 2;
                            const areaH = imageAreaHeight - pad * 2;
                            const areaX = pad;
                            const areaY = imageAreaTop + pad;

                            ctx.fillStyle = s.imageBgColor;
                            ctx.beginPath();
                            ctx.roundRect(areaX, areaY, areaW, areaH, r);
                            ctx.fill();
                            ctx.clip();

                            const imgW = contentImg.naturalWidth;
                            const imgH = contentImg.naturalHeight;
                            let drawW, drawH;

                            const ratioImg = imgW / imgH; const ratioArea = areaW / areaH;
                            if (s.imageFit === 'cover') {
                                if (ratioImg > ratioArea) { drawH = areaH; drawW = areaH * ratioImg; }
                                else { drawW = areaW; drawH = areaW / ratioImg; }
                            } else {
                                if (ratioImg > ratioArea) { drawW = areaW; drawH = areaW / ratioImg; }
                                else { drawH = areaH; drawW = areaH * ratioImg; }
                            }

                            let totalScale = (s.imageScale / 100);
                            if (s.cinemaZoom) totalScale += zoomScale;
                            
                            drawW *= totalScale;
                            drawH *= totalScale;

                            ctx.translate(areaX + areaW / 2 + (overSettings.imagePanX || 0), areaY + areaH / 2 + (overSettings.imagePanY || 0));
                            ctx.rotate((s.imageRotate * Math.PI) / 180);
                            
                            ctx.drawImage(contentImg, -drawW / 2, -drawH / 2, drawW, drawH);
                            ctx.restore();
                        }

                        if (logoImg) {
                            const scaleFactor = s.logoScale / 100;
                            const maxLogoH = (logoAreaH - 40) * scaleFactor;
                            const maxLogoW = (W - 160) * scaleFactor;
                            let lw = logoImg.naturalWidth, lh = logoImg.naturalHeight;
                            const sc = Math.min(maxLogoW / lw, maxLogoH / lh, 1);
                            lw *= sc; lh *= sc;
                            
                            const lx = (W - lw) / 2 + (overSettings.logoPanX || 0);
                            const ly = H - logoAreaH + (logoAreaH - lh) / 2 + (overSettings.logoPanY || 0);
                            ctx.drawImage(logoImg, lx, ly, lw, lh);
                        }
                    };

                    // Setup Recording
                    const s = payload.settings || { videoDuration: 5, fadeDuration: 1.5, cinemaZoom: false };
                    const total = (s.videoDuration || 5) * 1000;
                    const fadeDur = (s.fadeDuration || 1.5) * 1000;
                    const fps = 30; const frameInt = 1000 / fps;
                    const totalFrames = total / frameInt;
                    
                    // Force VP8 for solid headless recording support
                    const stream = canvas.captureStream(fps);
                    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
                    const chunks = [];
                    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
                    
                    recorder.onstop = () => {
                        const blob = new Blob(chunks, { type: 'video/webm' });
                        const reader = new FileReader();
                        reader.readAsDataURL(blob); 
                        reader.onloadend = () => {
                            resolve(reader.result); // Base64 Data URI
                        }
                    };
                    
                    recorder.start(100);

                    let frame = 0;
                    const render = () => {
                        const elapsed = frame * frameInt; let alpha = 1;
                        if (elapsed < fadeDur) alpha = elapsed / fadeDur;
                        else if (elapsed > total - fadeDur) alpha = Math.max(0, (total - elapsed) / fadeDur);
                        
                        const zoomScale = s.cinemaZoom ? (elapsed / total) * 0.15 : 0;
                        drawFrame(payload.caption, loadedImg, loadedLogo, Math.max(0, Math.min(1, alpha)), payload.override, zoomScale);
                        
                        if (frame++ <= totalFrames) setTimeout(render, frameInt);
                        else setTimeout(() => recorder.stop(), 200);
                    };
                    
                    render();

                } catch (err) {
                    reject(err.toString());
                }
            });
        }, { caption, imageUrl, logoUrl, settings, override });
        
        console.log(`[API] Render complete. Sending payload...`);
        
        // Convert Base64 back to buffer
        const base64Data = videoDataUri.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        
        res.writeHead(200, {
            'Content-Type': 'video/webm',
            'Content-Length': buffer.length,
            'Content-Disposition': 'attachment; filename="pro_render.webm"'
        });
        res.end(buffer);

    } catch (err) {
        console.error("Puppeteer generate error:", err);
        res.status(500).json({ error: 'Failed to generate video', details: err.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`ViralStack API Server running on port ${PORT}`);
    console.log(`Frontend accessible at http://localhost:${PORT}${SUBPATH}`);
});
