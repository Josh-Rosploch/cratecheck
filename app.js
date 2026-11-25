(() => {
  'use strict';
  const CC = window.CC;
  const { cfg, esc, norm, normFull, similarity, formatMoney, formatMoneyWithUsd, toApproxUsd, MEDIA_GRADES, SLEEVE_GRADES } = CC;

  // Dynamic PWA Manifest
  (function injectManifest() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="40" fill="#181c26"/><rect x="26" y="48" width="140" height="96" rx="14" fill="#3b82f6"/><circle cx="68" cy="96" r="18" fill="#0f1117"/><circle cx="124" cy="96" r="18" fill="#0f1117"/><rect x="64" y="122" width="64" height="14" rx="4" fill="#0f1117"/></svg>`;
    const m = { name: 'CrateCheck Media Scanner', short_name: 'CrateCheck', start_url: CC.REDIRECT_URI, display: 'standalone', background_color: '#0f1117', theme_color: '#0f1117', icons: [{ src: 'data:image/svg+xml;base64,' + btoa(svg), sizes: '192x192', type: 'image/svg+xml' }] };
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/json' }));
    document.head.appendChild(link);
  })();

  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  const VOICE_BTN_IDLE = "🎤 Don't Agree? AI Voice Re-Grade";
  const VERIFY_BATCH_LIMIT = 45;
  const RAW_EXT_RX = /\.(arw|dng|cr2|cr3|nef|nrw|orf|raf|rw2|pef|srw|raw)$/i;
  const RAW_MIME_RX = /(raw|x-sony-arw|x-canon-cr2|x-nikon-nef|x-adobe-dng)/i;

  let spotifyProfile = null;
  let discogsCollectionIndex = null;
  let stashCache = [];
  let currentView = 'scan';
  let scanMode = 'single';
  let activeFormat = 'Auto';
  let activeStashFilter = 'all';

  let stagedPhotos = [];
  let stagedUpc = '';
  let currentExtracted = null;
  let currentCandidates = [];
  let visibleCandidateIds = null;
  let detectiveDiffs = {};
  let detectivePickId = null;
  let detectiveEliminatedIds = new Set();
  let detectiveInspectedCount = 0;
  let currentInspected = null;
  let activeStashItem = null;
  let editingStashItem = null;

  // Pile Scan + Interactive Zoom/Pan + Non-Blocking Price Fill state
  let pilePhoto = null;
  let pileResults = [];
  let activePileIdx = null;
  let pileRunId = 0;
  let pileBatchPriceRunning = false;
  let pileZoomInline = null;
  let pileZoomFs = null;

  // Audio + Platform Menu state
  const tasteCache = new Map();
  let activeClipKey = '';
  let activePlatforms = null;
  let activeFallbackClip = null;
  let scanRunId = 0;
  let clipReqId = 0;

  // Camera / Lightbox / Voice state
  let camMode = 'single';
  let camStream = null;
  let camImageCapture = null;
  let camCapturing = false;
  let camFocusTimer = null;
  let camUpcRaf = null;
  let camTorchOn = false;
  let lbPhotos = [];
  let lbIdx = 0;
  let lbTouchX = 0;

  let activeRecognition = null;
  let voiceWantListening = false;
  let voiceTranscriptFinal = '';
  let voiceTranscriptInterim = '';
  let voiceContext = null;
  let pendingVoiceRetry = null;

  // ==================== UI HELPERS & CANCELLABLE STATUS ====================
  function aiEngineLabel() {
    return `Gemini (${cfg.geminiModel || 'Cloud'})`;
  }

  function toast(msg, ms = 2800) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function renderBanner(el, text, show, cancellable) {
    if (!el) return;
    if (!show) { el.classList.remove('show'); return; }
    el.style.borderColor = cancellable ? 'var(--yellow)' : '';
    el.innerHTML = `
      <div class="spinner"></div>
      <div style="flex:1; font-size:0.84rem;">${esc(text)}</div>
      ${cancellable ? `<button type="button" class="btn btn-danger btn-sm" style="min-height:32px; padding:4px 10px;" onclick="cancelActiveAI()">✕ Cancel</button>` : ''}
    `;
    el.classList.add('show');
  }

  function setStatus(text, show = true, opts = {}) {
    const cancellable = Boolean(opts?.cancellable);
    renderBanner(document.getElementById('statusBanner'), text, show, cancellable);
    renderBanner(document.getElementById('settingsStatusBanner'), text, show, cancellable);
  }

  window.cancelActiveAI = () => {
    CC.cancelAI();
    setStatus('', false);
    toast('Cancelled');
  };

  function updateRatePill(count = CC.getRateCount()) {
    const pill = document.getElementById('ratePill');
    pill.textContent = `API ${count}/58`;
    pill.className = 'pill ' + (count >= 52 ? 'err' : count >= 40 ? 'warn' : 'ok');
  }
  setInterval(() => updateRatePill(), 3000);

  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      [587.33, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.12);
        gain.gain.setValueAtTime(0.14, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.35);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.12); osc.stop(now + i * 0.12 + 0.36);
      });
    } catch (_) {}
  }

  function speakText(text) {
    if (!cfg.voice || !('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.speak(u); } catch (_) {}
  }

  function gradeOptionsHtml(list, selected) {
    return list.map(g => `<option value="${esc(g)}" ${g === selected ? 'selected' : ''}>${esc(g)}</option>`).join('');
  }

  function shortGrade(g) {
    if (!g) return '';
    const m = g.match(/\(([^)]+)\)/);
    return m ? m[1].split(' ')[0] : g;
  }

  function normalizeGrade(val, allowed, fallback) {
    if (!val) return fallback;
    const exact = allowed.find(g => g.toLowerCase() === String(val).trim().toLowerCase());
    if (exact) return exact;
    const n = norm(val);
    return allowed.find(g => norm(g).includes(n) || n.includes(norm(g))) || fallback;
  }

  function parseDiscogsId(val) {
    const s = String(val || '').trim();
    if (!s) return null;
    const m = s.match(/\/release\/(\d+)/i) || s.match(/\[r=?(\d+)\]/i) || s.match(/^#?(\d{4,12})$/);
    if (m) return Number(m[1]);
    const anyNum = s.match(/(\d{5,12})/);
    return anyNum ? Number(anyNum[1]) : null;
  }

  function extractReferencedIds(notes) {
    const ids = new Set();
    const rx = /\[r=?(\d+)\]/gi;
    let m;
    while ((m = rx.exec(String(notes || ''))) !== null) ids.add(Number(m[1]));
    return Array.from(ids);
  }

  function formatPressingNotesHtml(text, clickable = true) {
    const safe = esc(text || '');
    if (!clickable) return safe;
    return safe.replace(/\[r=?(\d+)\]/gi, (_, id) =>
      `<button type="button" class="btn btn-secondary btn-sm" style="display:inline-flex; min-height:24px; padding:1px 8px; font-size:0.74rem; margin:1px 2px; vertical-align:baseline; color:#93c5fd;" onclick="loadReleaseById(${id})">🔗 #${id}</button>`
    );
  }

  function cleanDiscogsArtist(arr) {
    return (arr || []).map(a => a.name.replace(/\s*\(\d+\)$/, '')).join(', ');
  }

  function updateSettingsPills() {
    const hAi = document.getElementById('aiPill');
    const pAi = document.getElementById('pillAi');
    const pD = document.getElementById('pillDiscogs');
    const pM = document.getElementById('pillMusic');
    const pB = document.getElementById('pillData');

    const aiOk = CC.isAiReady();
    hAi.textContent = aiOk ? 'Gemini: On' : 'Gemini: Off';
    hAi.className = 'pill ' + (aiOk ? 'ok' : 'warn');
    pAi.textContent = aiOk ? 'Gemini' : 'Setup';
    pAi.className = 'pill ' + (aiOk ? 'ok' : 'warn');

    if (cfg.discogsToken && cfg.discogsUser) { pD.textContent = `@${cfg.discogsUser}`; pD.className = 'pill ok'; }
    else if (cfg.discogsToken) { pD.textContent = 'Verify'; pD.className = 'pill warn'; }
    else { pD.textContent = 'Setup'; pD.className = 'pill warn'; }

    const hasProfile = Boolean(spotifyProfile?.tasteDna || spotifyProfile?.softSpots);
    if (spotifyProfile?.totalArtists) {
      pM.textContent = hasProfile ? 'Ready' : `${spotifyProfile.totalArtists} art`;
      pM.className = 'pill ok';
    } else if (hasProfile) {
      pM.textContent = 'Profile Ready';
      pM.className = 'pill ok';
    } else {
      pM.textContent = 'Off';
      pM.className = 'pill';
    }

    pB.textContent = `${stashCache.length} items`;
    pB.className = 'pill';
  }

  // ==================== NAVIGATION & ANDROID BACK GESTURE ====================
  function hideStashDetailUI() {
    activeStashItem = null;
    pendingVoiceRetry = null;
    document.getElementById('stashDetailModal').classList.add('hidden');
  }

  function hideManualModalUI() {
    document.getElementById('manualModal').classList.add('hidden');
  }

  function hidePileFsUI() {
    document.getElementById('pileFullscreenModal').classList.add('hidden');
  }

  function hideCameraUI() {
    if (camUpcRaf) cancelAnimationFrame(camUpcRaf);
    camUpcRaf = null;
    camTorchOn = false;
    camImageCapture = null;
    camCapturing = false;
    clearTimeout(camFocusTimer);
    document.getElementById('camFocusRing')?.classList.remove('show');
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    document.getElementById('camVideo').srcObject = null;
    document.getElementById('cameraModal').classList.add('hidden');
  }

  function hideLightboxUI() {
    document.getElementById('lightboxModal').classList.add('hidden');
    document.getElementById('lbImg').classList.remove('zoomed');
  }

  window.closeOpenInMenu = () => {
    document.getElementById('openInMenu').classList.add('hidden');
    document.getElementById('audioOpenInBtn').classList.remove('open');
  };

  window.switchView = (name, fromPop = false) => {
    const viewChanged = name !== currentView;
    hideStashDetailUI();
    hideManualModalUI();
    hidePileFsUI();
    hideCameraUI();
    hideLightboxUI();
    closeOpenInMenu();

    if (!fromPop) {
      try {
        if (history.state?.modal) history.replaceState({ view: name, modal: null }, '');
        else if (viewChanged) history.pushState({ view: name, modal: null }, '');
      } catch (_) {}
    }

    currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    document.getElementById('view-' + name).classList.add('active');

    if (viewChanged) {
      if (name === 'stash') renderStash();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  window.addEventListener('popstate', (e) => {
    const st = e.state || { view: 'scan', modal: null };
    if (st.modal !== 'lightbox') hideLightboxUI();
    if (st.modal !== 'camera') hideCameraUI();
    if (st.modal !== 'manual') hideManualModalUI();
    if (st.modal !== 'pileFs') hidePileFsUI();

    if (st.modal === 'stashDetail' && st.itemId) {
      if (currentView !== 'stash') switchView('stash', true);
      openStashDetail(st.itemId, true);
    } else if (!st.modal) {
      hideStashDetailUI();
      switchView(st.view || 'scan', true);
    }
  });

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('openInMenu');
    const btn = document.getElementById('audioOpenInBtn');
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
      closeOpenInMenu();
    }
  });

  // ==================== MANUAL SEARCH & DIRECT DISCOGS ID MODAL ====================
  window.openManualModal = (focusTarget = 'search') => {
    if (activeFormat !== 'Auto') document.getElementById('fFormat').value = activeFormat;
    document.getElementById('manualModal').classList.remove('hidden');
    try { history.pushState({ view: currentView, modal: 'manual' }, ''); } catch (_) {}
    setTimeout(() => {
      const target = focusTarget === 'id' ? document.getElementById('fDirectId') : document.getElementById('fTitle');
      if (target) target.focus();
    }, 80);
  };

  window.closeManualModal = () => {
    hideManualModalUI();
    if (history.state?.modal === 'manual') {
      try { history.back(); } catch (_) {}
    }
  };

  window.submitManualDiscogsSearch = async () => {
    hideManualModalUI();
    if (history.state?.modal === 'manual') {
      try { history.replaceState({ view: currentView, modal: null }, ''); } catch (_) {}
    }
    await runDiscogsSearch();
  };

  window.submitUnlistedItem = async () => {
    hideManualModalUI();
    if (history.state?.modal === 'manual') {
      try { history.replaceState({ view: currentView, modal: null }, ''); } catch (_) {}
    }
    await inspectUnlistedItem();
  };

  // ==================== FULLSCREEN ZOOMABLE PHOTO LIGHTBOX ====================
  window.openLightbox = (photos, startIdx = 0) => {
    if (!Array.isArray(photos) || !photos.length) return;
    lbPhotos = photos;
    lbIdx = Math.max(0, Math.min(startIdx, photos.length - 1));
    renderLightboxFrame();
    document.getElementById('lightboxModal').classList.remove('hidden');
    try { history.pushState({ view: currentView, modal: 'lightbox', itemId: activeStashItem?.id || null }, ''); } catch (_) {}
  };

  function renderLightboxFrame() {
    const img = document.getElementById('lbImg');
    img.src = lbPhotos[lbIdx] || '';
    img.classList.remove('zoomed');
    document.getElementById('lbZoomBtn').textContent = '🔍 Zoom';
    document.getElementById('lbCounter').textContent = `${lbIdx + 1} / ${lbPhotos.length}`;
    document.getElementById('lbPrevBtn').disabled = lbIdx <= 0;
    document.getElementById('lbNextBtn').disabled = lbIdx >= lbPhotos.length - 1;
  }

  window.stepLightbox = (dir) => {
    const next = lbIdx + dir;
    if (next < 0 || next >= lbPhotos.length) return;
    lbIdx = next;
    renderLightboxFrame();
  };

  window.toggleLightboxZoom = () => {
    const img = document.getElementById('lbImg');
    const z = img.classList.toggle('zoomed');
    document.getElementById('lbZoomBtn').textContent = z ? '🔎 Fit' : '🔍 Zoom';
  };

  window.closeLightbox = () => {
    hideLightboxUI();
    if (history.state?.modal === 'lightbox') {
      try { history.back(); } catch (_) {}
    }
  };

  document.getElementById('lbImg').addEventListener('click', () => toggleLightboxZoom());
  document.getElementById('lbImgWrap').addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) lbTouchX = e.touches[0].clientX;
  }, { passive: true });
  document.getElementById('lbImgWrap').addEventListener('touchend', (e) => {
    if (document.getElementById('lbImg').classList.contains('zoomed')) return;
    const dx = (e.changedTouches?.[0]?.clientX || 0) - lbTouchX;
    if (Math.abs(dx) > 55) stepLightbox(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ==================== HIGH-RES MEMORY-SAFE IMAGE DECODING ====================
  function describeBlob(blob) {
    const name = blob?.name ? `"${blob.name}"` : 'captured photo';
    const mime = blob?.type || 'unknown MIME';
    const sizeMb = blob?.size ? `${(blob.size / (1024 * 1024)).toFixed(2)} MB` : '0 MB';
    return `${name} (${mime}, ${sizeMb})`;
  }

  function fitDims(w, h, maxDim) {
    let width = w, height = h;
    if (width > maxDim || height > maxDim) {
      if (width >= height) { height = Math.max(1, Math.round(height * (maxDim / width))); width = maxDim; }
      else { width = Math.max(1, Math.round(width * (maxDim / height))); height = maxDim; }
    }
    return { width, height };
  }

  function canvasToDataUrl(canvas, mime, quality) {
    const out = canvas.toDataURL(mime, quality);
    if (mime === 'image/webp' && !out.startsWith('data:image/webp')) {
      return canvas.toDataURL('image/jpeg', quality);
    }
    return out;
  }

  function renderSourceToDataUrl(srcEl, w, h, maxDim, mime, quality) {
    const { width, height } = fitDims(w, h, maxDim);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcEl, 0, 0, width, height);
    return canvasToDataUrl(c, mime, quality);
  }

  async function decodeViaImageBitmap(blob, opts) {
    const { aiMaxDim, aiQuality, saveMaxDim, saveQuality } = opts;
    let probe = null;
    try {
      probe = await createImageBitmap(blob);
    } catch (_) {
      // High-MP (e.g. 24MP–61MP Sony) fallback: resize directly during decode to avoid OOM
      probe = await createImageBitmap(blob, { resizeWidth: aiMaxDim, resizeQuality: 'high' });
    }

    try {
      const srcW = probe.width;
      const srcH = probe.height;
      const aiDims = fitDims(srcW, srcH, aiMaxDim);
      const saveDims = fitDims(srcW, srcH, saveMaxDim);

      let apiDataUrl = '';
      if (aiDims.width < srcW || aiDims.height < srcH) {
        const aiBmp = await createImageBitmap(probe, {
          resizeWidth: aiDims.width,
          resizeHeight: aiDims.height,
          resizeQuality: 'high'
        });
        try {
          apiDataUrl = renderSourceToDataUrl(aiBmp, aiBmp.width, aiBmp.height, aiMaxDim, 'image/jpeg', aiQuality);
        } finally {
          if (typeof aiBmp.close === 'function') aiBmp.close();
        }
      } else {
        apiDataUrl = renderSourceToDataUrl(probe, srcW, srcH, aiMaxDim, 'image/jpeg', aiQuality);
      }

      let saveWebp = '';
      if (saveDims.width < srcW || saveDims.height < srcH) {
        const saveBmp = await createImageBitmap(probe, {
          resizeWidth: saveDims.width,
          resizeHeight: saveDims.height,
          resizeQuality: 'high'
        });
        try {
          saveWebp = renderSourceToDataUrl(saveBmp, saveBmp.width, saveBmp.height, saveMaxDim, 'image/webp', saveQuality);
        } finally {
          if (typeof saveBmp.close === 'function') saveBmp.close();
        }
      } else {
        saveWebp = renderSourceToDataUrl(probe, srcW, srcH, saveMaxDim, 'image/webp', saveQuality);
      }

      return { apiB64: apiDataUrl.split(',')[1], saveWebp };
    } finally {
      if (probe && typeof probe.close === 'function') probe.close();
    }
  }

  function decodeViaImgElement(blob, opts) {
    const { aiMaxDim, aiQuality, saveMaxDim, saveQuality } = opts;
    const meta = describeBlob(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) {
            reject(new Error(`Image decoded with empty dimensions for ${meta}.`));
            return;
          }
          const apiDataUrl = renderSourceToDataUrl(img, w, h, aiMaxDim, 'image/jpeg', aiQuality);
          const saveWebp = renderSourceToDataUrl(img, w, h, saveMaxDim, 'image/webp', saveQuality);
          resolve({ apiB64: apiDataUrl.split(',')[1], saveWebp });
        } catch (err) {
          reject(new Error(`Failed to render ${meta}: ${err?.message || 'Canvas memory limit exceeded'}`));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Browser could not decode ${meta}. Please use a standard JPEG or PNG file.`));
      };
      img.src = url;
    });
  }

  async function decodeBlobToPhotoPair(blob, customOpts = {}) {
    if (!blob) throw new Error('No image file provided.');
    const meta = describeBlob(blob);
    const fname = String(blob.name || '');
    const mime = String(blob.type || '');

    if (RAW_EXT_RX.test(fname) || RAW_MIME_RX.test(mime)) {
      throw new Error(`Unsupported camera RAW file ${meta}. Please shoot or export as JPEG/PNG.`);
    }

    const opts = Object.assign({
      aiMaxDim: 2048,
      aiQuality: 0.90,
      saveMaxDim: 1200,
      saveQuality: 0.80
    }, customOpts);

    if (typeof window.createImageBitmap === 'function') {
      try {
        return await decodeViaImageBitmap(blob, opts);
      } catch (_) {
        // Graceful fallback to Image() element
      }
    }
    return await decodeViaImgElement(blob, opts);
  }

  // ==================== CONTINUOUS 2-SHOT & PILE FULL-RES CAMERA VIEWFINDER ====================
  function updateCameraOverlayUI() {
    const badge = document.getElementById('camStepBadge');
    const thumbsEl = document.getElementById('camThumbs');
    const finishBtn = document.getElementById('camFinishBtn');
    const upcBadge = document.getElementById('camUpcBadge');

    if (camMode === 'pile') {
      const fmtNote = activeFormat === 'Auto' ? 'All Formats' : `${activeFormat} Only`;
      badge.textContent = `📚 Pile / Shelf Shot (${fmtNote})`;
      badge.className = 'badge badge-purple';
      thumbsEl.classList.add('hidden');
      finishBtn.textContent = 'Cancel';
      finishBtn.className = 'btn btn-secondary btn-sm';
      upcBadge.classList.add('hidden');
      return;
    }

    const n = stagedPhotos.length;
    thumbsEl.classList.remove('hidden');
    if (n === 0) { badge.textContent = 'Shot 1: Front / Side A'; badge.className = 'badge badge-blue'; }
    else if (n === 1) { badge.textContent = 'Shot 2: Flip for Back / Side B'; badge.className = 'badge badge-purple'; }
    else { badge.textContent = `Shot ${n + 1} (Optional · ${n}/4 taken)`; badge.className = 'badge badge-green'; }

    finishBtn.className = n > 0 ? 'btn btn-green btn-sm' : 'btn btn-secondary btn-sm';
    finishBtn.innerHTML = `🔍 Finish &amp; Search (<span id="camCountLbl">${n}</span>)`;
    thumbsEl.innerHTML = stagedPhotos.map(p => `<img src="${p.saveWebp}" />`).join('');

    if (stagedUpc) {
      upcBadge.textContent = `║▌ UPC Locked: ${stagedUpc}`;
      upcBadge.classList.remove('hidden');
    } else upcBadge.classList.add('hidden');
  }

  async function openHighResCameraStream() {
    const attempts = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 }, focusMode: { ideal: 'continuous' } }, audio: false },
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false }
    ];
    let lastErr = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Camera unavailable');
  }

  async function tapCameraToFocus(ev) {
    const track = camStream?.getVideoTracks?.()[0];
    const stage = document.getElementById('camStage');
    const ring = document.getElementById('camFocusRing');
    if (!track || !stage || !ring) return;

    const rect = stage.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    const nx = Math.max(0, Math.min(1, cx / Math.max(1, rect.width)));
    const ny = Math.max(0, Math.min(1, cy / Math.max(1, rect.height)));

    ring.style.left = `${cx}px`;
    ring.style.top = `${cy}px`;
    ring.classList.remove('show');
    void ring.offsetWidth;
    ring.classList.add('show');
    clearTimeout(camFocusTimer);
    camFocusTimer = setTimeout(() => ring.classList.remove('show'), 950);

    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const adv = {};
      if (caps.pointsOfInterest) adv.pointsOfInterest = [{ x: nx, y: ny }];
      if (Array.isArray(caps.focusMode)) {
        if (caps.focusMode.includes('single-shot')) adv.focusMode = 'single-shot';
        else if (caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
      }
      if (Object.keys(adv).length) {
        await track.applyConstraints({ advanced: [adv] });
        if (adv.focusMode === 'single-shot' && caps.focusMode.includes('continuous')) {
          setTimeout(() => {
            if (camStream) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
          }, 1600);
        }
      }
    } catch (_) {}
  }

  window.openCameraViewfinder = async (mode = 'single') => {
    camMode = mode === 'pile' ? 'pile' : 'single';
    if (!navigator.mediaDevices?.getUserMedia) {
      document.getElementById(camMode === 'pile' ? 'pileCamInput' : 'nativeCamInput').click();
      return;
    }
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('camVideo');
    modal.classList.remove('hidden');
    updateCameraOverlayUI();

    try {
      camStream = await openHighResCameraStream();
      video.srcObject = camStream;
      await video.play();
      try { history.pushState({ view: currentView, modal: 'camera' }, ''); } catch (_) {}

      const track = camStream.getVideoTracks()[0];
      const caps = track?.getCapabilities ? track.getCapabilities() : {};
      document.getElementById('camTorchBtn').style.visibility = caps.torch ? 'visible' : 'hidden';

      if (track && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }

      camImageCapture = null;
      if ('ImageCapture' in window && track) {
        try { camImageCapture = new window.ImageCapture(track); } catch (_) { camImageCapture = null; }
      }

      if (camMode === 'single' && 'BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128'] });
        let lastCheck = 0;
        const detectLoop = async (ts) => {
          if (!camStream || camMode !== 'single') return;
          if (!stagedUpc && ts - lastCheck > 450 && video.readyState >= 2) {
            lastCheck = ts;
            try {
              const codes = await detector.detect(video);
              const raw = codes?.[0]?.rawValue?.replace(/\D/g, '') || '';
              if (raw.length >= 8) {
                stagedUpc = raw;
                document.getElementById('fBarcode').value = raw;
                playChime();
                updateCameraOverlayUI();
                updateStageUI();
              }
            } catch (_) {}
          }
          camUpcRaf = requestAnimationFrame(detectLoop);
        };
        camUpcRaf = requestAnimationFrame(detectLoop);
      }
    } catch (_) {
      hideCameraUI();
      toast('In-app camera unavailable — opening phone camera');
      document.getElementById(camMode === 'pile' ? 'pileCamInput' : 'nativeCamInput').click();
    }
  };

  window.toggleCamTorch = async () => {
    const track = camStream?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      camTorchOn = !camTorchOn;
      await track.applyConstraints({ advanced: [{ torch: camTorchOn }] });
      document.getElementById('camTorchBtn').textContent = camTorchOn ? '💡' : '🔦';
    } catch (_) {}
  };

  window.captureViewfinderShot = async () => {
    if (camCapturing) return;
    if (camMode === 'single' && stagedPhotos.length >= 4) { toast('Max 4 photos reached — tap Finish & Search'); return; }
    const video = document.getElementById('camVideo');
    if (!video.videoWidth && !camImageCapture) return;

    camCapturing = true;
    const shutterBtn = document.getElementById('camShutterBtn');
    if (shutterBtn) shutterBtn.disabled = true;

    const flash = document.getElementById('camFlash');
    flash.classList.add('flash');
    setTimeout(() => flash.classList.remove('flash'), 160);

    const decodeOpts = camMode === 'pile'
      ? { aiMaxDim: 3072, aiQuality: 0.92, saveMaxDim: 2048, saveQuality: 0.82 }
      : { aiMaxDim: 2048, aiQuality: 0.90, saveMaxDim: 1200, saveQuality: 0.80 };

    try {
      let pair = null;
      if (camImageCapture && typeof camImageCapture.takePhoto === 'function') {
        try {
          const photoBlob = await camImageCapture.takePhoto();
          if (photoBlob && photoBlob.size > 0) {
            pair = await decodeBlobToPhotoPair(photoBlob, decodeOpts);
          }
        } catch (_) {
          pair = null;
        }
      }

      if (!pair && video.videoWidth) {
        const apiDataUrl = renderSourceToDataUrl(video, video.videoWidth, video.videoHeight, decodeOpts.aiMaxDim, 'image/jpeg', decodeOpts.aiQuality);
        const saveWebp = renderSourceToDataUrl(video, video.videoWidth, video.videoHeight, decodeOpts.saveMaxDim, 'image/webp', decodeOpts.saveQuality);
        pair = { apiB64: apiDataUrl.split(',')[1], saveWebp };
      }

      if (pair) {
        if (camMode === 'pile') {
          closeCameraViewfinder();
          applyLoadedPilePhoto(pair, true);
        } else {
          stagedPhotos.push(pair);
          updateStageUI();
          updateCameraOverlayUI();
          if (stagedPhotos.length === 1) toast('Front / Side A captured! Flip for Back / Side B');
          else if (stagedPhotos.length === 2) toast('Back / Side B captured! Tap 🔍 Finish & Search');
        }
      }
    } catch (err) {
      toast('Capture failed: ' + (err?.message || 'Unknown camera error'), 4200);
    } finally {
      camCapturing = false;
      if (shutterBtn) shutterBtn.disabled = false;
    }
  };

  window.closeCameraViewfinder = () => {
    hideCameraUI();
    if (history.state?.modal === 'camera') {
      try { history.back(); } catch (_) {}
    }
  };

  window.finishCameraAndSearch = () => {
    const modeNow = camMode;
    const hasShots = stagedPhotos.length > 0;
    hideCameraUI();
    if (history.state?.modal === 'camera') {
      try { history.replaceState({ view: currentView, modal: null }, ''); } catch (_) {}
    }
    if (modeNow === 'single' && hasShots) {
      runFullScan();
    }
  };

  window.fallbackToNativeCam = () => {
    const targetId = camMode === 'pile' ? 'pileCamInput' : 'nativeCamInput';
    closeCameraViewfinder();
    document.getElementById(targetId).click();
  };

  async function stagePhotoFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setStatus(`Processing ${files.length} photo(s) at 2048px AI / 1200px WebP...`, true);
    try {
      for (const file of files) {
        if (stagedPhotos.length >= 4) { toast('Max 4 photos per scan'); break; }
        const pair = await decodeBlobToPhotoPair(file, { aiMaxDim: 2048, aiQuality: 0.90, saveMaxDim: 1200, saveQuality: 0.80 });
        stagedPhotos.push(pair);
      }
      updateStageUI();
      setStatus('', false);
      toast(`${stagedPhotos.length} photo(s) ready — tap Search & Verify`);
    } catch (err) {
      setStatus('', false);
      toast('Photo error: ' + (err?.message || 'Could not read image'), 5000);
    }
  }

  window.removeStagedPhoto = (idx, ev) => {
    if (ev) ev.stopPropagation();
    stagedPhotos.splice(idx, 1);
    updateStageUI();
  };

  window.clearStagedUpc = () => {
    stagedUpc = '';
    document.getElementById('fBarcode').value = '';
    updateStageUI();
  };

  window.updateStageUI = () => {
    const manualReady = Boolean(
      document.getElementById('fTitle').value.trim() ||
      document.getElementById('fArtist').value.trim() ||
      document.getElementById('fCatno').value.trim() ||
      document.getElementById('fBarcode').value.trim()
    );
    const hasAnything = stagedPhotos.length > 0 || Boolean(stagedUpc) || manualReady;

    document.getElementById('singleActionRow').classList.toggle('hidden', !hasAnything && !currentInspected);
    document.getElementById('btnRunSearch').disabled = !hasAnything;
    document.getElementById('btnClearStage').classList.toggle('hidden', !hasAnything && !currentInspected);

    const box = document.getElementById('stagedSummary');
    box.classList.toggle('hidden', stagedPhotos.length === 0 && !stagedUpc);

    const upcRow = document.getElementById('stagedUpcRow');
    if (stagedUpc) {
      upcRow.classList.remove('hidden');
      upcRow.innerHTML = `<span class="upc-pill">║▌ UPC: ${esc(stagedUpc)} <button onclick="clearStagedUpc()" title="Remove UPC">×</button></span>`;
    } else {
      upcRow.classList.add('hidden');
      upcRow.innerHTML = '';
    }

    const tags = ['Front / A', 'Back / B', 'Photo 3', 'Photo 4'];
    document.getElementById('previewStrip').innerHTML = stagedPhotos.map((p, i) => `
      <div class="preview-item" onclick="openStagedLightbox(${i})">
        <img src="${p.saveWebp}" />
        <span class="preview-tag">${tags[i] || `Photo ${i + 1}`}</span>
        <button class="preview-remove" onclick="removeStagedPhoto(${i}, event)" title="Remove">×</button>
      </div>
    `).join('');
  };

  window.openStagedLightbox = (idx) => openLightbox(stagedPhotos.map(p => p.saveWebp), idx);

  // ==================== CONTINUOUS VOICE RE-GRADE (MANUAL STOP ONLY) ====================
  window.voiceRegrade = (source, btnId) => {
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); return; }
    const btn = document.getElementById(btnId);
    const liveId = source === 'stash' ? 'voiceLiveStash' : 'voiceLiveScan';
    const liveEl = document.getElementById(liveId);

    if (voiceWantListening && voiceContext?.btnId === btnId) {
      voiceWantListening = false;
      try { activeRecognition?.stop(); } catch (_) {}
      activeRecognition = null;
      const fullMemo = `${voiceTranscriptFinal} ${voiceTranscriptInterim}`.trim();
      if (liveEl) { liveEl.classList.add('hidden'); liveEl.textContent = ''; }
      if (fullMemo) regradeWithAI(source, fullMemo, btnId);
      else {
        if (btn) { btn.classList.remove('listening'); btn.textContent = VOICE_BTN_IDLE; }
        toast('No speech heard — try again');
      }
      return;
    }

    if (pendingVoiceRetry && pendingVoiceRetry.source === source && pendingVoiceRetry.btnId === btnId) {
      const saved = pendingVoiceRetry;
      pendingVoiceRetry = null;
      regradeWithAI(saved.source, saved.spoken, saved.btnId);
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice recognition requires Chrome on Android!', 3800); return; }

    voiceWantListening = true;
    voiceTranscriptFinal = '';
    voiceTranscriptInterim = '';
    voiceContext = { source, btnId, liveId };

    if (!audioEl.paused) audioEl.pause();
    if (btn) { btn.classList.add('listening'); btn.textContent = '⏹️ Listening — Tap to Stop & Re-Grade'; }
    if (liveEl) { liveEl.classList.remove('hidden'); liveEl.textContent = '🎤 Speak all flaws at your own pace (won’t cut you off)...'; }

    const startRec = () => {
      if (!voiceWantListening) return;
      const rec = new SR();
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      activeRecognition = rec;

      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const txt = e.results[i][0].transcript;
          if (e.results[i].isFinal) voiceTranscriptFinal += (voiceTranscriptFinal ? ' ' : '') + txt.trim();
          else interim += txt;
        }
        voiceTranscriptInterim = interim.trim();
        const combined = `${voiceTranscriptFinal} ${voiceTranscriptInterim}`.trim();
        if (liveEl && combined) liveEl.textContent = `🎤 "${combined}"`;
      };

      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          voiceWantListening = false;
          if (btn) { btn.classList.remove('listening'); btn.textContent = VOICE_BTN_IDLE; }
          if (liveEl) liveEl.classList.add('hidden');
          toast('Mic permission denied');
        }
      };

      rec.onend = () => {
        if (voiceWantListening) {
          if (voiceTranscriptInterim) {
            voiceTranscriptFinal += (voiceTranscriptFinal ? ' ' : '') + voiceTranscriptInterim;
            voiceTranscriptInterim = '';
          }
          setTimeout(() => { if (voiceWantListening) startRec(); }, 180);
        }
      };

      try { rec.start(); } catch (_) {}
    };
    startRec();
  };

  async function regradeWithAI(source, spokenDescription, btnId) {
    const isStash = source === 'stash';
    const item = isStash ? activeStashItem : currentInspected;
    if (!item) return;

    const mediaEl = document.getElementById(isStash ? 'sdMediaCond' : 'gMediaCond');
    const sleeveEl = document.getElementById(isStash ? 'sdSleeveCond' : 'gSleeveCond');
    const notesEl = document.getElementById(isStash ? 'sdNotes' : 'gNotes');
    const btn = document.getElementById(btnId);

    const priorNote = (notesEl?.value || '').trim();
    if (btn) {
      btn.classList.remove('listening');
      btn.disabled = true;
      btn.textContent = '⏳ Re-checking photos & re-grading...';
    }
    setStatus(`Re-grading via ${aiEngineLabel()}...`, true, { cancellable: true });

    const prompt = `You are a strict, conservative Discogs/Goldmine seller grading assistant.
The seller just described the item's flaws out loud in plain English.
Re-examine the attached photo(s) closely using what they told you, TRUST their physical and playback observations completely, pick the exact conservative Discogs Media Condition and Sleeve Condition grades for them, and rewrite their observations into a clean, concise, buyer-ready Discogs condition report.

Item: "${item.artist} - ${item.title}" (${item.format || 'Cassette'})
Previous grades: Media="${mediaEl?.value || ''}", Sleeve="${sleeveEl?.value || ''}"
Previous note: "${priorNote || 'None'}"
Seller's voice description: "${spokenDescription}"

STRICT DISCOGS GOLDMINE RULES:
- Media Condition MUST be one of: ${JSON.stringify(MEDIA_GRADES)}
  * "Mint (M)" ONLY if sealed. "Near Mint (NM or M-)" = spotless, zero visible flaws.
  * "Very Good Plus (VG+)" = very clean, only tiny handling scuffs, crisp flat label.
  * "Very Good (VG)" = noticeable scratches/scuffs, light label wear/fading, plays fine.
  * "Good Plus (G+)" = heavy scratches/scuffing, peeling/warped/stained label, writing, or noticeable playback flaws.
  * "Good (G)" / "Fair (F)" / "Poor (P)" = cracked shell, missing felt pressure pad, mangled tape, heavy playback defects, torn label.
- Sleeve Condition MUST be one of: ${JSON.stringify(SLEEVE_GRADES)}
  * Loose with no case/cover = "No Cover". Blank replacement = "Generic".
  * "Very Good Plus (VG+)" = clean insert, minimal edge wear, no case cracks.
  * "Very Good (VG)" = creases, sticker residue, moderate case scuffs/small crack.
  * "Good Plus (G+)" = paint/ink/water stains, heavy creases, ripped flap, heavily scratched/cracked case.
  * "Good (G)" / "Fair (F)" / "Poor (P)" = severe stains obscuring art, torn/missing pieces, heavy water/mold damage.
- CONSERVATIVE RULE: When between two grades, ALWAYS choose the LOWER grade. NEVER use the word "mint" unless factory sealed.

Return ONLY valid JSON:
{
  "media_condition": "exact Discogs media grade from list",
  "sleeve_condition": "exact Discogs sleeve grade from list",
  "polished_note": "clean, factual, buyer-ready Discogs listing note incorporating every flaw reported by the seller and visible in photos (1-3 short sentences, no fluff)"
}`;

    const parts = [{ text: prompt }];
    if (!isStash && stagedPhotos.length) {
      stagedPhotos.forEach(p => parts.push({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }));
    } else if (isStash) {
      const thumbs = (Array.isArray(item.thumbs) && item.thumbs.length) ? item.thumbs : (item.thumb_data_url ? [item.thumb_data_url] : []);
      thumbs.forEach(src => {
        const m = String(src || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
      });
    }

    try {
      const res = await CC.callAI(parts, 'MEDIUM', { retryLabel: 'Voice Re-Grade' });
      pendingVoiceRetry = null;
      const newMedia = normalizeGrade(res.media_condition, MEDIA_GRADES, mediaEl.value);
      const newSleeve = normalizeGrade(res.sleeve_condition, SLEEVE_GRADES, sleeveEl.value);
      mediaEl.value = newMedia;
      sleeveEl.value = newSleeve;
      if (res.polished_note) notesEl.value = res.polished_note.trim();

      item.media_condition = newMedia;
      item.sleeve_condition = newSleeve;
      item.condition_note = notesEl.value.trim();

      if (!isStash && currentExtracted) {
        currentExtracted.media_condition = newMedia;
        currentExtracted.sleeve_condition = newSleeve;
        currentExtracted.condition_note = item.condition_note;
      }

      const hint = !isStash ? document.getElementById('aiGradeHint') : null;
      if (hint) hint.textContent = '✅ Voice Re-Graded';
      setStatus('', false);
      toast(`✅ Re-graded: ${shortGrade(newMedia)} / ${shortGrade(newSleeve)}`, 3400);
      if (btn) { btn.disabled = false; btn.textContent = VOICE_BTN_IDLE; }
    } catch (err) {
      setStatus('', false);
      pendingVoiceRetry = { source, spoken: spokenDescription, btnId };
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔄 Saved Your Memo — Tap to Retry Re-Grade';
      }
      if (err.name !== 'AbortError') toast('Re-grade error: ' + err.message, 4200);
    }
  }

  // ==================== FLOATING 30s AUDIO MINI-PLAYER ====================
  const audioEl = document.getElementById('previewAudio');

  function updateAudioMarquee(text) {
    const titleEl = document.getElementById('audioTitle');
    const wrap = document.getElementById('audioMarqueeWrap');
    titleEl.classList.remove('scrolling');
    titleEl.textContent = text;
    requestAnimationFrame(() => {
      const overflow = titleEl.scrollWidth - wrap.clientWidth;
      if (overflow > 6) {
        titleEl.style.setProperty('--marquee-dist', `${overflow + 18}px`);
        titleEl.style.setProperty('--marquee-dur', `${Math.max(7, Math.min(20, overflow / 24 + 5))}s`);
        titleEl.classList.add('scrolling');
      }
    });
  }

  function unlockAudioForAutoplay(force = false) {
    if (!force && !cfg.autoPlayHighlight) return;
    try {
      audioEl.muted = true;
      audioEl.src = SILENT_WAV;
      const p = audioEl.play();
      if (p && p.then) {
        p.then(() => {
          if (audioEl.src === SILENT_WAV) { audioEl.pause(); audioEl.currentTime = 0; }
          audioEl.muted = false;
        }).catch(() => { audioEl.muted = false; });
      } else audioEl.muted = false;
    } catch (_) { audioEl.muted = false; }
  }

  window.stopHighlightAudio = () => {
    clipReqId++;
    closeOpenInMenu();
    try { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } catch (_) {}
    activeClipKey = '';
    activePlatforms = null;
    activeFallbackClip = null;
    document.getElementById('audioBar').classList.add('hidden');
    document.body.classList.remove('has-audio');
    document.getElementById('audioProgress').style.width = '0%';
    document.getElementById('audioPlayBtn').textContent = '▶';
  };

  window.toggleHighlightAudio = () => {
    if ((!audioEl.src || audioEl.src === SILENT_WAV) && activeFallbackClip?.previewUrl) {
      useFallbackClip();
      return;
    }
    if (!audioEl.src || audioEl.src === SILENT_WAV) return;
    audioEl.muted = false;
    if (audioEl.paused) audioEl.play().catch(() => toast('Tap ▶ again to start audio'));
    else audioEl.pause();
  };

  window.useFallbackClip = () => {
    if (!activeFallbackClip?.previewUrl) return;
    const c = activeFallbackClip;
    updateAudioMarquee(`🎵 ${c.trackName} — ${c.artistName} (closest available stream)`);
    audioEl.muted = false;
    audioEl.src = c.previewUrl;
    audioEl.load();
    audioEl.currentTime = 0;
    audioEl.play().catch(() => {});
  };

  window.toggleOpenInMenu = () => {
    const menu = document.getElementById('openInMenu');
    const btn = document.getElementById('audioOpenInBtn');
    if (!menu.classList.contains('hidden')) { closeOpenInMenu(); return; }
    if (!activePlatforms) { toast('Still checking platform links...'); return; }

    const rows = [];
    if (cfg.showSpotify && activePlatforms.spotify) {
      rows.push(`<a class="open-in-link" target="_blank" rel="noopener" onclick="closeOpenInMenu()" href="${esc(activePlatforms.spotify.url)}"><span>🟢 ${esc(activePlatforms.spotify.label)}</span><span>↗</span></a>`);
    }
    if (cfg.showApple && activePlatforms.apple) {
      rows.push(`<a class="open-in-link" target="_blank" rel="noopener" onclick="closeOpenInMenu()" href="${esc(activePlatforms.apple.url)}"><span>🍎 ${esc(activePlatforms.apple.label)}</span><span>↗</span></a>`);
    }
    if (cfg.showDeezer && activePlatforms.deezer) {
      rows.push(`<a class="open-in-link" target="_blank" rel="noopener" onclick="closeOpenInMenu()" href="${esc(activePlatforms.deezer.url)}"><span>💜 ${esc(activePlatforms.deezer.label)}</span><span>↗</span></a>`);
    }
    if (cfg.showYoutube && activePlatforms.youtube) {
      rows.push(`<a class="open-in-link" target="_blank" rel="noopener" onclick="closeOpenInMenu()" href="${esc(activePlatforms.youtube.url)}"><span>🔴 ${esc(activePlatforms.youtube.label)}</span><span>↗</span></a>`);
    }

    menu.innerHTML = `<div class="open-in-header">Open Track In</div>` +
      (rows.length ? rows.join('') : `<div style="padding:8px; font-size:0.8rem; color:var(--muted);">Enable platforms in Settings → Music Services.</div>`);
    menu.classList.remove('hidden');
    btn.classList.add('open');
  };

  audioEl.addEventListener('play', () => { if (audioEl.src !== SILENT_WAV) document.getElementById('audioPlayBtn').textContent = '⏸'; });
  audioEl.addEventListener('pause', () => { document.getElementById('audioPlayBtn').textContent = '▶'; });
  audioEl.addEventListener('ended', () => {
    document.getElementById('audioPlayBtn').textContent = '▶';
    document.getElementById('audioProgress').style.width = '0%';
  });
  audioEl.addEventListener('timeupdate', () => {
    if (audioEl.src !== SILENT_WAV && audioEl.duration && isFinite(audioEl.duration)) {
      document.getElementById('audioProgress').style.width = `${Math.min(100, (audioEl.currentTime / audioEl.duration) * 100)}%`;
    }
  });

  async function loadHighlightClip(artist, track, album, myRunId, opts = {}) {
    const { forceReplace = true, forcePlay = cfg.autoPlayHighlight, strictTrack = true, notifyUser = false, ignoreRunId = false } = opts;
    if (!artist && !track && !album) return;

    const key = normFull(`${artist}|${track || album}`);
    if (key === activeClipKey && audioEl.src && audioEl.src !== SILENT_WAV) {
      if (forcePlay) {
        audioEl.muted = false;
        audioEl.currentTime = 0;
        audioEl.play().catch(() => {});
        if (notifyUser) toast(`▶ Replaying: ${track || album}`);
      }
      return;
    }
    if (!forceReplace && activeClipKey && !audioEl.paused) return;

    const myClipReq = ++clipReqId;
    closeOpenInMenu();
    activeFallbackClip = null;
    activePlatforms = null;

    const bar = document.getElementById('audioBar');
    const labelTarget = track || album;
    bar.classList.remove('hidden');
    document.body.classList.add('has-audio');
    document.getElementById('audioPlayBtn').textContent = '…';
    document.getElementById('audioProgress').style.width = '0%';
    updateAudioMarquee(`Finding clip & platforms: ${labelTarget}...`);

    const res = await CC.fetchAudioAndPlatforms(artist, track, album, strictTrack);
    if ((!ignoreRunId && myRunId !== scanRunId) || myClipReq !== clipReqId) return;

    activePlatforms = res.platforms;

    if (res.clip) {
      activeClipKey = key;
      updateAudioMarquee(`🎵 ${res.clip.trackName} — ${res.clip.artistName}`);
      audioEl.muted = false;
      audioEl.src = res.clip.previewUrl;
      audioEl.load();
      audioEl.currentTime = 0;
      if (forcePlay) {
        audioEl.play().catch(() => {
          document.getElementById('audioPlayBtn').textContent = '▶';
          updateAudioMarquee(`Tap ▶ for 30s clip: ${res.clip.trackName} — ${res.clip.artistName}`);
        });
      } else document.getElementById('audioPlayBtn').textContent = '▶';
      return;
    }

    activeClipKey = '';
    try { audioEl.pause(); audioEl.removeAttribute('src'); } catch (_) {}
    if (res.fallbackClip) {
      activeFallbackClip = res.fallbackClip;
      document.getElementById('audioPlayBtn').textContent = '▶';
      updateAudioMarquee(`No exact stream for "${labelTarget}" — tap ▶ for closest (${res.fallbackClip.trackName}) or ▲`);
      if (notifyUser) toast(`Exact mix not on streaming — tap ▶ for closest or ▲ YouTube`, 3200);
    } else {
      document.getElementById('audioPlayBtn').textContent = '—';
      updateAudioMarquee(`No 30s stream for "${labelTarget}" — tap ▲ to search YouTube`);
      if (notifyUser) toast(`No 30s stream found — tap ▲ to open YouTube`, 3000);
    }
  }

  // ==================== DIRECT DISCOGS URL / ID LOADER ====================
  window.loadReleaseById = async (rawInput) => {
    const id = parseDiscogsId(rawInput);
    if (!id) { toast('Paste a valid Discogs release URL or numeric ID'); return; }
    if (!cfg.discogsToken) { toast('Add your Discogs Token in Settings first'); return; }

    hideManualModalUI();
    if (history.state?.modal === 'manual') {
      try { history.replaceState({ view: currentView, modal: null }, ''); } catch (_) {}
    }

    if (currentInspected) {
      if (!currentExtracted) currentExtracted = {};
      currentExtracted.media_condition = document.getElementById('gMediaCond')?.value || currentInspected.media_condition;
      currentExtracted.sleeve_condition = document.getElementById('gSleeveCond')?.value || currentInspected.sleeve_condition;
      currentExtracted.condition_note = document.getElementById('gNotes')?.value.trim() ?? currentInspected.condition_note;
    }

    const existingIdx = currentCandidates.findIndex(c => Number(c.id) === id);
    if (existingIdx !== -1) {
      detectivePickId = id;
      document.getElementById('fDirectId').value = '';
      await inspectCandidate(existingIdx, scanRunId, { isConservativeTiebreak: false });
      toast(`✅ Switched to Discogs #${id} (photos & grades kept)`);
      return;
    }

    setStatus(`Loading Discogs release #${id}...`, true);
    try {
      const rel = await CC.getReleaseCached(id);
      const artistStr = cleanDiscogsArtist(rel.artists);
      currentCandidates.unshift({
        id: rel.id,
        title: artistStr ? `${artistStr} - ${rel.title}` : rel.title,
        year: rel.year || '',
        country: rel.country || '',
        catno: rel.labels?.[0]?.catno || '',
        label: rel.labels?.[0]?.name ? [rel.labels[0].name] : [],
        format: (rel.formats || []).flatMap(f => [f.name, ...(f.descriptions || [])]),
        thumb: rel.thumb || '',
        community: rel.community || { have: 0, want: 0 },
        _tier: 'direct',
        _check: { sim: 1, catMatch: true, score: 2 }
      });
      detectivePickId = rel.id;
      document.getElementById('fDirectId').value = '';
      document.getElementById('detectiveCard').classList.add('hidden');
      await inspectCandidate(0, scanRunId, { isConservativeTiebreak: false });
      toast(`✅ Loaded Discogs #${id} (photos & grades kept)`);
    } catch (err) {
      setStatus('', false);
      toast(`Could not load #${id}: ${err.message}`, 4000);
    }
  };

  // ==================== SINGLE-ITEM SCAN & ZERO-GUESSING ENGINE ====================
  window.runFullScan = async () => {
    scanRunId++;
    const myRunId = scanRunId;
    stopHighlightAudio();
    unlockAudioForAutoplay(false);
    pendingVoiceRetry = null;

    document.getElementById('inspectorCard').classList.add('hidden');
    document.getElementById('detectiveCard').classList.add('hidden');
    document.getElementById('candidatesCard').classList.add('hidden');

    if (stagedPhotos.length > 0) {
      if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); switchView('settings'); return; }
      const ok = await runVisionOCR(myRunId);
      if (!ok || myRunId !== scanRunId) return;
    }

    await runDiscogsSearch(myRunId);
  };

  async function runVisionOCR(myRunId) {
    const keepOldGrades = Boolean(editingStashItem && !document.getElementById('chkRegradeEdit').checked);
    setStatus(`Inspecting ${stagedPhotos.length} photo(s) on ${aiEngineLabel()}...`, true, { cancellable: true });

    const fmtHint = activeFormat === 'Auto' ? 'Auto-detect Cassette, CD, or Vinyl' : `User selected format: ${activeFormat}`;
    const upcHint = stagedUpc ? `User also scanned UPC barcode: ${stagedUpc}.` : '';

    const prompt = `You are a meticulous physical music media OCR, Discogs pressing-ID, and strict Goldmine visual grading expert. Inspect ALL attached photos carefully. ${fmtHint}. ${upcHint}

PHOTO-SCOPE & LOOSE-MEDIA AWARENESS:
- The user ALWAYS photographs Front of Case + Side A together and Back of Case + Side B together.
- Look carefully at whether a case, J-card, jacket, or cover insert actually appears in the photos.
- If ONLY the bare cassette shell or bare disc is shown (no case, no J-card, no cover insert), treat it as LOOSE MEDIA: set "has_case_or_insert": false, set "sleeve_condition": "No Cover", and explicitly note in "physical_details" that this is loose media with no case/insert.

OCR RULES:
- Ignore non-catalog manufacturing/tax/standard codes (Dolby, HX Pro, TSE, TS-2240, KTB, JASRAC, GEMA, BIEM) for "raw_catalog_number".
- Read EVERY visible song title verbatim in "visible_tracks" so we can verify Discogs listings against the actual tape.
- Read exact physical shell/window/pressing clues: shell color, timing window markings (e.g. "100-50-0" vs "0-50-0" vs blank vs dots), plant codes (e.g. "SR", "AR", "CR"), screws vs welded, paper label vs direct print, club stamps ("CRC", "BMG"), country/address text, copyright years.

STRICT DISCOGS SELLER GRADING RULES (Be brutally honest and conservative — never over-grade!):
1. List every flaw first in "media_defects" and "sleeve_defects".
2. Media Condition MUST be one of: ${JSON.stringify(MEDIA_GRADES)}
   * "Mint (M)" ONLY if factory sealed. "Near Mint (NM or M-)" = spotless, zero visible wear.
   * "Very Good Plus (VG+)" = very clean, only tiny handling scuffs, crisp flat label.
   * "Very Good (VG)" = visible scuffs/scratches, light label wear or fading.
   * "Good Plus (G+)" = heavy scratches/scuffing, peeling/warped/bubbling/stained label, writing/yellowing.
   * "Good (G)" / "Fair (F)" / "Poor (P)" = cracked shell, missing felt pad, torn label, deep gouges.
3. Sleeve Condition MUST be one of: ${JSON.stringify(SLEEVE_GRADES)}
   * No case/cover shown = "No Cover". Plain blank = "Generic".
   * "Very Good Plus (VG+)" = clean insert, minimal edge wear, no case cracks.
   * "Very Good (VG)" = creases, sticker residue, moderate case scuffs or small crack.
   * "Good Plus (G+)" = paint/ink/water stains, heavy creases, ripped flap, heavily scratched/cracked case.
   * "Good (G)" / "Fair (F)" / "Poor (P)" = severe stains obscuring art, torn/missing pieces, heavy water damage.
4. When between two grades, ALWAYS pick the LOWER grade. NEVER say "mint" in "condition_note" unless sealed.

Return ONLY valid JSON:
{
  "detected_format": "Cassette" | "CD" | "Vinyl",
  "has_case_or_insert": true | false,
  "raw_catalog_number": "exact record-label catalog code or empty string",
  "cleaned_catalog_variants": ["catalog variations stripping hyphens/spaces/price prefixes"],
  "barcode": "digits only UPC/EAN if visible, else empty string",
  "album_title": "album or release title",
  "artists": ["main artist name(s), or 'Various' if a compilation"],
  "label": "record label name or empty string",
  "year": "4-digit copyright/release year printed, else empty string",
  "country_clues": "country printed (e.g. 'Printed in U.S.A.', 'Turkey') or 'Not visible'",
  "club_edition": "None" | "CRC" | "BMG" | "Unknown",
  "physical_details": "detailed plain-English list of EVERY visible physical pressing identifier (mention if loose media with no case/insert; shell color, window markings like 100-50-0 vs 0-50-0, plant codes like SR/AR, paper label vs direct print, barcode presence, promo stamps)",
  "media_defects": ["list every flaw on cassette/disc, or empty array if spotless"],
  "sleeve_defects": ["list every flaw on case/insert, or empty array if spotless or no cover"],
  "media_condition": "exact Discogs media grade",
  "sleeve_condition": "exact Discogs sleeve grade",
  "condition_note": "blunt factual seller note listing visible flaws (NEVER say 'mint' unless sealed)",
  "visible_tracks": ["every song title clearly visible on shell/insert"]
}`;

    const parts = [{ text: prompt }, ...stagedPhotos.map(p => ({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }))];

    try {
      const ext = await CC.callAI(parts, 'MEDIUM', { retryLabel: 'Photo Vision' });
      if (myRunId !== scanRunId) return false;

      if (keepOldGrades && editingStashItem) {
        ext.media_condition = editingStashItem.media_condition;
        ext.sleeve_condition = editingStashItem.sleeve_condition;
        ext.condition_note = editingStashItem.condition_note;
      }

      currentExtracted = ext;
      if (activeFormat !== 'Auto') ext.detected_format = activeFormat;

      document.getElementById('fTitle').value = ext.album_title || '';
      document.getElementById('fArtist').value = Array.isArray(ext.artists) ? ext.artists.join(', ') : (ext.artists || '');
      document.getElementById('fCatno').value = ext.raw_catalog_number || '';
      document.getElementById('fBarcode').value = stagedUpc || (ext.barcode || '').replace(/\D/g, '');
      document.getElementById('fFormat').value = ['Cassette', 'CD', 'Vinyl'].includes(ext.detected_format) ? ext.detected_format : 'Cassette';
      document.getElementById('fLabel').value = ext.label || '';
      document.getElementById('fYear').value = ext.year || '';

      const clues = [
        ext.has_case_or_insert === false ? 'Loose media (no case/insert)' : '',
        ext.country_clues && ext.country_clues !== 'Not visible' ? `Country: ${ext.country_clues}` : '',
        ext.club_edition && ext.club_edition !== 'Unknown' ? `Club: ${ext.club_edition}` : '',
        ext.physical_details ? `Clues: ${ext.physical_details}` : ''
      ].filter(Boolean).join(' · ');
      document.getElementById('detectedCluesLine').textContent = clues;

      speakText(`${ext.artists?.[0] || ''} ${ext.album_title || ''}`);
      return true;
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast('AI Vision error: ' + err.message, 4500);
      return false;
    }
  }

  function inferCountry(clues) {
    const c = String(clues || '').toLowerCase();
    if (!c || c === 'not visible') return '';
    if (c.includes('u.s.a') || c.includes('usa') || c.includes('united states') || c.includes('universal city') || c.includes('new york') || c.includes('los angeles')) return 'US';
    if (c.includes('canada')) return 'Canada';
    if (c.includes('uk') || c.includes('england') || c.includes('united kingdom')) return 'UK';
    if (c.includes('germany')) return 'Germany';
    if (c.includes('japan')) return 'Japan';
    if (c.includes('europe')) return 'Europe';
    if (c.includes('turkey') || c.includes('türkiye') || c.includes('istanbul')) return 'Turkey';
    return '';
  }

  window.runDiscogsSearch = async (myRunId = scanRunId) => {
    if (!cfg.discogsToken) { setStatus('', false); toast('Add your Discogs Token in Settings'); return; }

    const title = document.getElementById('fTitle').value.trim();
    const artist = document.getElementById('fArtist').value.trim();
    const catno = document.getElementById('fCatno').value.trim();
    const barcode = document.getElementById('fBarcode').value.replace(/\D/g, '').trim();
    const format = activeFormat !== 'Auto' ? activeFormat : document.getElementById('fFormat').value;
    const label = document.getElementById('fLabel').value.trim();
    const year = document.getElementById('fYear').value.trim();

    if (!title && !artist && !catno && !barcode) { toast('Add photos, UPC, or title first'); return; }

    document.getElementById('inspectorCard').classList.add('hidden');
    document.getElementById('detectiveCard').classList.add('hidden');
    document.getElementById('candidatesCard').classList.add('hidden');
    detectiveDiffs = {};
    detectivePickId = null;
    detectiveEliminatedIds = new Set();
    detectiveInspectedCount = 0;
    visibleCandidateIds = null;
    setStatus('Sweeping Discogs (up to 100 pressings per search)...', true);

    const pool = new Map();
    const add = (res, tier) => (res?.results || []).forEach(it => { if (!pool.has(it.id)) pool.set(it.id, { ...it, _tier: tier }); });

    const photoCountry = inferCountry(currentExtracted?.country_clues);
    const prefCountry = photoCountry || cfg.homeCountry || '';
    const clubDetected = currentExtracted?.club_edition || 'Unknown';

    const scoreItem = (it) => {
      const targetStr = `${artist} ${title}`.trim();
      const sim = targetStr ? similarity(targetStr, it.title || '') : 0.7;
      const itemCat = norm(it.catno || '').replace(/\s+/g, '');
      const rawCat = norm(catno).replace(/\s+/g, '');
      const catMatch = Boolean(rawCat && itemCat && (itemCat === rawCat || itemCat.includes(rawCat) || rawCat.includes(itemCat)));
      const fmtList = (Array.isArray(it.format) ? it.format : [it.format || '']).join(' ').toLowerCase();
      const isClub = fmtList.includes('club');
      const have = it.community?.have || 0;
      const want = it.community?.want || 0;
      const yearMatch = Boolean(year && String(it.year || '') === year);

      let score = sim * 0.55 + (catMatch ? 0.24 : 0) + (yearMatch ? 0.06 : 0);
      if (it._tier === 'barcode') score += 0.14;
      if (prefCountry && it.country) {
        if (norm(it.country) === norm(prefCountry)) score += (photoCountry ? 0.20 : 0.09);
        else if (photoCountry) score -= 0.18;
      }
      if (clubDetected === 'None' && isClub) score -= 0.14;
      if ((clubDetected === 'CRC' || clubDetected === 'BMG') && isClub) score += 0.18;
      score += Math.min(0.12, Math.log10(have + want + 1) * 0.04);
      return { sim, catMatch, isClub, yearMatch, score };
    };

    try {
      if (barcode) {
        const bp = { type: 'release', barcode, per_page: 100 };
        if (activeFormat !== 'Auto') bp.format = format;
        add(await CC.discogsFetch('/database/search', bp), 'barcode');
        if (pool.size === 0 && bp.format) add(await CC.discogsFetch('/database/search', { type: 'release', barcode, per_page: 100 }), 'barcode');
      }
      if (catno) {
        add(await CC.discogsFetch('/database/search', { type: 'release', catno, format, per_page: 100 }), 'catno');
        const variants = (currentExtracted?.cleaned_catalog_variants || []).filter(v => v && norm(v) !== norm(catno));
        for (const v of variants) {
          add(await CC.discogsFetch('/database/search', { type: 'release', catno: v, format, label, per_page: 100 }), 'variant');
        }
      }
      if (title || artist) {
        const q = `${artist} ${title}`.trim();
        add(await CC.discogsFetch('/database/search', { type: 'release', q, format, per_page: 100 }), 'text');
        if (pool.size === 0) add(await CC.discogsFetch('/database/search', { type: 'release', q, per_page: 100 }), 'broad');
      }

      if (myRunId !== scanRunId) return;

      const allScored = Array.from(pool.values())
        .map(it => ({ ...it, _check: scoreItem(it) }))
        .filter(it => it._check.sim >= 0.25 || it._check.catMatch || it._tier === 'barcode')
        .sort((a, b) => b._check.score - a._check.score);

      currentCandidates = allScored;
      renderCandidates(false);

      if (allScored.length === 0) {
        setStatus('', false);
        showNotFoundOutcome('Discogs returned zero matching releases for this title, artist, barcode, or catalog #.');
        return;
      }

      if (cfg.autoDetective && CC.isAiReady()) {
        await runVariantDetective(null, myRunId, 0);
      } else {
        setStatus('', false);
        renderCandidates(true);
      }
    } catch (err) {
      setStatus('', false);
      toast('Discogs search failed: ' + err.message, 4000);
    }
  };

  function showNotFoundOutcome(reason) {
    const card = document.getElementById('detectiveCard');
    card.classList.remove('hidden');
    document.getElementById('detectiveBadge').innerHTML = `<span class="badge badge-red" style="margin:0;">🚫 Not on Discogs</span>`;
    document.getElementById('detectiveReasoning').textContent = reason;
    document.getElementById('detectiveQuestionBox').classList.add('hidden');
    document.getElementById('detectiveActions').innerHTML = `
      <button type="button" class="btn btn-sm" onclick="inspectUnlistedItem()">🎧 Inspect &amp; Save Local Only</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="openManualModal('id')">🔗 Paste Discogs URL / Edit</button>
      ${currentCandidates.length ? `<button type="button" class="btn btn-secondary btn-sm" onclick="toggleCandidatesPanel()">View ${currentCandidates.length} Rejected Matches</button>` : ''}
    `;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  window.toggleCandidatesPanel = () => {
    const card = document.getElementById('candidatesCard');
    const willShow = card.classList.contains('hidden');
    if (willShow) {
      visibleCandidateIds = null;
      detectiveEliminatedIds = new Set();
      renderCandidates(true);
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else card.classList.add('hidden');
  };

  function renderCandidates(showPanel = false) {
    const card = document.getElementById('candidatesCard');
    const list = document.getElementById('candidatesList');
    if (showPanel) card.classList.remove('hidden');

    const shown = visibleCandidateIds ? currentCandidates.filter(c => visibleCandidateIds.has(c.id)) : currentCandidates;
    document.getElementById('candCount').textContent = shown.length;
    document.getElementById('btnManualDetective').classList.toggle('hidden', currentCandidates.length === 0);

    const overflowBar = document.getElementById('candOverflowBar');
    if (currentCandidates.length > detectiveInspectedCount && detectiveInspectedCount > 0) {
      const rem = currentCandidates.length - detectiveInspectedCount;
      overflowBar.classList.remove('hidden');
      overflowBar.innerHTML = `<button type="button" class="btn btn-purple btn-sm" style="width:100%;" onclick="inspectMoreCandidates()">🕵️ AI-Check Next ${Math.min(VERIFY_BATCH_LIMIT, rem)} of ${rem} Remaining Pressings</button>`;
    } else {
      overflowBar.classList.add('hidden');
      overflowBar.innerHTML = '';
    }

    list.innerHTML = shown.map(it => {
      const idx = currentCandidates.indexOf(it);
      const isPick = detectivePickId === it.id;
      const isElim = detectiveEliminatedIds.has(it.id);
      const isSel = currentInspected?.discogs_id === it.id;
      const diffTxt = detectiveDiffs[it.id] || '';
      const have = it.community?.have ?? 0;
      const want = it.community?.want ?? 0;
      const fmtText = Array.isArray(it.format) ? it.format.slice(0, 3).join(', ') : (it.format || '');
      const lblText = Array.isArray(it.label) ? it.label[0] : (it.label || '');

      return `
        <div class="candidate-card ${isSel ? 'selected' : ''} ${isPick ? 'ai-pick' : ''} ${isElim ? 'eliminated' : ''}" onclick="inspectCandidate(${idx})">
          <img class="candidate-thumb" src="${esc(it.thumb || '')}" onerror="this.style.visibility='hidden'" />
          <div class="candidate-meta">
            <div class="candidate-title">${esc(it.title)}</div>
            <div class="candidate-sub">${esc(it.year || '?')} · ${esc(lblText)} · <strong>${esc(it.catno || 'No Cat#')}</strong> · <strong>${esc(it.country || '?')}</strong> · #${it.id}</div>
            ${diffTxt ? `<div class="candidate-diff">${esc(diffTxt)}</div>` : ''}
            <div>
              ${isPick ? `<span class="badge badge-purple">🎯 AI Pick</span>` : ''}
              <span class="badge badge-blue">${esc(fmtText)}</span>
              <span class="badge" style="background:#0d1017; color:var(--muted);">👥 ${have} have · ${want} want</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.inspectMoreCandidates = async () => {
    await runVariantDetective(null, scanRunId, detectiveInspectedCount);
  };

  // ==================== ZERO-GUESSING VERIFICATION ENGINE ====================
  window.runVariantDetective = async (subsetIds = null, myRunId = scanRunId, offset = 0) => {
    if (!CC.isAiReady() || !currentCandidates.length) return;

    const batch = subsetIds
      ? currentCandidates.filter(c => subsetIds.includes(c.id))
      : currentCandidates.slice(offset, offset + VERIFY_BATCH_LIMIT);

    if (!batch.length) return;
    if (!subsetIds) detectiveInspectedCount = Math.max(detectiveInspectedCount, offset + batch.length);

    setStatus(`🕵️ Sweeping full pressing details for ${batch.length} candidate(s)...`, true);

    try {
      const dossiers = [];
      const fetchedIds = new Set();
      const refQueue = [];

      const pushReleaseDossier = (rel, fallbackCat) => {
        if (!rel || fetchedIds.has(rel.id)) return;
        fetchedIds.add(rel.id);
        const tracks = (rel.tracklist || []).filter(t => t.type_ !== 'heading').map(t => {
          const ta = cleanDiscogsArtist(t.artists);
          return ta ? `${ta} - ${t.title}` : t.title;
        });
        dossiers.push({
          id: rel.id,
          artist: cleanDiscogsArtist(rel.artists),
          title: rel.title || '',
          year: rel.year || '?',
          country: rel.country || '?',
          catno: rel.labels?.[0]?.catno || fallbackCat || '',
          label: rel.labels?.[0]?.name || '',
          formats: (rel.formats || []).map(f => [f.name, ...(f.descriptions || []), f.text || ''].filter(Boolean).join(', ')).join(' | '),
          notes: rel.notes || '',
          identifiers: (rel.identifiers || []).map(x => `${x.type}${x.description ? ` (${x.description})` : ''}: ${x.value}`),
          companies: (rel.companies || []).map(c => `${c.entity_type_name}: ${c.name}`),
          tracklist: tracks,
          have: rel.community?.have || 0,
          want: rel.community?.want || 0
        });

        extractReferencedIds(rel.notes).forEach(refId => {
          if (!fetchedIds.has(refId)) refQueue.push(refId);
        });
      };

      for (let i = 0; i < batch.length; i++) {
        setStatus(`🕵️ Reading full pressing notes (${i + 1}/${batch.length}) · API ${CC.getRateCount()}/58...`, true);
        const rel = await CC.getReleaseCached(batch[i].id);
        if (myRunId !== scanRunId) return;
        pushReleaseDossier(rel, batch[i].catno);
      }

      const uniqueRefs = Array.from(new Set(refQueue)).filter(id => !fetchedIds.has(id)).slice(0, 12);
      for (let i = 0; i < uniqueRefs.length; i++) {
        setStatus(`🔗 Auto-following sibling pressing #${uniqueRefs[i]} (${i + 1}/${uniqueRefs.length}) · API ${CC.getRateCount()}/58...`, true);
        try {
          const refRel = await CC.getReleaseCached(uniqueRefs[i]);
          if (myRunId !== scanRunId) return;
          pushReleaseDossier(refRel, '');
          if (!currentCandidates.some(c => c.id === refRel.id)) {
            const art = cleanDiscogsArtist(refRel.artists);
            currentCandidates.unshift({
              id: refRel.id,
              title: art ? `${art} - ${refRel.title}` : refRel.title,
              year: refRel.year || '',
              country: refRel.country || '',
              catno: refRel.labels?.[0]?.catno || '',
              label: refRel.labels?.[0]?.name ? [refRel.labels[0].name] : [],
              format: (refRel.formats || []).flatMap(f => [f.name, ...(f.descriptions || [])]),
              thumb: refRel.thumb || '',
              community: refRel.community || { have: 0, want: 0 },
              _tier: 'sibling',
              _check: { sim: 1, catMatch: true, score: 1.5 }
            });
          }
        } catch (_) {}
      }

      setStatus(`🕵️ Verifying ${dossiers.length} pressing(s) on ${aiEngineLabel()}...`, true, { cancellable: true });

      const prompt = `You are a STRICT, ZERO-GUESSING Discogs Verification Engine. Accuracy is everything. NEVER guess or force a contradictory match!
Compare the user's photo(s), visible songs, catalog #, barcode, and physical details against ALL ${dossiers.length} complete, untruncated Discogs listings below.

STRICT PHOTO-SCOPE / LOOSE-TAPE AWARENESS (CRITICAL):
- The user ALWAYS photographs Front of Case + Side A together and Back of Case + Side B together.
- If NO case, J-card, jacket, or cover insert appears in the photos (or "has_case_or_insert" is false), treat this item as LOOSE MEDIA (no case/insert).
- STRICTLY FORBIDDEN: For loose media with no case/insert, you are STRICTLY FORBIDDEN from asking questions about missing cases, J-cards, spines, cover logos, back-cover barcodes, or inserts (e.g., NEVER ask "Is there a W on the case?" or "Does the J-card have a barcode?"). Those parts do not exist!
- ALLOWED QUESTIONS: You MAY still ask about physical details on the cassette/disc ITSELF that aren't visible in the two flat photos (e.g., "Made in U.S.A." molded into the top edge of the shell, screw count on an obscured edge, inner ring/hub code on a CD/vinyl).

CONSERVATIVE TIE-BREAKER RULE (HONEST LABELING):
- When 2 or more pressings match EVERY visible shell/disc clue with ZERO contradictions and ONLY differ by a missing case/J-card/insert (or other uncheckable details not verifiable on the physical item in hand), DO NOT stall on unanswerable questions!
- Instead, return "outcome": "likely_match" AND "conservative_tiebreak": true (NEVER call a tie-breaker "exact_match"!), and select the MOST COMMON / CONSERVATIVE pressing (highest "have" count in community.have) so the user never over-values a common tape as a rare variant. Explain clearly in "reasoning" which candidates tied on shell clues and why the most common pressing was chosen conservatively.

STRICT VERIFICATION RULES:
1. CHECK FOR CONTRADICTIONS FIRST:
   - If the visible songs on the tape DO NOT match a listing's tracklist, DISQUALIFY it.
   - If the photo clearly shows a specific timing window scale (e.g. "100-50-0") and a listing says "0-50-0" or blank, DISQUALIFY it.
   - If the photo clearly shows a plant code (e.g. "SR") and a listing says "AR", DISQUALIFY it.
   - If the photo clearly shows a shell color, country, club edition ("CRC"/"BMG" vs retail), or barcode presence/absence that contradicts a listing, DISQUALIFY it.
2. FOUR HONEST OUTCOMES:
   - "exact_match": ONLY when ONE listing uniquely aligns with ALL visible evidence with ZERO contradictions and NO other plausible tie remains ("conservative_tiebreak": false).
   - "likely_match": When 2+ plausible pressings match all visible shell/disc clues and only differ by absent/uncheckable case/J-card details, resolved via the Conservative Tie-Breaker (highest "have" count, "conservative_tiebreak": true).
   - "needs_user": ONLY when 2+ listings remain plausible without contradiction AND differ by a physically CHECKABLE detail on the actual item in hand. Ask ONE crystal-clear, jargon-free question.
   - "not_found": When EVERY listing has clear contradictions. NEVER force a wrong listing!

Scanned Info: ${JSON.stringify({
  title: document.getElementById('fTitle').value,
  artist: document.getElementById('fArtist').value,
  catno: document.getElementById('fCatno').value,
  barcode: document.getElementById('fBarcode').value,
  year: document.getElementById('fYear').value,
  has_case_or_insert: currentExtracted?.has_case_or_insert ?? null,
  country_clues: currentExtracted?.country_clues || 'Not visible',
  club_edition: currentExtracted?.club_edition || 'Unknown',
  physical_details: currentExtracted?.physical_details || 'None',
  visible_tracks: currentExtracted?.visible_tracks || []
})}

Complete Untruncated Discogs Candidates (${dossiers.length}):
${JSON.stringify(dossiers)}

Return ONLY valid JSON:
{
  "outcome": "exact_match" | "likely_match" | "needs_user" | "not_found",
  "conservative_tiebreak": true | false,
  "best_release_id": number or null,
  "eliminated_ids": [numbers disqualified by contradictions],
  "reasoning": "1-2 blunt, factual sentences explaining what matched, what contradicted, or why the conservative highest-have tie-breaker was applied.",
  "candidate_diffs": [{ "id": number, "short_diff": "plain-English 6-12 word summary of distinguishing features" }],
  "question": null or {
    "prompt": "Direct, plain-English question about a CHECKABLE detail on the physical item in hand",
    "how_to_check": "Simple 1-sentence instruction telling the user where to look",
    "options": [{ "label": "Clear everyday physical description", "matching_ids": [number] }]
  }
}`;

      const parts = [{ text: prompt }, ...stagedPhotos.map(p => ({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }))];
      const verdict = await CC.callAI(parts, 'MEDIUM', { retryLabel: 'Verification' });
      if (myRunId !== scanRunId) return;

      (verdict.candidate_diffs || []).forEach(d => { if (d.id && d.short_diff) detectiveDiffs[d.id] = d.short_diff; });
      detectiveEliminatedIds = new Set(verdict.eliminated_ids || []);
      detectivePickId = verdict.best_release_id || null;

      if (verdict.outcome === 'not_found') {
        setStatus('', false);
        renderCandidates(false);
        const rem = currentCandidates.length - detectiveInspectedCount;
        let msg = verdict.reasoning || 'None of the inspected Discogs listings match your photos/tracks.';
        if (rem > 0) msg += ` (${rem} more Discogs result(s) haven't been checked yet.)`;
        showNotFoundOutcome(msg);
        if (rem > 0) {
          document.getElementById('detectiveActions').insertAdjacentHTML('afterbegin',
            `<button type="button" class="btn btn-purple btn-sm" onclick="inspectMoreCandidates()">🕵️ Check Next ${Math.min(VERIFY_BATCH_LIMIT, rem)} Results</button>`
          );
        }
        return;
      }

      const isTiebreak = verdict.outcome === 'likely_match' || Boolean(verdict.conservative_tiebreak);
      renderDetectiveCard(verdict, isTiebreak);
      renderCandidates(verdict.outcome === 'needs_user' && (!verdict.question?.options?.length));

      const pickIdx = currentCandidates.findIndex(c => c.id === verdict.best_release_id);
      if ((verdict.outcome === 'exact_match' || isTiebreak) && pickIdx !== -1) {
        await inspectCandidate(pickIdx, myRunId, { isConservativeTiebreak: isTiebreak });
      } else {
        setStatus('', false);
        document.getElementById('detectiveCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (err) {
      setStatus('', false);
      if (err.name === 'AbortError') return;
      const card = document.getElementById('detectiveCard');
      card.classList.remove('hidden');
      document.getElementById('detectiveBadge').innerHTML = `<span class="badge badge-yellow" style="margin:0;">⚠️ Verification Stopped</span>`;
      document.getElementById('detectiveReasoning').textContent = `Could not auto-verify (${err.message}). Pick a match manually below or retry.`;
      document.getElementById('detectiveQuestionBox').classList.add('hidden');
      document.getElementById('detectiveActions').innerHTML = `
        <button type="button" class="btn btn-purple btn-sm" onclick="runVariantDetective()">🔄 Retry Verification</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="toggleCandidatesPanel()">Pick Manually</button>
      `;
      renderCandidates(true);
    }
  };

  function renderDetectiveCard(verdict, isTiebreak = false) {
    const card = document.getElementById('detectiveCard');
    card.classList.remove('hidden');

    const isExact = verdict.outcome === 'exact_match' && !isTiebreak;
    const badgeEl = document.getElementById('detectiveBadge');
    if (isExact) {
      badgeEl.innerHTML = `<span class="badge badge-green" style="margin:0;">✅ Exact Match</span>`;
    } else if (isTiebreak) {
      badgeEl.innerHTML = `<span class="badge badge-yellow" style="margin:0;">🎯 Likely Match (Most Common)</span>`;
    } else {
      badgeEl.innerHTML = `<span class="badge badge-yellow" style="margin:0;">❓ Needs Your Call</span>`;
    }
    document.getElementById('detectiveReasoning').textContent = verdict.reasoning || '';

    const qBox = document.getElementById('detectiveQuestionBox');
    if (!isExact && !isTiebreak && verdict.question?.options?.length) {
      qBox.classList.remove('hidden');
      window._detectiveOptions = verdict.question.options;
      qBox.innerHTML = `
        <div style="font-weight:800; font-size:0.92rem;">${esc(verdict.question.prompt)}</div>
        ${verdict.question.how_to_check ? `<div class="detective-hint">👀 ${esc(verdict.question.how_to_check)}</div>` : ''}
        <div>
          ${window._detectiveOptions.map((opt, i) => `
            <button class="opt-btn" onclick="answerDetective(${i})">${esc(opt.label)}</button>
          `).join('')}
          <button class="opt-btn fallback-opt" onclick="toggleCandidatesPanel()">🔎 None of these / inspect all ${currentCandidates.length} listings</button>
        </div>
      `;
    } else {
      qBox.classList.add('hidden');
      qBox.innerHTML = '';
    }

    const rem = currentCandidates.length - detectiveInspectedCount;
    const plausible = currentCandidates.filter(c => !detectiveEliminatedIds.has(c.id));
    const mostCommon = plausible.slice().sort((a, b) => (b.community?.have || 0) - (a.community?.have || 0))[0] || null;
    const mostCommonIdx = mostCommon ? currentCandidates.indexOf(mostCommon) : -1;

    document.getElementById('detectiveActions').innerHTML = `
      ${(!isExact && !isTiebreak && mostCommon && mostCommonIdx !== -1) ? `<button type="button" class="btn btn-green btn-sm" onclick="pickConservativeCommon(${mostCommonIdx})">🎯 Pick Most Common (#${mostCommon.id} · ${mostCommon.community?.have || 0} have)</button>` : ''}
      ${!isExact ? `<button type="button" class="btn btn-secondary btn-sm" onclick="toggleCandidatesPanel()">View All (${currentCandidates.length})</button>` : ''}
      ${rem > 0 ? `<button type="button" class="btn btn-purple btn-sm" onclick="inspectMoreCandidates()">Check Next ${Math.min(VERIFY_BATCH_LIMIT, rem)}</button>` : ''}
      <button type="button" class="btn btn-secondary btn-sm" onclick="openCameraViewfinder('single')">📷 Add Photo</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="openManualModal('id')">🔗 Paste URL/ID</button>
    `;
  }

  window.pickConservativeCommon = async (idx) => {
    const c = currentCandidates[idx];
    if (!c) return;
    unlockAudioForAutoplay(false);
    detectivePickId = c.id;
    document.getElementById('detectiveQuestionBox').classList.add('hidden');
    document.getElementById('detectiveBadge').innerHTML = `<span class="badge badge-yellow" style="margin:0;">🎯 Likely Match (Most Common)</span>`;
    document.getElementById('detectiveReasoning').textContent = `Selected most common pressing #${c.id} (${c.community?.have || 0} have). Please confirm below before saving to Discogs.`;
    await inspectCandidate(idx, scanRunId, { isConservativeTiebreak: true });
  };

  window.answerDetective = async (optIdx) => {
    const opt = (window._detectiveOptions || [])[optIdx];
    if (!opt) return;
    unlockAudioForAutoplay(false);
    const ids = (opt.matching_ids || []).filter(id => currentCandidates.some(c => c.id === id));

    if (ids.length === 1) {
      detectivePickId = ids[0];
      document.getElementById('detectiveQuestionBox').classList.add('hidden');
      document.getElementById('detectiveBadge').innerHTML = `<span class="badge badge-green" style="margin:0;">✅ Verified by You</span>`;
      document.getElementById('detectiveReasoning').textContent = `Confirmed: ${opt.label}`;
      await inspectCandidate(currentCandidates.findIndex(c => c.id === ids[0]), scanRunId, { isConservativeTiebreak: false });
    } else if (ids.length > 1) {
      await runVariantDetective(ids, scanRunId);
    } else renderCandidates(true);
  };

  // ==================== INSPECTOR + OTHER-PRESSING CHECK + TASTE SCORING ====================
  function normalizeNotableList(rawList, fallbackArtist) {
    if (!Array.isArray(rawList)) return [];
    return rawList.map(entry => {
      if (entry && typeof entry === 'object' && entry.title) {
        return { artist: entry.artist || fallbackArtist || '', title: entry.title, reason: entry.reason || '' };
      }
      const str = String(entry || '');
      const [head, ...rest] = str.split(/\s+[—–]\s+/);
      const reason = rest.join(' — ');
      const parts = head.split(/\s+-\s+/);
      if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), reason };
      return { artist: fallbackArtist || '', title: head.trim(), reason };
    }).filter(x => x.title);
  }

  function findOtherPressingMatches(releaseId, masterId, artist, title) {
    const matches = [];
    const seen = new Set();
    const curRelId = Number(releaseId || 0);
    const curMasterId = Number(masterId || 0);
    const na = norm(artist);
    const nt = norm(title);
    const albumKey = (na && nt) ? `${na}|${nt}` : '';

    const addMatch = (key, label) => {
      if (seen.has(key)) return;
      seen.add(key);
      matches.push(label);
    };

    if (discogsCollectionIndex) {
      const fromMaster = curMasterId > 0 ? (discogsCollectionIndex.masterMap?.[String(curMasterId)] || []) : [];
      const fromKey = albumKey ? (discogsCollectionIndex.albumKeys?.[albumKey] || []) : [];
      [...fromMaster, ...fromKey].forEach(entry => {
        if (Number(entry.releaseId) && Number(entry.releaseId) !== curRelId) {
          const meta = [entry.format, entry.year].filter(Boolean).join(', ');
          addMatch(`dc:${entry.releaseId}`, `Discogs #${entry.releaseId}${meta ? ` (${meta})` : ''}`);
        }
      });
    }

    stashCache.forEach(s => {
      if (editingStashItem && s.id === editingStashItem.id) return;
      const sRelId = Number(s.discogs_id || 0);
      if (curRelId && sRelId && sRelId === curRelId) return; // exact pressing already handled by Local Stash dup check
      const sameMaster = curMasterId > 0 && Number(s.master_id || 0) === curMasterId;
      const sameAlbum = Boolean(albumKey && norm(s.artist) === na && norm(s.title) === nt);
      if (sameMaster || sameAlbum) {
        const meta = [s.format, s.year].filter(Boolean).join(', ');
        const tag = sRelId ? `Stash #${sRelId}` : 'Local Stash';
        addMatch(sRelId ? `dc:${sRelId}` : `st:${s.id}`, `${tag}${meta ? ` (${meta})` : ''}`);
      }
    });

    return matches;
  }

  window.inspectCandidate = async (idx, myRunId = scanRunId, opts = {}) => {
    const cand = currentCandidates[idx];
    if (!cand) return;
    setStatus('Loading Discogs price, collection status, tracklist & Taste check...', true);

    try {
      const release = await CC.getReleaseCached(cand.id);
      if (myRunId !== scanRunId) return;
      const stats = await CC.discogsFetch(`/marketplace/stats/${cand.id}`).catch(() => ({}));

      let suggestions = null;
      if (cfg.fetchVgSuggestions) {
        try { suggestions = await CC.discogsFetch(`/marketplace/price_suggestions/${cand.id}`); }
        catch (_) { suggestions = null; }
      }

      // Live Discogs Collection Duplicate Check (Exact pressing)
      let liveDiscogsInstances = [];
      if (cfg.discogsUser && cfg.discogsToken) {
        liveDiscogsInstances = await CC.findDiscogsInstances(release.id).catch(() => []);
      }
      if (myRunId !== scanRunId) return;

      const artistName = cleanDiscogsArtist(release.artists) ||
                         (cand.title.includes(' - ') ? cand.title.split(' - ')[0] : '');
      const albumTitle = release.title || (cand.title.includes(' - ') ? cand.title.split(' - ').slice(1).join(' - ') : cand.title);
      const catno = release.labels?.[0]?.catno || cand.catno || document.getElementById('fCatno').value.trim();
      const label = release.labels?.[0]?.name || (Array.isArray(cand.label) ? cand.label[0] : '');
      const format = activeFormat !== 'Auto' ? activeFormat : document.getElementById('fFormat').value;
      const masterId = Number(release.master_id || 0) || null;

      const tracklist = (release.tracklist || [])
        .filter(t => t.type_ !== 'heading')
        .map(t => ({ pos: t.position || '', artist: cleanDiscogsArtist(t.artists), title: t.title || '' }));

      const lowestPrice = stats?.lowest_price?.value ?? release.lowest_price ?? null;
      const lowestCurrency = stats?.lowest_price?.currency || 'USD';
      const numForSale = stats?.num_for_sale ?? release.num_for_sale ?? 0;
      const vgPlusPrice = suggestions?.['Very Good Plus (VG+)']?.value ?? null;
      const vgPlusCurrency = suggestions?.['Very Good Plus (VG+)']?.currency || lowestCurrency || 'USD';
      const estPrice = vgPlusPrice ?? lowestPrice;
      const estCurrency = vgPlusPrice !== null ? vgPlusCurrency : lowestCurrency;
      const estUsd = toApproxUsd(estPrice, estCurrency);
      const have = release.community?.have ?? 0;
      const want = release.community?.want ?? 0;

      // Currency-aware High-Value threshold (compares approximate USD value against USD threshold)
      const isHighValue = estUsd !== null && estUsd >= Number(cfg.threshold || 20);
      const isScarce = numForSale === 0 && (want >= 10 || (want > have && want >= 5));

      const otherPressingMatches = findOtherPressingMatches(release.id, masterId, artistName, albumTitle);

      const notesParts = [];
      if (release.formats?.length) notesParts.push('Format: ' + release.formats.map(f => [f.name, ...(f.descriptions || []), f.text || ''].filter(Boolean).join(', ')).join(' | '));
      if (release.notes) notesParts.push('\nNotes:\n' + release.notes);
      if (release.identifiers?.length) notesParts.push('\nIdentifiers:\n' + release.identifiers.map(x => `• ${x.type}${x.description ? ` (${x.description})` : ''}: ${x.value}`).join('\n'));
      if (release.companies?.length) notesParts.push('\nCompanies:\n' + release.companies.map(c => `• ${c.entity_type_name}: ${c.name}`).join('\n'));

      const prevAlbumKey = currentInspected ? `${norm(currentInspected.artist)}|${norm(currentInspected.title)}` : '';
      const nextAlbumKey = `${norm(artistName)}|${norm(albumTitle)}`;
      if (prevAlbumKey && prevAlbumKey !== nextAlbumKey) stopHighlightAudio();

      const keepOldGrades = Boolean(editingStashItem && !document.getElementById('chkRegradeEdit').checked);
      const mediaCond = keepOldGrades
        ? editingStashItem.media_condition
        : normalizeGrade(currentExtracted?.media_condition, MEDIA_GRADES, 'Very Good Plus (VG+)');
      const sleeveCond = keepOldGrades
        ? editingStashItem.sleeve_condition
        : normalizeGrade(currentExtracted?.sleeve_condition, SLEEVE_GRADES, 'Very Good Plus (VG+)');
      const condNote = keepOldGrades
        ? (editingStashItem.condition_note || '')
        : (currentExtracted?.condition_note || '');

      currentInspected = {
        discogs_id: release.id, master_id: masterId, title: albumTitle, artist: artistName, catno, format,
        year: release.year || cand.year || '', label, country: release.country || cand.country || '',
        genres: [...(release.genres || []), ...(release.styles || [])],
        media_condition: mediaCond, sleeve_condition: sleeveCond, condition_note: condNote,
        lowest_price: lowestPrice, lowest_currency: lowestCurrency,
        vg_plus_price: vgPlusPrice, vg_plus_currency: vgPlusCurrency,
        est_price: estPrice, est_currency: estCurrency, est_usd: estUsd,
        num_for_sale: numForSale, have, want, is_high_value: isHighValue, is_scarce: isScarce,
        discogs_owned_count: liveDiscogsInstances.length,
        other_pressing_matches: otherPressingMatches,
        is_conservative_tiebreak: Boolean(opts.isConservativeTiebreak),
        tracklist, pressing_notes: notesParts.join('\n').trim(),
        discogs_url: release.uri || `https://www.discogs.com/release/${release.id}`,
        discogs_thumb: release.thumb || cand.thumb || '',
        taste_score: null, taste_verdict: null, taste_summary: '', context_note: '',
        notable_songs: [], litmus_track: '', litmus_artist: '',
        spotify_matches: { artistHit: false, matchedArtists: [], matchedTracks: [], details: '' }
      };

      renderCandidates(false);
      renderInspector(currentInspected, true);
      setStatus('', false);
      document.getElementById('inspectorCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

      if (isHighValue || isScarce) playChime();
      await runTasteAnalysis(currentInspected, myRunId);
    } catch (err) {
      setStatus('', false);
      toast('Error loading release: ' + err.message, 4000);
    }
  };

  window.inspectUnlistedItem = async () => {
    const title = document.getElementById('fTitle').value.trim() || 'Untitled Release';
    const artist = document.getElementById('fArtist').value.trim() || 'Unknown Artist';
    const tracks = (currentExtracted?.visible_tracks || []).map((raw, i) => {
      const parts = String(raw).split(/\s+[-–—]\s+/);
      return parts.length >= 2
        ? { pos: String(i + 1), artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
        : { pos: String(i + 1), artist: '', title: String(raw).trim() };
    });

    stopHighlightAudio();
    unlockAudioForAutoplay(false);

    const otherPressingMatches = findOtherPressingMatches(null, null, artist, title);
    const keepOldGrades = Boolean(editingStashItem && !document.getElementById('chkRegradeEdit').checked);
    currentInspected = {
      discogs_id: null, master_id: null, title, artist,
      catno: document.getElementById('fCatno').value.trim(),
      format: activeFormat !== 'Auto' ? activeFormat : document.getElementById('fFormat').value,
      year: document.getElementById('fYear').value.trim(),
      label: document.getElementById('fLabel').value.trim(),
      country: '', genres: [],
      media_condition: keepOldGrades ? editingStashItem.media_condition : normalizeGrade(currentExtracted?.media_condition, MEDIA_GRADES, 'Very Good Plus (VG+)'),
      sleeve_condition: keepOldGrades ? editingStashItem.sleeve_condition : normalizeGrade(currentExtracted?.sleeve_condition, SLEEVE_GRADES, 'Very Good Plus (VG+)'),
      condition_note: keepOldGrades ? (editingStashItem.condition_note || '') : (currentExtracted?.condition_note || ''),
      lowest_price: null, lowest_currency: 'USD',
      vg_plus_price: null, vg_plus_currency: 'USD',
      est_price: null, est_currency: 'USD', est_usd: null, num_for_sale: null,
      have: 0, want: 0, is_high_value: false, is_scarce: false,
      discogs_owned_count: 0, other_pressing_matches: otherPressingMatches,
      is_conservative_tiebreak: false,
      tracklist: tracks, pressing_notes: '',
      discogs_url: '', discogs_thumb: '', taste_score: null, taste_verdict: null,
      taste_summary: '', context_note: '', notable_songs: [], litmus_track: '', litmus_artist: '',
      spotify_matches: { artistHit: false, matchedArtists: [], matchedTracks: [], details: '' }
    };

    renderInspector(currentInspected, false);
    document.getElementById('inspectorCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await runTasteAnalysis(currentInspected, scanRunId);
  };

  function buildTracklistHtml(tracks, matched = [], source = 'scan') {
    const mSet = new Set(matched.map(norm));
    if (!tracks.length) return `<div style="padding:12px; color:var(--muted); font-size:0.84rem;">No tracklist available.</div>`;
    return tracks.map((t, i) => {
      const hit = mSet.has(norm(t.title)) || (t.artist && mSet.has(norm(`${t.artist} - ${t.title}`)));
      const fn = source === 'stash' ? `previewStashTrack(${i})` : `previewTrackByIndex(${i})`;
      return `<div class="track-row ${hit ? 'track-hit' : ''}">
        <div class="track-info">
          <div class="track-name">${esc(t.pos ? t.pos + ' · ' : '')}${esc(t.title)}</div>
          ${t.artist ? `<div class="track-sub">${esc(t.artist)}</div>` : ''}
        </div>
        ${hit ? '<span class="badge badge-green" style="margin:0;">Spotify</span>' : ''}
        <button type="button" class="play-pill-btn" onclick="${fn}" title="Play 30s preview">▶</button>
      </div>`;
    }).join('');
  }

  function buildNotableHitsHtml(item, source = 'scan') {
    let html = '';
    if (item.litmus_track) {
      const lArt = resolveLitmusArtist(item);
      const showArt = lArt && norm(lArt) !== norm(item.artist) && !/^various/i.test(lArt);
      const fn = source === 'stash' ? 'previewStashLitmus()' : 'previewLitmusTrack()';
      html += `<div class="notable-row" style="border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:9px; margin-bottom:6px;">
        <div><strong>🎧 Test Song:</strong> ${showArt ? `${esc(lArt)} — ` : ''}${esc(item.litmus_track)}</div>
        <button type="button" class="play-pill-btn sm" onclick="${fn}" title="Play Test Song">▶</button>
      </div>`;
    }
    const list = normalizeNotableList(item.notable_songs, item.artist);
    if (list.length) {
      html += `<div style="font-weight:800; margin-bottom:4px;">⭐ Notable / Recognizable Songs (${list.length}):</div>`;
      html += list.map((s, idx) => {
        const showA = s.artist && norm(s.artist) !== norm(item.artist) && !/^various/i.test(s.artist);
        const fn = source === 'stash' ? `previewStashNotable(${idx})` : `previewScanNotable(${idx})`;
        return `<div class="notable-row">
          <div style="flex:1; min-width:0;">
            <strong>${showA ? `${esc(s.artist)} — ` : ''}${esc(s.title)}</strong>
            ${s.reason ? `<div style="font-size:0.78rem; color:var(--muted);">${esc(s.reason)}</div>` : ''}
          </div>
          <button type="button" class="play-pill-btn sm" onclick="${fn}" title="Play 30s preview">▶</button>
        </div>`;
      }).join('');
    }
    return html || `<span style="color:var(--muted);">No major mainstream hits identified.</span>`;
  }

  window.updateSaveButtonsState = () => {
    if (!currentInspected) return;
    const hasDiscogs = Boolean(currentInspected.discogs_id);
    const saveBtn = document.getElementById('btnSaveBoth');
    const needTiebreakConfirm = Boolean(hasDiscogs && currentInspected.is_conservative_tiebreak);
    const confirmed = document.getElementById('chkConfirmTiebreak')?.checked;
    saveBtn.disabled = !hasDiscogs || !cfg.discogsToken || !cfg.discogsUser || (needTiebreakConfirm && !confirmed);
  };

  function renderInspector(item, hasDiscogs) {
    document.getElementById('inspectorCard').classList.remove('hidden');
    document.getElementById('inspTitle').textContent = `${item.artist} — ${item.title}`;
    document.getElementById('inspSub').textContent = `${item.format} · ${item.country || '?'} · ${item.year || '?'} · ${item.label || 'Unknown Label'} · ${item.catno || 'No Cat#'}`;
    document.getElementById('inspBadge').innerHTML = hasDiscogs
      ? `<span class="badge ${item.is_conservative_tiebreak ? 'badge-yellow' : 'badge-blue'}">#${item.discogs_id}</span>`
      : `<span class="badge badge-yellow">Unlisted</span>`;

    let alerts = '';
    const exactStashDup = !editingStashItem && stashCache.find(s => item.discogs_id && Number(s.discogs_id) === Number(item.discogs_id));
    if (exactStashDup) {
      alerts += `<div class="alert-box alert-dup">⚠️ Exact pressing already in your Local Stash (${new Date(exactStashDup.created_at).toLocaleDateString()}).</div>`;
    }

    const isEditingSameSynced = Boolean(editingStashItem && editingStashItem.synced_to_discogs && Number(editingStashItem.discogs_id) === Number(item.discogs_id));
    if (hasDiscogs && (item.discogs_owned_count || 0) > (isEditingSameSynced ? 1 : 0)) {
      const cnt = item.discogs_owned_count;
      alerts += `<div class="alert-box alert-dup">💿 Exact pressing already in your live Discogs Collection (${cnt} cop${cnt === 1 ? 'y' : 'ies'} owned on @${esc(cfg.discogsUser || 'Discogs')}).</div>`;
    }

    if (Array.isArray(item.other_pressing_matches) && item.other_pressing_matches.length) {
      alerts += `<div class="alert-box alert-other-pressing">📀 Already own this album in ANOTHER pressing: ${esc(item.other_pressing_matches.slice(0, 4).join(' · '))}</div>`;
    }

    if (editingStashItem && editingStashItem.discogs_id && item.discogs_id && Number(editingStashItem.discogs_id) !== Number(item.discogs_id)) {
      alerts += `<div class="alert-box alert-dup">🔄 Pressing changed: #${editingStashItem.discogs_id} → #${item.discogs_id}. Syncing adds the new copy, saves fields &amp; local record FIRST, then safely removes the old copy.</div>`;
    }
    if (item.is_high_value) alerts += `<div class="alert-box alert-high-value">🔥 HIGH VALUE (${esc(formatMoneyWithUsd(item.est_price, item.est_currency))}) — SET ASIDE!</div>`;
    if (item.is_scarce) alerts += `<div class="alert-box alert-scarce">💎 SCARCE (0 for sale, ${item.want} want / ${item.have} have) — CHECK SOLD!</div>`;
    document.getElementById('inspAlerts').innerHTML = alerts;

    document.getElementById('mLowest').textContent = item.lowest_price !== null ? formatMoneyWithUsd(item.lowest_price, item.lowest_currency) : 'N/A';
    document.getElementById('mVgPlus').textContent = item.vg_plus_price !== null ? formatMoneyWithUsd(item.vg_plus_price, item.vg_plus_currency) : '—';
    document.getElementById('mForSale').textContent = item.num_for_sale !== null ? `${item.num_for_sale} listed` : '—';
    document.getElementById('mHaveWant').textContent = hasDiscogs ? `${item.have} / ${item.want}` : '—';

    const ebayQ = encodeURIComponent(`${item.artist} ${item.title} ${item.format} ${item.catno}`.trim());
    let links = `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${ebayQ}&LH_Sold=1&LH_Complete=1">💸 eBay Sold</a>`;
    if (hasDiscogs) {
      links = `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${esc(item.discogs_url)}">💿 Discogs</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/history/${item.discogs_id}">📈 Sales History</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/post/${item.discogs_id}">🏷️ Sell</a>` + links;
    }
    document.getElementById('inspLinks').innerHTML = links;

    const pnCard = document.getElementById('pressingNotesCard');
    pnCard.classList.toggle('hidden', !item.pressing_notes);
    if (item.pressing_notes) document.getElementById('inspNotes').innerHTML = formatPressingNotesHtml(item.pressing_notes, true);

    document.getElementById('gMediaCond').innerHTML = gradeOptionsHtml(MEDIA_GRADES, item.media_condition);
    document.getElementById('gSleeveCond').innerHTML = gradeOptionsHtml(SLEEVE_GRADES, item.sleeve_condition);
    document.getElementById('gNotes').value = item.condition_note || '';
    const keptEdit = editingStashItem && !document.getElementById('chkRegradeEdit').checked;
    document.getElementById('aiGradeHint').textContent = keptEdit ? 'Kept Saved Grade'
      : (stagedPhotos.length ? `AI Graded (${stagedPhotos.length} photo${stagedPhotos.length > 1 ? 's' : ''})` : 'Manual Grade');

    const vBtn = document.getElementById('btnVoiceRegradeScan');
    if (vBtn) { vBtn.disabled = false; vBtn.classList.remove('listening'); vBtn.textContent = VOICE_BTN_IDLE; }

    const btnWrong = document.getElementById('btnWrongPressing');
    if (currentCandidates.length > 1) {
      btnWrong.classList.remove('hidden');
      btnWrong.textContent = `Wrong pressing? View all ${currentCandidates.length} Discogs matches ▾`;
    } else btnWrong.classList.add('hidden');

    // Conservative Tie-Breaker explicit confirmation checkbox
    const tbWrap = document.getElementById('tiebreakConfirmWrap');
    const tbChk = document.getElementById('chkConfirmTiebreak');
    if (hasDiscogs && item.is_conservative_tiebreak) {
      tbWrap.classList.remove('hidden');
      tbChk.checked = false;
      document.getElementById('tiebreakConfirmText').innerHTML = `Confirm saving as most common pressing <strong>#${item.discogs_id}</strong> (${item.have} have) — case/insert details were absent or uncheckable.`;
    } else {
      tbWrap.classList.add('hidden');
      tbChk.checked = true;
    }

    const saveBtn = document.getElementById('btnSaveBoth');
    const saveLocalBtn = document.getElementById('btnSaveLocal');
    if (editingStashItem) {
      saveBtn.textContent = !hasDiscogs ? 'Not on Discogs (Update Local Below)' : '✅ Update Stash & Sync/Swap Discogs';
      saveLocalBtn.textContent = '💾 Update Local Stash Only';
    } else {
      saveBtn.textContent = !hasDiscogs ? 'Not on Discogs (Use Save Local Only below)'
        : (!cfg.discogsUser ? 'Verify Discogs in Settings to Enable Save' : '✅ Confirm & Add to Discogs + Local Stash');
      saveLocalBtn.textContent = '💾 Save Local Only';
    }
    updateSaveButtonsState();

    const localMatch = checkLocalSpotify(item);
    item.spotify_matches = localMatch;
    document.getElementById('trackCount').textContent = item.tracklist.length;
    document.getElementById('inspTracklist').innerHTML = buildTracklistHtml(item.tracklist, localMatch.matchedTracks, 'scan');

    let badges = '';
    if (localMatch.artistHit) {
      badges += localMatch.matchedArtists.length > 1
        ? `<span class="badge badge-green">🎸 ${localMatch.matchedArtists.length} Artists in Your Spotify</span>`
        : `<span class="badge badge-green">🎸 Artist in Your Spotify</span>`;
    }
    if (localMatch.matchedTracks.length) badges += `<span class="badge badge-green">🎵 ${localMatch.matchedTracks.length} Track(s) in Your Library</span>`;
    if (!spotifyProfile && !document.getElementById('cfgTasteDna').value.trim()) {
      badges += `<span class="badge badge-yellow">Add Taste Profile or sync Spotify in Settings</span>`;
    }
    document.getElementById('tasteLocalBadges').innerHTML = badges;

    document.getElementById('tasteScore').textContent = '...';
    document.getElementById('tasteBody').textContent = `Analyzing against your Taste Profile & Soft Spots on ${aiEngineLabel()}...`;
    document.getElementById('contextBox').classList.add('hidden');
    document.getElementById('tasteHits').innerHTML = '';
  }

  function checkLocalSpotify(item) {
    if (!spotifyProfile) return { artistHit: false, matchedArtists: [], matchedTracks: [], details: '' };
    const matchedArtists = [];
    const seenArt = new Set();

    const checkStr = (str) => {
      if (!str || /^various(\s+artists)?$/i.test(str.trim())) return;
      String(str).split(/,|&|\band\b|feat\.?/i).forEach(part => {
        const n = norm(part);
        const rec = n && spotifyProfile.allArtists?.[n];
        if (rec && !seenArt.has(n)) {
          seenArt.add(n);
          const trCount = Array.isArray(rec.tracks) ? rec.tracks.length : rec.count;
          const pls = Array.isArray(rec.playlists) && rec.playlists.length ? ` [in: ${rec.playlists.slice(0, 3).join(', ')}]` : '';
          matchedArtists.push(`${rec.name || part.trim()} (${trCount} songs${pls})`);
        }
      });
    };

    checkStr(item.artist);
    (item.tracklist || []).forEach(t => { if (t.artist) checkStr(t.artist); });

    const pairSet = Array.isArray(spotifyProfile.trackPairs) ? new Set(spotifyProfile.trackPairs) : null;
    const titleSet = new Set(spotifyProfile.trackTitles || []);
    const matchedTracks = [];
    const seenTrackKey = new Set();

    (item.tracklist || []).forEach(t => {
      const nt = norm(t.title);
      if (!nt) return;
      const trackArt = t.artist || item.artist || '';
      const artParts = String(trackArt).split(/,|&|\band\b|feat\.?/i).map(norm).filter(Boolean);

      let isHit = false;
      if (pairSet && pairSet.size && artParts.length) {
        isHit = artParts.some(na => pairSet.has(`${na}|${nt}`));
      }
      if (!isHit) {
        const words = nt.split(' ').filter(Boolean);
        const isDistinctiveMultiWord = words.length >= 2 && nt.length >= 7;
        if (isDistinctiveMultiWord && titleSet.has(nt)) {
          isHit = true;
        } else if ((!pairSet || !pairSet.size || !artParts.length) && nt.length > 2 && titleSet.has(nt)) {
          isHit = true;
        }
      }

      if (isHit) {
        const label = t.artist ? `${t.artist} - ${t.title}` : t.title;
        const dedup = norm(label);
        if (!seenTrackKey.has(dedup)) {
          seenTrackKey.add(dedup);
          matchedTracks.push(label);
        }
      }
    });

    return { artistHit: matchedArtists.length > 0, matchedArtists, matchedTracks, details: matchedArtists.join('; ') || 'None' };
  }

  function resolveLitmusArtist(item) {
    if (item.litmus_artist && !/^various(\s+artists)?$/i.test(item.litmus_artist.trim())) return item.litmus_artist;
    if (item.litmus_track && item.tracklist?.length) {
      const found = item.tracklist.find(t => similarity(t.title, item.litmus_track) >= 0.65);
      if (found?.artist) return found.artist;
    }
    return item.artist;
  }

  window.previewTrackByIndex = (idx) => {
    const t = currentInspected?.tracklist?.[idx];
    if (!t?.title) return;
    unlockAudioForAutoplay(true);
    loadHighlightClip(t.artist || currentInspected.artist, t.title, currentInspected.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true });
  };
  window.previewLitmusTrack = () => {
    if (!currentInspected?.litmus_track) return;
    unlockAudioForAutoplay(true);
    loadHighlightClip(resolveLitmusArtist(currentInspected), currentInspected.litmus_track, currentInspected.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true });
  };
  window.previewScanNotable = (idx) => {
    const s = normalizeNotableList(currentInspected?.notable_songs, currentInspected?.artist)[idx];
    if (!s?.title) return;
    unlockAudioForAutoplay(true);
    loadHighlightClip(s.artist || currentInspected.artist, s.title, currentInspected.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true });
  };
  window.previewStashTrack = (idx) => {
    const t = activeStashItem?.tracklist?.[idx];
    if (!t?.title) return;
    unlockAudioForAutoplay(true);
    loadHighlightClip(t.artist || activeStashItem.artist, t.title, activeStashItem.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true, ignoreRunId: true });
  };
  window.previewStashLitmus = () => {
    if (!activeStashItem?.litmus_track) return;
    unlockAudioForAutoplay(true);
    loadHighlightClip(resolveLitmusArtist(activeStashItem), activeStashItem.litmus_track, activeStashItem.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true, ignoreRunId: true });
  };
  window.previewStashNotable = (idx) => {
    const s = normalizeNotableList(activeStashItem?.notable_songs, activeStashItem?.artist)[idx];
    if (!s?.title) return;
    unlockAudioForAutoplay(true);
    loadHighlightClip(s.artist || activeStashItem.artist, s.title, activeStashItem.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true, ignoreRunId: true });
  };

  function verdictBadgeClass(verdict) {
    if (verdict === 'KEEP') return 'badge-green';
    if (verdict === 'LISTEN') return 'badge-blue';
    return 'badge-red';
  }

  function applyTasteUI(item, res, myRunId) {
    item.taste_score = res.score;
    item.taste_verdict = res.verdict;
    item.taste_summary = res.summary;
    item.context_note = res.context_note || '';
    item.notable_songs = normalizeNotableList(res.notable_songs, item.artist);
    item.litmus_track = res.litmus_track || item.tracklist?.[0]?.title || '';
    item.litmus_artist = res.litmus_artist || '';

    document.getElementById('tasteScore').innerHTML = `${esc(res.score)}/10 <span class="badge ${verdictBadgeClass(res.verdict)}" style="vertical-align:middle;">${esc(res.verdict)}</span>`;
    document.getElementById('tasteBody').textContent = res.summary || '';

    const cBox = document.getElementById('contextBox');
    if (item.context_note) {
      cBox.classList.remove('hidden');
      cBox.innerHTML = `<strong>📖 Context:</strong> ${esc(item.context_note)}`;
    } else cBox.classList.add('hidden');

    document.getElementById('tasteHits').innerHTML = buildNotableHitsHtml(item, 'scan');

    const previewArtist = resolveLitmusArtist(item);
    if (item.litmus_track) {
      loadHighlightClip(previewArtist, item.litmus_track, item.title, myRunId, { forceReplace: true, forcePlay: cfg.autoPlayHighlight, strictTrack: true, notifyUser: false });
    } else if (item.title) {
      loadHighlightClip(previewArtist, '', item.title, myRunId, { forceReplace: true, forcePlay: cfg.autoPlayHighlight, strictTrack: false, notifyUser: false });
    }
  }

  window.retryCurrentTaste = () => {
    if (!currentInspected) return;
    document.getElementById('tasteScore').textContent = '...';
    document.getElementById('tasteBody').textContent = 'Retrying Taste analysis...';
    runTasteAnalysis(currentInspected, scanRunId);
  };

  async function runTasteAnalysis(item, myRunId) {
    if (!CC.isAiReady()) {
      document.getElementById('tasteScore').textContent = '—';
      document.getElementById('tasteBody').textContent = 'Add your Gemini API Key in Settings to enable Taste & Context.';
      return;
    }

    const cacheKey = `${norm(item.artist)}|${norm(item.title)}|v19`;
    if (tasteCache.has(cacheKey)) { applyTasteUI(item, tasteCache.get(cacheKey), myRunId); return; }

    const tracksStr = (item.tracklist || []).map(t => t.artist ? `${t.artist} - ${t.title}` : t.title).join('; ');
    const dna = spotifyProfile?.tasteDna || '';
    const softSpots = spotifyProfile?.softSpots || '';
    const fallbackTop = !dna && spotifyProfile ? (spotifyProfile.topArtists || []).slice(0, 200).join(', ') : '';

    const prompt = `Evaluate this physical music release strictly against the user's musical taste profile and provide brief musical/pop-culture context. Speak directly to "you".

Release: "${item.artist} - ${item.title}" (${item.year || '?'}, ${item.format}, Genres: ${(item.genres || []).join(', ') || 'unknown'}).
Full Tracklist: ${tracksStr || 'Unknown'}.
Exact Local Matches Across ALL ${spotifyProfile?.totalTracks || 0} Spotify Tracks / ${spotifyProfile?.totalArtists || 0} Artists:
- Matching Artists in Library: ${item.spotify_matches.details || 'None'}
- Exact / Matching Songs Already in Library: ${item.spotify_matches.matchedTracks.join(', ') || 'None'}

User's Taste Profile:
${dna || (fallbackTop ? `Top Spotify artists: ${fallbackTop}` : 'No written Taste Profile yet.')}

User's Explicit Soft Spots & Niche Pockets (FIRST-CLASS WEIGHT — treat these with EQUAL importance to Core Obsessions so smaller 5–15 song favorite pockets are NEVER averaged out of a large library):
${softSpots || 'None specified yet.'}

HARD RULES:
1. LIBRARY MATCH PROTECTION: If ANY artist OR ANY track on this release is already in the user's Spotify library (listed above under Matching Artists or Matching Songs), you are STRICTLY FORBIDDEN from dismissing this release as "outside your usual rock/metal taste" or calling it a blind spot. You MUST explicitly credit the library match(es) and score accordingly!
2. SOFT SPOTS EQUAL WEIGHT: If this release fits ANY genre, style, era, or mood listed in "Soft Spots & Niche Pockets", score it enthusiastically as a genuine match on par with Core Obsessions.

Verdict rules:
- "KEEP" if score >= 7.
- "LISTEN" if score is 5-6.
- "SELL / SKIP" if score <= 4.

Return ONLY valid JSON:
{
  "score": 1 to 10 integer (honest personal taste match based on Taste Profile, Soft Spots & exact library hits),
  "verdict": "KEEP" | "LISTEN" | "SELL / SKIP",
  "summary": "1-2 punchy sentences speaking directly to 'you' explaining why you will or won't enjoy this, referencing specific library hits, Soft Spots, or Taste Profile traits.",
  "context_note": "1-2 neutral sentences of useful context: notable album history, why a song on it is widely recognizable in pop culture, or collector context (plain description, no hype). Empty string if obscure/unremarkable.",
  "litmus_track": "exact song title from Full Tracklist (WITHOUT artist prefix) of the single best/most representative track to preview",
  "litmus_artist": "performing artist of litmus_track",
  "notable_songs": [
    { "artist": "performing artist", "title": "exact song title from Tracklist", "reason": "short 6-12 word reason it stands out" }
  ]
}
Include up to 6 genuinely recognizable songs in notable_songs (or empty array if none).`;

    try {
      const res = await CC.callAI([{ text: prompt }], null, { retryLabel: 'Taste Check' });
      setStatus('', false);
      tasteCache.set(cacheKey, res);
      if (myRunId !== scanRunId || currentInspected !== item) return;
      applyTasteUI(item, res, myRunId);
    } catch (err) {
      setStatus('', false);
      if (myRunId !== scanRunId || currentInspected !== item) return;
      document.getElementById('tasteScore').textContent = '⚠️';
      document.getElementById('tasteBody').innerHTML = `
        <div style="margin-bottom:8px; color:#fde68a;">${esc(err.name === 'AbortError' ? 'Cancelled.' : err.message)}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="retryCurrentTaste()">🔄 Retry Taste Check</button>
      `;
    }
  }

  // ==================== OPTIONAL SPOTIFY -> TASTE PROFILE AUTO-DRAFTER ====================
  window.analyzeFullSpotifyDNA = async () => {
    saveSettings(true);
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); return; }
    if (!spotifyProfile || !spotifyProfile.totalArtists) { toast('Sync your Spotify library first'); return; }

    const btn = document.getElementById('btnAnalyzeDna');
    btn.disabled = true;

    try {
      const artistsList = Object.values(spotifyProfile.allArtists || {}).sort((a, b) => (b.count || 0) - (a.count || 0));
      const playlistsText = (spotifyProfile.playlistSummaries || []).map(p => `${p.name} (${p.count})`).join(', ') || 'None';
      const decadesText = Object.entries(spotifyProfile.decades || {}).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d}: ${c}`).join(', ') || 'N/A';
      const userSoftSpots = (document.getElementById('cfgSoftSpots')?.value || spotifyProfile.softSpots || '').trim();

      const lines = artistsList.map(a => {
        const tracks = Array.isArray(a.tracks) && a.tracks.length ? `: ${a.tracks.join(' | ')}` : '';
        return `${a.name} (${a.count || 1})${tracks}`;
      });

      const hasPerArtistTracks = artistsList.some(a => Array.isArray(a.tracks) && a.tracks.length);
      if (!hasPerArtistTracks && Array.isArray(spotifyProfile.trackTitles) && spotifyProfile.trackTitles.length) {
        lines.push('\nALL TRACK TITLES:\n' + spotifyProfile.trackTitles.join(' | '));
      }

      const fullDump = lines.join('\n');
      const MAX_CHUNK_CHARS = 360000;
      const chunks = [];
      for (let i = 0; i < fullDump.length; i += MAX_CHUNK_CHARS) {
        chunks.push(fullDump.slice(i, i + MAX_CHUNK_CHARS));
      }

      let finalDna = '';
      if (chunks.length === 1) {
        setStatus(`🧠 Drafting Taste Profile from ${spotifyProfile.totalArtists} artists & ${spotifyProfile.totalTracks} tracks...`, true, { cancellable: true });
        const prompt = `You are a musicologist building a permanent, hyper-accurate "Taste Profile" for a physical media collector from 100% of their Spotify library (EVERY artist, EVERY song, and EVERY playlist — nothing skipped).

