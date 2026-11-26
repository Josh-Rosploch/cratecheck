(() => {
  'use strict';
  const CC = window.CC;
  const { cfg, esc, norm, normFull, similarity, formatMoney, formatMoneyWithUsd, toApproxUsd, MEDIA_GRADES, SLEEVE_GRADES } = CC;

  // Dynamic PWA Manifest
  (function injectManifest() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" fill="#121212"/><rect x="26" y="48" width="140" height="96" fill="#f3f3f3"/><circle cx="68" cy="96" r="18" fill="#0a0a0a"/><circle cx="124" cy="96" r="18" fill="#0a0a0a"/><rect x="64" y="122" width="64" height="14" fill="#0a0a0a"/></svg>`;
    const m = { name: 'Soft Spot — Media Scanner', short_name: 'Soft Spot', start_url: CC.REDIRECT_URI, display: 'standalone', background_color: '#0a0a0a', theme_color: '#0a0a0a', icons: [{ src: 'data:image/svg+xml;base64,' + btoa(svg), sizes: '192x192', type: 'image/svg+xml' }] };
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/json' }));
    document.head.appendChild(link);
  })();

  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  const VOICE_BTN_IDLE = "🎤 Don't Agree? AI Voice Re-Grade";
  const VERIFY_INITIAL_LIMIT = 15;
  const VERIFY_DEEP_BATCH = 25;
  const PENDING_DISCOGS_KEY = 'cratecheck_pending_discogs_v1';
  const RAW_EXT_RX = /\.(arw|dng|cr2|cr3|nef|nrw|orf|raf|rw2|pef|srw|raw)$/i;
  const RAW_MIME_RX = /(raw|x-sony-arw|x-canon-cr2|x-nikon-nef|x-adobe-dng)/i;

  let spotifyProfile = null;
  let spotifyCheckpoint = null;
  let spotifyCooldownTimer = null;
  let spotifySyncActive = false;
  let discogsCollectionIndex = null;
  let stashCache = [];
  let currentView = 'scan';
  let scanMode = 'single';
  let activeFormat = 'Auto';
  let activeStashFilter = 'all';
  let activeDiscogsFolderFilter = null;
  let activeStashView = 'list';
  let googleSyncInFlight = false;
  let googleAutoSyncTimer = null;
  let cloudFollowupNeeded = false;
  let cloudAccountMismatch = null;
  let cloudEmptyAwaitingPublish = false;
  let activeDiscogsRefreshPromise = null;
  let activeDiscogsRefreshAccount = '';
  const DISCOGS_FRESH_MS = 5 * 60 * 1000;

  let stagedPhotos = [];
  let stagedSpineThumbUrl = '';
  let stagedSpineSourceUrl = '';
  let stagedSpineFlipped = false;
  let stagedUpc = '';
  let stashPhotoManagerOpen = false;
  let activeFolderMoveConflict = null;
  let currentExtracted = null;
  let currentCandidates = [];
  let visibleCandidateIds = null;
  let detectiveDiffs = {};
  let detectivePickId = null;
  let detectiveEliminatedIds = new Set();
  let detectiveInspectedIds = new Set();
  let detectiveInspectedCount = 0;
  let priorBestVerdict = null;
  let deepSearchCancelled = false;
  let recalibratingStash = false;
  let recalibrateProgressText = '';
  let rescoringStashItemId = null;
  const activeDiscogsSaves = new Set();
  let currentInspected = null;
  let activeStashItem = null;
  let editingStashItem = null;

  // Pile Scan + Interactive Zoom/Pan + Non-Blocking Price Fill state
  let pilePhotos = [];
  let activePilePhotoIdx = 0;
  let pileResults = [];
  let activePileIdx = null;
  let pileRunId = 0;
  let pileBatchPriceRunning = false;
  let pileZoomInline = null;
  let pileZoomFs = null;

  // Audio + Platform Menu state
  const tasteCache = new Map();
  let activeTrackBtnKey = '';
  let activePlaybackKey = '';
  let activeClipState = 'idle'; // 'idle' | 'loading' | 'playing' | 'paused'
  let activeDirectYoutubeUrl = '';
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
  let camRearDevices = [];
  let camActiveDeviceId = '';
  let camZoomMin = 1;
  let camZoomWideOn = false;
  let camPeakingOn = false;
  let camPeakRaf = null;
  let camPeakLastTs = 0;
  let camPeakOffscreen = null;
  let camPeakW = 0;
  let camPeakH = 0;
  let camPeakGray = null;
  let camPeakOutImg = null;
  let camPeakOutU32 = null;
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
    if (!show) { el.classList.remove('show', 'is-cancellable'); return; }
    el.classList.toggle('is-cancellable', Boolean(cancellable));
    el.innerHTML = `
      <div class="spinner"></div>
      <div style="flex:1; font-size:0.84rem;">${esc(text)}</div>
      ${cancellable ? `<button type="button" class="btn btn-danger btn-sm" style="min-height:32px; padding:4px 10px;" onclick="cancelActiveAI()">✕ Cancel</button>` : ''}
    `;
    el.classList.add('show');
  }

  function setStatus(text, show = true, opts = {}) {
    const cancellable = Boolean(opts?.cancellable);
    const isShowing = Boolean(show);
    renderBanner(document.getElementById('globalStatusBanner'), text, isShowing, cancellable);
    document.body.classList.toggle('has-status', isShowing);
  }

  window.cancelActiveAI = () => {
    deepSearchCancelled = true;
    recalibratingStash = false;
    CC.cancelAI();
    CC.cancelSpotifySync();
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
    if (!g || g === 'Not Graded') return 'NG';
    if (g === 'No Cover') return 'NC';
    if (g === 'Generic') return 'GEN';
    const m = g.match(/\(([^)]+)\)/);
    return m ? m[1].split(' ')[0] : g;
  }

  function formatGridGrade(media, sleeve) {
    const mEmpty = !media || media === 'Not Graded';
    const sEmpty = !sleeve || sleeve === 'Not Graded';
    if (mEmpty && sEmpty) return '—';
    return `${mEmpty ? '—' : shortGrade(media)}/${sEmpty ? '—' : shortGrade(sleeve)}`;
  }

  window.toggleSecretField = (inputId, btnEl) => {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const shown = inp.classList.toggle('revealed');
    if (btnEl) btnEl.textContent = shown ? 'Hide' : 'Show';
  };

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
    updateCloudUI();

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
    stopFocusPeaking(true);
    camTorchOn = false;
    camZoomWideOn = false;
    camImageCapture = null;
    camCapturing = false;
    clearTimeout(camFocusTimer);
    document.getElementById('camFocusRing')?.classList.remove('show');
    const zoomBtn = document.getElementById('camZoomBtn');
    if (zoomBtn) { zoomBtn.classList.add('hidden'); zoomBtn.classList.remove('wide-on'); }
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
      if (name === 'stash') {
        renderStash();
        maybeAutoRefreshDiscogs();
      }
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

  // Fit entire uncropped image inside a square (default 1600x1600) with neutral #0d0d0d padding — NEVER crop or stretch
  function renderSquareFittedPreview(srcEl, w, h, size = 1600, mime = 'image/webp', quality = 0.84) {
    const rect = CC.computeSquareFitRect(w, h, size);
    const c = document.createElement('canvas');
    c.width = rect.size;
    c.height = rect.size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, rect.size, rect.size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcEl, rect.dx, rect.dy, rect.drawW, rect.drawH);
    return canvasToDataUrl(c, mime, quality);
  }

  function rotateDataUrlByDeg(dataUrl, angleDeg = 180, mime = 'image/webp', quality = 0.84, maxLongEdge = 1600) {
    return new Promise((resolve) => {
      if (!dataUrl) { resolve(''); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const nw = img.naturalWidth || img.width;
          const nh = img.naturalHeight || img.height;
          if (!nw || !nh) { resolve(dataUrl); return; }
          const normDeg = ((Number(angleDeg) % 360) + 360) % 360;
          const swap = normDeg === 90 || normDeg === 270;
          const rawW = swap ? nh : nw;
          const rawH = swap ? nw : nh;
          const { width: dstW, height: dstH } = fitDims(rawW, rawH, maxLongEdge);
          const c = document.createElement('canvas');
          c.width = dstW;
          c.height = dstH;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.translate(dstW / 2, dstH / 2);
          ctx.rotate((normDeg * Math.PI) / 180);
          if (swap) ctx.drawImage(img, -dstH / 2, -dstW / 2, dstH, dstW);
          else ctx.drawImage(img, -dstW / 2, -dstH / 2, dstW, dstH);
          resolve(canvasToDataUrl(c, mime, quality));
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function normalizeSpineDataUrl(dataUrl, rotationHint = '') {
    return new Promise((resolve) => {
      if (!dataUrl) { resolve(''); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const nw = img.naturalWidth || img.width;
          const nh = img.naturalHeight || img.height;
          if (!nw || !nh) { resolve(dataUrl); return; }
          const tr = CC.resolveSpineTransform(nw, nh, rotationHint);
          const rawW = tr.swapDims ? nh : nw;
          const rawH = tr.swapDims ? nw : nh;
          const { width: dstW, height: dstH } = fitDims(rawW, rawH, 1200);
          const c = document.createElement('canvas');
          c.width = dstW;
          c.height = dstH;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.translate(dstW / 2, dstH / 2);
          ctx.rotate((tr.angleDeg * Math.PI) / 180);
          if (tr.swapDims) ctx.drawImage(img, -dstH / 2, -dstW / 2, dstH, dstW);
          else ctx.drawImage(img, -dstW / 2, -dstH / 2, dstW, dstH);
          resolve(canvasToDataUrl(c, 'image/webp', 0.84));
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function readJpegDimensions(blob) {
    if (!blob || typeof blob.slice !== 'function') return null;
    const buf = await blob.slice(0, 131072).arrayBuffer();
    const view = new DataView(buf);
    const len = view.byteLength;
    if (len < 4 || view.getUint16(0, false) !== 0xFFD8) return null;

    let orientation = 1;
    let offset = 2;

    while (offset + 4 <= len) {
      while (offset < len && view.getUint8(offset) === 0xFF) offset++;
      if (offset >= len) break;
      const marker = view.getUint8(offset++);

      // Standalone markers without length
      if (marker === 0xD9 || marker === 0xDA) break;
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) continue;
      if (offset + 2 > len) break;

      const segLen = view.getUint16(offset, false);
      if (segLen < 2 || offset + segLen > len) break;

      // APP1 EXIF orientation check (handles rotated phone/Sony JPEGs accurately)
      if (marker === 0xE1 && segLen >= 16 && offset + 8 <= len) {
        if (view.getUint32(offset + 2, false) === 0x45786966 && view.getUint16(offset + 6, false) === 0x0000) {
          const tiffStart = offset + 8;
          if (tiffStart + 8 <= len) {
            const little = view.getUint16(tiffStart, false) === 0x4949;
            const firstIfd = view.getUint32(tiffStart + 4, little);
            const ifdOff = tiffStart + firstIfd;
            if (ifdOff + 2 <= len) {
              const entries = view.getUint16(ifdOff, little);
              for (let i = 0; i < entries; i++) {
                const eOff = ifdOff + 2 + i * 12;
                if (eOff + 12 > len) break;
                if (view.getUint16(eOff, little) === 0x0112) {
                  orientation = view.getUint16(eOff + 8, little);
                  break;
                }
              }
            }
          }
        }
      }

      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      const isSof = (marker >= 0xC0 && marker <= 0xC3) ||
                    (marker >= 0xC5 && marker <= 0xC7) ||
                    (marker >= 0xC9 && marker <= 0xCB) ||
                    (marker >= 0xCD && marker <= 0xCF);
      if (isSof && offset + 7 <= len) {
        let height = view.getUint16(offset + 3, false);
        let width = view.getUint16(offset + 5, false);
        if (width > 0 && height > 0) {
          if (orientation >= 5 && orientation <= 8) return { width: height, height: width };
          return { width, height };
        }
        return null;
      }

      offset += segLen;
    }
    return null;
  }

  async function decodeViaImageBitmap(blob, opts) {
    const { aiMaxDim, aiQuality, saveMaxDim, saveQuality, squarePreview = false } = opts;
    const dims = await readJpegDimensions(blob).catch(() => null);
    const isLargeFile = (blob.size || 0) > 3.5 * 1024 * 1024;

    let probe = null;
    if (dims && (dims.width > aiMaxDim || dims.height > aiMaxDim)) {
      const target = fitDims(dims.width, dims.height, aiMaxDim);
      probe = await createImageBitmap(blob, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'high'
      });
    } else if (!dims && isLargeFile) {
      // Avoid allocating a full 24MP–61MP bitmap in mobile Chrome RAM when dimensions weren't parsed
      probe = await createImageBitmap(blob, { resizeWidth: aiMaxDim, resizeQuality: 'high' });
    } else {
      try {
        probe = await createImageBitmap(blob);
      } catch (_) {
        probe = await createImageBitmap(blob, { resizeWidth: aiMaxDim, resizeQuality: 'high' });
      }
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
          saveWebp = squarePreview
            ? renderSquareFittedPreview(saveBmp, saveBmp.width, saveBmp.height, saveMaxDim, 'image/webp', saveQuality)
            : renderSourceToDataUrl(saveBmp, saveBmp.width, saveBmp.height, saveMaxDim, 'image/webp', saveQuality);
        } finally {
          if (typeof saveBmp.close === 'function') saveBmp.close();
        }
      } else {
        saveWebp = squarePreview
          ? renderSquareFittedPreview(probe, srcW, srcH, saveMaxDim, 'image/webp', saveQuality)
          : renderSourceToDataUrl(probe, srcW, srcH, saveMaxDim, 'image/webp', saveQuality);
      }

      return { apiB64: apiDataUrl.split(',')[1], saveWebp };
    } finally {
      if (probe && typeof probe.close === 'function') probe.close();
    }
  }

  function decodeViaImgElement(blob, opts) {
    const { aiMaxDim, aiQuality, saveMaxDim, saveQuality, squarePreview = false } = opts;
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
          const saveWebp = squarePreview
            ? renderSquareFittedPreview(img, w, h, saveMaxDim, 'image/webp', saveQuality)
            : renderSourceToDataUrl(img, w, h, saveMaxDim, 'image/webp', saveQuality);
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
      saveMaxDim: 1600,
      saveQuality: 0.84,
      squarePreview: false
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

  // ==================== CONTINUOUS 2-SHOT & MULTI-SHOT PILE FULL-RES CAMERA VIEWFINDER ====================
  function stopFocusPeaking(resetToggle = false) {
    if (camPeakRaf) cancelAnimationFrame(camPeakRaf);
    camPeakRaf = null;
    if (resetToggle) camPeakingOn = false;
    const canvas = document.getElementById('camPeakCanvas');
    if (canvas) {
      canvas.classList.add('hidden');
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const btn = document.getElementById('camPeakBtn');
    if (btn) btn.classList.toggle('active', Boolean(camPeakingOn));
  }

  function runFocusPeakingLoop(ts) {
    if (!camPeakingOn || !camStream) {
      stopFocusPeaking(false);
      return;
    }
    camPeakRaf = requestAnimationFrame(runFocusPeakingLoop);
    if (ts - camPeakLastTs < 125) return;
    camPeakLastTs = ts;

    const video = document.getElementById('camVideo');
    const canvas = document.getElementById('camPeakCanvas');
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    const w = 160;
    const h = Math.max(1, Math.round(w * (video.videoHeight / video.videoWidth)));
    if (!camPeakOffscreen) camPeakOffscreen = document.createElement('canvas');

    const pctx = canvas.getContext('2d');
    const octx = camPeakOffscreen.getContext('2d', { willReadFrequently: true });
    if (!octx || !pctx) return;

    if (camPeakW !== w || camPeakH !== h || !camPeakGray || !camPeakOutImg) {
      camPeakW = w;
      camPeakH = h;
      camPeakOffscreen.width = w;
      camPeakOffscreen.height = h;
      canvas.width = w;
      canvas.height = h;
      camPeakGray = new Uint8Array(w * h);
      camPeakOutImg = pctx.createImageData(w, h);
      camPeakOutU32 = new Uint32Array(camPeakOutImg.data.buffer);
    }

    octx.drawImage(video, 0, 0, w, h);
    const src = octx.getImageData(0, 0, w, h).data;
    const gray = camPeakGray;
    const len = w * h;
    for (let i = 0, p = 0; i < len; i++, p += 4) {
      gray[i] = (src[p] * 77 + src[p + 1] * 150 + src[p + 2] * 29) >> 8;
    }

    camPeakOutU32.fill(0);
    const out = camPeakOutImg.data;
    const THRESH = 110;

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      const prev = row - w;
      const next = row + w;
      for (let x = 1; x < w - 1; x++) {
        const gx = -gray[prev + x - 1] + gray[prev + x + 1]
                   - (gray[row + x - 1] << 1) + (gray[row + x + 1] << 1)
                   - gray[next + x - 1] + gray[next + x + 1];
        const gy = -gray[prev + x - 1] - (gray[prev + x] << 1) - gray[prev + x + 1]
                   + gray[next + x - 1] + (gray[next + x] << 1) + gray[next + x + 1];
        const mag = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
        if (mag > THRESH) {
          const p = (row + x) << 2;
          out[p] = 255;
          out[p + 1] = 36;
          out[p + 2] = 66;
          out[p + 3] = Math.min(245, 120 + ((mag - THRESH) >> 1));
        }
      }
    }
    pctx.putImageData(camPeakOutImg, 0, 0);
  }

  window.toggleFocusPeaking = () => {
    camPeakingOn = !camPeakingOn;
    const btn = document.getElementById('camPeakBtn');
    const canvas = document.getElementById('camPeakCanvas');
    if (btn) btn.classList.toggle('active', camPeakingOn);
    if (camPeakingOn) {
      if (canvas) canvas.classList.remove('hidden');
      camPeakLastTs = 0;
      if (camPeakRaf) cancelAnimationFrame(camPeakRaf);
      camPeakRaf = requestAnimationFrame(runFocusPeakingLoop);
      toast('🎯 Focus peaking ON (sharp edges glow red)', 1800);
    } else {
      stopFocusPeaking(false);
    }
  };

  function getCameraLensShortLabel(dev, idx) {
    const lbl = String(dev?.label || '').toLowerCase();
    if (/\b(front|user|selfie|facetime)\b/.test(lbl)) return '📷 Front';
    if (/ultra|0\.5|0\.6|wide/.test(lbl)) return '📷 Wide';
    if (/tele|2x|3x|5x/.test(lbl)) return '📷 Tele';
    if (/macro/.test(lbl)) return '📷 Macro';
    if (/back|rear|environment/.test(lbl)) return idx === 0 ? '📷 Rear' : `📷 Rear ${idx + 1}`;
    return idx === 0 ? '📷 1x' : `📷 Cam ${idx + 1}`;
  }

  async function refreshCameraLensControls(track) {
    const lensBtn = document.getElementById('camLensBtn');
    const zoomBtn = document.getElementById('camZoomBtn');
    const caps = track?.getCapabilities ? track.getCapabilities() : {};
    const settings = track?.getSettings ? track.getSettings() : {};
    camActiveDeviceId = settings.deviceId || camActiveDeviceId || '';

    try {
      const allDevs = await navigator.mediaDevices.enumerateDevices();
      const vids = allDevs.filter(d => d.kind === 'videoinput');
      camRearDevices = vids;

      if (lensBtn) {
        if (camRearDevices.length > 1) {
          const curIdx = Math.max(0, camRearDevices.findIndex(d => d.deviceId === camActiveDeviceId));
          lensBtn.textContent = getCameraLensShortLabel(camRearDevices[curIdx], curIdx);
          lensBtn.classList.remove('hidden');
        } else {
          lensBtn.classList.add('hidden');
        }
      }
    } catch (_) {
      if (lensBtn) lensBtn.classList.add('hidden');
    }

    if (zoomBtn) {
      if (caps?.zoom && typeof caps.zoom.min === 'number' && caps.zoom.min < 0.99) {
        camZoomMin = caps.zoom.min;
        const curZoom = typeof settings.zoom === 'number' ? settings.zoom : 1;
        camZoomWideOn = curZoom < 0.95;
        const wideTxt = camZoomMin <= 0.65 ? '0.5x' : `${camZoomMin.toFixed(1)}x`;
        zoomBtn.textContent = camZoomWideOn ? `${wideTxt} ✓` : wideTxt;
        zoomBtn.classList.toggle('wide-on', camZoomWideOn);
        zoomBtn.classList.remove('hidden');
      } else {
        camZoomMin = 1;
        camZoomWideOn = false;
        zoomBtn.classList.add('hidden');
        zoomBtn.classList.remove('wide-on');
      }
    }
  }

  window.toggleCamUltrawideZoom = async () => {
    const track = camStream?.getVideoTracks?.()[0];
    if (!track) return;
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (!caps?.zoom || caps.zoom.min >= 0.99) return;
    const nextWide = !camZoomWideOn;
    const targetZoom = nextWide
      ? caps.zoom.min
      : Math.max(caps.zoom.min, Math.min(caps.zoom.max || 1, 1));
    try {
      await track.applyConstraints({ advanced: [{ zoom: targetZoom }] });
      camZoomWideOn = nextWide;
      const zoomBtn = document.getElementById('camZoomBtn');
      const wideTxt = caps.zoom.min <= 0.65 ? '0.5x' : `${caps.zoom.min.toFixed(1)}x`;
      if (zoomBtn) {
        zoomBtn.textContent = camZoomWideOn ? `${wideTxt} ✓` : wideTxt;
        zoomBtn.classList.toggle('wide-on', camZoomWideOn);
      }
      toast(camZoomWideOn ? `Ultrawide ${wideTxt} lens active` : 'Standard 1x lens active', 1600);
    } catch (_) {
      toast('Zoom control not supported on this lens', 2200);
    }
  };

  async function bindStreamToViewfinder(stream) {
    const video = document.getElementById('camVideo');
    camStream = stream;
    video.srcObject = stream;
    await video.play();

    const track = camStream.getVideoTracks()[0];
    const caps = track?.getCapabilities ? track.getCapabilities() : {};
    camTorchOn = false;
    const torchBtn = document.getElementById('camTorchBtn');
    if (torchBtn) {
      torchBtn.style.visibility = caps.torch ? 'visible' : 'hidden';
      torchBtn.textContent = '🔦';
    }

    if (track && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }

    camImageCapture = null;
    if ('ImageCapture' in window && track) {
      try { camImageCapture = new window.ImageCapture(track); } catch (_) { camImageCapture = null; }
    }

    await refreshCameraLensControls(track);
    if (camPeakingOn) {
      document.getElementById('camPeakCanvas')?.classList.remove('hidden');
      if (camPeakRaf) cancelAnimationFrame(camPeakRaf);
      camPeakRaf = requestAnimationFrame(runFocusPeakingLoop);
    }
  }

  window.cycleCameraLens = async () => {
    if (camRearDevices.length < 2 || camCapturing) return;
    const curIdx = camRearDevices.findIndex(d => d.deviceId === camActiveDeviceId);
    const nextIdx = (curIdx + 1) % camRearDevices.length;
    const nextDev = camRearDevices[nextIdx];
    if (!nextDev?.deviceId) return;

    const prevStream = camStream;
    if (prevStream) {
      prevStream.getTracks().forEach(t => t.stop());
      camStream = null;
    }

    try {
      const nextStream = await openHighResCameraStream(nextDev.deviceId);
      cfg.preferredCameraId = nextDev.deviceId;
      CC.persistCfg();
      await bindStreamToViewfinder(nextStream);
      toast(`Switched to ${getCameraLensShortLabel(nextDev, nextIdx)}`, 1600);
    } catch (err) {
      try {
        const fallbackStream = await openHighResCameraStream('');
        await bindStreamToViewfinder(fallbackStream);
      } catch (_) {}
      toast('Could not switch lens: ' + (err?.message || 'busy'), 2600);
    }
  };

  function updateCameraOverlayUI() {
    const badge = document.getElementById('camStepBadge');
    const thumbsEl = document.getElementById('camThumbs');
    const finishBtn = document.getElementById('camFinishBtn');
    const upcBadge = document.getElementById('camUpcBadge');

    if (camMode === 'pile') {
      const n = pilePhotos.length;
      const fmtNote = activeFormat === 'Auto' ? 'All Formats' : `${activeFormat} Only`;
      thumbsEl.classList.remove('hidden');
      if (n === 0) {
        badge.textContent = `📚 Pile Shot 1 (${fmtNote})`;
        badge.className = 'badge badge-purple';
      } else if (n < 4) {
        badge.textContent = `📚 Pile Shot ${n + 1} (${n}/4 · ${fmtNote})`;
        badge.className = 'badge badge-green';
      } else {
        badge.textContent = `📚 4/4 Pile Shots Ready`;
        badge.className = 'badge badge-green';
      }
      finishBtn.className = n > 0 ? 'btn btn-green btn-sm' : 'btn btn-secondary btn-sm';
      finishBtn.innerHTML = `📚 Finish &amp; Analyze (<span id="camCountLbl">${n}</span>)`;
      thumbsEl.innerHTML = pilePhotos.map((p, i) => `
        <div class="cam-thumb-item" onclick="openCameraShotLightbox(${i})" title="Tap to inspect sharpness">
          <img src="${p.saveWebp}" />
          <button type="button" class="cam-thumb-remove" onclick="removeCameraShot(${i}, event)" title="Delete shot">×</button>
        </div>
      `).join('');
      upcBadge.classList.add('hidden');
      return;
    }

    const n = stagedPhotos.length;
    thumbsEl.classList.remove('hidden');
    if (n === 0) { badge.textContent = 'Shot 1: Front + Side A'; badge.className = 'badge badge-blue'; }
    else if (n === 1) { badge.textContent = 'Shot 2: Back + Side B'; badge.className = 'badge badge-purple'; }
    else if (n === 2) { badge.textContent = 'Shot 3: Spine (Optional — Auto-Crops)'; badge.className = 'badge badge-green'; }
    else if (n === 3) { badge.textContent = 'Shot 4: Extra Detail (Optional)'; badge.className = 'badge badge-green'; }
    else { badge.textContent = '4/4 Shots Ready'; badge.className = 'badge badge-green'; }

    finishBtn.className = n > 0 ? 'btn btn-green btn-sm' : 'btn btn-secondary btn-sm';
    finishBtn.innerHTML = `🔍 Finish &amp; Search (<span id="camCountLbl">${n}</span>)`;
    thumbsEl.innerHTML = stagedPhotos.map((p, i) => `
      <div class="cam-thumb-item" onclick="openCameraShotLightbox(${i})" title="Tap to inspect sharpness">
        <img src="${p.saveWebp}" />
        <button type="button" class="cam-thumb-remove" onclick="removeCameraShot(${i}, event)" title="Delete shot">×</button>
      </div>
    `).join('');

    if (stagedUpc) {
      upcBadge.textContent = `║▌ UPC Locked: ${stagedUpc}`;
      upcBadge.classList.remove('hidden');
    } else upcBadge.classList.add('hidden');
  }

  window.openCameraShotLightbox = (idx) => {
    const list = camMode === 'pile' ? pilePhotos : stagedPhotos;
    openLightbox(list.map(p => p.saveWebp), idx);
  };

  window.removeCameraShot = (idx, ev) => {
    if (ev) ev.stopPropagation();
    if (camMode === 'pile') {
      if (idx < 0 || idx >= pilePhotos.length) return;
      pilePhotos.splice(idx, 1);
      if (activePilePhotoIdx >= pilePhotos.length) activePilePhotoIdx = Math.max(0, pilePhotos.length - 1);
      updateCameraOverlayUI();
      if (pilePhotos.length > 0) {
        document.getElementById('pilePreviewImg').src = pilePhotos[activePilePhotoIdx].saveWebp;
        document.getElementById('pileFsImg').src = pilePhotos[activePilePhotoIdx].saveWebp;
        renderPileShotSwitchers();
      } else {
        document.getElementById('pilePreviewWrap').classList.add('hidden');
      }
      toast('Pile shot deleted — ready to retake');
      return;
    }
    if (idx < 0 || idx >= stagedPhotos.length) return;
    stagedPhotos.splice(idx, 1);
    updateCameraOverlayUI();
    updateStageUI();
    toast('Shot deleted — ready to retake');
  };

  async function openHighResCameraStream(preferredId = '') {
    const devId = preferredId || cfg.preferredCameraId || '';
    const attempts = [];
    // Request 1920x1080 ideal for responsive live viewfinder & Focus Peaking;
    // ImageCapture.takePhoto() independently captures full native sensor resolution.
    if (devId) {
      attempts.push(
        { video: { deviceId: { exact: devId }, width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: { ideal: 'continuous' } }, audio: false },
        { video: { deviceId: { exact: devId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { deviceId: { exact: devId } }, audio: false }
      );
    }
    attempts.push(
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: { ideal: 'continuous' } }, audio: false },
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false }
    );
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
      const stream = await openHighResCameraStream();
      await bindStreamToViewfinder(stream);
      try { history.pushState({ view: currentView, modal: 'camera' }, ''); } catch (_) {}

      if (camMode === 'single' && 'BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128'] });
        let lastCheck = 0;
        const detectLoop = async (ts) => {
          if (!camStream || camMode !== 'single') return;
          if (!camPeakingOn && !stagedUpc && ts - lastCheck > 450 && video.readyState >= 2) {
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
    if (camMode === 'pile' && pilePhotos.length >= 4) { toast('Max 4 pile photos reached — tap Finish & Analyze'); return; }
    const video = document.getElementById('camVideo');
    if (!video.videoWidth && !camImageCapture) return;

    camCapturing = true;
    const shutterBtn = document.getElementById('camShutterBtn');
    if (shutterBtn) shutterBtn.disabled = true;

    const flash = document.getElementById('camFlash');
    flash.classList.add('flash');
    setTimeout(() => flash.classList.remove('flash'), 160);

    const isSingleCoverSlot = camMode === 'single' && stagedPhotos.length < 2;
    const decodeOpts = camMode === 'pile'
      ? { aiMaxDim: 3072, aiQuality: 0.92, saveMaxDim: 2048, saveQuality: 0.82, squarePreview: false }
      : { aiMaxDim: 2048, aiQuality: 0.90, saveMaxDim: 1600, saveQuality: 0.84, squarePreview: isSingleCoverSlot };

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
        const saveWebp = decodeOpts.squarePreview
          ? renderSquareFittedPreview(video, video.videoWidth, video.videoHeight, decodeOpts.saveMaxDim, 'image/webp', decodeOpts.saveQuality)
          : renderSourceToDataUrl(video, video.videoWidth, video.videoHeight, decodeOpts.saveMaxDim, 'image/webp', decodeOpts.saveQuality);
        pair = { apiB64: apiDataUrl.split(',')[1], saveWebp };
      }

      if (pair) {
        if (camMode === 'pile') {
          pilePhotos.push(pair);
          updateCameraOverlayUI();
          toast(`Shot ${pilePhotos.length} captured — tap thumb to check sharpness, or Finish & Analyze`);
        } else {
          const slotIdx = stagedPhotos.length;
          stagedPhotos.push(pair);
          if (slotIdx === 2) {
            // Normalize uploaded/captured spine immediately without requiring AI
            stagedSpineSourceUrl = pair.saveWebp;
            stagedSpineThumbUrl = await normalizeSpineDataUrl(pair.saveWebp, '');
            stagedSpineFlipped = false;
          }
          updateStageUI();
          updateCameraOverlayUI();
          if (stagedPhotos.length === 1) toast('Front + Side A captured! Flip for Back + Side B');
          else if (stagedPhotos.length === 2) toast('Back + Side B captured! Snap Spine (optional) or Finish & Search');
          else if (stagedPhotos.length === 3) toast('Spine captured! Review orientation or tap 🔍 Finish & Search');
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
    const modeNow = camMode;
    hideCameraUI();
    if (history.state?.modal === 'camera') {
      try { history.back(); } catch (_) {}
    }
    if (modeNow === 'pile' && pilePhotos.length > 0) {
      applyLoadedPilePhotos(pilePhotos, false);
    }
  };

  window.finishCameraAndSearch = () => {
    const modeNow = camMode;
    const hasSingleShots = stagedPhotos.length > 0;
    const hasPileShots = pilePhotos.length > 0;
    hideCameraUI();
    if (history.state?.modal === 'camera') {
      try { history.replaceState({ view: currentView, modal: null }, ''); } catch (_) {}
    }
    if (modeNow === 'single' && hasSingleShots) {
      runFullScan();
    } else if (modeNow === 'pile' && hasPileShots) {
      applyLoadedPilePhotos(pilePhotos, true);
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
    setStatus(`Processing ${files.length} photo(s) (2048px AI / 1600×1600 WebP)...`, true);
    try {
      for (const file of files) {
        if (stagedPhotos.length >= 4) { toast('Max 4 photos per scan'); break; }
        const slotIdx = stagedPhotos.length;
        const isCover = slotIdx < 2;
        const pair = await decodeBlobToPhotoPair(file, {
          aiMaxDim: 2048,
          aiQuality: 0.90,
          saveMaxDim: 1600,
          saveQuality: 0.84,
          squarePreview: isCover
        });
        stagedPhotos.push(pair);
        if (slotIdx === 2) {
          stagedSpineSourceUrl = pair.saveWebp;
          stagedSpineThumbUrl = await normalizeSpineDataUrl(pair.saveWebp, '');
          stagedSpineFlipped = false;
        }
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
    if (idx === 2 || stagedPhotos.length < 3) {
      if (!currentExtracted?.spine_thumb_url) {
        stagedSpineThumbUrl = '';
        stagedSpineSourceUrl = '';
        stagedSpineFlipped = false;
      }
    }
    updateStageUI();
  };

  window.flipStagedSpine180 = async (ev) => {
    if (ev) ev.stopPropagation();
    const cur = stagedSpineThumbUrl || currentExtracted?.spine_thumb_url || stagedPhotos[2]?.saveWebp || '';
    if (!cur) return;
    if (!stagedSpineSourceUrl) stagedSpineSourceUrl = cur;
    const rotated = await rotateDataUrlByDeg(cur, 180, 'image/webp', 0.84, 1200);
    stagedSpineThumbUrl = rotated;
    stagedSpineFlipped = !stagedSpineFlipped;
    if (currentExtracted) {
      currentExtracted.spine_thumb_url = rotated;
      currentExtracted.spine_source_url = stagedSpineSourceUrl;
      currentExtracted.spine_flipped = stagedSpineFlipped;
    }
    if (currentInspected) {
      currentInspected.spine_thumb_url = rotated;
      currentInspected.spine_source_url = stagedSpineSourceUrl;
      currentInspected.spine_flipped = stagedSpineFlipped;
    }
    updateStageUI();
    toast('↻ Spine flipped 180°', 1600);
  };

  window.openStagedSpineLightbox = () => {
    const src = stagedSpineThumbUrl || currentExtracted?.spine_thumb_url || stagedPhotos[2]?.saveWebp || '';
    if (src) openLightbox([src], 0);
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
    const activeSpineUrl = stagedSpineThumbUrl || currentExtracted?.spine_thumb_url || '';
    const hasAnything = stagedPhotos.length > 0 || Boolean(stagedUpc) || manualReady;

    document.getElementById('singleActionRow').classList.toggle('hidden', !hasAnything && !currentInspected);
    document.getElementById('btnRunSearch').disabled = !hasAnything;
    document.getElementById('btnClearStage').classList.toggle('hidden', !hasAnything && !currentInspected);

    const box = document.getElementById('stagedSummary');
    box.classList.toggle('hidden', stagedPhotos.length === 0 && !stagedUpc && !activeSpineUrl);

    const upcRow = document.getElementById('stagedUpcRow');
    if (stagedUpc) {
      upcRow.classList.remove('hidden');
      upcRow.innerHTML = `<span class="upc-pill">║▌ UPC: ${esc(stagedUpc)} <button onclick="clearStagedUpc()" title="Remove UPC">×</button></span>`;
    } else {
      upcRow.classList.add('hidden');
      upcRow.innerHTML = '';
    }

    // Responsive gallery: Front & Back side-by-side square tiles (1 cover capped at 420px), full-width Spine strip below
    const coverIndices = [];
    if (stagedPhotos[0]) coverIndices.push({ idx: 0, label: 'FRONT' });
    if (stagedPhotos[1]) coverIndices.push({ idx: 1, label: 'BACK' });
    if (stagedPhotos[3]) coverIndices.push({ idx: 3, label: 'EXTRA' });

    let galleryHtml = '';
    if (coverIndices.length > 0) {
      const singleCls = coverIndices.length === 1 ? 'single-cover' : '';
      galleryHtml += `<div class="photo-gallery-covers ${singleCls}">${coverIndices.map(c => `
        <div class="photo-tile" onclick="openStagedLightbox(${c.idx})">
          <img src="${stagedPhotos[c.idx].saveWebp}" alt="${c.label}" />
          <span class="photo-tile-label">${c.label}</span>
          <div class="photo-tile-actions">
            <button type="button" class="photo-tile-btn danger" onclick="removeStagedPhoto(${c.idx}, event)" title="Remove ${c.label}">×</button>
          </div>
        </div>
      `).join('')}</div>`;
    }

    const spinePreviewSrc = activeSpineUrl || stagedPhotos[2]?.saveWebp || '';
    if (spinePreviewSrc) {
      galleryHtml += `
        <div class="photo-gallery-spine">
          <div class="photo-gallery-spine-bar">
            <span style="font-size:0.7rem; font-weight:800; letter-spacing:0.06em; color:var(--muted);">SPINE${stagedSpineFlipped ? ' (FLIPPED 180°)' : ''}</span>
            <div class="inline-actions" style="gap:4px;">
              <button type="button" class="photo-tile-btn" onclick="flipStagedSpine180(event)" title="Flip spine 180°">↻ Flip 180°</button>
              ${stagedPhotos[2] ? `<button type="button" class="photo-tile-btn danger" onclick="removeStagedPhoto(2, event)" title="Remove spine">×</button>` : ''}
            </div>
          </div>
          <div class="photo-gallery-spine-imgwrap" onclick="openStagedSpineLightbox()" title="Tap to zoom spine">
            <img src="${spinePreviewSrc}" alt="Spine" />
          </div>
        </div>
      `;
    }

    document.getElementById('previewStrip').innerHTML = galleryHtml;
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
- Media Condition MUST be one of: ${JSON.stringify(MEDIA_GRADES.filter(g => g !== 'Not Graded'))}
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

  function setAudioArtwork(artUrl, format = '') {
    const el = document.getElementById('audioArt');
    if (!el) return;
    const fallbackIcon = /vinyl/i.test(format) ? '💿' : (/cd/i.test(format) ? '📀' : '📼');
    if (artUrl) {
      el.innerHTML = `<img src="${esc(artUrl)}" alt="" onerror="this.parentElement.textContent='${fallbackIcon}'" />`;
    } else {
      el.textContent = fallbackIcon;
    }
  }

  function clearAudioDirectYoutubeMode() {
    activeDirectYoutubeUrl = '';
    const bar = document.getElementById('audioBar');
    const playBtn = document.getElementById('audioPlayBtn');
    const openBtn = document.getElementById('audioOpenInBtn');
    if (bar) bar.classList.remove('is-yt-direct');
    if (playBtn) {
      playBtn.classList.remove('is-yt');
      playBtn.title = 'Play / Pause';
    }
    if (openBtn) openBtn.classList.remove('hidden');
  }

  function setAudioDirectYoutubeMode(url, labelTarget) {
    activeDirectYoutubeUrl = url;
    const bar = document.getElementById('audioBar');
    const playBtn = document.getElementById('audioPlayBtn');
    const openBtn = document.getElementById('audioOpenInBtn');
    if (bar) bar.classList.add('is-yt-direct');
    if (playBtn) {
      playBtn.classList.add('is-yt');
      playBtn.textContent = '🔴';
      playBtn.title = 'Search on YouTube';
    }
    if (openBtn) openBtn.classList.add('hidden');
    updateAudioMarquee(`🔍 Not on streaming — Tap to search YouTube: ${labelTarget}`);
  }

  window.handleAudioMetaClick = () => {
    if (activeDirectYoutubeUrl) {
      window.open(activeDirectYoutubeUrl, '_blank', 'noopener');
    }
  };

  function syncTrackPlayButtons() {
    document.querySelectorAll('[data-play-key]').forEach(btn => {
      const k = btn.dataset.playKey || '';
      const isMatch = Boolean(activeTrackBtnKey && k === activeTrackBtnKey && activeClipState !== 'idle');
      const row = btn.closest('.track-row, .notable-row');

      btn.classList.remove('is-playing', 'is-loading', 'is-paused');
      if (row) row.classList.remove('is-playing', 'is-loading', 'is-paused');

      if (!isMatch) {
        btn.textContent = '▶';
        return;
      }

      if (activeClipState === 'playing') {
        btn.textContent = '⏸';
        btn.classList.add('is-playing');
        if (row) row.classList.add('is-playing');
      } else if (activeClipState === 'loading') {
        btn.textContent = '…';
        btn.classList.add('is-loading');
        if (row) row.classList.add('is-loading');
      } else if (activeClipState === 'paused') {
        btn.textContent = '▶';
        btn.classList.add('is-paused');
        if (row) row.classList.add('is-paused');
      } else {
        btn.textContent = '▶';
      }
    });
  }

  window.stopHighlightAudio = () => {
    clipReqId++;
    closeOpenInMenu();
    clearAudioDirectYoutubeMode();
    try { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } catch (_) {}
    activeTrackBtnKey = '';
    activePlaybackKey = '';
    activeClipState = 'idle';
    activePlatforms = null;
    activeFallbackClip = null;
    setAudioArtwork('');
    document.getElementById('audioBar').classList.add('hidden');
    document.body.classList.remove('has-audio');
    document.getElementById('audioProgress').style.width = '0%';
    document.getElementById('audioPlayBtn').textContent = '▶';
    syncTrackPlayButtons();
  };

  window.toggleHighlightAudio = () => {
    if (activeDirectYoutubeUrl) {
      window.open(activeDirectYoutubeUrl, '_blank', 'noopener');
      return;
    }
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
    clearAudioDirectYoutubeMode();
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

  audioEl.addEventListener('play', () => {
    if (audioEl.src !== SILENT_WAV) {
      document.getElementById('audioPlayBtn').textContent = '⏸';
      if (activeTrackBtnKey) activeClipState = 'playing';
      syncTrackPlayButtons();
    }
  });
  audioEl.addEventListener('pause', () => {
    if (audioEl.src === SILENT_WAV) return;
    if (!activeDirectYoutubeUrl) document.getElementById('audioPlayBtn').textContent = '▶';
    if (activeTrackBtnKey && activeClipState !== 'loading') activeClipState = 'paused';
    syncTrackPlayButtons();
  });
  audioEl.addEventListener('ended', () => {
    if (audioEl.src === SILENT_WAV) return;
    if (!activeDirectYoutubeUrl) document.getElementById('audioPlayBtn').textContent = '▶';
    document.getElementById('audioProgress').style.width = '0%';
    if (activeTrackBtnKey) activeClipState = 'paused';
    syncTrackPlayButtons();
  });
  audioEl.addEventListener('timeupdate', () => {
    if (audioEl.src !== SILENT_WAV && audioEl.duration && isFinite(audioEl.duration)) {
      document.getElementById('audioProgress').style.width = `${Math.min(100, (audioEl.currentTime / audioEl.duration) * 100)}%`;
    }
  });

  async function loadHighlightClip(artist, track, album, myRunId, opts = {}) {
    const {
      forceReplace = true,
      forcePlay = cfg.autoPlayHighlight,
      strictTrack = true,
      notifyUser = false,
      ignoreRunId = false,
      targetYear = null,
      artworkUrl = undefined,
      format = ''
    } = opts;
    if (!artist && !track && !album) return;

    const resolvedYear = targetYear ?? (ignoreRunId ? activeStashItem?.year : currentInspected?.year) ?? null;
    const resolvedArt = artworkUrl !== undefined
      ? artworkUrl
      : (ignoreRunId
        ? (activeStashItem?.discogs_thumb || activeStashItem?.thumb_data_url || activeStashItem?.thumbs?.[0] || '')
        : (currentInspected?.discogs_thumb || stagedPhotos[0]?.saveWebp || ''));
    const resolvedFmt = format || (ignoreRunId ? activeStashItem?.format : currentInspected?.format) || '';

    const btnKey = normFull(`${artist}|${track || album}`);
    const playbackKey = normFull(`${artist}|${track || ''}|${album || ''}|${resolvedYear || ''}`);

    if (playbackKey === activePlaybackKey) {
      if (activeClipState === 'loading') return;
      if (audioEl.src && audioEl.src !== SILENT_WAV) {
        activeTrackBtnKey = btnKey;
        setAudioArtwork(resolvedArt, resolvedFmt);
        if (notifyUser) {
          toggleHighlightAudio();
        } else if (forcePlay && audioEl.paused) {
          audioEl.muted = false;
          audioEl.play().catch(() => {});
        }
        syncTrackPlayButtons();
        return;
      }
    }
    if (!forceReplace && activePlaybackKey && !audioEl.paused) return;

    if (notifyUser && forcePlay) {
      unlockAudioForAutoplay(true);
    }

    const myClipReq = ++clipReqId;
    closeOpenInMenu();
    clearAudioDirectYoutubeMode();
    activeFallbackClip = null;
    activePlatforms = null;
    activeTrackBtnKey = btnKey;
    activePlaybackKey = playbackKey;
    activeClipState = 'loading';
    syncTrackPlayButtons();

    const bar = document.getElementById('audioBar');
    const labelTarget = track || album;
    setAudioArtwork(resolvedArt, resolvedFmt);
    bar.classList.remove('hidden');
    document.body.classList.add('has-audio');
    document.getElementById('audioPlayBtn').textContent = '…';
    document.getElementById('audioProgress').style.width = '0%';
    updateAudioMarquee(`Finding clip & platforms: ${labelTarget}...`);

    const res = await CC.fetchAudioAndPlatforms(artist, track, album, strictTrack, resolvedYear);
    if ((!ignoreRunId && myRunId !== scanRunId) || myClipReq !== clipReqId) return;

    activePlatforms = res.platforms;

    const chosenClip = res.clip || (res.fallbackClip?.previewUrl && res.fallbackClip.safeAlt !== false ? res.fallbackClip : null);
    const isAltVersion = !res.clip && Boolean(chosenClip);

    if (chosenClip) {
      activeTrackBtnKey = btnKey;
      activePlaybackKey = playbackKey;
      const marqueeTxt = isAltVersion
        ? `🎵 ${chosenClip.trackName} — ${chosenClip.artistName} (alt version — "${res.requestedVersion || 'exact mix'}" unavailable)`
        : `🎵 ${chosenClip.trackName} — ${chosenClip.artistName}`;
      updateAudioMarquee(marqueeTxt);
      audioEl.muted = false;
      audioEl.src = chosenClip.previewUrl;
      audioEl.load();
      audioEl.currentTime = 0;
      if (forcePlay) {
        audioEl.play().catch(() => {
          activeClipState = 'paused';
          document.getElementById('audioPlayBtn').textContent = '▶';
          updateAudioMarquee(`Tap ▶ for 30s clip: ${chosenClip.trackName} — ${chosenClip.artistName}`);
          syncTrackPlayButtons();
        });
      } else {
        activeClipState = 'paused';
        document.getElementById('audioPlayBtn').textContent = '▶';
        syncTrackPlayButtons();
      }
      return;
    }

    activeTrackBtnKey = '';
    activePlaybackKey = '';
    activeClipState = 'idle';
    try { audioEl.pause(); audioEl.removeAttribute('src'); } catch (_) {}
    syncTrackPlayButtons();

    if (res.fallbackClip?.previewUrl) {
      activeFallbackClip = res.fallbackClip;
      document.getElementById('audioPlayBtn').textContent = '▶';
      updateAudioMarquee(`No exact stream for "${labelTarget}" — tap ▶ for closest (${res.fallbackClip.trackName}) or ▲`);
      if (notifyUser) toast(`Exact mix not on streaming — tap ▶ for closest or ▲ YouTube`, 3200);
      return;
    }

    const hasStreamingPlatform = Boolean(
      res.platforms?.spotify || res.platforms?.apple || res.platforms?.deezer
    );
    if (!hasStreamingPlatform && res.platforms?.youtube?.url) {
      setAudioDirectYoutubeMode(res.platforms.youtube.url, labelTarget);
      if (notifyUser) toast(`Not on streaming — tap 🔴 to search YouTube`, 3000);
    } else {
      document.getElementById('audioPlayBtn').textContent = '—';
      updateAudioMarquee(`No 30s stream for "${labelTarget}" — tap ▲ to open on streaming/YouTube`);
      if (notifyUser) toast(`No 30s preview — tap ▲ to open streaming/YouTube`, 3000);
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

  window.toggleAutoGradeOnScan = (checked) => {
    cfg.autoGradeOnScan = Boolean(checked);
    CC.persistCfg();
    const scanChk = document.getElementById('scanAutoGradeChk');
    const cfgChk = document.getElementById('cfgAutoGradeOnScan');
    if (scanChk) scanChk.checked = cfg.autoGradeOnScan;
    if (cfgChk) cfgChk.checked = cfg.autoGradeOnScan;
  };

  async function cropSpineFromStagedPhoto(spineCrop) {
    if (!spineCrop || typeof spineCrop !== 'object' || !Array.isArray(spineCrop.box_2d) || spineCrop.box_2d.length !== 4) {
      return { sourceUrl: '', thumbUrl: '', flipped: false };
    }
    const rawIdx = Number(spineCrop.photo_index);
    const pIdx = Number.isInteger(rawIdx) && rawIdx >= 0 && rawIdx < stagedPhotos.length
      ? rawIdx
      : (stagedPhotos.length >= 3 ? 2 : 0);
    const photo = stagedPhotos[pIdx];
    if (!photo) return { sourceUrl: '', thumbUrl: '', flipped: false };

    const nums = spineCrop.box_2d.map(Number);
    if (!nums.every(Number.isFinite)) return { sourceUrl: '', thumbUrl: '', flipped: false };
    const isUnit = Math.max(...nums) > 0 && Math.max(...nums) <= 1.01;
    let [y1, x1, y2, x2] = nums.map(v => Math.max(0, Math.min(1000, isUnit ? v * 1000 : v)));
    if (y1 > y2) [y1, y2] = [y2, y1];
    if (x1 > x2) [x1, x2] = [x2, x1];
    if ((y2 - y1) < 15 || (x2 - x1) < 15) return { sourceUrl: '', thumbUrl: '', flipped: false };

    const rotationHint = String(spineCrop.rotation_hint || '').trim();

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const nw = img.naturalWidth || img.width;
          const nh = img.naturalHeight || img.height;
          if (!nw || !nh) { resolve({ sourceUrl: '', thumbUrl: '', flipped: false }); return; }
          const sx = Math.max(0, Math.floor((x1 / 1000) * nw));
          const sy = Math.max(0, Math.floor((y1 / 1000) * nh));
          const sw = Math.max(10, Math.min(nw - sx, Math.ceil(((x2 - x1) / 1000) * nw)));
          const sh = Math.max(10, Math.min(nh - sy, Math.ceil(((y2 - y1) / 1000) * nh)));

          // Keep unrotated tight crop as spine_source_url so Flip 180° / re-orientation never loses quality
          const srcScale = Math.max(sw, sh) > 1200 ? (1200 / Math.max(sw, sh)) : 1;
          const srcCanvas = document.createElement('canvas');
          srcCanvas.width = Math.max(1, Math.round(sw * srcScale));
          srcCanvas.height = Math.max(1, Math.round(sh * srcScale));
          const sctx = srcCanvas.getContext('2d');
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(img, sx, sy, sw, sh, 0, 0, srcCanvas.width, srcCanvas.height);
          const sourceUrl = canvasToDataUrl(srcCanvas, 'image/webp', 0.86);

          // Normalize to upright horizontal landscape using rotation_hint when confident
          const tr = CC.resolveSpineTransform(sw, sh, rotationHint);
          const rawDstW = tr.swapDims ? sh : sw;
          const rawDstH = tr.swapDims ? sw : sh;
          const maxW = 1200;
          const scale = rawDstW > maxW ? (maxW / rawDstW) : 1;
          const dstW = Math.max(1, Math.round(rawDstW * scale));
          const dstH = Math.max(1, Math.round(rawDstH * scale));

          const c = document.createElement('canvas');
          c.width = dstW;
          c.height = dstH;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.translate(dstW / 2, dstH / 2);
          ctx.rotate((tr.angleDeg * Math.PI) / 180);
          if (tr.swapDims) {
            ctx.drawImage(img, sx, sy, sw, sh, -dstH / 2, -dstW / 2, dstH, dstW);
          } else {
            ctx.drawImage(img, sx, sy, sw, sh, -dstW / 2, -dstH / 2, dstW, dstH);
          }
          resolve({ sourceUrl, thumbUrl: canvasToDataUrl(c, 'image/webp', 0.84), flipped: false });
        } catch (_) {
          resolve({ sourceUrl: '', thumbUrl: '', flipped: false });
        }
      };
      img.onerror = () => resolve({ sourceUrl: '', thumbUrl: '', flipped: false });
      img.src = photo.apiB64 ? `data:image/jpeg;base64,${photo.apiB64}` : photo.saveWebp;
    });
  }

  async function runVisionOCR(myRunId) {
    const keepOldGrades = Boolean(editingStashItem && !document.getElementById('chkRegradeEdit').checked);
    const shouldGradeNow = Boolean(cfg.autoGradeOnScan) && !keepOldGrades;
    setStatus(
      shouldGradeNow
        ? `Inspecting & grading ${stagedPhotos.length} photo(s) on ${aiEngineLabel()}...`
        : `Reading ${stagedPhotos.length} photo(s) (fast OCR) on ${aiEngineLabel()}...`,
      true,
      { cancellable: true }
    );

    const upcHint = stagedUpc ? `User also scanned UPC barcode: ${stagedUpc}.` : '';
    const spineHint = stagedPhotos.length >= 3
      ? 'Photo index 2 (3rd photo) is typically a close-up of the SPINE — inspect it closely for catalog #, country text, cut-out markings (hole punches, saw cuts, notched corners, promo stamps), AND return a tight "spine_crop" box.'
      : 'If any attached photo clearly shows the spine, inspect it for catalog #, country text, cut-out markings (hole punches, saw cuts, notched corners, promo stamps), and optionally return "spine_crop".';

    const prompt = shouldGradeNow
      ? `You are a meticulous physical music media OCR, Discogs pressing-ID, and strict Goldmine visual grading expert. Inspect ALL attached photos carefully. ${upcHint}

TRUE VISUAL FORMAT RULE (CRITICAL):
- Detect "detected_format" ("Cassette" | "CD" | "Vinyl" | "Unknown") STRICTLY from what you physically see in the photos. NEVER guess or override based on any filter!

PHOTO-SCOPE, SPINE & LOOSE-MEDIA AWARENESS:
- Photos are 0-indexed (0 = Front + Side A, 1 = Back + Side B, 2 = Spine close-up if provided, 3 = extra detail if provided).
- ${spineHint}
- Look carefully at whether a case, J-card, jacket, or cover insert actually appears in the photos.
- If ONLY the bare cassette shell or bare disc is shown (no case, no J-card, no cover insert), treat it as LOOSE MEDIA: set "has_case_or_insert": false, set "sleeve_condition": "No Cover", and explicitly note in "physical_details" that this is loose media with no case/insert.

OCR RULES:
- Ignore non-catalog manufacturing/tax/standard codes (Dolby, HX Pro, TSE, TS-2240, KTB, JASRAC, GEMA, BIEM) for "raw_catalog_number".
- Read EVERY visible song title verbatim in "visible_tracks" so we can verify Discogs listings against the actual media.
- Read exact physical shell/window/spine/pressing clues: shell color, timing window markings (e.g. "100-50-0" vs "0-50-0" vs blank vs dots), plant codes (e.g. "SR", "AR", "CR"), screws vs welded, paper label vs direct print, club stamps ("CRC", "BMG"), country/address text, copyright years, and any cut-out markings (saw cuts, drill holes, notched corners, promo stamps) on the spine/case.
- ANTI-HALLUCINATION CLUB RULE: NEVER guess "CRC" or "BMG" for "club_edition" unless you can quote the EXACT legible club text visibly printed in the photo inside "club_evidence" (e.g., "CRC", "BMG Direct Marketing", "Columbia House", "Manufactured by Columbia House"). If no club text is clearly printed, set "club_evidence": "" and "club_edition": "None" or "Unknown".

STRICT DISCOGS SELLER GRADING RULES (Be brutally honest and conservative — never over-grade!):
1. List every flaw first in "media_defects" and "sleeve_defects" (including cut-out saw cuts, hole punches, notched spines/corners, promo stamps).
2. Media Condition MUST be one of: ${JSON.stringify(MEDIA_GRADES.filter(g => g !== 'Not Graded'))}
   * "Mint (M)" ONLY if factory sealed. "Near Mint (NM or M-)" = spotless, zero visible wear.
   * "Very Good Plus (VG+)" = very clean, only tiny handling scuffs, crisp flat label.
   * "Very Good (VG)" = visible scuffs/scratches, light label wear or fading.
   * "Good Plus (G+)" = heavy scratches/scuffing, peeling/warped/bubbling/stained label, writing/yellowing.
   * "Good (G)" / "Fair (F)" / "Poor (P)" = cracked shell, missing felt pad, torn label, deep gouges.
3. Sleeve Condition MUST be one of: ${JSON.stringify(SLEEVE_GRADES)}
   * No case/cover shown = "No Cover". Plain blank = "Generic".
   * "Very Good Plus (VG+)" = clean insert, minimal edge wear, no case cracks.
   * "Very Good (VG)" = creases, sticker residue, cut-out notch/saw cut, moderate case scuffs or small crack.
   * "Good Plus (G+)" = paint/ink/water stains, heavy creases, ripped flap, heavily scratched/cracked case.
   * "Good (G)" / "Fair (F)" / "Poor (P)" = severe stains obscuring art, torn/missing pieces, heavy water damage.
4. When between two grades, ALWAYS pick the LOWER grade. NEVER say "mint" in "condition_note" unless sealed.

Return ONLY valid JSON:
{
  "detected_format": "Cassette" | "CD" | "Vinyl" | "Unknown",
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
  "club_evidence": "exact quoted club text visible in photo (e.g. 'CRC', 'BMG Direct', 'Columbia House'), or empty string",
  "physical_details": "detailed plain-English list of EVERY visible physical pressing identifier (mention loose media if no case/insert; shell color, window markings, plant codes, paper label vs direct print, barcode presence, spine cut-out saw cuts/hole punches/notches, promo stamps)",
  "spine_crop": null or { "photo_index": 0-based photo index containing the clearest spine, "box_2d": [ymin, xmin, ymax, xmax] on 0-1000 scale tightly hugging the spine, "rotation_hint": "0" | "90cw" | "90ccw" | "180" (rotation needed to make spine text read horizontally upright left-to-right) },
  "media_defects": ["list every flaw on cassette/disc, or empty array if spotless"],
  "sleeve_defects": ["list every flaw on case/insert/spine including cut-out holes/saw cuts, or empty array if spotless or no cover"],
  "media_condition": "exact Discogs media grade",
  "sleeve_condition": "exact Discogs sleeve grade",
  "condition_note": "blunt factual seller note listing visible flaws (NEVER say 'mint' unless sealed)",
  "visible_tracks": ["every song title clearly visible on shell/insert"]
}`
      : `You are a fast, meticulous physical music media OCR and Discogs pressing-ID expert. Inspect ALL attached photos carefully. ${upcHint}

TRUE VISUAL FORMAT RULE (CRITICAL):
- Detect "detected_format" ("Cassette" | "CD" | "Vinyl" | "Unknown") STRICTLY from what you physically see in the photos. NEVER guess or override based on any filter!

PHOTO-SCOPE, SPINE & LOOSE-MEDIA AWARENESS:
- Photos are 0-indexed (0 = Front + Side A, 1 = Back + Side B, 2 = Spine close-up if provided, 3 = extra detail if provided).
- ${spineHint}
- If ONLY the bare cassette shell or bare disc is shown (no case, no J-card, no cover insert), set "has_case_or_insert": false and note in "physical_details" that this is loose media with no case/insert.

OCR RULES:
- Ignore non-catalog manufacturing/tax/standard codes (Dolby, HX Pro, TSE, TS-2240, KTB, JASRAC, GEMA, BIEM) for "raw_catalog_number".
- Read EVERY visible song title verbatim in "visible_tracks" so we can verify Discogs listings against the actual media.
- Read exact physical shell/window/spine/pressing clues: shell color, timing window markings (e.g. "100-50-0" vs "0-50-0" vs blank vs dots), plant codes (e.g. "SR", "AR", "CR"), screws vs welded, paper label vs direct print, club stamps ("CRC", "BMG"), country/address text, copyright years, and any spine cut-out markings (hole punches, saw cuts, notched corners, promo stamps).
- ANTI-HALLUCINATION CLUB RULE: NEVER guess "CRC" or "BMG" for "club_edition" unless you can quote the EXACT legible club text visibly printed in the photo inside "club_evidence". Otherwise set "club_evidence": "" and "club_edition": "None" or "Unknown".

Return ONLY valid JSON:
{
  "detected_format": "Cassette" | "CD" | "Vinyl" | "Unknown",
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
  "club_evidence": "exact quoted club text visible in photo (e.g. 'CRC', 'BMG Direct', 'Columbia House'), or empty string",
  "physical_details": "detailed plain-English list of EVERY visible physical pressing identifier (mention loose media if no case/insert; shell color, window markings, plant codes, paper label vs direct print, barcode presence, spine cut-out saw cuts/hole punches/notches, promo stamps)",
  "spine_crop": null or { "photo_index": 0-based photo index containing the clearest spine, "box_2d": [ymin, xmin, ymax, xmax] on 0-1000 scale tightly hugging the spine, "rotation_hint": "0" | "90cw" | "90ccw" | "180" (rotation needed to make spine text read horizontally upright left-to-right) },
  "visible_tracks": ["every song title clearly visible on shell/insert"]
}`;

    const parts = [{ text: prompt }, ...stagedPhotos.map(p => ({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }))];

    try {
      const ext = await CC.callAI(parts, 'MEDIUM', { retryLabel: 'Photo Vision' });
      if (myRunId !== scanRunId) return false;

      // Preserve Gemini's TRUE visual detected_format (NEVER overwrite with activeFormat!)
      const rawFmt = String(ext.detected_format || '').trim();
      ext.detected_format = ['Cassette', 'CD', 'Vinyl'].includes(rawFmt) ? rawFmt : 'Unknown';

      // Anti-hallucination guard: never accept CRC/BMG without quoted visible evidence
      if ((ext.club_edition === 'CRC' || ext.club_edition === 'BMG') && !String(ext.club_evidence || '').trim()) {
        ext.club_edition = 'Unknown';
      }

      if (keepOldGrades && editingStashItem) {
        ext.media_condition = editingStashItem.media_condition || 'Not Graded';
        ext.sleeve_condition = editingStashItem.sleeve_condition || 'Not Graded';
        ext.condition_note = editingStashItem.condition_note || '';
        ext.graded_by_ai = false;
      } else if (!shouldGradeNow) {
        ext.media_condition = 'Not Graded';
        ext.sleeve_condition = ext.has_case_or_insert === false ? 'No Cover' : 'Not Graded';
        ext.condition_note = '';
        ext.graded_by_ai = false;
      } else {
        ext.graded_by_ai = true;
      }

      // Auto-crop & upright-normalize spine if Gemini returned a valid spine_crop box
      ext.spine_thumb_url = stagedSpineThumbUrl || '';
      ext.spine_source_url = stagedSpineSourceUrl || '';
      ext.spine_flipped = Boolean(stagedSpineFlipped);
      if (ext.spine_crop) {
        const cropRes = await cropSpineFromStagedPhoto(ext.spine_crop);
        if (cropRes.thumbUrl) {
          ext.spine_thumb_url = cropRes.thumbUrl;
          ext.spine_source_url = cropRes.sourceUrl;
          ext.spine_flipped = false;
          stagedSpineThumbUrl = cropRes.thumbUrl;
          stagedSpineSourceUrl = cropRes.sourceUrl;
          stagedSpineFlipped = false;
          updateStageUI();
        }
      }

      currentExtracted = ext;

      document.getElementById('fTitle').value = ext.album_title || '';
      document.getElementById('fArtist').value = Array.isArray(ext.artists) ? ext.artists.join(', ') : (ext.artists || '');
      document.getElementById('fCatno').value = ext.raw_catalog_number || '';
      document.getElementById('fBarcode').value = stagedUpc || (ext.barcode || '').replace(/\D/g, '');
      if (['Cassette', 'CD', 'Vinyl'].includes(ext.detected_format)) {
        document.getElementById('fFormat').value = ext.detected_format;
      }
      document.getElementById('fLabel').value = ext.label || '';
      document.getElementById('fYear').value = ext.year || '';

      if (activeFormat !== 'Auto' && ext.detected_format !== 'Unknown' && norm(ext.detected_format) !== norm(activeFormat)) {
        toast(`⚠️ Photo shows a ${ext.detected_format}, but filter is set to ${activeFormat}`, 4800);
      }

      const clues = [
        ext.has_case_or_insert === false ? 'Loose media (no case/insert)' : '',
        ext.country_clues && ext.country_clues !== 'Not visible' ? `Country: ${ext.country_clues}` : '',
        ext.club_edition && ext.club_edition !== 'Unknown' ? `Club: ${ext.club_edition}${ext.club_evidence ? ` ("${ext.club_evidence}")` : ''}` : '',
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
    const visualFmt = ['Cassette', 'CD', 'Vinyl'].includes(currentExtracted?.detected_format) ? currentExtracted.detected_format : '';
    const format = activeFormat !== 'Auto' ? activeFormat : (visualFmt || document.getElementById('fFormat').value);
    const label = document.getElementById('fLabel').value.trim();
    const year = document.getElementById('fYear').value.trim();

    if (!title && !artist && !catno && !barcode) { toast('Add photos, UPC, or title first'); return; }

    document.getElementById('inspectorCard').classList.add('hidden');
    document.getElementById('detectiveCard').classList.add('hidden');
    document.getElementById('candidatesCard').classList.add('hidden');
    detectiveDiffs = {};
    detectivePickId = null;
    detectiveEliminatedIds = new Set();
    detectiveInspectedIds = new Set();
    detectiveInspectedCount = 0;
    priorBestVerdict = null;
    deepSearchCancelled = false;
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
        if (format) bp.format = format;
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

  function getRemainingUninspectedCount() {
    return currentCandidates.filter(c => !detectiveInspectedIds.has(c.id)).length;
  }

  function showNotFoundOutcome(reason) {
    const card = document.getElementById('detectiveCard');
    card.classList.remove('hidden');
    document.getElementById('detectiveBadge').innerHTML = `<span class="badge badge-red" style="margin:0;">🚫 Not on Discogs</span>`;
    document.getElementById('detectiveReasoning').textContent = reason;
    document.getElementById('detectiveQuestionBox').classList.add('hidden');
    const rem = getRemainingUninspectedCount();
    document.getElementById('detectiveActions').innerHTML = `
      ${rem > 0 ? `<button type="button" class="btn btn-purple btn-sm" onclick="runDeepDiscogsSearch()">🔎 Deep Search (${rem} Remaining)</button>` : ''}
      ${priorBestVerdict ? `<button type="button" class="btn btn-green btn-sm" onclick="restorePriorMatches()">↩️ Back to Top Matches</button>` : ''}
      ${currentCandidates.length ? `<button type="button" class="btn btn-secondary btn-sm" onclick="toggleCandidatesPanel()">View All ${currentCandidates.length} Matches</button>` : ''}
      <button type="button" class="btn btn-sm" onclick="inspectUnlistedItem()">🎧 Inspect &amp; Save Local Only</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="openManualModal('id')">🔗 Paste Discogs URL / Edit</button>
    `;
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  window.restorePriorMatches = async () => {
    if (priorBestVerdict) {
      const { verdict, isTiebreak } = priorBestVerdict;
      detectivePickId = verdict.best_release_id || detectivePickId;
      renderDetectiveCard(verdict, isTiebreak);
      const pickIdx = currentCandidates.findIndex(c => c.id === verdict.best_release_id);
      if ((verdict.outcome === 'exact_match' || isTiebreak) && pickIdx !== -1) {
        await inspectCandidate(pickIdx, scanRunId, { isConservativeTiebreak: isTiebreak });
      } else {
        renderCandidates(true);
      }
    } else if (currentCandidates.length) {
      visibleCandidateIds = null;
      renderCandidates(true);
      document.getElementById('candidatesCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  window.toggleCandidatesPanel = () => {
    const card = document.getElementById('candidatesCard');
    const willShow = card.classList.contains('hidden');
    if (willShow) {
      visibleCandidateIds = null;
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

    const rem = getRemainingUninspectedCount();
    const overflowBar = document.getElementById('candOverflowBar');
    if (rem > 0 && detectiveInspectedCount > 0) {
      overflowBar.classList.remove('hidden');
      overflowBar.innerHTML = `<button type="button" class="btn btn-purple btn-sm" style="width:100%;" onclick="runDeepDiscogsSearch()">🔎 Deep Search (Check All ${rem} Remaining Pressings)</button>`;
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

  function candidateMatchesVisualFormat(dossierOrCand, visualFmt) {
    if (!visualFmt || !['Cassette', 'CD', 'Vinyl'].includes(visualFmt)) return true;
    const rawFmt = Array.isArray(dossierOrCand?.format)
      ? dossierOrCand.format.join(' ')
      : String(dossierOrCand?.formats || dossierOrCand?.format || '');
    if (!rawFmt.trim()) return true;
    const hasCassette = /\bcassette\b/i.test(rawFmt);
    const hasCd = /\b(cd|cdr|cd-r|sacd|hdcd)\b/i.test(rawFmt);
    const hasVinyl = /\b(vinyl|lp|12"|7"|10"|flexi-disc|acetate)\b/i.test(rawFmt);
    if (visualFmt === 'Cassette') return hasCassette;
    if (visualFmt === 'CD') return hasCd;
    if (visualFmt === 'Vinyl') return hasVinyl;
    return true;
  }

  // ==================== TWO-TIER ZERO-GUESSING VERIFICATION ENGINE ====================
  async function verifyCandidateBatch(batch, myRunId, opts = {}) {
    const { maxSiblings = 8, progressPrefix = '🕵️', retryLabel = 'Verification' } = opts;
    const dossiers = [];
    const batchFetchedIds = new Set();
    const refQueue = [];

    const visualFormat = ['Cassette', 'CD', 'Vinyl'].includes(currentExtracted?.detected_format)
      ? currentExtracted.detected_format
      : '';
    const requestedFormat = activeFormat;
    const formatMismatch = Boolean(activeFormat !== 'Auto' && visualFormat && norm(visualFormat) !== norm(activeFormat));

    const pushReleaseDossier = (rel, fallbackCat) => {
      if (!rel || batchFetchedIds.has(rel.id)) return;
      batchFetchedIds.add(rel.id);
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
        if (!batchFetchedIds.has(refId)) refQueue.push(refId);
      });
    };

    for (let i = 0; i < batch.length; i++) {
      if (myRunId !== scanRunId || deepSearchCancelled) return null;
      setStatus(`${progressPrefix} Reading pressing notes (${i + 1}/${batch.length}) · API ${CC.getRateCount()}/58...`, true, { cancellable: true });
      const rel = await CC.getReleaseCached(batch[i].id);
      if (myRunId !== scanRunId || deepSearchCancelled) return null;
      pushReleaseDossier(rel, batch[i].catno);
    }

    const uniqueRefs = Array.from(new Set(refQueue)).filter(id => !batchFetchedIds.has(id)).slice(0, maxSiblings);
    for (let i = 0; i < uniqueRefs.length; i++) {
      if (myRunId !== scanRunId || deepSearchCancelled) return null;
      setStatus(`🔗 Auto-following sibling #${uniqueRefs[i]} (${i + 1}/${uniqueRefs.length}) · API ${CC.getRateCount()}/58...`, true, { cancellable: true });
      try {
        const refRel = await CC.getReleaseCached(uniqueRefs[i]);
        if (myRunId !== scanRunId || deepSearchCancelled) return null;
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

    // HARD FORMAT GATE (JS Pre-Guard): if photos clearly show a known format and ZERO fetched candidates match it,
    // immediately disqualify all wrong-format candidates instead of letting AI guess a wrong-format match.
    if (visualFormat && dossiers.length > 0) {
      const formatValidDossiers = dossiers.filter(d => candidateMatchesVisualFormat(d, visualFormat));
      if (formatValidDossiers.length === 0) {
        batchFetchedIds.forEach(id => {
          detectiveInspectedIds.add(id);
          detectiveEliminatedIds.add(id);
        });
        detectiveInspectedCount = detectiveInspectedIds.size;
        const mismatchHint = formatMismatch
          ? `Photos show a ${visualFormat}, not ${requestedFormat} — switch format filter to Auto or ${visualFormat} and search again.`
          : `Photos show a ${visualFormat}, but none of the ${dossiers.length} inspected Discogs listings are ${visualFormat} pressings.`;
        return {
          outcome: 'not_found',
          conservative_tiebreak: false,
          best_release_id: null,
          eliminated_ids: Array.from(batchFetchedIds),
          reasoning: mismatchHint,
          candidate_diffs: [],
          question: null
        };
      }
    }

    setStatus(`${progressPrefix} Verifying ${dossiers.length} pressing(s) on ${aiEngineLabel()}...`, true, { cancellable: true });

    const prompt = `You are a STRICT, ZERO-GUESSING Discogs Verification Engine. Accuracy is everything. NEVER guess or force a contradictory match!
Compare the user's photo(s), visible songs, catalog #, barcode, and physical details against ALL ${dossiers.length} complete, untruncated Discogs listings below.

RULE #0 — HARD FORMAT GATE (ABSOLUTE, NON-NEGOTIABLE):
- Visually detected physical format in the user's photos: "${visualFormat || 'Unknown'}" (User format filter: "${requestedFormat}").
- Cassette ≠ CD ≠ Vinyl. If the photos show a Cassette, EVERY CD or Vinyl listing is STRICTLY DISQUALIFIED (put its ID in "eliminated_ids"). Same for CD vs Cassette/Vinyl and Vinyl vs Cassette/CD.
- If ZERO candidates in the list below match the actual physical format shown in the photos, you MUST return "outcome": "not_found" with a blunt explanation (e.g., "Photos show a Cassette, not Vinyl — switch format filter to Auto or Cassette"). NEVER call a wrong-format listing an exact_match or likely_match!

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
  visual_format: visualFormat || 'Unknown',
  requested_format: requestedFormat,
  has_case_or_insert: currentExtracted?.has_case_or_insert ?? null,
  country_clues: currentExtracted?.country_clues || 'Not visible',
  club_edition: currentExtracted?.club_edition || 'Unknown',
  club_evidence: currentExtracted?.club_evidence || '',
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
    const verdict = await CC.callAI(parts, 'MEDIUM', { retryLabel });
    if (myRunId !== scanRunId || deepSearchCancelled) return null;

    const VALID_OUTCOMES = new Set(['exact_match', 'likely_match', 'needs_user', 'not_found']);
    const isObj = verdict && typeof verdict === 'object' && !Array.isArray(verdict);
    const outcome = isObj ? verdict.outcome : null;
    let verdictValid = isObj && VALID_OUTCOMES.has(outcome);

    // Malformed-verdict array validation BEFORE mutating detectiveInspectedIds
    if (verdictValid && verdict.candidate_diffs !== undefined && !Array.isArray(verdict.candidate_diffs)) {
      verdictValid = false;
    }
    if (verdictValid && verdict.eliminated_ids !== undefined && !Array.isArray(verdict.eliminated_ids)) {
      verdictValid = false;
    }
    if (verdictValid && outcome === 'needs_user' && verdict.question !== null && verdict.question !== undefined) {
      if (typeof verdict.question !== 'object' || Array.isArray(verdict.question)) {
        verdictValid = false;
      } else if (verdict.question.options !== undefined && !Array.isArray(verdict.question.options)) {
        verdictValid = false;
      }
    }

    if (verdictValid && (outcome === 'exact_match' || outcome === 'likely_match')) {
      const bestId = Number(verdict.best_release_id);
      const idKnown = Number.isFinite(bestId) && bestId > 0 && (
        batchFetchedIds.has(bestId) || currentCandidates.some(c => Number(c.id) === bestId)
      );
      if (!idKnown) verdictValid = false;
      else verdict.best_release_id = bestId;
    }

    if (verdictValid && outcome === 'needs_user') {
      const hasPrompt = Boolean(String(verdict.question?.prompt || '').trim());
      const hasReason = Boolean(String(verdict.reasoning || '').trim());
      if (!hasPrompt && !hasReason) verdictValid = false;
    }

    if (!verdictValid) {
      throw new Error('Empty or invalid verification verdict from Gemini — retry to re-check this batch');
    }

    // Safely normalize arrays before applying
    const safeDiffs = Array.isArray(verdict.candidate_diffs) ? verdict.candidate_diffs : [];
    const safeElim = Array.isArray(verdict.eliminated_ids) ? verdict.eliminated_ids.map(Number).filter(Number.isFinite) : [];
    if (verdict.question && Array.isArray(verdict.question.options)) {
      verdict.question.options = verdict.question.options.filter(o => o && typeof o === 'object' && o.label);
    }

    // HARD FORMAT GATE (JS Post-Guard): never allow wrong-format exact_match / likely_match
    if (visualFormat) {
      const wrongFormatIds = dossiers.filter(d => !candidateMatchesVisualFormat(d, visualFormat)).map(d => d.id);
      wrongFormatIds.forEach(id => { if (!safeElim.includes(id)) safeElim.push(id); });
      if ((verdict.outcome === 'exact_match' || verdict.outcome === 'likely_match') && verdict.best_release_id) {
        const pickedDossier = dossiers.find(d => Number(d.id) === Number(verdict.best_release_id))
          || currentCandidates.find(c => Number(c.id) === Number(verdict.best_release_id));
        if (pickedDossier && !candidateMatchesVisualFormat(pickedDossier, visualFormat)) {
          const validRemaining = dossiers.filter(d => candidateMatchesVisualFormat(d, visualFormat) && !safeElim.includes(d.id));
          verdict.best_release_id = null;
          verdict.conservative_tiebreak = false;
          verdict.outcome = validRemaining.length ? 'needs_user' : 'not_found';
          verdict.question = null;
          verdict.reasoning = validRemaining.length
            ? `Blocked wrong-format match: photos show a ${visualFormat}. Pick from the matching ${visualFormat} listings below.`
            : `Photos show a ${visualFormat}, not ${requestedFormat !== 'Auto' ? requestedFormat : 'these listings'} — switch format filter to Auto or ${visualFormat}.`;
        }
      }
    }

    batchFetchedIds.forEach(id => detectiveInspectedIds.add(id));
    detectiveInspectedCount = detectiveInspectedIds.size;
    safeDiffs.forEach(d => { if (d && d.id && d.short_diff) detectiveDiffs[d.id] = d.short_diff; });
    safeElim.forEach(id => detectiveEliminatedIds.add(id));
    return verdict;
  }

  window.runVariantDetective = async (subsetIds = null, myRunId = scanRunId, offset = 0) => {
    if (!CC.isAiReady() || !currentCandidates.length) return;
    deepSearchCancelled = false;

    const batch = subsetIds
      ? currentCandidates.filter(c => subsetIds.includes(c.id))
      : currentCandidates.slice(offset, offset + VERIFY_INITIAL_LIMIT);

    if (!batch.length) return;

    try {
      const verdict = await verifyCandidateBatch(batch, myRunId, {
        maxSiblings: 8,
        progressPrefix: '🕵️ Top-15 Fast Pass:',
        retryLabel: 'Verification'
      });
      if (!verdict || myRunId !== scanRunId) return;

      if (verdict.outcome === 'not_found') {
        setStatus('', false);
        renderCandidates(false);
        const rem = getRemainingUninspectedCount();
        let msg = verdict.reasoning || 'None of the top inspected Discogs listings match your photos/tracks.';
        if (rem > 0) msg += ` (${rem} more Discogs pressing(s) can be checked with Deep Search.)`;
        showNotFoundOutcome(msg);
        return;
      }

      detectivePickId = verdict.best_release_id || null;
      const isTiebreak = verdict.outcome === 'likely_match' || Boolean(verdict.conservative_tiebreak);
      priorBestVerdict = { verdict, isTiebreak };
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
        ${priorBestVerdict ? `<button type="button" class="btn btn-green btn-sm" onclick="restorePriorMatches()">↩️ Back to Top Matches</button>` : ''}
        <button type="button" class="btn btn-secondary btn-sm" onclick="toggleCandidatesPanel()">Pick Manually</button>
      `;
      renderCandidates(true);
    }
  };

  window.runDeepDiscogsSearch = async () => {
    if (!CC.isAiReady() || !currentCandidates.length) return;
    const myRunId = scanRunId;
    deepSearchCancelled = false;

    const remainingAll = currentCandidates.filter(c => !detectiveInspectedIds.has(c.id));
    if (!remainingAll.length) {
      toast('All Discogs candidates have already been checked');
      return;
    }

    const totalBatches = Math.ceil(remainingAll.length / VERIFY_DEEP_BATCH);
    let lastReason = '';

    try {
      for (let b = 0; b < totalBatches; b++) {
        if (myRunId !== scanRunId || deepSearchCancelled) return;
        const batch = remainingAll.slice(b * VERIFY_DEEP_BATCH, (b + 1) * VERIFY_DEEP_BATCH);
        const verdict = await verifyCandidateBatch(batch, myRunId, {
          maxSiblings: 8,
          progressPrefix: `🔎 Deep Search (${b + 1}/${totalBatches}):`,
          retryLabel: `Deep Search (${b + 1}/${totalBatches})`
        });
        if (!verdict || myRunId !== scanRunId || deepSearchCancelled) return;

        if (verdict.outcome !== 'not_found') {
          detectivePickId = verdict.best_release_id || null;
          const isTiebreak = verdict.outcome === 'likely_match' || Boolean(verdict.conservative_tiebreak);
          priorBestVerdict = { verdict, isTiebreak };
          renderDetectiveCard(verdict, isTiebreak);
          renderCandidates(verdict.outcome === 'needs_user' && (!verdict.question?.options?.length));

          const pickIdx = currentCandidates.findIndex(c => c.id === verdict.best_release_id);
          if ((verdict.outcome === 'exact_match' || isTiebreak) && pickIdx !== -1) {
            await inspectCandidate(pickIdx, myRunId, { isConservativeTiebreak: isTiebreak });
          } else {
            setStatus('', false);
            document.getElementById('detectiveCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
          return;
        }
        lastReason = verdict.reasoning || lastReason;
      }

      setStatus('', false);
      renderCandidates(false);
      showNotFoundOutcome(
        (lastReason || 'Deep Search checked all remaining Discogs pressings and found no better match.') +
        (priorBestVerdict ? ' You can return to your earlier Top Matches below.' : '')
      );
    } catch (err) {
      setStatus('', false);
      if (err.name === 'AbortError' || deepSearchCancelled) {
        if (priorBestVerdict) renderDetectiveCard(priorBestVerdict.verdict, priorBestVerdict.isTiebreak);
        return;
      }
      toast('Deep Search stopped: ' + err.message, 4500);
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

    const rem = getRemainingUninspectedCount();
    const plausible = currentCandidates.filter(c => !detectiveEliminatedIds.has(c.id));
    const mostCommon = plausible.slice().sort((a, b) => (b.community?.have || 0) - (a.community?.have || 0))[0] || null;
    const mostCommonIdx = mostCommon ? currentCandidates.indexOf(mostCommon) : -1;

    document.getElementById('detectiveActions').innerHTML = `
      ${(!isExact && !isTiebreak && mostCommon && mostCommonIdx !== -1) ? `<button type="button" class="btn btn-green btn-sm" onclick="pickConservativeCommon(${mostCommonIdx})">🎯 Pick Most Common (#${mostCommon.id} · ${mostCommon.community?.have || 0} have)</button>` : ''}
      ${rem > 0 ? `<button type="button" class="btn btn-purple btn-sm" onclick="runDeepDiscogsSearch()">🔎 Deep Search (${rem} Remaining)</button>` : ''}
      <button type="button" class="btn btn-secondary btn-sm" onclick="toggleCandidatesPanel()">View All ${currentCandidates.length} Matches</button>
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
        ? (editingStashItem.media_condition || 'Not Graded')
        : normalizeGrade(currentExtracted?.media_condition, MEDIA_GRADES, 'Not Graded');
      const sleeveCond = keepOldGrades
        ? (editingStashItem.sleeve_condition || 'Not Graded')
        : normalizeGrade(currentExtracted?.sleeve_condition, SLEEVE_GRADES, 'Not Graded');
      const condNote = keepOldGrades
        ? (editingStashItem.condition_note || '')
        : (currentExtracted?.condition_note || '');
      const spineThumb = stagedSpineThumbUrl || currentExtracted?.spine_thumb_url || (editingStashItem?.spine_thumb_url || '');
      const spineSource = stagedSpineSourceUrl || currentExtracted?.spine_source_url || (editingStashItem?.spine_source_url || '');
      const spineFlipped = stagedSpineThumbUrl ? Boolean(stagedSpineFlipped) : Boolean(currentExtracted?.spine_flipped ?? editingStashItem?.spine_flipped);

      currentInspected = {
        discogs_id: release.id, master_id: masterId, title: albumTitle, artist: artistName, catno, format,
        year: release.year || cand.year || '', label, country: release.country || cand.country || '',
        genres: [...(release.genres || []), ...(release.styles || [])],
        media_condition: mediaCond, sleeve_condition: sleeveCond, condition_note: condNote,
        spine_thumb_url: spineThumb, spine_source_url: spineSource, spine_flipped: spineFlipped,
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
      media_condition: keepOldGrades ? (editingStashItem.media_condition || 'Not Graded') : normalizeGrade(currentExtracted?.media_condition, MEDIA_GRADES, 'Not Graded'),
      sleeve_condition: keepOldGrades ? (editingStashItem.sleeve_condition || 'Not Graded') : normalizeGrade(currentExtracted?.sleeve_condition, SLEEVE_GRADES, 'Not Graded'),
      condition_note: keepOldGrades ? (editingStashItem.condition_note || '') : (currentExtracted?.condition_note || ''),
      spine_thumb_url: stagedSpineThumbUrl || currentExtracted?.spine_thumb_url || (editingStashItem?.spine_thumb_url || ''),
      spine_source_url: stagedSpineSourceUrl || currentExtracted?.spine_source_url || (editingStashItem?.spine_source_url || ''),
      spine_flipped: stagedSpineThumbUrl ? Boolean(stagedSpineFlipped) : Boolean(currentExtracted?.spine_flipped ?? editingStashItem?.spine_flipped),
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

  function buildTracklistHtml(tracks, matched = [], source = 'scan', defaultArtist = '') {
    const mSet = new Set(matched.map(norm));
    if (!tracks.length) return `<div style="padding:12px; color:var(--muted); font-size:0.84rem;">No tracklist available.</div>`;
    const fallbackArtist = defaultArtist || (source === 'stash' ? activeStashItem?.artist : currentInspected?.artist) || '';
    return tracks.map((t, i) => {
      const hit = mSet.has(norm(t.title)) || (t.artist && mSet.has(norm(`${t.artist} - ${t.title}`)));
      const fn = source === 'stash' ? `previewStashTrack(${i})` : `previewTrackByIndex(${i})`;
      const trackArtist = t.artist || fallbackArtist;
      const trackTitle = t.title || '';
      const playKey = normFull(`${trackArtist}|${trackTitle}`);
      return `<div class="track-row ${hit ? 'track-hit' : ''}">
        <div class="track-info">
          <div class="track-name">${esc(t.pos ? t.pos + ' · ' : '')}${esc(t.title)}</div>
          ${t.artist ? `<div class="track-sub">${esc(t.artist)}</div>` : ''}
        </div>
        ${hit ? '<span class="badge badge-green" style="margin:0;">Spotify</span>' : ''}
        <button type="button" class="play-pill-btn" data-play-key="${esc(playKey)}" onclick="${fn}" title="Play 30s preview">▶</button>
      </div>`;
    }).join('');
  }

  function buildNotableHitsHtml(item, source = 'scan') {
    let html = '';
    if (item.litmus_track) {
      const lArt = resolveLitmusArtist(item);
      const showArt = lArt && norm(lArt) !== norm(item.artist) && !/^various/i.test(lArt);
      const fn = source === 'stash' ? 'previewStashLitmus()' : 'previewLitmusTrack()';
      const litmusKey = normFull(`${lArt || ''}|${item.litmus_track}`);
      html += `<div class="notable-row litmus-row">
        <div><strong>🎧 Test Song:</strong> ${showArt ? `${esc(lArt)} — ` : ''}${esc(item.litmus_track)}</div>
        <button type="button" class="play-pill-btn sm" data-play-key="${esc(litmusKey)}" onclick="${fn}" title="Play Test Song">▶</button>
      </div>`;
    }
    const list = normalizeNotableList(item.notable_songs, item.artist);
    if (list.length) {
      html += `<div style="font-weight:800; margin-bottom:4px;">⭐ Notable / Recognizable Songs (${list.length}):</div>`;
      html += list.map((s, idx) => {
        const nArt = s.artist || item.artist || '';
        const showA = s.artist && norm(s.artist) !== norm(item.artist) && !/^various/i.test(s.artist);
        const fn = source === 'stash' ? `previewStashNotable(${idx})` : `previewScanNotable(${idx})`;
        const nKey = normFull(`${nArt}|${s.title}`);
        return `<div class="notable-row">
          <div style="flex:1; min-width:0;">
            <strong>${showA ? `${esc(s.artist)} — ` : ''}${esc(s.title)}</strong>
            ${s.reason ? `<div style="font-size:0.78rem; color:var(--muted);">${esc(s.reason)}</div>` : ''}
          </div>
          <button type="button" class="play-pill-btn sm" data-play-key="${esc(nKey)}" onclick="${fn}" title="Play 30s preview">▶</button>
        </div>`;
      }).join('');
    }
    return html || `<span style="color:var(--muted);">No major mainstream hits identified.</span>`;
  }

  function getCurrentSaveLockKeys() {
    if (!currentInspected) return [];
    const keys = [];
    const primary = editingStashItem?.id ? `stash:${editingStashItem.id}` : `rel:${currentInspected.discogs_id || 'local'}`;
    keys.push(primary);
    if (currentInspected.discogs_id) {
      const rk = `rel:${currentInspected.discogs_id}`;
      if (!keys.includes(rk)) keys.push(rk);
    }
    return keys;
  }

  window.updateSaveButtonsState = () => {
    if (!currentInspected) return;
    const isLocked = getCurrentSaveLockKeys().some(k => activeDiscogsSaves.has(k));
    const hasDiscogs = Boolean(currentInspected.discogs_id);
    const saveBtn = document.getElementById('btnSaveBoth');
    const saveLocalBtn = document.getElementById('btnSaveLocal');
    const needTiebreakConfirm = Boolean(hasDiscogs && currentInspected.is_conservative_tiebreak);
    const confirmed = document.getElementById('chkConfirmTiebreak')?.checked;
    if (saveBtn) saveBtn.disabled = isLocked || !hasDiscogs || !cfg.discogsToken || !cfg.discogsUser || (needTiebreakConfirm && !confirmed);
    if (saveLocalBtn) saveLocalBtn.disabled = isLocked;
  };

  function renderInspector(item, hasDiscogs) {
    document.getElementById('inspectorCard').classList.remove('hidden');
    document.getElementById('inspTitle').textContent = `${item.artist} — ${item.title}`;
    document.getElementById('inspSub').textContent = `${item.format} · ${item.country || '?'} · ${item.year || '?'} · ${item.label || 'Unknown Label'} · ${item.catno || 'No Cat#'}`;
    document.getElementById('inspBadge').innerHTML = hasDiscogs
      ? `<span class="badge ${item.is_conservative_tiebreak ? 'badge-yellow' : 'badge-blue'}">#${item.discogs_id}</span>`
      : `<span class="badge badge-yellow">Unlisted</span>`;

    let alerts = '';
    const visFmt = ['Cassette', 'CD', 'Vinyl'].includes(currentExtracted?.detected_format) ? currentExtracted.detected_format : '';
    if (activeFormat !== 'Auto' && visFmt && norm(visFmt) !== norm(activeFormat)) {
      alerts += `<div class="alert-box alert-format-warn">⚠️ Photo shows a ${esc(visFmt)}, but format filter is set to ${esc(activeFormat)}.</div>`;
    }
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
    const isAiGraded = Boolean(currentExtracted?.graded_by_ai);
    const hintEl = document.getElementById('aiGradeHint');
    if (hintEl) {
      if (keptEdit) {
        hintEl.textContent = 'Kept Saved Grade';
        hintEl.className = 'badge badge-purple';
      } else if (stagedPhotos.length && !isAiGraded) {
        hintEl.textContent = 'Not Graded Yet';
        hintEl.className = 'badge badge-yellow';
      } else if (stagedPhotos.length && isAiGraded) {
        hintEl.textContent = `AI Graded (${stagedPhotos.length} photo${stagedPhotos.length > 1 ? 's' : ''})`;
        hintEl.className = 'badge badge-purple';
      } else {
        hintEl.textContent = 'Manual Grade';
        hintEl.className = 'badge badge-purple';
      }
    }

    const aiGradeBtn = document.getElementById('btnAiGradeNow');
    if (aiGradeBtn) {
      if (stagedPhotos.length > 0) {
        aiGradeBtn.classList.remove('hidden');
        aiGradeBtn.disabled = false;
        aiGradeBtn.className = (!keptEdit && !isAiGraded) ? 'btn btn-green' : 'btn btn-secondary';
        aiGradeBtn.textContent = (!keptEdit && !isAiGraded) ? '✨ AI Grade Photos' : '✨ Re-Run AI Visual Grade';
      } else {
        aiGradeBtn.classList.add('hidden');
      }
    }

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
    document.getElementById('inspTracklist').innerHTML = buildTracklistHtml(item.tracklist, localMatch.matchedTracks, 'scan', item.artist);
    syncTrackPlayButtons();

    document.getElementById('tasteLocalBadges').innerHTML = buildSpotifyBadgesHtml(localMatch, true);

    document.getElementById('tasteScore').textContent = '...';
    document.getElementById('tasteBody').textContent = `Analyzing against your Taste Profile & Soft Spots on ${aiEngineLabel()}...`;
    document.getElementById('contextBox').classList.add('hidden');
    document.getElementById('tasteHits').innerHTML = '';
  }

  function buildSpotifyBadgesHtml(localMatch, includeSetupHint = false) {
    let badges = '';
    if (localMatch.hasProvenance) {
      if (localMatch.likedTrackMatches.length) {
        badges += `<span class="badge badge-green">💚 ${localMatch.likedTrackMatches.length} Liked Song${localMatch.likedTrackMatches.length > 1 ? 's' : ''}</span>`;
      }
      if (localMatch.likedArtistDetails.length) {
        badges += `<span class="badge badge-green">🎸 Artist Liked in Spotify</span>`;
      }
      if (localMatch.playlistOnlyTrackMatches.length) {
        badges += `<span class="badge badge-blue">📂 Playlist Only (${localMatch.playlistOnlyTrackMatches.length} track${localMatch.playlistOnlyTrackMatches.length > 1 ? 's' : ''})</span>`;
      } else if (localMatch.playlistOnlyArtistDetails.length && !localMatch.likedArtistDetails.length) {
        badges += `<span class="badge badge-blue">📂 Playlist Only (${esc(localMatch.playlistOnlyArtistDetails[0])})</span>`;
      }
    } else {
      if (localMatch.artistHit) {
        badges += localMatch.matchedArtists.length > 1
          ? `<span class="badge badge-green">🎸 ${localMatch.matchedArtists.length} Artists in Your Spotify</span>`
          : `<span class="badge badge-green">🎸 Artist in Your Spotify</span>`;
      }
      if (localMatch.matchedTracks.length) {
        badges += `<span class="badge badge-green">🎵 ${localMatch.matchedTracks.length} Track(s) in Your Library</span>`;
      }
    }
    if (includeSetupHint && !spotifyProfile && !document.getElementById('cfgTasteDna').value.trim()) {
      badges += `<span class="badge badge-yellow">Add Taste Profile or sync Spotify in Settings</span>`;
    }
    return badges;
  }

  const spLookupCache = new WeakMap();

  function normArtistKey(s) {
    return norm(s).replace(/^the\s+/, '').trim();
  }

  function getSpotifyLookup(profile) {
    if (!profile) return null;
    if (spLookupCache.has(profile)) return spLookupCache.get(profile);

    const artistByKey = new Map();
    const pairSet = new Set();
    const trackSourceByPair = new Map();
    const hasProvenance = Boolean(profile.provenanceVersion >= 2 || profile.trackSources);

    Object.entries(profile.allArtists || {}).forEach(([rawKey, rec]) => {
      const k1 = norm(rec?.name || rawKey);
      const k2 = normArtistKey(rec?.name || rawKey);
      if (k1 && !artistByKey.has(k1)) artistByKey.set(k1, rec);
      if (k2 && !artistByKey.has(k2)) artistByKey.set(k2, rec);
      if (Array.isArray(rec?.tracks)) {
        rec.tracks.forEach(tr => {
          const nt = norm(tr);
          if (k2 && nt) pairSet.add(`${k2}|${nt}`);
        });
      }
    });

    (profile.trackPairs || []).forEach(pair => {
      const sep = String(pair || '').indexOf('|');
      if (sep <= 0) return;
      const na = normArtistKey(pair.slice(0, sep));
      const nt = norm(pair.slice(sep + 1));
      if (na && nt) pairSet.add(`${na}|${nt}`);
    });

    if (profile.trackSources && typeof profile.trackSources === 'object') {
      Object.entries(profile.trackSources).forEach(([pair, src]) => {
        const sep = String(pair || '').indexOf('|');
        if (sep <= 0 || !src) return;
        const na = normArtistKey(pair.slice(0, sep));
        const nt = norm(pair.slice(sep + 1));
        if (na && nt) {
          pairSet.add(`${na}|${nt}`);
          trackSourceByPair.set(`${na}|${nt}`, src);
        }
      });
    }

    const lookup = { artistByKey, pairSet, trackSourceByPair, hasProvenance };
    spLookupCache.set(profile, lookup);
    return lookup;
  }

  function checkLocalSpotify(item) {
    const empty = {
      hasProvenance: false,
      artistHit: false,
      matchedArtists: [],
      matchedTracks: [],
      likedTrackMatches: [],
      playlistOnlyTrackMatches: [],
      likedArtistDetails: [],
      playlistOnlyArtistDetails: [],
      details: ''
    };
    const lookup = getSpotifyLookup(spotifyProfile);
    if (!lookup) return empty;

    const { artistByKey, pairSet, trackSourceByPair, hasProvenance } = lookup;
    const matchedArtists = [];
    const likedArtistDetails = [];
    const playlistOnlyArtistDetails = [];
    const seenArt = new Set();

    const checkStr = (str) => {
      if (!str || /^various(\s+artists)?$/i.test(str.trim())) return;
      String(str).split(/,|&|\band\b|feat\.?/i).forEach(part => {
        const key = normArtistKey(part);
        const rec = key && (artistByKey.get(key) || artistByKey.get(norm(part)));
        if (rec && !seenArt.has(key)) {
          seenArt.add(key);
          const displayName = rec.name || part.trim();
          const trCount = Array.isArray(rec.tracks) ? rec.tracks.length : (rec.count || 0);
          const pls = Array.isArray(rec.playlists) && rec.playlists.length ? rec.playlists.slice(0, 3) : [];
          const plsTag = pls.length ? ` [in: ${pls.join(', ')}]` : '';
          matchedArtists.push(`${displayName} (${trCount} songs${plsTag})`);

          if (hasProvenance) {
            const likedCnt = Array.isArray(rec.likedTracks) ? rec.likedTracks.length : 0;
            const topCnt = Array.isArray(rec.topTracks) ? rec.topTracks.length : 0;
            const albCnt = Array.isArray(rec.albumTracks) ? rec.albumTracks.length : 0;
            const isCore = Boolean(rec.isTopArtist || likedCnt > 0 || topCnt > 0 || albCnt > 0);
            if (isCore) {
              const tags = [];
              if (rec.isTopArtist) tags.push('Top Artist');
              if (likedCnt > 0) tags.push(`${likedCnt} liked`);
              if (albCnt > 0) tags.push(`${albCnt} saved-album`);
              likedArtistDetails.push(`${displayName} (${tags.join(', ') || `${trCount} tracks`})`);
            } else {
              playlistOnlyArtistDetails.push(`${displayName} (0 liked; playlists: ${pls.join(', ') || 'playlist only'})`);
            }
          }
        }
      });
    };

    checkStr(item.artist);
    (item.tracklist || []).forEach(t => {
      if (t.artist) checkStr(t.artist);
      else if (t.title && /\s+[-–—]\s+/.test(t.title)) {
        const splitArt = t.title.split(/\s+[-–—]\s+/)[0];
        if (splitArt) checkStr(splitArt);
      }
    });

    // Strict artist-bound track matching: BOTH artist (leading "the " stripped) AND title MUST match
    const matchedTracks = [];
    const likedTrackMatches = [];
    const playlistOnlyTrackMatches = [];
    const seenTrackKey = new Set();
    const isItemVarious = !item.artist || /^various(\s+artists)?$/i.test(String(item.artist).trim());

    (item.tracklist || []).forEach(t => {
      const rawTitle = String(t.title || '').trim();
      if (!rawTitle) return;

      const candidates = [];
      const primaryArtStr = t.artist || (isItemVarious ? '' : item.artist) || '';
      if (primaryArtStr) candidates.push({ artStr: primaryArtStr, titleStr: rawTitle });

      // Support compilation track titles formatted as "Artist - Title"
      const dashParts = rawTitle.split(/\s+[-–—]\s+/);
      if (dashParts.length >= 2) {
        candidates.push({ artStr: dashParts[0].trim(), titleStr: dashParts.slice(1).join(' - ').trim() });
      }

      let matchedPairKey = '';
      for (const c of candidates) {
        const nt = norm(c.titleStr);
        if (!nt) continue;
        const artParts = String(c.artStr)
          .split(/,|&|\band\b|feat\.?/i)
          .map(normArtistKey)
          .filter(Boolean);
        const hitArt = artParts.find(na => pairSet.has(`${na}|${nt}`));
        if (hitArt) {
          matchedPairKey = `${hitArt}|${nt}`;
          break;
        }
      }

      if (matchedPairKey) {
        const label = t.artist ? `${t.artist} - ${t.title}` : t.title;
        const dedup = norm(label);
        if (!seenTrackKey.has(dedup)) {
          seenTrackKey.add(dedup);
          matchedTracks.push(label);

          if (hasProvenance) {
            const src = trackSourceByPair.get(matchedPairKey);
            if (src && (src.liked || src.top || src.album)) {
              const tag = src.top ? 'Top Track' : (src.liked ? 'Liked' : 'Saved Album');
              likedTrackMatches.push(`${label} (${tag})`);
            } else {
              const pls = Array.isArray(src?.playlists) && src.playlists.length ? src.playlists.slice(0, 2).join(', ') : 'Playlist';
              playlistOnlyTrackMatches.push(`${label} [${pls}]`);
            }
          }
        }
      }
    });

    return {
      hasProvenance,
      artistHit: matchedArtists.length > 0,
      matchedArtists,
      matchedTracks,
      likedTrackMatches,
      playlistOnlyTrackMatches,
      likedArtistDetails,
      playlistOnlyArtistDetails,
      details: matchedArtists.join('; ') || 'None'
    };
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
    loadHighlightClip(t.artist || currentInspected.artist, t.title, currentInspected.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true, targetYear: currentInspected.year });
  };
  window.previewLitmusTrack = () => {
    if (!currentInspected?.litmus_track) return;
    loadHighlightClip(resolveLitmusArtist(currentInspected), currentInspected.litmus_track, currentInspected.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true, targetYear: currentInspected.year });
  };
  window.previewScanNotable = (idx) => {
    const s = normalizeNotableList(currentInspected?.notable_songs, currentInspected?.artist)[idx];
    if (!s?.title) return;
    loadHighlightClip(s.artist || currentInspected.artist, s.title, currentInspected.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true, targetYear: currentInspected.year });
  };
  window.previewStashTrack = (idx) => {
    const t = activeStashItem?.tracklist?.[idx];
    if (!t?.title) return;
    loadHighlightClip(t.artist || activeStashItem.artist, t.title, activeStashItem.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true, ignoreRunId: true, targetYear: activeStashItem.year });
  };
  window.previewStashLitmus = () => {
    if (!activeStashItem?.litmus_track) return;
    loadHighlightClip(resolveLitmusArtist(activeStashItem), activeStashItem.litmus_track, activeStashItem.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true, ignoreRunId: true, targetYear: activeStashItem.year });
  };
  window.previewStashNotable = (idx) => {
    const s = normalizeNotableList(activeStashItem?.notable_songs, activeStashItem?.artist)[idx];
    if (!s?.title) return;
    loadHighlightClip(s.artist || activeStashItem.artist, s.title, activeStashItem.title, scanRunId, { forceReplace: true, forcePlay: true, strictTrack: true, notifyUser: true, ignoreRunId: true, targetYear: activeStashItem.year });
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
    item.taste_scored_at = Date.now();

    document.getElementById('tasteScore').innerHTML = `${esc(res.score)}/10 <span class="badge ${verdictBadgeClass(res.verdict)}" style="vertical-align:middle;">${esc(res.verdict)}</span>`;
    document.getElementById('tasteBody').textContent = res.summary || '';

    const cBox = document.getElementById('contextBox');
    if (item.context_note) {
      cBox.classList.remove('hidden');
      cBox.innerHTML = `<strong>📖 Context:</strong> ${esc(item.context_note)}`;
    } else cBox.classList.add('hidden');

    document.getElementById('tasteHits').innerHTML = buildNotableHitsHtml(item, 'scan');
    syncTrackPlayButtons();

    const previewArtist = resolveLitmusArtist(item);
    if (item.litmus_track) {
      loadHighlightClip(previewArtist, item.litmus_track, item.title, myRunId, { forceReplace: true, forcePlay: cfg.autoPlayHighlight, strictTrack: true, notifyUser: false, targetYear: item.year });
    } else if (item.title) {
      loadHighlightClip(previewArtist, '', item.title, myRunId, { forceReplace: true, forcePlay: cfg.autoPlayHighlight, strictTrack: false, notifyUser: false, targetYear: item.year });
    }
  }

  window.gradeCurrentPhotosOnDemand = async () => {
    if (!currentInspected) return;
    if (!stagedPhotos.length) { toast('Stage photos first to AI grade'); return; }
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); return; }

    const btn = document.getElementById('btnAiGradeNow');
    const targetItem = currentInspected;
    const myRun = scanRunId;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Grading photos...';
    }
    setStatus(`✨ AI grading ${stagedPhotos.length} photo(s) on ${aiEngineLabel()}...`, true, { cancellable: true });

    const prompt = `You are a strict, conservative Discogs/Goldmine visual grading expert. Inspect ALL attached photos closely for every physical flaw on the media and case/sleeve/insert.

Item: "${targetItem.artist} - ${targetItem.title}" (${targetItem.format || 'Cassette'})

PHOTO-SCOPE & LOOSE-MEDIA AWARENESS:
- If ONLY the bare cassette shell or bare disc is shown (no case, no J-card, no cover insert), set "sleeve_condition": "No Cover" and note loose media in "condition_note".

STRICT DISCOGS SELLER GRADING RULES (Be brutally honest and conservative — never over-grade!):
1. List every flaw first in "media_defects" and "sleeve_defects" (including spine cut-out markings: hole punches, saw cuts, notched corners, or promo stamps).
2. Media Condition MUST be one of: ${JSON.stringify(MEDIA_GRADES.filter(g => g !== 'Not Graded'))}
   * "Mint (M)" ONLY if factory sealed. "Near Mint (NM or M-)" = spotless, zero visible wear.
   * "Very Good Plus (VG+)" = very clean, only tiny handling scuffs, crisp flat label.
   * "Very Good (VG)" = visible scuffs/scratches, light label wear or fading.
   * "Good Plus (G+)" = heavy scratches/scuffing, peeling/warped/bubbling/stained label, writing/yellowing.
   * "Good (G)" / "Fair (F)" / "Poor (P)" = cracked shell, missing felt pad, torn label, deep gouges.
3. Sleeve Condition MUST be one of: ${JSON.stringify(SLEEVE_GRADES)}
   * No case/cover shown = "No Cover". Plain blank = "Generic".
   * "Very Good Plus (VG+)" = clean insert, minimal edge wear, no case cracks.
   * "Very Good (VG)" = creases, sticker residue, cut-out saw cut/notch, moderate case scuffs or small crack.
   * "Good Plus (G+)" = paint/ink/water stains, heavy creases, ripped flap, heavily scratched/cracked case.
   * "Good (G)" / "Fair (F)" / "Poor (P)" = severe stains obscuring art, torn/missing pieces, heavy water damage.
4. When between two grades, ALWAYS pick the LOWER grade. NEVER say "mint" in "condition_note" unless factory sealed.

Return ONLY valid JSON:
{
  "media_defects": ["list every flaw on cassette/disc, or empty array if spotless"],
  "sleeve_defects": ["list every flaw on case/insert/spine including cut-out holes/saw cuts, or empty array if spotless or no cover"],
  "media_condition": "exact Discogs media grade from list",
  "sleeve_condition": "exact Discogs sleeve grade from list",
  "condition_note": "blunt, factual, buyer-ready Discogs seller note listing visible flaws (1-3 short sentences, NEVER say 'mint' unless sealed)"
}`;

    const parts = [{ text: prompt }, ...stagedPhotos.map(p => ({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }))];
    try {
      const res = await CC.callAI(parts, 'MEDIUM', { retryLabel: 'AI Visual Grade' });
      if (myRun !== scanRunId || currentInspected !== targetItem) return;

      const newMedia = normalizeGrade(res.media_condition, MEDIA_GRADES, 'Not Graded');
      const newSleeve = normalizeGrade(res.sleeve_condition, SLEEVE_GRADES, 'Not Graded');
      const newNote = String(res.condition_note || '').trim();

      document.getElementById('gMediaCond').value = newMedia;
      document.getElementById('gSleeveCond').value = newSleeve;
      document.getElementById('gNotes').value = newNote;

      targetItem.media_condition = newMedia;
      targetItem.sleeve_condition = newSleeve;
      targetItem.condition_note = newNote;
      if (!currentExtracted) currentExtracted = {};
      currentExtracted.media_condition = newMedia;
      currentExtracted.sleeve_condition = newSleeve;
      currentExtracted.condition_note = newNote;
      currentExtracted.graded_by_ai = true;

      const hintEl = document.getElementById('aiGradeHint');
      if (hintEl) {
        hintEl.textContent = `✅ AI Graded (${stagedPhotos.length} photo${stagedPhotos.length > 1 ? 's' : ''})`;
        hintEl.className = 'badge badge-purple';
      }
      setStatus('', false);
      toast(`✨ AI Graded: ${shortGrade(newMedia)} / ${shortGrade(newSleeve)}`, 3400);
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast('AI Grade error: ' + err.message, 4500);
    } finally {
      if (btn && myRun === scanRunId && currentInspected === targetItem) {
        const gradedNow = Boolean(currentExtracted?.graded_by_ai);
        btn.disabled = false;
        btn.className = gradedNow ? 'btn btn-secondary' : 'btn btn-green';
        btn.textContent = gradedNow ? '✨ Re-Run AI Visual Grade' : '✨ AI Grade Photos';
      }
    }
  };

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

    const cacheKey = `${norm(item.artist)}|${norm(item.title)}|v203`;
    if (tasteCache.has(cacheKey)) { applyTasteUI(item, tasteCache.get(cacheKey), myRunId); return; }

    const tracksStr = (item.tracklist || []).map(t => t.artist ? `${t.artist} - ${t.title}` : t.title).join('; ');
    const dna = spotifyProfile?.tasteDna || '';
    const softSpots = spotifyProfile?.softSpots || '';
    const sm = item.spotify_matches || {};
    const spEvidenceBlock = sm.hasProvenance
      ? `- HIGH-WEIGHT Liked / Top / Saved-Album Artists: ${(sm.likedArtistDetails || []).join('; ') || 'None'}
- HIGH-WEIGHT Liked / Top / Saved-Album Songs: ${(sm.likedTrackMatches || []).join(', ') || 'None'}
- CASUAL Playlist-Only Artists (0 Liked Songs): ${(sm.playlistOnlyArtistDetails || []).join('; ') || 'None'}
- CASUAL Playlist-Only Songs (0 Liked Songs): ${(sm.playlistOnlyTrackMatches || []).join(', ') || 'None'}`
      : `- Matching Artists in Library: ${sm.details || 'None'}
- Exact / Matching Songs Already in Library: ${(sm.matchedTracks || []).join(', ') || 'None'}`;

    const prompt = `Evaluate this physical music release strictly against the user's musical taste profile and provide brief musical/pop-culture context. Speak directly to "you".

Release: "${item.artist} - ${item.title}" (${item.year || '?'}, ${item.format}, Genres: ${(item.genres || []).join(', ') || 'unknown'}).
Full Tracklist: ${tracksStr || 'Unknown'}.
Exact Local Matches Across ALL ${spotifyProfile?.totalTracks || 0} Spotify Tracks / ${spotifyProfile?.totalArtists || 0} Artists:
${spEvidenceBlock}

User's Taste Profile:
${dna || 'No written Taste Profile yet.'}

User's Explicit Soft Spots & Niche Pockets (FIRST-CLASS WEIGHT — treat these with EQUAL importance to Core Obsessions so smaller 5–15 song favorite pockets are NEVER averaged out of a large library):
${softSpots || 'None specified yet.'}

HARD RULES:
1. PROVENANCE WEIGHTING (LIKED SONGS > SAVED ALBUMS > PLAYLIST-ONLY):
   - Liked Songs, Top Tracks, Top Artists, and Saved Albums are STRONG personal favorites — boost the score and NEVER dismiss them as outside the user's taste!
   - Playlist-Only matches (0 Liked Songs / 0 Top / 0 Saved Albums) indicate CASUAL familiarity, NOT a core obsession. State this honestly in "summary" (e.g., "You haven't Liked any Joe Walsh songs, though you have a track in your 'Classic Rock' playlist...") and judge the album fairly against the Taste Profile instead of inflating it to an automatic 9–10.
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
      await CC.commitLocalMutation({
        metaPuts: [{ key: 'spotify_profile', value: spotifyProfile }],
        extraOps: [{ type: 'taste_profile', tasteDna: finalDna, softSpots: userSoftSpots, dnaUpdatedAt: spotifyProfile.dnaUpdatedAt }],
        queueOutbox: true
      });
      tasteCache.clear();
      document.getElementById('cfgTasteDna').value = finalDna;
      updateSpotifyUI();
      setStatus('', false);
      updateCloudUI();
      scheduleGoogleAutoSync();
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
    await CC.commitLocalMutation({
      metaPuts: [{ key: 'spotify_profile', value: spotifyProfile }],
      extraOps: [{ type: 'taste_profile', tasteDna: spotifyProfile.tasteDna, softSpots: spotifyProfile.softSpots, dnaUpdatedAt: spotifyProfile.dnaUpdatedAt }],
      queueOutbox: true
    });
    tasteCache.clear();
    updateSpotifyUI();
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (!silent) toast('Taste Profile & Soft Spots saved!');
  };

  // ==================== PILE / SHELF ZOOM-PAN CONTROLLER (2-FINGER PINCH + PAN) ====================
  function createZoomPanController(viewportEl, contentEl, labelEl) {
    const state = { scale: 1, tx: 0, ty: 0 };
    const pointers = new Map();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let pinchStartRelX = 0;
    let pinchStartRelY = 0;
    let pinchOriginTx = 0;
    let pinchOriginTy = 0;
    let panStartX = 0;
    let panStartY = 0;
    let panOriginTx = 0;
    let panOriginTy = 0;
    let dragged = false;
    let hadMultiTouch = false;
    let pinDownIdx = null;

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
      contentEl.style.setProperty('--zoom-scale', state.scale.toFixed(3));
      contentEl.style.setProperty('--pin-damp', Math.pow(state.scale, 0.72).toFixed(3));
      if (labelEl) labelEl.textContent = `${Math.round(state.scale * 100)}%`;
    }

    function dist(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function getMidRelToViewportCenter(a, b) {
      const rect = viewportEl.getBoundingClientRect();
      const vcx = rect.left + rect.width / 2;
      const vcy = rect.top + rect.height / 2;
      return {
        rx: (a.x + b.x) / 2 - vcx,
        ry: (a.y + b.y) / 2 - vcy
      };
    }

    function beginPinchBaseline() {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) return;
      pinchStartDist = Math.max(1, dist(pts[0], pts[1]));
      pinchStartScale = state.scale;
      const mid = getMidRelToViewportCenter(pts[0], pts[1]);
      pinchStartRelX = mid.rx;
      pinchStartRelY = mid.ry;
      pinchOriginTx = state.tx;
      pinchOriginTy = state.ty;
    }

    viewportEl.addEventListener('pointerdown', (e) => {
      try { viewportEl.setPointerCapture(e.pointerId); } catch (_) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 1) {
        dragged = false;
        hadMultiTouch = false;
        const pinBtn = e.target.closest?.('.pile-pin');
        const rawIdx = pinBtn?.dataset?.pileIdx;
        pinDownIdx = rawIdx !== undefined && rawIdx !== '' ? Number(rawIdx) : null;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panOriginTx = state.tx;
        panOriginTy = state.ty;
      } else if (pointers.size >= 2) {
        hadMultiTouch = true;
        dragged = true;
        pinDownIdx = null;
        beginPinchBaseline();
      }
    });

    viewportEl.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2) {
        hadMultiTouch = true;
        dragged = true;
        const pts = Array.from(pointers.values());
        const d = dist(pts[0], pts[1]);
        const nextScale = Math.max(1, Math.min(6, pinchStartScale * (d / pinchStartDist)));
        const scaleRatio = nextScale / Math.max(0.01, pinchStartScale);
        const curMid = getMidRelToViewportCenter(pts[0], pts[1]);

        state.scale = nextScale;
        state.tx = curMid.rx - scaleRatio * (pinchStartRelX - pinchOriginTx);
        state.ty = curMid.ry - scaleRatio * (pinchStartRelY - pinchOriginTy);
        clampAndApply();
      } else if (pointers.size === 1) {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        if (Math.hypot(dx, dy) >= 8) dragged = true;
        if (state.scale > 1.01) {
          state.tx = panOriginTx + dx;
          state.ty = panOriginTy + dy;
          clampAndApply();
        }
      }
    });

    const releasePtr = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size >= 2) {
        beginPinchBaseline();
      } else if (pointers.size === 1) {
        const rem = Array.from(pointers.values())[0];
        panStartX = rem.x;
        panStartY = rem.y;
        panOriginTx = state.tx;
        panOriginTy = state.ty;
      } else if (pointers.size === 0) {
        pinDownIdx = null;
        hadMultiTouch = false;
      }
    };

    viewportEl.addEventListener('pointerup', (e) => {
      const wasCleanSingleTap = pointers.size === 1 && !hadMultiTouch && !dragged;
      const tappedPinIdx = pinDownIdx;
      releasePtr(e);
      if (wasCleanSingleTap) {
        if (tappedPinIdx !== null && Number.isFinite(tappedPinIdx)) {
          selectPileItem(tappedPinIdx, true);
        } else if (activePileIdx !== null) {
          clearPileHighlight();
        }
      }
    });
    viewportEl.addEventListener('pointercancel', releasePtr);

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

  function renderPileShotSwitchers() {
    const bars = [
      document.getElementById('pileShotSwitcher'),
      document.getElementById('pileFsShotSwitcher')
    ];
    const addBtn = document.getElementById('btnAddPileShot');
    if (addBtn) addBtn.classList.toggle('hidden', pilePhotos.length >= 4);

    if (pilePhotos.length <= 1) {
      bars.forEach(b => { if (b) { b.classList.add('hidden'); b.innerHTML = ''; } });
      return;
    }

    const html = pilePhotos.map((_, i) => {
      const cnt = pileResults.filter(r => (r.photoIdx ?? 0) === i).length;
      const suffix = pileResults.length ? ` (${cnt})` : '';
      return `<button type="button" class="pile-shot-pill ${i === activePilePhotoIdx ? 'active' : ''}" onclick="selectPilePhoto(${i})">📷 Shot ${i + 1}${suffix}</button>`;
    }).join('');
    bars.forEach(b => {
      if (!b) return;
      b.innerHTML = html;
      b.classList.remove('hidden');
    });
  }

  window.selectPilePhoto = (idx) => {
    if (!pilePhotos.length) return;
    const clamped = Math.max(0, Math.min(pilePhotos.length - 1, Number(idx) || 0));
    if (clamped === activePilePhotoIdx && document.getElementById('pilePreviewImg').src) {
      renderPileShotSwitchers();
      return;
    }
    activePilePhotoIdx = clamped;
    const src = pilePhotos[activePilePhotoIdx]?.saveWebp || '';
    document.getElementById('pilePreviewImg').src = src;
    document.getElementById('pileFsImg').src = src;
    if (pileZoomInline) pileZoomInline.reset();
    if (pileZoomFs) pileZoomFs.reset();
    renderPileUI();
  };

  function applyLoadedPilePhotos(photosArr, autoAnalyze = true) {
    pileRunId++;
    pileBatchPriceRunning = false;
    pilePhotos = Array.isArray(photosArr) ? photosArr.slice(0, 4) : [];
    activePilePhotoIdx = 0;
    pileResults = [];
    activePileIdx = null;

    if (!pilePhotos.length) {
      document.getElementById('pilePreviewWrap').classList.add('hidden');
      document.getElementById('pileResultsCard').classList.add('hidden');
      return;
    }

    document.getElementById('pilePreviewImg').src = pilePhotos[0].saveWebp;
    document.getElementById('pileFsImg').src = pilePhotos[0].saveWebp;
    document.getElementById('pileSvg').innerHTML = '';
    document.getElementById('pilePins').innerHTML = '';
    document.getElementById('pileFsSvg').innerHTML = '';
    document.getElementById('pileFsPins').innerHTML = '';
    document.getElementById('pileHighlightBar').classList.add('hidden');
    document.getElementById('pileFsHighlightBar').classList.add('hidden');
    document.getElementById('pilePhotoHint').textContent = 'Pinch + drag with 2 fingers to zoom & pan · Tap pins to spotlight';
    document.getElementById('pilePreviewWrap').classList.remove('hidden');
    document.getElementById('pileResultsCard').classList.add('hidden');
    renderPileShotSwitchers();
    if (pileZoomInline) pileZoomInline.reset();
    if (pileZoomFs) pileZoomFs.reset();

    if (autoAnalyze) runPileScan();
  }

  async function handlePilePhotos(fileList, appendMode = false) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const baseList = appendMode ? pilePhotos.slice() : [];
    const remainingSlots = Math.max(0, 4 - baseList.length);
    if (!remainingSlots) {
      toast('Max 4 pile photos reached — clear or analyze current shots');
      return;
    }
    const toDecode = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) toast(`Using first ${remainingSlots} photo(s) (max 4 per pile scan)`);

    setStatus(`Decoding ${toDecode.length} high-res pile photo(s) (3072px AI / 2048px zoom)...`, true);
    try {
      const decoded = [];
      for (const file of toDecode) {
        const pair = await decodeBlobToPhotoPair(file, { aiMaxDim: 3072, aiQuality: 0.92, saveMaxDim: 2048, saveQuality: 0.82 });
        decoded.push(pair);
      }
      setStatus('', false);
      applyLoadedPilePhotos([...baseList, ...decoded], true);
    } catch (err) {
      setStatus('', false);
      toast('Photo error: ' + (err?.message || 'Could not decode image'), 5500);
    }
  }

  window.openPileFullscreen = () => {
    const activeShot = pilePhotos[activePilePhotoIdx] || pilePhotos[0];
    if (!activeShot?.saveWebp) return;
    document.getElementById('pileFsImg').src = activeShot.saveWebp;
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
    pilePhotos = [];
    activePilePhotoIdx = 0;
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
    renderPileShotSwitchers();
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
    fetchPileItemPrice(r, pileRunId);
  };

  async function fetchPileItemPrice(r, myPileRunId) {
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

    // Snapshot targets so mid-sweep Taste re-sorting never skips or misassigns any tape
    const targets = pileResults.slice();
    for (const r of targets) {
      if (!pileBatchPriceRunning || myPileRunId !== pileRunId) break;
      if (r.priceStatus === 'idle' || r.priceStatus === 'error') {
        await fetchPileItemPrice(r, myPileRunId);
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

    if (activePileIdx !== null) {
      const sel = pileResults[activePileIdx];
      const itemPhotoIdx = sel.photoIdx ?? 0;
      if (itemPhotoIdx !== activePilePhotoIdx && pilePhotos[itemPhotoIdx]) {
        activePilePhotoIdx = itemPhotoIdx;
        const src = pilePhotos[activePilePhotoIdx].saveWebp;
        document.getElementById('pilePreviewImg').src = src;
        document.getElementById('pileFsImg').src = src;
        if (pileZoomInline) pileZoomInline.reset();
        if (pileZoomFs) pileZoomFs.reset();
      }
      renderPileUI();

      if (cfg.discogsToken && (sel.priceStatus === 'idle' || sel.priceStatus === 'error')) {
        fetchPileItemPrice(sel, pileRunId);
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
    } else {
      renderPileUI();
    }
  };

  function checkPileOwnedMatch(artist, title) {
    const na = norm(artist);
    const nt = norm(title);
    if (!na || !nt) return '';
    const key = `${na}|${nt}`;
    const inDiscogs = Boolean(discogsCollectionIndex?.albumKeys?.[key]?.length);
    const inStash = stashCache.some(s => norm(s.artist) === na && norm(s.title) === nt);
    if (inDiscogs && inStash) return 'Discogs + Stash';
    if (inDiscogs) return 'Discogs';
    if (inStash) return 'Stash';
    return '';
  }

  function updatePileRetryTasteBtn() {
    const btn = document.getElementById('btnPileRetryTaste');
    if (!btn) return;
    const hasErr = pileResults.some(r => r.tasteStatus === 'error');
    btn.classList.toggle('hidden', !hasErr);
  }

  function renderPileOverlayInto(svgEl, pinsEl, maskId) {
    if (!svgEl || !pinsEl) return;
    const sel = (activePileIdx !== null && pileResults[activePileIdx]) ? pileResults[activePileIdx] : null;
    const selOnActiveShot = Boolean(sel && (sel.photoIdx ?? 0) === activePilePhotoIdx);
    const hasFocus = Boolean(selOnActiveShot && (sel.poly || sel.point));

    if (hasFocus) {
      const strokeColor = sel.highVal ? '#fbbf24' : '#22c55e';
      let cutout = '';
      let outline = '';
      if (sel.poly && sel.poly.length >= 4) {
        const ptsAttr = sel.poly.map(([y, x]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        cutout = `<polygon points="${ptsAttr}" fill="black" />`;
        outline = `<polygon class="pile-spotlight-stroke" vector-effect="non-scaling-stroke" points="${ptsAttr}" fill="none" stroke="${strokeColor}" stroke-linejoin="round" />`;
      } else if (sel.point) {
        const [py, px] = sel.point;
        cutout = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="48" fill="black" />`;
        outline = `<circle class="pile-spotlight-stroke" vector-effect="non-scaling-stroke" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="48" fill="none" stroke="${strokeColor}" />`;
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
      if ((r.photoIdx ?? 0) !== activePilePhotoIdx || !r.point) return '';
      const [py, px] = r.point;
      const cls = [
        'pile-pin',
        r.highVal ? 'hot' : (r.taste_score !== null && r.taste_score >= 7 ? 'good' : (r.ownedMatch ? 'owned' : '')),
        activePileIdx === i ? 'active' : ''
      ].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-pile-idx="${i}" style="left:${(px / 10).toFixed(2)}%; top:${(py / 10).toFixed(2)}%;" title="#${i + 1}: ${esc(r.artist || '')} - ${esc(r.title || '')}">${i + 1}</button>`;
    }).join('');
  }

  function buildHighlightBarHtml(r, idx) {
    const priceSummary = formatPilePriceSummary(r);
    const tasteSummary = r.tasteStatus === 'loading'
      ? '⏳ Scoring taste...'
      : r.tasteStatus === 'error'
        ? '⚠️ Taste unavailable'
        : `🎧 ${r.taste_score}/10`;
    return `
      <div>
        <div style="font-weight:800; font-size:0.9rem; color:#f1f5f9;">#${idx + 1}: ${esc(r.artist || '?')} — ${esc(r.title || '?')}</div>
        <div style="font-size:0.78rem; color:#cbd5e1; margin-top:2px;">
          ${tasteSummary}${r.ownedMatch ? ` · 📀 Owned (${esc(r.ownedMatch)})` : ''}${priceSummary ? ` · ${esc(priceSummary)}` : ''}${r.taste_reason ? ` · ${esc(r.taste_reason)}` : ''}${(!r.point && !r.poly) ? ' · (position not detected)' : ''}
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
    renderPileShotSwitchers();
    renderPileOverlayInto(document.getElementById('pileSvg'), document.getElementById('pilePins'), 'pileMaskInline');
    renderPileOverlayInto(document.getElementById('pileFsSvg'), document.getElementById('pileFsPins'), 'pileMaskFs');
    updatePileRetryTasteBtn();

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
      const tasteBadge = r.tasteStatus === 'loading'
        ? `<span class="badge" style="background:#0d1017; color:#fde68a;">⏳ Scoring...</span>`
        : r.tasteStatus === 'error'
          ? `<span class="badge badge-red">⚠️ Taste failed</span>`
          : `<span class="badge ${r.taste_score >= 7 ? 'badge-green' : r.taste_score >= 5 ? 'badge-blue' : 'badge-red'}">🎧 ${r.taste_score}/10</span>`;
      const ownedBadge = r.ownedMatch ? `<span class="badge badge-purple">📀 Owned</span>` : '';
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
              ${tasteBadge}
              ${ownedBadge}
              ${r.localArtistHit ? `<span class="badge badge-green">In Spotify</span>` : ''}
              ${askBadge}${vgBadge}${statusBadge}${histLink}
              ${(r.roughWant > r.roughHave && r.roughWant >= 15) ? `<span class="badge badge-purple">💎 High Want (${r.roughWant})</span>` : ''}
              ${pilePhotos.length > 1 ? `<span class="badge" style="background:#0d1017; color:#c4b5fd;">📷 #${(r.photoIdx ?? 0) + 1}</span>` : ''}
              ${(r.point || r.poly) ? `<span class="badge" style="background:#0d1017; color:#93c5fd;">📍 #${i + 1}</span>` : ''}
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" style="min-height:34px; padding:5px 9px; flex:0 0 auto;" onclick="jumpFromPileToSingle(${i}); event.stopPropagation();">Verify ›</button>
        </div>
      `;
    }).join('');
  }

  async function runPileTasteBatch(myPileRunId) {
    if (!pileResults.length || !CC.isAiReady()) return;

    pileResults.forEach(r => { r.tasteStatus = 'loading'; });
    renderPileUI();

    const dna = spotifyProfile?.tasteDna || 'No written Taste Profile yet.';
    const softSpots = spotifyProfile?.softSpots || 'None specified';

    const enrichedForPrompt = pileResults.map((x, i) => ({
      idx: i,
      artist: x.artist,
      title: x.title,
      format: x.format,
      artist_in_spotify_library: Boolean(x.localArtistHit),
      owned_in_collection: Boolean(x.ownedMatch)
    }));

    const tastePrompt = `Batch-score these ${pileResults.length} music releases for a collector based on their Taste Profile and explicit Soft Spots.

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

    try {
      const tasteBatch = await CC.callAI([{ text: tastePrompt }], null, { retryLabel: 'Pile Taste', maxOutputTokens: 8192 });
      if (myPileRunId !== pileRunId) return;

      const selectedObj = activePileIdx !== null ? pileResults[activePileIdx] : null;
      const scoreMap = new Map((tasteBatch.scores || []).map(s => [s.idx, s]));

      pileResults.forEach((r, i) => {
        const sc = scoreMap.get(i) || { score: 5, reason: '' };
        r.taste_score = sc.score;
        r.taste_reason = sc.reason;
        r.tasteStatus = 'done';
      });

      pileResults.sort((a, b) => ((b.taste_score || 0) - (a.taste_score || 0)) || (Number(b.localArtistHit) - Number(a.localArtistHit)));
      if (selectedObj) {
        const nextIdx = pileResults.indexOf(selectedObj);
        activePileIdx = nextIdx !== -1 ? nextIdx : null;
      }

      setStatus('', false);
      renderPileUI();
      updatePilePriceBtn();
    } catch (err) {
      if (myPileRunId !== pileRunId) return;
      setStatus('', false);
      pileResults.forEach(r => { if (r.tasteStatus === 'loading') r.tasteStatus = 'error'; });
      renderPileUI();
      if (err.name !== 'AbortError') toast('Taste scoring paused (' + err.message + ') — shelf pins & prices still ready!', 4500);
    }
  }

  window.retryPileTasteScoring = () => {
    if (!pileResults.length) return;
    runPileTasteBatch(pileRunId);
  };

  function pileGeomQualityScore(it, geom) {
    let q = 0;
    if (geom.poly && geom.poly.length >= 4) q += 40;
    if (geom.point) {
      const [py, px] = geom.point;
      const edgeClearance = Math.min(py, 1000 - py, px, 1000 - px);
      q += Math.min(100, edgeClearance / 3);
    }
    if (it.catno && String(it.catno).trim()) q += 20;
    q += Math.min(25, String(it.title || '').trim().length * 0.6 + String(it.artist || '').trim().length * 0.4);
    return q;
  }

  window.runPileScan = async () => {
    if (!pilePhotos.length) return;
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); switchView('settings'); return; }

    pileRunId++;
    const myPileRunId = pileRunId;
    pileBatchPriceRunning = false;

    document.getElementById('pileResultsCard').classList.add('hidden');
    activePileIdx = null;
    const fmtLabel = activeFormat === 'Auto' ? 'all formats' : `${activeFormat}s only`;
    const shotCount = pilePhotos.length;

    const formatRule = activeFormat === 'Auto'
      ? '- Extract legible Cassettes, CDs, and Vinyl — from BOTH spines AND visible front covers/faces.'
      : `- FORMAT FILTER ACTIVE: The user selected "${activeFormat}". ONLY extract ${activeFormat} items and strictly IGNORE all other formats in the photo. Read both spines AND visible front covers/faces of ${activeFormat} items.`;

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

    try {
      const deduped = [];
      const dedupMap = new Map();
      let totalUnreadable = 0;
      let mergedDupCount = 0;

      for (let pIdx = 0; pIdx < shotCount; pIdx++) {
        if (myPileRunId !== pileRunId) return;
        setStatus(
          shotCount > 1
            ? `📚 Scanning section ${pIdx + 1}/${shotCount} (${fmtLabel}, ultra-high detail)...`
            : `📚 Reading & locating ${fmtLabel} (ultra-high detail)...`,
          true,
          { cancellable: true }
        );

        const ocr = await CC.callAI(
          [{ text: ocrPrompt }, { inline_data: { mime_type: 'image/jpeg', data: pilePhotos[pIdx].apiB64 } }],
          'MEDIUM',
          {
            retryLabel: shotCount > 1 ? `Pile OCR (${pIdx + 1}/${shotCount})` : 'Pile OCR',
            maxOutputTokens: 16384,
            mediaResolution: 'MEDIA_RESOLUTION_ULTRA_HIGH'
          }
        );
        if (myPileRunId !== pileRunId) return;

        totalUnreadable += Number(ocr.unreadable_count || 0);
        let sectionItems = Array.isArray(ocr.items) ? ocr.items.filter(x => x.title || x.artist) : [];
        if (activeFormat !== 'Auto') {
          sectionItems = sectionItems.filter(x => !x.format || norm(x.format) === norm(activeFormat));
        }

        for (const it of sectionItems) {
          const geom = normalizePileGeometry(it);
          const qScore = pileGeomQualityScore(it, geom);
          const na = norm(it.artist || '');
          const nt = norm(it.title || '');
          const nf = norm(it.format || '');
          const dedupKey = (na && nt) ? `${na}|${nt}|${nf}` : '';
          const inCatNorm = norm(it.catno || '').replace(/\s+/g, '');

          let mergedIntoExisting = false;
          if (dedupKey && dedupMap.has(dedupKey)) {
            const bucket = dedupMap.get(dedupKey);
            for (const existing of bucket) {
              if (existing.photoIdx === pIdx) continue;
              const exCatNorm = norm(existing.catno || '').replace(/\s+/g, '');
              // NEVER merge two items if both have non-empty normalized catalog numbers that differ
              if (exCatNorm && inCatNorm && exCatNorm !== inCatNorm) continue;

              mergedDupCount++;
              const inCat = String(it.catno || '').trim();
              const exCat = String(existing.catno || '').trim();
              if (inCat.length > exCat.length) existing.catno = inCat;
              if (String(it.title || '').trim().length > String(existing.title || '').trim().length) existing.title = it.title;
              if (String(it.artist || '').trim().length > String(existing.artist || '').trim().length) existing.artist = it.artist;
              if (qScore > existing._qScore) {
                existing.photoIdx = pIdx;
                existing.point = geom.point;
                existing.poly = geom.poly;
                existing._qScore = qScore;
              }
              mergedIntoExisting = true;
              break;
            }
          }
          if (mergedIntoExisting) continue;

          const entry = {
            ...it,
            photoIdx: pIdx,
            point: geom.point,
            poly: geom.poly,
            _qScore: qScore
          };
          deduped.push(entry);
          if (dedupKey) {
            if (!dedupMap.has(dedupKey)) dedupMap.set(dedupKey, []);
            dedupMap.get(dedupKey).push(entry);
          }
        }
      }

      if (!deduped.length) {
        setStatus('', false);
        toast(`Could not read any legible ${activeFormat === 'Auto' ? 'items' : activeFormat + 's'} — try brighter light or zoom closer`, 4200);
        return;
      }

      // PROGRESSIVE RENDERING: Show all pins, owned badges & Pull List IMMEDIATELY after OCR!
      pileResults = deduped.map(it => {
        const localArtistHit = Boolean(spotifyProfile && it.artist && spotifyProfile.allArtists?.[norm(it.artist)]);
        const ownedMatch = checkPileOwnedMatch(it.artist, it.title);
        return {
          ...it,
          tasteStatus: 'loading',
          taste_score: null,
          taste_reason: '',
          localArtistHit,
          ownedMatch,
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

      activePilePhotoIdx = 0;
      document.getElementById('pilePreviewImg').src = pilePhotos[0].saveWebp;
      document.getElementById('pileFsImg').src = pilePhotos[0].saveWebp;
      setStatus('', false);
      document.getElementById('pileCount').textContent = pileResults.length;
      document.getElementById('pilePhotoHint').textContent = 'Pinch + drag with 2 fingers to zoom & pan · Tap any numbered pin to spotlight';

      const noteParts = [];
      if (mergedDupCount > 0) noteParts.push(`Merged ${mergedDupCount} overlapping item(s) across ${shotCount} shots.`);
      if (totalUnreadable > 0) noteParts.push(`Skipped ${totalUnreadable} blurry/unreadable item(s).`);
      noteParts.push('Tap any pin or card to spotlight & check rough Discogs pricing, or tap 💰 Check Prices.');
      document.getElementById('pileSkippedNote').textContent = noteParts.join(' ');

      renderPileUI();
      updatePilePriceBtn();
      document.getElementById('pileResultsCard').classList.remove('hidden');
      document.getElementById('pileResultsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Kick off Step 2 (Taste scoring) non-blockingly while pins & prices are already interactive
      runPileTasteBatch(myPileRunId);
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

  // ==================== DURABLE DISCOGS RECOVERY LEDGER & SAFE SWAPS ====================
  function loadPendingDiscogsLedger() {
    try { return JSON.parse(localStorage.getItem(PENDING_DISCOGS_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function savePendingDiscogsLedger(ledger) {
    try { localStorage.setItem(PENDING_DISCOGS_KEY, JSON.stringify(ledger || {})); } catch (_) {}
  }

  function getPendingDiscogsOp(key) {
    const ledger = loadPendingDiscogsLedger();
    return ledger[key] || null;
  }

  function setPendingDiscogsOp(key, op) {
    const ledger = loadPendingDiscogsLedger();
    ledger[key] = op;
    savePendingDiscogsLedger(ledger);
  }

  function clearPendingDiscogsOp(key) {
    const ledger = loadPendingDiscogsLedger();
    if (key in ledger) {
      delete ledger[key];
      savePendingDiscogsLedger(ledger);
    }
  }

  function findMatchingPendingDiscogsOp(keys, releaseId, opts = {}) {
    const { requireCreated = false } = opts;
    const targetId = Number(releaseId || 0);
    if (!targetId || !cfg.discogsUser) return null;
    const uniqueKeys = Array.from(new Set((keys || []).filter(Boolean)));
    for (const k of uniqueKeys) {
      const op = getPendingDiscogsOp(k);
      if (!op || Number(op.discogs_id) !== targetId || op.username !== cfg.discogsUser) continue;
      if (requireCreated && !(op.status === 'created' && op.instanceId)) continue;
      return { key: k, op };
    }
    return null;
  }

  async function ensureDiscogsInstanceDurable(ledgerKey, releaseId, defaultFolderId, fallbackKeys = []) {
    const searchKeys = Array.from(new Set([ledgerKey, ...(fallbackKeys || [])].filter(Boolean)));

    // Case 1: Already received instanceId in a prior attempt whose local IDB save failed
    const createdMatch = findMatchingPendingDiscogsOp(searchKeys, releaseId, { requireCreated: true });
    if (createdMatch?.op?.instanceId) {
      const existing = createdMatch.op;
      const fId = existing.folderId || defaultFolderId;
      if (createdMatch.key !== ledgerKey) {
        setPendingDiscogsOp(ledgerKey, { ...existing, folderId: fId });
      }
      return { instanceId: existing.instanceId, folderId: fId, reused: true };
    }

    // Case 2: Prior POST started but browser closed / network dropped before response arrived -> reconcile first!
    let postingMatch = null;
    for (const k of searchKeys) {
      const op = getPendingDiscogsOp(k);
      if (op && Number(op.discogs_id) === Number(releaseId) && op.username === cfg.discogsUser && op.status === 'posting') {
        postingMatch = { key: k, op };
        break;
      }
    }
    if (postingMatch) {
      const existing = postingMatch.op;
      setStatus(`Checking Discogs to avoid duplicate copy of #${releaseId}...`, true);
      const remoteNow = await CC.findDiscogsInstances(releaseId, { throwOnError: true });
      const prevIds = new Set((existing.preExistingInstanceIds || []).map(Number));
      const allNew = remoteNow.filter(r => !prevIds.has(Number(r.instance_id)));
      const expectedFolder = String(existing.folderId || defaultFolderId || '1');
      const newlyCreated = allNew.filter(r => String(r.folder_id || '1') === expectedFolder);
      const wrongFolderCreated = allNew.filter(r => String(r.folder_id || '1') !== expectedFolder);

      if (newlyCreated.length > 1) {
        const idsList = newlyCreated.map(r => `#${r.instance_id}`).join(', ');
        throw new Error(`Multiple new Discogs copies found for #${releaseId} in folder ${expectedFolder} (${idsList}) — please clean up duplicates on Discogs before syncing grades so the wrong copy isn't updated.`);
      }
      if (newlyCreated.length === 1 && newlyCreated[0]?.instance_id) {
        const created = newlyCreated[0];
        const fId = String(created.folder_id || expectedFolder);
        const updatedOp = { ...existing, status: 'created', instanceId: created.instance_id, folderId: fId };
        setPendingDiscogsOp(ledgerKey, updatedOp);
        if (postingMatch.key !== ledgerKey) setPendingDiscogsOp(postingMatch.key, updatedOp);
        return { instanceId: created.instance_id, folderId: fId, reused: true };
      }
      if (wrongFolderCreated.length > 0) {
        const desc = wrongFolderCreated.map(r => `#${r.instance_id} (folder ${r.folder_id ?? '?'})`).join(', ');
        throw new Error(`Found unseen Discogs copy for #${releaseId} in an unexpected folder (expected folder ${expectedFolder}): ${desc}. Please verify on Discogs before retrying.`);
      }
    }

    // Case 3: Fresh durable POST — snapshot existing instances & persist intent BEFORE calling POST
    const preRemote = await CC.findDiscogsInstances(releaseId, { throwOnError: true });
    const preExistingInstanceIds = preRemote.map(r => Number(r.instance_id)).filter(Boolean);
    const folderId = defaultFolderId || '1';
    const op = {
      discogs_id: Number(releaseId),
      folderId,
      username: cfg.discogsUser,
      status: 'posting',
      preExistingInstanceIds,
      instanceId: null,
      createdAt: Date.now()
    };
    setPendingDiscogsOp(ledgerKey, op);

    setStatus(`Adding verified pressing #${releaseId} to Discogs...`, true);
    const addRes = await CC.discogsFetch(
      `/users/${encodeURIComponent(cfg.discogsUser)}/collection/folders/${encodeURIComponent(folderId)}/releases/${releaseId}`,
      {},
      'POST'
    );
    const newInstanceId = addRes?.instance_id || null;
    if (!newInstanceId) {
      throw new Error('Discogs did not return a new instance_id — old copy kept untouched');
    }

    setPendingDiscogsOp(ledgerKey, { ...op, status: 'created', instanceId: newInstanceId });
    return { instanceId: newInstanceId, folderId, reused: false };
  }

  async function attemptDeleteOldCopy(record) {
    const oldInfo = record?.pending_delete_old;
    if (!oldInfo || !oldInfo.releaseId || !cfg.discogsUser) return { ok: true, warning: '' };

    try {
      let oldInst = oldInfo.instanceId || null;
      let oldFolder = oldInfo.folderId || '1';

      if (!oldInst) {
        // throwOnError: true so transient network/HTTP failures NEVER wipe pending_delete_old!
        const insts = await CC.findDiscogsInstances(oldInfo.releaseId, { throwOnError: true });
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

    const tiebreakChecked = Boolean(document.getElementById('chkConfirmTiebreak')?.checked);
    if (syncToDiscogs && currentInspected.is_conservative_tiebreak && !tiebreakChecked) {
      toast('Please check the confirmation box for this conservative tie-breaker pick first', 3800);
      return;
    }

    // Capture an immutable snapshot at tap-time so starting another scan mid-save
    // can NEVER cross-pair release IDs, instance IDs, photos, or wipe the new scan.
    const snap = {
      syncToDiscogs: Boolean(syncToDiscogs),
      inspected: JSON.parse(JSON.stringify(currentInspected)),
      editingItem: editingStashItem ? JSON.parse(JSON.stringify(editingStashItem)) : null,
      stagedWebps: stagedPhotos.map(p => p.saveWebp),
      mediaCond: document.getElementById('gMediaCond').value || 'Not Graded',
      sleeveCond: document.getElementById('gSleeveCond').value || 'Not Graded',
      condNote: document.getElementById('gNotes').value.trim(),
      tiebreakChecked,
      scanRunIdAtTap: scanRunId,
      defaultFolderId: cfg.discogsFolderId || '1'
    };
    snap.inspected.media_condition = snap.mediaCond;
    snap.inspected.sleeve_condition = snap.sleeveCond;
    snap.inspected.condition_note = snap.condNote;

    const isEditing = Boolean(snap.editingItem);
    const oldItem = snap.editingItem;
    const ledgerKey = isEditing && oldItem?.id ? `stash:${oldItem.id}` : `rel:${snap.inspected.discogs_id || 'local'}`;
    const relKey = snap.inspected.discogs_id ? `rel:${snap.inspected.discogs_id}` : '';
    const lockKeys = Array.from(new Set([ledgerKey, relKey].filter(Boolean)));

    if (lockKeys.some(k => activeDiscogsSaves.has(k))) return;

    if (snap.syncToDiscogs && (!cfg.discogsToken || !cfg.discogsUser || !snap.inspected.discogs_id)) {
      toast('Verify Discogs in Settings first');
      return;
    }

    lockKeys.forEach(k => activeDiscogsSaves.add(k));
    const saveBothBtn = document.getElementById('btnSaveBoth');
    const saveLocalBtn = document.getElementById('btnSaveLocal');
    if (saveBothBtn) saveBothBtn.disabled = true;
    if (saveLocalBtn) saveLocalBtn.disabled = true;

    try {
      const changedRelease = isEditing && Number(oldItem.discogs_id || 0) !== Number(snap.inspected.discogs_id || 0);
      const sameRelease = isEditing && oldItem.synced_to_discogs && Number(oldItem.discogs_id) === Number(snap.inspected.discogs_id);
      const swappedRelease = isEditing && oldItem.synced_to_discogs && oldItem.discogs_id && Number(oldItem.discogs_id) !== Number(snap.inspected.discogs_id);

      let synced = isEditing ? Boolean(oldItem.synced_to_discogs) : false;
      let folderId = isEditing ? (oldItem.discogs_folder_id || snap.defaultFolderId) : snap.defaultFolderId;
      let instanceId = isEditing ? (oldItem.discogs_instance_id || null) : null;
      let pendingDiscogsSync = isEditing ? Boolean(oldItem.pending_discogs_sync) : false;
      let pendingDeleteOld = isEditing ? (oldItem.pending_delete_old || null) : null;
      let pendingFieldSync = isEditing ? Boolean(oldItem.pending_field_sync) : false;
      let attachedFromLedger = false;

      let fieldRes = { okCount: 0, failedCount: 0, errors: [] };
      let sameReleaseSkippedRemote = false;
      let sameReleaseRemoteCopies = 0;

      const finalThumbs = snap.stagedWebps.length
        ? snap.stagedWebps
        : (isEditing ? (oldItem.thumbs || (oldItem.thumb_data_url ? [oldItem.thumb_data_url] : [])) : []);

      const buildRecord = () => {
        const cleanInspected = { ...snap.inspected };
        delete cleanInspected._pendingDiscogsAdd;
        const now = Date.now();
        const rawRec = {
          ...cleanInspected,
          sync_id: (isEditing && oldItem.sync_id) ? oldItem.sync_id : (snap.inspected.sync_id || CC.generateSyncId()),
          is_conservative_tiebreak: Boolean(snap.inspected.is_conservative_tiebreak),
          tiebreak_confirmed: Boolean(!snap.inspected.is_conservative_tiebreak || snap.tiebreakChecked),
          synced_to_discogs: synced,
          discogs_account: synced ? (cfg.discogsUser || oldItem?.discogs_account || '') : (oldItem?.discogs_account || ''),
          discogs_removed: synced ? false : Boolean(oldItem?.discogs_removed),
          discogs_removed_at: synced ? null : (oldItem?.discogs_removed_at || null),
          intended_discogs_folder_id: synced ? null : (oldItem?.intended_discogs_folder_id || snap.defaultFolderId || '1'),
          pending_discogs_sync: pendingDiscogsSync,
          pending_field_sync: pendingFieldSync,
          pending_delete_old: pendingDeleteOld,
          discogs_folder_id: synced ? String(folderId || '1') : null,
          discogs_folder_verified_at: synced ? now : (oldItem?.discogs_folder_verified_at || 0),
          discogs_instance_id: synced ? instanceId : null,
          thumbs: finalThumbs,
          thumb_data_url: finalThumbs[0] || snap.inspected.discogs_thumb || '',
          spine_thumb_url: snap.inspected.spine_thumb_url || (isEditing ? (oldItem.spine_thumb_url || '') : ''),
          spine_source_url: snap.inspected.spine_source_url || (isEditing ? (oldItem.spine_source_url || '') : ''),
          spine_flipped: Boolean(snap.inspected.spine_flipped ?? (isEditing ? oldItem.spine_flipped : false)),
          created_at: isEditing ? (oldItem.created_at || now) : now,
          updated_at: now
        };
        if (isEditing) rawRec.id = oldItem.id;
        return CC.stampStashRevision(rawRec, isEditing ? oldItem : null);
      };

      if (snap.syncToDiscogs) {
        try {
          if (sameRelease) {
            setStatus('Updating grades & notes on your existing Discogs item...', true);
            if (!instanceId) {
              const insts = await CC.findDiscogsInstances(oldItem.discogs_id, { throwOnError: true });
              if (insts.length === 1) {
                instanceId = insts[0].instance_id;
                folderId = String(insts[0].folder_id || folderId);
              } else {
                sameReleaseSkippedRemote = true;
                sameReleaseRemoteCopies = insts.length;
              }
            }
            if (instanceId) {
              fieldRes = await CC.syncDiscogsInstanceFields(folderId, snap.inspected.discogs_id, instanceId, snap.mediaCond, snap.sleeveCond, snap.condNote);
              pendingFieldSync = fieldRes.failedCount > 0;
            }
            synced = true;
            pendingDiscogsSync = false;
          } else {
            // 1. Durable Add-First with unified cross-path ledger + folder-safe reconciliation
            const added = await ensureDiscogsInstanceDurable(ledgerKey, snap.inspected.discogs_id, snap.defaultFolderId, relKey ? [relKey] : []);
            folderId = added.folderId;
            instanceId = added.instanceId;

            // 2. Sync Media/Sleeve/Notes fields on the new instance
            setStatus('Saving Media/Sleeve grade & notes to Discogs...', true);
            fieldRes = await CC.syncDiscogsInstanceFields(folderId, snap.inspected.discogs_id, instanceId, snap.mediaCond, snap.sleeveCond, snap.condNote);

            synced = true;
            pendingDiscogsSync = false;
            pendingFieldSync = fieldRes.failedCount > 0;

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
      } else {
        if (changedRelease) {
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
          pendingFieldSync = false;
        }

        // Cross-path recovery: if a prior Sync attempt already created a Discogs instance before IDB failed,
        // attach that instanceId now so a subsequent "Push to Discogs" never creates a duplicate copy.
        if (snap.inspected.discogs_id) {
          const priorCreated = findMatchingPendingDiscogsOp([ledgerKey, relKey], snap.inspected.discogs_id, { requireCreated: true });
          if (priorCreated?.op?.instanceId) {
            instanceId = priorCreated.op.instanceId;
            folderId = priorCreated.op.folderId || snap.defaultFolderId;
            synced = true;
            pendingDiscogsSync = false;
            pendingFieldSync = true;
            attachedFromLedger = true;
          }
        }
      }

      // 3. IMMEDIATELY persist updated Stash record + outbox entry atomically to IndexedDB BEFORE deleting any old Discogs copy
      const record = buildRecord();
      try {
        const commitRes = await CC.commitLocalMutation({ upsertStash: record, queueOutbox: true });
        if (!record.id && commitRes.assignedId) record.id = commitRes.assignedId;
        if (snap.syncToDiscogs || attachedFromLedger) {
          clearPendingDiscogsOp(ledgerKey);
          if (relKey && relKey !== ledgerKey) clearPendingDiscogsOp(relKey);
        }
      } catch (err) {
        setStatus('', false);
        toast('Local save failed — tap Save again to retry safely without duplicating on Discogs: ' + err.message, 5600);
        return;
      }

      // 4. Only delete old copy when ALL requested field writes succeeded (fieldRes.failedCount === 0)
      let oldDeleteWarning = '';
      if (snap.syncToDiscogs && record.pending_delete_old) {
        if (fieldRes.failedCount > 0) {
          oldDeleteWarning = `${fieldRes.failedCount} grade/note field(s) failed to sync (${fieldRes.errors[0] || ''}) — old copy #${record.pending_delete_old.releaseId} was kept safely on Discogs. Retry from Stash Detail.`;
        } else {
          setStatus(`Removing old pressing #${record.pending_delete_old.releaseId} from Discogs...`, true);
          const delRes = await attemptDeleteOldCopy(record);
          if (!delRes.ok) oldDeleteWarning = delRes.warning;
        }
      }

      await loadStashCache();
      setStatus('', false);
      updateCloudUI();
      scheduleGoogleAutoSync();

      if (oldDeleteWarning) {
        toast(`⚠️ ${oldDeleteWarning}`, 6000);
      } else if (sameReleaseSkippedRemote) {
        toast(`💾 Saved locally — found ${sameReleaseRemoteCopies} Discogs cop${sameReleaseRemoteCopies === 1 ? 'y' : 'ies'}, so remote grades were not overwritten.`, 5200);
      } else if (fieldRes.failedCount > 0) {
        toast(`⚠️ Saved to Discogs, but ${fieldRes.failedCount} field(s) failed: ${fieldRes.errors[0] || ''}`, 5200);
      } else if (attachedFromLedger) {
        toast('💾 Saved locally & linked existing Discogs copy (sync grades from Stash Detail).', 4800);
      } else if (isEditing) {
        toast(snap.syncToDiscogs
          ? '✅ Stash & Discogs updated cleanly!'
          : (pendingDiscogsSync ? '💾 Updated locally (marked Pending Discogs Sync)' : '💾 Stash updated!'));
      } else {
        toast(synced ? `✅ Saved to Discogs${fieldRes.okCount ? ' (with grades!)' : ''} & Stash!` : '💾 Saved to Local Stash!');
      }

      // Only clear editing state and reset the scanner if the user hasn't started a new scan mid-save
      if (scanRunId === snap.scanRunIdAtTap) {
        editingStashItem = null;
        document.getElementById('editModeBanner').classList.add('hidden');
        resetScanner();
      }
    } finally {
      lockKeys.forEach(k => activeDiscogsSaves.delete(k));
      if (currentInspected) {
        updateSaveButtonsState();
      } else {
        const bBoth = document.getElementById('btnSaveBoth');
        const bLocal = document.getElementById('btnSaveLocal');
        if (bBoth) bBoth.disabled = false;
        if (bLocal) bLocal.disabled = false;
      }
    }
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
    deepSearchCancelled = true;
    CC.cancelAI();
    stopHighlightAudio();
    setStatus('', false);
    pendingVoiceRetry = null;
    stagedPhotos = [];
    stagedSpineThumbUrl = '';
    stagedSpineSourceUrl = '';
    stagedSpineFlipped = false;
    stagedUpc = '';
    currentExtracted = null;
    currentCandidates = [];
    visibleCandidateIds = null;
    detectiveDiffs = {};
    detectivePickId = null;
    detectiveEliminatedIds = new Set();
    detectiveInspectedIds = new Set();
    detectiveInspectedCount = 0;
    priorBestVerdict = null;
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

  // ==================== LOCAL STASH LIST, TASTE RECALIBRATION & DETAIL VIEW ====================
  function getLatestTasteProfileTime() {
    return Math.max(Number(spotifyProfile?.dnaUpdatedAt || 0), Number(spotifyProfile?.syncedAt || 0));
  }

  function isStashTasteStale(it) {
    const latest = getLatestTasteProfileTime();
    if (!latest) return false;
    return !it.taste_scored_at || Number(it.taste_scored_at) < latest;
  }

  async function loadStashCache() {
    const raw = await CC.idbGetAll('stash');
    for (const it of raw) {
      if (!it.sync_id) {
        it.sync_id = CC.generateSyncId();
        await CC.idbPut('stash', it);
      }
    }
    stashCache = raw.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    document.getElementById('navStashLabel').textContent = `Stash (${stashCache.length})`;
    updateSettingsPills();
  }

  window.setStashViewMode = (mode) => {
    activeStashView = mode === 'spines' ? 'spines' : 'list';
    document.querySelectorAll('#stashViewToggle .sv-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sview === activeStashView);
    });
    renderStash();
  };

  function updateRecalibrateStashBtn() {
    const recalBtn = document.getElementById('btnRecalibrateStash');
    if (!recalBtn) return;
    if (recalibratingStash) {
      recalBtn.disabled = true;
      recalBtn.textContent = recalibrateProgressText || '⏳ Recalibrating...';
      return;
    }
    const staleCount = stashCache.filter(isStashTasteStale).length;
    recalBtn.disabled = false;
    recalBtn.textContent = staleCount > 0
      ? `🔄 Recalibrate Taste (${staleCount} updated)`
      : '🔄 Recalibrate Taste';
  }

  function getDiscogsFoldersList() {
    const raw = Array.isArray(cfg.discogsFolders) && cfg.discogsFolders.length
      ? cfg.discogsFolders
      : [{ id: 1, name: 'Uncategorized', count: 0 }];
    const out = raw.filter(f => Number(f.id) !== 0).map(f => ({
      id: Number(f.id),
      name: String(f.name || `Folder ${f.id}`),
      count: Number(f.count || 0)
    }));
    if (!out.some(f => f.id === 1)) out.unshift({ id: 1, name: 'Uncategorized', count: 0 });
    return out;
  }

  function getFolderNameById(folderId) {
    if (folderId === null || folderId === undefined || folderId === '') return 'Local Only';
    const found = getDiscogsFoldersList().find(f => String(f.id) === String(folderId));
    return found ? found.name : (String(folderId) === '1' ? 'Uncategorized' : `Folder ${folderId}`);
  }

  window.selectStashFolderFilter = (folderId) => {
    const next = (folderId === null || folderId === '' || String(activeDiscogsFolderFilter) === String(folderId))
      ? null
      : String(folderId);
    activeDiscogsFolderFilter = next;
    if (next !== null && activeStashFilter === 'localonly') {
      activeStashFilter = 'all';
      document.querySelectorAll('#stashFilters .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === 'all'));
    }
    renderStash();
  };

  function renderStashFolderChips() {
    const row = document.getElementById('stashFolderRow');
    if (!row) return;
    const folders = getDiscogsFoldersList();
    const hasLinkedOrFolders = Boolean(cfg.discogsUser || stashCache.some(it => it.synced_to_discogs) || folders.length > 1);
    if (!hasLinkedOrFolders) {
      row.classList.add('hidden');
      row.innerHTML = '';
      return;
    }

    const countsByFolder = {};
    let localOnlyCount = 0;
    stashCache.forEach(it => {
      if (it.synced_to_discogs && !it.discogs_removed) {
        const fid = String(it.discogs_folder_id || '1');
        countsByFolder[fid] = (countsByFolder[fid] || 0) + 1;
      } else {
        localOnlyCount++;
      }
    });

    row.classList.remove('hidden');
    const chips = folders.map(f => {
      const fid = String(f.id);
      const localCnt = countsByFolder[fid] || 0;
      const isActive = activeDiscogsFolderFilter === fid;
      return `<button type="button" class="chip ${isActive ? 'active' : ''}" onclick="selectStashFolderFilter('${esc(fid)}')">📁 ${esc(f.name)} (${localCnt})</button>`;
    });
    const localChipActive = activeStashFilter === 'localonly' && activeDiscogsFolderFilter === null;
    chips.push(`<button type="button" class="chip ${localChipActive ? 'active' : ''}" onclick="selectLocalOnlyQuickFilter()">💾 Local Only (${localOnlyCount})</button>`);
    row.innerHTML = chips.join('');
  }

  window.selectLocalOnlyQuickFilter = () => {
    activeDiscogsFolderFilter = null;
    activeStashFilter = activeStashFilter === 'localonly' ? 'all' : 'localonly';
    document.querySelectorAll('#stashFilters .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === activeStashFilter));
    renderStash();
  };

  window.renderStash = () => {
    renderStashFolderChips();

    const syncLine = document.getElementById('stashDiscogsSyncLine');
    if (syncLine) {
      if (cfg.discogsUser) {
        const lastTxt = cfg.discogsLastSyncAt ? `Last synced ${new Date(cfg.discogsLastSyncAt).toLocaleString()}` : 'Not synced yet';
        syncLine.textContent = `Discogs @${cfg.discogsUser} · ${lastTxt}`;
      } else {
        syncLine.textContent = 'Connect Discogs in Settings to mirror your collection copies & folders.';
      }
    }

    const q = norm(document.getElementById('stashSearch').value);
    const filtered = stashCache.filter(it => {
      if (['Cassette', 'CD', 'Vinyl'].includes(activeStashFilter) && it.format !== activeStashFilter) return false;
      if (activeStashFilter === 'highvalue' && !it.is_high_value && !it.is_scarce) return false;
      if (activeStashFilter === 'keep' && (it.taste_score || 0) < 7) return false;
      if (activeStashFilter === 'lowconf' && !(it.discogs_id && (it.have ?? 0) < 15)) return false;
      if (activeStashFilter === 'localonly' && (it.synced_to_discogs && !it.discogs_removed)) return false;
      if (activeDiscogsFolderFilter !== null) {
        if (!it.synced_to_discogs || it.discogs_removed) return false;
        if (String(it.discogs_folder_id || '1') !== String(activeDiscogsFolderFilter)) return false;
      }
      if (!q) return true;
      return norm(`${it.artist} ${it.title} ${it.catno} ${it.label} ${it.condition_note} ${getFolderNameById(it.discogs_folder_id)} ${(it.tracklist || []).map(t => `${t.artist || ''} ${t.title}`).join(' ')}`).includes(q);
    });

    updateRecalibrateStashBtn();

    const totalValUsd = filtered.reduce((s, it) => {
      const u = toApproxUsd(it.est_price, it.est_currency || 'USD');
      return s + (u !== null ? u : (Number(it.est_price) || 0));
    }, 0);
    document.getElementById('stashStats').textContent = `${filtered.length} items · ~$${Math.round(totalValUsd)}`;

    const list = document.getElementById('stashList');
    if (!filtered.length) {
      const emptyAction = cfg.discogsUser
        ? `<button type="button" class="btn btn-green btn-sm" style="margin-top:8px;" onclick="syncWithDiscogsUI(true)">🔄 Sync with Discogs</button>`
        : `<button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="switchView('settings')">⚙️ Connect Discogs or Google Drive</button>`;
      const emptyMsg = activeDiscogsFolderFilter !== null
        ? `No copies in folder "${esc(getFolderNameById(activeDiscogsFolderFilter))}" yet.`
        : (stashCache.length ? 'No matching items in this filter.' : 'Your Stash is empty. Scan an item, connect Google Drive, or sync your Discogs collection.');
      list.innerHTML = `<div class="card"><p>${emptyMsg}</p>${!stashCache.length ? emptyAction : ''}</div>`;
      return;
    }

    if (activeStashView === 'spines') {
      list.innerHTML = `<div class="spine-shelf">${filtered.map(it => {
        const tasteTxt = it.taste_score ? `${it.taste_score}/10` : '';
        const priceTxt = it.est_price != null ? formatMoney(it.est_price, it.est_currency || 'USD') : '';
        if (it.spine_thumb_url) {
          return `
            <div class="spine-row" onclick="openStashDetail(${it.id})">
              <div class="spine-img-wrap">
                <img class="spine-img" src="${esc(it.spine_thumb_url)}" alt="${esc(it.artist)} — ${esc(it.title)}" />
                ${(tasteTxt || priceTxt) ? `<div class="spine-img-tag">${priceTxt ? `<span>${esc(priceTxt)}</span>` : ''}${tasteTxt ? `<span style="color:var(--spotify);">${esc(tasteTxt)}</span>` : ''}</div>` : ''}
              </div>
            </div>
          `;
        }
        const accentCls = it.is_high_value ? 's-val' : ((it.taste_score || 0) >= 7 ? 's-keep' : '');
        const metaParts = [it.catno || '', it.format || '', tasteTxt].filter(Boolean).join(' · ');
        return `
          <div class="spine-row" onclick="openStashDetail(${it.id})">
            <div class="spine-typo ${accentCls}">
              <span class="spine-typo-title">${esc(it.artist || '?')} — ${esc(it.title || '?')}</span>
              <span class="spine-typo-meta">${esc(metaParts || '—')}</span>
            </div>
          </div>
        `;
      }).join('')}</div>`;
      return;
    }

    list.innerHTML = filtered.map(it => {
      const priceText = it.est_price != null ? formatMoney(it.est_price, it.est_currency || 'USD') : '—';
      const priceCls = it.est_price == null ? 'c-muted' : (it.is_high_value ? 'c-yellow' : '');
      const tasteText = it.taste_score ? `${it.taste_score}/10` : '—';
      const tasteCls = !it.taste_score ? 'c-muted' : (it.taste_score >= 7 ? 'c-green' : it.taste_score >= 5 ? 'c-blue' : 'c-red');
      const gradeText = formatGridGrade(it.media_condition, it.sleeve_condition);
      const gradeCls = gradeText === '—' ? 'c-muted' : '';

      let syncText = 'LOCAL';
      let syncCls = 'c-muted';
      if (it.discogs_removed) {
        syncText = 'REMOVED'; syncCls = 'c-yellow';
      } else if (it.synced_to_discogs) {
        if (it.pending_delete_old) { syncText = 'OLD COPY'; syncCls = 'c-yellow'; }
        else { syncText = getFolderNameById(it.discogs_folder_id || '1').toUpperCase(); syncCls = 'c-green'; }
      } else if (it.pending_discogs_sync) {
        syncText = 'PENDING'; syncCls = 'c-red';
      }

      const flags = [
        it.is_high_value ? `<span class="badge badge-yellow">🔥 VALUE</span>` : '',
        it.is_scarce ? `<span class="badge badge-purple">💎 SCARCE</span>` : '',
        it.discogs_removed ? `<span class="badge badge-yellow">Removed from Discogs</span>` : '',
        it.discogs_link_ambiguous ? `<span class="badge badge-yellow">⚠️ Link Copy</span>` : '',
        (Array.isArray(it.conflicts) && it.conflicts.length) ? `<span class="badge badge-purple">⚠️ Sync Conflict</span>` : '',
        isStashTasteStale(it) ? `<span class="badge badge-purple">🔄 TASTE</span>` : '',
        it.spine_thumb_url ? `<span class="badge badge-mono">SPINE</span>` : ''
      ].filter(Boolean).join('');

      return `
        <div class="stash-item" onclick="openStashDetail(${it.id})">
          <div class="stash-top">
            <img class="stash-thumb" src="${esc(it.thumb_data_url || '')}" onerror="this.style.visibility='hidden'" />
            <div class="stash-body">
              <div class="candidate-title">${esc(it.artist)} — ${esc(it.title)}</div>
              <div class="stash-sub">${esc(it.format)} · ${esc(it.country || '?')} · ${esc(it.year || '?')} · ${esc(it.catno || 'No Cat#')}</div>
              ${flags ? `<div class="stash-flags">${flags}</div>` : ''}
            </div>
            <span class="stash-chev">›</span>
          </div>
          <div class="stash-grid">
            <div class="stash-grid-cell ${priceCls}">${esc(priceText)}</div>
            <div class="stash-grid-cell ${tasteCls}">${esc(tasteText)}</div>
            <div class="stash-grid-cell ${gradeCls}">${esc(gradeText)}</div>
            <div class="stash-grid-cell ${syncCls}">${esc(syncText)}</div>
          </div>
        </div>
      `;
    }).join('');
  };

  window.recalibrateSingleStashItem = async (id) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); return; }
    if (rescoringStashItemId === id) return;

    rescoringStashItemId = id;
    const rescoreBtn = document.getElementById('sdBtnRescore');
    if (rescoreBtn) {
      rescoreBtn.disabled = true;
      rescoreBtn.textContent = '⏳ Re-Scoring...';
    }

    const localMatch = checkLocalSpotify(it);
    it.spotify_matches = localMatch;

    const tracksStr = (it.tracklist || []).map(t => t.artist ? `${t.artist} - ${t.title}` : t.title).join('; ');
    const dna = spotifyProfile?.tasteDna || '';
    const softSpots = spotifyProfile?.softSpots || '';
    const spBlock = localMatch.hasProvenance
      ? `- HIGH-WEIGHT Liked / Top / Saved-Album Artists: ${(localMatch.likedArtistDetails || []).join('; ') || 'None'}
- HIGH-WEIGHT Liked / Top / Saved-Album Songs: ${(localMatch.likedTrackMatches || []).join(', ') || 'None'}
- CASUAL Playlist-Only Artists (0 Liked Songs): ${(localMatch.playlistOnlyArtistDetails || []).join('; ') || 'None'}
- CASUAL Playlist-Only Songs (0 Liked Songs): ${(localMatch.playlistOnlyTrackMatches || []).join(', ') || 'None'}`
      : `- Matching Artists in Library: ${localMatch.details || 'None'}
- Exact / Matching Songs Already in Library: ${localMatch.matchedTracks.join(', ') || 'None'}`;

    const prompt = `Evaluate this physical music release strictly against the user's musical taste profile and provide brief musical/pop-culture context. Speak directly to "you".

Release: "${it.artist} - ${it.title}" (${it.year || '?'}, ${it.format}, Genres: ${(it.genres || []).join(', ') || 'unknown'}).
Full Tracklist: ${tracksStr || 'Unknown'}.
Exact Local Matches Across ALL ${spotifyProfile?.totalTracks || 0} Spotify Tracks / ${spotifyProfile?.totalArtists || 0} Artists:
${spBlock}

User's Taste Profile:
${dna || 'No written Taste Profile yet.'}

User's Explicit Soft Spots & Niche Pockets (FIRST-CLASS WEIGHT — treat these with EQUAL importance to Core Obsessions so smaller 5–15 song favorite pockets are NEVER averaged out of a large library):
${softSpots || 'None specified yet.'}

HARD RULES:
1. PROVENANCE WEIGHTING (LIKED SONGS > SAVED ALBUMS > PLAYLIST-ONLY):
   - Liked Songs, Top Tracks, Top Artists, and Saved Albums are STRONG personal favorites — boost the score and NEVER dismiss them as outside the user's taste!
   - Playlist-Only matches (0 Liked Songs) indicate CASUAL familiarity only; state this explicitly in "summary" rather than inflating to a 9–10.
2. SOFT SPOTS EQUAL WEIGHT: If this release fits ANY genre, style, era, or mood listed in "Soft Spots & Niche Pockets", score it enthusiastically as a genuine match on par with Core Obsessions.

Verdict rules:
- "KEEP" if score >= 7.
- "LISTEN" if score is 5-6.
- "SELL / SKIP" if score <= 4.

Return ONLY valid JSON:
{
  "score": 1 to 10 integer,
  "verdict": "KEEP" | "LISTEN" | "SELL / SKIP",
  "summary": "1-2 punchy sentences speaking directly to 'you' explaining why you will or won't enjoy this, referencing specific library hits, Soft Spots, or Taste Profile traits.",
  "context_note": "1-2 neutral sentences of useful context (plain description, no hype). Empty string if obscure/unremarkable.",
  "litmus_track": "exact song title from Full Tracklist (WITHOUT artist prefix) of the single best/most representative track to preview",
  "litmus_artist": "performing artist of litmus_track",
  "notable_songs": [
    { "artist": "performing artist", "title": "exact song title from Tracklist", "reason": "short 6-12 word reason it stands out" }
  ]
}
Include up to 6 genuinely recognizable songs in notable_songs (or empty array if none).`;

    setStatus(`🔄 Re-scoring "${it.artist} — ${it.title}"...`, true, { cancellable: true });
    try {
      const res = await CC.callAI([{ text: prompt }], null, { retryLabel: 'Stash Re-Score' });
      const prev = { ...it };
      it.taste_score = res.score;
      it.taste_verdict = res.verdict;
      it.taste_summary = res.summary || '';
      it.context_note = res.context_note || '';
      it.notable_songs = normalizeNotableList(res.notable_songs, it.artist);
      it.litmus_track = res.litmus_track || it.tracklist?.[0]?.title || it.litmus_track || '';
      it.litmus_artist = res.litmus_artist || '';
      it.taste_scored_at = Date.now();
      const stamped = CC.stampStashRevision(it, prev, [
        'taste_score', 'taste_verdict', 'taste_summary', 'context_note',
        'notable_songs', 'litmus_track', 'litmus_artist', 'taste_scored_at'
      ]);

      tasteCache.delete(`${norm(it.artist)}|${norm(it.title)}|v203`);
      await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
      await loadStashCache();
      renderStash();
      setStatus('', false);
      rescoringStashItemId = null;
      updateCloudUI();
      scheduleGoogleAutoSync();
      if (activeStashItem?.id === id) openStashDetail(id, true);
      toast(`✅ Re-scored: ${it.taste_score}/10 (${it.taste_verdict})`, 3200);
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast('Re-score failed: ' + err.message, 4500);
    } finally {
      if (rescoringStashItemId === id) rescoringStashItemId = null;
      const b = document.getElementById('sdBtnRescore');
      if (b && activeStashItem?.id === id) {
        b.disabled = false;
        b.textContent = '🔄 Re-Score';
      }
    }
  };

  window.recalibrateStashBatch = async () => {
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); return; }
    if (!stashCache.length) { toast('Your Stash is empty'); return; }
    if (recalibratingStash) { toast('Recalibration already running'); return; }

    const staleItems = stashCache.filter(isStashTasteStale);
    let targets = staleItems;
    if (staleItems.length > 0 && staleItems.length < stashCache.length) {
      if (!confirm(`Recalibrate ${staleItems.length} stale Stash item(s) whose Taste Profile / Spotify library changed?`)) return;
    } else if (staleItems.length === 0) {
      if (!confirm(`All ${stashCache.length} Stash items are up to date. Re-score ALL ${stashCache.length} items anyway?`)) return;
      targets = stashCache.slice();
    } else {
      if (!confirm(`Recalibrate all ${targets.length} Stash item(s) against your latest Taste Profile & Soft Spots?`)) return;
    }

    const BATCH_SIZE = 20;
    recalibratingStash = true;
    recalibrateProgressText = `⏳ Recalibrating 1–${Math.min(BATCH_SIZE, targets.length)} of ${targets.length}...`;
    updateRecalibrateStashBtn();

    const dna = spotifyProfile?.tasteDna || 'No written Taste Profile yet.';
    const softSpots = spotifyProfile?.softSpots || 'None specified';
    let updatedTotal = 0;

    try {
      for (let start = 0; start < targets.length; start += BATCH_SIZE) {
        if (!recalibratingStash) break;
        const chunk = targets.slice(start, start + BATCH_SIZE);
        const endNum = start + chunk.length;
        recalibrateProgressText = `⏳ Recalibrating ${start + 1}–${endNum} of ${targets.length}...`;
        updateRecalibrateStashBtn();
        setStatus(`🔄 Recalibrating ${start + 1}–${endNum} of ${targets.length}...`, true, { cancellable: true });

        const payload = chunk.map((it, idx) => {
          const lm = checkLocalSpotify(it);
          it.spotify_matches = lm;
          return {
            idx,
            artist: it.artist,
            title: it.title,
            year: it.year || '',
            format: it.format || '',
            genres: (it.genres || []).slice(0, 6),
            sample_tracks: (it.tracklist || []).slice(0, 12).map(t => t.artist ? `${t.artist} - ${t.title}` : t.title),
            liked_artists_in_spotify: lm.hasProvenance ? lm.likedArtistDetails : (lm.details !== 'None' ? [lm.details] : []),
            liked_tracks_in_spotify: lm.hasProvenance ? lm.likedTrackMatches : lm.matchedTracks,
            playlist_only_artists: lm.hasProvenance ? lm.playlistOnlyArtistDetails : [],
            playlist_only_tracks: lm.hasProvenance ? lm.playlistOnlyTrackMatches : []
          };
        });

        const prompt = `Batch-recalibrate personal taste scores for these ${chunk.length} saved music releases based on the user's Taste Profile, explicit Soft Spots, and exact local Spotify matches. Speak directly to "you".

User's Taste Profile:
${dna}

User's Explicit Soft Spots & Niche Pockets (FIRST-CLASS WEIGHT — treat these with EQUAL importance to Core Obsessions):
${softSpots}

HARD RULES:
1. PROVENANCE WEIGHTING: Liked/Top/Saved-Album matches deserve a strong boost; Playlist-Only matches (0 Liked Songs) indicate casual familiarity only — state that clearly instead of inflating to 9–10.
2. Evaluate BOTH the specific album/release (era, genre, studio album vs compilation) AND the artist.
3. Verdict rules: "KEEP" if score >= 7, "LISTEN" if 5-6, "SELL / SKIP" if <= 4.

Releases:
${JSON.stringify(payload)}

Return ONLY valid JSON:
{
  "scores": [
    { "idx": number, "score": 1 to 10 integer, "verdict": "KEEP" | "LISTEN" | "SELL / SKIP", "summary": "1-2 punchy sentences speaking to 'you'" }
  ]
}`;
        const batchRes = await CC.callAI([{ text: prompt }], null, { retryLabel: `Recalibrate ${start + 1}-${endNum}`, maxOutputTokens: 8192 });
        if (!recalibratingStash) break;

        const scoreMap = new Map((batchRes.scores || []).map(s => [s.idx, s]));
        const now = Date.now();
        for (let i = 0; i < chunk.length; i++) {
          const it = chunk[i];
          const sc = scoreMap.get(i);
          if (!sc) continue;
          const score = Math.max(1, Math.min(10, Math.round(Number(sc.score) || 5)));
          const verdict = ['KEEP', 'LISTEN', 'SELL / SKIP'].includes(sc.verdict)
            ? sc.verdict
            : (score >= 7 ? 'KEEP' : score >= 5 ? 'LISTEN' : 'SELL / SKIP');
          const prev = { ...it };
          it.taste_score = score;
          it.taste_verdict = verdict;
          if (sc.summary) it.taste_summary = sc.summary.trim();
          it.taste_scored_at = now;
          const stamped = CC.stampStashRevision(it, prev, ['taste_score', 'taste_verdict', 'taste_summary', 'taste_scored_at']);
          await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
          updatedTotal++;
        }

        await loadStashCache();
        renderStash();
      }

      tasteCache.clear();
      setStatus('', false);
      if (updatedTotal > 0) {
        updateCloudUI();
        scheduleGoogleAutoSync();
        toast(`✅ Recalibrated ${updatedTotal} Stash item(s)!`, 3600);
      }
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast(`Recalibration stopped after ${updatedTotal} item(s): ${err.message}`, 4800);
    } finally {
      recalibratingStash = false;
      recalibrateProgressText = '';
      updateRecalibrateStashBtn();
    }
  };

  function getStashCoverPhotos(it) {
    if (!it) return [];
    if (Array.isArray(it.thumbs) && it.thumbs.length) return it.thumbs.filter(Boolean);
    return it.thumb_data_url ? [it.thumb_data_url] : [];
  }

  window.openStashLightbox = (idx) => {
    if (!activeStashItem) return;
    openLightbox(getStashCoverPhotos(activeStashItem), idx);
  };

  window.openStashSpineLightbox = () => {
    if (!activeStashItem?.spine_thumb_url) return;
    openLightbox([activeStashItem.spine_thumb_url], 0);
  };

  window.toggleStashPhotoManager = (id) => {
    stashPhotoManagerOpen = !stashPhotoManagerOpen;
    if (activeStashItem?.id === id) openStashDetail(id, true);
  };

  // Direct Stash Detail photo add/replace/remove — works offline, zero Gemini/Discogs calls, zero grade changes!
  window.handleStashPhotoFiles = async (id, slot, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const it = stashCache.find(x => x.id === id);
    if (!it) return;

    const prev = { ...it };
    const nextThumbs = getStashCoverPhotos(it).slice();
    let nextSpineThumb = it.spine_thumb_url || '';
    let nextSpineSource = it.spine_source_url || '';
    let nextSpineFlipped = Boolean(it.spine_flipped);
    const changed = [];

    setStatus(`Processing ${files.length} photo(s) locally...`, true);
    try {
      for (const file of files) {
        if (slot === 'spine') {
          const pair = await decodeBlobToPhotoPair(file, { aiMaxDim: 1600, aiQuality: 0.88, saveMaxDim: 1600, saveQuality: 0.84, squarePreview: false });
          nextSpineSource = pair.saveWebp;
          nextSpineThumb = await normalizeSpineDataUrl(pair.saveWebp, '');
          nextSpineFlipped = false;
          changed.push('spine_source_url', 'spine_thumb_url', 'spine_flipped');
        } else if (slot === 'front') {
          const pair = await decodeBlobToPhotoPair(file, { aiMaxDim: 1600, aiQuality: 0.88, saveMaxDim: 1600, saveQuality: 0.84, squarePreview: true });
          if (nextThumbs.length === 0) nextThumbs.push(pair.saveWebp);
          else nextThumbs[0] = pair.saveWebp;
          changed.push('thumbs', 'thumb_data_url');
        } else if (slot === 'back') {
          const pair = await decodeBlobToPhotoPair(file, { aiMaxDim: 1600, aiQuality: 0.88, saveMaxDim: 1600, saveQuality: 0.84, squarePreview: true });
          if (nextThumbs.length === 0) nextThumbs.push(pair.saveWebp);
          else if (nextThumbs.length === 1) nextThumbs.push(pair.saveWebp);
          else nextThumbs[1] = pair.saveWebp;
          changed.push('thumbs', 'thumb_data_url');
        } else {
          // Append by default for Extra / general Add Photos
          const pair = await decodeBlobToPhotoPair(file, { aiMaxDim: 1600, aiQuality: 0.88, saveMaxDim: 1600, saveQuality: 0.84, squarePreview: nextThumbs.length < 2 });
          nextThumbs.push(pair.saveWebp);
          changed.push('thumbs', 'thumb_data_url');
        }
      }

      const updated = {
        ...it,
        thumbs: nextThumbs,
        thumb_data_url: nextThumbs[0] || it.discogs_thumb || '',
        spine_thumb_url: nextSpineThumb,
        spine_source_url: nextSpineSource,
        spine_flipped: nextSpineFlipped
      };
      const stamped = CC.stampStashRevision(updated, prev, Array.from(new Set(changed)));
      await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
      await loadStashCache();
      renderStash();
      updateCloudUI();
      scheduleGoogleAutoSync();
      setStatus('', false);
      if (activeStashItem?.id === id) openStashDetail(id, true);
      toast(`📷 Photo${files.length > 1 ? 's' : ''} saved to Stash!`);
    } catch (err) {
      setStatus('', false);
      toast('Photo error: ' + (err?.message || 'Failed'), 4200);
    }
  };

  window.removeStashPhotoSlot = async (id, idx, ev) => {
    if (ev) ev.stopPropagation();
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    if (!confirm('Remove this photo from this Stash item?')) return;
    const prev = { ...it };
    const nextThumbs = getStashCoverPhotos(it).slice();
    if (idx >= 0 && idx < nextThumbs.length) nextThumbs.splice(idx, 1);
    const updated = {
      ...it,
      thumbs: nextThumbs,
      thumb_data_url: nextThumbs[0] || it.discogs_thumb || ''
    };
    const stamped = CC.stampStashRevision(updated, prev, ['thumbs', 'thumb_data_url']);
    await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast('Photo removed');
  };

  window.removeStashSpine = async (id, ev) => {
    if (ev) ev.stopPropagation();
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    if (!confirm('Remove spine photo from this item?')) return;
    const prev = { ...it };
    const updated = { ...it, spine_thumb_url: '', spine_source_url: '', spine_flipped: false };
    const stamped = CC.stampStashRevision(updated, prev, ['spine_thumb_url', 'spine_source_url', 'spine_flipped']);
    await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast('Spine removed');
  };

  // Manual 180° Spine Flip in Stash Detail (works on legacy spines without spine_source_url and without AI!)
  window.flipStashSpine180 = async (id, ev) => {
    if (ev) ev.stopPropagation();
    const it = stashCache.find(x => x.id === id);
    if (!it || !it.spine_thumb_url) return;
    const prev = { ...it };
    const sourceUrl = it.spine_source_url || it.spine_thumb_url;
    const rotated = await rotateDataUrlByDeg(it.spine_thumb_url, 180, 'image/webp', 0.84, 1200);
    const updated = {
      ...it,
      spine_source_url: sourceUrl,
      spine_thumb_url: rotated,
      spine_flipped: !Boolean(it.spine_flipped)
    };
    const stamped = CC.stampStashRevision(updated, prev, ['spine_source_url', 'spine_thumb_url', 'spine_flipped']);
    await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast('↻ Spine flipped 180° & saved!', 2000);
  };

  window.updateLocalIntendedFolder = async (id, folderId) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    const prev = { ...it };
    const updated = { ...it, intended_discogs_folder_id: String(folderId || '1') };
    const stamped = CC.stampStashRevision(updated, prev, ['intended_discogs_folder_id']);
    await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
    await loadStashCache();
    updateCloudUI();
    scheduleGoogleAutoSync();
    toast(`Target Discogs folder set to "${getFolderNameById(folderId)}" (saved locally)`);
  };

  window.moveStashItemFolder = async (id, opts = {}) => {
    const { force = false, explicitTarget = null } = opts || {};
    const it = stashCache.find(x => x.id === id);
    if (!it || !it.synced_to_discogs || !it.discogs_id || !it.discogs_instance_id) {
      toast('Only Discogs-linked copies can be moved on Discogs');
      return;
    }
    if (!cfg.discogsToken || !cfg.discogsUser) {
      toast('Verify your Discogs account in Settings first');
      return;
    }
    const sel = document.getElementById('sdMoveFolderSel');
    const targetFolderId = String(explicitTarget ?? sel?.value ?? '1');
    if (targetFolderId === '0') { toast('Cannot move into virtual "All" folder'); return; }

    const expectedSource = it.pending_folder_move?.fromFolderId || it.discogs_folder_id || '1';
    const moveBtn = document.getElementById('sdBtnMoveFolder');
    if (moveBtn) moveBtn.disabled = true;

    // Persist pending move intent BEFORE network call so uncertain timeouts can retry safely
    const prevBeforeMove = { ...it };
    const pendingRec = CC.stampStashRevision({
      ...it,
      pending_folder_move: {
        fromFolderId: String(expectedSource),
        targetFolderId,
        startedAt: Date.now()
      }
    }, prevBeforeMove, ['pending_folder_move']);
    await CC.commitLocalMutation({ upsertStash: pendingRec, queueOutbox: false });
    await loadStashCache();

    setStatus(`📁 Moving copy #${it.discogs_instance_id} to "${getFolderNameById(targetFolderId)}" on Discogs...`, true);
    try {
      const res = await CC.moveDiscogsInstanceFolder(it.discogs_id, it.discogs_instance_id, targetFolderId, {
        expectedSourceFolderId: force ? '' : String(expectedSource),
        force
      });

      if (res.status === 'conflict_third_folder') {
        activeFolderMoveConflict = {
          stashId: id,
          actualFolderId: res.actualFolderId,
          targetFolderId: res.targetFolderId,
          expectedSourceFolderId: res.expectedSourceFolderId
        };
        setStatus('', false);
        if (activeStashItem?.id === id) openStashDetail(id, true);
        toast(`⚠️ Copy was moved to "${getFolderNameById(res.actualFolderId)}" on Discogs — choose how to proceed`, 4600);
        return;
      }

      activeFolderMoveConflict = null;
      const latest = stashCache.find(x => x.id === id) || pendingRec;
      const now = Date.now();
      const finalRec = CC.stampStashRevision({
        ...latest,
        discogs_folder_id: String(res.folderId),
        discogs_folder_verified_at: now,
        rating: Number(res.rating ?? latest.rating ?? 0),
        pending_folder_move: null
      }, latest, ['discogs_folder_id', 'discogs_folder_verified_at', 'rating', 'pending_folder_move']);

      await CC.commitLocalMutation({ upsertStash: finalRec, queueOutbox: true });
      await loadStashCache();
      renderStash();
      updateCloudUI();
      scheduleGoogleAutoSync();
      setStatus('', false);
      if (activeStashItem?.id === id) openStashDetail(id, true);
      toast(res.status === 'already_in_target'
        ? `✅ Already in "${getFolderNameById(res.folderId)}" on Discogs`
        : `✅ Moved to "${getFolderNameById(res.folderId)}" on Discogs!`);
    } catch (err) {
      setStatus('', false);
      if (activeStashItem?.id === id) openStashDetail(id, true);
      toast('Folder move failed: ' + (err?.message || 'Network error — tap Retry Move safely'), 5200);
    } finally {
      const b = document.getElementById('sdBtnMoveFolder');
      if (b) b.disabled = false;
    }
  };

  window.resolveFolderMoveConflict = async (id, choice) => {
    const conf = activeFolderMoveConflict;
    if (!conf || conf.stashId !== id) return;
    if (choice === 'force_move') {
      await moveStashItemFolder(id, { force: true, explicitTarget: conf.targetFolderId });
      return;
    }
    // Keep Discogs' actual folder locally
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    const now = Date.now();
    const updated = CC.stampStashRevision({
      ...it,
      discogs_folder_id: String(conf.actualFolderId),
      discogs_folder_verified_at: now,
      pending_folder_move: null
    }, it, ['discogs_folder_id', 'discogs_folder_verified_at', 'pending_folder_move']);
    activeFolderMoveConflict = null;
    await CC.commitLocalMutation({ upsertStash: updated, queueOutbox: true });
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast(`✅ Kept Discogs folder "${getFolderNameById(conf.actualFolderId)}"`);
  };

  window.resolveAmbiguousDiscogsLink = async (id, instanceId, folderId) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    const now = Date.now();
    const updated = CC.stampStashRevision({
      ...it,
      discogs_instance_id: Number(instanceId),
      discogs_folder_id: String(folderId || '1'),
      discogs_folder_verified_at: now,
      discogs_link_ambiguous: false,
      discogs_ambiguous_candidates: null,
      synced_to_discogs: true,
      discogs_removed: false,
      discogs_removed_at: null
    }, it, ['discogs_instance_id', 'discogs_folder_id', 'discogs_folder_verified_at', 'discogs_link_ambiguous', 'synced_to_discogs', 'discogs_removed', 'discogs_removed_at']);
    await CC.commitLocalMutation({ upsertStash: updated, queueOutbox: true });
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast(`✅ Linked to Discogs copy #${instanceId} (${getFolderNameById(folderId)})`);
  };

  window.resolveStashConflict = async (stashId, conflictId, applyRetained) => {
    const it = stashCache.find(x => x.id === stashId);
    if (!it || !Array.isArray(it.conflicts)) return;
    const c = it.conflicts.find(x => x.id === conflictId);
    const remaining = it.conflicts.filter(x => x.id !== conflictId);
    const prev = { ...it };
    const next = { ...it, conflicts: remaining };
    const changed = [];
    if (applyRetained && c && c.field) {
      next[c.field] = c.retainedVal;
      changed.push(c.field);
    }
    const stamped = CC.stampStashRevision(next, prev, changed);
    await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
    // Also clean from cloud_sync_meta_v2
    const meta = await CC.getCloudSyncMeta();
    meta.conflicts = (meta.conflicts || []).filter(x => x.id !== conflictId);
    await CC.idbPut('meta', { key: 'cloud_sync_meta_v2', value: meta });
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (activeStashItem?.id === stashId) openStashDetail(stashId, true);
    toast(applyRetained ? `✅ Restored alternate "${c?.field}" value` : 'Conflict dismissed');
  };

  window.openStashDetail = (id, fromPop = false) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    if (activeStashItem?.id !== id) {
      stashPhotoManagerOpen = false;
      if (activeFolderMoveConflict?.stashId !== id) activeFolderMoveConflict = null;
    }
    activeStashItem = it;
    pendingVoiceRetry = null;

    if (!fromPop) {
      try {
        if (history.state?.modal === 'stashDetail') history.replaceState({ view: 'stash', modal: 'stashDetail', itemId: id }, '');
        else history.pushState({ view: 'stash', modal: 'stashDetail', itemId: id }, '');
      } catch (_) {}
    }

    document.getElementById('sdHeaderTitle').textContent = `${it.artist} — ${it.title}`;
    const photos = getStashCoverPhotos(it);
    const localMatch = checkLocalSpotify(it);
    const hasDiscogs = Boolean(it.discogs_id);
    const foldersList = getDiscogsFoldersList();

    const ebayQ = encodeURIComponent(`${it.artist} ${it.title} ${it.format} ${it.catno}`.trim());
    let links = `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${ebayQ}&LH_Sold=1&LH_Complete=1">💸 eBay Sold</a>`;
    if (hasDiscogs) {
      links = `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${esc(it.discogs_url)}">💿 Discogs</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/history/${it.discogs_id}">📈 Sales History</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/post/${it.discogs_id}">🏷️ Sell</a>` + links;
    }
    links = `<button type="button" class="btn btn-purple btn-sm" onclick="startEditStashItem(${it.id})">🔄 Edit / Re-Check</button>` + links;

    let alerts = '';
    if (it.discogs_removed) {
      alerts += `<div class="alert-box alert-dup">⚠️ <strong>Removed from Discogs</strong> — this copy is no longer in your Discogs collection. Your local record, photos, spine, grades, and notes are safely preserved under <strong>Local Only</strong>.${hasDiscogs ? ' You can push it back to Discogs below if desired.' : ''}</div>`;
    }
    if (it.discogs_link_ambiguous && Array.isArray(it.discogs_ambiguous_candidates) && it.discogs_ambiguous_candidates.length) {
      alerts += `<div class="alert-box alert-dup">
        <div>⚠️ <strong>Multiple Discogs copies found for #${it.discogs_id}</strong> — pick which exact copy this Stash item represents:</div>
        <div class="inline-actions" style="margin-top:8px;">
          ${it.discogs_ambiguous_candidates.map(c => `<button type="button" class="btn btn-green btn-sm" onclick="resolveAmbiguousDiscogsLink(${it.id}, ${Number(c.instance_id)}, '${esc(c.folder_id)}')">Link Copy #${Number(c.instance_id)} (${esc(getFolderNameById(c.folder_id))})</button>`).join('')}
        </div>
      </div>`;
    }
    if (Array.isArray(it.conflicts) && it.conflicts.length) {
      alerts += it.conflicts.map(c => `
        <div class="alert-box alert-other-pressing">
          <div>⚠️ <strong>Sync Conflict on "${esc(c.field)}"</strong></div>
          <div style="font-size:0.78rem; margin-top:4px;">Current: <code>${esc(String(c.keptVal ?? ''))}</code> · Competing edit: <code>${esc(String(c.retainedVal ?? ''))}</code></div>
          <div class="inline-actions" style="margin-top:8px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="resolveStashConflict(${it.id}, '${esc(c.id)}', false)">Keep Current</button>
            <button type="button" class="btn btn-purple btn-sm" onclick="resolveStashConflict(${it.id}, '${esc(c.id)}', true)">Use Competing Edit</button>
          </div>
        </div>
      `).join('');
    }
    if (it.pending_discogs_sync) {
      alerts += `<div class="alert-box alert-dup">⏳ Pressing was changed locally and is not synced to Discogs yet.${it.pending_delete_old ? ` Pushing will add #${it.discogs_id} first and then remove old #${it.pending_delete_old.releaseId}.` : ''} Tap <strong>Push to Discogs</strong> below.</div>`;
    } else if (it.synced_to_discogs && it.pending_delete_old) {
      const oldId = it.pending_delete_old.releaseId;
      const retryLabel = it.pending_field_sync ? `🧹 Sync Grades &amp; Remove Old #${oldId}` : `🧹 Retry Removing Old #${oldId}`;
      alerts += `<div class="alert-box alert-dup">
        <div>⚠️ Old pressing #${oldId} was kept on Discogs (${it.pending_delete_old.ambiguous ? `multiple copies found — remove manually on Discogs` : (it.pending_field_sync ? `new copy grades failed to sync first` : `removal pending`)}).</div>
        <div class="inline-actions" style="margin-top:8px;">
          ${!it.pending_delete_old.ambiguous ? `<button type="button" class="btn btn-sm" onclick="retryRemoveOldDiscogsCopy(${it.id})">${retryLabel}</button>` : ''}
          <a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/release/${oldId}">Open #${oldId} ↗</a>
          <button type="button" class="btn btn-secondary btn-sm" onclick="dismissPendingDeleteOld(${it.id})">Dismiss</button>
        </div>
      </div>`;
    } else if (it.synced_to_discogs && it.pending_field_sync) {
      alerts += `<div class="alert-box alert-dup">⚠️ Some Media/Sleeve/Notes fields failed to sync to Discogs. Tap <strong>💾 Save Grade &amp; Sync Discogs</strong> below to retry.</div>`;
    }
    if (it.is_high_value) alerts += `<div class="alert-box alert-high-value">🔥 HIGH VALUE (${esc(formatMoneyWithUsd(it.est_price, it.est_currency || 'USD'))}) — SET ASIDE!</div>`;
    if (it.is_scarce) alerts += `<div class="alert-box alert-scarce">💎 SCARCE (0 for sale, ${it.want} want / ${it.have} have) — CHECK SOLD!</div>`;

    const needsStashTiebreakConfirm = Boolean(!it.synced_to_discogs && it.discogs_id && it.is_conservative_tiebreak && !it.tiebreak_confirmed);

    let localBadges = buildSpotifyBadgesHtml(localMatch, false);
    if (isStashTasteStale(it)) localBadges += `<span class="badge badge-purple">🔄 Taste updated</span>`;

    const contextTxt = it.context_note || it.cultural_reason || '';

    // Build responsive Stash Detail Photo Gallery (Front + Back side-by-side square tiles, Spine full-width below with Flip 180°)
    const slotLabels = ['FRONT', 'BACK'];
    let galleryHtml = '<div class="photo-gallery" style="margin-bottom:12px;">';
    if (photos.length) {
      const singleCls = photos.length === 1 ? 'single-cover' : '';
      galleryHtml += `<div class="photo-gallery-covers ${singleCls}">${photos.map((src, i) => `
        <div class="photo-tile" onclick="openStashLightbox(${i})" title="Tap to zoom fullscreen">
          <img src="${esc(src)}" alt="${slotLabels[i] || `Photo ${i + 1}`}" />
          <span class="photo-tile-label">${slotLabels[i] || `EXTRA ${i - 1}`}</span>
          ${stashPhotoManagerOpen ? `<div class="photo-tile-actions"><button type="button" class="photo-tile-btn danger" onclick="removeStashPhotoSlot(${it.id}, ${i}, event)" title="Remove photo">×</button></div>` : ''}
        </div>
      `).join('')}</div>`;
    }
    if (it.spine_thumb_url) {
      galleryHtml += `
        <div class="photo-gallery-spine">
          <div class="photo-gallery-spine-bar">
            <span style="font-size:0.7rem; font-weight:800; letter-spacing:0.06em; color:var(--muted);">SPINE${it.spine_flipped ? ' (FLIPPED 180°)' : ''}</span>
            <div class="inline-actions" style="gap:4px;">
              <button type="button" class="photo-tile-btn" onclick="flipStashSpine180(${it.id}, event)" title="Flip spine 180°">↻ Flip 180°</button>
              ${stashPhotoManagerOpen ? `<button type="button" class="photo-tile-btn danger" onclick="removeStashSpine(${it.id}, event)" title="Remove spine">×</button>` : ''}
            </div>
          </div>
          <div class="photo-gallery-spine-imgwrap" onclick="openStashSpineLightbox()" title="Tap to zoom spine">
            <img src="${esc(it.spine_thumb_url)}" alt="Cropped spine" />
          </div>
        </div>
      `;
    }
    galleryHtml += `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <span style="font-size:0.72rem; color:var(--muted);">${(photos.length || it.spine_thumb_url) ? 'Tap any photo to zoom fullscreen' : 'No photos saved yet'}</span>
        <button type="button" class="btn btn-secondary btn-sm" style="min-height:30px; padding:3px 10px; font-size:0.74rem;" onclick="toggleStashPhotoManager(${it.id})">${stashPhotoManagerOpen ? '✕ Done Managing Photos' : '📷 Add Photos'}</button>
      </div>
    `;
    if (stashPhotoManagerOpen) {
      galleryHtml += `
        <div class="sd-photo-panel">
          <div style="font-size:0.78rem; color:var(--muted); margin-bottom:8px;">
            Add or replace photos directly (saved locally at 1600×1600 WebP &amp; synced to Drive — zero AI or Discogs writes, grades stay untouched).
          </div>
          <input id="sdPhotoFrontCam" class="hidden-file" type="file" accept="image/*" capture="environment" onchange="handleStashPhotoFiles(${it.id}, 'front', this.files); this.value='';" />
          <input id="sdPhotoFrontUp" class="hidden-file" type="file" accept="image/*" onchange="handleStashPhotoFiles(${it.id}, 'front', this.files); this.value='';" />
          <input id="sdPhotoBackCam" class="hidden-file" type="file" accept="image/*" capture="environment" onchange="handleStashPhotoFiles(${it.id}, 'back', this.files); this.value='';" />
          <input id="sdPhotoBackUp" class="hidden-file" type="file" accept="image/*" onchange="handleStashPhotoFiles(${it.id}, 'back', this.files); this.value='';" />
          <input id="sdPhotoSpineCam" class="hidden-file" type="file" accept="image/*" capture="environment" onchange="handleStashPhotoFiles(${it.id}, 'spine', this.files); this.value='';" />
          <input id="sdPhotoSpineUp" class="hidden-file" type="file" accept="image/*" onchange="handleStashPhotoFiles(${it.id}, 'spine', this.files); this.value='';" />
          <input id="sdPhotoExtraUp" class="hidden-file" type="file" accept="image/*" multiple onchange="handleStashPhotoFiles(${it.id}, 'extra', this.files); this.value='';" />
          <div class="inline-actions" style="gap:6px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('sdPhotoFrontCam').click()">📷 ${photos[0] ? 'Replace' : 'Add'} Front</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('sdPhotoFrontUp').click()">🖼️ Upload Front</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('sdPhotoBackCam').click()">📷 ${photos[1] ? 'Replace' : 'Add'} Back</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('sdPhotoBackUp').click()">🖼️ Upload Back</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('sdPhotoSpineCam').click()">📷 ${it.spine_thumb_url ? 'Replace' : 'Add'} Spine</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('sdPhotoSpineUp').click()">🖼️ Upload Spine</button>
            <button type="button" class="btn btn-green btn-sm" onclick="document.getElementById('sdPhotoExtraUp').click()">➕ Append Extra Photo(s)</button>
          </div>
        </div>
      `;
    }
    galleryHtml += '</div>';

    // Build Discogs Folder / Move to Folder panel
    let folderBoxHtml = '';
    if (it.synced_to_discogs && !it.discogs_removed && it.discogs_id && it.discogs_instance_id) {
      const curFid = String(it.discogs_folder_id || '1');
      const conf = (activeFolderMoveConflict && activeFolderMoveConflict.stashId === it.id) ? activeFolderMoveConflict : null;
      const pendingMove = it.pending_folder_move || null;
      folderBoxHtml = `
        <div class="sd-folder-box">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
            <strong style="font-size:0.86rem;">📁 Discogs Folder</strong>
            <span class="badge badge-green" style="margin:0;">${esc(getFolderNameById(curFid))} · Copy #${Number(it.discogs_instance_id)}</span>
          </div>
          ${conf ? `
            <div class="alert-box alert-dup" style="margin-bottom:8px;">
              <div>⚠️ On Discogs, this copy is now in <strong>${esc(getFolderNameById(conf.actualFolderId))}</strong> (expected ${esc(getFolderNameById(conf.expectedSourceFolderId))}).</div>
              <div class="inline-actions" style="margin-top:8px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="resolveFolderMoveConflict(${it.id}, 'keep_discogs')">Keep "${esc(getFolderNameById(conf.actualFolderId))}"</button>
                <button type="button" class="btn btn-green btn-sm" onclick="resolveFolderMoveConflict(${it.id}, 'force_move')">Move to "${esc(getFolderNameById(conf.targetFolderId))}"</button>
              </div>
            </div>
          ` : ''}
          ${pendingMove && !conf ? `
            <div class="alert-box alert-dup" style="margin-bottom:8px;">
              ⏳ Previous move to <strong>${esc(getFolderNameById(pendingMove.targetFolderId))}</strong> did not finish confirming. Tap Move to Folder again to verify live state and retry safely.
            </div>
          ` : ''}
          <div style="display:flex; gap:8px; align-items:center;">
            <select id="sdMoveFolderSel" style="flex:1;">
              ${foldersList.map(f => `<option value="${f.id}" ${String(f.id) === (pendingMove ? String(pendingMove.targetFolderId) : curFid) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
            </select>
            <button id="sdBtnMoveFolder" type="button" class="btn btn-green btn-sm" style="flex:0 0 auto;" onclick="moveStashItemFolder(${it.id})">📁 Move to Folder</button>
          </div>
        </div>
      `;
    } else {
      const intendedFid = String(it.intended_discogs_folder_id || cfg.discogsFolderId || '1');
      folderBoxHtml = `
        <div class="sd-folder-box">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
            <strong style="font-size:0.86rem;">📁 Target Discogs Folder (Local Only)</strong>
            <span class="badge badge-mono" style="margin:0;">Local Only</span>
          </div>
          <div style="font-size:0.74rem; color:var(--muted); margin-bottom:6px;">Stored locally for when you push this copy to Discogs (no remote write yet).</div>
          <select id="sdIntendedFolderSel" onchange="updateLocalIntendedFolder(${it.id}, this.value)">
            ${foldersList.map(f => `<option value="${f.id}" ${String(f.id) === intendedFid ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
          </select>
        </div>
      `;
    }

    const body = document.getElementById('sdBody');
    body.innerHTML = `
      ${galleryHtml}

      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
        <div>
          <h2 style="margin:0 0 2px;">${esc(it.artist)} — ${esc(it.title)}</h2>
          <div style="font-size:0.84rem; color:var(--muted);">${esc(it.format)} · ${esc(it.country || '?')} · ${esc(it.year || '?')} · ${esc(it.label || 'Unknown Label')} · ${esc(it.catno || 'No Cat#')}</div>
        </div>
        ${hasDiscogs ? `<span class="badge ${it.is_conservative_tiebreak ? 'badge-yellow' : 'badge-blue'}">#${it.discogs_id}</span>` : `<span class="badge badge-yellow">Unlisted</span>`}
      </div>

      ${alerts}
      ${folderBoxHtml}

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
          <div class="inline-actions" style="gap:6px;">
            <button id="sdBtnRescore" type="button" class="btn btn-secondary btn-sm" style="min-height:28px; padding:3px 9px; font-size:0.74rem;" ${rescoringStashItemId === it.id ? 'disabled' : ''} onclick="recalibrateSingleStashItem(${it.id})">${rescoringStashItemId === it.id ? '⏳ Re-Scoring...' : '🔄 Re-Score'}</button>
            <span class="taste-score">${it.taste_score ? `${esc(it.taste_score)}/10` : '—'} ${it.taste_verdict ? `<span class="badge ${verdictBadgeClass(it.taste_verdict)}" style="vertical-align:middle;">${esc(it.taste_verdict)}</span>` : ''}</span>
          </div>
        </div>
        <div style="margin-bottom:6px;">${localBadges}</div>
        <div style="font-size:0.87rem; color:#e2e8f0;">${esc(it.taste_summary || 'No taste summary saved.')}</div>
        ${contextTxt ? `<div class="context-box"><strong>📖 Context:</strong> ${esc(contextTxt)}</div>` : ''}
        <div style="margin-top:10px; font-size:0.84rem; color:#cbd5e1;">${buildNotableHitsHtml(it, 'stash')}</div>
      </div>

      <div class="section-block">
        <div class="section-heading">🎵 Tracklist (${(it.tracklist || []).length})</div>
        <div class="tracklist-open">${buildTracklistHtml(it.tracklist || [], localMatch.matchedTracks, 'stash', it.artist)}</div>
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
            <select id="sdMediaCond">${gradeOptionsHtml(MEDIA_GRADES, it.media_condition || 'Not Graded')}</select>
          </div>
          <div>
            <label class="field-label">Sleeve / Case Condition</label>
            <select id="sdSleeveCond">${gradeOptionsHtml(SLEEVE_GRADES, it.sleeve_condition || 'Not Graded')}</select>
          </div>
        </div>
        <div style="margin-bottom:10px;">
          <label class="field-label">Condition / Listing Report</label>
          <textarea id="sdNotes" class="tall-textarea" rows="5">${esc(it.condition_note || '')}</textarea>
        </div>
        ${needsStashTiebreakConfirm ? `
          <div class="confirm-tiebreak-box" style="margin-bottom:10px;">
            <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; font-size:0.84rem; color:#fde68a;">
              <input id="sdChkConfirmTiebreak" type="checkbox" style="width:20px; height:20px; margin-top:2px; flex:0 0 auto;" onchange="updateStashPushBtnState()" />
              <span>Confirm pushing as most common pressing <strong>#${it.discogs_id}</strong> (${it.have ?? 0} have) — case/insert details were absent or uncheckable.</span>
            </label>
          </div>
        ` : ''}
        <div class="inline-actions">
          <button class="btn btn-sm" onclick="saveStashEdits(${it.id})">💾 Save Grade &amp; Sync Discogs</button>
          ${(!it.synced_to_discogs && it.discogs_id) ? `<button id="sdBtnPushDiscogs" class="btn btn-green btn-sm" ${needsStashTiebreakConfirm ? 'disabled' : ''} onclick="pushStashToDiscogs(${it.id})">✅ Push to Discogs</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteStashItem(${it.id})">🗑️ Delete</button>
        </div>
      </div>
    `;

    document.getElementById('stashDetailModal').classList.remove('hidden');
    body.scrollTop = 0;
    syncTrackPlayButtons();
    updateStashPushBtnState();
  };

  window.updateStashPushBtnState = () => {
    const btn = document.getElementById('sdBtnPushDiscogs');
    if (!btn) return;
    const isLocked = Boolean(
      activeStashItem &&
      (activeDiscogsSaves.has(`stash:${activeStashItem.id}`) ||
       (activeStashItem.discogs_id && activeDiscogsSaves.has(`rel:${activeStashItem.discogs_id}`)))
    );
    const chk = document.getElementById('sdChkConfirmTiebreak');
    btn.disabled = isLocked || Boolean(chk && !chk.checked);
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

    // Finish failed field writes on the NEW pressing FIRST before deleting the old copy
    if (it.pending_field_sync && it.discogs_id && it.discogs_instance_id) {
      setStatus(`Retrying grade & notes sync on new pressing #${it.discogs_id}...`, true);
      const fId = it.discogs_folder_id || cfg.discogsFolderId || '1';
      const fieldRes = await CC.syncDiscogsInstanceFields(fId, it.discogs_id, it.discogs_instance_id, it.media_condition, it.sleeve_condition, it.condition_note);
      it.pending_field_sync = fieldRes.failedCount > 0;
      await CC.idbPut('stash', it);

      if (fieldRes.failedCount > 0) {
        await loadStashCache();
        renderStash();
        setStatus('', false);
        if (activeStashItem?.id === id) openStashDetail(id, true);
        toast(`⚠️ New pressing still had ${fieldRes.failedCount} field sync error(s) (${fieldRes.errors[0] || ''}) — old copy #${it.pending_delete_old.releaseId} kept safely on Discogs.`, 5600);
        return;
      }
    }

    setStatus(`Removing old pressing #${it.pending_delete_old.releaseId} from Discogs...`, true);
    const delRes = await attemptDeleteOldCopy(it);
    await loadStashCache();
    renderStash();
    setStatus('', false);
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast(delRes.ok ? '✅ Grades synced & old pressing removed from Discogs!' : `⚠️ ${delRes.warning}`, 5000);
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
    const prev = { ...it };
    const nextMedia = document.getElementById('sdMediaCond').value;
    const nextSleeve = document.getElementById('sdSleeveCond').value;
    const nextNote = document.getElementById('sdNotes').value.trim();
    const updated = {
      ...it,
      media_condition: nextMedia,
      sleeve_condition: nextSleeve,
      condition_note: nextNote
    };
    const changedFields = ['media_condition', 'sleeve_condition', 'condition_note'];

    if (updated.synced_to_discogs && updated.discogs_id && cfg.discogsUser) {
      let instId = updated.discogs_instance_id;
      let fId = updated.discogs_folder_id || cfg.discogsFolderId || '1';
      let remoteCopies = 0;
      if (!instId) {
        const insts = await CC.findDiscogsInstances(updated.discogs_id);
        remoteCopies = insts.length;
        if (insts.length === 1) {
          instId = insts[0].instance_id;
          fId = String(insts[0].folder_id || fId);
          updated.discogs_instance_id = instId;
          updated.discogs_folder_id = fId;
          updated.discogs_account = cfg.discogsUser;
          updated.discogs_folder_verified_at = Date.now();
          changedFields.push('discogs_instance_id', 'discogs_folder_id', 'discogs_account', 'discogs_folder_verified_at');
        }
      }
      if (instId) {
        const fieldRes = await CC.syncDiscogsInstanceFields(fId, updated.discogs_id, instId, updated.media_condition, updated.sleeve_condition, updated.condition_note);
        updated.pending_field_sync = fieldRes.failedCount > 0;
        changedFields.push('pending_field_sync');
        if (fieldRes.failedCount > 0) {
          toast(`⚠️ Saved locally, but ${fieldRes.failedCount} Discogs field(s) failed: ${fieldRes.errors[0] || ''}`, 5000);
        } else {
          toast('✅ Updated Stash & Discogs grades!');
        }
      } else toast(`💾 Saved locally — found ${remoteCopies} Discogs cop${remoteCopies === 1 ? 'y' : 'ies'}, so remote grades were not overwritten.`, 5000);
    } else toast('💾 Grade & notes saved!');

    const stamped = CC.stampStashRevision(updated, prev, changedFields);
    await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (activeStashItem?.id === id) openStashDetail(id, true);
  };

  window.pushStashToDiscogs = async (id) => {
    const it = stashCache.find(x => x.id === id);
    if (!it || !it.discogs_id || !cfg.discogsUser) { toast('Verify Discogs in Settings first'); return; }

    if (it.is_conservative_tiebreak && !it.tiebreak_confirmed) {
      const chk = document.getElementById('sdChkConfirmTiebreak');
      if (!chk?.checked) {
        toast('Please check the confirmation box for this conservative tie-breaker pick before pushing to Discogs', 4200);
        return;
      }
    }

    const ledgerKey = `stash:${it.id}`;
    const relKey = `rel:${it.discogs_id}`;
    const lockKeys = [ledgerKey, relKey];
    if (lockKeys.some(k => activeDiscogsSaves.has(k))) return;

    lockKeys.forEach(k => activeDiscogsSaves.add(k));
    const pushBtn = document.getElementById('sdBtnPushDiscogs');
    if (pushBtn) pushBtn.disabled = true;

    const prev = { ...it };
    const updated = { ...it };
    if (activeStashItem?.id === id) {
      updated.media_condition = document.getElementById('sdMediaCond')?.value || updated.media_condition;
      updated.sleeve_condition = document.getElementById('sdSleeveCond')?.value || updated.sleeve_condition;
      updated.condition_note = document.getElementById('sdNotes')?.value.trim() ?? updated.condition_note;
    }
    const targetFolder = updated.intended_discogs_folder_id || cfg.discogsFolderId || '1';

    try {
      const added = await ensureDiscogsInstanceDurable(ledgerKey, updated.discogs_id, targetFolder, [relKey]);
      const folderId = String(added.folderId || targetFolder);
      const newInstId = added.instanceId;
      const now = Date.now();

      updated.synced_to_discogs = true;
      updated.discogs_account = cfg.discogsUser;
      updated.discogs_removed = false;
      updated.discogs_removed_at = null;
      updated.intended_discogs_folder_id = null;
      updated.pending_discogs_sync = false;
      updated.tiebreak_confirmed = true;
      updated.discogs_folder_id = folderId;
      updated.discogs_folder_verified_at = now;
      updated.discogs_instance_id = newInstId;

      setStatus('Syncing grades & notes to Discogs...', true);
      const fieldRes = await CC.syncDiscogsInstanceFields(folderId, updated.discogs_id, newInstId, updated.media_condition, updated.sleeve_condition, updated.condition_note);
      updated.pending_field_sync = fieldRes.failedCount > 0;

      // Persist immediately & atomically BEFORE removing any old swapped pressing; clear both ledger keys only after IDB succeeds
      const stamped = CC.stampStashRevision(updated, prev);
      await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
      clearPendingDiscogsOp(ledgerKey);
      clearPendingDiscogsOp(relKey);

      let oldWarn = '';
      if (stamped.pending_delete_old) {
        if (fieldRes.failedCount > 0) {
          oldWarn = `${fieldRes.failedCount} grade/note field(s) failed (${fieldRes.errors[0] || ''}) — old pressing #${stamped.pending_delete_old.releaseId} kept safely on Discogs.`;
        } else {
          setStatus(`Removing old pressing #${stamped.pending_delete_old.releaseId}...`, true);
          const delRes = await attemptDeleteOldCopy(stamped);
          if (!delRes.ok) oldWarn = delRes.warning;
        }
      }

      await loadStashCache();
      renderStash();
      setStatus('', false);
      updateCloudUI();
      scheduleGoogleAutoSync();
      if (activeStashItem?.id === id) openStashDetail(id, true);

      if (oldWarn) {
        toast(`⚠️ ${oldWarn}`, 5600);
      } else if (fieldRes.failedCount > 0) {
        toast(`⚠️ Added to Discogs, but ${fieldRes.failedCount} field(s) failed: ${fieldRes.errors[0] || ''}`, 5000);
      } else {
        toast(`✅ Added to Discogs (${getFolderNameById(folderId)}) with grades!`);
      }
    } catch (e) {
      setStatus('', false);
      toast('Failed: ' + e.message, 4500);
    } finally {
      lockKeys.forEach(k => activeDiscogsSaves.delete(k));
      updateStashPushBtnState();
    }
  };

  window.deleteStashItem = async (id) => {
    if (!confirm('Remove from Local Stash?')) return;
    const it = stashCache.find(x => x.id === id);
    await CC.commitLocalMutation({
      deleteStash: { id, sync_id: it?.sync_id || null },
      queueOutbox: Boolean(it?.sync_id)
    });
    closeStashDetail();
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
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
    dl([cols.join(','), ...stashCache.map(it => cols.map(k => c(it[k])).join(','))].join('\n'), `softspot-stash-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  window.exportJSON = () => {
    dl(JSON.stringify({ version: 10, exportedAt: new Date().toISOString(), stash: stashCache, spotifyProfile }), `softspot-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    toast('JSON backup downloaded');
  };

  window.importJSON = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (Array.isArray(data.stash)) {
        for (const item of data.stash) {
          const copy = { ...item };
          delete copy.id;
          if (!copy.sync_id) copy.sync_id = CC.generateSyncId();
          const stamped = CC.stampStashRevision(copy, null);
          await CC.commitLocalMutation({ upsertStash: stamped, queueOutbox: true });
        }
      }
      if (data.spotifyProfile) {
        spotifyProfile = data.spotifyProfile;
        await CC.commitLocalMutation({
          metaPuts: [{ key: 'spotify_profile', value: spotifyProfile }],
          extraOps: [{ type: 'spotify_profile', profile: spotifyProfile }],
          queueOutbox: true
        });
        document.getElementById('cfgTasteDna').value = spotifyProfile.tasteDna || '';
        document.getElementById('cfgSoftSpots').value = spotifyProfile.softSpots || '';
        updateSpotifyUI();
      }
      await loadStashCache(); renderStash();
      updateCloudUI();
      toast('Backup restored!');
    } catch (e) { toast('Invalid JSON: ' + e.message); }
  };

  // ==================== GOOGLE DRIVE V2 CLOUD SYNC UI ====================
  function updateCloudUI(customLabel = '') {
    const hPill = document.getElementById('cloudPill');
    const aPill = document.getElementById('pillCloud');
    const sum = document.getElementById('googleSyncSummary');
    const mismatchBox = document.getElementById('googleAccountMismatchBox');
    const conflictsBox = document.getElementById('googleConflictsBox');
    const btnIn = document.getElementById('btnGoogleSignIn');
    const btnLoad = document.getElementById('btnGoogleLoad');
    const btnSync = document.getElementById('btnGoogleSyncNow');
    const btnOut = document.getElementById('btnGoogleSignOut');

    const signedIn = CC.isGoogleSignedIn();
    const hasClient = Boolean(CC.getGoogleClientId());
    const pending = CC.getPendingCloudChanges();
    const lastLoadStr = cfg.googleLastLoadAt ? new Date(cfg.googleLastLoadAt).toLocaleString() : 'Never';
    const lastSyncStr = cfg.googleLastSyncAt ? new Date(cfg.googleLastSyncAt).toLocaleString() : 'Never';
    const activeEmail = cfg.googleEmail || cfg.googleBoundEmail || '';

    // Account mismatch warning box
    if (mismatchBox) {
      if (cloudAccountMismatch) {
        mismatchBox.classList.remove('hidden');
        mismatchBox.innerHTML = `
          <div>⚠️ <strong>Different Google Account Detected</strong> — local data belongs to <strong>${esc(cloudAccountMismatch.previousEmail)}</strong>, but you signed in as <strong>${esc(cloudAccountMismatch.currentEmail)}</strong>. Automatic uploads are paused to protect your data.</div>
          <div class="inline-actions" style="margin-top:8px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="googleReconnectPreviousAccount()">↩️ Reconnect ${esc(cloudAccountMismatch.previousEmail)}</button>
            <button type="button" class="btn btn-green btn-sm" onclick="googleImportLocalToNewAccount()">📦 Import Local Profile into ${esc(cloudAccountMismatch.currentEmail)}</button>
          </div>
        `;
      } else {
        mismatchBox.classList.add('hidden');
        mismatchBox.innerHTML = '';
      }
    }

    // Active sync conflicts summary in Settings
    if (conflictsBox) {
      const itemsWithConflicts = stashCache.filter(it => Array.isArray(it.conflicts) && it.conflicts.length > 0);
      if (itemsWithConflicts.length > 0) {
        const totalC = itemsWithConflicts.reduce((s, it) => s + it.conflicts.length, 0);
        conflictsBox.classList.remove('hidden');
        conflictsBox.innerHTML = `
          <div>⚠️ <strong>${totalC} competing edit conflict(s) retained for review</strong> across ${itemsWithConflicts.length} Stash item(s). Open an item to compare or restore the competing value:</div>
          <div class="inline-actions" style="margin-top:6px;">
            ${itemsWithConflicts.slice(0, 4).map(it => `<button type="button" class="btn btn-secondary btn-sm" onclick="switchView('stash'); openStashDetail(${it.id})">${esc(it.artist)} — ${esc(it.title)}</button>`).join('')}
          </div>
        `;
      } else {
        conflictsBox.classList.add('hidden');
        conflictsBox.innerHTML = '';
      }
    }

    if (customLabel) {
      if (hPill) { hPill.textContent = customLabel; hPill.className = 'pill warn'; }
      if (aPill) { aPill.textContent = 'Working'; aPill.className = 'pill warn'; }
      return;
    }

    if (signedIn) {
      if (cloudAccountMismatch) {
        if (hPill) { hPill.textContent = '☁️ Account Check'; hPill.className = 'pill warn'; }
        if (aPill) { aPill.textContent = 'Paused'; aPill.className = 'pill warn'; }
        if (sum) sum.textContent = `⚠️ Signed in as ${cfg.googleEmail || 'new account'} · Paused until you reconnect ${cloudAccountMismatch.previousEmail} or import your local profile.`;
      } else if (cloudEmptyAwaitingPublish) {
        if (hPill) { hPill.textContent = '☁️ Ready to Sync'; hPill.className = 'pill warn'; }
        if (aPill) { aPill.textContent = 'Empty Cloud'; aPill.className = 'pill warn'; }
        if (sum) sum.textContent = `✅ Connected as ${activeEmail} · No Soft Spot cloud profile found yet. Tap Sync Now when you're ready to publish your local profile (${stashCache.length} items).`;
      } else {
        if (hPill) {
          hPill.textContent = pending > 0 ? `☁️ Sync (${pending})` : '☁️ Synced';
          hPill.className = pending > 0 ? 'pill warn' : 'pill ok';
        }
        if (aPill) {
          aPill.textContent = pending > 0 ? `${pending} pending` : 'Connected';
          aPill.className = pending > 0 ? 'pill warn' : 'pill ok';
        }
        if (sum) {
          sum.textContent = `✅ Connected as ${activeEmail || 'Google'} · Pending: ${pending} · Last load: ${lastLoadStr} · Last sync: ${lastSyncStr}`;
        }
      }
      if (btnIn) btnIn.classList.add('hidden');
      if (btnLoad) btnLoad.classList.remove('hidden');
      if (btnSync) btnSync.classList.remove('hidden');
      if (btnOut) btnOut.classList.remove('hidden');
    } else if (hasClient) {
      const wasConnected = Boolean(cfg.googleBoundEmail || cfg.googleLastSyncAt || cfg.googleLastLoadAt);
      if (btnIn) {
        btnIn.textContent = wasConnected ? '🔄 Reconnect Google Drive' : '☁️ Connect Google Drive';
        btnIn.classList.remove('hidden');
      }
      if (btnLoad) btnLoad.classList.add('hidden');
      if (btnSync) btnSync.classList.add('hidden');
      if (btnOut) btnOut.classList.add('hidden');

      if (pending > 0) {
        if (hPill) { hPill.textContent = `☁️ Reconnect (${pending})`; hPill.className = 'pill warn'; }
        if (aPill) { aPill.textContent = `Reconnect (${pending})`; aPill.className = 'pill warn'; }
        if (sum) sum.textContent = `Session expired${activeEmail ? ` (${activeEmail})` : ''} · ${pending} local change(s) queued safely offline · Last sync: ${lastSyncStr}. Tap Reconnect Google Drive.`;
      } else if (wasConnected) {
        if (hPill) { hPill.textContent = '☁️ Reconnect'; hPill.className = 'pill warn'; }
        if (aPill) { aPill.textContent = 'Reconnect'; aPill.className = 'pill warn'; }
        if (sum) sum.textContent = `Session expired${activeEmail ? ` (${activeEmail})` : ''} · Last load: ${lastLoadStr} · Last sync: ${lastSyncStr}. Tap Reconnect Google Drive to resume.`;
      } else {
        if (hPill) { hPill.textContent = 'Cloud: Off'; hPill.className = 'pill'; }
        if (aPill) { aPill.textContent = 'Connect'; aPill.className = 'pill'; }
        if (sum) sum.textContent = 'Not connected. Tap Connect Google Drive to sign in and immediately load your cloud profile.';
      }
    } else {
      if (hPill) { hPill.textContent = 'Cloud: Off'; hPill.className = 'pill'; }
      if (aPill) { aPill.textContent = 'Off'; aPill.className = 'pill'; }
      if (sum) sum.textContent = 'Not connected. Open Advanced below to set a Google OAuth Client ID.';
      if (btnIn) btnIn.classList.remove('hidden');
      if (btnLoad) btnLoad.classList.add('hidden');
      if (btnSync) btnSync.classList.add('hidden');
      if (btnOut) btnOut.classList.add('hidden');
    }
  }

  function applySyncedSettingsToUI() {
    document.getElementById('cfgGeminiKey').value = cfg.geminiKey || '';
    document.getElementById('cfgGeminiModel').value = cfg.geminiModel || 'gemini-3.5-flash-lite';
    document.getElementById('cfgAutoPlay').checked = cfg.autoPlayHighlight !== false;
    document.getElementById('cfgAutoDetective').checked = cfg.autoDetective !== false;
    document.getElementById('cfgAutoGradeOnScan').checked = Boolean(cfg.autoGradeOnScan);
    document.getElementById('scanAutoGradeChk').checked = Boolean(cfg.autoGradeOnScan);
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
    populateFolders();
    updateDiscogsCollectionUI();
    updateSpotifyUI();
    refreshNotice();
  }

  window.copyGoogleOrigin = async () => {
    try { await navigator.clipboard.writeText(location.origin); toast('Authorized Origin copied!'); }
    catch (_) { prompt('Copy Authorized JavaScript Origin:', location.origin); }
  };

  window.handleCloudPillClick = () => {
    if (CC.isGoogleSignedIn() && !cloudAccountMismatch) {
      syncGoogleDriveNow();
      return;
    }
    switchView('settings');
    const acc = document.getElementById('accCloud');
    if (acc) acc.open = true;
  };

  function setCloudButtonsDisabled(disabled) {
    ['btnGoogleSignIn', 'btnGoogleLoad', 'btnGoogleSyncNow'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.disabled = disabled;
    });
  }

  async function refreshAllAfterCloudPull(res) {
    if (res?.spotifyProfile) spotifyProfile = res.spotifyProfile;
    else {
      const spRec = await CC.idbGet('meta', 'spotify_profile');
      if (spRec?.value) spotifyProfile = spRec.value;
    }
    if (res?.discogsCollectionIndex) discogsCollectionIndex = res.discogsCollectionIndex;
    else {
      const dcRec = await CC.idbGet('meta', 'discogs_collection_index');
      if (dcRec?.value) discogsCollectionIndex = dcRec.value;
    }
    const q = await CC.getCloudOutbox();
    CC.setPendingCloudChanges(q.length);
    await loadStashCache();
    renderStash();
    applySyncedSettingsToUI();
    if (activeStashItem?.id) openStashDetail(activeStashItem.id, true);
  }

  // Serialized in-tab cloud runner: prevents overlapping runs and schedules follow-up if edits arrive mid-sync
  async function runCloudSerialized(label, fn) {
    if (googleSyncInFlight) {
      cloudFollowupNeeded = true;
      return null;
    }
    googleSyncInFlight = true;
    cloudFollowupNeeded = false;
    setCloudButtonsDisabled(true);
    updateCloudUI(label);
    try {
      return await fn();
    } finally {
      googleSyncInFlight = false;
      setCloudButtonsDisabled(false);
      updateCloudUI();
      if (cloudFollowupNeeded) {
        cloudFollowupNeeded = false;
        scheduleGoogleAutoSync();
      }
    }
  }

  // Single shared pull helper used by BOTH "Connect Google Drive" and "Load from Google Drive" (ZERO Drive writes!)
  async function performSharedGooglePull({ quiet = false } = {}) {
    return runCloudSerialized('☁️ Loading...', async () => {
      try {
        const res = await CC.pullFromGoogleDrive({ quiet, skipAccountBindOnEmpty: true });
        if (res.status === 'account_mismatch') {
          cloudAccountMismatch = { previousEmail: res.previousEmail, currentEmail: res.currentEmail };
          cloudEmptyAwaitingPublish = false;
          if (!quiet) {
            setStatus('', false);
            toast(`⚠️ Signed in as ${res.currentEmail}, but local data belongs to ${res.previousEmail}. Review options in Settings.`, 5200);
          }
          return res;
        }

        cloudAccountMismatch = null;
        if (res.emptyCloud) {
          cloudEmptyAwaitingPublish = Boolean(res.hasLocalData && !cfg.googleBoundEmail);
          await refreshAllAfterCloudPull(res);
          if (!quiet) {
            setStatus('', false);
            toast(res.hasLocalData
              ? `☁️ Connected (${res.email}) — Drive is empty. Tap Sync Now when ready to publish your local profile.`
              : `☁️ Connected (${res.email}) — No cloud profile yet. Scan or sync to get started.`, 4500);
          }
          return res;
        }

        cloudEmptyAwaitingPublish = false;
        await refreshAllAfterCloudPull(res);
        if (!quiet) {
          setStatus('', false);
          if (res.repairSummary) {
            toast(`🧹 ${res.repairSummary}`, 5200);
          } else {
            const photoNote = res.downloadedPhotos ? ` · ↓${res.downloadedPhotos} photo(s)` : '';
            const confNote = res.conflicts?.length ? ` · ⚠️ ${res.conflicts.length} conflict(s) saved for review` : '';
            const errNote = res.partialErrors?.length ? ` · ⚠️ ${res.partialErrors.length} warning(s)` : '';
            toast(`⬇️ Loaded ${res.stashCount} Stash item(s) from ${res.email}${photoNote}${confNote}${errNote}`, 4200);
          }
        }
        return res;
      } catch (err) {
        if (!quiet) {
          setStatus('', false);
          toast('Load from Google Drive failed: ' + (err?.message || 'Error'), 4800);
        }
        return null;
      }
    });
  }

  // 1. Connect Google Drive: sign in -> identify account -> immediately await initial pull in ONE click
  window.googleConnectAndLoad = async () => {
    saveSettings(true);
    try {
      await CC.requestGoogleAccessToken('');
      updateCloudUI();
      await performSharedGooglePull({ quiet: false });
    } catch (err) {
      toast('Connect Google Drive: ' + (err?.message || 'Cancelled'), 4500);
      updateCloudUI();
    }
  };

  // Alias for any legacy callers
  window.googleSignInAndSync = window.googleConnectAndLoad;

  // 2. Load from Google Drive: read-only pull & merge (ZERO Drive writes!)
  window.loadFromGoogleDriveUI = async () => {
    saveSettings(true);
    if (!CC.isGoogleSignedIn()) {
      await googleConnectAndLoad();
      return;
    }
    await performSharedGooglePull({ quiet: false });
  };

  // 3. Sync Now: pull, merge, and upload pending batches & missing photos
  async function runGoogleSyncFlow({ interactive = false, quiet = false, publishInitialLocal = false } = {}) {
    return runCloudSerialized('☁️ Syncing...', async () => {
      try {
        const res = await CC.syncNowWithGoogleDrive({ interactive, quiet, publishInitialLocal });
        if (res.status === 'account_mismatch') {
          cloudAccountMismatch = { previousEmail: res.previousEmail, currentEmail: res.currentEmail };
          if (!quiet) {
            setStatus('', false);
            toast(`⚠️ Account mismatch: local profile belongs to ${res.previousEmail}.`, 5000);
          }
          return res;
        }
        if (res.awaitingExplicitPublish) {
          cloudEmptyAwaitingPublish = true;
          if (!quiet) {
            setStatus('', false);
            toast('Drive is empty — tap Sync Now to publish your local profile.', 4200);
          }
          return res;
        }
        cloudAccountMismatch = null;
        cloudEmptyAwaitingPublish = false;
        await refreshAllAfterCloudPull(res);
        if (res.remainingPending > 0) cloudFollowupNeeded = true;
        if (!quiet) {
          setStatus('', false);
          if (res.repairSummary) {
            toast(`☁️ ${res.repairSummary}`, 5200);
          } else {
            const photoNote = (res.uploadedPhotos || res.downloadedPhotos)
              ? ` · ↑${res.uploadedPhotos} ↓${res.downloadedPhotos} photos`
              : '';
            const confNote = res.conflicts?.length ? ` · ⚠️ ${res.conflicts.length} conflict(s)` : '';
            toast(`☁️ Synced ${res.stashCount} Stash item(s) (↑${res.uploadedBatches} batch${res.uploadedBatches === 1 ? '' : 'es'})${photoNote}${confNote}`, 4000);
          }
        }
        return res;
      } catch (err) {
        if (!quiet) {
          setStatus('', false);
          toast('Google Drive Sync: ' + (err?.message || 'Failed'), 4800);
        }
        return null;
      }
    });
  }

  window.syncGoogleDriveNow = async () => {
    saveSettings(true);
    await runGoogleSyncFlow({ interactive: true, quiet: false, publishInitialLocal: true });
  };

  window.googleReconnectPreviousAccount = async () => {
    const prevEmail = cloudAccountMismatch?.previousEmail || cfg.googleBoundEmail || '';
    try {
      await CC.requestGoogleAccessToken('select_account', prevEmail);
      await performSharedGooglePull({ quiet: false });
    } catch (err) {
      toast('Reconnect cancelled: ' + (err?.message || ''), 4000);
      updateCloudUI();
    }
  };

  window.googleImportLocalToNewAccount = async () => {
    if (!cloudAccountMismatch?.currentEmail) return;
    const targetEmail = cloudAccountMismatch.currentEmail;
    if (!confirm(`Import your existing local Stash (${stashCache.length} items) and Taste Profile into ${targetEmail}? Your local data stays preserved.`)) return;
    cloudAccountMismatch = null;
    cloudEmptyAwaitingPublish = false;
    await CC.queueFullLocalProfileToOutbox(targetEmail);
    updateCloudUI();
    await runGoogleSyncFlow({ interactive: true, quiet: false, publishInitialLocal: true });
  };

  window.googleSignOut = () => {
    CC.signOutGoogle();
    cloudAccountMismatch = null;
    cloudEmptyAwaitingPublish = false;
    updateCloudUI();
    toast('Signed out of Google Drive');
  };

  function scheduleGoogleAutoSync() {
    if (!cfg.googleAutoSync || !CC.isGoogleSignedIn()) return;
    if (cloudAccountMismatch || cloudEmptyAwaitingPublish) return;
    if (!cfg.googleBoundEmail || (cfg.googleEmail && cfg.googleBoundEmail !== cfg.googleEmail)) return;
    if (googleSyncInFlight) {
      cloudFollowupNeeded = true;
      return;
    }
    clearTimeout(googleAutoSyncTimer);
    googleAutoSyncTimer = setTimeout(() => {
      if (cfg.googleAutoSync && CC.isGoogleSignedIn() && !cloudAccountMismatch && !cloudEmptyAwaitingPublish) {
        runGoogleSyncFlow({ interactive: false, quiet: true, publishInitialLocal: false });
      }
    }, 1200);
  }

  // ==================== SETTINGS, DISCOGS COLLECTION SYNC & RESUMABLE SPOTIFY ====================
  function refreshNotice() {
    document.getElementById('setupNotice').classList.toggle('hidden', Boolean(CC.isAiReady() && cfg.discogsToken));
    updateSettingsPills();
  }

  function updateDiscogsCollectionUI() {
    const el = document.getElementById('discogsCollectionSummary');
    if (!el) return;
    if (discogsCollectionIndex && discogsCollectionIndex.totalItems !== undefined) {
      const uniqueAlbums = Object.keys(discogsCollectionIndex.albumKeys || {}).length;
      const folderCnt = getDiscogsFoldersList().length;
      const dt = new Date(discogsCollectionIndex.syncedAt || cfg.discogsLastSyncAt || Date.now()).toLocaleString();
      el.textContent = `✅ Synced ${discogsCollectionIndex.totalItems} cop${discogsCollectionIndex.totalItems === 1 ? 'y' : 'ies'} (${uniqueAlbums} unique albums) · ${folderCnt} folder(s) for @${discogsCollectionIndex.username} · ${dt}`;
    } else {
      el.textContent = 'Not synced yet — updates owned copies, mirrors your Discogs folders in Stash, and enables duplicate alerts.';
    }
  }

  // Single-flight per account Discogs collection & folder reconciliation
  window.syncWithDiscogsUI = async (manual = true, quiet = false) => {
    if (manual) saveSettings(true);
    const account = (cfg.discogsUser || '').trim();
    if (!cfg.discogsToken || !account) {
      if (manual) toast('Verify your Discogs account in Settings first');
      return null;
    }
    if (activeDiscogsRefreshPromise && activeDiscogsRefreshAccount === account) {
      return activeDiscogsRefreshPromise;
    }

    const btns = [document.getElementById('btnSyncDiscogsIndex'), document.getElementById('btnStashSyncDiscogs')].filter(Boolean);
    btns.forEach(b => { b.disabled = true; });

    const run = (async () => {
      try {
        const fullRes = await CC.syncDiscogsCollectionFull({ quiet });
        if ((cfg.discogsUser || '').trim() !== account) {
          throw new Error('Discogs account switched mid-sync — aborted safely');
        }
        const recRes = await CC.reconcileDiscogsCollectionIntoStash(fullRes, { confirmMissingOnline: true });
        discogsCollectionIndex = recRes.collectionIndex;
        populateFolders();
        updateDiscogsCollectionUI();
        await loadStashCache();
        renderStash();
        if (activeStashItem?.id) openStashDetail(activeStashItem.id, true);
        updateCloudUI();
        scheduleGoogleAutoSync();
        if (!quiet) {
          setStatus('', false);
          if (recRes.repairSummary) {
            toast(`📀 ${recRes.repairSummary}`, 5200);
          } else {
            const parts = [];
            if (recRes.addedCount) parts.push(`+${recRes.addedCount} added`);
            if (recRes.movedCount) parts.push(`${recRes.movedCount} moved`);
            if (recRes.removedCount) parts.push(`${recRes.removedCount} removed`);
            if (recRes.ambiguousCount) parts.push(`⚠️ ${recRes.ambiguousCount} link check`);
            const summary = parts.length ? parts.join(' · ') : 'all copies & folders up to date';
            toast(`📀 Discogs synced (${recRes.totalCopies} copies · ${recRes.folders.length} folders): ${summary}`, 4200);
          }
        }
        return recRes;
      } catch (err) {
        if (!quiet) {
          setStatus('', false);
          toast('Sync with Discogs failed: ' + (err?.message || 'Error'), 4800);
        }
        return null;
      } finally {
        if (activeDiscogsRefreshAccount === account) {
          activeDiscogsRefreshPromise = null;
          activeDiscogsRefreshAccount = '';
        }
        btns.forEach(b => { b.disabled = false; });
      }
    })();

    activeDiscogsRefreshAccount = account;
    activeDiscogsRefreshPromise = run;
    return run;
  };

  window.syncDiscogsCollectionUI = () => syncWithDiscogsUI(true, false);

  function maybeAutoRefreshDiscogs() {
    if (!cfg.discogsToken || !cfg.discogsUser) return;
    if (document.visibilityState === 'hidden') return;
    if (activeDiscogsRefreshPromise) return;
    const last = Number(cfg.discogsLastSyncAt || discogsCollectionIndex?.syncedAt || 0);
    if (last && (Date.now() - last) < DISCOGS_FRESH_MS) return;
    syncWithDiscogsUI(false, true);
  }

  window.saveSettings = (silent = false) => {
    cfg.googleClientId = (document.getElementById('cfgGoogleClientId')?.value || '').trim();
    cfg.googleAutoSync = document.getElementById('cfgGoogleAutoSync')?.checked !== false;
    cfg.googleSyncSecrets = Boolean(document.getElementById('cfgGoogleSyncSecrets')?.checked);
    cfg.geminiKey = document.getElementById('cfgGeminiKey').value.trim();
    cfg.geminiModel = document.getElementById('cfgGeminiModel').value;
    cfg.autoPlayHighlight = document.getElementById('cfgAutoPlay').checked;
    cfg.autoDetective = document.getElementById('cfgAutoDetective').checked;
    cfg.autoGradeOnScan = Boolean(document.getElementById('cfgAutoGradeOnScan')?.checked);
    const scanChk = document.getElementById('scanAutoGradeChk');
    if (scanChk) scanChk.checked = cfg.autoGradeOnScan;
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
    CC.persistCfg(true);
    refreshNotice();
    if (!silent) {
      const outPrefs = {
        cfgUpdatedAt: Number(cfg.cfgUpdatedAt || Date.now()),
        geminiModel: cfg.geminiModel,
        autoPlayHighlight: cfg.autoPlayHighlight,
        autoDetective: cfg.autoDetective,
        autoGradeOnScan: cfg.autoGradeOnScan,
        homeCountry: cfg.homeCountry,
        fetchVgSuggestions: cfg.fetchVgSuggestions,
        threshold: cfg.threshold,
        voice: cfg.voice,
        showSpotify: cfg.showSpotify,
        showApple: cfg.showApple,
        showDeezer: cfg.showDeezer,
        showYoutube: cfg.showYoutube
      };
      CC.commitLocalMutation({ extraOps: [{ type: 'prefs', prefs: outPrefs }], queueOutbox: true }).then(() => {
        updateCloudUI();
        scheduleGoogleAutoSync();
      }).catch(() => {});
      toast('Settings saved!');
    }
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
      const prevUser = cfg.discogsUser || '';
      cfg.discogsUser = id.username;
      const fRes = await CC.discogsFetch(`/users/${encodeURIComponent(id.username)}/collection/folders`);
      cfg.discogsFolders = (fRes.folders || []).filter(f => Number(f.id) !== 0);
      if (!cfg.discogsFolders.length) cfg.discogsFolders = [{ id: 1, name: 'Uncategorized' }];

      const fieldsRes = await CC.discogsFetch(`/users/${encodeURIComponent(id.username)}/collection/fields`).catch(() => null);
      if (fieldsRes?.fields?.length) {
        const findId = (rx, def) => (fieldsRes.fields.find(x => rx.test(x.name || ''))?.id) || def;
        cfg.discogsFields = { media: findId(/media/i, 1), sleeve: findId(/sleeve/i, 2), notes: findId(/note/i, 3) };
      }

      if (prevUser && prevUser !== id.username) {
        activeDiscogsFolderFilter = null;
      }

      populateFolders(); CC.persistCfg(); refreshNotice();
      setStatus('', false);
      toast(`✅ Connected as @${id.username}`);

      if (!discogsCollectionIndex || discogsCollectionIndex.username !== id.username) {
        await syncWithDiscogsUI(false, false);
      }
    } catch (err) { setStatus('', false); toast('Discogs verify failed: ' + err.message, 4000); }
  };

  function populateFolders() {
    const sel = document.getElementById('cfgDiscogsFolder');
    const folders = getDiscogsFoldersList();
    sel.innerHTML = folders.map(f => `<option value="${f.id}">${esc(f.name)} (${f.count ?? 0})</option>`).join('');
    sel.value = cfg.discogsFolderId || '1';
    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
    document.getElementById('discogsUserBadge').textContent = cfg.discogsUser ? `Connected: @${cfg.discogsUser}` : '';
  }

  function hasActiveSpotifyCheckpoint() {
    return Boolean(spotifyCheckpoint && spotifyCheckpoint.stage && spotifyCheckpoint.stage !== 'done');
  }

  function ensureSpotifyCooldownTicker() {
    clearInterval(spotifyCooldownTimer);
    spotifyCooldownTimer = null;
    if (CC.getSpotifyCooldownRemainingSec() <= 0) return;
    spotifyCooldownTimer = setInterval(() => {
      updateSpotifyUI();
      if (CC.getSpotifyCooldownRemainingSec() <= 0) {
        clearInterval(spotifyCooldownTimer);
        spotifyCooldownTimer = null;
        updateSpotifyUI();
      }
    }, 1000);
  }

  window.startSpotifyAuth = async (mode = 'liked') => {
    saveSettings(true);
    if (spotifySyncActive || CC.isSpotifySyncRunning()) {
      toast('Spotify sync is already running');
      return;
    }
    const remCd = CC.getSpotifyCooldownRemainingSec();
    if (remCd > 0) {
      updateSpotifyUI();
      toast(`Spotify is cooling down (${remCd}s remaining) — wait before starting or resuming.`, 3800);
      return;
    }
    const syncMode = mode === 'full' ? 'full' : 'liked';
    const modeLabel = syncMode === 'full' ? 'Sync Full Library' : 'Sync Liked Songs';

    // Never accidentally discard saved checkpoint progress on a stray tap!
    if (hasActiveSpotifyCheckpoint()) {
      const prog = CC.formatSpotifyProgress(spotifyCheckpoint);
      const ok = confirm(`You have a saved Spotify sync in progress (${prog}).\n\nDiscard saved progress and start a fresh "${modeLabel}" run?`);
      if (!ok) return;
      await CC.clearSpotifyCheckpoint();
      spotifyCheckpoint = null;
      updateSpotifyUI();
    }

    if (!cfg.spotifyClientId) { toast('Paste Spotify Client ID first'); return; }
    if (!window.crypto?.subtle) { toast('Spotify login requires HTTPS'); return; }
    if (cfg.spotifyRefreshToken && await CC.refreshSpotifyToken()) {
      await runSpotifySyncUI(syncMode, false);
      return;
    }
    await CC.beginSpotifyRedirect(syncMode, { resumeOnReturn: false });
  };

  window.resumeSpotifySyncUI = async () => {
    saveSettings(true);
    if (spotifySyncActive || CC.isSpotifySyncRunning()) {
      toast('Spotify sync is already running');
      return;
    }
    if (!hasActiveSpotifyCheckpoint()) {
      toast('No saved Spotify run to resume');
      return;
    }
    const remCd = CC.getSpotifyCooldownRemainingSec();
    if (remCd > 0) {
      updateSpotifyUI();
      toast(`Spotify cooldown active — ${remCd}s remaining`, 3400);
      return;
    }
    if (!cfg.spotifyClientId) { toast('Paste Spotify Client ID first'); return; }

    // If previous pause was HTTP 401 (expired login), refresh or reconnect and resume the exact same saved run!
    if (spotifyCheckpoint?.lastError?.needsReconnect) {
      if (cfg.spotifyRefreshToken && await CC.refreshSpotifyToken()) {
        await runSpotifySyncUI('resume', true);
        return;
      }
      await CC.beginSpotifyRedirect(spotifyCheckpoint?.mode || 'liked', { resumeOnReturn: true });
      return;
    }

    if (cfg.spotifyRefreshToken && await CC.refreshSpotifyToken()) {
      await runSpotifySyncUI('resume', true);
      return;
    }
    if (cfg.spotifyAccessToken && Date.now() < Number(cfg.spotifyExpiresAt || 0)) {
      await runSpotifySyncUI('resume', true);
      return;
    }
    await CC.beginSpotifyRedirect(spotifyCheckpoint?.mode || 'liked', { resumeOnReturn: true });
  };

  async function runSpotifySyncUI(mode = 'liked', resume = false) {
    if (spotifySyncActive || CC.isSpotifySyncRunning()) return;
    switchView('settings');
    document.getElementById('accMusic').open = true;
    spotifySyncActive = true;
    updateSpotifyUI();
    try {
      const prevDna = spotifyProfile?.tasteDna || document.getElementById('cfgTasteDna').value.trim();
      const prevSoftSpots = spotifyProfile?.softSpots || document.getElementById('cfgSoftSpots').value.trim();
      const res = await CC.syncSpotifyResumable({
        mode,
        resume,
        existingDna: prevDna,
        existingSoftSpots: prevSoftSpots,
        autoCommitProfile: true
      });

      if (res.completed && res.profile) {
        spotifyProfile = res.profile;
        spotifyCheckpoint = null;
        tasteCache.clear();
        document.getElementById('cfgTasteDna').value = spotifyProfile.tasteDna || '';
        document.getElementById('cfgSoftSpots').value = spotifyProfile.softSpots || '';
        setStatus('', false);
        updateCloudUI();
        scheduleGoogleAutoSync();
        const modeTxt = spotifyProfile.syncMode === 'full' ? 'Sync Full Library' : 'Sync Liked Songs';
        const skipped = Array.isArray(res.skippedPlaylists) ? res.skippedPlaylists : [];
        const skipTxt = skipped.length
          ? ` · Skipped ${skipped.length} inaccessible playlist${skipped.length === 1 ? '' : 's'} (${skipped.map(s => s.name).join(', ')})`
          : '';
        toast(`🎧 ${modeTxt} complete: ${spotifyProfile.totalTracks.toLocaleString()} tracks & ${spotifyProfile.totalArtists.toLocaleString()} artists${skipTxt}`, 5200);
        return;
      }

      if (res.paused) {
        // Keep existing completed spotifyProfile, Taste Profile, and Soft Spots completely untouched!
        spotifyCheckpoint = res.checkpoint ? CC.normalizeSpotifyCheckpoint(res.checkpoint) : await CC.getSpotifyCheckpoint();
        setStatus('', false);
        if (res.reason === 'rate_limit') {
          ensureSpotifyCooldownTicker();
          toast(`⏸️ Spotify HTTP 429 during ${res.stageLabel || res.stage || 'sync'} — wait ${res.retryAfterSec || CC.getSpotifyCooldownRemainingSec()}s then tap Resume Spotify Sync.`, 5600);
        } else if (res.reason === 'auth_expired') {
          toast('🔑 Spotify login expired (HTTP 401) — tap Resume Spotify Sync to reconnect and continue where you left off.', 5600);
        } else if (res.reason === 'http_error') {
          toast(`⚠️ Spotify sync paused (HTTP ${res.status || '?'} during ${res.stageLabel || res.stage || 'sync'}). Progress saved — tap Resume Spotify Sync.`, 5600);
        } else if (res.reason !== 'already_running') {
          toast('⏸️ Spotify sync paused with progress saved. Tap Resume Spotify Sync when ready.', 4600);
        }
      }
    } catch (err) {
      setStatus('', false);
      spotifyCheckpoint = await CC.getSpotifyCheckpoint();
      if (err.name !== 'AbortError') toast('Spotify sync error: ' + err.message, 5000);
    } finally {
      spotifySyncActive = false;
      updateSpotifyUI();
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
    await CC.commitLocalMutation({
      metaPuts: [{ key: 'spotify_profile', value: spotifyProfile }],
      extraOps: [{ type: 'spotify_profile', profile: spotifyProfile }],
      queueOutbox: true
    });
    tasteCache.clear(); updateSpotifyUI();
    updateCloudUI();
    scheduleGoogleAutoSync();
    toast(`Merged! Total: ${spotifyProfile.totalTracks} tracks & ${spotifyProfile.totalArtists} artists.`);
  };

  function updateSpotifyUI() {
    const pill = document.getElementById('spotifyPill');
    const sum = document.getElementById('spotifySummary');
    const dnaSum = document.getElementById('dnaSummary');
    const runStatus = document.getElementById('spotifyRunStatus');
    const resBtn = document.getElementById('btnResumeSpotify');
    const resHint = document.getElementById('spotifyResumeHint');
    const btnLiked = document.getElementById('btnSyncSpotifyLiked');
    const btnFull = document.getElementById('btnSyncSpotifyFull');

    // 1. Active completed profile (always labeled separately from any in-progress/paused sync!)
    if (spotifyProfile && spotifyProfile.totalArtists > 0) {
      pill.textContent = `Spotify: ${spotifyProfile.totalArtists} art`;
      pill.className = 'pill ok';
      const pl = spotifyProfile.totalPlaylists ? ` · ${spotifyProfile.totalPlaylists} playlists` : '';
      const modeTag = spotifyProfile.syncMode === 'liked' ? 'Liked Songs' : (spotifyProfile.syncMode === 'full' ? 'Full Library' : 'Library');
      const skipped = Array.isArray(spotifyProfile.skippedPlaylists) && spotifyProfile.skippedPlaylists.length
        ? ` · ${spotifyProfile.skippedPlaylists.length} skipped (${spotifyProfile.skippedPlaylists.map(s => s.name).join(', ')})`
        : '';
      sum.textContent = `Active profile (${spotifyProfile.userDisplayName} · ${modeTag}): ${Number(spotifyProfile.totalTracks || 0).toLocaleString()} tracks · ${Number(spotifyProfile.totalArtists || 0).toLocaleString()} artists${pl}${skipped}`;
    } else {
      pill.textContent = 'Spotify: Off';
      pill.className = 'pill';
      sum.textContent = 'Active profile: Not synced yet (local exact matching disabled).';
    }

    // 2. Current / paused sync status & button states (no checkpoint, running, cooldown, ready to resume, completed)
    const isRunning = Boolean(spotifySyncActive || CC.isSpotifySyncRunning());
    const hasCp = hasActiveSpotifyCheckpoint();
    const cooldownSec = CC.getSpotifyCooldownRemainingSec();

    if (runStatus) {
      if (isRunning) {
        const curProg = hasCp ? CC.formatSpotifyProgress(spotifyCheckpoint) : 'Syncing with Spotify...';
        runStatus.textContent = `⏳ Current sync: ${curProg}`;
        runStatus.className = 'spotify-status-box is-running';
      } else if (hasCp) {
        const modeLbl = spotifyCheckpoint.mode === 'full' ? 'Sync Full Library' : 'Sync Liked Songs';
        const progTxt = CC.formatSpotifyProgress(spotifyCheckpoint);
        runStatus.textContent = `Saved run (${modeLbl}): ${progTxt}`;
        runStatus.className = 'spotify-status-box is-paused';
      } else {
        runStatus.textContent = '';
        runStatus.className = 'spotify-status-box hidden';
      }
    }

    if (btnLiked && btnFull && resBtn && resHint) {
      if (isRunning) {
        btnLiked.disabled = true;
        btnFull.disabled = true;
        resBtn.disabled = true;
        resBtn.className = 'btn btn-secondary btn-sm';
        resBtn.textContent = '⏳ Syncing Spotify...';
        resHint.textContent = 'A Spotify sync is currently running.';
      } else if (hasCp && cooldownSec > 0) {
        btnLiked.disabled = true;
        btnFull.disabled = true;
        btnLiked.className = 'btn btn-secondary btn-sm';
        btnFull.className = 'btn btn-secondary btn-sm';
        resBtn.disabled = true;
        resBtn.className = 'btn btn-secondary btn-sm';
        resBtn.textContent = `⏳ Resume Spotify Sync (${cooldownSec}s)`;
        resHint.textContent = `Spotify rate limit cooldown active — ${cooldownSec}s remaining. Requests are paused until cooldown ends.`;
        ensureSpotifyCooldownTicker();
      } else if (hasCp) {
        // Checkpoint ready to resume: Resume becomes the PRIMARY prominent action; fresh syncs are secondary & confirm-guarded!
        btnLiked.disabled = false;
        btnFull.disabled = false;
        btnLiked.className = 'btn btn-secondary btn-sm';
        btnFull.className = 'btn btn-secondary btn-sm';
        resBtn.disabled = false;
        resBtn.className = 'btn btn-spotify btn-sm';
        resBtn.textContent = spotifyCheckpoint?.lastError?.needsReconnect
          ? '🔑 Reconnect & Resume Spotify Sync'
          : '▶ Resume Spotify Sync';
        resHint.textContent = spotifyCheckpoint?.lastError?.needsReconnect
          ? 'Your Spotify login expired. Reconnect to continue this exact saved run without losing progress.'
          : 'Ready to resume where you left off. Starting a new sync above will ask before discarding saved progress.';
      } else if (cooldownSec > 0) {
        btnLiked.disabled = true;
        btnFull.disabled = true;
        resBtn.disabled = true;
        resBtn.className = 'btn btn-secondary btn-sm';
        resBtn.textContent = `▶ Resume Spotify Sync`;
        resHint.textContent = `Spotify rate limit cooldown: ${cooldownSec}s remaining. No saved run to resume.`;
        ensureSpotifyCooldownTicker();
      } else {
        // No checkpoint & idle
        btnLiked.disabled = false;
        btnFull.disabled = false;
        btnLiked.className = 'btn btn-spotify btn-sm';
        btnFull.className = 'btn btn-secondary btn-sm';
        resBtn.disabled = true;
        resBtn.className = 'btn btn-secondary btn-sm';
        resBtn.textContent = '▶ Resume Spotify Sync';
        resHint.textContent = 'No saved run to resume.';
      }
    }

    const ssTag = spotifyProfile?.softSpots ? ' · Soft Spots active' : '';
    dnaSum.textContent = spotifyProfile?.tasteDna
      ? `✅ Taste Profile active (${spotifyProfile.tasteDna.length} chars)${ssTag}`
      : `Write your Taste Profile above, or tap 🧠 Auto-Draft Profile after syncing Spotify.${ssTag}`;
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
    // Automatically repair any verified duplicate Discogs copies locally on startup (zero Discogs/Drive writes!)
    const startupRepair = await CC.repairLocalDiscogsDuplicates().catch(() => null);
    await loadStashCache();
    if (startupRepair?.repairSummary) {
      setTimeout(() => toast(`🧹 ${startupRepair.repairSummary}`, 5200), 600);
    }

    const spRec = await CC.idbGet('meta', 'spotify_profile');
    if (spRec?.value) spotifyProfile = spRec.value;
    spotifyCheckpoint = await CC.getSpotifyCheckpoint();
    if (CC.getSpotifyCooldownRemainingSec() > 0) ensureSpotifyCooldownTicker();

    const dcRec = await CC.idbGet('meta', 'discogs_collection_index');
    if (dcRec?.value) discogsCollectionIndex = dcRec.value;

    // Sync pending badge from authoritative IndexedDB outbox on startup
    const startupOutbox = await CC.getCloudOutbox();
    CC.setPendingCloudChanges(startupOutbox.length);

    document.getElementById('googleOriginText').textContent = location.origin;
    document.getElementById('cfgGoogleClientId').value = cfg.googleClientId || '';
    document.getElementById('cfgGoogleAutoSync').checked = cfg.googleAutoSync !== false;
    document.getElementById('cfgGoogleSyncSecrets').checked = Boolean(cfg.googleSyncSecrets);
    document.getElementById('cfgGeminiKey').value = cfg.geminiKey || '';
    document.getElementById('cfgGeminiModel').value = cfg.geminiModel || 'gemini-3.5-flash-lite';
    document.getElementById('cfgAutoPlay').checked = cfg.autoPlayHighlight !== false;
    document.getElementById('cfgAutoDetective').checked = cfg.autoDetective !== false;
    document.getElementById('cfgAutoGradeOnScan').checked = Boolean(cfg.autoGradeOnScan);
    document.getElementById('scanAutoGradeChk').checked = Boolean(cfg.autoGradeOnScan);
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

    document.getElementById('gMediaCond').innerHTML = gradeOptionsHtml(MEDIA_GRADES, 'Not Graded');
    document.getElementById('gSleeveCond').innerHTML = gradeOptionsHtml(SLEEVE_GRADES, 'Not Graded');

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
        if (activeStashFilter === 'localonly' || activeStashFilter === 'all') {
          activeDiscogsFolderFilter = null;
        }
        renderStash();
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') maybeAutoRefreshDiscogs();
    });
    window.addEventListener('focus', () => maybeAutoRefreshDiscogs());

    document.getElementById('galleryInput').addEventListener('change', (e) => { stagePhotoFiles(e.target.files); e.target.value = ''; });
    document.getElementById('nativeCamInput').addEventListener('change', (e) => { stagePhotoFiles(e.target.files); e.target.value = ''; });
    document.getElementById('pileGalleryInput').addEventListener('change', (e) => { handlePilePhotos(e.target.files, false); e.target.value = ''; });
    document.getElementById('pileCamInput').addEventListener('change', (e) => { handlePilePhotos(e.target.files, pilePhotos.length > 0 && pilePhotos.length < 4); e.target.value = ''; });

    const p = new URLSearchParams(location.search);
    if (p.get('error')) {
      history.replaceState({ view: 'scan', modal: null }, '', location.pathname);
      toast('Spotify login cancelled');
    } else if (p.get('code')) {
      const code = p.get('code'), state = p.get('state');
      const savedMode = localStorage.getItem('sp_sync_mode') || 'liked';
      const wantResume = localStorage.getItem('sp_resume_on_return') === '1';
      localStorage.removeItem('sp_resume_on_return');
      history.replaceState({ view: 'scan', modal: null }, '', location.pathname);
      setStatus('Connecting Spotify...', true);
      try {
        await CC.exchangeSpotifyCode(code, state);
        const shouldResume = Boolean(hasActiveSpotifyCheckpoint() && (wantResume || spotifyCheckpoint.mode === savedMode));
        await runSpotifySyncUI(shouldResume ? 'resume' : savedMode, shouldResume);
      } catch (e) { setStatus('', false); toast('Spotify error: ' + e.message, 4500); }
    } else {
      try { history.replaceState({ view: 'scan', modal: null }, ''); } catch (_) {}
    }
  }

  init();
})();
