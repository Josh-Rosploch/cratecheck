(() => {
  'use strict';
  const CC = window.CC;
  const { cfg, esc, norm, normFull, similarity, MEDIA_GRADES, SLEEVE_GRADES } = CC;

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
  const VERIFY_BATCH_LIMIT = 15;

  let spotifyProfile = null;
  let stashCache = [];
  let currentView = 'scan';
  let scanMode = 'single';
  let activeFormat = 'Auto';
  let activeStashFilter = 'all';

  let stagedPhotos = []; // [{ apiB64, saveWebp }] (saved at 1200px WebP @ 80%)
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
  let editingStashItem = null; // Non-null when editing/re-checking an existing Stash item

  // Pile Scan state
  let pilePhoto = null; // { apiB64, saveWebp }
  let pileResults = [];

  // Audio + Platform Menu state
  const tasteCache = new Map();
  let activeClipKey = '';
  let activePlatforms = null;
  let activeFallbackClip = null;
  let scanRunId = 0;
  let clipReqId = 0;

  // Camera / UPC / Lightbox / Voice state
  let camStream = null;
  let camUpcRaf = null;
  let camTorchOn = false;
  let barcodeStream = null;
  let barcodeRaf = null;
  let lbPhotos = [];
  let lbIdx = 0;
  let lbTouchX = 0;

  let activeRecognition = null;
  let voiceWantListening = false;
  let voiceTranscriptFinal = '';
  let voiceTranscriptInterim = '';
  let voiceContext = null; // { source, btnId, liveId }
  let pendingVoiceRetry = null;

  // ==================== UI HELPERS & CANCELLABLE STATUS ====================
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
    CC.cancelGemini();
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
    const pG = document.getElementById('pillGemini');
    const pD = document.getElementById('pillDiscogs');
    const pM = document.getElementById('pillMusic');
    const pB = document.getElementById('pillData');

    if (cfg.geminiKey) { pG.textContent = 'Ready'; pG.className = 'pill ok'; }
    else { pG.textContent = 'Setup'; pG.className = 'pill warn'; }

    if (cfg.discogsToken && cfg.discogsUser) { pD.textContent = `@${cfg.discogsUser}`; pD.className = 'pill ok'; }
    else if (cfg.discogsToken) { pD.textContent = 'Verify'; pD.className = 'pill warn'; }
    else { pD.textContent = 'Setup'; pD.className = 'pill warn'; }

    if (spotifyProfile) {
      pM.textContent = spotifyProfile.tasteDna ? `DNA Ready` : `${spotifyProfile.totalArtists} art`;
      pM.className = 'pill ' + (spotifyProfile.tasteDna ? 'ok' : 'warn');
    } else { pM.textContent = 'Off'; pM.className = 'pill'; }

    pB.textContent = `${stashCache.length} items`;
    pB.className = 'pill';
  }

  // ==================== NAVIGATION & ANDROID BACK GESTURE ====================
  function hideStashDetailUI() {
    activeStashItem = null;
    pendingVoiceRetry = null;
    document.getElementById('stashDetailModal').classList.add('hidden');
  }

  function hideBarcodeUI() {
    if (barcodeRaf) cancelAnimationFrame(barcodeRaf);
    barcodeRaf = null;
    if (barcodeStream) { barcodeStream.getTracks().forEach(t => t.stop()); barcodeStream = null; }
    document.getElementById('barcodeVideo').srcObject = null;
    document.getElementById('barcodeModal').classList.add('hidden');
  }

  function hideCameraUI() {
    if (camUpcRaf) cancelAnimationFrame(camUpcRaf);
    camUpcRaf = null;
    camTorchOn = false;
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    document.getElementById('camVideo').srcObject = null;
    document.getElementById('cameraModal').classList.add('hidden');
  }

  function hideLightboxUI() {
    document.getElementById('lightboxModal').classList.add('hidden');
    document.getElementById('lbImg').classList.remove('zoomed');
  }

  function closeOpenInMenu() {
    document.getElementById('openInMenu').classList.add('hidden');
    document.getElementById('audioOpenInBtn').classList.remove('open');
  }

  window.switchView = (name, fromPop = false) => {
    const viewChanged = name !== currentView;
    hideStashDetailUI();
    hideBarcodeUI();
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
    if (st.modal !== 'barcode') hideBarcodeUI();

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

  // ==================== CONTINUOUS 2-SHOT IN-APP CAMERA VIEWFINDER ====================
  function updateCameraOverlayUI() {
    const n = stagedPhotos.length;
    const badge = document.getElementById('camStepBadge');
    if (n === 0) { badge.textContent = 'Shot 1: Front / Side A'; badge.className = 'badge badge-blue'; }
    else if (n === 1) { badge.textContent = 'Shot 2: Flip for Back / Side B'; badge.className = 'badge badge-purple'; }
    else { badge.textContent = `Shot ${n + 1} (Optional · ${n}/4 taken)`; badge.className = 'badge badge-green'; }
    document.getElementById('camCountLbl').textContent = n;
    document.getElementById('camThumbs').innerHTML = stagedPhotos.map(p => `<img src="${p.saveWebp}" />`).join('');
    const upcBadge = document.getElementById('camUpcBadge');
    if (stagedUpc) {
      upcBadge.textContent = `║▌ UPC Locked: ${stagedUpc}`;
      upcBadge.classList.remove('hidden');
    } else upcBadge.classList.add('hidden');
  }

  window.openCameraViewfinder = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      document.getElementById('nativeCamInput').click();
      return;
    }
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('camVideo');
    modal.classList.remove('hidden');
    updateCameraOverlayUI();

    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      video.srcObject = camStream;
      await video.play();
      try { history.pushState({ view: currentView, modal: 'camera' }, ''); } catch (_) {}

      // Show torch button if rear camera supports flash
      const track = camStream.getVideoTracks()[0];
      const caps = track?.getCapabilities ? track.getCapabilities() : {};
      document.getElementById('camTorchBtn').style.visibility = caps.torch ? 'visible' : 'hidden';

      // Passive live UPC barcode reader while framing!
      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128'] });
        let lastCheck = 0;
        const detectLoop = async (ts) => {
          if (!camStream) return;
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
    } catch (err) {
      hideCameraUI();
      toast('In-app camera unavailable — opening phone camera');
      document.getElementById('nativeCamInput').click();
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

  window.captureViewfinderShot = () => {
    if (stagedPhotos.length >= 4) { toast('Max 4 photos reached — tap Finish'); return; }
    const video = document.getElementById('camVideo');
    if (!video.videoWidth) return;

    const flash = document.getElementById('camFlash');
    flash.classList.add('flash');
    setTimeout(() => flash.classList.remove('flash'), 160);

    const apiDataUrl = renderSourceToDataUrl(video, video.videoWidth, video.videoHeight, 1536, 'image/jpeg', 0.85);
    const saveWebp = renderSourceToDataUrl(video, video.videoWidth, video.videoHeight, 1200, 'image/webp', 0.80);
    stagedPhotos.push({ apiB64: apiDataUrl.split(',')[1], saveWebp });
    updateStageUI();
    updateCameraOverlayUI();

    if (stagedPhotos.length === 1) {
      toast('Front / Side A captured! Flip for Back / Side B');
    } else if (stagedPhotos.length === 2) {
      toast('Back / Side B captured! Tap Finish or take another');
    }
  };

  window.closeCameraViewfinder = () => {
    hideCameraUI();
    if (history.state?.modal === 'camera') {
      try { history.back(); } catch (_) {}
    }
  };

  window.fallbackToNativeCam = () => {
    closeCameraViewfinder();
    document.getElementById('nativeCamInput').click();
  };

  function renderSourceToDataUrl(srcEl, w, h, maxDim, mime, quality) {
    let width = w, height = h;
    if (width > maxDim || height > maxDim) {
      if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
      else { width = Math.round(width * (maxDim / height)); height = maxDim; }
    }
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(srcEl, 0, 0, width, height);
    return c.toDataURL(mime, quality);
  }

  function compressImageFile(file, maxDim, mime, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(renderSourceToDataUrl(img, img.width, img.height, maxDim, mime, quality));
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  async function stagePhotoFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setStatus(`Processing ${files.length} photo(s) at 1200px WebP...`, true);
    try {
      for (const file of files) {
        if (stagedPhotos.length >= 4) { toast('Max 4 photos per scan'); break; }
        const apiUrl = await compressImageFile(file, 1536, 'image/jpeg', 0.85);
        const saveWebp = await compressImageFile(file, 1200, 'image/webp', 0.80);
        stagedPhotos.push({ apiB64: apiUrl.split(',')[1], saveWebp });
      }
      updateStageUI();
      setStatus('', false);
      toast(`${stagedPhotos.length} photo(s) ready — tap Search & Verify`);
    } catch (err) {
      setStatus('', false);
      toast('Photo error: ' + err.message);
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

  window.openStagedLightbox = (idx) => {
    openLightbox(stagedPhotos.map(p => p.saveWebp), idx);
  };

  window.toggleManualEntry = () => {
    document.getElementById('extractCard').classList.remove('hidden');
    document.getElementById('extractDetails').open = true;
    if (activeFormat !== 'Auto') document.getElementById('fFormat').value = activeFormat;
    document.getElementById('fDirectId').focus();
  };

  window.openDirectIdEntry = () => {
    const card = document.getElementById('extractCard');
    card.classList.remove('hidden');
    document.getElementById('extractDetails').open = true;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.getElementById('fDirectId').focus(), 250);
  };

  // ==================== CONTINUOUS VOICE RE-GRADE (MANUAL STOP ONLY) ====================
  window.voiceRegrade = (source, btnId) => {
    if (!cfg.geminiKey) { toast('Add your Gemini API Key in Settings first'); return; }
    const btn = document.getElementById(btnId);
    const liveId = source === 'stash' ? 'voiceLiveStash' : 'voiceLiveScan';
    const liveEl = document.getElementById(liveId);

    // If user is currently recording -> MANUAL STOP & RUN RE-GRADE
    if (voiceWantListening && voiceContext?.btnId === btnId) {
      voiceWantListening = false;
      try { activeRecognition?.stop(); } catch (_) {}
      activeRecognition = null;
      const fullMemo = `${voiceTranscriptFinal} ${voiceTranscriptInterim}`.trim();
      if (liveEl) { liveEl.classList.add('hidden'); liveEl.textContent = ''; }
      if (fullMemo) {
        regradeWithAI(source, fullMemo, btnId);
      } else {
        if (btn) { btn.classList.remove('listening'); btn.textContent = VOICE_BTN_IDLE; }
        toast('No speech heard — try again');
      }
      return;
    }

    // If previous re-grade was cancelled/failed on 503, retry with saved memo without re-speaking!
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

      // Android Chrome auto-ends continuous sessions on silence -> seamlessly resume until user taps Stop!
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
    setStatus('Re-grading with Gemini (will auto-retry every 5s if busy)...', true, { cancellable: true });

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
      const res = await CC.callGeminiJSON(parts, 'MEDIUM', { retryLabel: 'Voice Re-Grade' });
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

  // ==================== FLOATING 30s AUDIO MINI-PLAYER (MARQUEE + ▲ OPEN-IN MENU) ====================
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

  audioEl.addEventListener('play', () => {
    if (audioEl.src !== SILENT_WAV) document.getElementById('audioPlayBtn').textContent = '⏸';
  });
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

    // Exact stream found
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
      } else {
        document.getElementById('audioPlayBtn').textContent = '▶';
      }
      return;
    }

    // No exact mix found — NEVER silently substitute a wrong remix! Offer explicit ▶ tap for closest.
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

  // ==================== LIVE UPC BARCODE SCANNER ====================
  window.openBarcodeScanner = async () => {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      toast('Live UPC scanner not supported here — snap a photo of the barcode instead!', 3500);
      openCameraViewfinder();
      return;
    }
    const modal = document.getElementById('barcodeModal');
    const video = document.getElementById('barcodeVideo');
    const hint = document.getElementById('barcodeHint');
    modal.classList.remove('hidden');
    hint.textContent = 'Starting rear camera...';

    try {
      const detector = new BarcodeDetector({ formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128'] });
      barcodeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      video.srcObject = barcodeStream;
      await video.play();
      try { history.pushState({ view: currentView, modal: 'barcode' }, ''); } catch (_) {}
      hint.textContent = 'Center the barcode on the red line...';

      const loop = async () => {
        if (!barcodeStream) return;
        try {
          const codes = await detector.detect(video);
          const code = codes?.[0]?.rawValue?.replace(/\D/g, '') || '';
          if (code.length >= 8) {
            closeBarcodeScanner();
            playChime();
            stagedUpc = code;
            document.getElementById('fBarcode').value = code;
            updateStageUI();
            toast(`║▌ UPC staged: ${code}`);
            return;
          }
        } catch (_) {}
        barcodeRaf = requestAnimationFrame(loop);
      };
      barcodeRaf = requestAnimationFrame(loop);
    } catch (err) {
      hideBarcodeUI();
      toast('Camera error: ' + err.message);
    }
  };

  window.closeBarcodeScanner = () => {
    hideBarcodeUI();
    if (history.state?.modal === 'barcode') {
      try { history.back(); } catch (_) {}
    }
  };

  // ==================== DIRECT DISCOGS URL / ID LOADER ====================
  window.loadReleaseById = async (rawInput) => {
    const id = parseDiscogsId(rawInput);
    if (!id) { toast('Paste a valid Discogs release URL or numeric ID'); return; }
    if (!cfg.discogsToken) { toast('Add your Discogs Token in Settings first'); return; }

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
      await inspectCandidate(existingIdx, scanRunId);
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
      await inspectCandidate(0, scanRunId);
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
      if (!cfg.geminiKey) { toast('Add your Gemini API Key in Settings first'); switchView('settings'); return; }
      const ok = await runGeminiVision(myRunId);
      if (!ok || myRunId !== scanRunId) return;
    }

    await runDiscogsSearch(myRunId);
  };

  async function runGeminiVision(myRunId) {
    const keepOldGrades = Boolean(editingStashItem && !document.getElementById('chkRegradeEdit').checked);
    setStatus(`Inspecting ${stagedPhotos.length} photo(s) with Gemini (${keepOldGrades ? 'OCR only' : 'OCR + strict grading'})...`, true, { cancellable: true });

    const fmtHint = activeFormat === 'Auto' ? 'Auto-detect Cassette, CD, or Vinyl' : `User selected format: ${activeFormat}`;
    const upcHint = stagedUpc ? `User also scanned UPC barcode: ${stagedUpc}.` : '';

    const prompt = `You are a meticulous physical music media OCR, Discogs pressing-ID, and strict Goldmine visual grading expert. Inspect ALL attached photos carefully. ${fmtHint}. ${upcHint}

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
  "raw_catalog_number": "exact record-label catalog code or empty string",
  "cleaned_catalog_variants": ["catalog variations stripping hyphens/spaces/price prefixes"],
  "barcode": "digits only UPC/EAN if visible, else empty string",
  "album_title": "album or release title",
  "artists": ["main artist name(s), or 'Various' if a compilation"],
  "label": "record label name or empty string",
  "year": "4-digit copyright/release year printed, else empty string",
  "country_clues": "country printed (e.g. 'Printed in U.S.A.', 'Turkey') or 'Not visible'",
  "club_edition": "None" | "CRC" | "BMG" | "Unknown",
  "physical_details": "detailed plain-English list of EVERY visible physical pressing identifier (shell color, window markings like 100-50-0 vs 0-50-0, plant codes like SR/AR, paper label vs direct print, barcode presence, promo stamps)",
  "media_defects": ["list every flaw on cassette/disc, or empty array if spotless"],
  "sleeve_defects": ["list every flaw on case/insert, or empty array if spotless"],
  "media_condition": "exact Discogs media grade",
  "sleeve_condition": "exact Discogs sleeve grade",
  "condition_note": "blunt factual seller note listing visible flaws (NEVER say 'mint' unless sealed)",
  "visible_tracks": ["every song title clearly visible on shell/insert"]
}`;

    const parts = [{ text: prompt }, ...stagedPhotos.map(p => ({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }))];

    try {
      const ext = await CC.callGeminiJSON(parts, 'MEDIUM', { retryLabel: 'Photo Vision' });
      if (myRunId !== scanRunId) return false;

      // Preserve existing grades & notes if editing a Stash item and Re-grade is unchecked
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
        ext.country_clues && ext.country_clues !== 'Not visible' ? `Country: ${ext.country_clues}` : '',
        ext.club_edition && ext.club_edition !== 'Unknown' ? `Club: ${ext.club_edition}` : '',
        ext.physical_details ? `Clues: ${ext.physical_details}` : ''
      ].filter(Boolean).join(' · ');
      document.getElementById('detectedCluesLine').textContent = clues;

      document.getElementById('extractCard').classList.remove('hidden');
      document.getElementById('extractDetails').open = false;
      speakText(`${ext.artists?.[0] || ''} ${ext.album_title || ''}`);
      return true;
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast('Gemini error: ' + err.message, 4500);
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

  // Uncapped 100-result Discogs Search (no 6-item cap, no blind 1-item auto-accept!)
  window.runDiscogsSearch = async (myRunId = scanRunId) => {
    if (!cfg.discogsToken) { setStatus('', false); toast('Add your Discogs Token in Settings'); return; }

    const title = document.getElementById('fTitle').value.trim();
    const artist = document.getElementById('fArtist').value.trim();
    const catno = document.getElementById('fCatno').value.trim();
    const barcode = document.getElementById('fBarcode').value.replace(/\D/g, '').trim();
    const format = document.getElementById('fFormat').value;
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
      // Mild tie-breaker for community activity (does NOT bury rare outliers)
      score += Math.min(0.12, Math.log10(have + want + 1) * 0.04);
      return { sim, catMatch, isClub, yearMatch, score };
    };

    try {
      // Run ALL applicable queries without early cutoffs
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

      // Filter out completely unrelated garbage matches locally, keep ALL plausible matches (NO 6-item cap!)
      const allScored = Array.from(pool.values())
        .map(it => ({ ...it, _check: scoreItem(it) }))
        .filter(it => it._check.sim >= 0.25 || it._check.catMatch || it._tier === 'barcode')
        .sort((a, b) => b._check.score - a._check.score);

      // If photo gave an explicit country (e.g. "Printed in U.S.A.") and matches exist in that country, put them first
      currentCandidates = allScored;
      renderCandidates(false);

      if (allScored.length === 0) {
        setStatus('', false);
        showNotFoundOutcome('Discogs returned zero matching releases for this title, artist, barcode, or catalog #.');
        return;
      }

      // Always verify with Zero-Guessing Engine (even for 1 result!) when Gemini is configured
      if (cfg.autoDetective && cfg.geminiKey) {
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
      <button type="button" class="btn btn-secondary btn-sm" onclick="openDirectIdEntry()">🔗 Paste Discogs URL / Edit</button>
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
              ${isPick ? `<span class="badge badge-purple">🎯 Verified Match</span>` : ''}
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

  // ==================== ZERO-GUESSING VERIFICATION ENGINE (UNTRUNCATED + [r=ID] AUTO-FOLLOW + MEDIUM THINKING) ====================
  window.runVariantDetective = async (subsetIds = null, myRunId = scanRunId, offset = 0) => {
    if (!cfg.geminiKey || !currentCandidates.length) return;

    const batch = subsetIds
      ? currentCandidates.filter(c => subsetIds.includes(c.id))
      : currentCandidates.slice(offset, offset + VERIFY_BATCH_LIMIT);

    if (!batch.length) return;
    if (!subsetIds) detectiveInspectedCount = Math.max(detectiveInspectedCount, offset + batch.length);

    setStatus(`🕵️ Fetching full pressing details for ${batch.length} candidate(s)...`, true);

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
          notes: rel.notes || '', // UNTRUNCATED!
          identifiers: (rel.identifiers || []).map(x => `${x.type}${x.description ? ` (${x.description})` : ''}: ${x.value}`), // UNTRUNCATED!
          companies: (rel.companies || []).map(c => `${c.entity_type_name}: ${c.name}`),
          tracklist: tracks, // FULL TRACKLIST FOR VERIFICATION!
          have: rel.community?.have || 0,
          want: rel.community?.want || 0
        });

        // Auto-collect sibling [r=XXXX] links mentioned in pressing notes!
        extractReferencedIds(rel.notes).forEach(refId => {
          if (!fetchedIds.has(refId)) refQueue.push(refId);
        });
      };

      for (let i = 0; i < batch.length; i++) {
        setStatus(`🕵️ Reading full pressing notes (${i + 1}/${batch.length})...`, true);
        const rel = await CC.getReleaseCached(batch[i].id);
        if (myRunId !== scanRunId) return;
        pushReleaseDossier(rel, batch[i].catno);
      }

      // Auto-follow sibling [r=XXXX] pointers so e.g. The Doors #1429179 is NEVER missed!
      const uniqueRefs = Array.from(new Set(refQueue)).filter(id => !fetchedIds.has(id)).slice(0, 8);
      for (let i = 0; i < uniqueRefs.length; i++) {
        setStatus(`🔗 Auto-following sibling pressing #${uniqueRefs[i]} (${i + 1}/${uniqueRefs.length})...`, true);
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

      setStatus(`🕵️ Verifying ${dossiers.length} complete pressing(s) against your photos (zero-guessing)...`, true, { cancellable: true });

      const prompt = `You are a STRICT, ZERO-GUESSING Discogs Verification Engine. Accuracy is everything. NEVER guess or force a match!
Compare the user's photo(s), visible songs, catalog #, barcode, and physical details against ALL ${dossiers.length} complete, untruncated Discogs listings below.

STRICT VERIFICATION RULES:
1. CHECK FOR CONTRADICTIONS FIRST:
   - If the visible songs on the tape DO NOT match a listing's tracklist, that listing is DISQUALIFIED.
   - If the photo clearly shows a specific timing window scale (e.g. "100-50-0") and a listing says "0-50-0" or blank, that listing is DISQUALIFIED!
   - If the photo clearly shows a plant code (e.g. "SR") and a listing says "AR", that listing is DISQUALIFIED!
   - If the photo clearly shows a shell color (white vs clear vs black), country ("Printed in U.S.A." vs Canada/Turkey/Europe), club edition ("CRC"/"BMG" vs retail), or barcode presence/absence that contradicts a listing, DISQUALIFY it.
2. THREE HONEST OUTCOMES:
   - "exact_match": ONLY when ONE listing aligns with ALL visible evidence with ZERO contradictions AND no other remaining listing is equally plausible.
   - "needs_user": When 2+ listings remain plausible without contradiction, OR when a single remaining listing has unverified details not visible in the photos (e.g. missing back cover, hidden shell, club vs retail). Ask ONE crystal-clear, jargon-free question (no "J-card", "matrix", "runout", "IFPI" — use everyday words like "the plastic cassette", "the paper cover", "the little numbers inside the clear middle window of the tape").
   - "not_found": When EVERY listing has clear contradictions (wrong album, wrong songs, wrong window scale/plant code with no matching sibling, or clearly an unlisted regional tape). NEVER force a wrong listing!

Scanned Info: ${JSON.stringify({
  title: document.getElementById('fTitle').value,
  artist: document.getElementById('fArtist').value,
  catno: document.getElementById('fCatno').value,
  barcode: document.getElementById('fBarcode').value,
  year: document.getElementById('fYear').value,
  country_clues: currentExtracted?.country_clues || 'Not visible',
  club_edition: currentExtracted?.club_edition || 'Unknown',
  physical_details: currentExtracted?.physical_details || 'None',
  visible_tracks: currentExtracted?.visible_tracks || []
})}

Complete Untruncated Discogs Candidates (${dossiers.length}):
${JSON.stringify(dossiers)}

Return ONLY valid JSON:
{
  "outcome": "exact_match" | "needs_user" | "not_found",
  "best_release_id": number or null,
  "eliminated_ids": [numbers disqualified by contradictions],
  "reasoning": "1-2 blunt, factual sentences explaining what matched or what specifically contradicted (e.g. 'Photo shows 100-50-0 window + SR code, matching #1429179 and ruling out #37410321 which is 0-50-0').",
  "candidate_diffs": [{ "id": number, "short_diff": "plain-English 6-12 word summary of distinguishing features" }],
  "question": null or {
    "prompt": "Direct, plain-English question to separate the remaining candidates",
    "how_to_check": "Simple 1-sentence instruction telling the user where to look",
    "options": [{ "label": "Clear everyday physical description", "matching_ids": [number] }]
  }
}`;

      const parts = [{ text: prompt }, ...stagedPhotos.map(p => ({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }))];
      const verdict = await CC.callGeminiJSON(parts, 'MEDIUM', { retryLabel: 'Verification' });
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

      renderDetectiveCard(verdict);
      renderCandidates(verdict.outcome === 'needs_user' && (!verdict.question?.options?.length));

      const pickIdx = currentCandidates.findIndex(c => c.id === verdict.best_release_id);
      if (verdict.outcome === 'exact_match' && pickIdx !== -1) {
        await inspectCandidate(pickIdx, myRunId);
      } else {
        setStatus('', false);
        document.getElementById('detectiveCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (err) {
      setStatus('', false);
      if (err.name === 'AbortError') return;
      // HONEST failure — NEVER silently pick candidate #0!
      const card = document.getElementById('detectiveCard');
      card.classList.remove('hidden');
      document.getElementById('detectiveBadge').innerHTML = `<span class="badge badge-yellow" style="margin:0;">⚠️ Verification Stopped</span>`;
      document.getElementById('detectiveReasoning').textContent = `Could not auto-verify (${err.message}). Pick a match manually below or retry verification.`;
      document.getElementById('detectiveQuestionBox').classList.add('hidden');
      document.getElementById('detectiveActions').innerHTML = `
        <button type="button" class="btn btn-purple btn-sm" onclick="runVariantDetective()">🔄 Retry Verification</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="toggleCandidatesPanel()">Pick Manually</button>
      `;
      renderCandidates(true);
    }
  };

  function renderDetectiveCard(verdict) {
    const card = document.getElementById('detectiveCard');
    card.classList.remove('hidden');

    const isExact = verdict.outcome === 'exact_match';
    document.getElementById('detectiveBadge').innerHTML = `<span class="badge ${isExact ? 'badge-green' : 'badge-yellow'}" style="margin:0;">${isExact ? '✅ Exact Match' : '❓ Needs Your Call'}</span>`;
    document.getElementById('detectiveReasoning').textContent = verdict.reasoning || '';

    const qBox = document.getElementById('detectiveQuestionBox');
    if (!isExact && verdict.question?.options?.length) {
      qBox.classList.remove('hidden');
      window._detectiveOptions = verdict.question.options;
      qBox.innerHTML = `
        <div style="font-weight:800; font-size:0.92rem;">${esc(verdict.question.prompt)}</div>
        ${verdict.question.how_to_check ? `<div class="detective-hint">👀 ${esc(verdict.question.how_to_check)}</div>` : ''}
        <div>
          ${window._detectiveOptions.map((opt, i) => `
            <button class="opt-btn" onclick="answerDetective(${i})">${esc(opt.label)}</button>
          `).join('')}
          <button class="opt-btn fallback-opt" onclick="toggleCandidatesPanel()">🔎 None of these / let me inspect all ${currentCandidates.length} listings</button>
        </div>
      `;
    } else {
      qBox.classList.add('hidden');
      qBox.innerHTML = '';
    }

    const rem = currentCandidates.length - detectiveInspectedCount;
    document.getElementById('detectiveActions').innerHTML = `
      ${!isExact ? `<button type="button" class="btn btn-secondary btn-sm" onclick="toggleCandidatesPanel()">View All (${currentCandidates.length})</button>` : ''}
      ${rem > 0 ? `<button type="button" class="btn btn-purple btn-sm" onclick="inspectMoreCandidates()">Check Next ${Math.min(VERIFY_BATCH_LIMIT, rem)}</button>` : ''}
      <button type="button" class="btn btn-secondary btn-sm" onclick="openCameraViewfinder()">📷 Add Photo</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="openDirectIdEntry()">🔗 Paste URL/ID</button>
    `;
  }

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
      await inspectCandidate(currentCandidates.findIndex(c => c.id === ids[0]), scanRunId);
    } else if (ids.length > 1) {
      await runVariantDetective(ids, scanRunId);
    } else renderCandidates(true);
  };

  // ==================== INSPECTOR + FULL-LIBRARY TASTE DNA SCORING ====================
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

  window.inspectCandidate = async (idx, myRunId = scanRunId) => {
    const cand = currentCandidates[idx];
    if (!cand) return;
    setStatus('Loading Discogs price, tracklist & Taste check...', true);

    try {
      const release = await CC.getReleaseCached(cand.id);
      if (myRunId !== scanRunId) return;
      const stats = await CC.discogsFetch(`/marketplace/stats/${cand.id}`).catch(() => ({}));

      let suggestions = null;
      if (cfg.fetchVgSuggestions) {
        try { suggestions = await CC.discogsFetch(`/marketplace/price_suggestions/${cand.id}`); }
        catch (_) { suggestions = null; } // Do NOT silently turn off user's setting!
      }

      const artistName = cleanDiscogsArtist(release.artists) ||
                         (cand.title.includes(' - ') ? cand.title.split(' - ')[0] : '');
      const albumTitle = release.title || (cand.title.includes(' - ') ? cand.title.split(' - ').slice(1).join(' - ') : cand.title);
      const catno = release.labels?.[0]?.catno || cand.catno || document.getElementById('fCatno').value.trim();
      const label = release.labels?.[0]?.name || (Array.isArray(cand.label) ? cand.label[0] : '');
      const format = document.getElementById('fFormat').value;

      const tracklist = (release.tracklist || [])
        .filter(t => t.type_ !== 'heading')
        .map(t => ({ pos: t.position || '', artist: cleanDiscogsArtist(t.artists), title: t.title || '' }));

      const lowestPrice = stats?.lowest_price?.value ?? release.lowest_price ?? null;
      const numForSale = stats?.num_for_sale ?? release.num_for_sale ?? 0;
      const vgPlusPrice = suggestions?.['Very Good Plus (VG+)']?.value ?? null;
      const estPrice = vgPlusPrice ?? lowestPrice;
      const have = release.community?.have ?? 0;
      const want = release.community?.want ?? 0;

      const isHighValue = estPrice !== null && estPrice >= Number(cfg.threshold || 20);
      const isScarce = numForSale === 0 && (want >= 10 || (want > have && want >= 5));

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
        discogs_id: release.id, title: albumTitle, artist: artistName, catno, format,
        year: release.year || cand.year || '', label, country: release.country || cand.country || '',
        genres: [...(release.genres || []), ...(release.styles || [])],
        media_condition: mediaCond, sleeve_condition: sleeveCond, condition_note: condNote,
        lowest_price: lowestPrice, vg_plus_price: vgPlusPrice, est_price: estPrice,
        num_for_sale: numForSale, have, want, is_high_value: isHighValue, is_scarce: isScarce,
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

    const keepOldGrades = Boolean(editingStashItem && !document.getElementById('chkRegradeEdit').checked);
    currentInspected = {
      discogs_id: null, title, artist,
      catno: document.getElementById('fCatno').value.trim(),
      format: document.getElementById('fFormat').value,
      year: document.getElementById('fYear').value.trim(),
      label: document.getElementById('fLabel').value.trim(),
      country: '', genres: [],
      media_condition: keepOldGrades ? editingStashItem.media_condition : normalizeGrade(currentExtracted?.media_condition, MEDIA_GRADES, 'Very Good Plus (VG+)'),
      sleeve_condition: keepOldGrades ? editingStashItem.sleeve_condition : normalizeGrade(currentExtracted?.sleeve_condition, SLEEVE_GRADES, 'Very Good Plus (VG+)'),
      condition_note: keepOldGrades ? (editingStashItem.condition_note || '') : (currentExtracted?.condition_note || ''),
      lowest_price: null, vg_plus_price: null, est_price: null, num_for_sale: null,
      have: 0, want: 0, is_high_value: false, is_scarce: false, tracklist: tracks, pressing_notes: '',
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

  function renderInspector(item, hasDiscogs) {
    document.getElementById('inspectorCard').classList.remove('hidden');
    document.getElementById('inspTitle').textContent = `${item.artist} — ${item.title}`;
    document.getElementById('inspSub').textContent = `${item.format} · ${item.country || '?'} · ${item.year || '?'} · ${item.label || 'Unknown Label'} · ${item.catno || 'No Cat#'}`;
    document.getElementById('inspBadge').innerHTML = hasDiscogs
      ? `<span class="badge badge-blue">#${item.discogs_id}</span>`
      : `<span class="badge badge-yellow">Unlisted</span>`;

    let alerts = '';
    const dup = !editingStashItem && stashCache.find(s => (item.discogs_id && s.discogs_id === item.discogs_id) || (norm(s.artist) === norm(item.artist) && norm(s.title) === norm(item.title)));
    if (dup) alerts += `<div class="alert-box alert-dup">⚠️ Already in your Local Stash (${new Date(dup.created_at).toLocaleDateString()}).</div>`;
    if (editingStashItem && editingStashItem.discogs_id && item.discogs_id && editingStashItem.discogs_id !== item.discogs_id) {
      alerts += `<div class="alert-box alert-dup">🔄 Pressing changed: #${editingStashItem.discogs_id} → #${item.discogs_id}. Saving will swap it on Discogs cleanly!</div>`;
    }
    if (item.is_high_value) alerts += `<div class="alert-box alert-high-value">🔥 HIGH VALUE ($${Number(item.est_price).toFixed(2)}) — SET ASIDE!</div>`;
    if (item.is_scarce) alerts += `<div class="alert-box alert-scarce">💎 SCARCE (0 for sale, ${item.want} want / ${item.have} have) — CHECK SOLD!</div>`;
    document.getElementById('inspAlerts').innerHTML = alerts;

    document.getElementById('mLowest').textContent = item.lowest_price !== null ? `$${Number(item.lowest_price).toFixed(2)}` : 'N/A';
    document.getElementById('mVgPlus').textContent = item.vg_plus_price !== null ? `$${Number(item.vg_plus_price).toFixed(2)}` : '—';
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

    const saveBtn = document.getElementById('btnSaveBoth');
    const saveLocalBtn = document.getElementById('btnSaveLocal');
    saveBtn.disabled = !hasDiscogs || !cfg.discogsToken || !cfg.discogsUser;
    if (editingStashItem) {
      saveBtn.textContent = !hasDiscogs ? 'Not on Discogs (Update Local Below)' : '✅ Update Stash & Sync/Swap Discogs';
      saveLocalBtn.textContent = '💾 Update Local Stash Only';
    } else {
      saveBtn.textContent = !hasDiscogs ? 'Not on Discogs (Use Save Local Only below)'
        : (!cfg.discogsUser ? 'Verify Discogs in Settings to Enable Save' : '✅ Confirm & Add to Discogs + Local Stash');
      saveLocalBtn.textContent = '💾 Save Local Only';
    }

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
    if (localMatch.matchedTracks.length) badges += `<span class="badge badge-green">🎵 ${localMatch.matchedTracks.length} Exact Track(s) in Library</span>`;
    if (!spotifyProfile) badges += `<span class="badge badge-yellow">Spotify not synced yet</span>`;
    else if (!spotifyProfile.tasteDna) badges += `<span class="badge badge-yellow">Tip: Run "Analyze ALL Data" in Settings</span>`;
    document.getElementById('tasteLocalBadges').innerHTML = badges;

    document.getElementById('tasteScore').textContent = '...';
    document.getElementById('tasteBody').textContent = 'Analyzing against your full Spotify Taste DNA...';
    document.getElementById('contextBox').classList.add('hidden');
    document.getElementById('tasteHits').innerHTML = '';
  }

  // ==================== EXACT LOCAL SPOTIFY CHECK (ARTIST + TRACK PAIRS) ====================
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

    (item.tracklist || []).forEach(t => {
      const nt = norm(t.title);
      if (!nt) return;
      const trackArt = t.artist || item.artist || '';
      const artParts = String(trackArt).split(/,|&|\band\b|feat\.?/i).map(norm).filter(Boolean);
      let isHit = false;
      if (pairSet && pairSet.size && artParts.length) {
        isHit = artParts.some(na => pairSet.has(`${na}|${nt}`));
      } else if (nt.length > 2) {
        isHit = titleSet.has(nt);
      }
      if (isHit) matchedTracks.push(t.artist ? `${t.artist} - ${t.title}` : t.title);
    });

    return {
      artistHit: matchedArtists.length > 0,
      matchedArtists,
      matchedTracks,
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
    if (!cfg.geminiKey) {
      document.getElementById('tasteScore').textContent = '—';
      document.getElementById('tasteBody').textContent = 'Add Gemini API Key to enable Taste & Context analysis.';
      return;
    }

    const cacheKey = `${norm(item.artist)}|${norm(item.title)}|v16`;
    if (tasteCache.has(cacheKey)) { applyTasteUI(item, tasteCache.get(cacheKey), myRunId); return; }

    // Full untruncated tracklist!
    const tracksStr = (item.tracklist || []).map(t => t.artist ? `${t.artist} - ${t.title}` : t.title).join('; ');
    const dna = spotifyProfile?.tasteDna || '';
    const fallbackTop = !dna && spotifyProfile ? (spotifyProfile.topArtists || []).slice(0, 200).join(', ') : '';

    const prompt = `Evaluate this physical music release strictly against the user's musical taste profile and provide brief musical/pop-culture context. Speak directly to "you".

Release: "${item.artist} - ${item.title}" (${item.year || '?'}, ${item.format}, Genres: ${(item.genres || []).join(', ') || 'unknown'}).
Full Tracklist: ${tracksStr || 'Unknown'}.
Exact Local Matches Across ALL ${spotifyProfile?.totalTracks || 0} Spotify Tracks / ${spotifyProfile?.totalArtists || 0} Artists:
- Matching Artists in Library: ${item.spotify_matches.details || 'None'}
- Exact Songs Already in Library: ${item.spotify_matches.matchedTracks.join(', ') || 'None'}

User's Complete Spotify Taste DNA:
${dna || (fallbackTop ? `Not yet analyzed into DNA; top artists: ${fallbackTop}` : 'Spotify not synced yet.')}

Verdict rules:
- "KEEP" if score >= 7.
- "LISTEN" if score is 5-6.
- "SELL / SKIP" if score <= 4.

Return ONLY valid JSON:
{
  "score": 1 to 10 integer (honest personal taste match based on Taste DNA & exact library hits),
  "verdict": "KEEP" | "LISTEN" | "SELL / SKIP",
  "summary": "1-2 punchy sentences speaking directly to 'you' explaining why you will or won't enjoy this, referencing specific artists/styles from your Taste DNA.",
  "context_note": "1-2 neutral sentences of useful context: notable album history, why a song on it is widely recognizable in pop culture, or collector context (plain description, no hype). Empty string if obscure/unremarkable.",
  "litmus_track": "exact song title from Full Tracklist (WITHOUT artist prefix) of the single best/most representative track to preview",
  "litmus_artist": "performing artist of litmus_track",
  "notable_songs": [
    { "artist": "performing artist", "title": "exact song title from Tracklist", "reason": "short 6-12 word reason it stands out" }
  ]
}
Include up to 6 genuinely recognizable songs in notable_songs (or empty array if none).`;

    try {
      const res = await CC.callGeminiJSON([{ text: prompt }], null, { retryLabel: 'Taste Check' });
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

  // ==================== FULL SPOTIFY LIBRARY -> TASTE DNA ANALYZER (ALL ARTISTS, ALL TRACKS, ALL PLAYLISTS) ====================
  window.analyzeFullSpotifyDNA = async () => {
    saveSettings(true);
    if (!cfg.geminiKey) { toast('Add your Gemini API Key first'); return; }
    if (!spotifyProfile) { toast('Sync your Spotify library first'); return; }

    const btn = document.getElementById('btnAnalyzeDna');
    btn.disabled = true;

    try {
      const artistsList = Object.values(spotifyProfile.allArtists || {}).sort((a, b) => (b.count || 0) - (a.count || 0));
      const playlistsText = (spotifyProfile.playlistSummaries || []).map(p => `${p.name} (${p.count})`).join(', ') || 'None (re-sync Spotify to capture playlist names)';
      const decadesText = Object.entries(spotifyProfile.decades || {}).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d}: ${c}`).join(', ') || 'N/A';

      // Build compact lossless representation of EVERY single artist & song (ZERO truncation!)
      const lines = artistsList.map(a => {
        const tracks = Array.isArray(a.tracks) && a.tracks.length ? `: ${a.tracks.join(' | ')}` : '';
        return `${a.name} (${a.count || 1})${tracks}`;
      });

      // Fallback if synced on older v1.5 before per-artist tracks were stored
      const hasPerArtistTracks = artistsList.some(a => Array.isArray(a.tracks) && a.tracks.length);
      if (!hasPerArtistTracks && Array.isArray(spotifyProfile.trackTitles) && spotifyProfile.trackTitles.length) {
        lines.push('\nALL TRACK TITLES:\n' + spotifyProfile.trackTitles.join(' | '));
      }

      const fullDump = lines.join('\n');
      const MAX_CHUNK_CHARS = 360000; // ~90k tokens (well under 250k TPM free-tier cap!)
      const chunks = [];
      for (let i = 0; i < fullDump.length; i += MAX_CHUNK_CHARS) {
        chunks.push(fullDump.slice(i, i + MAX_CHUNK_CHARS));
      }

      let finalDna = '';
      if (chunks.length === 1) {
        setStatus(`🧠 Analyzing ALL ${spotifyProfile.totalArtists} artists & ${spotifyProfile.totalTracks} tracks in 1 shot...`, true, { cancellable: true });
        const prompt = `You are a musicologist building a permanent, hyper-accurate "Taste DNA" profile for a physical media collector from 100% of their Spotify library (EVERY artist, EVERY song, and EVERY playlist — nothing skipped).

LIBRARY STATS: ${spotifyProfile.totalArtists} unique artists · ${spotifyProfile.totalTracks} tracks · ${spotifyProfile.totalPlaylists || 0} playlists.
DECADES: ${decadesText}
ALL PLAYLISTS: ${playlistsText}

COMPLETE ARTIST & TRACK LIBRARY:
${chunks[0]}

Write a dense, super-specific ~450-word Taste DNA dossier with these exact sections (plain text, no markdown bloat):
1. CORE OBSESSIONS: Primary genres, sub-genres, bands, and exact sonic traits (guitar tone, synths, vocals, rhythm).
2. SECONDARY & NICHE POCKETS: Smaller but real pockets across the full library (e.g. synthwave, movie/game soundtracks, funk, comedy/novelty, specific deep-cut eras) so we NEVER underrate a cassette that fits a smaller playlist or 1-song artist.
3. ERA & PRODUCTION SWEET SPOTS: Favorite decades and production aesthetics.
4. CLEAR BLIND SPOTS / LIKELY SKIPS: Genres/styles noticeably absent or rare in the library.`;

        finalDna = await CC.callGeminiJSON([{ text: prompt }], 'MEDIUM', { expectJSON: false, retryLabel: 'Taste DNA' });
      } else {
        const partials = [];
        for (let i = 0; i < chunks.length; i++) {
          setStatus(`🧠 Analyzing library chunk ${i + 1}/${chunks.length}...`, true, { cancellable: true });
          const p = `Analyze chunk ${i + 1} of ${chunks.length} of a user's complete Spotify library. List EVERY distinct genre, sub-genre, era, sonic trait, and notable artist pocket present in this chunk (250 words max).\n\n${chunks[i]}`;
          partials.push(await CC.callGeminiJSON([{ text: p }], 'MEDIUM', { expectJSON: false, retryLabel: `Taste DNA (${i + 1}/${chunks.length})` }));
          if (i < chunks.length - 1) await CC.sleep(4000);
        }
        setStatus('🧠 Merging chunks into master Taste DNA...', true, { cancellable: true });
        const mergeP = `Merge these ${partials.length} library chunk analyses + playlists (${playlistsText}) + decades (${decadesText}) into one cohesive ~450-word Taste DNA dossier covering: 1. CORE OBSESSIONS, 2. SECONDARY & NICHE POCKETS, 3. ERA & PRODUCTION SWEET SPOTS, 4. CLEAR BLIND SPOTS / LIKELY SKIPS.\n\n${partials.join('\n\n---\n\n')}`;
        finalDna = await CC.callGeminiJSON([{ text: mergeP }], 'MEDIUM', { expectJSON: false, retryLabel: 'Taste DNA Merge' });
      }

      spotifyProfile.tasteDna = finalDna;
      spotifyProfile.dnaUpdatedAt = Date.now();
      await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
      tasteCache.clear();
      document.getElementById('cfgTasteDna').value = finalDna;
      updateSpotifyUI();
      setStatus('', false);
      toast(`🧠 Taste DNA built from ALL ${spotifyProfile.totalArtists} artists & ${spotifyProfile.totalTracks} tracks!`, 4200);
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast('Taste DNA error: ' + err.message, 4500);
    } finally {
      btn.disabled = false;
    }
  };

  window.saveTasteDnaManual = async () => {
    if (!spotifyProfile) {
      spotifyProfile = { syncedAt: Date.now(), userDisplayName: 'Manual DNA', topArtists: [], allArtists: {}, trackPairs: [], trackTitles: [], playlistSummaries: [], decades: {}, totalTracks: 0, totalArtists: 0, totalPlaylists: 0, tasteDna: '' };
    }
    spotifyProfile.tasteDna = document.getElementById('cfgTasteDna').value.trim();
    spotifyProfile.dnaUpdatedAt = Date.now();
    await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
    tasteCache.clear();
    updateSpotifyUI();
    toast('Taste DNA saved!');
  };

  // ==================== BULK / PILE SCAN MODE ====================
  async function handlePilePhoto(file) {
    if (!file) return;
    setStatus('Loading pile photo...', true);
    try {
      const apiUrl = await compressImageFile(file, 1536, 'image/jpeg', 0.86);
      const saveWebp = await compressImageFile(file, 1200, 'image/webp', 0.80);
      pilePhoto = { apiB64: apiUrl.split(',')[1], saveWebp };
      document.getElementById('pilePreviewImg').src = saveWebp;
      document.getElementById('pilePreviewWrap').classList.remove('hidden');
      document.getElementById('btnRunPileScan').disabled = false;
      document.getElementById('btnClearPile').classList.remove('hidden');
      setStatus('', false);
    } catch (err) {
      setStatus('', false);
      toast('Photo error: ' + err.message);
    }
  }

  window.openPileLightbox = () => { if (pilePhoto?.saveWebp) openLightbox([pilePhoto.saveWebp], 0); };

  window.resetPileScan = () => {
    pilePhoto = null;
    pileResults = [];
    document.getElementById('pilePreviewWrap').classList.add('hidden');
    document.getElementById('pileResultsCard').classList.add('hidden');
    document.getElementById('btnRunPileScan').disabled = true;
    document.getElementById('btnClearPile').classList.add('hidden');
    document.getElementById('pileGalleryInput').value = '';
    document.getElementById('pileCamInput').value = '';
  };

  window.runPileScan = async () => {
    if (!pilePhoto) return;
    if (!cfg.geminiKey) { toast('Add Gemini API Key in Settings first'); switchView('settings'); return; }

    document.getElementById('pileResultsCard').classList.add('hidden');
    setStatus('📚 Step 1/3: Reading every legible spine/cover in the pile...', true, { cancellable: true });

    try {
      const ocrPrompt = `You are inspecting a photo of a crate, shelf, or pile of physical music media (cassettes, CDs, or vinyl).
RULES:
- Extract EVERY item whose title or artist is clearly legible.
- NEVER guess blurry, obscured, or cut-off spines — just count them in "unreadable_count".
Return ONLY valid JSON:
{
  "unreadable_count": number,
  "items": [
    { "artist": "artist name", "title": "album/release title", "format": "Cassette" | "CD" | "Vinyl", "catno": "catalog # if readable else empty string" }
  ]
}`;
      const ocr = await CC.callGeminiJSON(
        [{ text: ocrPrompt }, { inline_data: { mime_type: 'image/jpeg', data: pilePhoto.apiB64 } }],
        'MEDIUM',
        { retryLabel: 'Pile OCR' }
      );

      const items = Array.isArray(ocr.items) ? ocr.items.filter(x => x.title || x.artist) : [];
      if (!items.length) {
        setStatus('', false);
        toast('Could not read any spines clearly — try moving closer with brighter light', 4000);
        return;
      }

      setStatus(`📚 Step 2/3: Batch-scoring ${items.length} item(s) against your Taste DNA...`, true, { cancellable: true });
      const dna = spotifyProfile?.tasteDna || (spotifyProfile?.topArtists || []).slice(0, 150).join(', ') || 'Not synced';
      const tastePrompt = `Batch-score these ${items.length} music releases for a collector based on their Spotify Taste DNA.
User's Taste DNA:
${dna}

Items:
${JSON.stringify(items.map((x, i) => ({ idx: i, artist: x.artist, title: x.title, format: x.format })))}

Return ONLY valid JSON:
{
  "scores": [
    { "idx": number, "score": 1 to 10 integer, "reason": "short 6-12 word reason" }
  ]
}`;
      const tasteBatch = await CC.callGeminiJSON([{ text: tastePrompt }], null, { retryLabel: 'Pile Taste' });
      const scoreMap = new Map((tasteBatch.scores || []).map(s => [s.idx, s]));

      // Step 3: Quick rough Discogs lookup for each readable item
      pileResults = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const sc = scoreMap.get(i) || { score: 5, reason: '' };
        let roughVal = null, roughHave = 0, roughWant = 0, roughId = null;

        if (cfg.discogsToken) {
          setStatus(`📚 Step 3/3: Rough Discogs price check (${i + 1}/${items.length})...`, true);
          try {
            const q = `${it.artist || ''} ${it.title || ''}`.trim();
            const sr = await CC.discogsFetch('/database/search', { type: 'release', q, format: it.format || 'Cassette', per_page: 25 });
            const top = (sr.results || []).sort((a, b) => (b.community?.have || 0) - (a.community?.have || 0))[0];
            if (top) {
              roughId = top.id;
              roughHave = top.community?.have || 0;
              roughWant = top.community?.want || 0;
              const st = await CC.discogsFetch(`/marketplace/stats/${top.id}`).catch(() => ({}));
              roughVal = st?.lowest_price?.value ?? null;
            }
          } catch (_) {}
        }

        const localArtistHit = Boolean(spotifyProfile && it.artist && spotifyProfile.allArtists?.[norm(it.artist)]);
        pileResults.push({
          ...it,
          taste_score: sc.score,
          taste_reason: sc.reason,
          localArtistHit,
          roughVal,
          roughHave,
          roughWant,
          roughId,
          highVal: roughVal !== null && roughVal >= Number(cfg.threshold || 20)
        });
      }

      // Rank pull list: High value first, then Taste score
      pileResults.sort((a, b) => (b.highVal - a.highVal) || ((b.taste_score || 0) - (a.taste_score || 0)) || ((b.roughVal || 0) - (a.roughVal || 0)));

      setStatus('', false);
      document.getElementById('pileCount').textContent = pileResults.length;
      document.getElementById('pileSkippedNote').textContent = ocr.unreadable_count
        ? `Skipped ${ocr.unreadable_count} blurry/unreadable spine(s) (no guessing). Tap any item to jump into full 2-photo verification.`
        : 'All spines read cleanly. Tap any item to jump into full 2-photo verification.';

      document.getElementById('pileResultsList').innerHTML = pileResults.map((r, i) => `
        <div class="pile-item" onclick="jumpFromPileToSingle(${i})">
          <div style="flex:1; min-width:0;">
            <div class="candidate-title">${esc(r.artist || '?')} — ${esc(r.title || '?')}</div>
            <div class="candidate-sub">${esc(r.format || 'Cassette')}${r.catno ? ` · ${esc(r.catno)}` : ''}${r.taste_reason ? ` · ${esc(r.taste_reason)}` : ''}</div>
            <div>
              <span class="badge ${r.taste_score >= 7 ? 'badge-green' : r.taste_score >= 5 ? 'badge-blue' : 'badge-red'}">🎧 ${r.taste_score}/10</span>
              ${r.localArtistHit ? `<span class="badge badge-green">In Spotify</span>` : ''}
              ${r.roughVal !== null ? `<span class="badge ${r.highVal ? 'badge-yellow' : 'badge-blue'}">~$${Number(r.roughVal).toFixed(2)}</span>` : ''}
              ${(r.roughWant > r.roughHave && r.roughWant >= 15) ? `<span class="badge badge-purple">💎 High Want (${r.roughWant})</span>` : ''}
            </div>
          </div>
          <span class="stash-chev">›</span>
        </div>
      `).join('');

      document.getElementById('pileResultsCard').classList.remove('hidden');
      document.getElementById('pileResultsCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast('Pile scan error: ' + err.message, 4500);
    }
  };

  window.jumpFromPileToSingle = (idx) => {
    const it = pileResults[idx];
    if (!it) return;
    setScanMode('single');
    resetScanner();
    document.getElementById('fArtist').value = it.artist || '';
    document.getElementById('fTitle').value = it.title || '';
    document.getElementById('fCatno').value = it.catno || '';
    if (['Cassette', 'CD', 'Vinyl'].includes(it.format)) document.getElementById('fFormat').value = it.format;
    document.getElementById('extractCard').classList.remove('hidden');
    document.getElementById('extractDetails').open = true;
    updateStageUI();
    toast('Loaded into Single Mode — snap Front & Back for exact verification!', 3400);
  };

  // ==================== SAVE / UPDATE (WITH SAFE DISCOGS SWAP ON EDIT) ====================
  window.saveCurrentItem = async (syncToDiscogs) => {
    if (!currentInspected) return;

    const mediaCond = document.getElementById('gMediaCond').value || 'Very Good Plus (VG+)';
    const sleeveCond = document.getElementById('gSleeveCond').value || 'Very Good Plus (VG+)';
    const condNote = document.getElementById('gNotes').value.trim();

    currentInspected.media_condition = mediaCond;
    currentInspected.sleeve_condition = sleeveCond;
    currentInspected.condition_note = condNote;

    const isEditing = Boolean(editingStashItem);
    const oldItem = editingStashItem;
    let synced = isEditing ? Boolean(oldItem.synced_to_discogs) : false;
    let folderId = isEditing ? (oldItem.discogs_folder_id || cfg.discogsFolderId || '1') : (cfg.discogsFolderId || '1');
    let instanceId = isEditing ? (oldItem.discogs_instance_id || null) : null;
    let fieldsSynced = 0;

    if (syncToDiscogs) {
      if (!cfg.discogsToken || !cfg.discogsUser || !currentInspected.discogs_id) {
        toast('Verify Discogs in Settings first');
        return;
      }

      try {
        const sameRelease = isEditing && oldItem.synced_to_discogs && Number(oldItem.discogs_id) === Number(currentInspected.discogs_id);
        const swappedRelease = isEditing && oldItem.synced_to_discogs && oldItem.discogs_id && Number(oldItem.discogs_id) !== Number(currentInspected.discogs_id);

        if (sameRelease) {
          // Update existing Discogs collection instance in place!
          setStatus('Updating grades & notes on your existing Discogs item...', true);
          if (!instanceId) {
            const insts = await CC.findDiscogsInstances(oldItem.discogs_id);
            if (insts.length) { instanceId = insts[0].instance_id; folderId = String(insts[0].folder_id || folderId); }
          }
          if (instanceId) {
            fieldsSynced = await CC.syncDiscogsInstanceFields(folderId, currentInspected.discogs_id, instanceId, mediaCond, sleeveCond, condNote);
          }
          synced = true;
        } else {
          // If editing and the pressing CHANGED -> remove the old wrong release from Discogs first!
          if (swappedRelease) {
            setStatus(`Removing wrong pressing #${oldItem.discogs_id} from Discogs...`, true);
            let oldInst = oldItem.discogs_instance_id;
            let oldFolder = oldItem.discogs_folder_id || '1';
            if (!oldInst) {
              const insts = await CC.findDiscogsInstances(oldItem.discogs_id);
              if (insts.length) { oldInst = insts[0].instance_id; oldFolder = String(insts[0].folder_id || oldFolder); }
            }
            if (oldInst) {
              await CC.deleteDiscogsInstance(oldFolder, oldItem.discogs_id, oldInst).catch(() => {});
            }
          }

          // Add the new verified pressing to Discogs
          folderId = cfg.discogsFolderId || '1';
          setStatus(`Adding verified pressing #${currentInspected.discogs_id} to Discogs...`, true);
          const addRes = await CC.discogsFetch(
            `/users/${encodeURIComponent(cfg.discogsUser)}/collection/folders/${encodeURIComponent(folderId)}/releases/${currentInspected.discogs_id}`,
            {},
            'POST'
          );
          synced = true;
          instanceId = addRes?.instance_id || null;
          if (instanceId) {
            setStatus('Saving Media/Sleeve grade & notes to Discogs...', true);
            fieldsSynced = await CC.syncDiscogsInstanceFields(folderId, currentInspected.discogs_id, instanceId, mediaCond, sleeveCond, condNote);
          }
        }
      } catch (err) {
        setStatus('', false);
        toast('Discogs sync failed: ' + err.message, 4500);
        return;
      }
    }

    // Save ALL staged photos (up to 4) at 1200px WebP — or preserve old photos if user didn't take new ones in edit mode
    const newThumbs = stagedPhotos.map(p => p.saveWebp);
    const finalThumbs = newThumbs.length ? newThumbs : (isEditing ? (oldItem.thumbs || (oldItem.thumb_data_url ? [oldItem.thumb_data_url] : [])) : []);

    const record = {
      ...currentInspected,
      synced_to_discogs: synced,
      discogs_folder_id: synced ? folderId : null,
      discogs_instance_id: instanceId,
      thumbs: finalThumbs,
      thumb_data_url: finalThumbs[0] || currentInspected.discogs_thumb || '',
      created_at: isEditing ? (oldItem.created_at || Date.now()) : Date.now(),
      updated_at: Date.now()
    };
    if (isEditing) record.id = oldItem.id;

    try {
      await CC.idbPut('stash', record);
      await loadStashCache();
      setStatus('', false);
      toast(isEditing
        ? (syncToDiscogs ? '✅ Stash & Discogs updated cleanly!' : '💾 Stash updated!')
        : (synced ? `✅ Saved to Discogs${fieldsSynced ? ' (with grades!)' : ''} & Stash!` : '💾 Saved to Local Stash!'));
      editingStashItem = null;
      document.getElementById('editModeBanner').classList.add('hidden');
      resetScanner();
    } catch (err) {
      setStatus('', false);
      toast('Local save failed: ' + err.message);
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
    document.getElementById('extractCard').classList.remove('hidden');
    document.getElementById('extractDetails').open = false;
    updateStageUI();
    toast('Take new 1200px photos (or tap Search & Verify) to re-check this item!', 3800);
  };

  window.cancelEditMode = () => {
    editingStashItem = null;
    document.getElementById('editModeBanner').classList.add('hidden');
    resetScanner();
  };

  window.resetScanner = () => {
    scanRunId++;
    CC.cancelGemini();
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
    document.getElementById('extractCard').classList.add('hidden');
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

    const totalVal = filtered.reduce((s, it) => s + (Number(it.est_price) || 0), 0);
    document.getElementById('stashStats').textContent = `${filtered.length} items · ~$${totalVal.toFixed(0)}`;

    const list = document.getElementById('stashList');
    if (!filtered.length) { list.innerHTML = `<div class="card"><p>No matching items yet.</p></div>`; return; }

    list.innerHTML = filtered.map(it => {
      const pBadge = it.est_price != null ? `<span class="badge ${it.is_high_value ? 'badge-yellow' : 'badge-blue'}">$${Number(it.est_price).toFixed(2)}</span>` : '';
      const sBadge = it.is_scarce ? `<span class="badge badge-purple">💎 Scarce</span>` : '';
      const tBadge = it.taste_score ? `<span class="badge ${it.taste_score >= 7 ? 'badge-green' : 'badge-blue'}">🎧 ${it.taste_score}/10</span>` : '';
      const gTxt = it.media_condition ? `${shortGrade(it.media_condition)}/${shortGrade(it.sleeve_condition || '')}` : '';
      const gBadge = gTxt ? `<span class="badge" style="background:#0d1017; color:var(--muted);">${esc(gTxt)}</span>` : '';
      const syncB = it.synced_to_discogs ? `<span class="badge badge-green">Discogs</span>` : `<span class="badge badge-yellow">Local</span>`;

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
    if (it.is_high_value) alerts += `<div class="alert-box alert-high-value">🔥 HIGH VALUE ($${Number(it.est_price).toFixed(2)}) — SET ASIDE!</div>`;
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
        <div class="metric-box"><div class="metric-label">Lowest Listed</div><div class="metric-val">${it.lowest_price != null ? `$${Number(it.lowest_price).toFixed(2)}` : 'N/A'}</div></div>
        <div class="metric-box"><div class="metric-label">VG+ Est. Value</div><div class="metric-val">${it.vg_plus_price != null ? `$${Number(it.vg_plus_price).toFixed(2)}` : '—'}</div></div>
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
        if (insts.length) {
          instId = insts[0].instance_id;
          fId = String(insts[0].folder_id || fId);
          it.discogs_instance_id = instId;
          it.discogs_folder_id = fId;
        }
      }
      if (instId) {
        await CC.syncDiscogsInstanceFields(fId, it.discogs_id, instId, it.media_condition, it.sleeve_condition, it.condition_note);
        toast('✅ Updated Stash & Discogs grades!');
      } else {
        toast('💾 Saved locally (could not locate Discogs instance)');
      }
    } else {
      toast('💾 Grade & notes saved!');
    }

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
      const res = await CC.discogsFetch(`/users/${encodeURIComponent(cfg.discogsUser)}/collection/folders/${encodeURIComponent(folderId)}/releases/${it.discogs_id}`, {}, 'POST');
      it.synced_to_discogs = true;
      it.discogs_folder_id = folderId;
      it.discogs_instance_id = res?.instance_id || null;
      if (it.discogs_instance_id) {
        await CC.syncDiscogsInstanceFields(folderId, it.discogs_id, it.discogs_instance_id, it.media_condition, it.sleeve_condition, it.condition_note);
      }
      await CC.idbPut('stash', it);
      await loadStashCache();
      renderStash();
      if (activeStashItem?.id === id) openStashDetail(id, true);
      toast('✅ Added to Discogs with grades!');
    } catch (e) { toast('Failed: ' + e.message); }
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
    const cols = ['artist', 'title', 'format', 'country', 'catno', 'label', 'year', 'media_condition', 'sleeve_condition', 'condition_note', 'est_price', 'lowest_price', 'num_for_sale', 'have', 'want', 'is_high_value', 'is_scarce', 'taste_score', 'taste_verdict', 'synced_to_discogs', 'discogs_url'];
    const c = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    dl([cols.join(','), ...stashCache.map(it => cols.map(k => c(it[k])).join(','))].join('\n'), `cratecheck-stash-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  window.exportJSON = () => {
    dl(JSON.stringify({ version: 6, exportedAt: new Date().toISOString(), stash: stashCache, spotifyProfile }), `cratecheck-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
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
        updateSpotifyUI();
      }
      await loadStashCache(); renderStash();
      toast('Backup restored!');
    } catch (e) { toast('Invalid JSON: ' + e.message); }
  };

  // ==================== SETTINGS & SPOTIFY WIRING ====================
  function refreshNotice() {
    document.getElementById('setupNotice').classList.toggle('hidden', Boolean(cfg.geminiKey && cfg.discogsToken));
    updateSettingsPills();
  }

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

  window.testGeminiKey = async () => {
    saveSettings(true);
    const badge = document.getElementById('geminiStatusBadge');
    if (!cfg.geminiKey) { badge.style.color = 'var(--red)'; badge.textContent = '❌ Paste key first'; return; }
    badge.style.color = 'var(--muted)'; badge.textContent = 'Testing...';
    try {
      await CC.callGeminiJSON([{ text: 'Return ONLY valid JSON: {"ok": true}' }], null, { retryLabel: 'Key Test' });
      badge.style.color = 'var(--green)'; badge.textContent = `✅ Connected (${cfg.geminiModel})`;
      setStatus('', false);
      toast('✅ Gemini key verified!');
    } catch (err) {
      setStatus('', false);
      badge.style.color = 'var(--red)'; badge.textContent = '❌ Error';
      if (err.name !== 'AbortError') toast('Gemini test failed: ' + err.message, 5000);
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
      spotifyProfile = await CC.syncSpotifyAll(spotifyProfile?.tasteDna || '');
      await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
      tasteCache.clear();
      updateSpotifyUI();
      setStatus('', false);
      toast(`🎧 Synced ALL ${spotifyProfile.totalTracks} tracks & ${spotifyProfile.totalArtists} artists! Tap 🧠 Analyze ALL Data.`, 4500);
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
      totalArtists: Object.keys(allArtists).length
    });
    await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
    tasteCache.clear(); updateSpotifyUI();
    toast(`Merged! Total: ${spotifyProfile.totalTracks} tracks & ${spotifyProfile.totalArtists} artists.`);
  };

  function updateSpotifyUI() {
    const pill = document.getElementById('spotifyPill');
    const sum = document.getElementById('spotifySummary');
    const dnaSum = document.getElementById('dnaSummary');
    if (spotifyProfile) {
      pill.textContent = `Spotify: ${spotifyProfile.totalArtists} art`;
      pill.className = 'pill ok';
      const pl = spotifyProfile.totalPlaylists ? ` · ${spotifyProfile.totalPlaylists} playlists` : '';
      sum.textContent = `✅ Synced (${spotifyProfile.userDisplayName}): ${spotifyProfile.totalTracks} tracks · ${spotifyProfile.totalArtists} artists${pl}`;
      dnaSum.textContent = spotifyProfile.tasteDna
        ? `🧠 Taste DNA active (${spotifyProfile.tasteDna.length} chars · updated ${new Date(spotifyProfile.dnaUpdatedAt || Date.now()).toLocaleDateString()})`
        : '⚠️ Taste DNA not generated yet — tap "🧠 Analyze ALL Data" above!';
    } else {
      pill.textContent = 'Spotify: Off'; pill.className = 'pill';
      sum.textContent = 'Not synced yet.'; dnaSum.textContent = '';
    }
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
    document.getElementById('redirectUriText').textContent = CC.REDIRECT_URI;

    document.getElementById('gMediaCond').innerHTML = gradeOptionsHtml(MEDIA_GRADES, 'Very Good Plus (VG+)');
    document.getElementById('gSleeveCond').innerHTML = gradeOptionsHtml(SLEEVE_GRADES, 'Very Good Plus (VG+)');

    populateFolders();
    updateSpotifyUI();
    refreshNotice();
    updateStageUI();

    document.querySelectorAll('#scanModeSeg .mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setScanMode(btn.dataset.mode));
    });

    document.querySelectorAll('#formatSeg .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#formatSeg .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFormat = btn.dataset.fmt;
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