LIBRARY STATS: ${spotifyProfile.totalArtists} unique artists · ${spotifyProfile.totalTracks} tracks · ${spotifyProfile.totalPlaylists || 0} playlists.
DECADES: ${decadesText}
ALL PLAYLISTS: ${playlistsText}
USER'S EXPLICIT SOFT SPOTS / NICHE POCKETS: ${userSoftSpots || 'None specified'}

COMPLETE ARTIST & TRACK LIBRARY:
${chunks[0]}

Write a dense, super-specific ~450-word Taste Profile dossier with these exact sections (plain text, no markdown bloat):
1. CORE OBSESSIONS: Primary genres, sub-genres, bands, and exact sonic traits (guitar tone, synths, vocals, rhythm).
2. SECONDARY & NICHE POCKETS: Smaller but real pockets across the full library (e.g. Italo Disco, Euro-dance, synthwave, movie/game soundtracks, funk, comedy/novelty, specific deep-cut eras) so we NEVER underrate a release that fits a smaller playlist or 1-song artist.
3. ERA & PRODUCTION SWEET SPOTS: Favorite decades and production aesthetics.
4. CLEAR BLIND SPOTS / LIKELY SKIPS: Genres/styles noticeably absent or rare in the library (NEVER list anything present in their library or explicit Soft Spots as a blind spot).`;

        finalDna = await CC.callAI([{ text: prompt }], 'MEDIUM', { expectJSON: false, retryLabel: 'Taste Profile Draft' });
      } else {
        const partials = [];
        for (let i = 0; i < chunks.length; i++) {
          setStatus(`🧠 Analyzing library chunk ${i + 1}/${chunks.length}...`, true, { cancellable: true });
          const p = `Analyze chunk ${i + 1} of ${chunks.length} of a user's complete Spotify library. List EVERY distinct genre, sub-genre, era, sonic trait, and notable artist pocket present in this chunk (250 words max).\n\n${chunks[i]}`;
          partials.push(await CC.callAI([{ text: p }], 'MEDIUM', { expectJSON: false, retryLabel: `Taste Draft (${i + 1}/${chunks.length})` }));
          if (i < chunks.length - 1) await CC.sleep(4000);
        }
        setStatus(`🧠 Merging ${partials.length} chunks into master Taste Profile...`, true, { cancellable: true });
        const mergeP = `Merge these ${partials.length} library chunk analyses + playlists (${playlistsText}) + decades (${decadesText}) + explicit Soft Spots (${userSoftSpots || 'None'}) into one cohesive ~450-word Taste Profile dossier covering: 1. CORE OBSESSIONS, 2. SECONDARY & NICHE POCKETS, 3. ERA & PRODUCTION SWEET SPOTS, 4. CLEAR BLIND SPOTS / LIKELY SKIPS.\n\n${partials.join('\n\n---\n\n')}`;
        finalDna = await CC.callAI([{ text: mergeP }], 'MEDIUM', { expectJSON: false, retryLabel: 'Taste Draft Merge' });
      }

      spotifyProfile.tasteDna = finalDna;
      spotifyProfile.softSpots = userSoftSpots;
      spotifyProfile.dnaUpdatedAt = Date.now();
      await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
      tasteCache.clear();
      document.getElementById('cfgTasteDna').value = finalDna;
      updateSpotifyUI();
      setStatus('', false);
      toast(`🧠 Taste Profile drafted from ${spotifyProfile.totalArtists} artists & ${spotifyProfile.totalTracks} tracks!`, 4200);
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast('Taste Profile error: ' + err.message, 4500);
    } finally {
      btn.disabled = false;
    }
  };

  window.saveTasteDnaManual = async (silent = false) => {
    if (!spotifyProfile) {
      spotifyProfile = { syncedAt: 0, userDisplayName: 'Manual Profile', topArtists: [], allArtists: {}, trackPairs: [], trackTitles: [], playlistSummaries: [], decades: {}, totalTracks: 0, totalArtists: 0, totalPlaylists: 0, tasteDna: '', softSpots: '' };
    }
    spotifyProfile.tasteDna = document.getElementById('cfgTasteDna').value.trim();
    spotifyProfile.softSpots = document.getElementById('cfgSoftSpots').value.trim();
    spotifyProfile.dnaUpdatedAt = Date.now();
    await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
    tasteCache.clear();
    updateSpotifyUI();
    if (!silent) toast('Taste Profile & Soft Spots saved!');
  };

  // ==================== PILE / SHELF ZOOM-PAN CONTROLLER ====================
  function createZoomPanController(viewportEl, contentEl, labelEl) {
    const state = { scale: 1, tx: 0, ty: 0 };
    const pointers = new Map();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let panStartX = 0;
    let panStartY = 0;
    let panOriginTx = 0;
    let panOriginTy = 0;
    let dragged = false;

    function clampAndApply() {
      state.scale = Math.max(1, Math.min(6, state.scale));
      if (state.scale <= 1.01) {
        state.scale = 1;
        state.tx = 0;
        state.ty = 0;
      } else {
        const vw = viewportEl.clientWidth || 300;
        const vh = viewportEl.clientHeight || 300;
        const cw = contentEl.offsetWidth || vw;
        const ch = contentEl.offsetHeight || vh;
        const maxTx = Math.max(0, (cw * state.scale - vw) / 2 + 40);
        const maxTy = Math.max(0, (ch * state.scale - vh) / 2 + 40);
        state.tx = Math.max(-maxTx, Math.min(maxTx, state.tx));
        state.ty = Math.max(-maxTy, Math.min(maxTy, state.ty));
      }
      contentEl.style.transform = `translate3d(${state.tx}px, ${state.ty}px, 0) scale(${state.scale})`;
      contentEl.style.setProperty('--pin-damp', Math.pow(state.scale, 0.72).toFixed(3));
      if (labelEl) labelEl.textContent = `${Math.round(state.scale * 100)}%`;
    }

    function dist(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    viewportEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pile-pin')) return;
      viewportEl.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged = false;
      if (pointers.size === 1) {
        panStartX = e.clientX;
        panStartY = e.clientY;
        panOriginTx = state.tx;
        panOriginTy = state.ty;
      } else if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        pinchStartDist = Math.max(1, dist(pts[0], pts[1]));
        pinchStartScale = state.scale;
      }
    });

    viewportEl.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        dragged = true;
        const pts = Array.from(pointers.values());
        const d = dist(pts[0], pts[1]);
        state.scale = pinchStartScale * (d / pinchStartDist);
        clampAndApply();
      } else if (pointers.size === 1 && state.scale > 1.01) {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        if (Math.hypot(dx, dy) > 6) dragged = true;
        state.tx = panOriginTx + dx;
        state.ty = panOriginTy + dy;
        clampAndApply();
      }
    });

    const endPtr = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size === 1) {
        const rem = Array.from(pointers.values())[0];
        panStartX = rem.x;
        panStartY = rem.y;
        panOriginTx = state.tx;
        panOriginTy = state.ty;
      }
    };

    viewportEl.addEventListener('pointerup', (e) => {
      const wasSingleTap = pointers.size === 1 && !dragged;
      endPtr(e);
      if (wasSingleTap && !e.target.closest('.pile-pin') && activePileIdx !== null) {
        clearPileHighlight();
      }
    });
    viewportEl.addEventListener('pointercancel', endPtr);

    viewportEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.35 : -0.35;
      state.scale += delta;
      clampAndApply();
    }, { passive: false });

    return {
      step(delta) {
        state.scale += delta;
        clampAndApply();
      },
      reset() {
        state.scale = 1;
        state.tx = 0;
        state.ty = 0;
        clampAndApply();
      },
      refresh: clampAndApply
    };
  }

  window.stepPileZoom = (which, delta) => {
    const ctrl = which === 'fs' ? pileZoomFs : pileZoomInline;
    if (ctrl) ctrl.step(delta);
  };

  window.resetPileZoom = (which) => {
    const ctrl = which === 'fs' ? pileZoomFs : pileZoomInline;
    if (ctrl) ctrl.reset();
  };

  // ==================== MODERNIZED PILE / SHELF SCAN ====================
  function normalizePileGeometry(raw) {
    const scaleVal = (v, isUnit) => Math.max(0, Math.min(1000, isUnit ? v * 1000 : v));

    let poly = null;
    if (Array.isArray(raw.poly) && raw.poly.length >= 4) {
      const flat = raw.poly.slice(0, 4).flatMap(p => (Array.isArray(p) && p.length >= 2) ? [Number(p[0]), Number(p[1])] : [NaN, NaN]);
      if (flat.every(Number.isFinite)) {
        const isUnit = Math.max(...flat) > 0 && Math.max(...flat) <= 1.01;
        poly = [];
        for (let i = 0; i < 4; i++) {
          poly.push([scaleVal(flat[i * 2], isUnit), scaleVal(flat[i * 2 + 1], isUnit)]);
        }
      }
    }

    if (!poly && Array.isArray(raw.box_2d) && raw.box_2d.length === 4) {
      const nums = raw.box_2d.map(Number);
      if (nums.every(Number.isFinite)) {
        const isUnit = Math.max(...nums) > 0 && Math.max(...nums) <= 1.01;
        let [y1, x1, y2, x2] = nums.map(v => scaleVal(v, isUnit));
        if (y1 > y2) [y1, y2] = [y2, y1];
        if (x1 > x2) [x1, x2] = [x2, x1];
        if ((y2 - y1) >= 6 && (x2 - x1) >= 6) {
          poly = [[y1, x1], [y1, x2], [y2, x2], [y2, x1]];
        }
      }
    }

    let point = null;
    if (Array.isArray(raw.point) && raw.point.length >= 2) {
      const py = Number(raw.point[0]);
      const px = Number(raw.point[1]);
      if (Number.isFinite(py) && Number.isFinite(px)) {
        const isUnit = Math.max(py, px) > 0 && Math.max(py, px) <= 1.01;
        point = [scaleVal(py, isUnit), scaleVal(px, isUnit)];
      }
    }

    if (!point && poly) {
      const cy = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cx = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      point = [cy, cx];
    }

    return { point, poly };
  }

  function applyLoadedPilePhoto(pair, autoAnalyze = true) {
    pileRunId++;
    pileBatchPriceRunning = false;
    pilePhoto = pair;
    pileResults = [];
    activePileIdx = null;

    document.getElementById('pilePreviewImg').src = pair.saveWebp;
    document.getElementById('pileFsImg').src = pair.saveWebp;
    document.getElementById('pileSvg').innerHTML = '';
    document.getElementById('pilePins').innerHTML = '';
    document.getElementById('pileFsSvg').innerHTML = '';
    document.getElementById('pileFsPins').innerHTML = '';
    document.getElementById('pileHighlightBar').classList.add('hidden');
    document.getElementById('pileFsHighlightBar').classList.add('hidden');
    document.getElementById('pilePhotoHint').textContent = 'Pinch or use +/− to zoom · Tap pins to spotlight';
    document.getElementById('pilePreviewWrap').classList.remove('hidden');
    document.getElementById('pileResultsCard').classList.add('hidden');
    if (pileZoomInline) pileZoomInline.reset();
    if (pileZoomFs) pileZoomFs.reset();

    if (autoAnalyze) runPileScan();
  }

  async function handlePilePhoto(file) {
    if (!file) return;
    setStatus('Decoding high-res pile photo (3072px AI / 2048px zoom)...', true);
    try {
      const pair = await decodeBlobToPhotoPair(file, { aiMaxDim: 3072, aiQuality: 0.92, saveMaxDim: 2048, saveQuality: 0.82 });
      setStatus('', false);
      applyLoadedPilePhoto(pair, true);
    } catch (err) {
      setStatus('', false);
      toast('Photo error: ' + (err?.message || 'Could not decode image'), 5500);
    }
  }

  window.openPileFullscreen = () => {
    if (!pilePhoto?.saveWebp) return;
    document.getElementById('pileFsImg').src = pilePhoto.saveWebp;
    document.getElementById('pileFullscreenModal').classList.remove('hidden');
    renderPileUI();
    if (pileZoomFs) pileZoomFs.reset();
    try { history.pushState({ view: currentView, modal: 'pileFs' }, ''); } catch (_) {}
  };

  window.closePileFullscreen = () => {
    hidePileFsUI();
    if (history.state?.modal === 'pileFs') {
      try { history.back(); } catch (_) {}
    }
  };

  window.resetPileScan = () => {
    pileRunId++;
    pileBatchPriceRunning = false;
    pilePhoto = null;
    pileResults = [];
    activePileIdx = null;
    hidePileFsUI();
    document.getElementById('pileSvg').innerHTML = '';
    document.getElementById('pilePins').innerHTML = '';
    document.getElementById('pileFsSvg').innerHTML = '';
    document.getElementById('pileFsPins').innerHTML = '';
    document.getElementById('pileHighlightBar').classList.add('hidden');
    document.getElementById('pileFsHighlightBar').classList.add('hidden');
    document.getElementById('pilePreviewWrap').classList.add('hidden');
    document.getElementById('pileResultsCard').classList.add('hidden');
    document.getElementById('pileGalleryInput').value = '';
    document.getElementById('pileCamInput').value = '';
    if (pileZoomInline) pileZoomInline.reset();
    if (pileZoomFs) pileZoomFs.reset();
  };

  window.clearPileHighlight = () => {
    activePileIdx = null;
    renderPileUI();
  };

  function formatPilePriceSummary(r) {
    if (r.priceStatus === 'loading') return '⏳ Checking rough Discogs price...';
    if (r.priceStatus === 'error') return '⚠️ Price unavailable · Tap to retry';
    const parts = [];
    if (r.roughAskVal !== null) parts.push(`~Ask: ${formatMoneyWithUsd(r.roughAskVal, r.roughAskCur)}`);
    if (r.roughVgVal !== null) parts.push(`~VG+: ${formatMoneyWithUsd(r.roughVgVal, r.roughVgCur)}`);
    if (parts.length) return parts.join(' · ');
    if (r.priceStatus === 'done') return '0 listed on Discogs';
    if (r.priceStatus === 'none') return 'No Discogs match found';
    return '';
  }

  function updatePilePriceBtn() {
    const btn = document.getElementById('btnPileCheckPrices');
    if (!btn) return;
    if (!cfg.discogsToken) {
      btn.textContent = '💰 Add Discogs Token';
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    const total = pileResults.length;
    const done = pileResults.filter(r => ['done', 'none'].includes(r.priceStatus)).length;
    if (pileBatchPriceRunning) {
      btn.textContent = `⏹️ Pricing ${done}/${total}...`;
    } else if (total > 0 && done >= total) {
      btn.textContent = '✅ Prices Checked';
    } else {
      btn.textContent = done > 0 ? `💰 Check Rest (${total - done})` : '💰 Check Prices';
    }
  }

  window.retryPileItemPrice = (idx, ev) => {
    if (ev) ev.stopPropagation();
    const r = pileResults[idx];
    if (!r) return;
    r.priceStatus = 'idle';
    fetchPileItemPrice(idx, pileRunId);
  };

  async function fetchPileItemPrice(idx, myPileRunId) {
    const r = pileResults[idx];
    if (!r || !cfg.discogsToken) return;
    if (r.priceStatus === 'loading' || r.priceStatus === 'done' || r.priceStatus === 'none') return;

    r.priceStatus = 'loading';
    renderPileUI();
    updatePilePriceBtn();

    try {
      const q = `${r.artist || ''} ${r.title || ''}`.trim();
      const sr = await CC.discogsFetch('/database/search', { type: 'release', q, format: r.format || 'Cassette', per_page: 25 });
      if (myPileRunId !== pileRunId) return;

      const results = sr.results || [];
      const prefCountry = norm(cfg.homeCountry || '');
      const top = results.slice().sort((a, b) => {
        const aHome = prefCountry && norm(a.country || '') === prefCountry ? 1 : 0;
        const bHome = prefCountry && norm(b.country || '') === prefCountry ? 1 : 0;
        if (bHome !== aHome) return bHome - aHome;
        return (b.community?.have || 0) - (a.community?.have || 0);
      })[0];

      if (!top) {
        r.priceStatus = 'none';
        renderPileUI();
        updatePilePriceBtn();
        return;
      }

      r.roughId = top.id;
      r.roughHave = top.community?.have || 0;
      r.roughWant = top.community?.want || 0;

      // Do NOT swallow /marketplace/stats errors into {} — surface real network/HTTP failures honestly!
      const st = await CC.discogsFetch(`/marketplace/stats/${top.id}`);
      if (myPileRunId !== pileRunId) return;
      r.roughForSale = st?.num_for_sale ?? 0;
      r.roughAskVal = st?.lowest_price?.value ?? null;
      r.roughAskCur = st?.lowest_price?.currency || 'USD';

      if (cfg.fetchVgSuggestions) {
        const sug = await CC.discogsFetch(`/marketplace/price_suggestions/${top.id}`).catch(() => null);
        if (myPileRunId !== pileRunId) return;
        const vg = sug?.['Very Good Plus (VG+)'];
        if (vg && vg.value !== undefined && vg.value !== null) {
          r.roughVgVal = vg.value;
          r.roughVgCur = vg.currency || r.roughAskCur || 'USD';
        }
      }

      r.roughVal = r.roughVgVal ?? r.roughAskVal;
      r.roughCur = r.roughVgVal !== null ? r.roughVgCur : r.roughAskCur;
      const usdApprox = toApproxUsd(r.roughVal, r.roughCur);
      r.highVal = usdApprox !== null && usdApprox >= Number(cfg.threshold || 20);
      r.priceStatus = 'done';
    } catch (_) {
      if (myPileRunId !== pileRunId) return;
      r.priceStatus = 'error';
    }

    if (myPileRunId === pileRunId) {
      renderPileUI();
      updatePilePriceBtn();
    }
  }

  window.fetchAllPilePrices = async () => {
    if (!cfg.discogsToken) { toast('Add your Discogs Token in Settings first'); return; }
    if (!pileResults.length) return;
    if (pileBatchPriceRunning) {
      pileBatchPriceRunning = false;
      updatePilePriceBtn();
      toast('Paused background price check');
      return;
    }

    const myPileRunId = pileRunId;
    pileBatchPriceRunning = true;
    updatePilePriceBtn();

    for (let i = 0; i < pileResults.length; i++) {
      if (!pileBatchPriceRunning || myPileRunId !== pileRunId) break;
      if (pileResults[i].priceStatus === 'idle' || pileResults[i].priceStatus === 'error') {
        await fetchPileItemPrice(i, myPileRunId);
      }
    }

    if (myPileRunId === pileRunId) {
      pileBatchPriceRunning = false;
      updatePilePriceBtn();
    }
  };

  window.selectPileItem = (idx, fromOverlay = false, ev = null) => {
    if (ev) ev.stopPropagation();
    if (idx < 0 || idx >= pileResults.length) return;
    activePileIdx = (activePileIdx === idx && !fromOverlay) ? null : idx;
    renderPileUI();

    if (activePileIdx !== null) {
      const sel = pileResults[activePileIdx];
      if (cfg.discogsToken && (sel.priceStatus === 'idle' || sel.priceStatus === 'error')) {
        fetchPileItemPrice(activePileIdx, pileRunId);
      }
      const fsOpen = !document.getElementById('pileFullscreenModal').classList.contains('hidden');
      if (!fsOpen) {
        if (fromOverlay) {
          const card = document.getElementById(`pileCard-${activePileIdx}`);
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          document.getElementById('pilePreviewWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  };

  function renderPileOverlayInto(svgEl, pinsEl, maskId) {
    if (!svgEl || !pinsEl) return;
    const sel = (activePileIdx !== null && pileResults[activePileIdx]) ? pileResults[activePileIdx] : null;
    const hasFocus = Boolean(sel && (sel.poly || sel.point));

    if (hasFocus) {
      const strokeColor = sel.highVal ? '#fbbf24' : '#22c55e';
      let cutout = '';
      let outline = '';
      if (sel.poly && sel.poly.length >= 4) {
        const ptsAttr = sel.poly.map(([y, x]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        cutout = `<polygon points="${ptsAttr}" fill="black" />`;
        outline = `<polygon points="${ptsAttr}" fill="none" stroke="${strokeColor}" stroke-width="6" stroke-linejoin="round" />`;
      } else if (sel.point) {
        const [py, px] = sel.point;
        cutout = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="48" fill="black" />`;
        outline = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="48" fill="none" stroke="${strokeColor}" stroke-width="6" />`;
      }
      svgEl.innerHTML = `
        <defs>
          <mask id="${maskId}">
            <rect x="0" y="0" width="1000" height="1000" fill="white" />
            ${cutout}
          </mask>
        </defs>
        <rect x="0" y="0" width="1000" height="1000" fill="rgba(0,0,0,0.68)" mask="url(#${maskId})" />
        ${outline}
      `;
    } else {
      svgEl.innerHTML = '';
    }

    pinsEl.classList.toggle('has-focus', hasFocus);
    pinsEl.innerHTML = pileResults.map((r, i) => {
      if (!r.point) return '';
      const [py, px] = r.point;
      const cls = [
        'pile-pin',
        r.highVal ? 'hot' : (r.taste_score >= 7 ? 'good' : ''),
        activePileIdx === i ? 'active' : ''
      ].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" style="left:${(px / 10).toFixed(2)}%; top:${(py / 10).toFixed(2)}%;" onclick="selectPileItem(${i}, true, event)" title="#${i + 1}: ${esc(r.artist || '')} - ${esc(r.title || '')}">${i + 1}</button>`;
    }).join('');
  }

  function buildHighlightBarHtml(r, idx) {
    const priceSummary = formatPilePriceSummary(r);
    return `
      <div>
        <div style="font-weight:800; font-size:0.9rem; color:#f1f5f9;">#${idx + 1}: ${esc(r.artist || '?')} — ${esc(r.title || '?')}</div>
        <div style="font-size:0.78rem; color:#cbd5e1; margin-top:2px;">
          🎧 ${r.taste_score}/10${priceSummary ? ` · ${esc(priceSummary)}` : ''}${r.taste_reason ? ` · ${esc(r.taste_reason)}` : ''}${(!r.point && !r.poly) ? ' · (position not detected)' : ''}
        </div>
      </div>
      <div class="inline-actions" style="gap:6px;">
        <button type="button" class="btn btn-green btn-sm" style="flex:1;" onclick="jumpFromPileToSingle(${idx})">🔍 Verify This Tape</button>
        ${r.priceStatus === 'error' ? `<button type="button" class="btn btn-secondary btn-sm" onclick="retryPileItemPrice(${idx}, event)">🔄 Retry Price</button>` : ''}
        ${r.roughId ? `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/history/${r.roughId}">📈 Sales History</a>` : ''}
        <button type="button" class="btn btn-secondary btn-sm" onclick="clearPileHighlight()">✕ Clear</button>
      </div>
    `;
  }

  function renderPileUI() {
    renderPileOverlayInto(document.getElementById('pileSvg'), document.getElementById('pilePins'), 'pileMaskInline');
    renderPileOverlayInto(document.getElementById('pileFsSvg'), document.getElementById('pileFsPins'), 'pileMaskFs');

    const bar = document.getElementById('pileHighlightBar');
    const fsBar = document.getElementById('pileFsHighlightBar');
    if (activePileIdx !== null && pileResults[activePileIdx]) {
      const html = buildHighlightBarHtml(pileResults[activePileIdx], activePileIdx);
      bar.innerHTML = html;
      bar.classList.remove('hidden');
      fsBar.innerHTML = html;
      fsBar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      fsBar.classList.add('hidden');
      fsBar.innerHTML = '';
    }

    const list = document.getElementById('pileResultsList');
    list.innerHTML = pileResults.map((r, i) => {
      const askBadge = r.roughAskVal !== null
        ? `<span class="badge ${r.highVal && r.roughVgVal === null ? 'badge-yellow' : 'badge-blue'}">~Ask: ${esc(formatMoneyWithUsd(r.roughAskVal, r.roughAskCur))}</span>`
        : '';
      const vgBadge = r.roughVgVal !== null
        ? `<span class="badge ${r.highVal ? 'badge-yellow' : 'badge-purple'}">~VG+: ${esc(formatMoneyWithUsd(r.roughVgVal, r.roughVgCur))}</span>`
        : '';
      const statusBadge = r.priceStatus === 'loading'
        ? `<span class="badge" style="background:#0d1017; color:#fde68a;">⏳ Pricing...</span>`
        : r.priceStatus === 'error'
          ? `<button type="button" class="badge badge-red" style="border:none; cursor:pointer;" onclick="retryPileItemPrice(${i}, event)">⚠️ Price unavailable · Tap to retry</button>`
          : (r.priceStatus === 'done' && r.roughAskVal === null && r.roughVgVal === null)
            ? `<span class="badge" style="background:#0d1017; color:var(--muted);">0 listed</span>`
            : (r.priceStatus === 'none')
              ? `<span class="badge" style="background:#0d1017; color:var(--muted);">No Discogs hit</span>`
              : '';
      const histLink = r.roughId
        ? `<a class="badge badge-blue" style="text-decoration:none;" target="_blank" rel="noopener" onclick="event.stopPropagation();" href="https://www.discogs.com/sell/history/${r.roughId}">📈 Sales ↗</a>`
        : '';

      return `
        <div id="pileCard-${i}" class="pile-item ${activePileIdx === i ? 'active' : ''}" onclick="selectPileItem(${i}, false)">
          <div style="flex:1; min-width:0;">
            <div class="candidate-title"><span style="color:#93c5fd;">#${i + 1}</span> ${esc(r.artist || '?')} — ${esc(r.title || '?')}</div>
            <div class="candidate-sub">${esc(r.format || 'Cassette')}${r.catno ? ` · ${esc(r.catno)}` : ''}${r.taste_reason ? ` · ${esc(r.taste_reason)}` : ''}</div>
            <div>
              <span class="badge ${r.taste_score >= 7 ? 'badge-green' : r.taste_score >= 5 ? 'badge-blue' : 'badge-red'}">🎧 ${r.taste_score}/10</span>
              ${r.localArtistHit ? `<span class="badge badge-green">In Spotify</span>` : ''}
              ${askBadge}${vgBadge}${statusBadge}${histLink}
              ${(r.roughWant > r.roughHave && r.roughWant >= 15) ? `<span class="badge badge-purple">💎 High Want (${r.roughWant})</span>` : ''}
              ${(r.point || r.poly) ? `<span class="badge" style="background:#0d1017; color:#93c5fd;">📍 #${i + 1}</span>` : ''}
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" style="min-height:34px; padding:5px 9px; flex:0 0 auto;" onclick="jumpFromPileToSingle(${i}); event.stopPropagation();">Verify ›</button>
        </div>
      `;
    }).join('');
  }

  window.runPileScan = async () => {
    if (!pilePhoto) return;
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); switchView('settings'); return; }

    pileRunId++;
    const myPileRunId = pileRunId;
    pileBatchPriceRunning = false;

    document.getElementById('pileResultsCard').classList.add('hidden');
    activePileIdx = null;
    const fmtLabel = activeFormat === 'Auto' ? 'all formats' : `${activeFormat}s only`;
    setStatus(`📚 Step 1/2: Reading & locating ${fmtLabel} (ultra-high detail)...`, true, { cancellable: true });

    const formatRule = activeFormat === 'Auto'
      ? '- Extract legible Cassettes, CDs, and Vinyl — from BOTH spines AND visible front covers/faces.'
      : `- FORMAT FILTER ACTIVE: The user selected "${activeFormat}". ONLY extract ${activeFormat} items and strictly IGNORE all other formats in the photo. Read both spines AND visible front covers/faces of ${activeFormat} items.`;

    try {
      const ocrPrompt = `You are inspecting a high-resolution photo of a crate, shelf, box, or stack of physical music media (cassettes, CDs, and/or vinyl).

SYSTEMATIC COVERAGE & ACCURACY RULES:
- Dense shelves can contain 60–100+ items. Scan systematically ROW-BY-ROW and STACK-BY-STACK (top-to-bottom, left-to-right) so you do not skip legible items.
${formatRule}
- Extract EVERY item whose title or artist is clearly legible.
- NEVER guess blurry, obscured, or cut-off items — just count them in "unreadable_count".
- For EACH legible item, return BOTH:
  1. "point": [y, x] — the exact center point of that spine or cover on a 0–1000 normalized scale (0 = top/left, 1000 = bottom/right).
  2. "poly": [[y1, x1], [y2, x2], [y3, x3], [y4, x4]] — a tight 4-corner clockwise rotated polygon hugging that exact tilted/angled spine or cover (0–1000 normalized).

Return ONLY valid JSON:
{
  "unreadable_count": number,
  "items": [
    {
      "artist": "artist name",
      "title": "album/release title",
      "format": "Cassette" | "CD" | "Vinyl",
      "catno": "catalog # if readable else empty string",
      "point": [y, x],
      "poly": [[y1, x1], [y2, x2], [y3, x3], [y4, x4]]
    }
  ]
}`;
      const ocr = await CC.callAI(
        [{ text: ocrPrompt }, { inline_data: { mime_type: 'image/jpeg', data: pilePhoto.apiB64 } }],
        'MEDIUM',
        {
          retryLabel: 'Pile OCR',
          maxOutputTokens: 16384,
          mediaResolution: 'MEDIA_RESOLUTION_ULTRA_HIGH'
        }
      );
      if (myPileRunId !== pileRunId) return;

      let items = Array.isArray(ocr.items) ? ocr.items.filter(x => x.title || x.artist) : [];
      if (activeFormat !== 'Auto') {
        items = items.filter(x => !x.format || norm(x.format) === norm(activeFormat));
      }
      if (!items.length) {
        setStatus('', false);
        toast(`Could not read any legible ${activeFormat === 'Auto' ? 'items' : activeFormat + 's'} — try brighter light or zoom closer`, 4200);
        return;
      }

      setStatus(`📚 Step 2/2: Scoring ${items.length} item(s) against your Taste Profile & Soft Spots...`, true, { cancellable: true });
      const dna = spotifyProfile?.tasteDna || (spotifyProfile?.topArtists || []).slice(0, 150).join(', ') || 'Not specified';
      const softSpots = spotifyProfile?.softSpots || 'None specified';

      const enrichedForPrompt = items.map((x, i) => {
        const localArtistHit = Boolean(spotifyProfile && x.artist && spotifyProfile.allArtists?.[norm(x.artist)]);
        return { idx: i, artist: x.artist, title: x.title, format: x.format, artist_in_spotify_library: localArtistHit };
      });

      const tastePrompt = `Batch-score these ${items.length} music releases for a collector based on their Taste Profile and explicit Soft Spots.

User's Taste Profile:
${dna}

User's Explicit Soft Spots & Niche Pockets (FIRST-CLASS WEIGHT — treat these with EQUAL importance to Core Obsessions so smaller 5–15 song favorite pockets are NEVER averaged out):
${softSpots}

CRITICAL SCORING RULES:
1. EVALUATE BOTH THE SPECIFIC ALBUM/RELEASE AND THE ARTIST: Do NOT lazily give an automatic 8–10 just because an artist appears once in Spotify! Consider the specific album's era, genre/sound, whether it is an essential studio album vs a weak late-era album, budget compilation, greatest hits, holiday, or novelty release, and how closely THAT specific release matches the user's Taste Profile and Soft Spots.
2. Still fairly credit genuine Spotify library matches ("artist_in_spotify_library": true) and NEVER dismiss a library artist as "outside your taste" — just distinguish classic/prime releases (8–10) from weaker/mismatching releases by that artist (5–7).
3. Treat Soft Spots & Niche Pockets as equal-weight favorites.

Items:
${JSON.stringify(enrichedForPrompt)}

Return ONLY valid JSON:
{
  "scores": [
    { "idx": number, "score": 1 to 10 integer, "reason": "short 6-12 word reason referencing both album and fit" }
  ]
}`;
      const tasteBatch = await CC.callAI([{ text: tastePrompt }], null, { retryLabel: 'Pile Taste', maxOutputTokens: 8192 });
      if (myPileRunId !== pileRunId) return;

      const scoreMap = new Map((tasteBatch.scores || []).map(s => [s.idx, s]));

      pileResults = items.map((it, i) => {
        const sc = scoreMap.get(i) || { score: 5, reason: '' };
        const localArtistHit = Boolean(spotifyProfile && it.artist && spotifyProfile.allArtists?.[norm(it.artist)]);
        const geom = normalizePileGeometry(it);
        return {
          ...it,
          point: geom.point,
          poly: geom.poly,
          taste_score: sc.score,
          taste_reason: sc.reason,
          localArtistHit,
          priceStatus: 'idle',
          roughId: null,
          roughHave: 0,
          roughWant: 0,
          roughForSale: null,
          roughAskVal: null,
          roughAskCur: 'USD',
          roughVgVal: null,
          roughVgCur: 'USD',
          roughVal: null,
          roughCur: 'USD',
          highVal: false
        };
      });

      pileResults.sort((a, b) => ((b.taste_score || 0) - (a.taste_score || 0)) || (Number(b.localArtistHit) - Number(a.localArtistHit)));

      setStatus('', false);
      document.getElementById('pileCount').textContent = pileResults.length;
      document.getElementById('pilePhotoHint').textContent = 'Pinch or use +/− to zoom · Tap any numbered pin to spotlight';
      document.getElementById('pileSkippedNote').textContent = ocr.unreadable_count
        ? `Skipped ${ocr.unreadable_count} blurry/unreadable item(s). Tap any pin or card to spotlight & check rough Discogs pricing, or tap 💰 Check Prices.`
        : 'Tap any pin or card to spotlight & check rough Discogs pricing, or tap 💰 Check Prices.';

      renderPileUI();
      updatePilePriceBtn();
      document.getElementById('pileResultsCard').classList.remove('hidden');
      document.getElementById('pileResultsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast('Pile scan error: ' + err.message, 4500);
    }
  };

  window.jumpFromPileToSingle = (idx) => {
    if (!pileResults[idx]) return;
    hidePileFsUI();
    if (history.state?.modal === 'pileFs') {
      try { history.replaceState({ view: currentView, modal: null }, ''); } catch (_) {}
    }
    setScanMode('single');
    resetScanner(); // Clean slate: ZERO prefilled/guessed metadata; Pile tab state remains intact
    openCameraViewfinder('single');
  };

  // ==================== HARDENED RECOVERABLE DISCOGS SWAPS & SAVE ====================
  async function attemptDeleteOldCopy(record) {
    const oldInfo = record?.pending_delete_old;
    if (!oldInfo || !oldInfo.releaseId || !cfg.discogsUser) return { ok: true, warning: '' };

    try {
      let oldInst = oldInfo.instanceId || null;
      let oldFolder = oldInfo.folderId || '1';

      if (!oldInst) {
        const insts = await CC.findDiscogsInstances(oldInfo.releaseId);
        if (insts.length === 0) {
          record.pending_delete_old = null;
          await CC.idbPut('stash', record);
          return { ok: true, warning: '' };
        }
        if (insts.length > 1) {
          record.pending_delete_old = { ...oldInfo, ambiguous: true, copyCount: insts.length };
          await CC.idbPut('stash', record);
          return {
            ok: false,
            warning: `You own ${insts.length} copies of old pressing #${oldInfo.releaseId} on Discogs — kept untouched so the wrong copy isn't deleted. Please remove the duplicate manually on Discogs.`
          };
        }
        oldInst = insts[0].instance_id;
        oldFolder = String(insts[0].folder_id || oldFolder);
      }

      await CC.deleteDiscogsInstance(oldFolder, oldInfo.releaseId, oldInst);
      record.pending_delete_old = null;
      await CC.idbPut('stash', record);
      return { ok: true, warning: '' };
    } catch (delErr) {
      return {
        ok: false,
        warning: `New pressing saved, but removing old #${oldInfo.releaseId} failed (${delErr.message}). You can retry safely from Stash Detail.`
      };
    }
  }

  window.saveCurrentItem = async (syncToDiscogs) => {
    if (!currentInspected) return;

    if (syncToDiscogs && currentInspected.is_conservative_tiebreak && !document.getElementById('chkConfirmTiebreak')?.checked) {
      toast('Please check the confirmation box for this conservative tie-breaker pick first', 3800);
      return;
    }

    const mediaCond = document.getElementById('gMediaCond').value || 'Very Good Plus (VG+)';
    const sleeveCond = document.getElementById('gSleeveCond').value || 'Very Good Plus (VG+)';
    const condNote = document.getElementById('gNotes').value.trim();

    currentInspected.media_condition = mediaCond;
    currentInspected.sleeve_condition = sleeveCond;
    currentInspected.condition_note = condNote;

    const isEditing = Boolean(editingStashItem);
    const oldItem = editingStashItem;
    const changedRelease = isEditing && Number(oldItem.discogs_id || 0) !== Number(currentInspected.discogs_id || 0);
    const sameRelease = isEditing && oldItem.synced_to_discogs && Number(oldItem.discogs_id) === Number(currentInspected.discogs_id);
    const swappedRelease = isEditing && oldItem.synced_to_discogs && oldItem.discogs_id && Number(oldItem.discogs_id) !== Number(currentInspected.discogs_id);

    let synced = isEditing ? Boolean(oldItem.synced_to_discogs) : false;
    let folderId = isEditing ? (oldItem.discogs_folder_id || cfg.discogsFolderId || '1') : (cfg.discogsFolderId || '1');
    let instanceId = isEditing ? (oldItem.discogs_instance_id || null) : null;
    let pendingDiscogsSync = isEditing ? Boolean(oldItem.pending_discogs_sync) : false;
    let pendingDeleteOld = isEditing ? (oldItem.pending_delete_old || null) : null;

    let fieldRes = { okCount: 0, failedCount: 0, errors: [] };
    let allFieldsFailed = false;

    const newThumbs = stagedPhotos.map(p => p.saveWebp);
    const finalThumbs = newThumbs.length ? newThumbs : (isEditing ? (oldItem.thumbs || (oldItem.thumb_data_url ? [oldItem.thumb_data_url] : [])) : []);

    const buildRecord = () => {
      const rec = {
        ...currentInspected,
        synced_to_discogs: synced,
        pending_discogs_sync: pendingDiscogsSync,
        pending_delete_old: pendingDeleteOld,
        discogs_folder_id: synced ? folderId : null,
        discogs_instance_id: synced ? instanceId : null,
        thumbs: finalThumbs,
        thumb_data_url: finalThumbs[0] || currentInspected.discogs_thumb || '',
        created_at: isEditing ? (oldItem.created_at || Date.now()) : Date.now(),
        updated_at: Date.now()
      };
      if (isEditing) rec.id = oldItem.id;
      return rec;
    };

    if (syncToDiscogs) {
      if (!cfg.discogsToken || !cfg.discogsUser || !currentInspected.discogs_id) {
        toast('Verify Discogs in Settings first');
        return;
      }

      try {
        if (sameRelease) {
          setStatus('Updating grades & notes on your existing Discogs item...', true);
          if (!instanceId) {
            const insts = await CC.findDiscogsInstances(oldItem.discogs_id);
            if (insts.length === 1) { instanceId = insts[0].instance_id; folderId = String(insts[0].folder_id || folderId); }
          }
          if (instanceId) {
            fieldRes = await CC.syncDiscogsInstanceFields(folderId, currentInspected.discogs_id, instanceId, mediaCond, sleeveCond, condNote);
          }
          synced = true;
          pendingDiscogsSync = false;
        } else {
          // 1. Add new verified pressing to Discogs FIRST & require a valid newInstanceId
          folderId = cfg.discogsFolderId || '1';
          setStatus(`Adding verified pressing #${currentInspected.discogs_id} to Discogs...`, true);
          const addRes = await CC.discogsFetch(
            `/users/${encodeURIComponent(cfg.discogsUser)}/collection/folders/${encodeURIComponent(folderId)}/releases/${currentInspected.discogs_id}`,
            {},
            'POST'
          );
          const newInstanceId = addRes?.instance_id || null;
          if (!newInstanceId) {
            throw new Error('Discogs did not return a new instance_id — old copy kept untouched');
          }

          instanceId = newInstanceId;
          synced = true;
          pendingDiscogsSync = false;

          // 2. Sync Media/Sleeve/Notes fields on the new instance
          setStatus('Saving Media/Sleeve grade & notes to Discogs...', true);
          fieldRes = await CC.syncDiscogsInstanceFields(folderId, currentInspected.discogs_id, instanceId, mediaCond, sleeveCond, condNote);
          allFieldsFailed = fieldRes.okCount === 0 && fieldRes.failedCount > 0;

          if (swappedRelease) {
            pendingDeleteOld = {
              releaseId: oldItem.discogs_id,
              folderId: oldItem.discogs_folder_id || '1',
              instanceId: oldItem.discogs_instance_id || null
            };
          }
        }
      } catch (err) {
        setStatus('', false);
        toast('Discogs sync failed (old copy untouched): ' + err.message, 5200);
        return;
      }
    } else if (changedRelease) {
      // Editing to a different discogs_id locally: clear stale remote instance_id & preserve pending_delete_old for later Push
      if (oldItem.synced_to_discogs && oldItem.discogs_id) {
        pendingDeleteOld = {
          releaseId: oldItem.discogs_id,
          folderId: oldItem.discogs_folder_id || '1',
          instanceId: oldItem.discogs_instance_id || null
        };
      }
      instanceId = null;
      folderId = null;
      synced = false;
      pendingDiscogsSync = true;
    }

    // 3. IMMEDIATELY persist updated Stash record to IndexedDB BEFORE deleting any old Discogs copy
    const record = buildRecord();
    try {
      const savedKey = await CC.idbPut('stash', record);
      if (!record.id) record.id = savedKey;
    } catch (err) {
      setStatus('', false);
      toast('Local save failed: ' + err.message, 4500);
      return;
    }

    // 4. Only now delete the old copy (unless ALL grade/note field writes failed!)
    let oldDeleteWarning = '';
    if (syncToDiscogs && record.pending_delete_old) {
      if (allFieldsFailed) {
        oldDeleteWarning = `All ${fieldRes.failedCount} grade/note fields failed to sync — old copy #${record.pending_delete_old.releaseId} was kept safely on Discogs. Retry from Stash Detail.`;
      } else {
        setStatus(`Removing old pressing #${record.pending_delete_old.releaseId} from Discogs...`, true);
        const delRes = await attemptDeleteOldCopy(record);
        if (!delRes.ok) oldDeleteWarning = delRes.warning;
      }
    }

    await loadStashCache();
    setStatus('', false);

    if (oldDeleteWarning) {
      toast(`⚠️ ${oldDeleteWarning}`, 6000);
    } else if (fieldRes.failedCount > 0) {
      toast(`⚠️ Saved to Discogs, but ${fieldRes.failedCount} field(s) failed: ${fieldRes.errors[0] || ''}`, 5200);
    } else if (isEditing) {
      toast(syncToDiscogs
        ? '✅ Stash & Discogs updated cleanly!'
        : (pendingDiscogsSync ? '💾 Updated locally (marked Pending Discogs Sync)' : '💾 Stash updated!'));
    } else {
      toast(synced ? `✅ Saved to Discogs${fieldRes.okCount ? ' (with grades!)' : ''} & Stash!` : '💾 Saved to Local Stash!');
    }

    editingStashItem = null;
    document.getElementById('editModeBanner').classList.add('hidden');
    resetScanner();
  };

  window.startEditStashItem = (id) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    closeStashDetail();
    setScanMode('single');
    switchView('scan');
    resetScanner();

    editingStashItem = { ...it };
    document.getElementById('editModeTitle').textContent = `${it.artist} — ${it.title} (${it.discogs_id ? '#' + it.discogs_id : 'Local Only'} · Saved Grade: ${shortGrade(it.media_condition || 'VG+')}/${shortGrade(it.sleeve_condition || 'VG+')})`;
    document.getElementById('chkRegradeEdit').checked = false;
    document.getElementById('editModeBanner').classList.remove('hidden');

    document.getElementById('fTitle').value = it.title || '';
    document.getElementById('fArtist').value = it.artist || '';
    document.getElementById('fCatno').value = it.catno || '';
    document.getElementById('fLabel').value = it.label || '';
    document.getElementById('fYear').value = it.year || '';
    if (['Cassette', 'CD', 'Vinyl'].includes(it.format)) document.getElementById('fFormat').value = it.format;
    updateStageUI();
    toast('Take new 2-shot photos (or tap Search & Verify) to re-check this item!', 3800);
  };

  window.cancelEditMode = () => {
    editingStashItem = null;
    document.getElementById('editModeBanner').classList.add('hidden');
    resetScanner();
  };

  window.resetScanner = () => {
    scanRunId++;
    CC.cancelAI();
    stopHighlightAudio();
    setStatus('', false);
    pendingVoiceRetry = null;
    stagedPhotos = [];
    stagedUpc = '';
    currentExtracted = null;
    currentCandidates = [];
    visibleCandidateIds = null;
    detectiveDiffs = {};
    detectivePickId = null;
    detectiveEliminatedIds = new Set();
    detectiveInspectedCount = 0;
    currentInspected = null;

    document.getElementById('galleryInput').value = '';
    document.getElementById('nativeCamInput').value = '';
    document.getElementById('detectiveCard').classList.add('hidden');
    document.getElementById('candidatesCard').classList.add('hidden');
    document.getElementById('inspectorCard').classList.add('hidden');
    document.getElementById('detectedCluesLine').textContent = '';
    ['fTitle', 'fArtist', 'fCatno', 'fBarcode', 'fLabel', 'fYear', 'fDirectId', 'gNotes'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    updateStageUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ==================== LOCAL STASH LIST & FULL DETAIL VIEW ====================
  async function loadStashCache() {
    stashCache = (await CC.idbGetAll('stash')).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    document.getElementById('navStashLabel').textContent = `Stash (${stashCache.length})`;
    updateSettingsPills();
  }

  window.renderStash = () => {
    const q = norm(document.getElementById('stashSearch').value);
    const filtered = stashCache.filter(it => {
      if (['Cassette', 'CD', 'Vinyl'].includes(activeStashFilter) && it.format !== activeStashFilter) return false;
      if (activeStashFilter === 'highvalue' && !it.is_high_value && !it.is_scarce) return false;
      if (activeStashFilter === 'keep' && (it.taste_score || 0) < 7) return false;
      if (activeStashFilter === 'lowconf' && !(it.discogs_id && (it.have ?? 0) < 15)) return false;
      if (activeStashFilter === 'localonly' && it.synced_to_discogs) return false;
      if (!q) return true;
      return norm(`${it.artist} ${it.title} ${it.catno} ${it.label} ${it.condition_note} ${(it.tracklist || []).map(t => `${t.artist || ''} ${t.title}`).join(' ')}`).includes(q);
    });

    const totalValUsd = filtered.reduce((s, it) => {
      const u = toApproxUsd(it.est_price, it.est_currency || 'USD');
      return s + (u !== null ? u : (Number(it.est_price) || 0));
    }, 0);
    document.getElementById('stashStats').textContent = `${filtered.length} items · ~$${Math.round(totalValUsd)}`;

    const list = document.getElementById('stashList');
    if (!filtered.length) { list.innerHTML = `<div class="card"><p>No matching items yet.</p></div>`; return; }

    list.innerHTML = filtered.map(it => {
      const pBadge = it.est_price != null ? `<span class="badge ${it.is_high_value ? 'badge-yellow' : 'badge-blue'}">${esc(formatMoneyWithUsd(it.est_price, it.est_currency || 'USD'))}</span>` : '';
      const sBadge = it.is_scarce ? `<span class="badge badge-purple">💎 Scarce</span>` : '';
      const tBadge = it.taste_score ? `<span class="badge ${it.taste_score >= 7 ? 'badge-green' : 'badge-blue'}">🎧 ${it.taste_score}/10</span>` : '';
      const gTxt = it.media_condition ? `${shortGrade(it.media_condition)}/${shortGrade(it.sleeve_condition || '')}` : '';
      const gBadge = gTxt ? `<span class="badge" style="background:#0d1017; color:var(--muted);">${esc(gTxt)}</span>` : '';
      const syncB = it.synced_to_discogs
        ? (it.pending_delete_old ? `<span class="badge badge-yellow">⚠️ Old Copy Pending</span>` : `<span class="badge badge-green">Discogs</span>`)
        : (it.pending_discogs_sync ? `<span class="badge badge-red">⏳ Pending Sync</span>` : `<span class="badge badge-yellow">Local</span>`);

      return `
        <div class="stash-item" onclick="openStashDetail(${it.id})">
          <img class="stash-thumb" src="${esc(it.thumb_data_url || '')}" onerror="this.style.visibility='hidden'" />
          <div class="stash-body">
            <div class="candidate-title">${esc(it.artist)} — ${esc(it.title)}</div>
            <div class="candidate-sub">${esc(it.format)} · ${esc(it.country || '?')} · ${esc(it.year || '?')} · ${esc(it.catno || 'No Cat#')}</div>
            <div>${pBadge}${sBadge}${tBadge}${gBadge}${syncB}</div>
          </div>
          <span class="stash-chev">›</span>
        </div>
      `;
    }).join('');
  };

  window.openStashLightbox = (idx) => {
    if (!activeStashItem) return;
    const photos = (Array.isArray(activeStashItem.thumbs) && activeStashItem.thumbs.length)
      ? activeStashItem.thumbs : (activeStashItem.thumb_data_url ? [activeStashItem.thumb_data_url] : []);
    openLightbox(photos, idx);
  };

  window.openStashDetail = (id, fromPop = false) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    activeStashItem = it;
    pendingVoiceRetry = null;

    if (!fromPop) {
      try {
        if (history.state?.modal === 'stashDetail') history.replaceState({ view: 'stash', modal: 'stashDetail', itemId: id }, '');
        else history.pushState({ view: 'stash', modal: 'stashDetail', itemId: id }, '');
      } catch (_) {}
    }

    document.getElementById('sdHeaderTitle').textContent = `${it.artist} — ${it.title}`;
    const photos = (Array.isArray(it.thumbs) && it.thumbs.length) ? it.thumbs : (it.thumb_data_url ? [it.thumb_data_url] : []);
    const localMatch = checkLocalSpotify(it);
    const hasDiscogs = Boolean(it.discogs_id);

    const ebayQ = encodeURIComponent(`${it.artist} ${it.title} ${it.format} ${it.catno}`.trim());
    let links = `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${ebayQ}&LH_Sold=1&LH_Complete=1">💸 eBay Sold</a>`;
    if (hasDiscogs) {
      links = `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${esc(it.discogs_url)}">💿 Discogs</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/history/${it.discogs_id}">📈 Sales History</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/post/${it.discogs_id}">🏷️ Sell</a>` + links;
    }
    links = `<button type="button" class="btn btn-purple btn-sm" onclick="startEditStashItem(${it.id})">🔄 Edit / Re-Check</button>` + links;

    let alerts = '';
    if (it.pending_discogs_sync) {
      alerts += `<div class="alert-box alert-dup">⏳ Pressing was changed locally and is not synced to Discogs yet.${it.pending_delete_old ? ` Pushing will add #${it.discogs_id} first and then remove old #${it.pending_delete_old.releaseId}.` : ''} Tap <strong>Push to Discogs</strong> below.</div>`;
    } else if (it.synced_to_discogs && it.pending_delete_old) {
      const oldId = it.pending_delete_old.releaseId;
      alerts += `<div class="alert-box alert-dup">
        <div>⚠️ Old pressing #${oldId} was kept on Discogs (${it.pending_delete_old.ambiguous ? `multiple copies found — remove manually on Discogs` : `removal pending`}).</div>
        <div class="inline-actions" style="margin-top:8px;">
          ${!it.pending_delete_old.ambiguous ? `<button type="button" class="btn btn-sm" onclick="retryRemoveOldDiscogsCopy(${it.id})">🧹 Retry Removing Old #${oldId}</button>` : ''}
          <a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/release/${oldId}">Open #${oldId} ↗</a>
          <button type="button" class="btn btn-secondary btn-sm" onclick="dismissPendingDeleteOld(${it.id})">Dismiss</button>
        </div>
      </div>`;
    }
    if (it.is_high_value) alerts += `<div class="alert-box alert-high-value">🔥 HIGH VALUE (${esc(formatMoneyWithUsd(it.est_price, it.est_currency || 'USD'))}) — SET ASIDE!</div>`;
    if (it.is_scarce) alerts += `<div class="alert-box alert-scarce">💎 SCARCE (0 for sale, ${it.want} want / ${it.have} have) — CHECK SOLD!</div>`;

    let localBadges = '';
    if (localMatch.artistHit) localBadges += `<span class="badge badge-green">🎸 Artist in Your Spotify</span>`;
    if (localMatch.matchedTracks.length) localBadges += `<span class="badge badge-green">🎵 ${localMatch.matchedTracks.length} Track(s) in Library</span>`;

    const contextTxt = it.context_note || it.cultural_reason || '';

    const body = document.getElementById('sdBody');
    body.innerHTML = `
      ${photos.length ? `<div class="detail-photos">${photos.map((src, i) => `<img src="${esc(src)}" onclick="openStashLightbox(${i})" title="Tap for fullscreen" />`).join('')}</div><div style="font-size:0.72rem; color:var(--muted); margin:-8px 0 10px;">Tap any photo to zoom fullscreen</div>` : ''}

      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
        <div>
          <h2 style="margin:0 0 2px;">${esc(it.artist)} — ${esc(it.title)}</h2>
          <div style="font-size:0.84rem; color:var(--muted);">${esc(it.format)} · ${esc(it.country || '?')} · ${esc(it.year || '?')} · ${esc(it.label || 'Unknown Label')} · ${esc(it.catno || 'No Cat#')}</div>
        </div>
        ${hasDiscogs ? `<span class="badge badge-blue">#${it.discogs_id}</span>` : `<span class="badge badge-yellow">Unlisted</span>`}
      </div>

      ${alerts}

      <div class="metrics-grid">
        <div class="metric-box"><div class="metric-label">Lowest Listed</div><div class="metric-val">${it.lowest_price != null ? esc(formatMoneyWithUsd(it.lowest_price, it.lowest_currency || 'USD')) : 'N/A'}</div></div>
        <div class="metric-box"><div class="metric-label">VG+ Est. Value</div><div class="metric-val">${it.vg_plus_price != null ? esc(formatMoneyWithUsd(it.vg_plus_price, it.vg_plus_currency || 'USD')) : '—'}</div></div>
        <div class="metric-box"><div class="metric-label">For Sale</div><div class="metric-val">${it.num_for_sale != null ? `${it.num_for_sale} listed` : '—'}</div></div>
        <div class="metric-box"><div class="metric-label">Have / Want</div><div class="metric-val">${hasDiscogs ? `${it.have ?? 0} / ${it.want ?? 0}` : '—'}</div></div>
      </div>

      <div class="link-row">${links}</div>

      <div class="taste-box">
        <div class="taste-header">
          <strong style="font-size:0.92rem;">🎧 Taste &amp; Context</strong>
          <span class="taste-score">${it.taste_score ? `${esc(it.taste_score)}/10` : '—'} ${it.taste_verdict ? `<span class="badge ${verdictBadgeClass(it.taste_verdict)}" style="vertical-align:middle;">${esc(it.taste_verdict)}</span>` : ''}</span>
        </div>
        <div style="margin-bottom:6px;">${localBadges}</div>
        <div style="font-size:0.87rem; color:#e2e8f0;">${esc(it.taste_summary || 'No taste summary saved.')}</div>
        ${contextTxt ? `<div class="context-box"><strong>📖 Context:</strong> ${esc(contextTxt)}</div>` : ''}
        <div style="margin-top:10px; font-size:0.84rem; color:#cbd5e1;">${buildNotableHitsHtml(it, 'stash')}</div>
      </div>

      <div class="section-block">
        <div class="section-heading">🎵 Tracklist (${(it.tracklist || []).length})</div>
        <div class="tracklist-open">${buildTracklistHtml(it.tracklist || [], localMatch.matchedTracks, 'stash')}</div>
      </div>

      ${it.pressing_notes ? `
        <div class="section-block">
          <div class="section-heading">🔎 Pressing Notes &amp; Identifiers</div>
          <div class="notes-box">${formatPressingNotesHtml(it.pressing_notes, false)}</div>
        </div>
      ` : ''}

      <div class="grade-box">
        <strong style="display:block; font-size:0.92rem; margin-bottom:8px;">🏷️ Discogs Grading &amp; Notes</strong>
        <button id="btnVoiceRegradeStash" type="button" class="btn btn-purple dictate-btn" style="width:100%; min-height:44px; font-size:0.88rem; margin-bottom:8px;" onclick="voiceRegrade('stash', 'btnVoiceRegradeStash')">
          ${VOICE_BTN_IDLE}
        </button>
        <div id="voiceLiveStash" class="voice-live hidden"></div>
        <div class="field-grid" style="margin-bottom:8px;">
          <div>
            <label class="field-label">Media Condition</label>
            <select id="sdMediaCond">${gradeOptionsHtml(MEDIA_GRADES, it.media_condition || 'Very Good Plus (VG+)')}</select>
          </div>
          <div>
            <label class="field-label">Sleeve / Case Condition</label>
            <select id="sdSleeveCond">${gradeOptionsHtml(SLEEVE_GRADES, it.sleeve_condition || 'Very Good Plus (VG+)')}</select>
          </div>
        </div>
        <div style="margin-bottom:10px;">
          <label class="field-label">Condition / Listing Report</label>
          <textarea id="sdNotes" class="tall-textarea" rows="5">${esc(it.condition_note || '')}</textarea>
        </div>
        <div class="inline-actions">
          <button class="btn btn-sm" onclick="saveStashEdits(${it.id})">💾 Save Grade &amp; Sync Discogs</button>
          ${(!it.synced_to_discogs && it.discogs_id) ? `<button class="btn btn-green btn-sm" onclick="pushStashToDiscogs(${it.id})">✅ Push to Discogs</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteStashItem(${it.id})">🗑️ Delete</button>
        </div>
      </div>
    `;

    document.getElementById('stashDetailModal').classList.remove('hidden');
    body.scrollTop = 0;
  };

  window.closeStashDetail = () => {
    hideStashDetailUI();
    if (history.state?.modal === 'stashDetail') {
      try { history.back(); } catch (_) {}
    }
  };

  window.retryRemoveOldDiscogsCopy = async (id) => {
    const it = stashCache.find(x => x.id === id);
    if (!it || !it.pending_delete_old) return;
    setStatus(`Removing old pressing #${it.pending_delete_old.releaseId} from Discogs...`, true);
    const delRes = await attemptDeleteOldCopy(it);
    await loadStashCache();
    renderStash();
    setStatus('', false);
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast(delRes.ok ? '✅ Old pressing removed from Discogs!' : `⚠️ ${delRes.warning}`, 5000);
  };

  window.dismissPendingDeleteOld = async (id) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    it.pending_delete_old = null;
    await CC.idbPut('stash', it);
    await loadStashCache();
    renderStash();
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast('Dismissed old-copy reminder');
  };

  window.saveStashEdits = async (id) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    it.media_condition = document.getElementById('sdMediaCond').value;
    it.sleeve_condition = document.getElementById('sdSleeveCond').value;
    it.condition_note = document.getElementById('sdNotes').value.trim();

    if (it.synced_to_discogs && it.discogs_id && cfg.discogsUser) {
      let instId = it.discogs_instance_id;
      let fId = it.discogs_folder_id || cfg.discogsFolderId || '1';
      if (!instId) {
        const insts = await CC.findDiscogsInstances(it.discogs_id);
        if (insts.length === 1) {
          instId = insts[0].instance_id;
          fId = String(insts[0].folder_id || fId);
          it.discogs_instance_id = instId;
          it.discogs_folder_id = fId;
        }
      }
      if (instId) {
        const fieldRes = await CC.syncDiscogsInstanceFields(fId, it.discogs_id, instId, it.media_condition, it.sleeve_condition, it.condition_note);
        if (fieldRes.failedCount > 0) {
          toast(`⚠️ Saved locally, but ${fieldRes.failedCount} Discogs field(s) failed: ${fieldRes.errors[0] || ''}`, 5000);
        } else {
          toast('✅ Updated Stash & Discogs grades!');
        }
      } else toast('💾 Saved locally (could not uniquely locate Discogs instance)');
    } else toast('💾 Grade & notes saved!');

    await CC.idbPut('stash', it);
    await loadStashCache();
    renderStash();
  };

  window.pushStashToDiscogs = async (id) => {
    const it = stashCache.find(x => x.id === id);
    if (!it || !it.discogs_id || !cfg.discogsUser) { toast('Verify Discogs in Settings first'); return; }
    if (activeStashItem?.id === id) {
      it.media_condition = document.getElementById('sdMediaCond')?.value || it.media_condition;
      it.sleeve_condition = document.getElementById('sdSleeveCond')?.value || it.sleeve_condition;
      it.condition_note = document.getElementById('sdNotes')?.value.trim() ?? it.condition_note;
    }
    const folderId = cfg.discogsFolderId || '1';
    try {
      setStatus(`Adding #${it.discogs_id} to Discogs...`, true);
      const res = await CC.discogsFetch(`/users/${encodeURIComponent(cfg.discogsUser)}/collection/folders/${encodeURIComponent(folderId)}/releases/${it.discogs_id}`, {}, 'POST');
      const newInstId = res?.instance_id || null;
      if (!newInstId) throw new Error('Discogs did not return an instance_id');

      it.synced_to_discogs = true;
      it.pending_discogs_sync = false;
      it.discogs_folder_id = folderId;
      it.discogs_instance_id = newInstId;

      setStatus('Syncing grades & notes to Discogs...', true);
      const fieldRes = await CC.syncDiscogsInstanceFields(folderId, it.discogs_id, newInstId, it.media_condition, it.sleeve_condition, it.condition_note);
      const allFieldsFailed = fieldRes.okCount === 0 && fieldRes.failedCount > 0;

      // Persist immediately BEFORE removing any old swapped pressing
      await CC.idbPut('stash', it);

      let oldWarn = '';
      if (it.pending_delete_old) {
        if (allFieldsFailed) {
          oldWarn = `All grade/note fields failed — old pressing #${it.pending_delete_old.releaseId} kept safely on Discogs.`;
        } else {
          setStatus(`Removing old pressing #${it.pending_delete_old.releaseId}...`, true);
          const delRes = await attemptDeleteOldCopy(it);
          if (!delRes.ok) oldWarn = delRes.warning;
        }
      }

      await loadStashCache();
      renderStash();
      setStatus('', false);
      if (activeStashItem?.id === id) openStashDetail(id, true);

      if (oldWarn) {
        toast(`⚠️ ${oldWarn}`, 5600);
      } else if (fieldRes.failedCount > 0) {
        toast(`⚠️ Added to Discogs, but ${fieldRes.failedCount} field(s) failed: ${fieldRes.errors[0] || ''}`, 5000);
      } else {
        toast('✅ Added to Discogs with grades!');
      }
    } catch (e) {
      setStatus('', false);
      toast('Failed: ' + e.message, 4500);
    }
  };

  window.deleteStashItem = async (id) => {
    if (!confirm('Remove from Local Stash?')) return;
    await CC.idbDelete('stash', id);
    closeStashDetail();
    await loadStashCache();
    renderStash();
    toast('Deleted');
  };

  // ==================== EXPORT / BACKUP ====================
  function dl(content, filename, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  window.exportCSV = () => {
    if (!stashCache.length) { toast('Nothing to export'); return; }
    const cols = ['artist', 'title', 'format', 'country', 'catno', 'label', 'year', 'media_condition', 'sleeve_condition', 'condition_note', 'est_price', 'est_currency', 'lowest_price', 'num_for_sale', 'have', 'want', 'is_high_value', 'is_scarce', 'taste_score', 'taste_verdict', 'synced_to_discogs', 'discogs_url'];
    const c = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    dl([cols.join(','), ...stashCache.map(it => cols.map(k => c(it[k])).join(','))].join('\n'), `cratecheck-stash-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  window.exportJSON = () => {
    dl(JSON.stringify({ version: 9, exportedAt: new Date().toISOString(), stash: stashCache, spotifyProfile }), `cratecheck-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    toast('JSON backup downloaded');
  };

  window.importJSON = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (Array.isArray(data.stash)) {
        for (const item of data.stash) { const copy = { ...item }; delete copy.id; await CC.idbPut('stash', copy); }
      }
      if (data.spotifyProfile) {
        spotifyProfile = data.spotifyProfile;
        await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
        document.getElementById('cfgTasteDna').value = spotifyProfile.tasteDna || '';
        document.getElementById('cfgSoftSpots').value = spotifyProfile.softSpots || '';
        updateSpotifyUI();
      }
      await loadStashCache(); renderStash();
      toast('Backup restored!');
    } catch (e) { toast('Invalid JSON: ' + e.message); }
  };

  // ==================== SETTINGS, DISCOGS INDEX & SPOTIFY WIRING ====================
  function refreshNotice() {
    document.getElementById('setupNotice').classList.toggle('hidden', Boolean(CC.isAiReady() && cfg.discogsToken));
    updateSettingsPills();
  }

  function updateDiscogsCollectionUI() {
    const el = document.getElementById('discogsCollectionSummary');
    if (!el) return;
    if (discogsCollectionIndex && discogsCollectionIndex.totalItems) {
      const uniqueAlbums = Object.keys(discogsCollectionIndex.albumKeys || {}).length;
      const dt = new Date(discogsCollectionIndex.syncedAt || Date.now()).toLocaleDateString();
      el.textContent = `✅ Indexed ${discogsCollectionIndex.totalItems} releases (${uniqueAlbums} unique albums) for @${discogsCollectionIndex.username} · ${dt}`;
    } else {
      el.textContent = 'Not synced yet — detects when you already own an album in a different pressing/format.';
    }
  }

  window.syncDiscogsCollectionUI = async () => {
    saveSettings(true);
    if (!cfg.discogsToken || !cfg.discogsUser) {
      toast('Verify your Discogs account first');
      return;
    }
    const btn = document.getElementById('btnSyncDiscogsIndex');
    if (btn) btn.disabled = true;
    try {
      discogsCollectionIndex = await CC.syncDiscogsCollectionIndex();
      await CC.idbPut('meta', { key: 'discogs_collection_index', value: discogsCollectionIndex });
      updateDiscogsCollectionUI();
      setStatus('', false);
      toast(`📀 Indexed ${discogsCollectionIndex.totalItems} Discogs releases!`, 3600);
    } catch (err) {
      setStatus('', false);
      toast('Collection index failed: ' + err.message, 4500);
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  window.saveSettings = (silent = false) => {
    cfg.geminiKey = document.getElementById('cfgGeminiKey').value.trim();
    cfg.geminiModel = document.getElementById('cfgGeminiModel').value;
    cfg.autoPlayHighlight = document.getElementById('cfgAutoPlay').checked;
    cfg.autoDetective = document.getElementById('cfgAutoDetective').checked;
    cfg.discogsToken = document.getElementById('cfgDiscogsToken').value.trim();
    cfg.discogsFolderId = document.getElementById('cfgDiscogsFolder').value || '1';
    cfg.homeCountry = document.getElementById('cfgHomeCountry').value;
    cfg.fetchVgSuggestions = document.getElementById('cfgFetchVg').checked;
    cfg.threshold = Number(document.getElementById('cfgThreshold').value) || 20;
    cfg.voice = document.getElementById('cfgVoice').checked;
    cfg.spotifyClientId = document.getElementById('cfgSpotifyClientId').value.trim();
    cfg.showSpotify = document.getElementById('cfgShowSpotify').checked;
    cfg.showApple = document.getElementById('cfgShowApple').checked;
    cfg.showDeezer = document.getElementById('cfgShowDeezer').checked;
    cfg.showYoutube = document.getElementById('cfgShowYoutube').checked;
    CC.persistCfg();
    refreshNotice();
    if (!silent) toast('Settings saved!');
  };

  window.testAiConnection = async () => {
    saveSettings(true);
    const badge = document.getElementById('aiStatusBadge');
    if (!CC.isAiReady()) {
      badge.style.color = 'var(--red)';
      badge.textContent = '❌ Paste API key';
      return;
    }
    badge.style.color = 'var(--muted)';
    badge.textContent = 'Testing Gemini...';
    setStatus(`Testing ${aiEngineLabel()}...`, true, { cancellable: true });
    try {
      await CC.callAI([{ text: 'Return ONLY valid JSON: {"ok": true}' }], null, { retryLabel: 'Gemini Test' });
      badge.style.color = 'var(--green)';
      badge.textContent = `✅ Connected (${cfg.geminiModel})`;
      setStatus('', false);
      toast(`✅ Connected to ${aiEngineLabel()}!`);
    } catch (err) {
      setStatus('', false);
      badge.style.color = 'var(--red)';
      badge.textContent = '❌ Error';
      if (err.name !== 'AbortError') toast('Gemini test failed: ' + err.message, 5200);
    }
  };

  window.verifyDiscogsAccount = async () => {
    saveSettings(true);
    if (!cfg.discogsToken) { toast('Paste your Discogs Token first'); return; }
    setStatus('Verifying Discogs, folders & grading fields...', true);
    try {
      const id = await CC.discogsFetch('/oauth/identity');
      cfg.discogsUser = id.username;
      const fRes = await CC.discogsFetch(`/users/${encodeURIComponent(id.username)}/collection/folders`);
      cfg.discogsFolders = (fRes.folders || []).filter(f => f.id !== 0);
      if (!cfg.discogsFolders.length) cfg.discogsFolders = [{ id: 1, name: 'Uncategorized' }];

      const fieldsRes = await CC.discogsFetch(`/users/${encodeURIComponent(id.username)}/collection/fields`).catch(() => null);
      if (fieldsRes?.fields?.length) {
        const findId = (rx, def) => (fieldsRes.fields.find(x => rx.test(x.name || ''))?.id) || def;
        cfg.discogsFields = { media: findId(/media/i, 1), sleeve: findId(/sleeve/i, 2), notes: findId(/note/i, 3) };
      }

      populateFolders(); CC.persistCfg(); refreshNotice();
      setStatus('', false);
      toast(`✅ Connected as @${id.username}`);

      // Auto-sync collection index on first verify (or if user changed)
      if (!discogsCollectionIndex || discogsCollectionIndex.username !== id.username) {
        await syncDiscogsCollectionUI();
      }
    } catch (err) { setStatus('', false); toast('Discogs verify failed: ' + err.message, 4000); }
  };

  function populateFolders() {
    const sel = document.getElementById('cfgDiscogsFolder');
    sel.innerHTML = (cfg.discogsFolders || [{ id: 1, name: 'Uncategorized' }]).map(f => `<option value="${f.id}">${esc(f.name)} (${f.count ?? 0})</option>`).join('');
    sel.value = cfg.discogsFolderId || '1';
    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
    document.getElementById('discogsUserBadge').textContent = cfg.discogsUser ? `Connected: @${cfg.discogsUser}` : '';
  }

  window.startSpotifyAuth = async () => {
    saveSettings(true);
    if (!cfg.spotifyClientId) { toast('Paste Spotify Client ID first'); return; }
    if (!window.crypto?.subtle) { toast('Spotify login requires HTTPS'); return; }
    if (cfg.spotifyRefreshToken && await CC.refreshSpotifyToken()) {
      await runSpotifySyncUI();
      return;
    }
    await CC.beginSpotifyRedirect();
  };

  async function runSpotifySyncUI() {
    switchView('settings');
    document.getElementById('accMusic').open = true;
    try {
      const prevDna = spotifyProfile?.tasteDna || document.getElementById('cfgTasteDna').value.trim();
      const prevSoftSpots = spotifyProfile?.softSpots || document.getElementById('cfgSoftSpots').value.trim();
      spotifyProfile = await CC.syncSpotifyAll(prevDna, prevSoftSpots);
      await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
      tasteCache.clear();
      document.getElementById('cfgTasteDna').value = spotifyProfile.tasteDna || '';
      document.getElementById('cfgSoftSpots').value = spotifyProfile.softSpots || '';
      updateSpotifyUI();
      setStatus('', false);
      toast(`🎧 Synced ${spotifyProfile.totalTracks} tracks & ${spotifyProfile.totalArtists} artists locally for instant matching!`, 4500);
    } catch (err) {
      setStatus('', false);
      toast('Spotify sync error: ' + err.message, 5000);
    }
  }

  window.importExportifyCSV = async (file) => {
    if (!file) return;
    const rows = CC.parseCSV(await file.text());
    if (rows.length < 2) { toast('CSV is empty'); return; }
    const h = rows[0].map(x => x.toLowerCase());
    const tIdx = h.findIndex(x => x.includes('track name'));
    const aIdx = h.findIndex(x => x.includes('artist'));
    if (tIdx === -1 || aIdx === -1) { toast('Missing Track Name / Artist columns'); return; }

    const allArtists = Object.assign({}, spotifyProfile?.allArtists || {});
    const trackPairs = new Set(spotifyProfile?.trackPairs || []);
    const trackTitles = new Set(spotifyProfile?.trackTitles || []);

    for (let i = 1; i < rows.length; i++) {
      const tr = (rows[i][tIdx] || '').trim();
      const ar = (rows[i][aIdx] || '').trim();
      if (tr) trackTitles.add(norm(tr));
      if (ar) ar.split(/;|,/).forEach(name => {
        const clean = name.trim(), n = norm(clean);
        if (!n) return;
        if (!allArtists[n]) allArtists[n] = { name: clean, count: 0, tracks: [], playlists: [] };
        allArtists[n].count = (allArtists[n].count || 0) + 1;
        if (!Array.isArray(allArtists[n].tracks)) allArtists[n].tracks = [];
        if (tr && !allArtists[n].tracks.includes(tr)) allArtists[n].tracks.push(tr);
        if (tr) trackPairs.add(`${n}|${norm(tr)}`);
      });
    }

    const topArtists = Object.values(allArtists).sort((a, b) => (b.count || 0) - (a.count || 0)).map(x => x.name);
    spotifyProfile = Object.assign({}, spotifyProfile || {}, {
      syncedAt: Date.now(),
      userDisplayName: spotifyProfile?.userDisplayName || 'Exportify CSV',
      topArtists, allArtists,
      trackPairs: Array.from(trackPairs),
      trackTitles: Array.from(trackTitles),
      totalTracks: trackPairs.size || trackTitles.size,
      totalArtists: Object.keys(allArtists).length,
      softSpots: spotifyProfile?.softSpots || document.getElementById('cfgSoftSpots')?.value.trim() || ''
    });
    await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
    tasteCache.clear(); updateSpotifyUI();
    toast(`Merged! Total: ${spotifyProfile.totalTracks} tracks & ${spotifyProfile.totalArtists} artists.`);
  };

  function updateSpotifyUI() {
    const pill = document.getElementById('spotifyPill');
    const sum = document.getElementById('spotifySummary');
    const dnaSum = document.getElementById('dnaSummary');
    if (spotifyProfile && spotifyProfile.totalArtists > 0) {
      pill.textContent = `Spotify: ${spotifyProfile.totalArtists} art`;
      pill.className = 'pill ok';
      const pl = spotifyProfile.totalPlaylists ? ` · ${spotifyProfile.totalPlaylists} playlists` : '';
      sum.textContent = `✅ Synced locally (${spotifyProfile.userDisplayName}): ${spotifyProfile.totalTracks} tracks · ${spotifyProfile.totalArtists} artists${pl}`;
    } else {
      pill.textContent = 'Spotify: Off';
      pill.className = 'pill';
      sum.textContent = 'Not synced yet (local exact matching disabled).';
    }

    const ssTag = spotifyProfile?.softSpots ? ' · Soft Spots active' : '';
    dnaSum.textContent = spotifyProfile?.tasteDna
      ? `✅ Taste Profile active (${spotifyProfile.tasteDna.length} chars)${ssTag}`
      : `Tip: Write your Taste Profile above (or tap optional 🧠 Auto-Draft Profile after syncing Spotify).${ssTag}`;
    updateSettingsPills();
  }

  window.copyRedirectUri = async () => {
    try { await navigator.clipboard.writeText(CC.REDIRECT_URI); toast('Redirect URI copied!'); }
    catch (_) { prompt('Copy Redirect URI:', CC.REDIRECT_URI); }
  };

  function setScanMode(mode) {
    scanMode = mode;
    document.querySelectorAll('#scanModeSeg .mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('singleModeWrap').classList.toggle('hidden', mode !== 'single');
    document.getElementById('pileModeWrap').classList.toggle('hidden', mode !== 'pile');
    if (mode === 'pile') {
      document.getElementById('detectiveCard').classList.add('hidden');
      document.getElementById('inspectorCard').classList.add('hidden');
      document.getElementById('candidatesCard').classList.add('hidden');
    }
  }

  // ==================== INIT ====================
  async function init() {
    CC.setStatusCallback(setStatus);
    CC.setRateCallback(updateRatePill);
    await CC.openDB();
    await loadStashCache();

    const spRec = await CC.idbGet('meta', 'spotify_profile');
    if (spRec?.value) spotifyProfile = spRec.value;

    const dcRec = await CC.idbGet('meta', 'discogs_collection_index');
    if (dcRec?.value) discogsCollectionIndex = dcRec.value;

    document.getElementById('cfgGeminiKey').value = cfg.geminiKey || '';
    document.getElementById('cfgGeminiModel').value = cfg.geminiModel || 'gemini-3.5-flash-lite';
    document.getElementById('cfgAutoPlay').checked = cfg.autoPlayHighlight !== false;
    document.getElementById('cfgAutoDetective').checked = cfg.autoDetective !== false;
    document.getElementById('cfgDiscogsToken').value = cfg.discogsToken || '';
    document.getElementById('cfgHomeCountry').value = cfg.homeCountry ?? 'US';
    document.getElementById('cfgFetchVg').checked = cfg.fetchVgSuggestions !== false;
    document.getElementById('cfgThreshold').value = cfg.threshold ?? 20;
    document.getElementById('cfgVoice').checked = Boolean(cfg.voice);
    document.getElementById('cfgSpotifyClientId').value = cfg.spotifyClientId || '';
    document.getElementById('cfgShowSpotify').checked = cfg.showSpotify !== false;
    document.getElementById('cfgShowApple').checked = cfg.showApple !== false;
    document.getElementById('cfgShowDeezer').checked = cfg.showDeezer !== false;
    document.getElementById('cfgShowYoutube').checked = cfg.showYoutube !== false;
    document.getElementById('cfgTasteDna').value = spotifyProfile?.tasteDna || '';
    document.getElementById('cfgSoftSpots').value = spotifyProfile?.softSpots || '';
    document.getElementById('redirectUriText').textContent = CC.REDIRECT_URI;

    document.getElementById('gMediaCond').innerHTML = gradeOptionsHtml(MEDIA_GRADES, 'Very Good Plus (VG+)');
    document.getElementById('gSleeveCond').innerHTML = gradeOptionsHtml(SLEEVE_GRADES, 'Very Good Plus (VG+)');

    pileZoomInline = createZoomPanController(
      document.getElementById('pileViewport'),
      document.getElementById('pileZoomContent'),
      document.getElementById('pileZoomLbl')
    );
    pileZoomFs = createZoomPanController(
      document.getElementById('pileFsViewport'),
      document.getElementById('pileFsZoomContent'),
      document.getElementById('pileFsZoomLbl')
    );

    populateFolders();
    updateDiscogsCollectionUI();
    updateSpotifyUI();
    refreshNotice();
    updateStageUI();

    document.getElementById('camStage').addEventListener('click', (e) => tapCameraToFocus(e));

    document.querySelectorAll('#scanModeSeg .mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setScanMode(btn.dataset.mode));
    });

    document.querySelectorAll('#formatSeg .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#formatSeg .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFormat = btn.dataset.fmt;
        if (activeFormat !== 'Auto') document.getElementById('fFormat').value = activeFormat;
      });
    });

    document.querySelectorAll('#stashFilters .chip').forEach(ch => {
      ch.addEventListener('click', () => {
        document.querySelectorAll('#stashFilters .chip').forEach(c => c.classList.remove('active'));
        ch.classList.add('active');
        activeStashFilter = ch.dataset.filter;
        renderStash();
      });
    });

    document.getElementById('galleryInput').addEventListener('change', (e) => { stagePhotoFiles(e.target.files); e.target.value = ''; });
    document.getElementById('nativeCamInput').addEventListener('change', (e) => { stagePhotoFiles(e.target.files); e.target.value = ''; });
    document.getElementById('pileGalleryInput').addEventListener('change', (e) => { handlePilePhoto(e.target.files[0]); e.target.value = ''; });
    document.getElementById('pileCamInput').addEventListener('change', (e) => { handlePilePhoto(e.target.files[0]); e.target.value = ''; });

    const p = new URLSearchParams(location.search);
    if (p.get('error')) {
      history.replaceState({ view: 'scan', modal: null }, '', location.pathname);
      toast('Spotify login cancelled');
    } else if (p.get('code')) {
      const code = p.get('code'), state = p.get('state');
      history.replaceState({ view: 'scan', modal: null }, '', location.pathname);
      setStatus('Connecting Spotify...', true);
      try { await CC.exchangeSpotifyCode(code, state); await runSpotifySyncUI(); }
      catch (e) { setStatus('', false); toast('Spotify error: ' + e.message, 4500); }
    } else {
      try { history.replaceState({ view: 'scan', modal: null }, ''); } catch (_) {}
    }
  }

  init();
})();
