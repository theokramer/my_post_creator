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
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('./db');

// --- Email Transporter ---
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.resend.com',
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for other ports (like 587)
    auth: {
        user: process.env.SMTP_USER || 'resend',
        pass: process.env.SMTP_PASS
    }
});
const SMTP_FROM = process.env.SMTP_FROM || 'ViralStack <noreply@kramerapps.de>';

async function sendVerificationEmail(email, token) {
    const verifyUrl = `${process.env.CLIENT_URL}/api/verify-email?token=${token}`;
    try {
        await transporter.sendMail({
            from: SMTP_FROM,
            to: email,
            subject: 'Verify your ViralStack account',
            html: `
                <div style="font-family: 'Inter', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
                    <div style="text-align: center; margin-bottom: 32px;">
                        <div style="display: inline-block; background: linear-gradient(135deg, #a855f7, #06b6d4); width: 48px; height: 48px; border-radius: 12px; line-height: 48px; font-size: 24px; color: white;">&#9889;</div>
                        <h1 style="font-size: 22px; font-weight: 700; color: #f0f0f5; margin: 16px 0 4px;">Welcome to ViralStack</h1>
                        <p style="color: #8b8b9e; font-size: 14px;">Verify your email to get started</p>
                    </div>
                    <a href="${verifyUrl}" style="display: block; text-align: center; padding: 14px 28px; background: linear-gradient(135deg, #a855f7, #06b6d4); color: #fff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 15px; margin: 24px 0;">Verify Email Address</a>
                    <p style="color: #4a4a5e; font-size: 12px; text-align: center;">If you didn't create this account, you can ignore this email.</p>
                </div>
            `
        });
        console.log(`[Email] Verification sent to ${email}`);
    } catch (err) {
        console.error('[Email] Failed to send verification:', err.message);
    }
}

const app = express();
const PORT = process.env.PORT || 3000;
const SUBPATH = '/viralstack';

app.use(cors());
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
});

// --- Stripe Webhook MUST be before express.json() ---
app.post(`${SUBPATH}/api/webhook`, express.raw({type: 'application/json'}), (req, res) => {
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
            if (!isNaN(userId)) {
                console.log(`[Stripe Webhook] Upgrading user ID: ${userId} to Pro`);
                const info = db.prepare('UPDATE users SET is_pro = 1 WHERE id = ?').run(userId);
                console.log(`[Stripe Webhook] Update changes: ${info.changes}`);
                if (info.changes > 0) {
                    console.log(`[Stripe Webhook] Successfully upgraded user ${userId} to Pro!`);
                } else {
                    console.warn(`[Stripe Webhook] User ${userId} not found during upgrade.`);
                }
            } else {
                console.warn('[Stripe Webhook] No client_reference_id found in session.');
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
app.use(SUBPATH, express.static(path.join(__dirname), { index: 'index.html' }));

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
        
        res.json({ token, user: { id: info.lastInsertRowid, email, is_pro: 0, email_verified: 0, batch_processes: 0 } });
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
        res.json({ token, user: { id: user.id, email: user.email, is_pro: user.is_pro, email_verified: user.email_verified, batch_processes: user.batch_processes } });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get(`${SUBPATH}/api/user/me`, requireAuth, (req, res) => {
    res.json({ user: { id: req.user.id, email: req.user.email, is_pro: req.user.is_pro, email_verified: req.user.email_verified, batch_processes: req.user.batch_processes } });
});

// --- Email Verification ---
app.get(`${SUBPATH}/api/verify-email`, (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send('Missing token');
    const user = db.prepare('SELECT id FROM users WHERE verification_token = ?').get(token);
    if (!user) return res.status(400).send('Invalid or expired token');
    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').run(user.id);
    console.log(`[Email] User ${user.id} verified their email`);
    res.redirect(`${process.env.CLIENT_URL}?verified=1`);
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
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            client_reference_id: req.user.id.toString(),
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'ViralStack Pro', description: 'Unlock unlimited batch video generation.' },
                    unit_amount: 499,
                },
                quantity: 1,
            }],
            success_url: `${process.env.CLIENT_URL}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('Stripe error:', err);
        res.status(500).json({ error: 'Failed to create checkout session' });
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
                        ctx.font = `${s.captionFontWeight} ${s.captionFontSize}px 'Inter', sans-serif`;
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
