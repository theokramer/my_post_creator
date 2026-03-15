/* ===== ViralStack Pro Batch Editor ===== */

(function () {
    'use strict';

    // ===== App State =====
    const state = {
        captions: [],
        images: [],
        logo: null,
        
        currentVideoIndex: 0,
        overrides: {}, // { index: { panX: 0, panY: 0 } }
        
        generating: false,
        textAlign: 'center',
        imageFit: 'contain', // 'cover', 'contain'

        user: null,
        token: localStorage.getItem('pc_token') || null,
        apiPrefix: '/viralstack/api'
    };

    // ===== Built-in Templates =====
    const BUILT_IN_TEMPLATES = {
        'pro-dark': {
            name: 'Pro Dark',
            imageFit: 'contain', imageScale: 100, imageRotate: 0,
            captionPadding: 60, logoScale: 60, imagePadding: 0, logoPadding: 220, imageBorderRadius: 0,
            bgColor: '#111111', captionBgColor: '#1A1A1A', captionTextColor: '#FFFFFF', imageBgColor: '#000000',
            captionFontSize: 46, captionFontWeight: '600', captionAlign: 'center',
            videoDuration: 5, fadeDuration: 1.5, videoFps: 30
        },
        'studio-light': {
            name: 'Studio Light',
            imageFit: 'contain', imageScale: 100, imageRotate: 0,
            captionPadding: 60, logoScale: 60, imagePadding: 0, logoPadding: 220, imageBorderRadius: 0,
            bgColor: '#F4F4F5', captionBgColor: '#FFFFFF', captionTextColor: '#09090B', imageBgColor: '#E4E4E7',
            captionFontSize: 46, captionFontWeight: '600', captionAlign: 'center',
            videoDuration: 5, fadeDuration: 1.5, videoFps: 30
        },
        'minimalist': {
            name: 'Minimalist',
            imageFit: 'cover', imageScale: 100, imageRotate: 0,
            captionPadding: 80, logoScale: 50, imagePadding: 40, logoPadding: 200, imageBorderRadius: 16,
            bgColor: '#000000', captionBgColor: '#000000', captionTextColor: '#FFFFFF', imageBgColor: '#111111',
            captionFontSize: 52, captionFontWeight: '500', captionAlign: 'left',
            videoDuration: 5, fadeDuration: 1.5, videoFps: 30
        }
    };

    // ===== DOM Refs =====
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // Header updates
    const headerStatus = $('#header-status');
    const authHeaderBtn = $('#auth-header-btn');

    // Modals
    const authModal = $('#auth-modal');
    const authTitle = $('#auth-title');
    const authSubtitle = $('#auth-subtitle');
    const authEmail = $('#auth-email');
    const authPassword = $('#auth-password');
    const authToggleLink = $('#auth-toggle-link');
    const authToggleText = $('#auth-toggle-text');
    const closeAuthBtn = $('#close-auth-btn');
    const submitAuthBtn = $('#submit-auth-btn');

    const paywallModal = $('#paywall-modal');
    const closePaywallBtn = $('#close-paywall-btn');
    const buyProBtn = $('#buy-pro-btn');

    // Panel 1: Uploads
    const captionsInput = $('#captions-input');
    const importTxtBtn = $('#import-txt-btn');
    const captionsFileInput = $('#captions-file-input');
    const assetMatching = $('#asset-matching');
    const captionCountNum = $('#caption-count-num');
    const imagesDropZone = $('#images-drop-zone');
    const imagesInput = $('#images-input');
    const imagesPreview = $('#images-preview');
    const logoDropZone = $('#logo-drop-zone');
    const logoInput = $('#logo-input');
    const logoPreview = $('#logo-preview');

    // Panel 2: Player & Switcher
    const prevVideoBtn = $('#prev-video-btn');
    const nextVideoBtn = $('#next-video-btn');
    const videoIndicator = $('#video-indicator');
    const exportCount = $('#export-count');
    const generateBtn = $('#generate-btn');

    // Panel 3: Inspector Tabs
    const inspectTabs = $$('.inspect-tab');
    const inspectPanels = $$('.inspect-panel');

    // Settings (Template Global)
    const imageScale = $('#image-scale'); const imageScaleVal = $('#image-scale-value');
    const imageRotate = $('#image-rotate'); const imageRotateVal = $('#image-rotate-value');
    
    const captionPadding = $('#caption-padding'); const captionPaddingVal = $('#caption-padding-value');
    const logoScale = $('#logo-scale'); const logoScaleVal = $('#logo-scale-value');
    const imagePadding = $('#image-padding'); const imagePaddingVal = $('#image-padding-value');
    const logoPadding = $('#logo-padding'); const logoPaddingVal = $('#logo-padding-value');
    const imageBorderRadius = $('#image-border-radius'); const imageBorderRadiusVal = $('#image-border-radius-value');

    const bgColor = $('#bg-color');
    const captionBgColor = $('#caption-bg-color');
    const captionTextColor = $('#caption-text-color');
    const imageBgColor = $('#image-bg-color');

    const captionFontSize = $('#caption-font-size'); const fontSizeVal = $('#font-size-value');
    const captionFontWeight = $('#caption-font-weight');
    const centerCaptionBtn = $('#center-caption-btn');
    const centerImageBtn = $('#center-image-btn');
    const centerLogoBtn = $('#center-logo-btn');
    
    // Animation Settings
    const videoDuration = $('#video-duration'); const videoDurationVal = $('#video-duration-value');
    const fadeDuration = $('#fade-duration'); const fadeDurationVal = $('#fade-duration-value');
    const cinemaZoomToggle = $('#cinema-zoom-toggle');

    // Canvas
    const previewCanvas = $('#preview-canvas');
    const previewCtx = previewCanvas.getContext('2d');
    const renderCanvas = $('#render-canvas');
    const renderCtx = renderCanvas.getContext('2d');
    const W = 1080, H = 1920;

    // Render Overlay
    const renderOverlay = $('#render-overlay');
    const progressBar = $('#progress-bar');
    const progressText = $('#progress-text');
    const downloadsList = $('#downloads-list');
    const renderActions = $('#render-actions');
    const downloadAllBtn = $('#download-all-btn');
    const closeRenderBtn = $('#close-render-btn');

    // Templates
    const templatesSelect = $('#templates-select');
    const saveTemplateBtn = $('#save-template-btn');
    const saveTemplateModal = $('#save-template-modal');
    const templateNameInput = $('#template-name-input');
    const cancelSaveBtn = $('#cancel-save-btn');
    const confirmSaveBtn = $('#confirm-save-btn');

    function detectVideoFormat() {
        const formats = [
            { mime: 'video/mp4;codecs=avc1', ext: 'mp4' }, { mime: 'video/webm;codecs=vp9', ext: 'webm' },
            { mime: 'video/webm;codecs=vp8', ext: 'webm' }, { mime: 'video/webm', ext: 'webm' }
        ];
        for (const fmt of formats) {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(fmt.mime)) return fmt;
        }
        return { mime: 'video/webm', ext: 'webm' };
    }
    const videoFormat = detectVideoFormat();

    function init() {
        setupUploads();
        setupPlayerControls();
        setupInspector();
        setupDirectCanvasInteraction();
        setupSettings();
        setupPills();
        setupTemplates();
        setupGenerate();
        setupAuth();
        
        loadCustomTemplates();
        applyTemplate(BUILT_IN_TEMPLATES['pro-dark']);
        updateCountsAndSync();
        
        if (state.token) { checkAuthSession(); }
        // checkStripeRedirect(); // Handled by backend CLIENT_URL now, or we can check params
    }

    // ===== 1. Uploads =====
    function setupUploads() {
        captionsInput.addEventListener('input', () => {
            const text = captionsInput.value.trim();
            state.captions = text ? text.split('\n').filter(l => l.trim().length > 0) : [];
            captionCountNum.textContent = state.captions.length;
            updateCountsAndSync();
        });
        
        assetMatching.addEventListener('change', updateCountsAndSync);

        importTxtBtn.addEventListener('click', () => captionsFileInput.click());
        captionsFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                captionsInput.value = re.target.result;
                captionsInput.dispatchEvent(new Event('input'));
            };
            reader.readAsText(file);
        });

        const bindDropZone = (dropZone, input, typeStr, handleFiles) => {
            dropZone.addEventListener('click', () => input.click());
            dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
            dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); });
            input.addEventListener('change', (e) => handleFiles(e.target.files));
        };

        bindDropZone(imagesDropZone, imagesInput, 'image', (files) => {
            for (const file of files) {
                if (!file.type.startsWith('image/')) continue;
                const url = URL.createObjectURL(file); const img = new Image();
                img.onload = () => { state.images.push({ file, url, img }); renderImageThumbs(); updateCountsAndSync(); };
                img.src = url;
            }
        });

        bindDropZone(logoDropZone, logoInput, 'logo', (files) => {
            const file = files[0]; if (!file || !file.type.startsWith('image/')) return;
            if (state.logo) URL.revokeObjectURL(state.logo.url);
            const url = URL.createObjectURL(file); const img = new Image();
            img.onload = () => { state.logo = { file, url, img }; renderLogoThumb(); updateCountsAndSync(); };
            img.src = url;
        });
    }

    function renderImageThumbs() {
        imagesPreview.innerHTML = '';
        state.images.forEach((item, i) => {
            const thumb = document.createElement('div'); thumb.className = 'file-thumb';
            thumb.innerHTML = `<img src="${item.url}"><button class="remove-btn">✕</button>`;
            thumb.querySelector('button').addEventListener('click', (e) => {
                e.stopPropagation(); URL.revokeObjectURL(state.images[i].url);
                state.images.splice(i, 1);
                delete state.overrides[i]; // remove override if image deleted
                // Shift overrides down
                const newOverrides = {};
                for(let k in state.overrides) {
                    let nk = parseInt(k, 10);
                    if (nk > i) newOverrides[nk - 1] = state.overrides[nk];
                    else if (nk < i) newOverrides[nk] = state.overrides[nk];
                }
                state.overrides = newOverrides;
                
                renderImageThumbs(); updateCountsAndSync();
            });
            imagesPreview.appendChild(thumb);
        });
    }

    function renderLogoThumb() {
        logoPreview.innerHTML = '';
        if (!state.logo) return;
        const thumb = document.createElement('div'); thumb.className = 'file-thumb';
        thumb.innerHTML = `<img src="${state.logo.url}"><button class="remove-btn">✕</button>`;
        thumb.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation(); state.logo = null;
            logoPreview.innerHTML = ''; updateCountsAndSync();
        });
        logoPreview.appendChild(thumb);
    }

    // ===== 2. Player Controls & State Sync =====
    function setupPlayerControls() {
        prevVideoBtn.addEventListener('click', () => { if(state.currentVideoIndex > 0) { state.currentVideoIndex--; updateCountsAndSync(); }});
        nextVideoBtn.addEventListener('click', () => { const max = getMatchCount() - 1; if(state.currentVideoIndex < max) { state.currentVideoIndex++; updateCountsAndSync(); }});
        
        const initOverride = () => { if (!state.overrides[state.currentVideoIndex]) state.overrides[state.currentVideoIndex] = {}; };
        centerCaptionBtn.addEventListener('click', () => { initOverride(); state.overrides[state.currentVideoIndex].captionPanX = 0; state.overrides[state.currentVideoIndex].captionPanY = 0; drawPreview(); });
        centerImageBtn.addEventListener('click', () => { initOverride(); state.overrides[state.currentVideoIndex].imagePanX = 0; state.overrides[state.currentVideoIndex].imagePanY = 0; drawPreview(); });
        centerLogoBtn.addEventListener('click', () => { initOverride(); state.overrides[state.currentVideoIndex].logoPanX = 0; state.overrides[state.currentVideoIndex].logoPanY = 0; drawPreview(); });
    }

    function getMatchCount() {
        const c = state.captions.length;
        const i = state.images.length;
        if (c === 0 || i === 0) return 0;
        
        const mode = assetMatching.value;
        if (mode === 'loop-images') return c;
        if (mode === 'loop-captions') return i;
        return Math.min(c, i); // strict
    }

    function getIndexedAsset(idx) {
        if (getMatchCount() === 0) return { caption: null, image: null };
        const mode = assetMatching.value;
        
        let cIdx = idx, iIdx = idx;
        if (mode === 'loop-images') iIdx = idx % state.images.length;
        if (mode === 'loop-captions') cIdx = idx % state.captions.length;
        
        return {
            caption: state.captions[cIdx],
            image: state.images[iIdx]
        };
    }

    function updateCountsAndSync() {
        const n = getMatchCount();
        exportCount.textContent = `${n} item${n !== 1 ? 's' : ''} ready`;
        generateBtn.disabled = (n === 0);
        
        if (n === 0) {
            state.currentVideoIndex = 0;
            videoIndicator.textContent = 'Video 0 / 0';
            prevVideoBtn.disabled = true; nextVideoBtn.disabled = true;
        } else {
            if (state.currentVideoIndex >= n) state.currentVideoIndex = n - 1;
            if (state.currentVideoIndex < 0) state.currentVideoIndex = 0;
            
            videoIndicator.textContent = `Video ${state.currentVideoIndex + 1} / ${n}`;
            prevVideoBtn.disabled = (state.currentVideoIndex === 0);
            nextVideoBtn.disabled = (state.currentVideoIndex === n - 1);
            
            // initialize override if not exists
            if (!state.overrides[state.currentVideoIndex]) {
                state.overrides[state.currentVideoIndex] = { imagePanX: 0, imagePanY: 0, captionPanX: 0, captionPanY: 0, logoPanX: 0, logoPanY: 0 };
            }
        }
        
        let headerTxt = "Ready";
        if (state.images.length === 0 && state.captions.length === 0) headerTxt = "Upload Assets";
        else if (n === 0) headerTxt = "Matching Pairs Needed";
        else headerTxt = `${n} Ready for Export`;
        headerStatus.textContent = headerTxt;

        drawPreview();
    }

    // ===== 3. Interactive Canvas (Direct Panning) =====
    function setupDirectCanvasInteraction() {
        let isDragging = false;
        let startX = 0, startY = 0;
        let dragTarget = null;
        let pannedX = 0, pannedY = 0;

        previewCanvas.addEventListener('pointerdown', (e) => {
            const n = getMatchCount();
            if (n === 0) return;
            
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            
            const rect = previewCanvas.getBoundingClientRect();
            const scaleY = H / rect.height;
            const cy = (e.clientY - rect.top) * scaleY;
            
            const s = getCurrentSettings();
            const lineH = s.captionFontSize * 1.4;
            let capLen = 1;
            const asset = getIndexedAsset(state.currentVideoIndex);
            if (asset.caption) {
                previewCtx.font = `${s.captionFontWeight} ${s.captionFontSize}px 'Inter', sans-serif`;
                capLen = getWrappedLines(previewCtx, asset.caption, W - s.captionPadding * 2).length;
            }
            const captionAreaHeight = Math.max(300, capLen * lineH + s.captionPadding * 2);
            
            if (cy < captionAreaHeight) dragTarget = 'caption';
            else if (cy > H - s.logoPadding) dragTarget = 'logo';
            else dragTarget = 'image';
            
            const currOver = state.overrides[state.currentVideoIndex] || {};
            if (dragTarget === 'caption') { pannedX = currOver.captionPanX || 0; pannedY = currOver.captionPanY || 0; }
            else if (dragTarget === 'logo') { pannedX = currOver.logoPanX || 0; pannedY = currOver.logoPanY || 0; }
            else { pannedX = currOver.imagePanX || 0; pannedY = currOver.imagePanY || 0; }
            
            previewCanvas.setPointerCapture(e.pointerId);
        });

        previewCanvas.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            const rect = previewCanvas.getBoundingClientRect();
            const scaleX = W / rect.width;
            const scaleY = H / rect.height;

            const cx = dx * scaleX;
            const cy = dy * scaleY;
            
            if (!state.overrides[state.currentVideoIndex]) state.overrides[state.currentVideoIndex] = {};
            
            if (dragTarget === 'caption') {
                state.overrides[state.currentVideoIndex].captionPanX = pannedX + cx;
                state.overrides[state.currentVideoIndex].captionPanY = pannedY + cy;
            } else if (dragTarget === 'logo') {
                state.overrides[state.currentVideoIndex].logoPanX = pannedX + cx;
                state.overrides[state.currentVideoIndex].logoPanY = pannedY + cy;
            } else {
                state.overrides[state.currentVideoIndex].imagePanX = pannedX + cx;
                state.overrides[state.currentVideoIndex].imagePanY = pannedY + cy;
            }
            
            drawPreview();
        });

        const stopDrag = (e) => {
            if (isDragging) {
                isDragging = false;
                previewCanvas.releasePointerCapture(e.pointerId);
            }
        };

        previewCanvas.addEventListener('pointerup', stopDrag);
        previewCanvas.addEventListener('pointercancel', stopDrag);
    }

    // ===== 4. Inspector / Settings =====
    function setupInspector() {
        inspectTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                inspectTabs.forEach(t => t.classList.remove('active'));
                inspectPanels.forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                $(`.inspect-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
            });
        });
    }

    function setupPills() {
        const attachPillGroup = (groupId, stateKey) => {
            $$(`#${groupId} .segment`).forEach(btn => {
                btn.addEventListener('click', () => {
                    $$(`#${groupId} .segment`).forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    state[stateKey] = btn.dataset.value;
                    drawPreview();
                });
            });
        };
        attachPillGroup('image-fit-group', 'imageFit');
        attachPillGroup('caption-align-group', 'textAlign');
    }

    function setupSettings() {
        const bind = (el, labelEl, suffix) => {
            el.addEventListener('input', () => {
                if (labelEl) labelEl.textContent = el.value + suffix;
                drawPreview();
            });
        };
        bind(imageScale, imageScaleVal, '%'); bind(imageRotate, imageRotateVal, '°');
        bind(captionPadding, captionPaddingVal, 'px'); bind(logoScale, logoScaleVal, '%');
        bind(imagePadding, imagePaddingVal, 'px'); bind(logoPadding, logoPaddingVal, 'px');
        bind(imageBorderRadius, imageBorderRadiusVal, 'px'); bind(captionFontSize, fontSizeVal, 'px');
        bind(captionFontWeight, null, '');
        bind(bgColor, null, ''); bind(captionBgColor, null, '');
        bind(captionTextColor, null, ''); bind(imageBgColor, null, '');
        
        bind(videoDuration, videoDurationVal, 's');
        bind(fadeDuration, fadeDurationVal, 's');
        cinemaZoomToggle.addEventListener('change', drawPreview);
    }

    // ===== 5. Global Templates =====
    function getCurrentSettings() {
        return {
            imageFit: state.imageFit, imageScale: +imageScale.value, imageRotate: +imageRotate.value,
            captionPadding: +captionPadding.value, logoScale: +logoScale.value,
            imagePadding: +imagePadding.value, logoPadding: +logoPadding.value,
            imageBorderRadius: +imageBorderRadius.value, captionFontSize: +captionFontSize.value,
            captionFontWeight: captionFontWeight.value, captionAlign: state.textAlign,
            bgColor: bgColor.value, captionBgColor: captionBgColor.value,
            captionTextColor: captionTextColor.value, imageBgColor: imageBgColor.value,
            videoDuration: +videoDuration.value, fadeDuration: +fadeDuration.value, cinemaZoom: cinemaZoomToggle.checked, videoFps: 30
        };
    }

    function applyTemplate(t) {
        state.imageFit = t.imageFit || 'contain';
        $$('#image-fit-group .segment').forEach(b => b.classList.toggle('active', b.dataset.value === state.imageFit));
        imageScale.value = t.imageScale; imageScaleVal.textContent = t.imageScale + '%';
        imageRotate.value = t.imageRotate; imageRotateVal.textContent = t.imageRotate + '°';
        
        captionPadding.value = t.captionPadding; captionPaddingVal.textContent = t.captionPadding + 'px';
        logoScale.value = t.logoScale; logoScaleVal.textContent = t.logoScale + '%';
        imagePadding.value = t.imagePadding; imagePaddingVal.textContent = t.imagePadding + 'px';
        logoPadding.value = t.logoPadding; logoPaddingVal.textContent = t.logoPadding + 'px';
        imageBorderRadius.value = t.imageBorderRadius; imageBorderRadiusVal.textContent = t.imageBorderRadius + 'px';
        
        bgColor.value = t.bgColor; captionBgColor.value = t.captionBgColor;
        captionTextColor.value = t.captionTextColor; imageBgColor.value = t.imageBgColor || '#000000';
        
        captionFontSize.value = t.captionFontSize; fontSizeVal.textContent = t.captionFontSize + 'px';
        captionFontWeight.value = t.captionFontWeight;
        state.textAlign = t.captionAlign || 'center';
        $$('#caption-align-group .segment').forEach(b => b.classList.toggle('active', b.dataset.value === state.textAlign));
        
        videoDuration.value = t.videoDuration || 5; videoDurationVal.textContent = videoDuration.value + 's';
        fadeDuration.value = t.fadeDuration || 1.5; fadeDurationVal.textContent = fadeDuration.value + 's';
        cinemaZoomToggle.checked = !!t.cinemaZoom;
        
        drawPreview();
    }

    function setupTemplates() {
        templatesSelect.addEventListener('change', (e) => {
            const id = e.target.value;
            if (BUILT_IN_TEMPLATES[id]) applyTemplate(BUILT_IN_TEMPLATES[id]);
            else {
                const custom = getCustomTemplates().find(c => c.id === id);
                if (custom) applyTemplate(custom.settings);
            }
        });

        saveTemplateBtn.addEventListener('click', () => {
            saveTemplateModal.classList.remove('hidden');
            templateNameInput.value = ''; templateNameInput.focus();
        });
        cancelSaveBtn.addEventListener('click', () => saveTemplateModal.classList.add('hidden'));
        confirmSaveBtn.addEventListener('click', () => {
            const name = templateNameInput.value.trim();
            if (!name) return;
            const id = 'custom-' + Date.now();
            const custom = getCustomTemplates();
            custom.push({ id, name, settings: getCurrentSettings() }); // Overrides are explicit per-session, not in template
            localStorage.setItem('pc_pro_templates', JSON.stringify(custom));
            saveTemplateModal.classList.add('hidden');
            loadCustomTemplates();
            templatesSelect.value = id;
        });
    }

    function getCustomTemplates() {
        try { return JSON.parse(localStorage.getItem('pc_pro_templates') || '[]'); } catch { return []; }
    }

    function loadCustomTemplates() {
        const group = $('#custom-templates-group'); group.innerHTML = '';
        getCustomTemplates().forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id; opt.textContent = t.name;
            group.appendChild(opt);
        });
    }

    // ===== 6. Core Drawing Engine =====
    function getWrappedLines(ctx, text, maxWidth) {
        const words = text.split(' '); const lines = []; let cur = '';
        for (const w of words) {
            const test = cur ? cur + ' ' + w : w;
            if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; } else cur = test;
        }
        if (cur) lines.push(cur); return lines;
    }

    function drawPreview(imageAlpha = 1) {
        // Fallbacks if no assets
        let caption = "A highly polished, 3D rendered cinematic shot ready for broadcast.";
        let contentImg = null;
        let logoImg = state.logo ? state.logo.img : null;
        let over = {};
        
        const n = getMatchCount();
        if (n > 0) {
            const asset = getIndexedAsset(state.currentVideoIndex);
            caption = asset.caption || caption;
            contentImg = asset.image ? asset.image.img : null;
            // Get local overrides specifically for this video index
            over = state.overrides[state.currentVideoIndex] || over;
        }

        drawFrame(previewCtx, caption, contentImg, logoImg, imageAlpha, over, 0); // At preview, cinemaZoom is 0
    }

    function drawFrame(ctx, caption, contentImg, logoImg, imageAlpha, over, zoomScale) {
        const s = getCurrentSettings();
        const lineH = s.captionFontSize * 1.4;
        
        ctx.font = `${s.captionFontWeight} ${s.captionFontSize}px 'Inter', sans-serif`;
        const lines = getWrappedLines(ctx, caption, W - s.captionPadding * 2);
        const captionAreaHeight = Math.max(300, lines.length * lineH + s.captionPadding * 2);
        const logoAreaH = s.logoPadding;
        const imageAreaTop = captionAreaHeight;
        const imageAreaHeight = H - captionAreaHeight - logoAreaH;

        ctx.fillStyle = s.bgColor; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = s.captionBgColor; ctx.fillRect(0, 0, W, captionAreaHeight);

        // Text Draw
        ctx.fillStyle = s.captionTextColor;
        ctx.textAlign = s.captionAlign; ctx.textBaseline = 'middle';
        let textX = W / 2;
        if (s.captionAlign === 'left') textX = s.captionPadding;
        if (s.captionAlign === 'right') textX = W - s.captionPadding;
        
        textX += (over.captionPanX || 0);
        const startY = (captionAreaHeight / 2) - (lines.length * lineH) / 2 + lineH / 2 + (over.captionPanY || 0);
        lines.forEach((line, i) => ctx.fillText(line, textX, startY + i * lineH));

        // Image Draw
        if (contentImg) {
            ctx.save();
            ctx.globalAlpha = imageAlpha;
            const pad = s.imagePadding; const r = s.imageBorderRadius;
            
            const areaW = W - pad * 2;
            const areaH = imageAreaHeight - pad * 2;
            const areaX = pad;
            const areaY = imageAreaTop + pad;

            // Media Background / Clip region
            ctx.fillStyle = s.imageBgColor;
            ctx.beginPath();
            ctx.roundRect(areaX, areaY, areaW, areaH, r);
            ctx.fill();
            ctx.clip(); // Restrict drawing to bounds

            // Transform Compute
            const imgW = contentImg.naturalWidth;
            const imgH = contentImg.naturalHeight;
            let drawW, drawH;

            const ratioImg = imgW / imgH; const ratioArea = areaW / areaH;
            if (state.imageFit === 'cover') {
                if (ratioImg > ratioArea) { drawH = areaH; drawW = areaH * ratioImg; }
                else { drawW = areaW; drawH = areaW / ratioImg; }
            } else if (state.imageFit === 'contain') {
                if (ratioImg > ratioArea) { drawW = areaW; drawH = areaW / ratioImg; }
                else { drawH = areaH; drawW = areaH * ratioImg; }
            }

            // Global Scale Modifier + Cinematic Zoom over time
            let totalScale = (s.imageScale / 100);
            if (s.cinemaZoom) totalScale += zoomScale;
            
            drawW *= totalScale;
            drawH *= totalScale;

            // Apply specific explicit Pan coordinates for this video
            ctx.translate(areaX + areaW / 2 + (over.imagePanX || 0), areaY + areaH / 2 + (over.imagePanY || 0));
            ctx.rotate((s.imageRotate * Math.PI) / 180);
            
            ctx.drawImage(contentImg, -drawW / 2, -drawH / 2, drawW, drawH);
            ctx.restore();
        } else {
            const pad = s.imagePadding;
            ctx.fillStyle = s.imageBgColor;
            ctx.beginPath(); ctx.roundRect(pad, imageAreaTop + pad, W - pad * 2, imageAreaHeight - pad * 2, s.imageBorderRadius); ctx.fill();
            
            ctx.fillStyle = s.captionTextColor; ctx.textAlign = 'center'; ctx.font = `500 24px 'Inter'`;
            ctx.fillText("Upload imagery to preview", W / 2, imageAreaTop + imageAreaHeight / 2);
        }

        // Logo Draw
        if (logoImg) {
            const scaleFactor = s.logoScale / 100;
            const maxLogoH = (logoAreaH - 40) * scaleFactor;
            const maxLogoW = (W - 160) * scaleFactor;
            let lw = logoImg.naturalWidth, lh = logoImg.naturalHeight;
            const sc = Math.min(maxLogoW / lw, maxLogoH / lh, 1);
            lw *= sc; lh *= sc;
            
            const lx = (W - lw) / 2 + (over.logoPanX || 0);
            const ly = H - logoAreaH + (logoAreaH - lh) / 2 + (over.logoPanY || 0);
            ctx.drawImage(logoImg, lx, ly, lw, lh);
        }
    }

    // ===== 7. Generation & Export =====
    function setupGenerate() {
        generateBtn.addEventListener('click', () => { if (!state.generating) generateAllVideos(); });
        downloadAllBtn.addEventListener('click', downloadAllAsZip);
        closeRenderBtn.addEventListener('click', () => {
            renderOverlay.classList.add('hidden');
            downloadsList.classList.add('hidden');
            renderActions.classList.add('hidden');
        });
    }

    async function generateAllVideos() {
        const n = getMatchCount();
        if (n === 0) return;

        if (!state.token) {
            showAuthModal('Sign In or Register to Generate');
            return;
        }
        
        generateBtn.disabled = true;
        generateBtn.textContent = 'Checking quota...';
        try {
            const resp = await fetch(`${state.apiPrefix}/generate/track`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
                body: JSON.stringify({ captionCount: n })
            });
            const data = await resp.json();
            if (!resp.ok) {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Render All';
                if (resp.status === 401) {
                    showAuthModal('Session expired. Please sign in again.');
                    return;
                }
                if (data.requires_upgrade) {
                    showPaywallModal();
                    return;
                }
                alert(data.error || 'Generation blocked');
                return;
            }
        } catch (err) {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Render All';
            alert('Error checking quota: ' + err.message);
            return;
        }
        generateBtn.textContent = 'Render All';

        state.generating = true; generateBtn.disabled = true;
        renderOverlay.classList.remove('hidden');
        downloadsList.innerHTML = ''; downloadsList.classList.remove('hidden');
        renderActions.classList.add('hidden');
        progressBar.style.width = '0%';

        const blobs = [];
        for (let i = 0; i < n; i++) {
            progressText.textContent = `Rendering video sequence ${i + 1} of ${n}...`;
            progressBar.style.width = (i / n * 100) + '%';
            try {
                const over = state.overrides[i] || {};
                const asset = getIndexedAsset(i);
                if (!asset.caption || !asset.image) continue;
                
                const blob = await generateVideo(asset.caption, asset.image.img, state.logo ? state.logo.img : null, over);
                blobs.push({ blob, index: i, caption: asset.caption });
                
                const item = document.createElement('div');
                item.className = 'dl-item';
                const url = URL.createObjectURL(blob);
                const capCut = asset.caption.length > 40 ? asset.caption.substring(0, 40) + '...' : asset.caption;
                item.innerHTML = `<span><a href="${url}" download="vid_${i + 1}.${videoFormat.ext}">Vid_${i+1}.${videoFormat.ext}</a> - ${escapeHtml(capCut)}</span>`;
                downloadsList.appendChild(item);
            } catch (err) { console.error(`Render err ${i}:`, err); }
            progressBar.style.width = ((i + 1) / n * 100) + '%';
        }

        progressText.textContent = `Completed ${blobs.length} renders. Automatically downloading...`;
        renderActions.classList.remove('hidden');
        if (blobs.length <= 1) downloadAllBtn.style.display = 'none';
        else { downloadAllBtn.style.display = 'block'; downloadAllBtn._blobs = blobs; }
        
        state.generating = false; generateBtn.disabled = false;
        
        // Auto Download
        if (blobs.length > 1) {
            downloadAllAsZip();
        } else if (blobs.length === 1) {
            const url = URL.createObjectURL(blobs[0].blob);
            const a = document.createElement('a');
            a.href = url; a.download = `vid_1.${videoFormat.ext}`;
            a.click();
        }
    }

    function generateVideo(caption, contentImg, logoImg, over) {
        return new Promise((resolve) => {
            const s = getCurrentSettings();
            const total = s.videoDuration * 1000;
            const fadeDur = s.fadeDuration * 1000;
            const fps = 30, frameInt = 1000 / fps;
            const totalFrames = total / frameInt;
            
            const stream = renderCanvas.captureStream(fps);
            const recorder = new MediaRecorder(stream, { mimeType: videoFormat.mime, videoBitsPerSecond: 8000000 });
            const chunks = [];
            recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = () => resolve(new Blob(chunks, { type: videoFormat.mime.split(';')[0] }));
            recorder.start(100);

            let frame = 0;
            function render() {
                const elapsed = frame * frameInt; let alpha = 1;
                if (elapsed < fadeDur) alpha = elapsed / fadeDur;
                else if (elapsed > total - fadeDur) alpha = Math.max(0, (total - elapsed) / fadeDur);
                
                // Max zoom scale adds 15% (0.15) over the total duration
                const zoomScale = s.cinemaZoom ? (elapsed / total) * 0.15 : 0;
                
                // Draw with exact per-video specific overrides and explicit zooms
                drawFrame(renderCtx, caption, contentImg, logoImg, Math.max(0, Math.min(1, alpha)), over, zoomScale);
                
                if (frame++ <= totalFrames) setTimeout(render, frameInt);
                else setTimeout(() => recorder.stop(), 200);
            }
            render();
        });
    }

    async function downloadAllAsZip() {
        if (!downloadAllBtn._blobs) return;
        downloadAllBtn.disabled = true; downloadAllBtn.textContent = 'Compressing...';
        try {
            const zip = new JSZip();
            downloadAllBtn._blobs.forEach(item => zip.file(`vid_${item.index + 1}.${videoFormat.ext}`, item.blob));
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a'); a.href = url; a.download = 'pro_exports.zip';
            a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) { }
        downloadAllBtn.disabled = false; downloadAllBtn.textContent = 'Download All (.zip)';
    }

    // ===== 8. Auth & Paywall Logic =====
    let authMode = 'login'; // 'login' | 'register'
    function setupAuth() {
        authHeaderBtn.addEventListener('click', () => {
            if (state.token) {
                // Logout
                localStorage.removeItem('pc_token');
                state.token = null; state.user = null;
                updateAuthUI();
            } else {
                showAuthModal();
            }
        });

        closeAuthBtn.addEventListener('click', () => authModal.classList.add('hidden'));
        
        authToggleLink.addEventListener('click', (e) => {
            e.preventDefault();
            authMode = authMode === 'login' ? 'register' : 'login';
            updateAuthModalUI();
        });

        submitAuthBtn.addEventListener('click', async () => {
            const email = authEmail.value.trim();
            const password = authPassword.value;
            if (!email || !password) return alert('Email and password required');
            
            submitAuthBtn.disabled = true;
            submitAuthBtn.textContent = 'Wait...';
            try {
                const isLogin = authMode === 'login';
                const endpoint = isLogin ? 'login' : 'register';
                const resp = await fetch(`${state.apiPrefix}/auth/${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                
                let data;
                try {
                    data = await resp.json();
                } catch (parseErr) {
                    throw new Error('Server returned an invalid response. Please ensure you have restarted your Node server to load the latest backend code.');
                }
                
                if (!resp.ok) throw new Error(data.error || 'Auth failed');
                
                state.token = data.token;
                state.user = data.user;
                localStorage.setItem('pc_token', data.token);
                updateAuthUI();
                authModal.classList.add('hidden');
            } catch (err) {
                alert(err.message);
            }
            submitAuthBtn.disabled = false;
            submitAuthBtn.textContent = authMode === 'login' ? 'Sign In' : 'Sign Up';
        });

        closePaywallBtn.addEventListener('click', () => paywallModal.classList.add('hidden'));
        
        buyProBtn.addEventListener('click', async () => {
            buyProBtn.disabled = true; buyProBtn.textContent = 'Loading Stripe...';
            try {
                const resp = await fetch(`${state.apiPrefix}/create-checkout-session`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${state.token}` }
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error);
                window.location.href = data.url;
            } catch (err) {
                alert('Checkout Error: ' + err.message);
                buyProBtn.disabled = false; buyProBtn.textContent = 'Buy Pro Now';
            }
        });
    }

    function showAuthModal(message = null) {
        if (message) authSubtitle.textContent = message;
        else updateAuthModalUI(); // reset
        authEmail.value = ''; authPassword.value = '';
        authModal.classList.remove('hidden');
    }

    function updateAuthModalUI() {
        if (authMode === 'login') {
            authTitle.textContent = 'Welcome Back';
            authSubtitle.textContent = 'Sign in to access your videos & quotas.';
            submitAuthBtn.textContent = 'Sign In';
            authToggleText.textContent = 'Need an account?';
            authToggleLink.textContent = 'Sign Up';
        } else {
            authTitle.textContent = 'Create Pro Account';
            authSubtitle.textContent = 'Start automating your content today.';
            submitAuthBtn.textContent = 'Sign Up';
            authToggleText.textContent = 'Already have an account?';
            authToggleLink.textContent = 'Sign In';
        }
    }

    function showPaywallModal() {
        paywallModal.classList.remove('hidden');
    }

    async function checkAuthSession() {
        try {
            const resp = await fetch(`${state.apiPrefix}/user/me`, {
                headers: { 'Authorization': `Bearer ${state.token}` }
            });
            if (resp.ok) {
                const data = await resp.json();
                state.user = data.user;
                updateAuthUI();
            } else {
                localStorage.removeItem('pc_token');
                state.token = null;
                updateAuthUI();
            }
        } catch(e) {}
    }

    function updateAuthUI() {
        if (state.user) {
            authHeaderBtn.textContent = 'Log Out';
            authHeaderBtn.classList.replace('btn-secondary', 'btn-primary');
            if (state.user.is_pro) {
                headerStatus.textContent = 'Pro Member';
                headerStatus.style.background = 'rgba(168, 85, 247, 0.2)';
                headerStatus.style.color = '#d8b4fe';
            }
        } else {
            authHeaderBtn.textContent = 'Sign In';
            authHeaderBtn.classList.replace('btn-primary', 'btn-secondary');
            headerStatus.textContent = 'Ready';
            headerStatus.style.background = '';
            headerStatus.style.color = '';
        }
    }

    function checkStripeRedirect() {
        const urlParams = new URLSearchParams(window.location.search);
        const sid = urlParams.get('session_id');
        if (sid) {
            alert('Payment Successful! You are now a Pro Member.');
            window.history.replaceState({}, document.title, window.location.pathname);
            if (state.token) checkAuthSession(); // Refresh profile
        }
    }

    function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
    
    // Fallback Canvas polyfill for roundRect
    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
            r = Math.min(r, w/2, h/2);
            this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r);
            this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r);
            this.arcTo(x, y, x + w, y, r); return this;
        };
    }

    init();
})();
