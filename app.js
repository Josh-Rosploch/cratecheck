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
  const VOICE_BTN_IDLE = '🎤 AI Voice Re-Grade';
  const VERIFY_INITIAL_LIMIT = 15;
  const VERIFY_DEEP_BATCH = 25;
  const PENDING_DISCOGS_KEY = 'cratecheck_pending_discogs_v1';
  const STASH_SORT_KEY = 'cratecheck_stash_sort_v1';
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
  let activeOtherFormat = '';
  let activeStashFilter = 'all';
  let activeStashOtherFormat = '';
  let activeDiscogsFolderFilter = null;
  let activeStashView = 'list';
  let activeStashSort = (() => {
    try { return localStorage.getItem(STASH_SORT_KEY) || 'newest'; } catch (_) { return 'newest'; }
  })();
  let frankenState = null;
  let rebuildWorkflowActive = false;
  let rebuildWorkflowCancelled = false;
  let lastQuietFocusPullAt = 0;
  const hydratingStashIds = new Set();
  const autoHydrateAttemptedIds = new Set();
  let googleSyncInFlight = false;
  let googleAutoSyncTimer = null;
  let cloudFollowupNeeded = false;
  let cloudAccountMismatch = null;
  let cloudEmptyAwaitingPublish = false;
  let activeDiscogsRefreshPromise = null;
  let activeDiscogsRefreshAccount = '';
  const DISCOGS_FRESH_MS = 5 * 60 * 1000;

  let stagedPhotos = [];
  let stagedSlots = { front: null, back: null, spine: null, extras: [] };
  let stagedSpineThumbUrl = '';
  let stagedSpineSourceUrl = '';
  let stagedSpineFlipped = false;
  let stashPhotoManagerOpen = false;
  let stashAddPhotoMenuOpen = false;
  let stagedUpc = '';
  let camIgnoredUpc = '';
  let camIgnoredUpcMisses = 0;
  let camOpenSeq = 0;
  let inspectSeq = 0;
  let stageSeq = 0;
  let batchAutoCropCancelled = false;
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
    if (!el.querySelector('.banner-text')) {
      el.innerHTML = `
        <div class="spinner"></div>
        <div class="banner-text" style="flex:1; font-size:0.84rem;"></div>
        <button type="button" class="btn btn-danger btn-sm banner-cancel hidden" style="min-height:32px; padding:4px 10px;" onclick="cancelActiveAI()">✕ Cancel</button>
      `;
    }
    const textEl = el.querySelector('.banner-text');
    const cancelBtn = el.querySelector('.banner-cancel');
    if (textEl) textEl.textContent = text;
    if (cancelBtn) cancelBtn.classList.toggle('hidden', !cancellable);
    el.classList.add('show');
  }

  function setStatus(text, show = true, opts = {}) {
    const cancellable = Boolean(opts?.cancellable);
    const isShowing = Boolean(show);
    renderBanner(document.getElementById('globalStatusBanner'), text, isShowing, cancellable);
    document.body.classList.toggle('has-status', isShowing);
  }

  function syncStagedPhotosCompat() {
    const arr = [];
    if (stagedSlots.front) arr.push(stagedSlots.front);
    if (stagedSlots.back) arr.push(stagedSlots.back);
    if (stagedSlots.spine) arr.push(stagedSlots.spine);
    if (Array.isArray(stagedSlots.extras)) {
      stagedSlots.extras.forEach(p => { if (p) arr.push(p); });
    }
    stagedPhotos = arr;
    return arr;
  }

  function getStagedSlotEntries() {
    const out = [];
    if (stagedSlots.front) out.push({ slotKey: 'front', extraIdx: -1, label: 'FRONT', tag: '[Front]', photo: stagedSlots.front });
    if (stagedSlots.back) out.push({ slotKey: 'back', extraIdx: -1, label: 'BACK', tag: '[Back]', photo: stagedSlots.back });
    if (stagedSlots.spine) out.push({ slotKey: 'spine', extraIdx: -1, label: 'SPINE', tag: '[Spine]', photo: stagedSlots.spine });
    (stagedSlots.extras || []).forEach((p, i) => {
      if (p) out.push({ slotKey: 'extra', extraIdx: i, label: i === 0 ? 'EXTRA' : `EXTRA ${i + 1}`, tag: `[Extra ${i + 1}]`, photo: p });
    });
    return out;
  }

  function getStagedPhotoCount() {
    return (stagedSlots.front ? 1 : 0) + (stagedSlots.back ? 1 : 0) + (stagedSlots.spine ? 1 : 0) + (stagedSlots.extras || []).filter(Boolean).length;
  }

  function assignPhotoToFirstEmptySlot(pair) {
    if (!stagedSlots.front) { stagedSlots.front = pair; syncStagedPhotosCompat(); return { slotKey: 'front', extraIdx: -1 }; }
    if (!stagedSlots.back) { stagedSlots.back = pair; syncStagedPhotosCompat(); return { slotKey: 'back', extraIdx: -1 }; }
    if (!stagedSlots.spine) { stagedSlots.spine = pair; syncStagedPhotosCompat(); return { slotKey: 'spine', extraIdx: -1 }; }
    stagedSlots.extras.push(pair);
    const eIdx = stagedSlots.extras.length - 1;
    syncStagedPhotosCompat();
    return { slotKey: 'extra', extraIdx: eIdx };
  }

  function getStagedSlotPhoto(slotKey, extraIdx = -1) {
    if (slotKey === 'front') return stagedSlots.front;
    if (slotKey === 'back') return stagedSlots.back;
    if (slotKey === 'spine') return stagedSlots.spine;
    if (slotKey === 'extra') return (stagedSlots.extras || [])[extraIdx] || null;
    return null;
  }

  function isOwnedByActiveDiscogsAccount(itemOrAccount) {
    const curAcct = String(cfg.discogsUser || '').trim().toLowerCase();
    const rawOwner = typeof itemOrAccount === 'string'
      ? itemOrAccount
      : (itemOrAccount?.discogs_account ?? itemOrAccount?.account ?? '');
    const ownerAcct = String(rawOwner || '').trim().toLowerCase();
    if (!ownerAcct) return true;
    if (!curAcct) return false;
    return ownerAcct === curAcct;
  }

  function isUnresolvedDriveRef(src) {
    return String(src || '').trim().startsWith('gdrive:');
  }

  function renderPhotoImgOrPlaceholder(src, cls = '', extraAttrs = '') {
    const s = String(src || '').trim();
    if (isUnresolvedDriveRef(s)) {
      return `<div class="photo-unresolved-ph ${cls}" title="Photo stored on Google Drive — tap Sync with Cloud to download"><span>☁️</span><span>Sync Drive</span></div>`;
    }
    return `<img ${cls ? `class="${cls}" ` : ''}src="${esc(s)}" ${extraAttrs} />`;
  }

  window.cancelActiveAI = () => {
    deepSearchCancelled = true;
    recalibratingStash = false;
    batchAutoCropCancelled = true;
    CC.cancelAI();
    CC.cancelSpotifySync();
    CC.cancelDiscogsEnrich();
    setStatus('', false);
    toast('Cancelled');
  };

  function getEffectiveScanFormat() {
    if (activeFormat === 'Other') return activeOtherFormat || 'Other';
    return activeFormat || 'Auto';
  }

  function setSelectFormatValue(selectId, fmt) {
    const sel = document.getElementById(selectId);
    const val = String(fmt || '').trim();
    if (!sel || !val || val === 'Auto' || val === 'Other' || val === 'Unknown') return;
    let found = Array.from(sel.options).some(o => o.value === val);
    if (!found) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      sel.appendChild(opt);
    }
    sel.value = val;
  }

  window.onOtherFormatChange = (val) => {
    activeOtherFormat = String(val || '').trim();
    if (activeOtherFormat) setSelectFormatValue('fFormat', activeOtherFormat);
    const otherBtn = document.querySelector('#formatSeg .seg-btn[data-fmt="Other"]');
    if (otherBtn) {
      otherBtn.textContent = activeOtherFormat ? `${activeOtherFormat.split(/[\s-]/)[0]} ▾` : 'Other ▾';
    }
  };

  window.onStashOtherFormatChange = (val) => {
    activeStashOtherFormat = String(val || '').trim();
    renderStash();
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
    camOpenSeq++;
    if (camUpcRaf) cancelAnimationFrame(camUpcRaf);
    camUpcRaf = null;
    camIgnoredUpc = '';
    camIgnoredUpcMisses = 0;
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
    resetLightboxTransform();
  }

  function hideCropModalUI() {
    document.getElementById('cropModal')?.classList.add('hidden');
    cropState.active = false;
    cropState.onApply = null;
  }

  window.closeOpenInMenu = () => {
    document.getElementById('openInMenu').classList.add('hidden');
    document.getElementById('audioOpenInBtn').classList.remove('open');
  };

  window.switchView = (name, fromPop = false) => {
    const viewChanged = name !== currentView;
    if (rebuildWorkflowActive && !fromPop && viewChanged) {
      toast('Rebuild in progress — tap Cancel to stop', 2600);
      return;
    }
    hideStashDetailUI();
    hideManualModalUI();
    hidePileFsUI();
    hideCameraUI();
    hideLightboxUI();
    hideCropModalUI();
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
      } else {
        renderStashAlphaRail(null, false);
      }
      if (name === 'settings') {
        updateSettingsDirtyButtons();
        updateRebuildWorkflowBtn();
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  window.addEventListener('popstate', (e) => {
    const st = e.state || { view: 'scan', modal: null };
    if (st.modal !== 'lightbox') hideLightboxUI();
    if (st.modal !== 'crop') hideCropModalUI();
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
    const addMenu = document.getElementById('sdAddSlotMenu');
    if (addMenu && !addMenu.classList.contains('hidden') && !addMenu.contains(e.target)) {
      stashAddPhotoMenuOpen = false;
      addMenu.classList.add('hidden');
    }
  });

  // ==================== MANUAL SEARCH & DIRECT DISCOGS ID MODAL ====================
  window.openManualModal = (focusTarget = 'search') => {
    const effFmt = getEffectiveScanFormat();
    if (effFmt !== 'Auto' && effFmt !== 'Other') setSelectFormatValue('fFormat', effFmt);
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

  // ==================== FULLSCREEN ZOOMABLE / PANNABLE PHOTO LIGHTBOX ====================
  const lbZoomState = {
    scale: 1,
    tx: 0,
    ty: 0,
    pointers: new Map(),
    panStartX: 0,
    panStartY: 0,
    panOriginTx: 0,
    panOriginTy: 0,
    pinchStartDist: 0,
    pinchStartScale: 1,
    pinchMidX: 0,
    pinchMidY: 0,
    pinchOriginTx: 0,
    pinchOriginTy: 0,
    hadMultiTouch: false,
    swipeStartX: 0,
    swipeMoved: false,
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0
  };

  function applyLightboxTransform() {
    const img = document.getElementById('lbImg');
    const wrap = document.getElementById('lbImgWrap');
    const zoomBtn = document.getElementById('lbZoomBtn');
    if (!img || !wrap) return;

    lbZoomState.scale = Math.max(1, Math.min(6, lbZoomState.scale));
    if (lbZoomState.scale <= 1.01) {
      lbZoomState.scale = 1;
      lbZoomState.tx = 0;
      lbZoomState.ty = 0;
    } else {
      const rect = wrap.getBoundingClientRect();
      const maxTx = Math.max(80, ((img.clientWidth || rect.width) * lbZoomState.scale - rect.width) / 2 + 80);
      const maxTy = Math.max(80, ((img.clientHeight || rect.height) * lbZoomState.scale - rect.height) / 2 + 80);
      lbZoomState.tx = Math.max(-maxTx, Math.min(maxTx, lbZoomState.tx));
      lbZoomState.ty = Math.max(-maxTy, Math.min(maxTy, lbZoomState.ty));
    }

    img.style.transform = `translate3d(${lbZoomState.tx.toFixed(1)}px, ${lbZoomState.ty.toFixed(1)}px, 0) scale(${lbZoomState.scale.toFixed(3)})`;
    wrap.classList.toggle('is-zoomed', lbZoomState.scale > 1.01);
    if (zoomBtn) {
      zoomBtn.textContent = lbZoomState.scale > 1.01 ? `🔎 ${lbZoomState.scale.toFixed(1)}x` : '🔍 Zoom';
    }
  }

  function resetLightboxTransform() {
    lbZoomState.scale = 1;
    lbZoomState.tx = 0;
    lbZoomState.ty = 0;
    lbZoomState.pointers.clear();
    lbZoomState.hadMultiTouch = false;
    document.getElementById('lbImgWrap')?.classList.remove('is-panning', 'is-zoomed');
    applyLightboxTransform();
  }

  function zoomLightboxTowardPoint(nextScale, clientX, clientY) {
    const wrap = document.getElementById('lbImgWrap');
    if (!wrap) return;
    const clamped = Math.max(1, Math.min(6, nextScale));
    const prevScale = lbZoomState.scale;
    if (Math.abs(clamped - prevScale) < 0.001) return;
    if (clamped <= 1.01) {
      lbZoomState.scale = 1;
      lbZoomState.tx = 0;
      lbZoomState.ty = 0;
      applyLightboxTransform();
      return;
    }
    const r = wrap.getBoundingClientRect();
    const rx = clientX - (r.left + r.width / 2);
    const ry = clientY - (r.top + r.height / 2);
    const ratio = clamped / prevScale;
    lbZoomState.tx = rx - ratio * (rx - lbZoomState.tx);
    lbZoomState.ty = ry - ratio * (ry - lbZoomState.ty);
    lbZoomState.scale = clamped;
    applyLightboxTransform();
  }

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
    resetLightboxTransform();
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
    if (lbZoomState.scale > 1.05) {
      resetLightboxTransform();
    } else {
      lbZoomState.scale = 2.5;
      lbZoomState.tx = 0;
      lbZoomState.ty = 0;
      applyLightboxTransform();
    }
  };

  window.closeLightbox = () => {
    hideLightboxUI();
    if (history.state?.modal === 'lightbox') {
      try { history.back(); } catch (_) {}
    }
  };

  (function bindLightboxInteractions() {
    const wrap = document.getElementById('lbImgWrap');
    if (!wrap) return;

    // Smooth mouse scroll-wheel zoom (1x to 6x toward cursor)
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.22 : (1 / 1.22);
      zoomLightboxTowardPoint(lbZoomState.scale * factor, e.clientX, e.clientY);
    }, { passive: false });

    // Double-click desktop toggle 1x <-> 2.5x toward cursor
    wrap.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (lbZoomState.scale > 1.05) resetLightboxTransform();
      else zoomLightboxTowardPoint(2.5, e.clientX, e.clientY);
    });

    const beginPinch = () => {
      const pts = Array.from(lbZoomState.pointers.values());
      if (pts.length < 2) return;
      const r = wrap.getBoundingClientRect();
      lbZoomState.pinchStartDist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      lbZoomState.pinchStartScale = lbZoomState.scale;
      lbZoomState.pinchMidX = (pts[0].x + pts[1].x) / 2 - (r.left + r.width / 2);
      lbZoomState.pinchMidY = (pts[0].y + pts[1].y) / 2 - (r.top + r.height / 2);
      lbZoomState.pinchOriginTx = lbZoomState.tx;
      lbZoomState.pinchOriginTy = lbZoomState.ty;
      lbZoomState.hadMultiTouch = true;
    };

    wrap.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      wrap.setPointerCapture(e.pointerId);
      lbZoomState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (lbZoomState.pointers.size === 1) {
        lbZoomState.hadMultiTouch = false;
        lbZoomState.swipeMoved = false;
        lbZoomState.swipeStartX = e.clientX;
        lbZoomState.panStartX = e.clientX;
        lbZoomState.panStartY = e.clientY;
        lbZoomState.panOriginTx = lbZoomState.tx;
        lbZoomState.panOriginTy = lbZoomState.ty;
        if (lbZoomState.scale > 1.01) wrap.classList.add('is-panning');
      } else if (lbZoomState.pointers.size === 2) {
        wrap.classList.remove('is-panning');
        beginPinch();
      }
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!lbZoomState.pointers.has(e.pointerId)) return;
      lbZoomState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (lbZoomState.pointers.size >= 2) {
        const pts = Array.from(lbZoomState.pointers.values());
        const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
        const nextScale = Math.max(1, Math.min(6, lbZoomState.pinchStartScale * (dist / lbZoomState.pinchStartDist)));
        const r = wrap.getBoundingClientRect();
        const curMidX = (pts[0].x + pts[1].x) / 2 - (r.left + r.width / 2);
        const curMidY = (pts[0].y + pts[1].y) / 2 - (r.top + r.height / 2);
        const ratio = nextScale / Math.max(0.01, lbZoomState.pinchStartScale);
        lbZoomState.scale = nextScale;
        lbZoomState.tx = curMidX - ratio * (lbZoomState.pinchMidX - lbZoomState.pinchOriginTx);
        lbZoomState.ty = curMidY - ratio * (lbZoomState.pinchMidY - lbZoomState.pinchOriginTy);
        applyLightboxTransform();
      } else if (lbZoomState.pointers.size === 1) {
        const dx = e.clientX - lbZoomState.panStartX;
        const dy = e.clientY - lbZoomState.panStartY;
        if (Math.hypot(dx, dy) > 8) lbZoomState.swipeMoved = true;
        if (lbZoomState.scale > 1.01) {
          lbZoomState.tx = lbZoomState.panOriginTx + dx;
          lbZoomState.ty = lbZoomState.panOriginTy + dy;
          applyLightboxTransform();
        }
      }
    });

    const releasePtr = (e, isUp) => {
      if (!lbZoomState.pointers.has(e.pointerId)) return;
      const wasSingle = lbZoomState.pointers.size === 1 && !lbZoomState.hadMultiTouch;
      lbZoomState.pointers.delete(e.pointerId);
      wrap.classList.remove('is-panning');
      if (lbZoomState.pointers.size === 1) {
        const rem = Array.from(lbZoomState.pointers.values())[0];
        lbZoomState.panStartX = rem.x;
        lbZoomState.panStartY = rem.y;
        lbZoomState.panOriginTx = lbZoomState.tx;
        lbZoomState.panOriginTy = lbZoomState.ty;
      } else if (lbZoomState.pointers.size === 0 && isUp && wasSingle) {
        const dx = e.clientX - lbZoomState.swipeStartX;
        if (lbZoomState.scale <= 1.01 && Math.abs(dx) > 55) {
          stepLightbox(dx < 0 ? 1 : -1);
          return;
        }
        // Touch double-tap toggle 1x <-> 2.5x
        if (e.pointerType === 'touch' && !lbZoomState.swipeMoved) {
          const now = Date.now();
          if (now - lbZoomState.lastTapAt < 320 && Math.hypot(e.clientX - lbZoomState.lastTapX, e.clientY - lbZoomState.lastTapY) < 42) {
            lbZoomState.lastTapAt = 0;
            if (lbZoomState.scale > 1.05) resetLightboxTransform();
            else zoomLightboxTowardPoint(2.5, e.clientX, e.clientY);
          } else {
            lbZoomState.lastTapAt = now;
            lbZoomState.lastTapX = e.clientX;
            lbZoomState.lastTapY = e.clientY;
          }
        }
      }
    };

    wrap.addEventListener('pointerup', (e) => releasePtr(e, true));
    wrap.addEventListener('pointercancel', (e) => releasePtr(e, false));
  })();

  // ==================== INTERACTIVE MONOCHROME CROP & 90° ROTATE MODAL ====================
  const cropState = {
    active: false,
    mode: 'cover', // 'cover' | 'spine'
    srcCanvas: null,
    rect: { x: 0.04, y: 0.04, w: 0.92, h: 0.92 },
    dragMode: null, // 'move' | 'nw' | 'ne' | 'sw' | 'se'
    dragStartX: 0,
    dragStartY: 0,
    dragStartRect: null,
    displayW: 1,
    displayH: 1,
    onApply: null
  };

  function defaultCropRectForMode(mode) {
    if (mode === 'spine') return { x: 0.04, y: 0.28, w: 0.92, h: 0.44 };
    return { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };
  }

  function renderCropCanvas() {
    if (!cropState.active || !cropState.srcCanvas) return;
    const stage = document.getElementById('cropStage');
    const canvas = document.getElementById('cropCanvas');
    if (!stage || !canvas) return;

    const src = cropState.srcCanvas;
    const sw = src.width || 1;
    const sh = src.height || 1;
    const maxW = Math.max(180, stage.clientWidth - 24);
    const maxH = Math.max(180, stage.clientHeight - 24);
    const scale = Math.min(maxW / sw, maxH / sh);
    const dispW = Math.max(1, Math.round(sw * scale));
    const dispH = Math.max(1, Math.round(sh * scale));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    cropState.displayW = dispW;
    cropState.displayH = dispH;
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
    canvas.width = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(src, 0, 0, dispW, dispH);

    const r = cropState.rect;
    const rx = r.x * dispW;
    const ry = r.y * dispH;
    const rw = r.w * dispW;
    const rh = r.h * dispH;

    // Dark scrim outside selection
    ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
    ctx.fillRect(0, 0, dispW, ry);
    ctx.fillRect(0, ry + rh, dispW, dispH - (ry + rh));
    ctx.fillRect(0, ry, rx, rh);
    ctx.fillRect(rx + rw, ry, dispW - (rx + rw), rh);

    // Subtle rule-of-thirds guides
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rx + rw / 3, ry); ctx.lineTo(rx + rw / 3, ry + rh);
    ctx.moveTo(rx + (2 * rw) / 3, ry); ctx.lineTo(rx + (2 * rw) / 3, ry + rh);
    ctx.moveTo(rx, ry + rh / 3); ctx.lineTo(rx + rw, ry + rh / 3);
    ctx.moveTo(rx, ry + (2 * rh) / 3); ctx.lineTo(rx + rw, ry + (2 * rh) / 3);
    ctx.stroke();

    // Crisp 0px selection box
    ctx.strokeStyle = '#f3f3f3';
    ctx.lineWidth = 2;
    ctx.strokeRect(rx + 1, ry + 1, Math.max(1, rw - 2), Math.max(1, rh - 2));

    // Sharp square corner handles
    const hs = 14;
    const corners = [
      [rx, ry],
      [rx + rw - hs, ry],
      [rx, ry + rh - hs],
      [rx + rw - hs, ry + rh - hs]
    ];
    corners.forEach(([cx, cy]) => {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cx, cy, hs, hs);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(cx + 4, cy + 4, hs - 8, hs - 8);
    });
  }

  function initCropPointerEvents() {
    const canvas = document.getElementById('cropCanvas');
    if (!canvas || canvas._cropBound) return;
    canvas._cropBound = true;

    const getLocalPt = (e) => {
      const b = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(b.width, e.clientX - b.left)),
        y: Math.max(0, Math.min(b.height, e.clientY - b.top)),
        w: Math.max(1, b.width),
        h: Math.max(1, b.height)
      };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!cropState.active) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const pt = getLocalPt(e);
      const r = cropState.rect;
      const rx = r.x * pt.w, ry = r.y * pt.h, rw = r.w * pt.w, rh = r.h * pt.h;
      const hit = 28;

      if (Math.hypot(pt.x - rx, pt.y - ry) <= hit) cropState.dragMode = 'nw';
      else if (Math.hypot(pt.x - (rx + rw), pt.y - ry) <= hit) cropState.dragMode = 'ne';
      else if (Math.hypot(pt.x - rx, pt.y - (ry + rh)) <= hit) cropState.dragMode = 'sw';
      else if (Math.hypot(pt.x - (rx + rw), pt.y - (ry + rh)) <= hit) cropState.dragMode = 'se';
      else if (pt.x >= rx && pt.x <= rx + rw && pt.y >= ry && pt.y <= ry + rh) cropState.dragMode = 'move';
      else cropState.dragMode = null;

      cropState.dragStartX = pt.x / pt.w;
      cropState.dragStartY = pt.y / pt.h;
      cropState.dragStartRect = { ...r };
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!cropState.active || !cropState.dragMode || !cropState.dragStartRect) return;
      e.preventDefault();
      const pt = getLocalPt(e);
      const nx = pt.x / pt.w;
      const ny = pt.y / pt.h;
      const dx = nx - cropState.dragStartX;
      const dy = ny - cropState.dragStartY;
      const s = cropState.dragStartRect;
      const minSize = 0.08;
      let { x, y, w, h } = s;

      if (cropState.dragMode === 'move') {
        x = Math.max(0, Math.min(1 - w, s.x + dx));
        y = Math.max(0, Math.min(1 - h, s.y + dy));
      } else if (cropState.dragMode === 'nw') {
        const right = s.x + s.w;
        const bottom = s.y + s.h;
        x = Math.max(0, Math.min(right - minSize, s.x + dx));
        y = Math.max(0, Math.min(bottom - minSize, s.y + dy));
        w = right - x;
        h = bottom - y;
      } else if (cropState.dragMode === 'ne') {
        const bottom = s.y + s.h;
        const right = Math.min(1, Math.max(s.x + minSize, s.x + s.w + dx));
        y = Math.max(0, Math.min(bottom - minSize, s.y + dy));
        w = right - x;
        h = bottom - y;
      } else if (cropState.dragMode === 'sw') {
        const right = s.x + s.w;
        x = Math.max(0, Math.min(right - minSize, s.x + dx));
        const bottom = Math.min(1, Math.max(s.y + minSize, s.y + s.h + dy));
        w = right - x;
        h = bottom - y;
      } else if (cropState.dragMode === 'se') {
        const right = Math.min(1, Math.max(s.x + minSize, s.x + s.w + dx));
        const bottom = Math.min(1, Math.max(s.y + minSize, s.y + s.h + dy));
        w = right - x;
        h = bottom - y;
      }
      cropState.rect = { x, y, w, h };
      renderCropCanvas();
    });

    const endDrag = () => { cropState.dragMode = null; cropState.dragStartRect = null; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', () => { if (cropState.active) renderCropCanvas(); });
  }

  function getPhotoQualitySpec(mode = cfg.photoQuality) {
    const key = String(mode || 'medium').toLowerCase();
    if (key === 'low') return { key: 'low', label: 'Low (800px)', maxEdge: 800, spineMaxW: 800, quality: 0.78, raw: false };
    if (key === 'high') return { key: 'high', label: 'High (1600px)', maxEdge: 1600, spineMaxW: 1200, quality: 0.86, raw: false };
    if (key === 'very_high') return { key: 'very_high', label: 'Very High (2400px)', maxEdge: 2400, spineMaxW: 1600, quality: 0.90, raw: false };
    if (key === 'raw') return { key: 'raw', label: 'Raw (Original)', maxEdge: null, spineMaxW: null, quality: 0.95, raw: true };
    return { key: 'medium', label: 'Medium (1200px)', maxEdge: 1200, spineMaxW: 960, quality: 0.84, raw: false };
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read file'));
        reader.readAsDataURL(blob);
      } catch (err) {
        reject(err);
      }
    });
  }

  function box2dToNormRect(box2d, padFrac = 0.025, minBoxSpan = 25) {
    if (!Array.isArray(box2d) || box2d.length !== 4) return null;
    const nums = box2d.map(Number);
    if (!nums.every(Number.isFinite)) return null;
    const isUnit = Math.max(...nums) > 0 && Math.max(...nums) <= 1.01;
    let [y1, x1, y2, x2] = nums.map(v => Math.max(0, Math.min(1000, isUnit ? v * 1000 : v)));
    if (y1 > y2) [y1, y2] = [y2, y1];
    if (x1 > x2) [x1, x2] = [x2, x1];
    const bw = x2 - x1;
    const bh = y2 - y1;
    if (bw < minBoxSpan || bh < minBoxSpan) return null;
    if (padFrac > 0) {
      const padX = Math.max(6, bw * padFrac);
      const padY = Math.max(6, bh * padFrac);
      x1 = Math.max(0, x1 - padX);
      x2 = Math.min(1000, x2 + padX);
      y1 = Math.max(0, y1 - padY);
      y2 = Math.min(1000, y2 + padY);
    }
    return {
      x: Math.max(0, Math.min(0.95, x1 / 1000)),
      y: Math.max(0, Math.min(0.95, y1 / 1000)),
      w: Math.max(0.05, Math.min(1, (x2 - x1) / 1000)),
      h: Math.max(0.05, Math.min(1, (y2 - y1) / 1000))
    };
  }

  function normRectToBox2d(rect) {
    if (!rect || typeof rect !== 'object') return null;
    const x1 = Math.max(0, Math.min(1000, Math.round((Number(rect.x) || 0) * 1000)));
    const y1 = Math.max(0, Math.min(1000, Math.round((Number(rect.y) || 0) * 1000)));
    const x2 = Math.max(x1 + 10, Math.min(1000, Math.round(((Number(rect.x) || 0) + (Number(rect.w) || 1)) * 1000)));
    const y2 = Math.max(y1 + 10, Math.min(1000, Math.round(((Number(rect.y) || 0) + (Number(rect.h) || 1)) * 1000)));
    return [y1, x1, y2, x2];
  }

  function rotateBox2dClockwise(box2d, rotDeg) {
    const r = ((Number(rotDeg) % 360) + 360) % 360;
    if (!Array.isArray(box2d) || box2d.length !== 4 || r === 0) return box2d;
    let [y1, x1, y2, x2] = box2d.map(Number);
    if (r === 90) return [x1, 1000 - y2, x2, 1000 - y1];
    if (r === 180) return [1000 - y2, 1000 - x2, 1000 - y1, 1000 - x1];
    if (r === 270) return [1000 - x2, y1, 1000 - x1, y2];
    return box2d;
  }

  function renderDataUrlToCompactJpegB64(dataUrl, maxDim = 1280, quality = 0.82) {
    return new Promise((resolve) => {
      if (!dataUrl) { resolve(''); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const nw = img.naturalWidth || img.width;
          const nh = img.naturalHeight || img.height;
          if (!nw || !nh) { resolve(''); return; }
          const out = renderSourceToDataUrl(img, nw, nh, maxDim, 'image/jpeg', quality);
          resolve(out.split(',')[1] || '');
        } catch (_) {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = dataUrl;
    });
  }

  function shouldApplyCropBox(box2d) {
    if (!Array.isArray(box2d) || box2d.length !== 4) return false;
    const nums = box2d.map(Number);
    if (!nums.every(Number.isFinite)) return false;
    const isUnit = Math.max(...nums) > 0 && Math.max(...nums) <= 1.01;
    let [y1, x1, y2, x2] = nums.map(v => Math.max(0, Math.min(1000, isUnit ? v * 1000 : v)));
    if (y1 > y2) [y1, y2] = [y2, y1];
    if (x1 > x2) [x1, x2] = [x2, x1];
    const w = x2 - x1;
    const h = y2 - y1;
    // Skip canvas cropping ONLY if returned box already covers >= 96% of BOTH width and height!
    if (w >= 960 && h >= 960) return false;
    return true;
  }

  function applyDetectedRolesToStagedSlots(entriesWithRoles) {
    if (!Array.isArray(entriesWithRoles) || !entriesWithRoles.length) return false;
    const validRoles = new Set(['front', 'back', 'spine', 'extra']);
    const hasAnyValid = entriesWithRoles.some(x => x?.photo && validRoles.has(String(x.role || '').toLowerCase()));
    if (!hasAnyValid) return false;

    const next = { front: null, back: null, spine: null, extras: [] };
    const overflow = [];

    for (const item of entriesWithRoles) {
      if (!item?.photo) continue;
      const role = String(item.role || '').toLowerCase();
      if (role === 'front' && !next.front) next.front = item.photo;
      else if (role === 'back' && !next.back) next.back = item.photo;
      else if (role === 'spine' && !next.spine) next.spine = item.photo;
      else overflow.push(item.photo);
    }
    overflow.forEach(p => { next.extras.push(p); });

    const changed = next.front !== stagedSlots.front ||
      next.back !== stagedSlots.back ||
      next.spine !== stagedSlots.spine ||
      JSON.stringify(next.extras.map(p => p.saveWebp)) !== JSON.stringify((stagedSlots.extras || []).map(p => p?.saveWebp));

    if (changed) {
      stagedSlots = next;
      syncStagedPhotosCompat();
      if (stagedSlots.spine) {
        stagedSpineSourceUrl = stagedSlots.spine.origDataUrl || stagedSlots.spine.saveWebp;
        stagedSpineThumbUrl = stagedSlots.spine.saveWebp;
        stagedSpineFlipped = Number(stagedSlots.spine.rotationDeg || 0) === 180;
      } else {
        stagedSpineSourceUrl = '';
        stagedSpineThumbUrl = '';
        stagedSpineFlipped = false;
      }
    }
    return changed;
  }

  // Shared Gemini Vision auto-crop + role detection helper (MEDIUM thinking, always requires tight box_2d & letter-top spine orientation)
  async function autoCropImageWithGemini(dataUrl, slot = 'auto') {
    if (!dataUrl || !CC.isAiReady()) return { box_2d: null, spine_rotation: 0, role: null, error: '' };
    const b64 = await renderDataUrlToCompactJpegB64(dataUrl, 1280, 0.84);
    if (!b64) return { box_2d: null, spine_rotation: 0, role: null, error: '' };

    const isForcedSpine = slot === 'spine';
    const isAutoRole = slot === 'auto';
    const prompt = isForcedSpine
      ? `Inspect this photo of a physical music media SPINE (cassette, CD, vinyl, VHS, 8-track, etc.).
ALWAYS return a tight [ymin, xmin, ymax, xmax] bounding box on a 0-1000 scale tightly framing the physical spine (even if it already fills most of the frame — NEVER return null).
ORIENTATION RULE (CRITICAL): Look closely at which direction the TOPS of the printed letters on the spine face:
- Letter tops face TOP of image -> "spine_rotation": 0
- Letter tops face BOTTOM of image (upside-down!) -> "spine_rotation": 180
- Letter tops face LEFT of image -> "spine_rotation": 90
- Letter tops face RIGHT of image -> "spine_rotation": 270
Return ONLY valid JSON:
{
  "role": "spine",
  "box_2d": [ymin, xmin, ymax, xmax],
  "spine_rotation": 0 | 90 | 180 | 270
}`
      : `Inspect this photo of physical music media (cassette, CD, vinyl, VHS, 8-track, etc.).
1. Identify the photo's "role" from what is visually shown (do NOT assume any order):
   - "front": front cover artwork, front of case/jacket, or Side A with front cover
   - "back": back cover tracklist/barcode, back of case/jacket, or Side B
   - "spine": close-up focused on the narrow side edge/spine
   - "extra": inner sleeve, disc/label close-up, insert, lyric sheet, or other detail
2. ALWAYS return "box_2d": [ymin, xmin, ymax, xmax] on a 0-1000 scale tightly framing the physical media/case/sleeve/spine to remove dead table, background, and hand whitespace (even if already tightly framed — NEVER return null!).
3. If "role" is "spine", determine "spine_rotation" by checking which direction the TOPS of the printed letters face: top -> 0, bottom (upside-down) -> 180, left -> 90, right -> 270. Otherwise return 0.
Return ONLY valid JSON:
{
  "role": "front" | "back" | "spine" | "extra",
  "box_2d": [ymin, xmin, ymax, xmax],
  "spine_rotation": 0 | 90 | 180 | 270
}`;

    try {
      const res = await CC.callAI(
        [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }],
        'MEDIUM',
        { retryLabel: 'Auto-Crop' }
      );
      const rawRole = String(res?.role || '').trim().toLowerCase();
      const detectedRole = ['front', 'back', 'spine', 'extra'].includes(rawRole) ? rawRole : (isForcedSpine ? 'spine' : (isAutoRole ? null : slot));
      const treatAsSpine = isForcedSpine || detectedRole === 'spine';
      const rawBox = Array.isArray(res?.box_2d) && res.box_2d.length === 4 ? res.box_2d.map(Number) : null;
      const validBox = (rawBox && rawBox.every(Number.isFinite)) ? rawBox : null;
      const minSpan = treatAsSpine ? 25 : 120;
      let cleanBox = null;
      if (validBox) {
        const isUnit = Math.max(...validBox) > 0 && Math.max(...validBox) <= 1.01;
        let [y1, x1, y2, x2] = validBox.map(v => Math.max(0, Math.min(1000, isUnit ? v * 1000 : v)));
        if (y1 > y2) [y1, y2] = [y2, y1];
        if (x1 > x2) [x1, x2] = [x2, x1];
        if ((x2 - x1) >= minSpan && (y2 - y1) >= minSpan) {
          cleanBox = [Math.round(y1), Math.round(x1), Math.round(y2), Math.round(x2)];
        }
      }
      const rotRaw = Number(res?.spine_rotation);
      const spineRotation = [0, 90, 180, 270].includes(rotRaw) ? rotRaw : 0;
      return { box_2d: cleanBox, spine_rotation: treatAsSpine ? spineRotation : 0, role: detectedRole, error: '' };
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      return { box_2d: null, spine_rotation: 0, role: null, error: err?.message || 'Auto-crop unavailable' };
    }
  }

  function rotateCanvasByDeg(srcCanvas, deg) {
    const normDeg = ((Number(deg) % 360) + 360) % 360;
    if (!srcCanvas || normDeg === 0) return srcCanvas;
    const swap = normDeg === 90 || normDeg === 270;
    const next = document.createElement('canvas');
    next.width = swap ? srcCanvas.height : srcCanvas.width;
    next.height = swap ? srcCanvas.width : srcCanvas.height;
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(next.width / 2, next.height / 2);
    ctx.rotate((normDeg * Math.PI) / 180);
    ctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
    return next;
  }

  function openCropModal({ dataUrl, title = '✂️ Crop & Rotate', mode = 'cover', initialRect = null, initialRotation = 0, onApply }) {
    if (!dataUrl) return;
    initCropPointerEvents();
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      if (!nw || !nh) { toast('Could not load photo for cropping'); return; }
      // Preview canvas capped for smooth UI; actual applyCropModal slices from full-res origImg directly!
      const { width, height } = fitDims(nw, nh, 1800);
      let c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const initRot = ((Number(initialRotation) % 360) + 360) % 360;
      if (initRot) c = rotateCanvasByDeg(c, initRot);

      cropState.active = true;
      cropState.mode = mode === 'spine' ? 'spine' : 'cover';
      cropState.srcCanvas = c;
      cropState.origImg = img;
      cropState.origDataUrl = dataUrl;
      cropState.rotationDeg = initRot;
      cropState.rotatedInModal = Boolean(initRot);
      if (initialRect && typeof initialRect === 'object' && Number(initialRect.w) >= 0.05 && Number(initialRect.h) >= 0.05) {
        cropState.rect = {
          x: Math.max(0, Math.min(0.95, Number(initialRect.x) || 0)),
          y: Math.max(0, Math.min(0.95, Number(initialRect.y) || 0)),
          w: Math.max(0.05, Math.min(1, Number(initialRect.w) || 1)),
          h: Math.max(0.05, Math.min(1, Number(initialRect.h) || 1))
        };
      } else {
        cropState.rect = defaultCropRectForMode(cropState.mode);
      }
      cropState.dragMode = null;
      cropState.onApply = onApply || null;

      document.getElementById('cropTitle').textContent = title;
      document.getElementById('cropHint').textContent = cropState.mode === 'spine'
        ? 'Frame the spine tightly · Tap ✨ Auto-Crop or ↻ Rotate 90°'
        : 'Drag inside to move · Drag corners to resize · Tap Full Frame to uncrop';
      const autoBtn = document.getElementById('btnCropAuto');
      if (autoBtn) {
        autoBtn.disabled = false;
        autoBtn.textContent = '✨ Auto-Crop';
      }
      document.getElementById('cropModal').classList.remove('hidden');
      try { history.pushState({ view: currentView, modal: 'crop', itemId: activeStashItem?.id || null }, ''); } catch (_) {}
      requestAnimationFrame(() => renderCropCanvas());
    };
    img.onerror = () => toast('Could not decode photo for cropping');
    img.src = dataUrl;
  }

  window.setCropFullFrame = () => {
    if (!cropState.active) return;
    cropState.rect = { x: 0, y: 0, w: 1, h: 1 };
    renderCropCanvas();
  };

  window.autoCropModalNow = async () => {
    if (!cropState.active || !cropState.srcCanvas) return;
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); return; }
    const btn = document.getElementById('btnCropAuto');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Framing...'; }
    try {
      const snapUrl = canvasToDataUrl(cropState.srcCanvas, 'image/jpeg', 0.85);
      const res = await autoCropImageWithGemini(snapUrl, cropState.mode);
      if (!cropState.active) return;
      let box = res.box_2d;
      if (cropState.mode === 'spine' && res.spine_rotation) {
        cropState.srcCanvas = rotateCanvasByDeg(cropState.srcCanvas, res.spine_rotation);
        cropState.rotationDeg = ((Number(cropState.rotationDeg) || 0) + res.spine_rotation) % 360;
        cropState.rotatedInModal = true;
        if (box) box = rotateBox2dClockwise(box, res.spine_rotation);
      }
      const nextRect = box ? box2dToNormRect(box, 0.025, cropState.mode === 'spine' ? 25 : 150) : null;
      if (nextRect) {
        cropState.rect = nextRect;
        renderCropCanvas();
        toast('✨ Auto-crop framed!', 1800);
      } else {
        renderCropCanvas();
        toast(res.spine_rotation ? '↻ Spine upright — drag corners if needed' : 'Already tightly framed — drag corners to fine-tune', 2200);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') toast('Auto-crop failed: ' + (err?.message || 'Error'), 3200);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Auto-Crop'; }
    }
  };

  window.rotateCropImage90 = () => {
    if (!cropState.active || !cropState.srcCanvas) return;
    cropState.srcCanvas = rotateCanvasByDeg(cropState.srcCanvas, 90);
    cropState.rotationDeg = ((Number(cropState.rotationDeg) || 0) + 90) % 360;
    cropState.rotatedInModal = true;
    cropState.rect = defaultCropRectForMode(cropState.mode);
    renderCropCanvas();
  };

  window.resetCropRect = () => {
    if (!cropState.active) return;
    cropState.rect = defaultCropRectForMode(cropState.mode);
    renderCropCanvas();
  };

  window.closeCropModal = () => {
    hideCropModalUI();
    if (history.state?.modal === 'crop') {
      try { history.back(); } catch (_) {}
    }
  };

  window.applyCropModal = async () => {
    if (!cropState.active || !cropState.srcCanvas) return;
    const r = { ...cropState.rect };
    const finalRotDeg = ((Number(cropState.rotationDeg) % 360) + 360) % 360;

    // Perform actual crop & rotation directly from the FULL-RESOLUTION original image,
    // then scale once to getPhotoQualitySpec() for exact parity with cropImageByBox!
    let fullCanvas = cropState.srcCanvas;
    if (cropState.origImg && cropState.origImg.naturalWidth && cropState.origImg.naturalHeight) {
      const nw = cropState.origImg.naturalWidth;
      const nh = cropState.origImg.naturalHeight;
      const swap = finalRotDeg === 90 || finalRotDeg === 270;
      const rc = document.createElement('canvas');
      rc.width = swap ? nh : nw;
      rc.height = swap ? nw : nh;
      const rctx = rc.getContext('2d');
      rctx.imageSmoothingEnabled = true;
      rctx.imageSmoothingQuality = 'high';
      rctx.translate(rc.width / 2, rc.height / 2);
      rctx.rotate((finalRotDeg * Math.PI) / 180);
      rctx.drawImage(cropState.origImg, -nw / 2, -nh / 2, nw, nh);
      fullCanvas = rc;
    }

    const sx = Math.max(0, Math.round(r.x * fullCanvas.width));
    const sy = Math.max(0, Math.round(r.y * fullCanvas.height));
    const sw = Math.max(16, Math.min(fullCanvas.width - sx, Math.round(r.w * fullCanvas.width)));
    const sh = Math.max(16, Math.min(fullCanvas.height - sy, Math.round(r.h * fullCanvas.height)));

    const spec = getPhotoQualitySpec();
    let dstW = sw, dstH = sh;
    if (!spec.raw) {
      const maxEdge = cropState.mode === 'spine' ? spec.spineMaxW : spec.maxEdge;
      const fitted = cropState.mode === 'spine'
        ? (sw > maxEdge ? { width: maxEdge, height: Math.max(1, Math.round(sh * (maxEdge / sw))) } : { width: sw, height: sh })
        : fitDims(sw, sh, maxEdge);
      dstW = fitted.width;
      dstH = fitted.height;
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = dstW;
    outCanvas.height = dstH;
    const ctx = outCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, dstW, dstH);

    const croppedWebp = canvasToDataUrl(outCanvas, 'image/webp', spec.quality);
    const workingSourceWebp = cropState.origDataUrl || canvasToDataUrl(cropState.srcCanvas, 'image/webp', spec.quality);
    const cb = cropState.onApply;
    const wasRotated = Boolean(cropState.rotatedInModal || finalRotDeg !== 0);

    hideCropModalUI();
    if (history.state?.modal === 'crop') {
      try { history.replaceState({ view: currentView, modal: activeStashItem ? 'stashDetail' : null, itemId: activeStashItem?.id || null }, ''); } catch (_) {}
    }
    if (typeof cb === 'function') await cb(croppedWebp, workingSourceWebp, r, wasRotated, finalRotDeg);
  };

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
          const { width: dstW, height: dstH } = (maxLongEdge === null || maxLongEdge === undefined)
            ? { width: rawW, height: rawH }
            : fitDims(rawW, rawH, maxLongEdge);
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

    const spec = getPhotoQualitySpec();
    const opts = Object.assign({
      aiMaxDim: 2048,
      aiQuality: 0.90,
      saveMaxDim: spec.maxEdge || 2400,
      saveQuality: spec.quality,
      rawSave: spec.raw,
      keepOrigDataUrl: false,
      squarePreview: false
    }, customOpts);

    let pair = null;
    if (typeof window.createImageBitmap === 'function') {
      try {
        pair = await decodeViaImageBitmap(blob, opts);
      } catch (_) {
        pair = null;
      }
    }
    if (!pair) {
      pair = await decodeViaImgElement(blob, opts);
    }

    if (opts.rawSave || opts.keepOrigDataUrl) {
      try {
        const rawUrl = await readBlobAsDataUrl(blob);
        if (rawUrl && rawUrl.startsWith('data:image/')) {
          pair.origDataUrl = rawUrl;
          if (opts.rawSave) pair.saveWebp = rawUrl;
        }
      } catch (_) {}
    }
    if (!pair.origDataUrl) {
      pair.origDataUrl = pair.apiB64 ? `data:image/jpeg;base64,${pair.apiB64}` : pair.saveWebp;
    }
    return pair;
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

  function isSecondaryRearLensLabel(lbl) {
    return /ultra|wide|0\.5|0\.6|macro|tele|depth|ir\b|tof\b/i.test(String(lbl || ''));
  }

  function pickPrimaryRearCameraId(devices) {
    const vids = (Array.isArray(devices) ? devices : []).filter(d => d && d.kind === 'videoinput' && d.deviceId);
    if (!vids.length) return '';
    const rear = vids.filter(d => {
      const l = String(d.label || '').toLowerCase();
      if (/\b(front|user|selfie|facetime)\b/.test(l)) return false;
      return /back|rear|environment|camera2\s*0/i.test(l) || !l;
    });
    const pool = rear.length ? rear : vids;
    const mainCandidates = pool.filter(d => !isSecondaryRearLensLabel(d.label));
    const cam0 = mainCandidates.find(d => /camera2\s*0\b|facing back/i.test(d.label || '') && /\b0\b/.test(d.label || ''));
    if (cam0) return cam0.deviceId;
    if (mainCandidates.length) return mainCandidates[0].deviceId;
    return pool[0]?.deviceId || '';
  }

  function isCameraStillActive(expectedCamSeq) {
    const modal = document.getElementById('cameraModal');
    return expectedCamSeq === camOpenSeq && Boolean(modal && !modal.classList.contains('hidden'));
  }

  async function bindStreamToViewfinder(stream, allowPrimaryLensSwitch = true, expectedCamSeq = camOpenSeq) {
    if (!isCameraStillActive(expectedCamSeq)) {
      stream?.getTracks?.().forEach(t => t.stop());
      return false;
    }
    const video = document.getElementById('camVideo');
    camStream = stream;
    video.srcObject = stream;
    await video.play();
    if (!isCameraStillActive(expectedCamSeq)) {
      stream?.getTracks?.().forEach(t => t.stop());
      if (camStream === stream) camStream = null;
      return false;
    }

    let track = camStream.getVideoTracks()[0];
    let caps = track?.getCapabilities ? track.getCapabilities() : {};

    // Force main 1x rear camera if Android auto-picked an ultrawide/macro/tele lens and user hasn't picked a custom lens
    if (allowPrimaryLensSwitch && !cfg.preferredCameraId && track) {
      let stoppedOld = false;
      try {
        const allDevs = await navigator.mediaDevices.enumerateDevices();
        if (!isCameraStillActive(expectedCamSeq)) {
          stream?.getTracks?.().forEach(t => t.stop());
          return false;
        }
        const curLabel = track.label || '';
        const primaryId = pickPrimaryRearCameraId(allDevs);
        const curDevId = track.getSettings?.()?.deviceId || '';
        if (primaryId && primaryId !== curDevId && isSecondaryRearLensLabel(curLabel)) {
          camStream.getTracks().forEach(t => t.stop());
          stoppedOld = true;
          const mainStream = await openHighResCameraStream(primaryId);
          return await bindStreamToViewfinder(mainStream, false, expectedCamSeq);
        }
      } catch (_) {
        if (stoppedOld && isCameraStillActive(expectedCamSeq)) {
          try {
            const recovered = await openHighResCameraStream('');
            return await bindStreamToViewfinder(recovered, false, expectedCamSeq);
          } catch (recErr) {
            hideCameraUI();
            toast('Camera lens switch failed — opening phone camera', 3200);
            document.getElementById(camMode === 'pile' ? 'pileCamInput' : 'nativeCamInput')?.click();
            return false;
          }
        }
      }
    }

    if (!isCameraStillActive(expectedCamSeq)) {
      stream?.getTracks?.().forEach(t => t.stop());
      if (camStream === stream) camStream = null;
      return false;
    }

    camTorchOn = false;
    const torchBtn = document.getElementById('camTorchBtn');
    if (torchBtn) {
      torchBtn.style.visibility = caps.torch ? 'visible' : 'hidden';
      torchBtn.textContent = '🔦';
    }

    // Explicitly lock zoom to 1.0x when sensor exposes ultrawide < 1.0 so Android never drops to blurry 0.5x
    if (track && caps?.zoom && typeof caps.zoom.min === 'number' && caps.zoom.min < 0.99 && (caps.zoom.max ?? 1) >= 1) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: 1.0 }] });
      } catch (_) {}
    }

    if (track && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }

    camImageCapture = null;
    if ('ImageCapture' in window && track) {
      try { camImageCapture = new window.ImageCapture(track); } catch (_) { camImageCapture = null; }
    }

    await refreshCameraLensControls(track);
    if (!isCameraStillActive(expectedCamSeq)) {
      stream?.getTracks?.().forEach(t => t.stop());
      if (camStream === stream) camStream = null;
      return false;
    }
    if (camPeakingOn) {
      document.getElementById('camPeakCanvas')?.classList.remove('hidden');
      if (camPeakRaf) cancelAnimationFrame(camPeakRaf);
      camPeakRaf = requestAnimationFrame(runFocusPeakingLoop);
    }
    return true;
  }

  window.cycleCameraLens = async () => {
    if (camRearDevices.length < 2 || camCapturing) return;
    const curIdx = camRearDevices.findIndex(d => d.deviceId === camActiveDeviceId);
    const nextIdx = (curIdx + 1) % camRearDevices.length;
    const nextDev = camRearDevices[nextIdx];
    if (!nextDev?.deviceId) return;

    const myCamSeq = ++camOpenSeq;
    const prevStream = camStream;
    if (prevStream) {
      prevStream.getTracks().forEach(t => t.stop());
      camStream = null;
    }

    try {
      const nextStream = await openHighResCameraStream(nextDev.deviceId);
      if (!isCameraStillActive(myCamSeq)) {
        nextStream?.getTracks?.().forEach(t => t.stop());
        return;
      }
      cfg.preferredCameraId = nextDev.deviceId;
      CC.persistCfg();
      const bound = await bindStreamToViewfinder(nextStream, false, myCamSeq);
      if (bound) toast(`Switched to ${getCameraLensShortLabel(nextDev, nextIdx)}`, 1600);
    } catch (err) {
      if (!isCameraStillActive(myCamSeq)) return;
      try {
        const fallbackStream = await openHighResCameraStream('');
        await bindStreamToViewfinder(fallbackStream, false, myCamSeq);
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
      const effFmt = getEffectiveScanFormat();
      const fmtNote = effFmt === 'Auto' ? 'All Formats' : (effFmt === 'Other' ? 'Other Media' : `${effFmt} Only`);
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

    const entries = getStagedSlotEntries();
    const n = entries.length;
    thumbsEl.classList.remove('hidden');
    if (!stagedSlots.front) { badge.textContent = 'Shot 1: Front + Side A'; badge.className = 'badge badge-blue'; }
    else if (!stagedSlots.back) { badge.textContent = 'Shot 2: Back + Side B'; badge.className = 'badge badge-purple'; }
    else if (!stagedSlots.spine) { badge.textContent = 'Shot 3: Spine (Optional — Auto-Crops)'; badge.className = 'badge badge-green'; }
    else if (n < 4) { badge.textContent = 'Shot 4: Extra Detail (Optional)'; badge.className = 'badge badge-green'; }
    else { badge.textContent = '4/4 Shots Ready'; badge.className = 'badge badge-green'; }

    finishBtn.className = n > 0 ? 'btn btn-green btn-sm' : 'btn btn-secondary btn-sm';
    finishBtn.innerHTML = `🔍 Finish &amp; Search (<span id="camCountLbl">${n}</span>)`;
    thumbsEl.innerHTML = entries.map((e, i) => `
      <div class="cam-thumb-item" onclick="openCameraShotLightbox(${i})" title="Tap to inspect ${e.label}">
        <img src="${e.photo.saveWebp}" />
        <button type="button" class="cam-thumb-remove" onclick="removeStagedPhoto('${e.slotKey}', ${e.extraIdx}, event)" title="Delete ${e.label}">×</button>
      </div>
    `).join('');

    if (stagedUpc) {
      upcBadge.innerHTML = `<span>║▌ UPC Locked: ${esc(stagedUpc)}</span><button type="button" class="cam-upc-clear" onclick="clearStagedUpc(event)" title="Clear scanned UPC">✕</button>`;
      upcBadge.classList.remove('hidden');
    } else {
      upcBadge.innerHTML = '';
      upcBadge.classList.add('hidden');
    }
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
    const entries = getStagedSlotEntries();
    const target = entries[idx];
    if (!target) return;
    removeStagedPhoto(target.slotKey, target.extraIdx, null);
    toast('Shot deleted — ready to retake');
  };

  async function openHighResCameraStream(preferredId = '') {
    let devId = preferredId || cfg.preferredCameraId || '';
    if (!devId && navigator.mediaDevices?.enumerateDevices) {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const labeled = devs.filter(d => d.kind === 'videoinput' && d.label);
        if (labeled.length) devId = pickPrimaryRearCameraId(labeled);
      } catch (_) {}
    }
    const attempts = [];
    // Prefer crisp 4K / high-res main 1x rear sensor (graceful fallback to 1080p -> 720p -> default)
    if (devId) {
      attempts.push(
        { video: { deviceId: { exact: devId }, width: { ideal: 3840 }, height: { ideal: 2160 }, focusMode: { ideal: 'continuous' } }, audio: false },
        { video: { deviceId: { exact: devId }, width: { ideal: 1920 }, height: { ideal: 1080 }, focusMode: { ideal: 'continuous' } }, audio: false },
        { video: { deviceId: { exact: devId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { deviceId: { exact: devId } }, audio: false }
      );
    }
    attempts.push(
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 }, focusMode: { ideal: 'continuous' } }, audio: false },
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
    const myCamSeq = ++camOpenSeq;
    modal.classList.remove('hidden');
    updateCameraOverlayUI();

    try {
      const stream = await openHighResCameraStream();
      if (!isCameraStillActive(myCamSeq)) {
        stream?.getTracks?.().forEach(t => t.stop());
        return;
      }
      const bound = await bindStreamToViewfinder(stream, true, myCamSeq);
      if (!bound || !isCameraStillActive(myCamSeq)) return;
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
                if (camIgnoredUpc && raw === camIgnoredUpc) {
                  // Still looking at the barcode the user just cleared — ignore until it leaves the frame!
                  camIgnoredUpcMisses = 0;
                } else {
                  camIgnoredUpc = '';
                  camIgnoredUpcMisses = 0;
                  stagedUpc = raw;
                  document.getElementById('fBarcode').value = raw;
                  playChime();
                  updateCameraOverlayUI();
                  updateStageUI();
                }
              } else if (camIgnoredUpc) {
                camIgnoredUpcMisses++;
                if (camIgnoredUpcMisses >= 3) {
                  camIgnoredUpc = '';
                  camIgnoredUpcMisses = 0;
                }
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

    const myStageSeq = stageSeq;
    const spec = getPhotoQualitySpec();
    const decodeOpts = camMode === 'pile'
      ? { aiMaxDim: 3072, aiQuality: 0.92, saveMaxDim: 2048, saveQuality: 0.82, rawSave: false, squarePreview: false }
      : { aiMaxDim: 2048, aiQuality: 0.90, saveMaxDim: spec.maxEdge || 2400, saveQuality: spec.quality, rawSave: spec.raw, keepOrigDataUrl: true, squarePreview: false };

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
        const origFull = decodeOpts.rawSave
          ? renderSourceToDataUrl(video, video.videoWidth, video.videoHeight, Math.max(video.videoWidth, video.videoHeight), 'image/webp', spec.quality)
          : renderSourceToDataUrl(video, video.videoWidth, video.videoHeight, Math.max(video.videoWidth, video.videoHeight), 'image/jpeg', 0.92);
        const saveWebp = decodeOpts.rawSave
          ? origFull
          : (decodeOpts.squarePreview
            ? renderSquareFittedPreview(video, video.videoWidth, video.videoHeight, decodeOpts.saveMaxDim, 'image/webp', decodeOpts.saveQuality)
            : renderSourceToDataUrl(video, video.videoWidth, video.videoHeight, decodeOpts.saveMaxDim, 'image/webp', decodeOpts.saveQuality));
        pair = { apiB64: apiDataUrl.split(',')[1], saveWebp, origDataUrl: origFull };
      }

      if (pair) {
        if (camMode === 'pile') {
          pilePhotos.push(pair);
          updateCameraOverlayUI();
          toast(`Shot ${pilePhotos.length} captured — tap thumb to check sharpness, or Finish & Analyze`);
        } else {
          if (myStageSeq !== stageSeq) return;
          if (!pair.origDataUrl) pair.origDataUrl = pair.apiB64 ? `data:image/jpeg;base64,${pair.apiB64}` : pair.saveWebp;
          pair.autoCropped = false;
          pair.spineCropped = false;
          pair.cropBox = null;
          pair.rotationDeg = 0;
          const placed = assignPhotoToFirstEmptySlot(pair);
          if (placed.slotKey === 'spine') {
            stagedSpineSourceUrl = pair.origDataUrl || pair.saveWebp;
            stagedSpineThumbUrl = pair.saveWebp;
            stagedSpineFlipped = false;
          }
          updateStageUI();
          updateCameraOverlayUI();
          if (placed.slotKey === 'front') toast('Front + Side A captured! Flip for Back + Side B');
          else if (placed.slotKey === 'back') toast('Back + Side B captured! Snap Spine (optional) or Finish & Search');
          else if (placed.slotKey === 'spine') toast('Spine captured! Review orientation or tap 🔍 Finish & Search');
          else toast('Extra shot captured! Tap 🔍 Finish & Search');
        }
      }
    } catch (err) {
      toast('Capture failed: ' + (err?.message || 'Unknown camera error'), 4200);
    } finally {
      camCapturing = false;
      if (shutterBtn) shutterBtn.disabled = false;
    }
  };

  async function autoCropStagedPhotosNow(targetSlots = null) {
    const entries = getStagedSlotEntries();
    if (!cfg.autoCropPhotos || !CC.isAiReady() || !entries.length) return 0;
    const myStageSeq = stageSeq;
    batchAutoCropCancelled = false;
    const spec = getPhotoQualitySpec();

    const targets = (Array.isArray(targetSlots) ? targetSlots : entries)
      .filter(e => e && e.photo && !e.photo.autoCropped);
    if (!targets.length) return 0;

    let croppedCount = 0;
    let errorCount = 0;
    let anyRoleDetected = false;

    try {
      for (let t = 0; t < targets.length; t++) {
        if (batchAutoCropCancelled || myStageSeq !== stageSeq) break;
        const entry = targets[t];
        const p = entry.photo;
        if (!p || p.autoCropped) continue;
        setStatus(`✂️ Auto-identifying & framing photo ${t + 1}/${targets.length}...`, true, { cancellable: true });
        const srcUrl = p.origDataUrl || (p.apiB64 ? `data:image/jpeg;base64,${p.apiB64}` : p.saveWebp);
        const res = await autoCropImageWithGemini(srcUrl, 'auto');
        if (batchAutoCropCancelled || myStageSeq !== stageSeq) break;
        if (!stagedPhotos.includes(p)) continue;

        if (res.error) {
          errorCount++;
          continue;
        }

        if (res.role) {
          p.detectedRole = res.role;
          anyRoleDetected = true;
        }
        const isSpine = (res.role || entry.slotKey) === 'spine';
        const needsCrop = Boolean(res.box_2d && shouldApplyCropBox(res.box_2d));

        if (isSpine) {
          const rot = [0, 90, 180, 270].includes(Number(res.spine_rotation)) ? Number(res.spine_rotation) : 0;
          let thumbUrl = '';
          if (res.box_2d && (needsCrop || rot !== 0)) {
            thumbUrl = await cropImageByBox(srcUrl, res.box_2d, {
              minBoxSpan: 25,
              padFrac: 0.025,
              maxLongEdge: spec.raw ? null : spec.spineMaxW,
              maxWidthOnly: !spec.raw,
              rotationDeg: rot,
              quality: spec.quality
            }) || '';
            p.cropBox = res.box_2d;
            p.rotationDeg = rot;
            p.spineRotation = rot;
          } else if (rot !== 0) {
            thumbUrl = await rotateDataUrlByDeg(srcUrl, rot, 'image/webp', spec.quality, spec.raw ? null : spec.spineMaxW);
            p.rotationDeg = rot;
            p.spineRotation = rot;
          }
          if (batchAutoCropCancelled || myStageSeq !== stageSeq) break;
          if (thumbUrl) {
            p.saveWebp = thumbUrl;
            stagedSpineSourceUrl = srcUrl;
            stagedSpineThumbUrl = thumbUrl;
            stagedSpineFlipped = rot === 180;
            croppedCount++;
          }
          p.autoCropped = true;
          p.spineCropped = true;
        } else {
          if (needsCrop) {
            const cropped = await cropImageByBox(srcUrl, res.box_2d, {
              minBoxSpan: 120,
              padFrac: 0.025,
              maxLongEdge: spec.raw ? null : spec.maxEdge,
              maxWidthOnly: false,
              rotationDeg: 0,
              quality: spec.quality
            });
            if (batchAutoCropCancelled || myStageSeq !== stageSeq) break;
            if (cropped) {
              p.saveWebp = cropped;
              p.cropBox = res.box_2d;
              p.rotationDeg = 0;
              croppedCount++;
            }
          }
          p.autoCropped = true;
        }
        updateStageUI();
      }

      // Automatically assign/re-slot staged photos using Gemini's detected roles (Front/Back/Spine/Extra)!
      if (anyRoleDetected && !batchAutoCropCancelled && myStageSeq === stageSeq) {
        const curEntries = getStagedSlotEntries();
        const rolePlan = curEntries.map(e => ({
          photo: e.photo,
          role: e.photo.detectedRole || (e.slotKey === 'extra' ? 'extra' : e.slotKey)
        }));
        if (applyDetectedRolesToStagedSlots(rolePlan)) {
          updateStageUI();
        }
      }
      if (errorCount > 0 && !batchAutoCropCancelled) {
        toast(`Auto-crop skipped ${errorCount} photo(s) — tap ✂️ to frame manually if needed`, 2800);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        toast('Auto-crop skipped — photos still staged cleanly', 2600);
      }
    } finally {
      setStatus('', false);
    }
    return croppedCount;
  }

  window.closeCameraViewfinder = () => {
    const modeNow = camMode;
    hideCameraUI();
    if (history.state?.modal === 'camera') {
      try { history.back(); } catch (_) {}
    }
    if (modeNow === 'pile' && pilePhotos.length > 0) {
      applyLoadedPilePhotos(pilePhotos, false);
    } else if (modeNow === 'single' && getStagedPhotoCount() > 0 && cfg.autoCropPhotos && CC.isAiReady()) {
      autoCropStagedPhotosNow().catch(() => {});
    }
  };

  window.finishCameraAndSearch = async () => {
    const modeNow = camMode;
    const hasSingleShots = getStagedPhotoCount() > 0;
    const hasPileShots = pilePhotos.length > 0;
    hideCameraUI();
    if (history.state?.modal === 'camera') {
      try { history.replaceState({ view: currentView, modal: null }, ''); } catch (_) {}
    }
    if (modeNow === 'single' && hasSingleShots) {
      if (cfg.autoCropPhotos && CC.isAiReady()) {
        await autoCropStagedPhotosNow().catch(() => {});
      }
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
    const myStageSeq = stageSeq;
    const spec = getPhotoQualitySpec();
    setStatus(`Processing ${files.length} photo(s) (${spec.label})...`, true);
    const addedEntries = [];
    try {
      for (const file of files) {
        if (myStageSeq !== stageSeq) return;
        if (getStagedPhotoCount() >= 4) { toast('Max 4 photos per scan'); break; }
        const pair = await decodeBlobToPhotoPair(file, {
          aiMaxDim: 2048,
          aiQuality: 0.90,
          saveMaxDim: spec.maxEdge || 2400,
          saveQuality: spec.quality,
          rawSave: spec.raw,
          keepOrigDataUrl: true,
          squarePreview: false
        });
        if (myStageSeq !== stageSeq) return;
        pair.autoCropped = false;
        pair.spineCropped = false;
        pair.cropBox = null;
        pair.rotationDeg = 0;
        const placed = assignPhotoToFirstEmptySlot(pair);
        const lbl = placed.slotKey === 'front' ? 'FRONT' : (placed.slotKey === 'back' ? 'BACK' : (placed.slotKey === 'spine' ? 'SPINE' : `EXTRA ${placed.extraIdx + 1}`));
        addedEntries.push({ slotKey: placed.slotKey, extraIdx: placed.extraIdx, label: lbl, photo: pair });
        if (placed.slotKey === 'spine') {
          stagedSpineSourceUrl = pair.origDataUrl || pair.saveWebp;
          stagedSpineThumbUrl = pair.saveWebp;
          stagedSpineFlipped = false;
        }
      }
      if (myStageSeq !== stageSeq) return;
      updateStageUI();
      if (cfg.autoCropPhotos && CC.isAiReady() && addedEntries.length) {
        const cnt = await autoCropStagedPhotosNow(addedEntries);
        if (myStageSeq !== stageSeq) return;
        toast(cnt > 0
          ? `✂️ Auto-cropped ${cnt} photo(s) — tap ✂️ to adjust or Search & Verify`
          : `${getStagedPhotoCount()} photo(s) ready — tap Search & Verify`);
      } else {
        setStatus('', false);
        toast(`${getStagedPhotoCount()} photo(s) ready — tap Search & Verify`);
      }
    } catch (err) {
      setStatus('', false);
      if (err?.name !== 'AbortError') toast('Photo error: ' + (err?.message || 'Could not read image'), 5000);
    }
  }

  window.removeStagedPhoto = (slotKey, extraIdx = -1, ev = null) => {
    if (typeof extraIdx === 'object' && extraIdx !== null && ev === null) { ev = extraIdx; extraIdx = -1; }
    if (ev) ev.stopPropagation();
    if (slotKey === 'front') stagedSlots.front = null;
    else if (slotKey === 'back') stagedSlots.back = null;
    else if (slotKey === 'spine') {
      stagedSlots.spine = null;
      stagedSpineThumbUrl = '';
      stagedSpineSourceUrl = '';
      stagedSpineFlipped = false;
      if (currentExtracted) { currentExtracted.spine_thumb_url = ''; currentExtracted.spine_source_url = ''; }
      if (currentInspected) { currentInspected.spine_thumb_url = ''; currentInspected.spine_source_url = ''; }
    } else if (slotKey === 'extra' && extraIdx >= 0 && extraIdx < stagedSlots.extras.length) {
      stagedSlots.extras.splice(extraIdx, 1);
    }
    syncStagedPhotosCompat();
    updateStageUI();
    updateCameraOverlayUI();
  };

  window.rotateStagedSpine90 = async (ev) => {
    if (ev) ev.stopPropagation();
    const cur = stagedSpineThumbUrl || currentExtracted?.spine_thumb_url || stagedSlots.spine?.saveWebp || '';
    if (!cur) return;
    if (!stagedSpineSourceUrl) stagedSpineSourceUrl = stagedSlots.spine?.origDataUrl || cur;
    const spec = getPhotoQualitySpec();
    const rotated = await rotateDataUrlByDeg(cur, 90, 'image/webp', spec.quality, spec.raw ? null : spec.spineMaxW);
    stagedSpineThumbUrl = rotated;
    stagedSpineFlipped = !stagedSpineFlipped;
    if (stagedSlots.spine) {
      stagedSlots.spine.saveWebp = rotated;
      stagedSlots.spine.rotationDeg = ((Number(stagedSlots.spine.rotationDeg) || 0) + 90) % 360;
      stagedSlots.spine.spineRotation = stagedSlots.spine.rotationDeg;
    }
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
    toast('↻ Spine rotated 90°', 1600);
  };
  window.flipStagedSpine180 = window.rotateStagedSpine90;

  window.openStagedSpineLightbox = () => {
    const src = stagedSpineThumbUrl || currentExtracted?.spine_thumb_url || stagedSlots.spine?.saveWebp || '';
    if (src) openLightbox([src], 0);
  };

  window.clearStagedUpc = (ev) => {
    if (ev) ev.stopPropagation();
    if (stagedUpc) {
      camIgnoredUpc = stagedUpc;
      camIgnoredUpcMisses = 0;
    }
    stagedUpc = '';
    const fBar = document.getElementById('fBarcode');
    if (fBar) fBar.value = '';
    updateStageUI();
    updateCameraOverlayUI();
    toast('UPC cleared — move away or aim at a new barcode', 1800);
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
    const btnOff = document.getElementById('btnSaveOffline');
    if (btnOff) btnOff.disabled = !hasAnything;
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

    // Responsive gallery using STABLE NAMED SLOTS (removing Back never shifts Spine or Extra!)
    const coverCards = [];
    if (stagedSlots.front) coverCards.push({ slotKey: 'front', extraIdx: -1, label: 'FRONT', photo: stagedSlots.front });
    if (stagedSlots.back) coverCards.push({ slotKey: 'back', extraIdx: -1, label: 'BACK', photo: stagedSlots.back });
    (stagedSlots.extras || []).forEach((p, i) => {
      if (p) coverCards.push({ slotKey: 'extra', extraIdx: i, label: i === 0 ? 'EXTRA' : `EXTRA ${i + 1}`, photo: p });
    });

    let galleryHtml = '';
    if (coverCards.length > 0) {
      const singleCls = coverCards.length === 1 ? 'single-cover' : '';
      galleryHtml += `<div class="photo-gallery-covers ${singleCls}">${coverCards.map((c, lbI) => `
        <div class="photo-tile" onclick="openStagedLightbox(${lbI})">
          <img src="${c.photo.saveWebp}" alt="" />
          <span class="photo-tile-label">${c.label}</span>
          <div class="photo-tile-actions">
            <button type="button" class="photo-tile-btn" onclick="openStagedPhotoCrop('${c.slotKey}', ${c.extraIdx}, event)" title="Crop or rotate ${c.label}">✂️</button>
            <button type="button" class="photo-tile-btn danger" onclick="removeStagedPhoto('${c.slotKey}', ${c.extraIdx}, event)" title="Remove ${c.label}">×</button>
          </div>
        </div>
      `).join('')}</div>`;
    }

    const spinePreviewSrc = activeSpineUrl || stagedSlots.spine?.saveWebp || '';
    if (spinePreviewSrc) {
      galleryHtml += `
        <div class="photo-gallery-spine">
          <div class="photo-gallery-spine-bar">
            <span style="font-size:0.7rem; font-weight:800; letter-spacing:0.06em; color:var(--muted);">SPINE</span>
            <div class="inline-actions" style="gap:4px;">
              <button type="button" class="photo-tile-btn" onclick="openStagedPhotoCrop('spine', -1, event)" title="Crop & rotate spine">✂️</button>
              <button type="button" class="photo-tile-btn" onclick="rotateStagedSpine90(event)" title="Rotate spine 90°">↻ 90°</button>
              ${stagedSlots.spine ? `<button type="button" class="photo-tile-btn danger" onclick="removeStagedPhoto('spine', -1, event)" title="Remove spine">×</button>` : ''}
            </div>
          </div>
          <div class="photo-gallery-spine-imgwrap" onclick="openStagedSpineLightbox()" title="Tap to zoom spine">
            <img src="${spinePreviewSrc}" alt="" />
          </div>
        </div>
      `;
    }

    document.getElementById('previewStrip').innerHTML = galleryHtml;
    const hintEl = document.getElementById('stagedPhotoHint');
    if (hintEl) {
      const spec = getPhotoQualitySpec();
      hintEl.textContent = `Tap any photo to inspect · Tap ✂️ to adjust crop · Save quality: ${spec.label}`;
    }
    renderInspectorPhotosToSave();
  };

  function renderInspectorPhotosToSave() {
    const wrap = document.getElementById('inspPhotosToSaveWrap');
    if (!wrap) return;
    const activeSpineUrl = stagedSpineThumbUrl || currentInspected?.spine_thumb_url || currentExtracted?.spine_thumb_url || stagedSlots.spine?.saveWebp || '';
    const cards = [];
    let coverLbIdx = 0;
    if (stagedSlots.front) cards.push({ slotKey: 'front', extraIdx: -1, lbIdx: coverLbIdx++, label: 'FRONT', src: stagedSlots.front.saveWebp, isSpine: false });
    if (stagedSlots.back) cards.push({ slotKey: 'back', extraIdx: -1, lbIdx: coverLbIdx++, label: 'BACK', src: stagedSlots.back.saveWebp, isSpine: false });
    if (activeSpineUrl) cards.push({ slotKey: 'spine', extraIdx: -1, lbIdx: -1, label: 'SPINE', src: activeSpineUrl, isSpine: true });
    (stagedSlots.extras || []).forEach((p, i) => {
      if (p) cards.push({ slotKey: 'extra', extraIdx: i, lbIdx: coverLbIdx++, label: i === 0 ? 'EXTRA' : `EXTRA ${i + 1}`, src: p.saveWebp, isSpine: false });
    });

    if (!currentInspected || !cards.length) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
      return;
    }
    const spec = getPhotoQualitySpec();
    wrap.classList.remove('hidden');
    wrap.innerHTML = `
      <div class="insp-save-photos-hdr">
        <span>📷 Photos to Save (${cards.length})</span>
        <span style="font-size:0.7rem; color:var(--muted); font-weight:600;">${esc(spec.label)}</span>
      </div>
      <div class="insp-save-photos-strip">
        ${cards.map(c => `
          <div class="insp-save-photo-card">
            <div class="insp-save-photo-thumb" onclick="${c.isSpine ? 'openStagedSpineLightbox()' : `openStagedLightbox(${c.lbIdx})`}" title="Tap to inspect">
              <img src="${c.src}" alt="" />
            </div>
            <div class="insp-save-photo-meta">
              <span class="insp-save-photo-lbl">${c.label}</span>
              <button type="button" class="photo-tile-btn" onclick="openStagedPhotoCrop('${c.slotKey}', ${c.extraIdx}, event)" title="Adjust crop on full original">✂️ Crop</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  window.openStagedPhotoCrop = (slotKey, extraIdx = -1, ev = null) => {
    if (typeof extraIdx === 'object' && extraIdx !== null && ev === null) { ev = extraIdx; extraIdx = -1; }
    if (ev) ev.stopPropagation();
    const isSpine = slotKey === 'spine';
    const photo = getStagedSlotPhoto(slotKey, extraIdx);
    const src = isSpine
      ? (photo?.origDataUrl || stagedSpineSourceUrl || stagedSpineThumbUrl || photo?.saveWebp || '')
      : (photo?.origDataUrl || (photo?.apiB64 ? `data:image/jpeg;base64,${photo.apiB64}` : photo?.saveWebp) || '');
    if (!src) return;
    const lbl = slotKey === 'front' ? 'Front' : (slotKey === 'back' ? 'Back' : (isSpine ? 'Spine' : `Extra ${Math.max(1, extraIdx + 1)}`));
    // Preserve cumulative rotationDeg for ALL slots (Front, Back, Spine, Extras)!
    const initRot = ((Number(photo?.rotationDeg ?? (isSpine ? photo?.spineRotation : 0)) % 360) + 360) % 360;
    const boxForModal = photo?.cropBox ? (initRot ? rotateBox2dClockwise(photo.cropBox, initRot) : photo.cropBox) : null;
    const initialRect = boxForModal ? box2dToNormRect(boxForModal, 0, isSpine ? 25 : 150) : null;

    openCropModal({
      dataUrl: src,
      title: `✂️ Crop & Rotate ${lbl}`,
      mode: isSpine ? 'spine' : 'cover',
      initialRect,
      initialRotation: initRot,
      onApply: async (croppedWebp, workingSourceWebp, appliedRect, _wasRotated, finalRotDeg = 0) => {
        // Store cropBox in unrotated original coordinates so reopening with rotationDeg round-trips accurately
        const invRot = (360 - (((Number(finalRotDeg) || 0) % 360 + 360) % 360)) % 360;
        const rotBox = normRectToBox2d(appliedRect);
        const origCoordsBox = invRot ? rotateBox2dClockwise(rotBox, invRot) : rotBox;

        if (isSpine) {
          stagedSpineThumbUrl = croppedWebp;
          stagedSpineSourceUrl = workingSourceWebp || src;
          stagedSpineFlipped = finalRotDeg === 180;
          if (stagedSlots.spine) {
            stagedSlots.spine.saveWebp = croppedWebp;
            stagedSlots.spine.autoCropped = true;
            stagedSlots.spine.spineCropped = true;
            stagedSlots.spine.cropBox = origCoordsBox;
            stagedSlots.spine.rotationDeg = finalRotDeg;
            stagedSlots.spine.spineRotation = finalRotDeg;
          }
          if (currentExtracted) {
            currentExtracted.spine_thumb_url = croppedWebp;
            currentExtracted.spine_source_url = stagedSpineSourceUrl;
            currentExtracted.spine_flipped = stagedSpineFlipped;
          }
          if (currentInspected) {
            currentInspected.spine_thumb_url = croppedWebp;
            currentInspected.spine_source_url = stagedSpineSourceUrl;
            currentInspected.spine_flipped = stagedSpineFlipped;
          }
        } else if (photo) {
          photo.saveWebp = croppedWebp;
          photo.autoCropped = true;
          photo.cropBox = origCoordsBox;
          photo.rotationDeg = finalRotDeg;
        }
        updateStageUI();
        toast(`✂️ ${lbl} crop applied`);
      }
    });
  };

  window.openStagedLightbox = (idx) => {
    const coverList = [stagedSlots.front, stagedSlots.back, ...(stagedSlots.extras || [])].filter(Boolean).map(p => p.saveWebp);
    openLightbox(coverList, idx);
  };

  // Build labeled image parts for AI Grading / Voice Re-Grade: sends Front, Back, Spine, and all Extra photos,
  // enforcing a <= 2048px JPEG cap on Stash photos so Raw / Very High saves never bloat Gemini payloads!
  async function buildLabeledGradingImageParts(source, item) {
    const parts = [];
    const pushDownscaledDataUrl = async (label, dataUrl) => {
      const s = String(dataUrl || '').trim();
      if (!s || isUnresolvedDriveRef(s) || !s.startsWith('data:image/')) return;
      const b64 = await renderDataUrlToCompactJpegB64(s, 2048, 0.88);
      if (b64) {
        parts.push({ text: label });
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
      }
    };

    if (source !== 'stash') {
      const entries = getStagedSlotEntries();
      let hasSpinePart = false;
      for (const e of entries) {
        if (!e.photo?.apiB64) continue;
        if (e.slotKey === 'spine') hasSpinePart = true;
        parts.push({ text: e.tag });
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: e.photo.apiB64 } });
      }
      const extraSpine = stagedSpineThumbUrl || item?.spine_thumb_url || '';
      if (!hasSpinePart && extraSpine) {
        await pushDownscaledDataUrl('[Spine]', extraSpine);
      }
      return parts;
    }

    const slots = getStashPhotoSlots(item);
    if (slots.front) await pushDownscaledDataUrl('[Front]', slots.front);
    if (slots.back) await pushDownscaledDataUrl('[Back]', slots.back);
    for (let i = 0; i < slots.extras.length; i++) {
      await pushDownscaledDataUrl(`[Extra ${i + 1}]`, slots.extras[i]);
    }
    const spineSrc = item?.spine_thumb_url || item?.spine_source_url || '';
    if (spineSrc) {
      await pushDownscaledDataUrl('[Spine]', spineSrc);
    }
    return parts;
  }
  function setVoiceCancelVisible(source, visible) {
    const cancelId = source === 'stash' ? 'btnVoiceCancelStash' : 'btnVoiceCancelScan';
    const el = document.getElementById(cancelId);
    if (el) el.classList.toggle('hidden', !visible);
  }

  window.cancelVoiceRegrade = () => {
    voiceWantListening = false;
    try { activeRecognition?.abort?.(); } catch (_) { try { activeRecognition?.stop?.(); } catch (_2) {} }
    activeRecognition = null;
    voiceTranscriptFinal = '';
    voiceTranscriptInterim = '';
    const ctx = voiceContext;
    voiceContext = null;
    if (ctx) {
      const btn = document.getElementById(ctx.btnId);
      const liveEl = document.getElementById(ctx.liveId);
      if (btn) { btn.classList.remove('listening'); btn.disabled = false; btn.textContent = VOICE_BTN_IDLE; }
      if (liveEl) { liveEl.classList.add('hidden'); liveEl.textContent = ''; }
      setVoiceCancelVisible(ctx.source, false);
    }
    setVoiceCancelVisible('scan', false);
    setVoiceCancelVisible('stash', false);
    toast('Voice memo cancelled — no AI call made', 1800);
  };

  window.voiceRegrade = (source, btnId) => {
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); return; }
    const btn = document.getElementById(btnId);
    const liveId = source === 'stash' ? 'voiceLiveStash' : 'voiceLiveScan';
    const liveEl = document.getElementById(liveId);

    if (voiceWantListening && voiceContext?.btnId === btnId) {
      voiceWantListening = false;
      try { activeRecognition?.stop(); } catch (_) {}
      activeRecognition = null;
      setVoiceCancelVisible(source, false);
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
    if (btn) { btn.classList.add('listening'); btn.textContent = '⏹️ Done & Re-Grade'; }
    setVoiceCancelVisible(source, true);
    if (liveEl) { liveEl.classList.remove('hidden'); liveEl.textContent = '🎤 Listening — speak flaws clearly, or tap ✕ Cancel...'; }

    const startRec = () => {
      if (!voiceWantListening) return;
      const rec = new SR();
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      activeRecognition = rec;

      rec.onresult = (e) => {
        if (!voiceWantListening) return;
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
          setVoiceCancelVisible(source, false);
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
- SPINE & VERBATIM MARKINGS RULE (CRITICAL):
  * Inspect EVERY attached image including [Spine] for promo punch holes, drill holes, saw cuts / cut-out notches, cracked hinges, spine fading/creases, and shell defects.
  * TRANSCRIBE VERBATIM any notable ink stamps, radio/library/club property stamps (e.g. "Property of ... Milwaukee"), promo stamps, price/hype stickers, or handwritten markings in "polished_note" instead of summarizing them generically.
- CONSERVATIVE RULE: When between two grades, ALWAYS choose the LOWER grade. NEVER use the word "mint" unless factory sealed.

Return ONLY valid JSON:
{
  "media_condition": "exact Discogs media grade from list",
  "sleeve_condition": "exact Discogs sleeve grade from list",
  "polished_note": "clean, factual, buyer-ready Discogs listing note incorporating every flaw reported by the seller and visible in photos including verbatim stamps/markings (1-3 short sentences, no fluff)"
}`;

    const targetRunId = scanRunId;
    const targetInspectSeq = inspectSeq;
    const targetItemRef = item;
    const targetStashId = isStash ? item.id : null;
    const parts = [{ text: prompt }, ...(await buildLabeledGradingImageParts(source, item))];

    try {
      const res = await CC.callAI(parts, 'MEDIUM', { retryLabel: 'Voice Re-Grade' });
      // Discard stale Voice Re-Grade response if user switched pressings, reset scanner, or closed/switched Stash Detail!
      if (!isStash && (targetRunId !== scanRunId || targetInspectSeq !== inspectSeq || currentInspected !== targetItemRef)) {
        setStatus('', false);
        return;
      }
      if (isStash && (!activeStashItem || activeStashItem.id !== targetStashId || document.getElementById('stashDetailModal')?.classList.contains('hidden'))) {
        setStatus('', false);
        return;
      }
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
      // Apply exact same staleness check in catch so a failed/aborted Voice Re-Grade from Pressing A
      // NEVER overwrites Pressing B's button state or pendingVoiceRetry!
      if (!isStash && (targetRunId !== scanRunId || targetInspectSeq !== inspectSeq || currentInspected !== targetItemRef)) {
        return;
      }
      if (isStash && (!activeStashItem || activeStashItem.id !== targetStashId || document.getElementById('stashDetailModal')?.classList.contains('hidden'))) {
        return;
      }
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
    const f = String(format || '');
    let fallbackIcon = '📼';
    if (/\b(vhs|betamax|dvd|blu[\s-]*ray|laser\s*disc)\b/i.test(f)) fallbackIcon = '🎬';
    else if (/\b(vinyl|shellac)\b/i.test(f)) fallbackIcon = '💿';
    else if (/\b(cd|sacd|mini\s*disc|umd)\b/i.test(f)) fallbackIcon = '📀';
    else if (/\b(file|digital)\b/i.test(f)) fallbackIcon = '🎵';
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
      playBtn.classList.remove('is-yt', 'is-playing');
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
      const btn = document.getElementById('audioPlayBtn');
      btn.textContent = '⏸';
      btn.classList.add('is-playing');
      if (activeTrackBtnKey) activeClipState = 'playing';
      syncTrackPlayButtons();
    }
  });
  audioEl.addEventListener('pause', () => {
    if (audioEl.src === SILENT_WAV) return;
    const btn = document.getElementById('audioPlayBtn');
    btn.classList.remove('is-playing');
    if (!activeDirectYoutubeUrl) btn.textContent = '▶';
    if (activeTrackBtnKey && activeClipState !== 'loading') activeClipState = 'paused';
    syncTrackPlayButtons();
  });
  audioEl.addEventListener('ended', () => {
    if (audioEl.src === SILENT_WAV) return;
    const btn = document.getElementById('audioPlayBtn');
    btn.classList.remove('is-playing');
    if (!activeDirectYoutubeUrl) btn.textContent = '▶';
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
    const nextVal = Boolean(checked);
    const changed = Boolean(cfg.autoGradeOnScan) !== nextVal;
    cfg.autoGradeOnScan = nextVal;
    const scanChk = document.getElementById('scanAutoGradeChk');
    const cfgChk = document.getElementById('cfgAutoGradeOnScan');
    if (scanChk) scanChk.checked = cfg.autoGradeOnScan;
    if (cfgChk) cfgChk.checked = cfg.autoGradeOnScan;
    CC.persistCfg(changed);
    if (changed) {
      const prefKeys = CC.PREF_KEYS || [
        'geminiModel', 'autoPlayHighlight', 'autoDetective', 'autoGradeOnScan',
        'autoCropPhotos', 'photoQuality', 'homeCountry', 'fetchVgSuggestions',
        'threshold', 'voice', 'showSpotify', 'showApple', 'showDeezer', 'showYoutube'
      ];
      const outPrefs = { cfgUpdatedAt: Number(cfg.cfgUpdatedAt || Date.now()) };
      prefKeys.forEach(k => { outPrefs[k] = cfg[k]; });
      CC.commitLocalMutation({ extraOps: [{ type: 'prefs', prefs: outPrefs }], queueOutbox: true }).then(() => {
        updateCloudUI();
        scheduleGoogleAutoSync();
      }).catch(() => {});
    }
  };

  async function cropImageByBox(sourceDataUrl, box2d, opts = {}) {
    const spec = getPhotoQualitySpec();
    const {
      minBoxSpan = 150,
      padFrac = 0.025,
      maxLongEdge = spec.raw ? null : spec.maxEdge,
      maxWidthOnly = false,
      rotationDeg = 0,
      quality = spec.quality
    } = opts || {};
    if (!sourceDataUrl || !Array.isArray(box2d) || box2d.length !== 4) return null;
    const nums = box2d.map(Number);
    if (!nums.every(Number.isFinite)) return null;
    const isUnit = Math.max(...nums) > 0 && Math.max(...nums) <= 1.01;
    let [y1, x1, y2, x2] = nums.map(v => Math.max(0, Math.min(1000, isUnit ? v * 1000 : v)));
    if (y1 > y2) [y1, y2] = [y2, y1];
    if (x1 > x2) [x1, x2] = [x2, x1];
    const boxW = x2 - x1;
    const boxH = y2 - y1;
    if (boxW < minBoxSpan || boxH < minBoxSpan) return null;

    // Expand by ~2.5% safety margin clamped cleanly to [0..1000]
    const padX = Math.max(8, boxW * padFrac);
    const padY = Math.max(8, boxH * padFrac);
    x1 = Math.max(0, x1 - padX);
    x2 = Math.min(1000, x2 + padX);
    y1 = Math.max(0, y1 - padY);
    y2 = Math.min(1000, y2 + padY);

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const nw = img.naturalWidth || img.width;
          const nh = img.naturalHeight || img.height;
          if (!nw || !nh) { resolve(null); return; }
          const sx = Math.max(0, Math.floor((x1 / 1000) * nw));
          const sy = Math.max(0, Math.floor((y1 / 1000) * nh));
          const sw = Math.max(16, Math.min(nw - sx, Math.ceil(((x2 - x1) / 1000) * nw)));
          const sh = Math.max(16, Math.min(nh - sy, Math.ceil(((y2 - y1) / 1000) * nh)));

          const normDeg = ((Number(rotationDeg) % 360) + 360) % 360;
          const swap = normDeg === 90 || normDeg === 270;
          const rawW = swap ? sh : sw;
          const rawH = swap ? sw : sh;
          let dstW = rawW, dstH = rawH;
          if (maxLongEdge !== null && maxLongEdge !== undefined) {
            if (maxWidthOnly) {
              if (rawW > maxLongEdge) {
                const s = maxLongEdge / rawW;
                dstW = maxLongEdge;
                dstH = Math.max(1, Math.round(rawH * s));
              }
            } else {
              const fitted = fitDims(rawW, rawH, maxLongEdge);
              dstW = fitted.width;
              dstH = fitted.height;
            }
          }

          const c = document.createElement('canvas');
          c.width = dstW;
          c.height = dstH;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.translate(dstW / 2, dstH / 2);
          ctx.rotate((normDeg * Math.PI) / 180);
          if (swap) ctx.drawImage(img, sx, sy, sw, sh, -dstH / 2, -dstW / 2, dstH, dstW);
          else ctx.drawImage(img, sx, sy, sw, sh, -dstW / 2, -dstH / 2, dstW, dstH);
          resolve(canvasToDataUrl(c, 'image/webp', quality));
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = sourceDataUrl;
    });
  }

  async function cropSpineFromStagedPhoto(spineCrop, explicitSpineRotation = null) {
    if (!spineCrop || typeof spineCrop !== 'object' || !Array.isArray(spineCrop.box_2d) || spineCrop.box_2d.length !== 4) {
      return { sourceUrl: '', thumbUrl: '', flipped: false };
    }
    const rawIdx = Number(spineCrop.photo_index);
    const pIdx = Number.isInteger(rawIdx) && rawIdx >= 0 && rawIdx < stagedPhotos.length
      ? rawIdx
      : (stagedPhotos.length >= 3 ? 2 : 0);
    const photo = stagedPhotos[pIdx];
    if (!photo) return { sourceUrl: '', thumbUrl: '', flipped: false };

    const spec = getPhotoQualitySpec();
    const srcImgUrl = photo.origDataUrl || (photo.apiB64 ? `data:image/jpeg;base64,${photo.apiB64}` : photo.saveWebp);
    const hasExactRot = explicitSpineRotation !== null && explicitSpineRotation !== undefined && [0, 90, 180, 270].includes(Number(explicitSpineRotation));
    const exactDeg = hasExactRot ? Number(explicitSpineRotation) : null;

    const unrotatedCrop = await cropImageByBox(srcImgUrl, spineCrop.box_2d, {
      minBoxSpan: 25,
      padFrac: 0.025,
      maxLongEdge: spec.raw ? null : spec.spineMaxW,
      maxWidthOnly: false,
      rotationDeg: 0,
      quality: spec.quality
    });
    if (!unrotatedCrop) return { sourceUrl: '', thumbUrl: '', flipped: false };

    let finalAngle = exactDeg;
    if (finalAngle === null) {
      const nums = spineCrop.box_2d.map(Number);
      const tr = CC.resolveSpineTransform(Math.abs(nums[3] - nums[1]), Math.abs(nums[2] - nums[0]), spineCrop.rotation_hint || '');
      finalAngle = tr.angleDeg;
    }

    const rotatedThumb = await cropImageByBox(srcImgUrl, spineCrop.box_2d, {
      minBoxSpan: 25,
      padFrac: 0.025,
      maxLongEdge: spec.raw ? null : spec.spineMaxW,
      maxWidthOnly: !spec.raw,
      rotationDeg: finalAngle,
      quality: spec.quality
    });
    return {
      sourceUrl: srcImgUrl,
      thumbUrl: rotatedThumb || unrotatedCrop,
      flipped: finalAngle === 180,
      angle: finalAngle
    };
  }

  function cleanFrankenField(val) {
    const s = Array.isArray(val) ? val.filter(Boolean).join(', ').trim() : String(val || '').trim();
    if (!s || /^(unknown|unreadable|illegible|n\/a|none|\?+)$/i.test(s)) return '';
    return s;
  }

  function isIdentityReadable(ident) {
    if (!ident || typeof ident !== 'object') return false;
    return Boolean(cleanFrankenField(ident.title) || cleanFrankenField(ident.artist) || cleanFrankenField(ident.catno));
  }

  function buildCatalogVariantsFromCatno(catno) {
    const raw = cleanFrankenField(catno);
    if (!raw) return [];
    const stripped = raw.replace(/[\s\-_.]+/g, '');
    const spaced = raw.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(new Set([raw, stripped, spaced].filter(Boolean)));
  }

  function applyIdentityToSearchFields(ident, fallbackExtracted = null, strict = false) {
    if (!ident) return;
    const titleVal = cleanFrankenField(ident.title);
    const artVal = cleanFrankenField(ident.artist);
    const catVal = cleanFrankenField(ident.catno);
    const lblVal = cleanFrankenField(ident.label);
    const yrVal = cleanFrankenField(ident.year);
    const fmtVal = cleanFrankenField(ident.format);

    document.getElementById('fTitle').value = strict ? titleVal : (titleVal || fallbackExtracted?.album_title || '');
    document.getElementById('fArtist').value = strict
      ? artVal
      : (artVal || (Array.isArray(fallbackExtracted?.artists) ? fallbackExtracted.artists.join(', ') : (fallbackExtracted?.artists || '')));
    document.getElementById('fCatno').value = catVal;
    document.getElementById('fLabel').value = lblVal;
    document.getElementById('fYear').value = yrVal;
    if (fmtVal && !/^unknown$/i.test(fmtVal)) {
      setSelectFormatValue('fFormat', CC.normalizeDiscogsFormat(fmtVal));
    }
  }

  function renderFrankenBanner() {
    const el = document.getElementById('frankenBanner');
    if (!el) return;
    if (!frankenState || !frankenState.active) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    const f = frankenState;
    const isDiffAlbumOrFmt = f.mismatchType === 'different_album' || f.mismatchType === 'different_format';
    const mediaLabel = [cleanFrankenField(f.media?.artist), cleanFrankenField(f.media?.title)].filter(Boolean).join(' — ') || 'Unreadable / Unknown media';
    const packLabel = [cleanFrankenField(f.packaging?.artist), cleanFrankenField(f.packaging?.title)].filter(Boolean).join(' — ') || 'Unknown packaging';
    const mediaMeta = [cleanFrankenField(f.media?.format), cleanFrankenField(f.media?.catno), cleanFrankenField(f.media?.label), cleanFrankenField(f.media?.year)].filter(Boolean).join(' · ');
    const packMeta = [cleanFrankenField(f.packaging?.format), cleanFrankenField(f.packaging?.catno), cleanFrankenField(f.packaging?.label), cleanFrankenField(f.packaging?.year)].filter(Boolean).join(' · ');
    const unverifiedWarnHtml = f.mediaUnverified
      ? `<div class="alert-box alert-dup" style="margin-bottom:10px;">⚠️ <strong>Media unverified</strong> — Physical tape/disc label text was unreadable, so Discogs was NOT searched using the mismatched packaging clues. Retake a sharp close-up of the media label or explicitly tap <strong>📦 Verify Packaging Instead</strong>.</div>`
      : '';

    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="franken-banner-title">🧟 FRANKEN-COPY DETECTED (${esc(f.mismatchType.replace(/_/g, ' '))})</div>
      <div class="franken-banner-reason">${esc(f.reason || 'Physical media and packaging do not match.')}</div>
      ${unverifiedWarnHtml}
      <div class="franken-banner-compare">
        <div class="franken-id-box">
          <strong>📼 Physical Media ${f.mode === 'media' ? '(Active)' : ''}</strong>
          <div>${esc(mediaLabel)}</div>
          ${mediaMeta ? `<div style="margin-top:2px;">${esc(mediaMeta)}</div>` : ''}
        </div>
        <div class="franken-id-box">
          <strong>📦 Packaging / Case ${f.mode === 'packaging' ? '(Active)' : ''}</strong>
          <div>${esc(packLabel)}</div>
          ${packMeta ? `<div style="margin-top:2px;">${esc(packMeta)}</div>` : ''}
        </div>
      </div>
      <div class="inline-actions" style="gap:6px;">
        <button type="button" class="btn ${f.mode === 'media' ? 'btn-green' : 'btn-secondary'} btn-sm" onclick="switchFrankenVerifyMode('media')">📼 Verify Media (Default)</button>
        <button type="button" class="btn ${f.mode === 'packaging' ? 'btn-green' : 'btn-secondary'} btn-sm" onclick="switchFrankenVerifyMode('packaging')">📦 Verify Packaging Instead</button>
        ${isDiffAlbumOrFmt ? `<button type="button" class="btn btn-secondary btn-sm" onclick="saveOrphanPackagingLocally()">💾 Also Save Orphan Packaging Locally</button>` : ''}
      </div>
    `;
  }

  window.switchFrankenVerifyMode = async (mode) => {
    if (!frankenState || !frankenState.active) return;
    frankenState.mode = mode === 'packaging' ? 'packaging' : 'media';
    const isMediaMode = frankenState.mode === 'media';
    const ident = isMediaMode ? (frankenState.media || {}) : (frankenState.packaging || {});

    // Strictly isolate media mode from packaging evidence (NEVER fall back to packaging catno/label/year/barcode/variants!)
    applyIdentityToSearchFields(ident, null, true);
    const idTitle = cleanFrankenField(ident.title);
    const idArtist = cleanFrankenField(ident.artist);
    const idCatno = cleanFrankenField(ident.catno);
    const idLabel = cleanFrankenField(ident.label);
    const idYear = cleanFrankenField(ident.year);
    const idFmt = cleanFrankenField(ident.format);
    const idBarcode = isMediaMode
      ? String(ident.barcode || '').replace(/\D/g, '')
      : (String(ident.barcode || '').replace(/\D/g, '') || stagedUpc || String(frankenState.origBarcode || '').replace(/\D/g, ''));

    document.getElementById('fBarcode').value = idBarcode;

    if (currentExtracted) {
      currentExtracted.album_title = idTitle;
      currentExtracted.artists = idArtist ? [idArtist] : [];
      currentExtracted.raw_catalog_number = idCatno;
      currentExtracted.cleaned_catalog_variants = isMediaMode
        ? buildCatalogVariantsFromCatno(idCatno)
        : (idCatno ? buildCatalogVariantsFromCatno(idCatno) : (frankenState.origCatalogVariants || []));
      currentExtracted.label = idLabel;
      currentExtracted.year = idYear;
      currentExtracted.barcode = idBarcode;
      if (idFmt && !/^unknown$/i.test(idFmt)) {
        currentExtracted.detected_format = CC.normalizeDiscogsFormat(idFmt);
      } else if (!isMediaMode && frankenState.origDetectedFormat) {
        currentExtracted.detected_format = frankenState.origDetectedFormat;
      }
    }

    renderFrankenBanner();
    if (isMediaMode && frankenState.mediaUnverified) {
      document.getElementById('inspectorCard').classList.add('hidden');
      document.getElementById('detectiveCard').classList.add('hidden');
      document.getElementById('candidatesCard').classList.add('hidden');
      setStatus('', false);
      toast('⚠️ Media unverified — retake a close-up of the media label or tap Verify Packaging Instead', 4600);
      return;
    }
    await runDiscogsSearch(scanRunId);
  };

  window.saveOrphanPackagingLocally = async () => {
    if (!frankenState || !frankenState.packaging) return;
    const p = frankenState.packaging;
    const now = Date.now();
    const photoSlots = {
      front: stagedSlots.front?.saveWebp || '',
      back: stagedSlots.back?.saveWebp || '',
      extras: (stagedSlots.extras || []).filter(Boolean).map(x => x.saveWebp)
    };
    const derived = CC.deriveThumbsFromSlots(photoSlots, '');
    const note = `Orphan packaging / case only (no matching media inside). ${frankenState.reason || ''}`.trim();
    const rec = CC.stampStashRevision({
      sync_id: CC.generateSyncId(),
      artist: p.artist || 'Unknown Artist',
      title: p.title || 'Orphan Packaging',
      format: (p.format && !/^unknown$/i.test(p.format)) ? CC.normalizeDiscogsFormat(p.format) : (currentExtracted?.detected_format || 'Cassette'),
      catno: p.catno || '',
      label: p.label || '',
      year: p.year || '',
      country: '',
      genres: [],
      media_condition: 'Not Graded',
      sleeve_condition: 'Not Graded',
      condition_note: note,
      is_franken_copy: true,
      franken_type: frankenState.mismatchType || 'different_album',
      franken_note: frankenState.reason || '',
      needs_verification: true,
      synced_to_discogs: false,
      discogs_id: null,
      photo_slots: photoSlots,
      thumbs: derived.thumbs,
      thumb_data_url: derived.thumb_data_url,
      spine_thumb_url: stagedSpineThumbUrl || stagedSlots.spine?.saveWebp || '',
      spine_source_url: stagedSpineSourceUrl || stagedSlots.spine?.origDataUrl || '',
      spine_flipped: Boolean(stagedSpineFlipped),
      created_at: now,
      updated_at: now
    }, null);
    await CC.commitLocalMutation({ upsertStash: rec, queueOutbox: true });
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
    toast(`💾 Saved orphan packaging "${rec.artist} — ${rec.title}" locally!`, 3800);
  };

  async function runVisionOCR(myRunId) {
    const keepOldGrades = Boolean(editingStashItem && !document.getElementById('chkRegradeEdit').checked);
    const shouldGradeNow = Boolean(cfg.autoGradeOnScan) && !keepOldGrades;
    frankenState = null;
    renderFrankenBanner();
    setStatus(
      shouldGradeNow
        ? `Inspecting & grading ${stagedPhotos.length} photo(s) on ${aiEngineLabel()}...`
        : `Reading ${stagedPhotos.length} photo(s) (fast OCR) on ${aiEngineLabel()}...`,
      true,
      { cancellable: true }
    );

    const upcHint = stagedUpc ? `User also scanned UPC barcode: ${stagedUpc}.` : '';
    const sharedOcrInstructions = `
TRUE VISUAL FORMAT RULE (CRITICAL):
- Detect "detected_format" STRICTLY from what you physically see in the photos. NEVER guess or override based on any filter!
- Allowed values: "Cassette" | "CD" | "Vinyl" | "8-Track Cartridge" | "Reel-To-Reel" | "MiniDisc" | "DAT" | "DVD" | "VHS" | "LaserDisc" | "Blu-ray" | "Betamax" | "UMD" | "Shellac" | "SACD" | "File" | "Box Set" | "Unknown".
- Classify ALL vinyl record sizes/types (LP, 12", 7", 10", Flexi-disc, Lathe Cut) as "Vinyl".

PHOTO ROLE IDENTIFICATION (DO NOT ASSUME SLOT ORDER):
- Photos are submitted as [Photo 0], [Photo 1], ... in arbitrary order. NEVER assume Photo 0 is Front or Photo 2 is Spine!
- Return "photo_roles": an array of exact length ${stagedPhotos.length}, identifying each photo's true visual role as "front" | "back" | "spine" | "extra".
- If any photo shows a spine, inspect it closely for catalog #, country text, cut-out markings (hole punches, saw cuts, notched corners, promo stamps), AND return "spine_crop" with its exact 0-based "photo_index".
- If ONLY the bare cassette shell or bare disc is shown (no case, no J-card, no cover insert), set "has_case_or_insert": false and note loose media in "physical_details".

FRANKEN-COPY DETECTOR (PACKAGING VS. PHYSICAL MEDIA MISMATCH — CRITICAL):
- Independently read BOTH:
  1) PACKAGING (J-card / outer jacket / jewel case insert / box) -> return "packaging_identity": { "artist", "title", "catno", "format", "label", "year" }
  2) PHYSICAL MEDIA (cassette shell / CD disc face / vinyl center label) -> return "media_identity": { "artist", "title", "catno", "format", "label", "year" }
- Compare Packaging vs. Physical Media carefully!
  * If they match (or only one is visible), set "mismatch_type": "none" and "mismatch_reason": "".
  * If the tape/disc is a DIFFERENT ALBUM or ARTIST than the case/J-card/jacket, set "mismatch_type": "different_album".
  * If they are the same album but clearly a DIFFERENT PRESSING/REISSUE/LABEL/CAT# (e.g. 1st-press jacket with later reissue vinyl label, or club J-card with retail shell), set "mismatch_type": "different_pressing".
  * If the format/packaging doesn't match the media inside, set "mismatch_type": "different_format".
  * Whenever "mismatch_type" !== "none", write a crisp factual 1-sentence "mismatch_reason" (e.g., "J-card is Barry Manilow (Arista ATC 8601), but the cassette shell is The Doors — The Doors.").

OCR RULES:
- Ignore non-catalog manufacturing/tax/standard codes (Dolby, HX Pro, TSE, TS-2240, KTB, JASRAC, GEMA, BIEM) for "raw_catalog_number".
- Read EVERY visible song title verbatim in "visible_tracks" so we can verify Discogs listings against the actual media.
- Read exact physical shell/window/spine/pressing clues: shell color, timing window markings ("100-50-0" vs "0-50-0" vs blank vs dots), plant codes ("SR", "AR", "CR"), screws vs welded, paper label vs direct print, club stamps ("CRC", "BMG"), country/address text, copyright years, and cut-out markings.
- ANTI-HALLUCINATION CLUB RULE: NEVER guess "CRC" or "BMG" unless you quote the EXACT legible club text visibly printed in the photo inside "club_evidence". Otherwise set "club_evidence": "" and "club_edition": "None" or "Unknown".

AUTO-CROP & SPINE ORIENTATION RULES:
- Return "photo_crops": an array of exact length ${stagedPhotos.length}, where EVERY entry is a tight [ymin, xmin, ymax, xmax] box (0-1000 normalized) tightly framing the physical media/case/sleeve/spine (NEVER return null even if tightly framed!).
- Return "spine_rotation": integer 0 | 90 | 180 | 270 — inspect which direction the TOPS of the printed letters on the spine face: top -> 0, bottom (upside-down!) -> 180, left -> 90, right -> 270.`;

    const prompt = shouldGradeNow
      ? `You are a meticulous physical music media OCR, Franken-Copy detector, Discogs pressing-ID, and strict Goldmine visual grading expert. Inspect ALL attached photos carefully. ${upcHint}
${sharedOcrInstructions}

STRICT DISCOGS SELLER GRADING RULES (Be brutally honest and conservative — never over-grade!):
1. List every flaw first in "media_defects" and "sleeve_defects" (including cut-out saw cuts, hole punches, notched spines/corners, promo stamps).
2. Media Condition MUST be one of: ${JSON.stringify(MEDIA_GRADES.filter(g => g !== 'Not Graded'))}
3. Sleeve Condition MUST be one of: ${JSON.stringify(SLEEVE_GRADES)} (No case/cover or wrong-album case = "No Cover"; blank replacement = "Generic").
4. When between two grades, ALWAYS pick the LOWER grade. NEVER say "mint" unless factory sealed.
5. TRANSCRIBE VERBATIM any notable ink stamps, radio/library/club property stamps, promo stamps, stickers, or handwritten markings in "condition_note".

Return ONLY valid JSON:
{
  "detected_format": "Cassette" | "CD" | "Vinyl" | "8-Track Cartridge" | "Reel-To-Reel" | "MiniDisc" | "DAT" | "DVD" | "VHS" | "LaserDisc" | "Blu-ray" | "Betamax" | "UMD" | "Shellac" | "SACD" | "File" | "Box Set" | "Unknown",
  "has_case_or_insert": true | false,
  "mismatch_type": "none" | "different_album" | "different_pressing" | "different_format",
  "mismatch_reason": "concise 1-sentence factual mismatch explanation, or empty string if none",
  "media_identity": { "artist": "", "title": "", "catno": "", "format": "", "label": "", "year": "" },
  "packaging_identity": { "artist": "", "title": "", "catno": "", "format": "", "label": "", "year": "" },
  "raw_catalog_number": "exact record-label catalog code or empty string",
  "cleaned_catalog_variants": ["catalog variations stripping hyphens/spaces/price prefixes"],
  "barcode": "digits only UPC/EAN if visible, else empty string",
  "album_title": "album or release title (from physical media if Franken-Copy)",
  "artists": ["main artist name(s), or 'Various' if a compilation"],
  "label": "record label name or empty string",
  "year": "4-digit copyright/release year printed, else empty string",
  "country_clues": "country printed or 'Not visible'",
  "club_edition": "None" | "CRC" | "BMG" | "Unknown",
  "club_evidence": "exact quoted club text visible in photo, or empty string",
  "physical_details": "detailed plain-English list of EVERY visible physical pressing identifier",
  "photo_roles": ["front" | "back" | "spine" | "extra" for each submitted photo in order],
  "photo_crops": [[ymin, xmin, ymax, xmax] for each submitted photo in order],
  "spine_rotation": 0 | 90 | 180 | 270,
  "spine_crop": null or { "photo_index": 0-based photo index containing the clearest spine, "box_2d": [ymin, xmin, ymax, xmax], "rotation_hint": "0" | "90cw" | "90ccw" | "180" },
  "media_defects": ["list every flaw on cassette/disc, or empty array if spotless"],
  "sleeve_defects": ["list every flaw on case/insert/spine including cut-out holes/saw cuts and verbatim stamps/stickers"],
  "media_condition": "exact Discogs media grade",
  "sleeve_condition": "exact Discogs sleeve grade",
  "condition_note": "blunt factual seller note listing visible flaws + verbatim stamps/stickers/handwriting",
  "visible_tracks": ["every song title clearly visible on shell/insert"]
}`
      : `You are a fast, meticulous physical music media OCR, Franken-Copy detector, and Discogs pressing-ID expert. Inspect ALL attached photos carefully. ${upcHint}
${sharedOcrInstructions}

Return ONLY valid JSON:
{
  "detected_format": "Cassette" | "CD" | "Vinyl" | "8-Track Cartridge" | "Reel-To-Reel" | "MiniDisc" | "DAT" | "DVD" | "VHS" | "LaserDisc" | "Blu-ray" | "Betamax" | "UMD" | "Shellac" | "SACD" | "File" | "Box Set" | "Unknown",
  "has_case_or_insert": true | false,
  "mismatch_type": "none" | "different_album" | "different_pressing" | "different_format",
  "mismatch_reason": "concise 1-sentence factual mismatch explanation, or empty string if none",
  "media_identity": { "artist": "", "title": "", "catno": "", "format": "", "label": "", "year": "" },
  "packaging_identity": { "artist": "", "title": "", "catno": "", "format": "", "label": "", "year": "" },
  "raw_catalog_number": "exact record-label catalog code or empty string",
  "cleaned_catalog_variants": ["catalog variations stripping hyphens/spaces/price prefixes"],
  "barcode": "digits only UPC/EAN if visible, else empty string",
  "album_title": "album or release title (from physical media if Franken-Copy)",
  "artists": ["main artist name(s), or 'Various' if a compilation"],
  "label": "record label name or empty string",
  "year": "4-digit copyright/release year printed, else empty string",
  "country_clues": "country printed or 'Not visible'",
  "club_edition": "None" | "CRC" | "BMG" | "Unknown",
  "club_evidence": "exact quoted club text visible in photo, or empty string",
  "physical_details": "detailed plain-English list of EVERY visible physical pressing identifier",
  "photo_roles": ["front" | "back" | "spine" | "extra" for each submitted photo in order],
  "photo_crops": [[ymin, xmin, ymax, xmax] for each submitted photo in order],
  "spine_rotation": 0 | 90 | 180 | 270,
  "spine_crop": null or { "photo_index": 0-based photo index containing the clearest spine, "box_2d": [ymin, xmin, ymax, xmax], "rotation_hint": "0" | "90cw" | "90ccw" | "180" },
  "visible_tracks": ["every song title clearly visible on shell/insert"]
}`;

    const slotEntries = getStagedSlotEntries();
    const parts = [{ text: prompt }];
    slotEntries.forEach((entry, idx) => {
      if (!entry.photo?.apiB64) return;
      parts.push({ text: `[Photo ${idx}]` });
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: entry.photo.apiB64 } });
    });

    try {
      const ext = await CC.callAI(parts, 'MEDIUM', { retryLabel: 'Photo Vision' });
      if (myRunId !== scanRunId) return false;

      // Preserve Gemini's TRUE visual detected_format (NEVER overwrite with activeFormat!)
      const rawFmt = String(ext.detected_format || '').trim();
      ext.detected_format = (rawFmt && !/^unknown$/i.test(rawFmt)) ? CC.normalizeDiscogsFormat(rawFmt) : 'Unknown';

      // Anti-hallucination guard: never accept CRC/BMG without quoted visible evidence
      if ((ext.club_edition === 'CRC' || ext.club_edition === 'BMG') && !String(ext.club_evidence || '').trim()) {
        ext.club_edition = 'Unknown';
      }

      // Smart role auto-assignment from Gemini's detected photo_roles
      const rawRoles = Array.isArray(ext.photo_roles) ? ext.photo_roles : [];
      let anyPhotoChanged = false;
      if (rawRoles.length === slotEntries.length) {
        const rolePlan = slotEntries.map((entry, idx) => ({
          photo: entry.photo,
          role: String(rawRoles[idx] || entry.slotKey || 'extra').toLowerCase()
        }));
        if (applyDetectedRolesToStagedSlots(rolePlan)) anyPhotoChanged = true;
      }

      // Auto-crop ONLY photos not already auto-cropped (avoids redundant double Gemini/crop work!)
      const spec = getPhotoQualitySpec();
      const rawPhotoCrops = Array.isArray(ext.photo_crops) ? ext.photo_crops : [];
      const exactSpineRot = [0, 90, 180, 270].includes(Number(ext.spine_rotation)) ? Number(ext.spine_rotation) : null;

      if (cfg.autoCropPhotos) {
        for (let i = 0; i < slotEntries.length; i++) {
          const p = slotEntries[i].photo;
          if (!p || p.autoCropped || p === stagedSlots.spine) continue;
          const box = rawPhotoCrops[i];
          if (!Array.isArray(box) || box.length !== 4 || !shouldApplyCropBox(box)) {
            p.autoCropped = true;
            continue;
          }
          const origUrl = p.origDataUrl || (p.apiB64 ? `data:image/jpeg;base64,${p.apiB64}` : p.saveWebp);
          const cropped = await cropImageByBox(origUrl, box, {
            minBoxSpan: 120,
            padFrac: 0.025,
            maxLongEdge: spec.raw ? null : spec.maxEdge,
            maxWidthOnly: false,
            rotationDeg: 0,
            quality: spec.quality
          });
          if (cropped) {
            p.saveWebp = cropped;
            p.cropBox = box;
            p.autoCropped = true;
            anyPhotoChanged = true;
          }
        }
      }

      ext.spine_thumb_url = stagedSpineThumbUrl || '';
      ext.spine_source_url = stagedSpineSourceUrl || '';
      ext.spine_flipped = Boolean(stagedSpineFlipped);

      const spineOrigIdx = slotEntries.findIndex(e => e.photo === stagedSlots.spine);
      const spineAlreadyCropped = Boolean(stagedSlots.spine?.spineCropped && stagedSpineThumbUrl);
      if (cfg.autoCropPhotos && !spineAlreadyCropped) {
        const effectiveSpineCrop = (ext.spine_crop && Array.isArray(ext.spine_crop.box_2d))
          ? ext.spine_crop
          : (spineOrigIdx >= 0 && Array.isArray(rawPhotoCrops[spineOrigIdx]) ? { photo_index: spineOrigIdx, box_2d: rawPhotoCrops[spineOrigIdx] } : null);

        if (effectiveSpineCrop) {
          // Ensure photo_index maps to the original submitted slotEntries photo!
          const srcPhoto = slotEntries[Number(effectiveSpineCrop.photo_index)]?.photo || stagedSlots.spine;
          if (srcPhoto) {
            const origUrl = srcPhoto.origDataUrl || (srcPhoto.apiB64 ? `data:image/jpeg;base64,${srcPhoto.apiB64}` : srcPhoto.saveWebp);
            const angle = exactSpineRot !== null ? exactSpineRot : 0;
            const thumbUrl = await cropImageByBox(origUrl, effectiveSpineCrop.box_2d, {
              minBoxSpan: 25,
              padFrac: 0.025,
              maxLongEdge: spec.raw ? null : spec.spineMaxW,
              maxWidthOnly: !spec.raw,
              rotationDeg: angle,
              quality: spec.quality
            });
            if (thumbUrl) {
              ext.spine_thumb_url = thumbUrl;
              ext.spine_source_url = origUrl;
              ext.spine_flipped = angle === 180;
              stagedSpineThumbUrl = thumbUrl;
              stagedSpineSourceUrl = origUrl;
              stagedSpineFlipped = angle === 180;
              if (stagedSlots.spine) {
                stagedSlots.spine.saveWebp = thumbUrl;
                stagedSlots.spine.cropBox = effectiveSpineCrop.box_2d;
                stagedSlots.spine.rotationDeg = angle;
                stagedSlots.spine.spineRotation = angle;
                stagedSlots.spine.autoCropped = true;
                stagedSlots.spine.spineCropped = true;
              }
              anyPhotoChanged = true;
            }
          }
        } else if (stagedSlots.spine && exactSpineRot !== null) {
          const spOrig = stagedSlots.spine.origDataUrl || stagedSlots.spine.saveWebp;
          const rotThumb = exactSpineRot === 0 ? stagedSlots.spine.saveWebp : await rotateDataUrlByDeg(spOrig, exactSpineRot, 'image/webp', spec.quality, spec.raw ? null : spec.spineMaxW);
          if (rotThumb) {
            ext.spine_thumb_url = rotThumb;
            ext.spine_source_url = spOrig;
            ext.spine_flipped = exactSpineRot === 180;
            stagedSpineThumbUrl = rotThumb;
            stagedSpineSourceUrl = spOrig;
            stagedSpineFlipped = exactSpineRot === 180;
            stagedSlots.spine.saveWebp = rotThumb;
            stagedSlots.spine.rotationDeg = exactSpineRot;
            stagedSlots.spine.spineRotation = exactSpineRot;
            stagedSlots.spine.autoCropped = true;
            stagedSlots.spine.spineCropped = true;
            anyPhotoChanged = true;
          }
        }
      }
      if (anyPhotoChanged) updateStageUI();

      // Franken-Copy detection & handling
      const mismatchType = ['different_album', 'different_pressing', 'different_format'].includes(String(ext.mismatch_type || '').toLowerCase())
        ? String(ext.mismatch_type).toLowerCase()
        : 'none';
      const mismatchReason = String(ext.mismatch_reason || '').trim();

      if (keepOldGrades && editingStashItem) {
        ext.media_condition = editingStashItem.media_condition || 'Not Graded';
        ext.sleeve_condition = editingStashItem.sleeve_condition || 'Not Graded';
        ext.condition_note = editingStashItem.condition_note || '';
        ext.graded_by_ai = false;
      } else if (!shouldGradeNow) {
        ext.media_condition = 'Not Graded';
        ext.sleeve_condition = (ext.has_case_or_insert === false || mismatchType === 'different_album' || mismatchType === 'different_format')
          ? 'No Cover'
          : 'Not Graded';
        ext.condition_note = mismatchType !== 'none' && mismatchReason ? `Franken-copy: ${mismatchReason}` : '';
        ext.graded_by_ai = false;
      } else {
        ext.graded_by_ai = true;
        if (mismatchType === 'different_album' || mismatchType === 'different_format') {
          ext.sleeve_condition = 'No Cover';
        }
        if (mismatchType !== 'none' && mismatchReason && !String(ext.condition_note || '').includes(mismatchReason)) {
          ext.condition_note = ext.condition_note ? `${ext.condition_note} Franken-copy: ${mismatchReason}` : `Franken-copy: ${mismatchReason}`;
        }
      }

      let frankenMediaUnverified = false;
      if (mismatchType !== 'none') {
        ext.is_franken_copy = true;
        ext.franken_type = mismatchType;
        ext.franken_note = mismatchReason;
        const medId = ext.media_identity && typeof ext.media_identity === 'object' ? ext.media_identity : {};
        const pkgId = ext.packaging_identity && typeof ext.packaging_identity === 'object' ? ext.packaging_identity : {};
        const mediaReadable = isIdentityReadable(medId);
        const pkgReadable = isIdentityReadable(pkgId);
        frankenMediaUnverified = Boolean(!mediaReadable && pkgReadable);

        frankenState = {
          active: true,
          mode: 'media',
          mismatchType,
          reason: mismatchReason,
          media: medId,
          packaging: pkgId,
          mediaUnverified: frankenMediaUnverified,
          origBarcode: (ext.barcode || '').replace(/\D/g, ''),
          origCatalogVariants: Array.isArray(ext.cleaned_catalog_variants) ? ext.cleaned_catalog_variants.slice() : [],
          origDetectedFormat: ext.detected_format || 'Unknown'
        };

        // STRICT FRANKEN-COPY EVIDENCE ISOLATION in 'media' mode:
        // Populate search fields & cleaned_catalog_variants STRICTLY from media_identity — NEVER inherit packaging's catno/label/year/barcode!
        const mTitle = cleanFrankenField(medId.title);
        const mArtist = cleanFrankenField(medId.artist);
        const mCatno = cleanFrankenField(medId.catno);
        const mLabel = cleanFrankenField(medId.label);
        const mYear = cleanFrankenField(medId.year);
        const mFmt = cleanFrankenField(medId.format);
        const mBarcode = String(medId.barcode || '').replace(/\D/g, '');

        ext.album_title = mTitle;
        ext.artists = mArtist ? [mArtist] : [];
        ext.raw_catalog_number = mCatno;
        ext.cleaned_catalog_variants = buildCatalogVariantsFromCatno(mCatno);
        ext.label = mLabel;
        ext.year = mYear;
        ext.barcode = mBarcode;
        if (mFmt && !/^unknown$/i.test(mFmt)) {
          ext.detected_format = CC.normalizeDiscogsFormat(mFmt);
        }

        renderFrankenBanner();
        if (frankenMediaUnverified) {
          toast('⚠️ Franken-Copy: physical media unreadable — retake close-up or tap Verify Packaging Instead', 5200);
        } else {
          toast(`🧟 Franken-Copy detected (${mismatchType.replace(/_/g, ' ')}) — defaulting to physical media!`, 4600);
        }
      } else {
        ext.is_franken_copy = false;
        ext.franken_type = '';
        ext.franken_note = '';
      }

      currentExtracted = ext;

      document.getElementById('fTitle').value = ext.album_title || '';
      document.getElementById('fArtist').value = Array.isArray(ext.artists) ? ext.artists.join(', ') : (ext.artists || '');
      document.getElementById('fCatno').value = ext.raw_catalog_number || '';
      // In Franken-Copy media mode, NEVER fall back to packaging's scanned UPC or packaging barcode!
      const useBarcode = (mismatchType !== 'none')
        ? String(ext.barcode || '').replace(/\D/g, '')
        : (stagedUpc || (ext.barcode || '').replace(/\D/g, ''));
      document.getElementById('fBarcode').value = useBarcode;
      if (ext.detected_format && ext.detected_format !== 'Unknown') {
        setSelectFormatValue('fFormat', ext.detected_format);
      }
      document.getElementById('fLabel').value = ext.label || '';
      document.getElementById('fYear').value = ext.year || '';

      const effFilter = getEffectiveScanFormat();
      if (effFilter !== 'Auto' && ext.detected_format !== 'Unknown' && !CC.matchesMediaFormat(ext.detected_format, effFilter)) {
        toast(`⚠️ Photo shows ${ext.detected_format}, but filter is set to ${effFilter}`, 4800);
      }

      const clues = [
        ext.is_franken_copy ? `🧟 Franken-Copy: ${ext.franken_note || ext.franken_type}` : '',
        ext.has_case_or_insert === false ? 'Loose media (no case/insert)' : '',
        ext.country_clues && ext.country_clues !== 'Not visible' ? `Country: ${ext.country_clues}` : '',
        ext.club_edition && ext.club_edition !== 'Unknown' ? `Club: ${ext.club_edition}${ext.club_evidence ? ` ("${ext.club_evidence}")` : ''}` : '',
        ext.physical_details ? `Clues: ${ext.physical_details}` : ''
      ].filter(Boolean).join(' · ');
      document.getElementById('detectedCluesLine').textContent = clues;

      if (frankenMediaUnverified) {
        setStatus('', false);
        return false;
      }

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
    const visualFmt = (currentExtracted?.detected_format && currentExtracted.detected_format !== 'Unknown')
      ? currentExtracted.detected_format
      : '';
    const effFmt = getEffectiveScanFormat();
    const manualFmt = document.getElementById('fFormat').value;
    const format = effFmt === 'Auto'
      ? (visualFmt || (stagedPhotos.length === 0 ? manualFmt : ''))
      : (effFmt === 'Other' ? '' : effFmt);
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
              <span class="badge badge-mono">👥 ${have} have · ${want} want</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function candidateMatchesVisualFormat(dossierOrCand, visualFmt) {
    if (!visualFmt || visualFmt === 'Unknown' || visualFmt === 'Auto') return true;
    const rawFmt = dossierOrCand?.formats || dossierOrCand?.format || '';
    return CC.matchesMediaFormat(rawFmt, visualFmt);
  }

  // ==================== TWO-TIER ZERO-GUESSING VERIFICATION ENGINE ====================
  async function verifyCandidateBatch(batch, myRunId, opts = {}) {
    const { maxSiblings = 8, progressPrefix = '🕵️', retryLabel = 'Verification' } = opts;
    const dossiers = [];
    const batchFetchedIds = new Set();
    const refQueue = [];

    const visualFormat = (currentExtracted?.detected_format && currentExtracted.detected_format !== 'Unknown')
      ? currentExtracted.detected_format
      : '';
    const requestedFormat = getEffectiveScanFormat();
    const formatMismatch = Boolean(requestedFormat !== 'Auto' && visualFormat && !CC.matchesMediaFormat(visualFormat, requestedFormat));

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

RULE #0.5 — FRANKEN-COPY / PACKAGING-VS-MEDIA GUARD (CRITICAL):
- Always inspect BOTH the physical media (cassette shell / CD disc / vinyl label) AND any visible packaging (J-card / jacket / insert).
- If the physical media contradicts the packaging (different album/artist/pressing), NEVER silently return "likely_match" or "exact_match" for the packaging while ignoring a different tape/disc! Verify strictly against the active target identity (${frankenState?.active ? (frankenState.mode === 'packaging' ? 'PACKAGING (user explicitly chose packaging)' : 'PHYSICAL MEDIA (default for Franken-Copy)') : 'PHYSICAL MEDIA & matching packaging'}).

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
    const myInspectSeq = ++inspectSeq;
    setStatus('Loading Discogs price, collection status, tracklist & Taste check...', true);

    try {
      const release = await CC.getReleaseCached(cand.id);
      if (myRunId !== scanRunId || myInspectSeq !== inspectSeq) return;

      let statsOk = false;
      let stats = null;
      try {
        const sRes = await CC.discogsFetch(`/marketplace/stats/${cand.id}`);
        if (sRes && typeof sRes === 'object') {
          stats = sRes;
          statsOk = true;
        }
      } catch (_) {
        statsOk = false;
        stats = null;
      }
      if (myRunId !== scanRunId || myInspectSeq !== inspectSeq) return;

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
      if (myRunId !== scanRunId || myInspectSeq !== inspectSeq) return;

      const artistName = cleanDiscogsArtist(release.artists) ||
                         (cand.title.includes(' - ') ? cand.title.split(' - ')[0] : '');
      const albumTitle = release.title || (cand.title.includes(' - ') ? cand.title.split(' - ').slice(1).join(' - ') : cand.title);
      const catno = release.labels?.[0]?.catno || cand.catno || document.getElementById('fCatno').value.trim();
      const label = release.labels?.[0]?.name || (Array.isArray(cand.label) ? cand.label[0] : '');
      const effFmt = getEffectiveScanFormat();
      const format = (Array.isArray(release.formats) && release.formats.length)
        ? CC.normalizeDiscogsFormat(release.formats)
        : (effFmt !== 'Auto' && effFmt !== 'Other' ? effFmt : document.getElementById('fFormat').value);
      const masterId = Number(release.master_id || 0) || null;

      const tracklist = (release.tracklist || [])
        .filter(t => t.type_ !== 'heading')
        .map(t => ({ pos: t.position || '', artist: cleanDiscogsArtist(t.artists), title: t.title || '' }));

      // Honest Discogs outage handling: if /marketplace/stats failed, NEVER fake 0 listed / SCARCE or stamp synced_at!
      const lowestPrice = statsOk ? (stats?.lowest_price?.value ?? release.lowest_price ?? null) : null;
      const lowestCurrency = statsOk ? (stats?.lowest_price?.currency || 'USD') : 'USD';
      const numForSale = statsOk ? (stats?.num_for_sale ?? release.num_for_sale ?? 0) : null;
      const vgPlusPrice = suggestions?.['Very Good Plus (VG+)']?.value ?? null;
      const vgPlusCurrency = suggestions?.['Very Good Plus (VG+)']?.currency || lowestCurrency || 'USD';
      const estPrice = vgPlusPrice ?? lowestPrice;
      const estCurrency = vgPlusPrice !== null ? vgPlusCurrency : lowestCurrency;
      const estUsd = toApproxUsd(estPrice, estCurrency);
      const have = release.community?.have ?? 0;
      const want = release.community?.want ?? 0;

      // Currency-aware High-Value threshold (compares approximate USD value against USD threshold)
      const isHighValue = estUsd !== null && estUsd >= Number(cfg.threshold || 20);
      const isScarce = statsOk && numForSale === 0 && (want >= 10 || (want > have && want >= 5));

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
        num_for_sale: numForSale, stats_ok: statsOk, have, want, is_high_value: isHighValue, is_scarce: isScarce,
        discogs_owned_count: liveDiscogsInstances.length,
        other_pressing_matches: otherPressingMatches,
        is_conservative_tiebreak: Boolean(opts.isConservativeTiebreak),
        tracklist, pressing_notes: notesParts.join('\n').trim(),
        discogs_details_synced_at: statsOk ? Date.now() : 0,
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
      await runTasteAnalysis(currentInspected, myRunId, myInspectSeq);
    } catch (err) {
      if (myRunId !== scanRunId || myInspectSeq !== inspectSeq) return;
      setStatus('', false);
      toast('Error loading release: ' + err.message, 4000);
    }
  };

  window.inspectUnlistedItem = async () => {
    const myRunId = scanRunId;
    const myInspectSeq = ++inspectSeq;
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
      format: (() => { const ef = getEffectiveScanFormat(); return (ef !== 'Auto' && ef !== 'Other') ? ef : document.getElementById('fFormat').value; })(),
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
      est_price: null, est_currency: 'USD', est_usd: null, num_for_sale: null, stats_ok: true,
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
    await runTasteAnalysis(currentInspected, myRunId, myInspectSeq);
  };

  function buildTracklistHtml(tracks, matched = [], source = 'scan', defaultArtist = '', altMatched = []) {
    const exactSet = new Set((matched || []).flatMap(m => [CC.normTrackEdition(m), norm(m)]).filter(Boolean));
    const altSet = new Set((altMatched || []).flatMap(m => [CC.normTrackLoose(m), norm(m)]).filter(Boolean));
    if (!tracks.length) return `<div style="padding:12px; color:var(--muted); font-size:0.84rem;">No tracklist available.</div>`;
    const fallbackArtist = defaultArtist || (source === 'stash' ? activeStashItem?.artist : currentInspected?.artist) || '';
    return tracks.map((t, i) => {
      const fullLbl = t.artist ? `${t.artist} - ${t.title}` : t.title;
      const exactHit = exactSet.has(CC.normTrackEdition(t.title)) || exactSet.has(norm(t.title)) || (t.artist && (exactSet.has(CC.normTrackEdition(fullLbl)) || exactSet.has(norm(fullLbl))));
      const altHit = !exactHit && (altSet.has(CC.normTrackLoose(t.title)) || altSet.has(norm(t.title)) || (t.artist && (altSet.has(CC.normTrackLoose(fullLbl)) || altSet.has(norm(fullLbl)))));
      const fn = source === 'stash' ? `previewStashTrack(${i})` : `previewTrackByIndex(${i})`;
      const trackArtist = t.artist || fallbackArtist;
      const trackTitle = t.title || '';
      const playKey = normFull(`${trackArtist}|${trackTitle}`);
      const badgeHtml = exactHit
        ? '<span class="badge badge-green" style="margin:0;">Spotify</span>'
        : (altHit ? '<span class="badge badge-blue" style="margin:0;" title="You like a different version (live/acoustic/remix/edit)">Alt Version</span>' : '');
      return `<div class="track-row ${exactHit ? 'track-hit' : ''}">
        <div class="track-info">
          <div class="track-name">${esc(t.pos ? t.pos + ' · ' : '')}${esc(t.title)}</div>
          ${t.artist ? `<div class="track-sub">${esc(t.artist)}</div>` : ''}
        </div>
        ${badgeHtml}
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
        <div><strong>▶️ Test Song:</strong> ${showArt ? `${esc(lArt)} — ` : ''}${esc(item.litmus_track)}</div>
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
    const effFmtFilter = getEffectiveScanFormat();
    const visFmt = (currentExtracted?.detected_format && currentExtracted.detected_format !== 'Unknown') ? currentExtracted.detected_format : '';
    if (effFmtFilter !== 'Auto' && visFmt && !CC.matchesMediaFormat(visFmt, effFmtFilter)) {
      alerts += `<div class="alert-box alert-format-warn">⚠️ Photo shows ${esc(visFmt)}, but format filter is set to ${esc(effFmtFilter)}.</div>`;
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
    document.getElementById('mForSale').textContent = (hasDiscogs && item.stats_ok === false)
      ? 'Unavailable'
      : (item.num_for_sale !== null ? `${item.num_for_sale} listed` : '—');
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
    setVoiceCancelVisible('scan', false);

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
    document.getElementById('inspTracklist').innerHTML = buildTracklistHtml(item.tracklist, localMatch.matchedTracks, 'scan', item.artist, localMatch.altMatchedTracks);
    syncTrackPlayButtons();

    document.getElementById('tasteLocalBadges').innerHTML = buildSpotifyHowYouKnowHtml(item, localMatch, true);
    renderInspectorPhotosToSave();

    document.getElementById('tasteScore').textContent = '...';
    document.getElementById('tasteBody').textContent = `Analyzing against your Taste Profile & Soft Spots on ${aiEngineLabel()}...`;
    document.getElementById('contextBox').classList.add('hidden');
    document.getElementById('tasteHits').innerHTML = '';
  }

  function joinHumanList(items) {
    const arr = (items || []).filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
    return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
  }

  function dedupeStringsCI(list) {
    const out = [];
    const seen = new Set();
    (list || []).forEach(v => {
      const s = String(v || '').trim();
      const k = norm(s);
      if (s && k && !seen.has(k)) {
        seen.add(k);
        out.push(s);
      }
    });
    return out;
  }

  function buildSpotifyHowYouKnowHtml(item, localMatch, includeSetupHint = false) {
    const wrap = (bodyHtml) => `<div class="spotify-know-card"><div class="spotify-know-title">💚 HOW YOU KNOW THEM</div><div class="spotify-know-body">${bodyHtml}</div></div>`;
    if (!spotifyProfile) {
      const hasDna = Boolean(document.getElementById('cfgTasteDna')?.value?.trim());
      if (includeSetupHint && !hasDna) {
        return wrap('Connect Spotify or add a Taste Profile in Settings to see how this release connects to your library.');
      }
      return wrap('Not synced with Spotify yet — score is based on your Taste Profile, genre, and era.');
    }

    const lm = localMatch || {};
    const artistMatches = Array.isArray(lm.artistMatches) ? lm.artistMatches : [];
    const albumHits = Array.isArray(lm.albumTrackHits) ? lm.albumTrackHits : [];

    if (!artistMatches.length && !albumHits.length) {
      return wrap('Not in your Spotify library yet — score is based on genre and era match.');
    }

    const q = (s) => `&ldquo;${esc(s)}&rdquo;`;
    const isCompilation = Boolean(lm.isVarious || (artistMatches.length > 1 && /^various/i.test(String(item?.artist || '').trim())));

    // Helper: Priority #1 "On this release" lead sentence separating exact/remaster hits from loose alt-version hits!
    const buildOnReleaseSentence = (includeArtistPrefix) => {
      if (!albumHits.length) return '';
      const fmtHit = (h) => (includeArtistPrefix && h.artist) ? `${esc(h.artist)} &mdash; ${q(h.title)}` : q(h.title);
      const exactHits = albumHits.filter(h => h.matchQuality !== 'alt_version');
      const altHits = albumHits.filter(h => h.matchQuality === 'alt_version');

      const likedOnRel = exactHits.filter(h => h.liked);
      const topOrAlbOnRel = exactHits.filter(h => !h.liked && (h.top || h.album));
      const plOnlyOnRel = exactHits.filter(h => !h.liked && !h.top && !h.album);

      const clauses = [];
      if (likedOnRel.length) {
        const list = joinHumanList(likedOnRel.slice(0, 4).map(fmtHit));
        const more = likedOnRel.length > 4 ? ` (+${likedOnRel.length - 4} more)` : '';
        clauses.push(`You have <strong>${likedOnRel.length} liked song${likedOnRel.length === 1 ? '' : 's'}</strong> right on this media — ${list}${more}`);
      }
      if (topOrAlbOnRel.length) {
        const list = joinHumanList(topOrAlbOnRel.slice(0, 3).map(fmtHit));
        const more = topOrAlbOnRel.length > 3 ? ` (+${topOrAlbOnRel.length - 3} more)` : '';
        clauses.push(`${clauses.length ? 'plus ' : ''}${topOrAlbOnRel.length} top/saved-album track${topOrAlbOnRel.length === 1 ? '' : 's'} (${list}${more})`);
      }
      if (plOnlyOnRel.length) {
        const list = joinHumanList(plOnlyOnRel.slice(0, 3).map(fmtHit));
        const more = plOnlyOnRel.length > 3 ? ` (+${plOnlyOnRel.length - 3} more)` : '';
        clauses.push(`${clauses.length ? 'and ' : 'you have '}${plOnlyOnRel.length} playlist track${plOnlyOnRel.length === 1 ? '' : 's'} (${list}${more})`);
      }
      if (altHits.length) {
        const altList = joinHumanList(altHits.slice(0, 3).map(h => {
          const base = fmtHit(h);
          const hint = h.matchedSpotifyTitle && norm(h.matchedSpotifyTitle) !== norm(h.title)
            ? ` (you like &ldquo;${esc(h.matchedSpotifyTitle)}&rdquo;)`
            : ' (you like a live/alt version)';
          return `${base}${hint}`;
        }));
        const more = altHits.length > 3 ? ` (+${altHits.length - 3} more)` : '';
        clauses.push(`${clauses.length ? 'plus another version you like: ' : 'Another version you like: '}${altList}${more}`);
      }
      if (!clauses.length) {
        const list = joinHumanList(albumHits.slice(0, 4).map(fmtHit));
        const more = albumHits.length > 4 ? ` (+${albumHits.length - 4} more)` : '';
        clauses.push(`You already have <strong>${albumHits.length}</strong> track${albumHits.length === 1 ? '' : 's'} from this media in Spotify — ${list}${more}`);
      }
      return `⭐ <strong>On this release:</strong> ${clauses.join(', ')}.`;
    };

    // Various Artists / Compilation narrative — lead with On-Release hits, and NEVER list 0-liked artists as "liked songs"!
    if (isCompilation) {
      const sentences = [];
      const onRel = buildOnReleaseSentence(true);
      if (onRel) sentences.push(onRel);

      const likedArts = artistMatches.filter(a => (a.likedSongs || []).length > 0);
      const followedOrTopZeroLiked = artistMatches.filter(a => (a.likedSongs || []).length === 0 && (a.isFollowed || a.isTopArtist || (a.topTracks || []).length > 0 || (a.albumTracks || []).length > 0));
      const plOnlyArts = artistMatches.filter(a => !likedArts.includes(a) && !followedOrTopZeroLiked.includes(a));

      if (likedArts.length) {
        const names = likedArts.slice(0, 4).map(a => `<strong>${esc(a.name)}</strong> (${a.likedSongs.length} liked)`);
        const extra = likedArts.length > 4 ? ` and ${likedArts.length - 4} more` : '';
        sentences.push(`Featured artists you have liked songs from: ${joinHumanList(names)}${extra}.`);
      }
      if (followedOrTopZeroLiked.length) {
        const names = followedOrTopZeroLiked.slice(0, 4).map(a => {
          const tags = [];
          if (a.isFollowed) tags.push('followed');
          if (a.isTopArtist) tags.push('top artist');
          if ((a.topTracks || []).length) tags.push(`${a.topTracks.length} top`);
          if ((a.albumTracks || []).length) tags.push(`${a.albumTracks.length} saved-album`);
          return `<strong>${esc(a.name)}</strong>${tags.length ? ` (${tags.join(', ')})` : ''}`;
        });
        const extra = followedOrTopZeroLiked.length > 4 ? ` +${followedOrTopZeroLiked.length - 4} more` : '';
        sentences.push(`Followed / top artists (0 liked songs): ${joinHumanList(names)}${extra}.`);
      }
      if (plOnlyArts.length) {
        const names = plOnlyArts.slice(0, 4).map(a => esc(a.name));
        const extra = plOnlyArts.length > 4 ? ` +${plOnlyArts.length - 4} more` : '';
        sentences.push(`Playlist-only appearances (0 liked songs): ${joinHumanList(names)}${extra}.`);
      }
      return wrap(sentences.join(' '));
    }

    // Standard single/primary artist narrative — Priority #1 leads with On-Release track hits!
    const sentences = [];
    const onRel = buildOnReleaseSentence(false);
    if (onRel) sentences.push(onRel);

    const primary = artistMatches[0];
    if (primary) {
      const nameHtml = `<strong>${esc(primary.name)}</strong>`;
      const liked = primary.likedSongs || [];
      const topTrs = (primary.topTracks || []).filter(t => !liked.some(l => CC.normTrackBase(l) === CC.normTrackBase(t)));
      const albTrs = (primary.albumTracks || []).filter(t => !liked.some(l => CC.normTrackBase(l) === CC.normTrackBase(t)) && !topTrs.some(x => CC.normTrackBase(x) === CC.normTrackBase(t)));
      const pls = primary.playlists || [];
      const plMap = primary.playlistTrackMap || {};
      const followParts = [];
      if (primary.isFollowed) followParts.push('you follow them');
      if (primary.isTopArtist) followParts.push("they're one of your Top Artists");

      const extraSources = [];
      if (topTrs.length) {
        const sample = joinHumanList(topTrs.slice(0, 3).map(q));
        extraSources.push(`${topTrs.length} top track${topTrs.length === 1 ? '' : 's'} (${sample}${topTrs.length > 3 ? ` +${topTrs.length - 3} more` : ''})`);
      }
      if (albTrs.length) {
        const sample = joinHumanList(albTrs.slice(0, 3).map(q));
        extraSources.push(`${albTrs.length} saved-album track${albTrs.length === 1 ? '' : 's'} (${sample}${albTrs.length > 3 ? ` +${albTrs.length - 3} more` : ''})`);
      }

      if (liked.length >= 1 && liked.length <= 3) {
        const songList = joinHumanList(liked.map(q));
        let s = `Across Spotify, you have <strong>${liked.length}</strong> liked song${liked.length === 1 ? '' : 's'} by ${nameHtml}: ${songList}`;
        if (extraSources.length) s += `, plus ${joinHumanList(extraSources)}`;
        if (pls.length) {
          s += `, and they appear on ${joinHumanList(pls.slice(0, 3).map(p => `<em>${esc(p)}</em>`))}`;
        }
        if (followParts.length) {
          s += ` (${followParts.join(', ')})`;
        }
        sentences.push(s + '.');
      } else if (liked.length >= 4) {
        const examples = joinHumanList(liked.slice(0, 3).map(q));
        let s = `Across Spotify, you have <strong>${liked.length}</strong> liked songs by ${nameHtml} (including ${examples})`;
        if (extraSources.length) s += `, plus ${joinHumanList(extraSources)}`;
        if (followParts.length) s += ` and ${followParts.join(' — ')}`;
        if (pls.length) s += `, across ${joinHumanList(pls.slice(0, 3).map(p => `<em>${esc(p)}</em>`))}`;
        sentences.push(s + '.');
      } else {
        const plEntries = [];
        Object.entries(plMap).slice(0, 3).forEach(([plName, trs]) => {
          const uniqTrs = dedupeStringsCI(trs).slice(0, 3);
          if (uniqTrs.length) plEntries.push(`${joinHumanList(uniqTrs.map(q))} on <em>${esc(plName)}</em>`);
          else plEntries.push(`<em>${esc(plName)}</em>`);
        });
        let s = `You have <strong>0 liked songs</strong> by ${nameHtml}`;
        const qualifiers = [...extraSources];
        if (plEntries.length) {
          qualifiers.push(joinHumanList(plEntries));
        } else if (pls.length) {
          const sampleTrs = dedupeStringsCI(primary.tracks).slice(0, 3);
          qualifiers.push(sampleTrs.length
            ? `${joinHumanList(sampleTrs.map(q))} on ${joinHumanList(pls.slice(0, 3).map(p => `<em>${esc(p)}</em>`))}`
            : `appearances on ${joinHumanList(pls.slice(0, 3).map(p => `<em>${esc(p)}</em>`))}`);
        }
        if (qualifiers.length) {
          s += `, though you have ${joinHumanList(qualifiers)}`;
          if (followParts.length) s += ` (${followParts.join(', ')})`;
        } else if (followParts.length) {
          s += `, though ${joinHumanList(followParts)}`;
        } else {
          s += ` (playlist-only familiarity)`;
        }
        sentences.push(s + '.');
      }
    }

    return wrap(sentences.join(' '));
  }

  function buildSpotifyBadgesHtml(localMatch, includeSetupHint = false) {
    return buildSpotifyHowYouKnowHtml(currentInspected || activeStashItem || {}, localMatch, includeSetupHint);
  }

  const spLookupCache = new WeakMap();

  function normArtistKey(s) {
    return norm(s).replace(/^the\s+/, '').trim();
  }

  function mergeTrackSourceProv(prev, incoming) {
    if (!prev) {
      return {
        liked: Boolean(incoming?.liked),
        top: Boolean(incoming?.top),
        album: Boolean(incoming?.album),
        playlists: Array.isArray(incoming?.playlists) ? dedupeStringsCI(incoming.playlists) : []
      };
    }
    return {
      liked: Boolean(prev.liked || incoming?.liked),
      top: Boolean(prev.top || incoming?.top),
      album: Boolean(prev.album || incoming?.album),
      playlists: dedupeStringsCI([...(prev.playlists || []), ...(Array.isArray(incoming?.playlists) ? incoming.playlists : [])])
    };
  }

  function getSpotifyLookup(profile) {
    if (!profile) return null;
    if (spLookupCache.has(profile)) return spLookupCache.get(profile);

    const artistByKey = new Map();
    const editionPairSet = new Set();
    const editionSourceByPair = new Map();
    const loosePairSet = new Set();
    const looseSourceByPair = new Map();
    const looseTitleByPair = new Map();
    const hasProvenance = Boolean(profile.provenanceVersion >= 2 || profile.trackSources);

    const indexTrackPair = (na, rawTitle, src = null) => {
      if (!na || !rawTitle) return;
      const cleanTitle = String(rawTitle || '').trim();
      const edKey = CC.normTrackEdition(cleanTitle);
      const looseKey = CC.normTrackLoose(cleanTitle);

      if (edKey) {
        const pk = `${na}|${edKey}`;
        editionPairSet.add(pk);
        if (src) editionSourceByPair.set(pk, mergeTrackSourceProv(editionSourceByPair.get(pk), src));
      }
      if (looseKey) {
        const lk = `${na}|${looseKey}`;
        loosePairSet.add(lk);
        if (cleanTitle && !looseTitleByPair.has(lk)) looseTitleByPair.set(lk, cleanTitle);
        if (src) looseSourceByPair.set(lk, mergeTrackSourceProv(looseSourceByPair.get(lk), src));
      }
    };

    Object.entries(profile.allArtists || {}).forEach(([rawKey, rec]) => {
      const k1 = norm(rec?.name || rawKey);
      const k2 = normArtistKey(rec?.name || rawKey);
      if (k1 && !artistByKey.has(k1)) artistByKey.set(k1, rec);
      if (k2 && !artistByKey.has(k2)) artistByKey.set(k2, rec);
      if (Array.isArray(rec?.tracks)) {
        rec.tracks.forEach(tr => indexTrackPair(k2, tr, null));
      }
      if (hasProvenance) {
        (Array.isArray(rec?.likedTracks) ? rec.likedTracks : []).forEach(tr => indexTrackPair(k2, tr, { liked: true }));
        (Array.isArray(rec?.topTracks) ? rec.topTracks : []).forEach(tr => indexTrackPair(k2, tr, { top: true }));
        (Array.isArray(rec?.albumTracks) ? rec.albumTracks : []).forEach(tr => indexTrackPair(k2, tr, { album: true }));
      }
    });

    (profile.trackPairs || []).forEach(pair => {
      const sep = String(pair || '').indexOf('|');
      if (sep <= 0) return;
      indexTrackPair(normArtistKey(pair.slice(0, sep)), pair.slice(sep + 1), null);
    });

    if (profile.trackSources && typeof profile.trackSources === 'object') {
      Object.entries(profile.trackSources).forEach(([pair, src]) => {
        const sep = String(pair || '').indexOf('|');
        if (sep <= 0 || !src) return;
        indexTrackPair(normArtistKey(pair.slice(0, sep)), pair.slice(sep + 1), src);
      });
    }

    const lookup = {
      artistByKey,
      editionPairSet,
      editionSourceByPair,
      loosePairSet,
      looseSourceByPair,
      looseTitleByPair,
      pairSet: editionPairSet,
      trackSourceByPair: editionSourceByPair,
      hasProvenance
    };
    spLookupCache.set(profile, lookup);
    return lookup;
  }

  function checkLocalSpotify(item) {
    const isItemVarious = !item?.artist || /^various(\s+artists)?$/i.test(String(item.artist).trim());
    const empty = {
      hasProvenance: false,
      isVarious: isItemVarious,
      artistHit: false,
      matchedArtists: [],
      matchedTracks: [],
      altMatchedTracks: [],
      likedTrackMatches: [],
      playlistOnlyTrackMatches: [],
      likedArtistDetails: [],
      playlistOnlyArtistDetails: [],
      artistMatches: [],
      albumTrackHits: [],
      details: ''
    };
    const lookup = getSpotifyLookup(spotifyProfile);
    if (!lookup) return empty;

    const { artistByKey, editionPairSet, editionSourceByPair, loosePairSet, looseSourceByPair, looseTitleByPair, hasProvenance } = lookup;
    const matchedArtists = [];
    const likedArtistDetails = [];
    const playlistOnlyArtistDetails = [];
    const artistMatches = [];
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
          const pls = Array.isArray(rec.playlists) && rec.playlists.length ? rec.playlists.slice(0, 6) : [];
          const plsTag = pls.length ? ` [in: ${pls.slice(0, 3).join(', ')}]` : '';
          matchedArtists.push(`${displayName} (${trCount} songs${plsTag})`);

          const likedArr = Array.isArray(rec.likedTracks) ? rec.likedTracks : [];
          const topArr = Array.isArray(rec.topTracks) ? rec.topTracks : [];
          const albArr = Array.isArray(rec.albumTracks) ? rec.albumTracks : [];
          // Keep likedSongs strictly from likedArr when provenance is present — NEVER merge topTracks or albumTracks into likedSongs!
          const likedSongs = hasProvenance
            ? dedupeStringsCI(likedArr)
            : dedupeStringsCI(rec.tracks || []);
          const topTracksClean = dedupeStringsCI(topArr);
          const albumTracksClean = dedupeStringsCI(albArr);

          artistMatches.push({
            name: displayName,
            isFollowed: Boolean(rec.isFollowed),
            isTopArtist: Boolean(rec.isTopArtist),
            likedSongs,
            likedTracks: likedSongs,
            topTracks: topTracksClean,
            albumTracks: albumTracksClean,
            playlists: pls,
            playlistTrackMap: (rec.playlistTrackMap && typeof rec.playlistTrackMap === 'object') ? rec.playlistTrackMap : {},
            tracks: Array.isArray(rec.tracks) ? rec.tracks : [],
            totalCount: trCount
          });

          if (hasProvenance) {
            const likedCnt = likedArr.length;
            const topCnt = topArr.length;
            const albCnt = albArr.length;
            const isCore = Boolean(rec.isTopArtist || rec.isFollowed || likedCnt > 0 || topCnt > 0 || albCnt > 0);
            if (isCore) {
              const tags = [];
              if (rec.isTopArtist) tags.push('Top Artist');
              if (rec.isFollowed) tags.push('Followed');
              if (likedCnt > 0) tags.push(`${likedCnt} liked`);
              if (albCnt > 0) tags.push(`${albCnt} saved-album`);
              likedArtistDetails.push(`${displayName} (${tags.join(', ') || `${trCount} tracks`})`);
            } else {
              playlistOnlyArtistDetails.push(`${displayName} (0 liked; playlists: ${pls.slice(0, 3).join(', ') || 'playlist only'})`);
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

    // Strict artist-bound track matching:
    // Pass 1: exact / normTrackEdition (matchQuality: 'exact')
    // Pass 2: normTrackLoose fallback (matchQuality: 'alt_version', recording matched Spotify track title)
    const matchedTracks = [];
    const altMatchedTracks = [];
    const likedTrackMatches = [];
    const playlistOnlyTrackMatches = [];
    const albumTrackHits = [];
    const seenTrackKey = new Set();

    (item.tracklist || []).forEach(t => {
      const rawTitle = String(t.title || '').trim();
      if (!rawTitle) return;

      const candidates = [];
      const primaryArtStr = t.artist || (isItemVarious ? '' : item.artist) || '';
      if (primaryArtStr) candidates.push({ artStr: primaryArtStr, titleStr: rawTitle });

      const dashParts = rawTitle.split(/\s+[-–—]\s+/);
      if (dashParts.length >= 2) {
        candidates.push({ artStr: dashParts[0].trim(), titleStr: dashParts.slice(1).join(' - ').trim() });
      }

      let matchedPairKeys = [];
      let matchedCand = null;
      let matchQuality = 'exact';
      let matchedSpotifyTitle = '';

      // Pass 1: Exact / Edition-only remaster match
      for (const c of candidates) {
        const edKey = CC.normTrackEdition(c.titleStr);
        if (!edKey) continue;
        const artParts = String(c.artStr).split(/,|&|\band\b|feat\.?/i).map(normArtistKey).filter(Boolean);
        const hits = [];
        for (const na of artParts) {
          const pk = `${na}|${edKey}`;
          if (editionPairSet.has(pk) && !hits.includes(pk)) hits.push(pk);
        }
        if (hits.length) {
          matchedPairKeys = hits;
          matchedCand = c;
          matchQuality = 'exact';
          break;
        }
      }

      // Pass 2: Loose alt-version fallback (Live / Acoustic / Remix / Radio Edit / Single Version / Demo)
      if (!matchedPairKeys.length) {
        for (const c of candidates) {
          const looseKey = CC.normTrackLoose(c.titleStr);
          if (!looseKey) continue;
          const artParts = String(c.artStr).split(/,|&|\band\b|feat\.?/i).map(normArtistKey).filter(Boolean);
          const hits = [];
          for (const na of artParts) {
            const lk = `${na}|${looseKey}`;
            if (loosePairSet.has(lk) && !hits.includes(lk)) hits.push(lk);
          }
          if (hits.length) {
            matchedPairKeys = hits;
            matchedCand = c;
            matchQuality = 'alt_version';
            matchedSpotifyTitle = looseTitleByPair.get(hits[0]) || '';
            break;
          }
        }
      }

      if (matchedPairKeys.length) {
        const label = t.artist ? `${t.artist} - ${t.title}` : t.title;
        const dedup = CC.normTrackLoose(label) || norm(label);
        if (!seenTrackKey.has(dedup)) {
          seenTrackKey.add(dedup);
          if (matchQuality === 'exact') matchedTracks.push(label);
          else altMatchedTracks.push(label);

          let mergedSrc = null;
          const srcMap = matchQuality === 'exact' ? editionSourceByPair : looseSourceByPair;
          for (const pk of matchedPairKeys) {
            const s = srcMap.get(pk);
            if (s) mergedSrc = mergeTrackSourceProv(mergedSrc, s);
          }
          const src = mergedSrc;
          albumTrackHits.push({
            title: matchedCand?.titleStr || rawTitle,
            artist: t.artist || (isItemVarious ? (matchedCand?.artStr || '') : ''),
            liked: Boolean(src?.liked),
            top: Boolean(src?.top),
            album: Boolean(src?.album),
            playlists: Array.isArray(src?.playlists) ? src.playlists : [],
            matchQuality,
            matchedSpotifyTitle
          });

          if (hasProvenance) {
            const altSuffix = matchQuality === 'alt_version' ? ' · alt version' : '';
            if (src && (src.liked || src.top || src.album)) {
              const tag = src.liked ? 'Liked' : (src.top ? 'Top Track' : 'Saved Album');
              likedTrackMatches.push(`${label} (${tag}${altSuffix})`);
            } else {
              const pls = Array.isArray(src?.playlists) && src.playlists.length ? src.playlists.slice(0, 2).join(', ') : 'Playlist';
              playlistOnlyTrackMatches.push(`${label} [${pls}${altSuffix}]`);
            }
          }
        }
      }
    });

    return {
      hasProvenance,
      isVarious: isItemVarious,
      artistHit: matchedArtists.length > 0,
      matchedArtists,
      matchedTracks,
      altMatchedTracks,
      likedTrackMatches,
      playlistOnlyTrackMatches,
      likedArtistDetails,
      playlistOnlyArtistDetails,
      artistMatches,
      albumTrackHits,
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
    const labeledImgParts = await buildLabeledGradingImageParts('scan', targetItem);
    const photoCount = labeledImgParts.filter(p => p.inline_data).length || stagedPhotos.length;
    setStatus(`✨ AI grading ${photoCount} labeled photo(s) on ${aiEngineLabel()}...`, true, { cancellable: true });

    const prompt = `You are a strict, conservative Discogs/Goldmine visual grading expert. Inspect EVERY attached labeled photo ([Front], [Back], [Spine], [Extra ...]) closely for every physical flaw on the media, case, sleeve, insert, and spine.

Item: "${targetItem.artist} - ${targetItem.title}" (${targetItem.format || 'Cassette'})

PHOTO-SCOPE, SPINE & VERBATIM MARKING RULES:
- If ONLY the bare cassette shell or bare disc is shown (no case, no J-card, no cover insert), set "sleeve_condition": "No Cover" and note loose media in "condition_note".
- ALWAYS inspect [Spine] (and all edges) for punch holes, drill holes, saw cuts / cut-out notches, cracked hinges, edge splitting, spine fading, or creases, and report them explicitly.
- VERBATIM TRANSCRIPTION: Whenever you see notable ink stamps, radio/station/club/library property stamps (e.g., "Property of ... Milwaukee"), promo stamps, price/hype stickers, or handwritten names/dates/markings on the insert, case, shell, or label, TRANSCRIBE the exact readable text verbatim in "condition_note" (and list it in "sleeve_defects" or "media_defects").

STRICT DISCOGS SELLER GRADING RULES (Be brutally honest and conservative — never over-grade!):
1. List every flaw first in "media_defects" and "sleeve_defects" (including spine cut-out markings: hole punches, drill holes, saw cuts, notched corners, cracked hinges, or stamps).
2. Media Condition MUST be one of: ${JSON.stringify(MEDIA_GRADES.filter(g => g !== 'Not Graded'))}
   * "Mint (M)" ONLY if factory sealed. "Near Mint (NM or M-)" = spotless, zero visible wear.
   * "Very Good Plus (VG+)" = very clean, only tiny handling scuffs, crisp flat label.
   * "Very Good (VG)" = visible scuffs/scratches, light label wear or fading.
   * "Good Plus (G+)" = heavy scratches/scuffing, peeling/warped/bubbling/stained label, writing/yellowing.
   * "Good (G)" / "Fair (F)" / "Poor (P)" = cracked shell, missing felt pad, torn label, deep gouges.
3. Sleeve Condition MUST be one of: ${JSON.stringify(SLEEVE_GRADES)}
   * No case/cover shown = "No Cover". Plain blank = "Generic".
   * "Very Good Plus (VG+)" = clean insert, minimal edge wear, no case cracks.
   * "Very Good (VG)" = creases, sticker residue, cut-out saw cut/punch/notch, moderate case scuffs or small crack.
   * "Good Plus (G+)" = paint/ink/water stains, heavy creases, ripped flap, heavily scratched/cracked case.
   * "Good (G)" / "Fair (F)" / "Poor (P)" = severe stains obscuring art, torn/missing pieces, heavy water damage.
4. When between two grades, ALWAYS pick the LOWER grade. NEVER say "mint" in "condition_note" unless factory sealed.

Return ONLY valid JSON:
{
  "media_defects": ["list every flaw on cassette/disc, or empty array if spotless"],
  "sleeve_defects": ["list every flaw on case/insert/spine including cut-out holes/saw cuts/hinge cracks/stamps, or empty array if spotless or no cover"],
  "media_condition": "exact Discogs media grade from list",
  "sleeve_condition": "exact Discogs sleeve grade from list",
  "condition_note": "blunt, factual, buyer-ready Discogs seller note listing visible flaws across all photos + verbatim text of any notable stamps/stickers/handwriting (1-3 short sentences, NEVER say 'mint' unless sealed)"
}`;

    const parts = [{ text: prompt }, ...labeledImgParts];
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
    runTasteAnalysis(currentInspected, scanRunId, inspectSeq);
  };

  // Shared DRY Taste prompt builder used by runTasteAnalysis, recalibrateSingleStashItem, and recalibrateStashBatch
  function buildTasteEvaluationPrompt(itemsOrSingle, opts = {}) {
    const isBatch = Array.isArray(itemsOrSingle);
    const dna = spotifyProfile?.tasteDna || 'No written Taste Profile yet.';
    const softSpots = spotifyProfile?.softSpots || 'None specified yet.';
    const hardRules = `HARD RULES:
0. PRIORITY #1 — ON-RELEASE LIKED SONGS: If 1 or more of the user's exact/remaster Liked Songs (or Top Tracks) is literally on this physical release's tracklist, treat that as the #1 highest-priority KEEP signal (strong 9–10 KEEP when it aligns with their taste/favorite artists, or solid 7–8+ KEEP even on compilations) and explicitly name the matched on-release Liked Song(s) in "summary"! (Note: alt-version matches like live/acoustic/remix are a helpful positive signal, slightly softer than exact studio matches.)
1. PROVENANCE WEIGHTING (LIKED SONGS > SAVED ALBUMS > PLAYLIST-ONLY):
   - Liked Songs, Top Tracks, Top Artists, and Saved Albums are STRONG personal favorites — boost the score and NEVER dismiss them as outside the user's taste!
   - Playlist-Only matches (0 Liked Songs / 0 Top / 0 Saved Albums) indicate CASUAL familiarity, NOT a core obsession. State this honestly in "summary" and judge the album fairly against the Taste Profile instead of inflating it to an automatic 9–10.
2. SOFT SPOTS EQUAL WEIGHT: If this release fits ANY genre, style, era, or mood listed in "Soft Spots & Niche Pockets", score it enthusiastically as a genuine match on par with Core Obsessions.
Verdict rules: "KEEP" if score >= 7, "LISTEN" if 5-6, "SELL / SKIP" if <= 4.`;

    if (isBatch) {
      const payload = itemsOrSingle.map(({ it, lm }, idx) => ({
        idx,
        artist: it.artist,
        title: it.title,
        year: it.year || '',
        format: it.format || '',
        genres: (it.genres || []).slice(0, 6),
        sample_tracks: (it.tracklist || []).slice(0, 24).map(t => t.artist ? `${t.artist} - ${t.title}` : t.title),
        liked_songs_literally_on_this_release: (lm.albumTrackHits || []).filter(h => (h.liked || h.top) && h.matchQuality !== 'alt_version').map(h => h.artist ? `${h.artist} - ${h.title}` : h.title),
        alt_version_liked_songs_on_release: (lm.albumTrackHits || []).filter(h => (h.liked || h.top) && h.matchQuality === 'alt_version').map(h => h.artist ? `${h.artist} - ${h.title}` : h.title),
        liked_artists_in_spotify: lm.hasProvenance ? lm.likedArtistDetails : (lm.details !== 'None' ? [lm.details] : []),
        liked_tracks_in_spotify: lm.hasProvenance ? lm.likedTrackMatches : lm.matchedTracks,
        playlist_only_artists: lm.hasProvenance ? lm.playlistOnlyArtistDetails : [],
        playlist_only_tracks: lm.hasProvenance ? lm.playlistOnlyTrackMatches : []
      }));
      return `Batch-recalibrate personal taste scores for these ${payload.length} saved music releases based on the user's Taste Profile, explicit Soft Spots, and exact local Spotify matches. Speak directly to "you".

User's Taste Profile:
${dna}

User's Explicit Soft Spots & Niche Pockets (FIRST-CLASS WEIGHT — treat these with EQUAL importance to Core Obsessions):
${softSpots}

${hardRules}
3. Evaluate BOTH the specific album/release (era, genre, studio album vs compilation) AND the artist.
4. For each release, provide brief musical/pop-culture context ("context_note", 1 short sentence or ""), the best preview track ("litmus_track" & "litmus_artist"), and up to 4 standout/recognizable songs in "notable_songs" (or [] if none).

Releases:
${JSON.stringify(payload)}

Return ONLY valid JSON:
{
  "scores": [
    {
      "idx": number,
      "score": 1 to 10 integer,
      "verdict": "KEEP" | "LISTEN" | "SELL / SKIP",
      "summary": "1-2 punchy sentences speaking to 'you'",
      "context_note": "1 short neutral sentence of album/pop-culture context, or empty string",
      "litmus_track": "exact song title from sample_tracks (WITHOUT artist prefix) of the best preview track, or empty string",
      "litmus_artist": "performing artist of litmus_track",
      "notable_songs": [
        { "artist": "performing artist", "title": "exact song title", "reason": "short 5-10 word reason it stands out" }
      ]
    }
  ]
}`;
    }

    const item = itemsOrSingle;
    const sm = opts.localMatch || item.spotify_matches || {};
    const tracksStr = (item.tracklist || []).map(t => t.artist ? `${t.artist} - ${t.title}` : t.title).join('; ');
    const onReleaseLiked = (sm.albumTrackHits || []).filter(h => (h.liked || h.top) && h.matchQuality !== 'alt_version').map(h => h.artist ? `${h.artist} - ${h.title}` : h.title);
    const onReleaseAlt = (sm.albumTrackHits || []).filter(h => (h.liked || h.top) && h.matchQuality === 'alt_version').map(h => h.artist ? `${h.artist} - ${h.title}` : h.title);
    const spEvidenceBlock = sm.hasProvenance
      ? `- PRIORITY #1 EXACT/REMASTER LIKED / TOP SONGS ON THIS RELEASE: ${onReleaseLiked.join(', ') || 'None'}
- ALT-VERSION LIKED / TOP SONGS ON THIS RELEASE: ${onReleaseAlt.join(', ') || 'None'}
- HIGH-WEIGHT Liked / Top / Saved-Album Artists: ${(sm.likedArtistDetails || []).join('; ') || 'None'}
- HIGH-WEIGHT Liked / Top / Saved-Album Songs: ${(sm.likedTrackMatches || []).join(', ') || 'None'}
- CASUAL Playlist-Only Artists (0 Liked Songs): ${(sm.playlistOnlyArtistDetails || []).join('; ') || 'None'}
- CASUAL Playlist-Only Songs (0 Liked Songs): ${(sm.playlistOnlyTrackMatches || []).join(', ') || 'None'}`
      : `- Matching Artists in Library: ${sm.details || 'None'}
- Exact / Matching Songs Already in Library: ${(sm.matchedTracks || []).join(', ') || 'None'}`;

    return `Evaluate this physical music release strictly against the user's musical taste profile and provide brief musical/pop-culture context. Speak directly to "you".

Release: "${item.artist} - ${item.title}" (${item.year || '?'}, ${item.format}, Genres: ${(item.genres || []).join(', ') || 'unknown'}).
Full Tracklist: ${tracksStr || 'Unknown'}.
Exact Local Matches Across ALL ${spotifyProfile?.totalTracks || 0} Spotify Tracks / ${spotifyProfile?.totalArtists || 0} Artists:
${spEvidenceBlock}

User's Taste Profile:
${dna}

User's Explicit Soft Spots & Niche Pockets (FIRST-CLASS WEIGHT — treat these with EQUAL importance to Core Obsessions so smaller 5–15 song favorite pockets are NEVER averaged out of a large library):
${softSpots}

${hardRules}

Return ONLY valid JSON:
{
  "score": 1 to 10 integer,
  "verdict": "KEEP" | "LISTEN" | "SELL / SKIP",
  "summary": "1-2 punchy sentences speaking directly to 'you' explaining why you will or won't enjoy this, referencing specific on-release Liked Songs, library hits, Soft Spots, or Taste Profile traits.",
  "context_note": "1-2 neutral sentences of useful context (plain description, no hype). Empty string if obscure/unremarkable.",
  "litmus_track": "exact song title from Full Tracklist (WITHOUT artist prefix) of the single best/most representative track to preview",
  "litmus_artist": "performing artist of litmus_track",
  "notable_songs": [
    { "artist": "performing artist", "title": "exact song title from Tracklist", "reason": "short 6-12 word reason it stands out" }
  ]
}
Include up to 6 genuinely recognizable songs in notable_songs (or empty array if none).`;
  }

  async function runTasteAnalysis(item, myRunId, myInspectSeq = inspectSeq) {
    if (!CC.isAiReady()) {
      document.getElementById('tasteScore').textContent = '—';
      document.getElementById('tasteBody').textContent = 'Add your Gemini API Key in Settings to enable Taste & Context.';
      return;
    }

    const cacheKey = `${norm(item.artist)}|${norm(item.title)}|v230`;
    if (tasteCache.has(cacheKey)) {
      if (myRunId !== scanRunId || myInspectSeq !== inspectSeq || currentInspected !== item) return;
      applyTasteUI(item, tasteCache.get(cacheKey), myRunId);
      return;
    }

    const prompt = buildTasteEvaluationPrompt(item, { localMatch: item.spotify_matches });

    try {
      const res = await CC.callAI([{ text: prompt }], null, { retryLabel: 'Taste Check' });
      setStatus('', false);
      tasteCache.set(cacheKey, res);
      if (myRunId !== scanRunId || myInspectSeq !== inspectSeq || currentInspected !== item) return;
      applyTasteUI(item, res, myRunId);
    } catch (err) {
      setStatus('', false);
      if (myRunId !== scanRunId || myInspectSeq !== inspectSeq || currentInspected !== item) return;
      document.getElementById('tasteScore').textContent = '⚠️';
      document.getElementById('tasteBody').innerHTML = `
        <div style="margin-bottom:8px; color:#fde68a;">${esc(err.name === 'AbortError' ? 'Cancelled.' : err.message)}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="retryCurrentTaste()">🔄 Retry Taste Check</button>
      `;
    }
  }

  // ==================== OPTIONAL SPOTIFY -> TASTE PROFILE AUTO-DRAFTER ====================
  window.analyzeFullSpotifyDNA = async (opts = {}) => {
    const { suppressAutoSync = false } = (opts && typeof opts === 'object') ? opts : {};
    if (!CC.isAiReady()) { toast('Add your Gemini API Key in Settings first'); return false; }
    if (!spotifyProfile || !spotifyProfile.totalArtists) { toast('Sync your Spotify library first'); return false; }

    const btn = document.getElementById('btnAnalyzeDna');
    if (btn) btn.disabled = true;

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
      if (!suppressAutoSync) scheduleGoogleAutoSync();
      toast(`🧠 Taste Profile drafted from ${spotifyProfile.totalArtists} artists & ${spotifyProfile.totalTracks} tracks!`, 4200);
      return true;
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast('Taste Profile error: ' + err.message, 4500);
      return false;
    } finally {
      if (btn && !rebuildWorkflowActive) btn.disabled = false;
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
    updateSettingsDirtyButtons();
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
      const searchParams = { type: 'release', q, per_page: 25 };
      if (r.format) searchParams.format = r.format;
      const sr = await CC.discogsFetch('/database/search', searchParams);
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
        <div style="font-weight:800; font-size:0.9rem; color:var(--text);">#${idx + 1}: ${esc(r.artist || '?')} — ${esc(r.title || '?')}</div>
        <div style="font-size:0.78rem; color:#cccccc; margin-top:2px;">
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
        ? `<span class="badge badge-mono" style="color:#fde68a;">⏳ Scoring...</span>`
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
        ? `<span class="badge badge-mono" style="color:#fde68a;">⏳ Pricing...</span>`
        : r.priceStatus === 'error'
          ? `<button type="button" class="badge badge-red" style="border:none; cursor:pointer;" onclick="retryPileItemPrice(${i}, event)">⚠️ Price unavailable · Tap to retry</button>`
          : (r.priceStatus === 'done' && r.roughAskVal === null && r.roughVgVal === null)
            ? `<span class="badge badge-mono">0 listed</span>`
            : (r.priceStatus === 'none')
              ? `<span class="badge badge-mono">No Discogs hit</span>`
              : '';
      const histLink = r.roughId
        ? `<a class="badge badge-blue" style="text-decoration:none;" target="_blank" rel="noopener" onclick="event.stopPropagation();" href="https://www.discogs.com/sell/history/${r.roughId}">📈 Sales ↗</a>`
        : '';

      return `
        <div id="pileCard-${i}" class="pile-item ${activePileIdx === i ? 'active' : ''}" onclick="selectPileItem(${i}, false)">
          <div style="flex:1; min-width:0;">
            <div class="candidate-title"><span style="color:var(--accent);">#${i + 1}</span> ${esc(r.artist || '?')} — ${esc(r.title || '?')}</div>
            <div class="candidate-sub">${esc(r.format || 'Cassette')}${r.catno ? ` · ${esc(r.catno)}` : ''}${r.taste_reason ? ` · ${esc(r.taste_reason)}` : ''}</div>
            <div>
              ${tasteBadge}
              ${ownedBadge}
              ${r.localArtistHit ? `<span class="badge badge-green">In Spotify</span>` : ''}
              ${askBadge}${vgBadge}${statusBadge}${histLink}
              ${(r.roughWant > r.roughHave && r.roughWant >= 15) ? `<span class="badge badge-purple">💎 High Want (${r.roughWant})</span>` : ''}
              ${pilePhotos.length > 1 ? `<span class="badge badge-mono" style="color:#d8b4fe;">📷 #${(r.photoIdx ?? 0) + 1}</span>` : ''}
              ${(r.point || r.poly) ? `<span class="badge badge-mono" style="color:var(--accent);">📍 #${i + 1}</span>` : ''}
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
    const effFmt = getEffectiveScanFormat();
    const fmtLabel = effFmt === 'Auto' ? 'all formats' : (effFmt === 'Other' ? 'other media formats' : `${effFmt} only`);
    const shotCount = pilePhotos.length;

    const formatRule = effFmt === 'Auto'
      ? '- Extract legible physical media (Cassettes, CDs, Vinyl, 8-Tracks, VHS, DVD, LaserDisc, Blu-ray, MiniDisc, Reel-To-Reel, etc.) — from BOTH spines AND visible front covers/faces. Classify all vinyl sizes (7"/10"/12"/LP) as "Vinyl".'
      : effFmt === 'Other'
        ? '- FORMAT FILTER ACTIVE: Extract ONLY non-standard / Other physical media (8-Track Cartridge, Reel-To-Reel, MiniDisc, DAT, DVD, VHS, LaserDisc, Blu-ray, Betamax, UMD, Shellac, SACD, Box Set) and IGNORE standard Cassettes, CDs, and Vinyl.'
        : `- FORMAT FILTER ACTIVE: The user selected "${effFmt}". ONLY extract ${effFmt} items and strictly IGNORE all other formats in the photo. Read both spines AND visible front covers/faces of ${effFmt} items.`;

    const ocrPrompt = `You are inspecting a high-resolution photo of a crate, shelf, box, or stack of physical music/video media (cassettes, CDs, vinyl, 8-tracks, VHS, DVDs, LaserDiscs, MiniDiscs, etc.).

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
      "format": "Cassette" | "CD" | "Vinyl" | "8-Track Cartridge" | "Reel-To-Reel" | "MiniDisc" | "DAT" | "DVD" | "VHS" | "LaserDisc" | "Blu-ray" | "Betamax" | "UMD" | "Shellac" | "SACD" | "File" | "Box Set",
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
        sectionItems = sectionItems.map(x => ({ ...x, format: x.format ? CC.normalizeDiscogsFormat(x.format) : '' }));
        if (effFmt !== 'Auto') {
          sectionItems = sectionItems.filter(x => !x.format || CC.matchesMediaFormat(x.format, effFmt));
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
      const spLookup = getSpotifyLookup(spotifyProfile);
      pileResults = deduped.map(it => {
        const artParts = String(it.artist || '').split(/,|&|\band\b|feat\.?/i).map(normArtistKey).filter(Boolean);
        const localArtistHit = Boolean(spLookup && artParts.some(k => spLookup.artistByKey.has(k)));
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

    const expectedAccount = String(cfg.discogsUser || '').trim().toLowerCase();
    if (!isOwnedByActiveDiscogsAccount(oldInfo)) {
      return {
        ok: false,
        warning: `Old pressing #${oldInfo.releaseId} belongs to Discogs @${oldInfo.account}, not @${cfg.discogsUser} — switch Discogs accounts before removing it.`
      };
    }

    try {
      let oldInst = oldInfo.instanceId ? Number(oldInfo.instanceId) : null;
      let oldFolder = String(oldInfo.folderId || '1');

      // Always verify live copies on Discogs (throwOnError: true so network outages never wipe pending_delete_old)
      const insts = await CC.findDiscogsInstances(oldInfo.releaseId, { throwOnError: true });
      if (oldInst) {
        const exact = insts.find(r => Number(r.instance_id) === oldInst);
        if (!exact) {
          // That exact instance is already gone — NEVER guess another copy
          record.pending_delete_old = null;
          await CC.mutateStashItemIfAlive(record.id, record.sync_id, (live) => ({ ...live, pending_delete_old: null }), ['pending_delete_old']);
          return { ok: true, warning: '' };
        }
        oldFolder = String(exact.folder_id || oldFolder);
      } else {
        if (insts.length === 0) {
          record.pending_delete_old = null;
          await CC.mutateStashItemIfAlive(record.id, record.sync_id, (live) => ({ ...live, pending_delete_old: null }), ['pending_delete_old']);
          return { ok: true, warning: '' };
        }
        if (insts.length > 1) {
          const amb = { ...oldInfo, ambiguous: true, copyCount: insts.length };
          record.pending_delete_old = amb;
          await CC.mutateStashItemIfAlive(record.id, record.sync_id, (live) => ({ ...live, pending_delete_old: amb }), ['pending_delete_old']);
          return {
            ok: false,
            warning: `You own ${insts.length} copies of old pressing #${oldInfo.releaseId} on Discogs — kept untouched so the wrong copy isn't deleted. Please remove the duplicate manually on Discogs.`
          };
        }
        oldInst = Number(insts[0].instance_id);
        oldFolder = String(insts[0].folder_id || oldFolder);
      }

      // Fresh Discogs account ownership re-check IMMEDIATELY before calling DELETE!
      const liveAccountNow = String(cfg.discogsUser || '').trim().toLowerCase();
      if (!isOwnedByActiveDiscogsAccount(oldInfo) || !liveAccountNow || liveAccountNow !== expectedAccount) {
        return {
          ok: false,
          warning: `Discogs account changed while verifying old copy #${oldInfo.releaseId} — aborted remote delete safely.`
        };
      }

      await CC.deleteDiscogsInstance(oldFolder, oldInfo.releaseId, oldInst);
      record.pending_delete_old = null;
      await CC.mutateStashItemIfAlive(record.id, record.sync_id, (live) => ({ ...live, pending_delete_old: null }), ['pending_delete_old']);
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
      // Named slot snapshot: Spine is dedicated strictly to spine_thumb_url and NEVER duplicated into cover/extra slots
      stagedSlotSnap: {
        front: stagedSlots.front?.saveWebp || '',
        back: stagedSlots.back?.saveWebp || '',
        spine: stagedSlots.spine?.saveWebp || '',
        extras: (stagedSlots.extras || []).filter(Boolean).map(p => p.saveWebp)
      },
      mediaCond: document.getElementById('gMediaCond').value || 'Not Graded',
      sleeveCond: document.getElementById('gSleeveCond').value || 'Not Graded',
      condNote: document.getElementById('gNotes').value.trim(),
      tiebreakChecked,
      scanRunIdAtTap: scanRunId,
      defaultFolderId: CC.resolveTargetDiscogsFolderId(currentInspected?.format || ''),
      frankenSnap: frankenState?.active
        ? { is_franken_copy: true, franken_type: frankenState.mismatchType || '', franken_note: frankenState.reason || '' }
        : { is_franken_copy: Boolean(currentInspected?.is_franken_copy || currentExtracted?.is_franken_copy), franken_type: currentInspected?.franken_type || currentExtracted?.franken_type || '', franken_note: currentInspected?.franken_note || currentExtracted?.franken_note || '' }
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
      let verifiedOnDiscogsNow = false;

      let fieldRes = { okCount: 0, failedCount: 0, errors: [] };
      let sameReleaseSkippedRemote = false;
      let sameReleaseRemoteCopies = 0;

      // Per-slot merge during Edit/Re-Check so untouched Front / Back / Extras / Spine slots survive
      const baseSlots = isEditing ? CC.normalizePhotoSlots(oldItem) : { front: '', back: '', extras: [] };
      const mergedExtras = snap.stagedSlotSnap.extras.length
        ? Array.from(new Set([...(baseSlots.extras || []), ...snap.stagedSlotSnap.extras]))
        : (baseSlots.extras || []).slice();
      const finalPhotoSlots = {
        front: snap.stagedSlotSnap.front || baseSlots.front || '',
        back: snap.stagedSlotSnap.back || baseSlots.back || '',
        extras: mergedExtras
      };
      const derivedThumbs = CC.deriveThumbsFromSlots(finalPhotoSlots, snap.inspected.discogs_thumb || '');

      const buildRecord = () => {
        const cleanInspected = { ...snap.inspected };
        delete cleanInspected._pendingDiscogsAdd;
        const now = Date.now();
        const resolvedAccount = synced
          ? ((verifiedOnDiscogsNow || attachedFromLedger) ? (cfg.discogsUser || oldItem?.discogs_account || '') : (oldItem?.discogs_account || ''))
          : (changedRelease ? '' : (oldItem?.discogs_account || ''));
        const resolvedFolderVerifiedAt = synced
          ? ((verifiedOnDiscogsNow || attachedFromLedger) ? now : (oldItem?.discogs_folder_verified_at || 0))
          : (changedRelease ? 0 : (oldItem?.discogs_folder_verified_at || 0));
        const rawRec = {
          ...cleanInspected,
          sync_id: (isEditing && oldItem.sync_id) ? oldItem.sync_id : (snap.inspected.sync_id || CC.generateSyncId()),
          is_conservative_tiebreak: Boolean(snap.inspected.is_conservative_tiebreak),
          tiebreak_confirmed: Boolean(!snap.inspected.is_conservative_tiebreak || snap.tiebreakChecked),
          synced_to_discogs: synced,
          discogs_account: resolvedAccount,
          discogs_removed: synced ? false : Boolean(oldItem?.discogs_removed),
          discogs_removed_at: synced ? null : (oldItem?.discogs_removed_at || null),
          intended_discogs_folder_id: synced ? null : (oldItem?.intended_discogs_folder_id || snap.defaultFolderId || '1'),
          pending_discogs_sync: pendingDiscogsSync,
          pending_field_sync: pendingFieldSync,
          pending_delete_old: pendingDeleteOld,
          discogs_folder_id: synced ? String(folderId || '1') : null,
          discogs_folder_verified_at: resolvedFolderVerifiedAt,
          discogs_instance_id: synced ? instanceId : null,
          photo_slots: finalPhotoSlots,
          thumbs: derivedThumbs.thumbs,
          thumb_data_url: derivedThumbs.thumb_data_url,
          spine_thumb_url: snap.inspected.spine_thumb_url || snap.stagedSlotSnap.spine || (isEditing ? (oldItem.spine_thumb_url || '') : ''),
          spine_source_url: snap.inspected.spine_source_url || snap.stagedSlotSnap.spine || (isEditing ? (oldItem.spine_source_url || '') : ''),
          spine_flipped: Boolean(snap.inspected.spine_flipped ?? (isEditing ? oldItem.spine_flipped : false)),
          is_franken_copy: Boolean(snap.frankenSnap?.is_franken_copy || (isEditing && oldItem.is_franken_copy)),
          franken_type: snap.frankenSnap?.franken_type || (isEditing ? (oldItem.franken_type || '') : ''),
          franken_note: snap.frankenSnap?.franken_note || (isEditing ? (oldItem.franken_note || '') : ''),
          needs_verification: false,
          created_at: isEditing ? (oldItem.created_at || now) : now,
          updated_at: now
        };
        if (isEditing) rawRec.id = oldItem.id;
        return CC.stampStashRevision(rawRec, isEditing ? oldItem : null);
      };

      if (snap.syncToDiscogs) {
        try {
          if (sameRelease) {
            if (!isOwnedByActiveDiscogsAccount(oldItem)) {
              setStatus('', false);
              toast(`⚠️ Cannot update Discogs — this copy belongs to @${oldItem.discogs_account}, not @${cfg.discogsUser}. Use Save Local instead.`, 5200);
              return;
            }
            setStatus('Updating grades & notes on your existing Discogs item...', true);
            if (!instanceId) {
              const insts = await CC.findDiscogsInstances(oldItem.discogs_id, { throwOnError: true });
              if (insts.length === 1) {
                instanceId = insts[0].instance_id;
                folderId = String(insts[0].folder_id || folderId);
                verifiedOnDiscogsNow = true;
              } else {
                sameReleaseSkippedRemote = true;
                sameReleaseRemoteCopies = insts.length;
              }
            }
            if (instanceId) {
              fieldRes = await CC.syncDiscogsInstanceFields(folderId, snap.inspected.discogs_id, instanceId, snap.mediaCond, snap.sleeveCond, snap.condNote);
              pendingFieldSync = fieldRes.failedCount > 0;
              verifiedOnDiscogsNow = true;
            }
            synced = true;
            pendingDiscogsSync = false;
          } else {
            // 1. Durable Add-First with unified cross-path ledger + folder-safe reconciliation
            const added = await ensureDiscogsInstanceDurable(ledgerKey, snap.inspected.discogs_id, snap.defaultFolderId, relKey ? [relKey] : []);
            folderId = added.folderId;
            instanceId = added.instanceId;
            verifiedOnDiscogsNow = true;

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
                instanceId: oldItem.discogs_instance_id || null,
                account: oldItem.discogs_account || cfg.discogsUser || ''
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
              instanceId: oldItem.discogs_instance_id || null,
              account: oldItem.discogs_account || cfg.discogsUser || ''
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

  // Offline Thrift Queue: "📥 Save Now, Verify Later" — 100% offline, ZERO Gemini/Discogs calls!
  window.saveUnverifiedOffline = async () => {
    const titleVal = document.getElementById('fTitle').value.trim();
    const artistVal = document.getElementById('fArtist').value.trim();
    const catnoVal = document.getElementById('fCatno').value.trim();
    const barcodeVal = (stagedUpc || document.getElementById('fBarcode').value || '').replace(/\D/g, '').trim();
    const hasAnything = stagedPhotos.length > 0 || Boolean(barcodeVal) || Boolean(titleVal || artistVal || catnoVal);
    if (!hasAnything) {
      toast('Stage at least 1 photo, UPC, or title/artist first');
      return;
    }

    const now = Date.now();
    const dateTag = new Date(now).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const effFmt = getEffectiveScanFormat();
    const fmt = (effFmt !== 'Auto' && effFmt !== 'Other')
      ? effFmt
      : (document.getElementById('fFormat').value || 'Cassette');

    const photoSlots = {
      front: stagedSlots.front?.saveWebp || '',
      back: stagedSlots.back?.saveWebp || '',
      extras: (stagedSlots.extras || []).filter(Boolean).map(p => p.saveWebp)
    };
    const derived = CC.deriveThumbsFromSlots(photoSlots, '');
    const spineThumb = stagedSpineThumbUrl || stagedSlots.spine?.saveWebp || '';
    const spineSource = stagedSpineSourceUrl || stagedSlots.spine?.origDataUrl || spineThumb;

    const rec = CC.stampStashRevision({
      sync_id: CC.generateSyncId(),
      artist: artistVal || 'Unverified Scan',
      title: titleVal || (barcodeVal ? `UPC ${barcodeVal}` : dateTag),
      format: fmt,
      catno: catnoVal,
      barcode: barcodeVal,
      label: document.getElementById('fLabel').value.trim(),
      year: document.getElementById('fYear').value.trim(),
      country: '',
      genres: [],
      media_condition: 'Not Graded',
      sleeve_condition: 'Not Graded',
      condition_note: barcodeVal ? `Queued offline (UPC: ${barcodeVal})` : 'Queued offline — ready to verify at home.',
      needs_verification: true,
      is_franken_copy: false,
      franken_type: '',
      franken_note: '',
      synced_to_discogs: false,
      discogs_id: null,
      intended_discogs_folder_id: CC.resolveTargetDiscogsFolderId(fmt),
      photo_slots: photoSlots,
      thumbs: derived.thumbs,
      thumb_data_url: derived.thumb_data_url,
      spine_thumb_url: spineThumb,
      spine_source_url: spineSource,
      spine_flipped: Boolean(stagedSpineFlipped),
      created_at: now,
      updated_at: now
    }, null);

    await CC.commitLocalMutation({ upsertStash: rec, queueOutbox: true });
    await loadStashCache();
    renderStash();
    updateCloudUI();
    scheduleGoogleAutoSync();
    resetScanner();
    toast('📥 Saved to Offline Queue (⏳ To Verify) — ready for next scan!', 3400);
  };

  async function hydratePhotoPairFromSavedDataUrl(dataUrl, isSpine = false) {
    const s = String(dataUrl || '').trim();
    if (!s || isUnresolvedDriveRef(s) || !s.startsWith('data:image/')) return null;
    const apiB64 = await renderDataUrlToCompactJpegB64(s, 2048, 0.90);
    if (!apiB64) return null;
    return { apiB64, saveWebp: s, origDataUrl: s, autoCropped: true, spineCropped: Boolean(isSpine), cropBox: null, rotationDeg: 0 };
  }

  window.startEditStashItem = async (id, opts = {}) => {
    const { preloadPhotos = false } = opts || {};
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    closeStashDetail();
    setScanMode('single');
    switchView('scan');
    resetScanner();

    editingStashItem = { ...it };
    const isQueued = Boolean(it.needs_verification);
    document.getElementById('editModeTitle').textContent = isQueued
      ? `⏳ Verifying Queued Scan: ${it.artist} — ${it.title}`
      : `${it.artist} — ${it.title} (${it.discogs_id ? '#' + it.discogs_id : 'Local Only'} · Saved Grade: ${shortGrade(it.media_condition || 'Not Graded')}/${shortGrade(it.sleeve_condition || 'Not Graded')})`;
    document.getElementById('chkRegradeEdit').checked = isQueued ? Boolean(cfg.autoGradeOnScan) : false;
    document.getElementById('editModeBanner').classList.remove('hidden');

    document.getElementById('fTitle').value = (isQueued && it.artist === 'Unverified Scan') ? '' : (it.title || '');
    document.getElementById('fArtist').value = (isQueued && it.artist === 'Unverified Scan') ? '' : (it.artist || '');
    document.getElementById('fCatno').value = it.catno || '';
    document.getElementById('fLabel').value = it.label || '';
    document.getElementById('fYear').value = it.year || '';
    if (it.barcode) {
      stagedUpc = String(it.barcode).replace(/\D/g, '');
      document.getElementById('fBarcode').value = stagedUpc;
    }
    if (it.format) setSelectFormatValue('fFormat', it.format);

    if (preloadPhotos || isQueued) {
      setStatus('Loading saved photos into scanner...', true);
      const slots = getStashPhotoSlots(it);
      if (slots.front) stagedSlots.front = await hydratePhotoPairFromSavedDataUrl(slots.front);
      if (slots.back) stagedSlots.back = await hydratePhotoPairFromSavedDataUrl(slots.back);
      if (it.spine_thumb_url) {
        stagedSlots.spine = await hydratePhotoPairFromSavedDataUrl(it.spine_thumb_url, !isQueued);
        if (stagedSlots.spine) {
          stagedSpineThumbUrl = it.spine_thumb_url;
          stagedSpineSourceUrl = it.spine_source_url || it.spine_thumb_url;
          stagedSpineFlipped = Boolean(it.spine_flipped);
        }
      }
      for (const ex of (slots.extras || []).slice(0, 2)) {
        const pair = await hydratePhotoPairFromSavedDataUrl(ex);
        if (pair) stagedSlots.extras.push(pair);
      }
      syncStagedPhotosCompat();
      setStatus('', false);
    }

    updateStageUI();
    toast(preloadPhotos || isQueued
      ? '🔍 Photos & UPC loaded — tap Search & Verify!'
      : 'Take new photos (or tap Search & Verify) to re-check this item!', 3600);
  };

  window.verifyQueuedStashItem = (id) => startEditStashItem(id, { preloadPhotos: true });

  window.cancelEditMode = () => {
    editingStashItem = null;
    document.getElementById('editModeBanner').classList.add('hidden');
    resetScanner();
  };

  window.resetScanner = () => {
    scanRunId++;
    stageSeq++;
    inspectSeq++;
    batchAutoCropCancelled = true;
    deepSearchCancelled = true;
    frankenState = null;
    renderFrankenBanner();
    CC.cancelAI();
    stopHighlightAudio();
    setStatus('', false);
    pendingVoiceRetry = null;
    stagedSlots = { front: null, back: null, spine: null, extras: [] };
    syncStagedPhotosCompat();
    stagedSpineThumbUrl = '';
    stagedSpineSourceUrl = '';
    stagedSpineFlipped = false;
    stagedUpc = '';
    camIgnoredUpc = '';
    camIgnoredUpcMisses = 0;
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
      recalBtn.classList.remove('hidden');
      recalBtn.disabled = true;
      recalBtn.textContent = recalibrateProgressText || '⏳ Recalibrating...';
      return;
    }
    const staleCount = stashCache.filter(isStashTasteStale).length;
    if (staleCount === 0) {
      recalBtn.classList.add('hidden');
      return;
    }
    recalBtn.classList.remove('hidden');
    recalBtn.disabled = Boolean(rebuildWorkflowActive);
    recalBtn.textContent = `🔄 Recalibrate All (${staleCount})`;
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

  const ALPHA_RAIL_LETTERS = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
  let alphaRailBound = false;

  function sortKeyIgnoreThe(str) {
    return CC.foldText(String(str || '')).trim().toLowerCase().replace(/^the\s+/, '').trim();
  }

  function alphaBucketForText(str) {
    const k = sortKeyIgnoreThe(str);
    const ch = k.charAt(0).toUpperCase();
    return /^[A-Z]$/.test(ch) ? ch : '#';
  }

  function getItemApproxUsd(it) {
    if (it.est_usd != null && Number.isFinite(Number(it.est_usd))) return Number(it.est_usd);
    if (it.est_price == null) return null;
    const u = toApproxUsd(it.est_price, it.est_currency || 'USD');
    return u !== null ? u : (Number.isFinite(Number(it.est_price)) ? Number(it.est_price) : null);
  }

  window.onStashSortChange = (val) => {
    activeStashSort = val || 'newest';
    try { localStorage.setItem(STASH_SORT_KEY, activeStashSort); } catch (_) {}
    renderStash();
  };

  function scrollToStashAlphaLetter(letter) {
    const target = document.querySelector(`#stashList [data-alpha-anchor="${CSS.escape(letter)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelectorAll('#stashAlphaRail .stash-alpha-letter').forEach(b => {
        b.classList.toggle('active', b.dataset.letter === letter);
      });
    }
  }

  function initStashAlphaRailEvents() {
    if (alphaRailBound) return;
    const rail = document.getElementById('stashAlphaRail');
    if (!rail) return;
    alphaRailBound = true;
    let dragging = false;
    let lastLetter = '';

    const handlePoint = (clientX, clientY) => {
      const el = document.elementFromPoint(clientX, clientY);
      const btn = el?.closest?.('.stash-alpha-letter');
      if (btn && !btn.classList.contains('dim') && btn.dataset.letter && btn.dataset.letter !== lastLetter) {
        lastLetter = btn.dataset.letter;
        scrollToStashAlphaLetter(lastLetter);
      }
    };

    rail.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastLetter = '';
      try { rail.setPointerCapture(e.pointerId); } catch (_) {}
      handlePoint(e.clientX, e.clientY);
    });
    rail.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      handlePoint(e.clientX, e.clientY);
    });
    const endDrag = () => { dragging = false; lastLetter = ''; };
    rail.addEventListener('pointerup', endDrag);
    rail.addEventListener('pointercancel', endDrag);
  }

  function renderStashAlphaRail(populatedLetters, showRail) {
    const rail = document.getElementById('stashAlphaRail');
    const list = document.getElementById('stashList');
    if (!rail) return;
    if (!showRail || !populatedLetters || populatedLetters.size === 0 || currentView !== 'stash') {
      rail.classList.add('hidden');
      rail.innerHTML = '';
      if (list) list.classList.remove('stash-list-has-rail');
      return;
    }
    initStashAlphaRailEvents();
    rail.classList.remove('hidden');
    if (list) list.classList.add('stash-list-has-rail');
    rail.innerHTML = ALPHA_RAIL_LETTERS.map(ch => {
      const has = populatedLetters.has(ch);
      return `<button type="button" class="stash-alpha-letter ${has ? '' : 'dim'}" data-letter="${ch}" ${has ? '' : 'disabled tabindex="-1"'}>${ch}</button>`;
    }).join('');
  }

  window.renderStash = () => {
    renderStashFolderChips();

    const toVerifyCount = stashCache.filter(it => Boolean(it.needs_verification)).length;
    const chipTv = document.getElementById('chipToVerify');
    if (chipTv) {
      chipTv.textContent = toVerifyCount > 0 ? `⏳ To Verify (${toVerifyCount})` : '⏳ To Verify';
      chipTv.classList.toggle('hidden', toVerifyCount === 0 && activeStashFilter !== 'toverify');
    }

    const sortEl = document.getElementById('stashSort');
    if (sortEl && sortEl.value !== activeStashSort) sortEl.value = activeStashSort;

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
      if (activeStashFilter === 'toverify' && !it.needs_verification) return false;
      if (['Cassette', 'CD', 'Vinyl'].includes(activeStashFilter) && norm(it.format) !== norm(activeStashFilter)) return false;
      if (activeStashFilter === 'other') {
        if (CC.isPrimaryMediaFormat(it.format)) return false;
        if (activeStashOtherFormat && norm(it.format) !== norm(activeStashOtherFormat)) return false;
      }
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

    // Apply selected Stash Sort order
    filtered.sort((a, b) => {
      switch (activeStashSort) {
        case 'artist_az': {
          const ka = sortKeyIgnoreThe(a.artist || '');
          const kb = sortKeyIgnoreThe(b.artist || '');
          const c = ka.localeCompare(kb);
          if (c !== 0) return c;
          return sortKeyIgnoreThe(a.title || '').localeCompare(sortKeyIgnoreThe(b.title || ''));
        }
        case 'title_az': {
          const c = sortKeyIgnoreThe(a.title || '').localeCompare(sortKeyIgnoreThe(b.title || ''));
          if (c !== 0) return c;
          return sortKeyIgnoreThe(a.artist || '').localeCompare(sortKeyIgnoreThe(b.artist || ''));
        }
        case 'value_desc': {
          const va = getItemApproxUsd(a);
          const vb = getItemApproxUsd(b);
          if (va === null && vb === null) return (b.created_at || 0) - (a.created_at || 0);
          if (va === null) return 1;
          if (vb === null) return -1;
          return vb - va;
        }
        case 'value_asc': {
          const va = getItemApproxUsd(a);
          const vb = getItemApproxUsd(b);
          if (va === null && vb === null) return (b.created_at || 0) - (a.created_at || 0);
          if (va === null) return 1;
          if (vb === null) return -1;
          return va - vb;
        }
        case 'taste_desc': {
          const ta = Number(a.taste_score || 0);
          const tb = Number(b.taste_score || 0);
          if (tb !== ta) return tb - ta;
          return (b.created_at || 0) - (a.created_at || 0);
        }
        case 'year_desc': {
          const ya = Number(String(a.year || '').match(/\d{4}/)?.[0] || 0);
          const yb = Number(String(b.year || '').match(/\d{4}/)?.[0] || 0);
          if (yb !== ya) return yb - ya;
          return (b.created_at || 0) - (a.created_at || 0);
        }
        case 'year_asc': {
          const ya = Number(String(a.year || '').match(/\d{4}/)?.[0] || 9999);
          const yb = Number(String(b.year || '').match(/\d{4}/)?.[0] || 9999);
          if (ya !== yb) return ya - yb;
          return (b.created_at || 0) - (a.created_at || 0);
        }
        default:
          return (b.created_at || 0) - (a.created_at || 0);
      }
    });

    updateRecalibrateStashBtn();

    const totalValUsd = filtered.reduce((s, it) => {
      const u = getItemApproxUsd(it);
      return s + (u !== null ? u : 0);
    }, 0);
    document.getElementById('stashStats').textContent = `${filtered.length} items · ~$${Math.round(totalValUsd)}`;

    const list = document.getElementById('stashList');
    if (!filtered.length) {
      renderStashAlphaRail(null, false);
      const hasDriveCfg = Boolean(CC.isGoogleSignedIn() || cfg.googleBoundEmail || cfg.googleEmail || cfg.googleLastSyncAt || cfg.googleLastLoadAt);
      const emptyAction = hasDriveCfg
        ? `<button type="button" class="btn btn-green btn-sm" style="margin-top:8px;" onclick="syncStashWithCloudUI()">☁️ Sync with Cloud</button>`
        : `<button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="switchView('settings')">⚙️ Connect Google Drive or Discogs</button>`;
      const emptyMsg = activeDiscogsFolderFilter !== null
        ? `No copies in folder "${esc(getFolderNameById(activeDiscogsFolderFilter))}" yet.`
        : (stashCache.length ? 'No matching items in this filter.' : 'Your Stash is empty. Scan an item, sync Google Drive, or pull your Discogs collection in Settings.');
      list.innerHTML = `<div class="card"><p>${emptyMsg}</p>${!stashCache.length ? emptyAction : ''}</div>`;
      return;
    }

    const isAlphaSort = activeStashSort === 'artist_az' || activeStashSort === 'title_az';

    if (activeStashView === 'spines') {
      const spineLetters = new Set();
      const seenAnchors = new Set();
      list.innerHTML = `<div class="spine-shelf">${filtered.map(it => {
        const tasteTxt = it.taste_score ? `${it.taste_score}/10` : '';
        const priceTxt = it.est_price != null ? formatMoney(it.est_price, it.est_currency || 'USD') : '';
        let anchorAttr = '';
        if (isAlphaSort) {
          const ch = alphaBucketForText(activeStashSort === 'artist_az' ? it.artist : it.title);
          spineLetters.add(ch);
          if (!seenAnchors.has(ch)) { seenAnchors.add(ch); anchorAttr = ` data-alpha-anchor="${ch}"`; }
        }
        if (it.spine_thumb_url) {
          return `
            <div class="spine-row"${anchorAttr} onclick="openStashDetail(${it.id})">
              <div class="spine-img-wrap">
                ${renderPhotoImgOrPlaceholder(it.spine_thumb_url, 'spine-img', `alt="${esc(it.artist)} — ${esc(it.title)}"`)}
                ${(tasteTxt || priceTxt) ? `<div class="spine-img-tag">${priceTxt ? `<span>${esc(priceTxt)}</span>` : ''}${tasteTxt ? `<span style="color:var(--spotify);">${esc(tasteTxt)}</span>` : ''}</div>` : ''}
              </div>
            </div>
          `;
        }
        const accentCls = it.is_high_value ? 's-val' : ((it.taste_score || 0) >= 7 ? 's-keep' : '');
        const metaParts = [it.catno || '', it.format || '', tasteTxt].filter(Boolean).join(' · ');
        return `
          <div class="spine-row"${anchorAttr} onclick="openStashDetail(${it.id})">
            <div class="spine-typo ${accentCls}">
              <span class="spine-typo-title">${esc(it.artist || '?')} — ${esc(it.title || '?')}</span>
              <span class="spine-typo-meta">${esc(metaParts || '—')}</span>
            </div>
          </div>
        `;
      }).join('')}</div>`;
      renderStashAlphaRail(spineLetters, isAlphaSort);
      return;
    }

    const renderStashCard = (it) => {
      const priceText = it.est_price != null ? formatMoney(it.est_price, it.est_currency || 'USD') : '—';
      const priceCls = it.est_price == null ? 'c-muted' : (it.is_high_value ? 'c-yellow' : '');
      const tasteText = it.taste_score ? `${it.taste_score}/10` : '—';
      const tasteCls = !it.taste_score ? 'c-muted' : (it.taste_score >= 7 ? 'c-green' : it.taste_score >= 5 ? 'c-blue' : 'c-red');
      const gradeText = formatGridGrade(it.media_condition, it.sleeve_condition);
      const gradeCls = gradeText === '—' ? 'c-muted' : '';

      let syncText = 'LOCAL';
      let syncCls = 'c-muted';
      if (it.needs_verification) {
        syncText = 'TO VERIFY'; syncCls = 'c-yellow';
      } else if (it.discogs_removed) {
        syncText = 'REMOVED'; syncCls = 'c-yellow';
      } else if (it.synced_to_discogs) {
        if (it.pending_delete_old) { syncText = 'OLD COPY'; syncCls = 'c-yellow'; }
        else { syncText = getFolderNameById(it.discogs_folder_id || '1').toUpperCase(); syncCls = 'c-green'; }
      } else if (it.pending_discogs_sync) {
        syncText = 'PENDING'; syncCls = 'c-red';
      }

      const flags = [
        it.needs_verification ? `<span class="badge badge-yellow">⏳ TO VERIFY</span>` : '',
        it.is_franken_copy ? `<span class="badge badge-red">🧟 FRANKEN</span>` : '',
        it.is_high_value ? `<span class="badge badge-yellow">🔥 VALUE</span>` : '',
        it.is_scarce ? `<span class="badge badge-purple">💎 SCARCE</span>` : '',
        it.discogs_removed ? `<span class="badge badge-yellow">Removed from Discogs</span>` : '',
        it.discogs_link_ambiguous ? `<span class="badge badge-yellow">⚠️ Link Copy</span>` : '',
        (Array.isArray(it.conflicts) && it.conflicts.length) ? `<span class="badge badge-purple">⚠️ Sync Conflict</span>` : '',
        isStashTasteStale(it) ? `<button type="button" class="badge badge-purple" style="border:none; cursor:pointer;" onclick="event.stopPropagation(); recalibrateSingleStashItem(${it.id});" title="Recalibrate taste for this item only">🔄 TASTE</button>` : '',
        it.spine_thumb_url ? `<span class="badge badge-mono">SPINE</span>` : ''
      ].filter(Boolean).join('');

      return `
        <div class="stash-item" onclick="openStashDetail(${it.id})">
          <div class="stash-top">
            ${renderPhotoImgOrPlaceholder(it.thumb_data_url || '', 'stash-thumb', `onerror="this.style.visibility='hidden'"`)}
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
    };

    if (activeStashSort === 'artist_az') {
      const groups = [];
      const groupMap = new Map();
      const populatedLetters = new Set();
      filtered.forEach(it => {
        const displayArtist = String(it.artist || 'Unknown Artist').trim();
        const key = sortKeyIgnoreThe(displayArtist) || 'unknown artist';
        const letter = alphaBucketForText(displayArtist);
        populatedLetters.add(letter);
        if (!groupMap.has(key)) {
          const g = { label: displayArtist, letter, items: [] };
          groupMap.set(key, g);
          groups.push(g);
        }
        groupMap.get(key).items.push(it);
      });
      const seenLetters = new Set();
      list.innerHTML = groups.map(g => {
        const anchor = !seenLetters.has(g.letter) ? ` data-alpha-anchor="${g.letter}"` : '';
        seenLetters.add(g.letter);
        return `<div class="stash-group-hdr"${anchor}><strong>${esc(g.label)}</strong><span>${g.items.length}</span></div>` +
          g.items.map(renderStashCard).join('');
      }).join('');
      renderStashAlphaRail(populatedLetters, true);
      return;
    }

    if (activeStashSort === 'title_az') {
      const groups = [];
      const groupMap = new Map();
      const populatedLetters = new Set();
      filtered.forEach(it => {
        const letter = alphaBucketForText(it.title || '');
        populatedLetters.add(letter);
        if (!groupMap.has(letter)) {
          const g = { letter, items: [] };
          groupMap.set(letter, g);
          groups.push(g);
        }
        groupMap.get(letter).items.push(it);
      });
      list.innerHTML = groups.map(g =>
        `<div class="stash-group-hdr" data-alpha-anchor="${g.letter}"><strong>${g.letter}</strong><span>${g.items.length}</span></div>` +
        g.items.map(renderStashCard).join('')
      ).join('');
      renderStashAlphaRail(populatedLetters, true);
      return;
    }

    renderStashAlphaRail(null, false);
    list.innerHTML = filtered.map(renderStashCard).join('');
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
    const prompt = buildTasteEvaluationPrompt(it, { localMatch });

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

      tasteCache.delete(`${norm(it.artist)}|${norm(it.title)}|v230`);
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

  window.recalibrateStashBatch = async (opts = {}) => {
    const { silentConfirm = false, skipConfirm = false, scope = null, suppressAutoSync = false } = (opts && typeof opts === 'object') ? opts : {};
    const noPrompt = Boolean(silentConfirm || skipConfirm);
    if (!CC.isAiReady()) { if (!noPrompt) toast('Add your Gemini API Key in Settings first'); return { updated: 0, failed: 0, skipped: true }; }
    if (!stashCache.length) { if (!noPrompt) toast('Your Stash is empty'); return { updated: 0, failed: 0, skipped: true }; }
    if (recalibratingStash) { if (!noPrompt) toast('Recalibration already running'); return { updated: 0, failed: 0, skipped: true }; }

    const staleItems = stashCache.filter(isStashTasteStale);
    let targets = scope === 'all' ? stashCache.slice() : (scope === 'stale' ? staleItems : staleItems);
    if (!noPrompt) {
      if (staleItems.length > 0 && staleItems.length < stashCache.length) {
        if (!confirm(`Recalibrate ${staleItems.length} stale Stash item(s) whose Taste Profile / Spotify library changed?`)) return { updated: 0, failed: 0, cancelled: true };
      } else if (staleItems.length === 0) {
        if (!confirm(`All ${stashCache.length} Stash items are up to date. Re-score ALL ${stashCache.length} items anyway?`)) return { updated: 0, failed: 0, cancelled: true };
        targets = stashCache.slice();
      } else {
        if (!confirm(`Recalibrate all ${targets.length} Stash item(s) against your latest Taste Profile & Soft Spots?`)) return { updated: 0, failed: 0, cancelled: true };
      }
    }
    if (!targets.length) return { updated: 0, failed: 0, skipped: true };

    const BATCH_SIZE = 5;
    recalibratingStash = true;
    recalibrateProgressText = `⏳ Recalibrating 1–${Math.min(BATCH_SIZE, targets.length)} of ${targets.length}...`;
    updateRecalibrateStashBtn();

    let updatedTotal = 0;
    let failedTotal = 0;

    const applyScoreToItem = (it, sc, nowTs) => {
      const score = Math.max(1, Math.min(10, Math.round(Number(sc.score) || 5)));
      const verdict = ['KEEP', 'LISTEN', 'SELL / SKIP'].includes(sc.verdict)
        ? sc.verdict
        : (score >= 7 ? 'KEEP' : score >= 5 ? 'LISTEN' : 'SELL / SKIP');
      const prev = { ...it };
      it.taste_score = score;
      it.taste_verdict = verdict;
      if (sc.summary) it.taste_summary = String(sc.summary).trim();
      if (sc.context_note !== undefined) it.context_note = String(sc.context_note || '').trim();
      if (Array.isArray(sc.notable_songs)) {
        it.notable_songs = normalizeNotableList(sc.notable_songs, it.artist).slice(0, 4);
      }
      if (sc.litmus_track) it.litmus_track = String(sc.litmus_track).trim();
      else if (!it.litmus_track && it.tracklist?.[0]?.title) it.litmus_track = it.tracklist[0].title;
      if (sc.litmus_artist !== undefined) it.litmus_artist = String(sc.litmus_artist || '').trim();
      it.taste_scored_at = nowTs;
      return CC.stampStashRevision(it, prev, [
        'taste_score', 'taste_verdict', 'taste_summary', 'context_note',
        'notable_songs', 'litmus_track', 'litmus_artist', 'taste_scored_at'
      ]);
    };

    try {
      for (let start = 0; start < targets.length; start += BATCH_SIZE) {
        if (!recalibratingStash) break;
        const chunk = targets.slice(start, start + BATCH_SIZE);
        const endNum = start + chunk.length;
        recalibrateProgressText = `⏳ Recalibrating ${start + 1}–${endNum} of ${targets.length}...`;
        updateRecalibrateStashBtn();
        setStatus(`🔄 Recalibrating ${start + 1}–${endNum} of ${targets.length}...`, true, { cancellable: true });

        const chunkWithMatches = chunk.map(it => {
          const lm = checkLocalSpotify(it);
          it.spotify_matches = lm;
          return { it, lm };
        });

        const stampedChunk = [];
        let batchParseFailed = false;
        try {
          const prompt = buildTasteEvaluationPrompt(chunkWithMatches);
          const batchRes = await CC.callAI([{ text: prompt }], null, { retryLabel: `Recalibrate ${start + 1}-${endNum}`, maxOutputTokens: 8192 });
          if (!recalibratingStash) break;

          const scoreMap = new Map((batchRes?.scores || []).map(s => [s.idx, s]));
          const now = Date.now();
          for (let i = 0; i < chunk.length; i++) {
            const sc = scoreMap.get(i);
            if (!sc) { failedTotal++; continue; }
            stampedChunk.push(applyScoreToItem(chunk[i], sc, now));
            updatedTotal++;
          }
        } catch (chunkErr) {
          if (chunkErr?.name === 'AbortError' || !recalibratingStash) throw chunkErr;
          if (chunkErr?.code !== 'AI_JSON_PARSE') throw chunkErr;
          batchParseFailed = true;
        }

        // Resilient 1-item-at-a-time fallback if the 5-item chunk still failed with AI_JSON_PARSE
        if (batchParseFailed) {
          for (let i = 0; i < chunkWithMatches.length; i++) {
            if (!recalibratingStash) break;
            const { it, lm } = chunkWithMatches[i];
            const itemNum = start + i + 1;
            recalibrateProgressText = `⏳ Fallback ${itemNum}/${targets.length}...`;
            updateRecalibrateStashBtn();
            setStatus(`🔄 Recalibrating item ${itemNum}/${targets.length} (1-by-1 fallback)...`, true, { cancellable: true });
            try {
              const singlePrompt = buildTasteEvaluationPrompt(it, { localMatch: lm });
              const singleRes = await CC.callAI([{ text: singlePrompt }], null, { retryLabel: `Recalibrate ${itemNum}/${targets.length}`, maxOutputTokens: 2048 });
              if (!recalibratingStash) break;
              stampedChunk.push(applyScoreToItem(it, singleRes, Date.now()));
              updatedTotal++;
            } catch (singleErr) {
              if (singleErr?.name === 'AbortError' || !recalibratingStash) throw singleErr;
              failedTotal++;
            }
          }
        }

        if (stampedChunk.length > 0) {
          await CC.commitBatchStashUpserts(stampedChunk, true);
        }

        await loadStashCache();
        renderStash();
      }

      tasteCache.clear();
      setStatus('', false);
      if (updatedTotal > 0) {
        updateCloudUI();
        if (!suppressAutoSync) scheduleGoogleAutoSync();
      }
      if (failedTotal > 0) {
        toast(`⚠️ Recalibrated ${updatedTotal} item(s), ${failedTotal} failed`, 4600);
      } else if (updatedTotal > 0) {
        toast(`✅ Recalibrated ${updatedTotal} Stash item(s)!`, 3600);
      }
      return { updated: updatedTotal, failed: failedTotal, total: targets.length, cancelled: !recalibratingStash };
    } catch (err) {
      setStatus('', false);
      if (err.name !== 'AbortError') toast(`Recalibration stopped after ${updatedTotal} item(s): ${err.message}`, 4800);
      return { updated: updatedTotal, failed: failedTotal + Math.max(0, targets.length - updatedTotal - failedTotal), total: targets.length, error: err?.message || 'Failed', cancelled: err?.name === 'AbortError' };
    } finally {
      recalibratingStash = false;
      recalibrateProgressText = '';
      updateRecalibrateStashBtn();
    }
  };

  function getStashPhotoSlots(it) {
    return CC.normalizePhotoSlots(it);
  }

  function getStashCoverSlotTiles(it) {
    if (!it) return [];
    const slots = getStashPhotoSlots(it);
    const tiles = [];
    if (slots.front) tiles.push({ slotKey: 'front', extraIdx: -1, label: 'FRONT', src: slots.front });
    if (slots.back) tiles.push({ slotKey: 'back', extraIdx: -1, label: 'BACK', src: slots.back });
    (slots.extras || []).forEach((src, i) => {
      if (src) tiles.push({ slotKey: 'extra', extraIdx: i, label: i === 0 ? 'EXTRA' : `EXTRA ${i + 1}`, src });
    });
    return tiles;
  }

  function getStashCoverPhotos(it) {
    if (!it) return [];
    const tiles = getStashCoverSlotTiles(it);
    if (tiles.length) return tiles.map(t => t.src);
    return it.thumb_data_url ? [it.thumb_data_url] : [];
  }

  window.openStashLightbox = (idx) => {
    if (!activeStashItem) return;
    const photos = getStashCoverPhotos(activeStashItem);
    const target = photos[idx];
    if (isUnresolvedDriveRef(target)) {
      toast('☁️ Photo is still on Google Drive — tap Sync with Cloud to download it first', 3600);
      return;
    }
    const resolved = photos.filter(p => p && !isUnresolvedDriveRef(p));
    const adjIdx = Math.max(0, resolved.indexOf(target));
    if (!resolved.length) return;
    openLightbox(resolved, adjIdx);
  };

  window.openStashSpineLightbox = () => {
    if (!activeStashItem?.spine_thumb_url) return;
    if (isUnresolvedDriveRef(activeStashItem.spine_thumb_url)) {
      toast('☁️ Spine photo is still on Google Drive — tap Sync with Cloud to download it first', 3600);
      return;
    }
    openLightbox([activeStashItem.spine_thumb_url], 0);
  };

  let stashReplaceTarget = null;

  window.toggleStashPhotoManager = (id) => {
    stashPhotoManagerOpen = !stashPhotoManagerOpen;
    stashAddPhotoMenuOpen = false;
    if (activeStashItem?.id === id) openStashDetail(id, true);
  };

  window.toggleStashAddPhotoMenu = (ev) => {
    if (ev) ev.stopPropagation();
    stashAddPhotoMenuOpen = !stashAddPhotoMenuOpen;
    const m = document.getElementById('sdAddSlotMenu');
    if (m) m.classList.toggle('hidden', !stashAddPhotoMenuOpen);
  };

  window.triggerStashPhotoAdd = (slot, ev) => {
    if (ev) ev.stopPropagation();
    stashAddPhotoMenuOpen = false;
    const m = document.getElementById('sdAddSlotMenu');
    if (m) m.classList.add('hidden');
    stashReplaceTarget = null;
    const map = { front: 'sdPhotoFront', back: 'sdPhotoBack', spine: 'sdPhotoSpine', extra: 'sdPhotoExtra' };
    document.getElementById(map[slot])?.click();
  };

  window.triggerStashPhotoReplace = (slotKey, extraIdx = -1, ev = null) => {
    if (ev) ev.stopPropagation();
    stashAddPhotoMenuOpen = false;
    const m = document.getElementById('sdAddSlotMenu');
    if (m) m.classList.add('hidden');
    stashReplaceTarget = { slotKey, extraIdx: Number(extraIdx) };
    if (slotKey === 'front') document.getElementById('sdPhotoFront')?.click();
    else if (slotKey === 'back') document.getElementById('sdPhotoBack')?.click();
    else document.getElementById('sdPhotoReplaceExtra')?.click();
  };

  // Direct Stash Detail photo add/replace/remove — uses stable named photo_slots & atomic live-row mutation
  // (never resurrects a deleted item; saves strictly at cfg.photoQuality; zero Discogs writes, zero grade changes).
  window.handleStashPhotoFiles = async (id, slot, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    const targetSyncId = it.sync_id || '';

    const spec = getPhotoQualitySpec();
    const replaceTarget = stashReplaceTarget;
    stashReplaceTarget = null;

    const handleAborted = async () => {
      await loadStashCache();
      renderStash();
      if (activeStashItem?.id === id) closeStashDetail();
      toast('Item was deleted while editing — photo change discarded', 3800);
    };

    const commitCoverWebp = async (webpDataUrl) => {
      const res = await CC.mutateStashItemIfAlive(id, targetSyncId, (liveRow) => {
        const slots = CC.normalizePhotoSlots(liveRow);
        if (slot === 'replace_idx' && replaceTarget) {
          if (replaceTarget.slotKey === 'front') slots.front = webpDataUrl;
          else if (replaceTarget.slotKey === 'back') slots.back = webpDataUrl;
          else if (replaceTarget.slotKey === 'extra' && replaceTarget.extraIdx >= 0 && replaceTarget.extraIdx < slots.extras.length) {
            slots.extras[replaceTarget.extraIdx] = webpDataUrl;
          } else {
            slots.extras.push(webpDataUrl);
          }
        } else if (slot === 'front') {
          slots.front = webpDataUrl;
        } else if (slot === 'back') {
          slots.back = webpDataUrl;
        } else {
          slots.extras.push(webpDataUrl);
        }
        const derived = CC.deriveThumbsFromSlots(slots, liveRow.discogs_thumb || '');
        return {
          ...liveRow,
          photo_slots: slots,
          thumbs: derived.thumbs,
          thumb_data_url: derived.thumb_data_url
        };
      }, ['photo_slots', 'thumbs', 'thumb_data_url']);

      if (res.aborted) { await handleAborted(); return; }
      await loadStashCache();
      renderStash();
      updateCloudUI();
      scheduleGoogleAutoSync();
      if (activeStashItem?.id === id) openStashDetail(id, true);
      toast('📷 Photo saved to Stash!');
    };

    // Single-file Front / Back / Spine / single Extra / Replace -> immediate auto-crop (if enabled) + interactive #cropModal preview!
    if (slot === 'spine' || files.length === 1) {
      const isSpine = slot === 'spine';
      const slotTitle = isSpine ? 'Spine' : (
        slot === 'front' ? 'Front' : (
          slot === 'back' ? 'Back' : (
            slot === 'replace_idx' && replaceTarget
              ? (replaceTarget.slotKey === 'front' ? 'Front' : (replaceTarget.slotKey === 'back' ? 'Back' : `Extra ${replaceTarget.extraIdx + 1}`))
              : 'Extra'
          )
        )
      );
      setStatus(`Loading ${slotTitle.toLowerCase()} photo...`, true);
      try {
        const pair = await decodeBlobToPhotoPair(files[0], {
          aiMaxDim: 2048,
          aiQuality: 0.90,
          saveMaxDim: spec.maxEdge || 2400,
          saveQuality: spec.quality,
          rawSave: spec.raw,
          keepOrigDataUrl: true,
          squarePreview: false
        });
        const fullSrc = pair.origDataUrl || pair.saveWebp;
        let initialRect = isSpine ? defaultCropRectForMode('spine') : { x: 0, y: 0, w: 1, h: 1 };
        let initialRotation = 0;

        if (cfg.autoCropPhotos && CC.isAiReady()) {
          setStatus(`✂️ Auto-cropping ${slotTitle}...`, true, { cancellable: true });
          const ac = await autoCropImageWithGemini(fullSrc, isSpine ? 'spine' : 'cover');
          let box = ac.box_2d;
          if (isSpine && ac.spine_rotation) {
            initialRotation = ac.spine_rotation;
            if (box) box = rotateBox2dClockwise(box, initialRotation);
          }
          const detRect = box ? box2dToNormRect(box, 0.025, isSpine ? 25 : 150) : null;
          if (detRect) initialRect = detRect;
        }

        setStatus('', false);
        openCropModal({
          dataUrl: fullSrc,
          title: `✂️ Crop & Rotate ${slotTitle}`,
          mode: isSpine ? 'spine' : 'cover',
          initialRect,
          initialRotation,
          onApply: async (croppedWebp, workingSourceWebp, appliedRect, wasRotated) => {
            if (isSpine) {
              const res = await CC.mutateStashItemIfAlive(id, targetSyncId, (liveRow) => ({
                ...liveRow,
                spine_source_url: workingSourceWebp || fullSrc,
                spine_thumb_url: croppedWebp,
                spine_flipped: false
              }), ['spine_source_url', 'spine_thumb_url', 'spine_flipped']);
              if (res.aborted) { await handleAborted(); return; }
              await loadStashCache();
              renderStash();
              updateCloudUI();
              scheduleGoogleAutoSync();
              if (activeStashItem?.id === id) openStashDetail(id, true);
              toast('✂️ Spine cropped & saved to Stash!');
            } else {
              // In raw mode when user kept Full Frame with zero rotation, store untouched original data URL!
              const r = appliedRect || {};
              const isUntouchedFullFrame = spec.raw && !wasRotated &&
                Number(r.x) === 0 && Number(r.y) === 0 && Number(r.w) >= 0.999 && Number(r.h) >= 0.999;
              await commitCoverWebp(isUntouchedFullFrame ? fullSrc : croppedWebp);
            }
          }
        });
      } catch (err) {
        setStatus('', false);
        if (err?.name === 'AbortError') return;
        toast('Photo error: ' + (err?.message || 'Failed'), 4200);
      }
      return;
    }

    // Multi-file Extra upload (2+ files at once): decode at cfg.photoQuality, batch auto-crop if enabled, and save atomically
    batchAutoCropCancelled = false;
    const processedExtras = [];
    setStatus(`Processing ${files.length} photo(s) (${spec.label})...`, true, { cancellable: true });
    try {
      for (let i = 0; i < files.length; i++) {
        if (batchAutoCropCancelled) { setStatus('', false); return; }
        const file = files[i];
        const pair = await decodeBlobToPhotoPair(file, {
          aiMaxDim: 2048,
          aiQuality: 0.90,
          saveMaxDim: spec.maxEdge || 2400,
          saveQuality: spec.quality,
          rawSave: spec.raw,
          keepOrigDataUrl: true,
          squarePreview: false
        });
        let finalWebp = pair.saveWebp;
        if (cfg.autoCropPhotos && CC.isAiReady()) {
          if (batchAutoCropCancelled) { setStatus('', false); return; }
          setStatus(`✂️ Auto-cropping Extra ${i + 1}/${files.length}...`, true, { cancellable: true });
          const ac = await autoCropImageWithGemini(pair.origDataUrl || pair.saveWebp, 'cover');
          if (batchAutoCropCancelled) { setStatus('', false); return; }
          if (ac.box_2d) {
            const cropped = await cropImageByBox(pair.origDataUrl || pair.saveWebp, ac.box_2d, {
              minBoxSpan: 150,
              padFrac: 0.025,
              maxLongEdge: spec.raw ? null : spec.maxEdge,
              maxWidthOnly: false,
              rotationDeg: 0,
              quality: spec.quality
            });
            if (cropped) finalWebp = cropped;
          }
        }
        processedExtras.push(finalWebp);
      }

      const res = await CC.mutateStashItemIfAlive(id, targetSyncId, (liveRow) => {
        const slots = CC.normalizePhotoSlots(liveRow);
        slots.extras.push(...processedExtras);
        const derived = CC.deriveThumbsFromSlots(slots, liveRow.discogs_thumb || '');
        return {
          ...liveRow,
          photo_slots: slots,
          thumbs: derived.thumbs,
          thumb_data_url: derived.thumb_data_url
        };
      }, ['photo_slots', 'thumbs', 'thumb_data_url']);

      setStatus('', false);
      if (res.aborted) { await handleAborted(); return; }
      await loadStashCache();
      renderStash();
      updateCloudUI();
      scheduleGoogleAutoSync();
      if (activeStashItem?.id === id) openStashDetail(id, true);
      toast(`📷 ${processedExtras.length} photos saved to Stash!`);
    } catch (err) {
      setStatus('', false);
      if (err?.name === 'AbortError' || batchAutoCropCancelled) return;
      toast('Photo error: ' + (err?.message || 'Failed'), 4200);
    }
  };

  window.openStashPhotoCrop = (id, slotKey, extraIdx = -1, ev = null) => {
    if (ev) ev.stopPropagation();
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    const targetSyncId = it.sync_id || '';
    if (slotKey === 'spine') {
      const src = it.spine_source_url || it.spine_thumb_url || '';
      if (!src) return;
      if (isUnresolvedDriveRef(src)) {
        toast('☁️ Spine photo is still on Google Drive — tap Sync with Cloud first', 3600);
        return;
      }
      openCropModal({
        dataUrl: src,
        title: '✂️ Crop & Rotate Spine',
        mode: 'spine',
        onApply: async (croppedWebp, workingSourceWebp) => {
          const res = await CC.mutateStashItemIfAlive(id, targetSyncId, (liveRow) => ({
            ...liveRow,
            spine_source_url: workingSourceWebp || src,
            spine_thumb_url: croppedWebp,
            spine_flipped: false
          }), ['spine_source_url', 'spine_thumb_url', 'spine_flipped']);
          await loadStashCache();
          renderStash();
          if (res.aborted) {
            if (activeStashItem?.id === id) closeStashDetail();
            toast('Item was deleted while editing — spine crop discarded', 3800);
            return;
          }
          updateCloudUI();
          scheduleGoogleAutoSync();
          if (activeStashItem?.id === id) openStashDetail(id, true);
          toast('✂️ Spine crop saved!');
        }
      });
      return;
    }

    const slots = getStashPhotoSlots(it);
    let src = '';
    let slotTitle = 'Photo';
    if (slotKey === 'front') { src = slots.front; slotTitle = 'Front'; }
    else if (slotKey === 'back') { src = slots.back; slotTitle = 'Back'; }
    else if (slotKey === 'extra') { src = (slots.extras || [])[extraIdx] || ''; slotTitle = extraIdx === 0 ? 'Extra' : `Extra ${extraIdx + 1}`; }
    if (!src) return;
    if (isUnresolvedDriveRef(src)) {
      toast('☁️ Photo is still on Google Drive — tap Sync with Cloud first', 3600);
      return;
    }
    openCropModal({
      dataUrl: src,
      title: `✂️ Crop & Rotate ${slotTitle}`,
      mode: 'cover',
      onApply: async (croppedWebp) => {
        const res = await CC.mutateStashItemIfAlive(id, targetSyncId, (liveRow) => {
          const liveSlots = CC.normalizePhotoSlots(liveRow);
          if (slotKey === 'front') liveSlots.front = croppedWebp;
          else if (slotKey === 'back') liveSlots.back = croppedWebp;
          else if (slotKey === 'extra' && extraIdx >= 0 && extraIdx < liveSlots.extras.length) liveSlots.extras[extraIdx] = croppedWebp;
          else return null;
          const derived = CC.deriveThumbsFromSlots(liveSlots, liveRow.discogs_thumb || '');
          return {
            ...liveRow,
            photo_slots: liveSlots,
            thumbs: derived.thumbs,
            thumb_data_url: derived.thumb_data_url
          };
        }, ['photo_slots', 'thumbs', 'thumb_data_url']);
        await loadStashCache();
        renderStash();
        if (res.aborted) {
          if (activeStashItem?.id === id) closeStashDetail();
          toast('Item was deleted while editing — crop discarded', 3800);
          return;
        }
        updateCloudUI();
        scheduleGoogleAutoSync();
        if (activeStashItem?.id === id) openStashDetail(id, true);
        toast(`✂️ ${slotTitle} crop saved!`);
      }
    });
  };

  window.removeStashPhotoSlot = async (id, slotKey, extraIdx = -1, ev = null) => {
    if (ev) ev.stopPropagation();
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    if (!confirm('Remove this photo from this Stash item?')) return;
    const res = await CC.mutateStashItemIfAlive(id, it.sync_id || '', (liveRow) => {
      const slots = CC.normalizePhotoSlots(liveRow);
      if (slotKey === 'front') slots.front = '';
      else if (slotKey === 'back') slots.back = '';
      else if (slotKey === 'extra' && extraIdx >= 0 && extraIdx < slots.extras.length) slots.extras.splice(extraIdx, 1);
      const derived = CC.deriveThumbsFromSlots(slots, liveRow.discogs_thumb || '');
      return {
        ...liveRow,
        photo_slots: slots,
        thumbs: derived.thumbs,
        thumb_data_url: derived.thumb_data_url
      };
    }, ['photo_slots', 'thumbs', 'thumb_data_url']);
    await loadStashCache();
    renderStash();
    if (res.aborted) {
      if (activeStashItem?.id === id) closeStashDetail();
      return;
    }
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
    const res = await CC.mutateStashItemIfAlive(id, it.sync_id || '', (liveRow) => ({
      ...liveRow,
      spine_thumb_url: '',
      spine_source_url: '',
      spine_flipped: false
    }), ['spine_thumb_url', 'spine_source_url', 'spine_flipped']);
    await loadStashCache();
    renderStash();
    if (res.aborted) {
      if (activeStashItem?.id === id) closeStashDetail();
      return;
    }
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast('Spine removed');
  };

  // Manual 90° Spine Rotate in Stash Detail (any orientation 0°/90°/180°/270° reachable in 1-3 taps, zero AI!)
  window.rotateStashSpine90 = async (id, ev) => {
    if (ev) ev.stopPropagation();
    const it = stashCache.find(x => x.id === id);
    if (!it || !it.spine_thumb_url) return;
    if (isUnresolvedDriveRef(it.spine_thumb_url)) {
      toast('☁️ Spine photo is still on Google Drive — tap Sync with Cloud first', 3600);
      return;
    }
    const spec = getPhotoQualitySpec();
    const sourceUrl = it.spine_source_url || it.spine_thumb_url;
    const rotated = await rotateDataUrlByDeg(it.spine_thumb_url, 90, 'image/webp', spec.quality, spec.raw ? null : spec.spineMaxW);
    const res = await CC.mutateStashItemIfAlive(id, it.sync_id || '', (liveRow) => ({
      ...liveRow,
      spine_source_url: liveRow.spine_source_url || sourceUrl,
      spine_thumb_url: rotated,
      spine_flipped: !Boolean(liveRow.spine_flipped)
    }), ['spine_source_url', 'spine_thumb_url', 'spine_flipped']);
    await loadStashCache();
    renderStash();
    if (res.aborted) {
      if (activeStashItem?.id === id) closeStashDetail();
      toast('Item was deleted while rotating spine', 3400);
      return;
    }
    updateCloudUI();
    scheduleGoogleAutoSync();
    if (activeStashItem?.id === id) openStashDetail(id, true);
    toast('↻ Spine rotated 90° & saved!', 1800);
  };
  window.flipStashSpine180 = window.rotateStashSpine90;

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
    if (!isOwnedByActiveDiscogsAccount(it)) {
      toast(`⚠️ Cannot move on Discogs — this copy belongs to @${it.discogs_account}, not @${cfg.discogsUser}.`, 4800);
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

  function formatConflictValue(val) {
    if (val === null || val === undefined || val === '') return '(empty)';
    if (Array.isArray(val)) {
      if (!val.length) return '(empty)';
      const preview = val.slice(0, 3).map(v => {
        if (v && typeof v === 'object') return v.title || v.name || JSON.stringify(v);
        return String(v);
      }).join(', ');
      return `${val.length} item${val.length === 1 ? '' : 's'}${preview ? ` (${preview}${val.length > 3 ? ', …' : ''})` : ''}`;
    }
    if (typeof val === 'object') {
      try { return JSON.stringify(val).slice(0, 120); } catch (_) { return '(object)'; }
    }
    const str = String(val);
    return str.length > 140 ? `${str.slice(0, 137)}…` : str;
  }

  window.openStashDetail = (id, fromPop = false) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    if (activeStashItem?.id !== id) {
      stashPhotoManagerOpen = false;
      stashAddPhotoMenuOpen = false;
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
      const isHydratingNow = hydratingStashIds.has(it.id);
      links = `<button id="sdBtnRefreshDiscogs" type="button" class="btn btn-secondary btn-sm" ${isHydratingNow ? 'disabled' : ''} onclick="refreshSingleStashDiscogsData(${it.id}, false)">${isHydratingNow ? '⏳ Loading Discogs...' : '🔄 Refresh Discogs'}</button>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${esc(it.discogs_url)}">💿 Discogs</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/history/${it.discogs_id}">📈 Sales History</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/post/${it.discogs_id}">🏷️ Sell</a>` + links;
    }
    links = (it.needs_verification
      ? `<button type="button" class="btn btn-green btn-sm" onclick="verifyQueuedStashItem(${it.id})">🔍 Verify &amp; Price Now</button>`
      : `<button type="button" class="btn btn-purple btn-sm" onclick="startEditStashItem(${it.id})">🔄 Edit / Re-Check</button>`) + links;

    let alerts = '';
    if (it.needs_verification) {
      alerts += `<div class="alert-box alert-dup">⏳ <strong>Queued Offline (Not Verified Yet)</strong> — tap <strong>🔍 Verify &amp; Price Now</strong> to load these saved photos &amp; UPC straight into the scanner and verify on Discogs.</div>`;
    }
    if (it.is_franken_copy) {
      alerts += `<div class="alert-box alert-format-warn">🧟 <strong>FRANKEN-COPY (${esc((it.franken_type || 'mismatch').replace(/_/g, ' '))})</strong>${it.franken_note ? ` — ${esc(it.franken_note)}` : ' — Physical media does not match packaging.'}</div>`;
    }
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
          <div style="font-size:0.78rem; margin-top:4px;">Current: <code>${esc(formatConflictValue(c.keptVal))}</code> · Competing edit: <code>${esc(formatConflictValue(c.retainedVal))}</code></div>
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

    const staleBadgeHtml = isStashTasteStale(it) ? `<div style="margin-bottom:6px;"><span class="badge badge-purple">🔄 Taste updated</span></div>` : '';
    const localBadges = `${staleBadgeHtml}${buildSpotifyHowYouKnowHtml(it, localMatch, false)}`;

    const contextTxt = it.context_note || it.cultural_reason || '';

    // Build responsive Stash Detail Photo Gallery using stable named photo_slots + unresolved Drive ref placeholders
    const coverTiles = getStashCoverSlotTiles(it);
    let galleryHtml = '<div class="photo-gallery" style="margin-bottom:12px;">';
    galleryHtml += `
      <input id="sdPhotoFront" class="hidden-file" type="file" accept="image/*" onchange="handleStashPhotoFiles(${it.id}, 'front', this.files); this.value='';" />
      <input id="sdPhotoBack" class="hidden-file" type="file" accept="image/*" onchange="handleStashPhotoFiles(${it.id}, 'back', this.files); this.value='';" />
      <input id="sdPhotoSpine" class="hidden-file" type="file" accept="image/*" onchange="handleStashPhotoFiles(${it.id}, 'spine', this.files); this.value='';" />
      <input id="sdPhotoExtra" class="hidden-file" type="file" accept="image/*" multiple onchange="handleStashPhotoFiles(${it.id}, 'extra', this.files); this.value='';" />
      <input id="sdPhotoReplaceExtra" class="hidden-file" type="file" accept="image/*" onchange="handleStashPhotoFiles(${it.id}, 'replace_idx', this.files); this.value='';" />
    `;
    if (coverTiles.length) {
      const singleCls = coverTiles.length === 1 ? 'single-cover' : '';
      galleryHtml += `<div class="photo-gallery-covers ${singleCls}">${coverTiles.map((tile, i) => `
        <div class="photo-tile" onclick="openStashLightbox(${i})" title="Tap to zoom fullscreen">
          ${renderPhotoImgOrPlaceholder(tile.src, '', 'alt=""')}
          <span class="photo-tile-label">${tile.label}</span>
          ${stashPhotoManagerOpen ? `<div class="photo-tile-actions"><button type="button" class="photo-tile-btn" onclick="triggerStashPhotoReplace('${tile.slotKey}', ${tile.extraIdx}, event)" title="Replace photo">🔄</button><button type="button" class="photo-tile-btn" onclick="openStashPhotoCrop(${it.id}, '${tile.slotKey}', ${tile.extraIdx}, event)" title="Crop or rotate photo">✂️</button><button type="button" class="photo-tile-btn danger" onclick="removeStashPhotoSlot(${it.id}, '${tile.slotKey}', ${tile.extraIdx}, event)" title="Delete photo">✕</button></div>` : ''}
        </div>
      `).join('')}</div>`;
    } else if (it.thumb_data_url) {
      galleryHtml += `<div class="photo-gallery-covers single-cover">
        <div class="photo-tile" onclick="openStashLightbox(0)" title="Tap to zoom fullscreen">
          ${renderPhotoImgOrPlaceholder(it.thumb_data_url, '', 'alt=""')}
          <span class="photo-tile-label">DISCOGS</span>
        </div>
      </div>`;
    }
    if (it.spine_thumb_url) {
      galleryHtml += `
        <div class="photo-gallery-spine">
          <div class="photo-gallery-spine-bar">
            <span style="font-size:0.7rem; font-weight:800; letter-spacing:0.06em; color:var(--muted);">SPINE</span>
            ${stashPhotoManagerOpen ? `
              <div class="inline-actions" style="gap:4px;">
                <button type="button" class="photo-tile-btn" onclick="triggerStashPhotoAdd('spine', event)" title="Replace spine photo">🔄</button>
                <button type="button" class="photo-tile-btn" onclick="openStashPhotoCrop(${it.id}, 'spine', -1, event)" title="Crop & rotate spine">✂️</button>
                <button type="button" class="photo-tile-btn" onclick="rotateStashSpine90(${it.id}, event)" title="Rotate spine 90°">↻</button>
                <button type="button" class="photo-tile-btn danger" onclick="removeStashSpine(${it.id}, event)" title="Delete spine photo">✕</button>
              </div>
            ` : ''}
          </div>
          <div class="photo-gallery-spine-imgwrap" onclick="openStashSpineLightbox()" title="Tap to zoom spine">
            ${renderPhotoImgOrPlaceholder(it.spine_thumb_url, '', 'alt=""')}
          </div>
        </div>
      `;
    }
    galleryHtml += `
      <div class="sd-photo-header-bar">
        <span style="font-size:0.72rem; color:var(--muted);">${stashPhotoManagerOpen ? 'Tap 🔄 Replace, ✂️ Crop, ↻ Rotate, or ✕ Delete' : ((photos.length || it.spine_thumb_url) ? 'Tap any photo to zoom fullscreen' : 'No photos saved yet')}</span>
        ${stashPhotoManagerOpen ? `
          <div class="inline-actions" style="gap:6px;">
            <div class="sd-add-slot-wrap">
              <button type="button" class="btn btn-green btn-sm" style="min-height:30px; padding:3px 10px; font-size:0.74rem;" onclick="toggleStashAddPhotoMenu(event)">➕ Add Photo</button>
              <div id="sdAddSlotMenu" class="sd-add-slot-menu ${stashAddPhotoMenuOpen ? '' : 'hidden'}">
                <button type="button" class="sd-add-slot-item" onclick="triggerStashPhotoAdd('front', event)">Front</button>
                <button type="button" class="sd-add-slot-item" onclick="triggerStashPhotoAdd('back', event)">Back</button>
                <button type="button" class="sd-add-slot-item" onclick="triggerStashPhotoAdd('spine', event)">Spine</button>
                <button type="button" class="sd-add-slot-item" onclick="triggerStashPhotoAdd('extra', event)">Extra</button>
              </div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" style="min-height:30px; padding:3px 10px; font-size:0.74rem;" onclick="toggleStashPhotoManager(${it.id})">✓ Done</button>
          </div>
        ` : `
          <button type="button" class="btn btn-secondary btn-sm" style="min-height:30px; padding:3px 10px; font-size:0.74rem;" onclick="toggleStashPhotoManager(${it.id})">📷 Manage Photos</button>
        `}
      </div>
    `;
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
        <div style="font-size:0.87rem; color:#d4d4d4;">${esc(it.taste_summary || 'No taste summary saved.')}</div>
        ${contextTxt ? `<div class="context-box"><strong>📖 Context:</strong> ${esc(contextTxt)}</div>` : ''}
        <div style="margin-top:10px; font-size:0.84rem; color:#cccccc;">${buildNotableHitsHtml(it, 'stash')}</div>
      </div>

      <div class="section-block">
        <div class="section-heading">🎵 Tracklist (${(it.tracklist || []).length})</div>
        <div class="tracklist-open">${(it.tracklist || []).length ? buildTracklistHtml(it.tracklist, localMatch.matchedTracks, 'stash', it.artist, localMatch.altMatchedTracks) : (hydratingStashIds.has(it.id) ? `<div style="padding:12px; color:var(--muted); font-size:0.84rem;">⏳ Loading tracklist &amp; values from Discogs...</div>` : buildTracklistHtml([], localMatch.matchedTracks, 'stash', it.artist, localMatch.altMatchedTracks))}</div>
      </div>

      ${it.pressing_notes ? `
        <div class="section-block">
          <div class="section-heading">🔎 Pressing Notes &amp; Identifiers</div>
          <div class="notes-box">${formatPressingNotesHtml(it.pressing_notes, false)}</div>
        </div>
      ` : ''}

      <div class="grade-box">
        <strong style="display:block; font-size:0.92rem; margin-bottom:8px;">🏷️ Discogs Grading &amp; Notes</strong>
        <div class="voice-row">
          <button id="btnVoiceRegradeStash" type="button" class="btn btn-purple btn-sm dictate-btn" style="flex:1;" onclick="voiceRegrade('stash', 'btnVoiceRegradeStash')">
            ${VOICE_BTN_IDLE}
          </button>
          <button id="btnVoiceCancelStash" type="button" class="btn btn-secondary btn-sm hidden" onclick="cancelVoiceRegrade()">
            ✕ Cancel
          </button>
        </div>
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
          ${(() => {
            const isSyncedCopy = Boolean(it.synced_to_discogs && !it.discogs_removed && it.discogs_id);
            const curAcct = (cfg.discogsUser || '').trim().toLowerCase();
            const itemAcct = String(it.discogs_account || '').trim().toLowerCase();
            const acctMatches = !itemAcct || !curAcct || itemAcct === curAcct;
            if (isSyncedCopy && acctMatches) {
              return `<button id="sdBtnDelete" class="btn btn-danger btn-sm" onclick="deleteStashItem(${it.id}, true)">🗑️ Delete from Discogs &amp; Stash</button>`;
            }
            if (isSyncedCopy && !acctMatches) {
              return `<button id="sdBtnDelete" class="btn btn-danger btn-sm" onclick="deleteStashItem(${it.id}, false)">🗑️ Delete from Stash (Local Only)</button>`;
            }
            return `<button id="sdBtnDelete" class="btn btn-danger btn-sm" onclick="deleteStashItem(${it.id}, false)">🗑️ Delete from Stash</button>`;
          })()}
        </div>
      </div>
    `;

    document.getElementById('stashDetailModal').classList.remove('hidden');
    body.scrollTop = 0;
    syncTrackPlayButtons();
    updateStashPushBtnState();

    // Auto-hydrate missing Discogs details once per session when opening an unhydrated Discogs-linked item
    if (
      hasDiscogs &&
      cfg.discogsToken &&
      !Number(it.discogs_details_synced_at || 0) &&
      !autoHydrateAttemptedIds.has(it.id) &&
      !hydratingStashIds.has(it.id)
    ) {
      refreshSingleStashDiscogsData(it.id, true);
    }
  };

  window.refreshSingleStashDiscogsData = async (id, silent = false) => {
    const it = stashCache.find(x => x.id === id);
    if (!it || !it.discogs_id) return;
    if (!cfg.discogsToken) {
      if (!silent) toast('Add your Discogs Token in Settings first');
      return;
    }
    if (hydratingStashIds.has(id)) return;
    if (silent) autoHydrateAttemptedIds.add(id);
    else autoHydrateAttemptedIds.delete(id);

    hydratingStashIds.add(id);
    const btn = document.getElementById('sdBtnRefreshDiscogs');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Loading Discogs...'; }
    let didUpdate = false;
    try {
      const res = await CC.enrichSyncedDiscogsStashItems({
        stashIds: [id],
        forceRefresh: !silent,
        quiet: silent
      });
      didUpdate = Number(res.updatedRows || 0) > 0;
      await loadStashCache();
      renderStash();
      updateCloudUI();
      if (didUpdate) scheduleGoogleAutoSync();
      if (!silent) {
        setStatus('', false);
        if (didUpdate && res.statsFailedReleases > 0) {
          toast('⚠️ Updated details, but Discogs market prices were unavailable — kept last known price', 4600);
        } else if (didUpdate) {
          toast('✅ Updated tracklist & Discogs values!', 3200);
        } else {
          toast('Discogs details could not be fetched', 3200);
        }
      }
    } catch (err) {
      if (!silent) {
        setStatus('', false);
        toast('Discogs refresh failed: ' + (err?.message || 'Error'), 4200);
      }
    } finally {
      hydratingStashIds.delete(id);
      if (activeStashItem?.id === id) {
        if (didUpdate || !silent) {
          openStashDetail(id, true);
        } else {
          const b = document.getElementById('sdBtnRefreshDiscogs');
          if (b) { b.disabled = false; b.textContent = '🔄 Refresh Discogs'; }
        }
      }
    }
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
      if (!isOwnedByActiveDiscogsAccount(it)) {
        toast(`⚠️ Cannot sync grades to Discogs — this copy belongs to @${it.discogs_account}, not @${cfg.discogsUser || '(none)'}.`, 5200);
        return;
      }
      setStatus(`Retrying grade & notes sync on new pressing #${it.discogs_id}...`, true);
      const fId = it.discogs_folder_id || cfg.discogsFolderId || '1';
      const fieldRes = await CC.syncDiscogsInstanceFields(fId, it.discogs_id, it.discogs_instance_id, it.media_condition, it.sleeve_condition, it.condition_note);
      it.pending_field_sync = fieldRes.failedCount > 0;
      await CC.mutateStashItemIfAlive(it.id, it.sync_id, (live) => ({ ...live, pending_field_sync: it.pending_field_sync }), ['pending_field_sync']);

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
    await CC.mutateStashItemIfAlive(it.id, it.sync_id, (live) => ({ ...live, pending_delete_old: null }), ['pending_delete_old']);
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

    let remoteOutcome = 'local_only'; // 'local_only' | 'wrong_account' | 'synced' | 'partial_fields' | 'ambiguous_copies' | 'remote_error'
    let remoteMsg = '';

    if (updated.synced_to_discogs && updated.discogs_id && cfg.discogsUser) {
      if (!isOwnedByActiveDiscogsAccount(updated)) {
        remoteOutcome = 'wrong_account';
        remoteMsg = `💾 Saved locally only — this copy belongs to @${updated.discogs_account}, not @${cfg.discogsUser}.`;
      } else {
        try {
          let instId = updated.discogs_instance_id;
          let fId = updated.discogs_folder_id || cfg.discogsFolderId || '1';
          let remoteCopies = 0;
          if (!instId) {
            const insts = await CC.findDiscogsInstances(updated.discogs_id, { throwOnError: true });
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
              remoteOutcome = 'partial_fields';
              remoteMsg = `⚠️ Saved locally, but ${fieldRes.failedCount} Discogs field(s) failed: ${fieldRes.errors[0] || ''}`;
            } else {
              remoteOutcome = 'synced';
              remoteMsg = '✅ Updated Stash & Discogs grades!';
            }
          } else {
            remoteOutcome = 'ambiguous_copies';
            remoteMsg = `💾 Saved locally — found ${remoteCopies} Discogs cop${remoteCopies === 1 ? 'y' : 'ies'}, so remote grades were not overwritten.`;
          }
        } catch (err) {
          updated.pending_field_sync = true;
          changedFields.push('pending_field_sync');
          remoteOutcome = 'remote_error';
          remoteMsg = `⚠️ Saved locally, but Discogs update failed (${err?.message || 'Error'})`;
        }
      }
    }

    // Persist locally via mutateStashItemIfAlive so if the item was deleted while waiting on Discogs,
    // it aborts cleanly instead of resurrecting the deleted row!
    try {
      const patch = {};
      changedFields.forEach(f => { patch[f] = updated[f]; });
      const mutRes = await CC.mutateStashItemIfAlive(id, it.sync_id || '', (liveRow) => ({
        ...liveRow,
        ...patch
      }), changedFields);
      await loadStashCache();
      renderStash();
      if (mutRes.aborted) {
        if (activeStashItem?.id === id) closeStashDetail();
        toast('Item was deleted while saving — local grade change discarded', 3800);
        return;
      }
      updateCloudUI();
      scheduleGoogleAutoSync();
      if (activeStashItem?.id === id) openStashDetail(id, true);
      if (remoteMsg) toast(remoteMsg, remoteOutcome === 'synced' ? 3000 : 5200);
      else toast('💾 Grade & notes saved!');
    } catch (localErr) {
      if (remoteOutcome === 'synced') {
        toast(`⚠️ Discogs updated, but local Stash save failed: ${localErr?.message || 'Storage error'}`, 5600);
      } else {
        toast(`Save failed: ${localErr?.message || 'Storage error'}`, 5200);
      }
    }
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
    const targetFolder = CC.resolveTargetDiscogsFolderId(updated.format, updated.intended_discogs_folder_id || null);

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

  window.deleteStashItem = async (id, deleteRemote = false) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    const isSynced = Boolean(it.synced_to_discogs && !it.discogs_removed && it.discogs_id);
    const willDeleteRemote = Boolean(deleteRemote && isSynced);

    const promptMsg = willDeleteRemote
      ? `Delete "${it.artist} — ${it.title}" from BOTH Discogs and Local Stash?\n\nThis removes copy #${it.discogs_instance_id || it.discogs_id} from your Discogs collection so it will not reappear on future syncs.`
      : `Remove "${it.artist} — ${it.title}" from Local Stash?`;
    if (!confirm(promptMsg)) return;

    const delBtn = document.getElementById('sdBtnDelete');
    if (delBtn) delBtn.disabled = true;
    if (willDeleteRemote) setStatus(`🗑️ Deleting copy #${it.discogs_instance_id || it.discogs_id} from Discogs & Stash...`, true);

    try {
      const res = await CC.deleteDiscogsAndStashCopy(it, { deleteRemote: willDeleteRemote });
      setStatus('', false);
      closeStashDetail();
      const idxRec = await CC.idbGet('meta', 'discogs_collection_index');
      if (idxRec?.value) discogsCollectionIndex = idxRec.value;
      updateDiscogsCollectionUI();
      await loadStashCache();
      renderStash();
      updateCloudUI();
      scheduleGoogleAutoSync();
      if (res.remoteStatus === 'deleted_remote') {
        toast('🗑️ Deleted from Discogs & Local Stash');
      } else if (res.remoteStatus === 'already_absent') {
        toast('🗑️ Already absent on Discogs — removed from Local Stash');
      } else {
        toast('🗑️ Deleted from Local Stash');
      }
    } catch (err) {
      setStatus('', false);
      if (delBtn) delBtn.disabled = false;
      toast('Delete failed (local item kept): ' + (err?.message || 'Error'), 5200);
    }
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

  function countUnresolvedDrivePhotoRefs(items) {
    let n = 0;
    const seen = new Set();
    const check = (v) => {
      if (isUnresolvedDriveRef(v) && !seen.has(v)) { seen.add(v); n++; }
    };
    (items || []).forEach(it => {
      check(it?.thumb_data_url);
      check(it?.spine_thumb_url);
      check(it?.spine_source_url);
      (it?.thumbs || []).forEach(check);
      if (it?.photo_slots) {
        check(it.photo_slots.front);
        check(it.photo_slots.back);
        (it.photo_slots.extras || []).forEach(check);
      }
    });
    return n;
  }

  window.exportJSON = async () => {
    try {
      let unresolvedCount = countUnresolvedDrivePhotoRefs(stashCache);
      if (unresolvedCount > 0 && CC.isGoogleSignedIn()) {
        setStatus(`☁️ Downloading ${unresolvedCount} Drive photo(s) for self-contained export...`, true);
        try {
          await CC.pullFromGoogleDrive({ quiet: true });
          await loadStashCache();
        } catch (_) {}
        setStatus('', false);
        unresolvedCount = countUnresolvedDrivePhotoRefs(stashCache);
      }

      const deletedRec = await CC.idbGet('meta', 'deleted_sync_ids');
      const aliasesRec = await CC.idbGet('meta', 'sync_id_aliases_v1');
      const payload = {
        version: 11,
        exportedAt: new Date().toISOString(),
        unresolvedDrivePhotos: unresolvedCount,
        stash: stashCache,
        deleted_sync_ids: deletedRec?.value || {},
        sync_id_aliases: aliasesRec?.value || {},
        spotifyProfile
      };
      dl(JSON.stringify(payload), `softspot-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
      if (unresolvedCount > 0) {
        toast(`⚠️ JSON backup downloaded (${unresolvedCount} unresolved Drive photo ref${unresolvedCount === 1 ? '' : 's'} — sync Google Drive first for 100% offline photos)`, 5600);
      } else {
        toast('✅ Self-contained JSON backup downloaded!');
      }
    } catch (e) {
      setStatus('', false);
      toast('Export failed: ' + (e?.message || 'Error'), 4500);
    }
  };

  window.importJSON = async (file) => {
    if (!file) return;
    let data = null;
    // 1. Parse & validate JSON/schema strictly before touching IndexedDB
    try {
      const text = await file.text();
      data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Root backup value must be a JSON object');
      }
      if (data.stash !== undefined && !Array.isArray(data.stash)) {
        throw new Error('"stash" field must be an array');
      }
      if (data.spotifyProfile !== undefined && data.spotifyProfile !== null && typeof data.spotifyProfile !== 'object') {
        throw new Error('"spotifyProfile" field must be an object');
      }
      if (data.deleted_sync_ids !== undefined && (typeof data.deleted_sync_ids !== 'object' || Array.isArray(data.deleted_sync_ids))) {
        throw new Error('"deleted_sync_ids" field must be an object');
      }
      if (data.sync_id_aliases !== undefined && (typeof data.sync_id_aliases !== 'object' || Array.isArray(data.sync_id_aliases))) {
        throw new Error('"sync_id_aliases" field must be an object');
      }
    } catch (e) {
      toast('Invalid JSON: ' + (e?.message || 'Parse error'), 4800);
      return;
    }

    // 2. Atomic idempotent merge inside ONE readwrite IndexedDB transaction (no partial commits on failure)
    try {
      const res = await CC.importJsonBackupAtomic(data);
      if (res.spotifyProfile) {
        spotifyProfile = res.spotifyProfile;
        const dnaEl = document.getElementById('cfgTasteDna');
        const ssEl = document.getElementById('cfgSoftSpots');
        if (dnaEl) dnaEl.value = spotifyProfile.tasteDna || '';
        if (ssEl) ssEl.value = spotifyProfile.softSpots || '';
        updateSpotifyUI();
      }
      await loadStashCache();
      renderStash();
      updateCloudUI();
      scheduleGoogleAutoSync();
      toast(`✅ Backup restored atomically (${res.totalStashCount} item${res.totalStashCount === 1 ? '' : 's'})!`);
    } catch (e) {
      toast('Restore failed (storage/write error — no partial changes committed): ' + (e?.message || 'Error'), 5600);
    }
  };

  // ==================== GOOGLE DRIVE V2 CLOUD SYNC UI ====================
  function updateCloudUI(customLabel = '') {
    const hPill = document.getElementById('cloudPill');
    const aPill = document.getElementById('pillCloud');
    const sum = document.getElementById('googleSyncSummary');
    const mismatchBox = document.getElementById('googleAccountMismatchBox');
    const conflictsBox = document.getElementById('googleConflictsBox');
    const btnIn = document.getElementById('btnGoogleSignIn');
    const signedInRow = document.getElementById('googleSignedInRow');
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
      if (signedInRow) signedInRow.classList.remove('hidden');
      if (btnSync) {
        btnSync.classList.remove('hidden');
        btnSync.disabled = Boolean(googleSyncInFlight || (pending === 0 && !cloudEmptyAwaitingPublish));
      }
      if (btnOut) btnOut.classList.remove('hidden');
    } else if (hasClient) {
      const wasConnected = Boolean(cfg.googleBoundEmail || cfg.googleLastSyncAt || cfg.googleLastLoadAt);
      if (btnIn) {
        btnIn.textContent = wasConnected ? '🔄 Reconnect Google Drive' : '☁️ Connect Google Drive';
        btnIn.classList.remove('hidden');
      }
      if (signedInRow) signedInRow.classList.add('hidden');
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
      if (signedInRow) signedInRow.classList.add('hidden');
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
    const acEl = document.getElementById('cfgAutoCropPhotos');
    if (acEl) acEl.checked = cfg.autoCropPhotos !== false;
    const pqEl = document.getElementById('cfgPhotoQuality');
    if (pqEl) pqEl.value = cfg.photoQuality || 'medium';
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

  window.syncStashWithCloudUI = async () => {
    if (CC.isGoogleSignedIn() && !cloudAccountMismatch) {
      await syncGoogleDriveNow();
      return;
    }
    const driveConfigured = Boolean(cfg.googleBoundEmail || cfg.googleEmail || cfg.googleLastSyncAt || cfg.googleLastLoadAt);
    if (driveConfigured && !cloudAccountMismatch) {
      await googleConnectAndLoad();
      // If reconnect succeeded cleanly and local pending changes are waiting, automatically finish pushing them in one tap!
      if (CC.isGoogleSignedIn() && !cloudAccountMismatch && !cloudEmptyAwaitingPublish && CC.getPendingCloudChanges() > 0) {
        await syncGoogleDriveNow();
      }
      return;
    }
    switchView('settings');
    const acc = document.getElementById('accCloud');
    if (acc) acc.open = true;
    toast(cloudAccountMismatch
      ? 'Review your Google account mismatch in Settings before syncing.'
      : 'Connect Google Drive in Settings to sync your Stash across devices.', 4200);
  };

  function setCloudButtonsDisabled(disabled) {
    ['btnGoogleSignIn', 'btnGoogleSyncNow'].forEach(id => {
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
    saveSettings(true, 'cloud');
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
    saveSettings(true, 'cloud');
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
            const warnNote = res.partialErrors?.length
              ? ` · ⚠️ ${res.partialErrors.length} warning(s)`
              : '';
            const confNote = res.conflicts?.length ? ` · ⚠️ ${res.conflicts.length} conflict(s)` : '';
            toast(`☁️ Synced ${res.stashCount} Stash item(s) (↑${res.uploadedBatches} batch${res.uploadedBatches === 1 ? '' : 'es'})${photoNote}${confNote}${warnNote}`, 4200);
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
    saveSettings(true, 'cloud');
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
    if (rebuildWorkflowActive) return;
    if (!cfg.googleAutoSync || !CC.isGoogleSignedIn()) return;
    if (cloudAccountMismatch || cloudEmptyAwaitingPublish) return;
    if (!cfg.googleBoundEmail || (cfg.googleEmail && cfg.googleBoundEmail !== cfg.googleEmail)) return;
    if (googleSyncInFlight) {
      cloudFollowupNeeded = true;
      return;
    }
    clearTimeout(googleAutoSyncTimer);
    googleAutoSyncTimer = setTimeout(() => {
      if (rebuildWorkflowActive) return;
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

  // Single-flight per account Discogs collection & folder reconciliation (explicit user-triggered only; Drive-first gated!)
  window.syncWithDiscogsUI = async (manual = true, quiet = false, opts = {}) => {
    const { skipDriveGate = false, suppressAutoSync = false } = (opts && typeof opts === 'object') ? opts : {};
    if (manual && !suppressAutoSync) saveSettings(true, 'discogs');
    const account = (cfg.discogsUser || '').trim();
    if (!cfg.discogsToken || !account) {
      if (manual) toast('Verify your Discogs account in Settings first');
      return null;
    }
    if (activeDiscogsRefreshPromise && activeDiscogsRefreshAccount === account) {
      return activeDiscogsRefreshPromise;
    }

    // Drive-Before-Discogs Safety Gate (skipped when called inside Rebuild Workflow, where Drive runs explicitly in Steps 1 & 6):
    // 1) If Google Drive is connected & signed in -> sync Drive FIRST so photos, spines & grades load before checking Discogs.
    // 2) If Google Drive was previously configured but signed out/expired -> block Discogs sync with a clear prompt.
    // 3) If Google Drive was never configured (local-only user) -> proceed normally.
    if (!skipDriveGate) {
      const driveConfigured = Boolean(cfg.googleBoundEmail || cfg.googleEmail || cfg.googleLastSyncAt || cfg.googleLastLoadAt);
      if (CC.isGoogleSignedIn() && !cloudAccountMismatch) {
        if (!quiet) setStatus('☁️ Syncing Google Drive before Discogs...', true);
        const driveRes = await runGoogleSyncFlow({ interactive: false, quiet: true, publishInitialLocal: false });
        const driveIncomplete = Boolean(
          !driveRes ||
          !driveRes.ok ||
          driveRes.status === 'account_mismatch' ||
          driveRes.status === 'partial' ||
          (Array.isArray(driveRes.partialErrors) && driveRes.partialErrors.length > 0) ||
          driveRes.awaitingExplicitPublish
        );
        if (driveIncomplete) {
          if (!quiet) {
            setStatus('', false);
            toast(driveRes?.status === 'partial' || driveRes?.partialErrors?.length
              ? '⚠️ Google Drive pull was incomplete (some cloud files failed to load) — Discogs sync cancelled to protect photos and grades.'
              : '⚠️ Google Drive sync failed or needs attention — Discogs sync cancelled so photos and grades stay protected.', 5400);
          }
          return null;
        }
      } else if (driveConfigured) {
        if (!quiet) {
          setStatus('', false);
          toast('Sync Google Drive first so photos and grades load before checking Discogs.', 5200);
        }
        return null;
      }
    }

    const btns = [document.getElementById('btnSyncDiscogsIndex')].filter(Boolean);
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
        autoHydrateAttemptedIds.clear();
        renderStash();
        if (activeStashItem?.id) openStashDetail(activeStashItem.id, true);
        updateCloudUI();
        if (!suppressAutoSync) scheduleGoogleAutoSync();

        // Automatically hydrate tracklists, pressing notes & market values for any Discogs copies not yet hydrated
        const missingDetailCount = stashCache.filter(x => Number(x.discogs_id || 0) > 0 && !Number(x.discogs_details_synced_at || 0)).length;
        let enrichRes = null;
        if (missingDetailCount > 0 && cfg.discogsToken) {
          enrichRes = await CC.enrichSyncedDiscogsStashItems({
            quiet,
            onItemUpdated: async () => {
              await loadStashCache();
              renderStash();
              if (activeStashItem?.id) openStashDetail(activeStashItem.id, true);
            }
          });
          if (enrichRes?.updatedRows > 0) {
            await loadStashCache();
            renderStash();
            if (activeStashItem?.id) openStashDetail(activeStashItem.id, true);
            updateCloudUI();
            if (!suppressAutoSync) scheduleGoogleAutoSync();
          }
        }

        if (!quiet) {
          setStatus('', false);
          if (recRes.repairSummary) {
            const hydNote = enrichRes?.hydratedReleases ? ` · ${enrichRes.hydratedReleases} tracklist(s) loaded` : '';
            toast(`📀 ${recRes.repairSummary}${hydNote}`, 5200);
          } else {
            const parts = [];
            if (recRes.addedCount) parts.push(`+${recRes.addedCount} added`);
            if (recRes.movedCount) parts.push(`${recRes.movedCount} moved`);
            if (recRes.removedCount) parts.push(`${recRes.removedCount} removed`);
            if (recRes.ambiguousCount) parts.push(`⚠️ ${recRes.ambiguousCount} link check`);
            if (enrichRes?.hydratedReleases) parts.push(`🎵 ${enrichRes.hydratedReleases} hydrated`);
            const summary = parts.length ? parts.join(' · ') : 'all copies & folders up to date';
            toast(`📀 Discogs synced (${recRes.totalCopies} copies · ${recRes.folders.length} folders): ${summary}`, 4400);
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

  window.updateSettingsDirtyButtons = () => {
    const gKey = (document.getElementById('cfgGeminiKey')?.value || '').trim();
    const gModel = document.getElementById('cfgGeminiModel')?.value || 'gemini-3.5-flash-lite';
    const gAutoPlay = Boolean(document.getElementById('cfgAutoPlay')?.checked);
    const gAutoDet = Boolean(document.getElementById('cfgAutoDetective')?.checked);
    const geminiDirty =
      gKey !== String(cfg.geminiKey || '') ||
      gModel !== String(cfg.geminiModel || 'gemini-3.5-flash-lite') ||
      gAutoPlay !== (cfg.autoPlayHighlight !== false) ||
      gAutoDet !== (cfg.autoDetective !== false);
    const btnG = document.getElementById('btnSaveGemini');
    if (btnG) btnG.disabled = !geminiDirty;

    const dTok = (document.getElementById('cfgDiscogsToken')?.value || '').trim();
    const dFld = document.getElementById('cfgDiscogsFolder')?.value || '1';
    const dHome = document.getElementById('cfgHomeCountry')?.value ?? 'US';
    const dThresh = Number(document.getElementById('cfgThreshold')?.value) || 20;
    const dVg = Boolean(document.getElementById('cfgFetchVg')?.checked);
    const dVoice = Boolean(document.getElementById('cfgVoice')?.checked);
    const discogsDirty =
      dTok !== String(cfg.discogsToken || '') ||
      dFld !== String(cfg.discogsFolderId || '1') ||
      dHome !== String(cfg.homeCountry ?? 'US') ||
      dThresh !== Number(cfg.threshold ?? 20) ||
      dVg !== (cfg.fetchVgSuggestions !== false) ||
      dVoice !== Boolean(cfg.voice);
    const btnD = document.getElementById('btnSaveDiscogs');
    if (btnD) btnD.disabled = !discogsDirty;

    const tDna = (document.getElementById('cfgTasteDna')?.value || '').trim();
    const tSoft = (document.getElementById('cfgSoftSpots')?.value || '').trim();
    const tasteDirty =
      tDna !== String(spotifyProfile?.tasteDna || '').trim() ||
      tSoft !== String(spotifyProfile?.softSpots || '').trim();
    const btnT = document.getElementById('btnSaveTaste');
    if (btnT) btnT.disabled = !tasteDirty;
  };

  function setRebuildLockdown(locked) {
    const isLocked = Boolean(locked);
    const settingsView = document.getElementById('view-settings');
    if (settingsView) {
      settingsView.querySelectorAll('button, input, select, textarea').forEach(el => {
        if (el.id === 'btnCancelRebuild') {
          el.disabled = false;
          return;
        }
        el.disabled = isLocked;
      });
    }
    document.querySelectorAll('.bottom-nav .nav-btn').forEach(b => {
      const isOtherTab = b.dataset.view !== currentView;
      b.classList.toggle('nav-locked', isLocked && isOtherTab);
      if (isLocked && isOtherTab) b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
    });
    const recalBtn = document.getElementById('btnRecalibrateStash');
    if (recalBtn && isLocked) recalBtn.disabled = true;
  }

  window.updateRebuildWorkflowBtn = () => {
    const ids = ['rbStepDrivePre', 'rbStepSpotify', 'rbStepDraftTaste', 'rbStepDiscogs', 'rbStepRecalibrate', 'rbStepDrivePost'];
    const anyChecked = ids.some(id => Boolean(document.getElementById(id)?.checked));
    const runBtn = document.getElementById('btnRunRebuild');
    const cancelBtn = document.getElementById('btnCancelRebuild');
    if (runBtn) runBtn.disabled = rebuildWorkflowActive || !anyChecked;
    if (cancelBtn) {
      cancelBtn.classList.toggle('hidden', !rebuildWorkflowActive);
      cancelBtn.disabled = !rebuildWorkflowActive;
    }
  };

  window.cancelMaintenanceWorkflow = () => {
    if (!rebuildWorkflowActive) return;
    rebuildWorkflowCancelled = true;
    recalibratingStash = false;
    CC.cancelAI();
    CC.cancelSpotifySync();
    CC.cancelDiscogsEnrich();
    toast('Cancelling maintenance workflow...', 2000);
  };

  window.runMaintenanceWorkflow = async () => {
    if (rebuildWorkflowActive) return;
    const steps = [];
    if (document.getElementById('rbStepDrivePre')?.checked) steps.push({ key: 'drive_pre', label: 'Syncing with Google Drive first...' });
    if (document.getElementById('rbStepSpotify')?.checked) steps.push({ key: 'spotify', label: 'Syncing Spotify Library...' });
    if (document.getElementById('rbStepDraftTaste')?.checked) steps.push({ key: 'draft_taste', label: 'Auto-Drafting Taste Profile from Spotify...' });
    if (document.getElementById('rbStepDiscogs')?.checked) steps.push({ key: 'discogs', label: 'Syncing with Discogs...' });
    if (document.getElementById('rbStepRecalibrate')?.checked) steps.push({ key: 'recalibrate', label: 'Recalibrating Taste across Stash...' });
    if (document.getElementById('rbStepDrivePost')?.checked) steps.push({ key: 'drive_post', label: 'Pushing final updates to Google Drive...' });
    if (!steps.length) return;

    const spMode = document.getElementById('rbSpotifyMode')?.value === 'full' ? 'full' : 'liked';
    const recalScope = document.getElementById('rbRecalMode')?.value === 'all' ? 'all' : 'stale';

    rebuildWorkflowActive = true;
    rebuildWorkflowCancelled = false;
    clearTimeout(googleAutoSyncTimer);
    setRebuildLockdown(true);
    updateRebuildWorkflowBtn();

    const progWrap = document.getElementById('rebuildProgressWrap');
    const stepLbl = document.getElementById('rebuildStepLabel');
    const pctLbl = document.getElementById('rebuildPctLabel');
    const fillEl = document.getElementById('rebuildProgressFill');
    const setProg = (label, pct, tone = 'running', rightText = null) => {
      if (progWrap) {
        progWrap.classList.remove('hidden', 'is-ok', 'is-warn', 'is-err');
        if (tone === 'ok') progWrap.classList.add('is-ok');
        else if (tone === 'warn') progWrap.classList.add('is-warn');
        else if (tone === 'err') progWrap.classList.add('is-err');
      }
      if (stepLbl) stepLbl.textContent = label;
      const p = Math.max(0, Math.min(100, Math.round(pct)));
      if (pctLbl) pctLbl.textContent = rightText !== null ? rightText : `${p}%`;
      if (fillEl) {
        fillEl.style.width = `${p}%`;
        fillEl.classList.remove('is-ok', 'is-warn', 'is-err');
        if (tone === 'ok') fillEl.classList.add('is-ok');
        else if (tone === 'warn') fillEl.classList.add('is-warn');
        else if (tone === 'err') fillEl.classList.add('is-err');
      }
    };

    const stepResults = [];
    const summarizeCounts = () => {
      const completed = stepResults.filter(r => r.status === 'completed').length;
      const skipped = stepResults.filter(r => r.status === 'skipped').length;
      const failed = stepResults.filter(r => r.status === 'failed').length;
      const parts = [];
      if (completed > 0 || (skipped === 0 && failed === 0)) parts.push(`${completed} completed`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (failed > 0) parts.push(`${failed} failed`);
      return { completed, skipped, failed, text: parts.join(' · ') };
    };

    let stoppedEarly = false;

    try {
      for (let i = 0; i < steps.length; i++) {
        if (rebuildWorkflowCancelled) {
          stoppedEarly = true;
          const cnt = summarizeCounts();
          setProg(`Cancelled (${cnt.text})`, (cnt.completed / steps.length) * 100, 'warn', `${cnt.completed}/${steps.length}`);
          toast('Maintenance workflow cancelled');
          return;
        }
        const st = steps[i];
        setProg(`Step ${i + 1}/${steps.length}: ${st.label}`, (i / steps.length) * 100, 'running');

        let status = 'completed';

        if (st.key === 'drive_pre') {
          if (!CC.isGoogleSignedIn() || cloudAccountMismatch) {
            status = 'skipped';
          } else {
            const dRes = await runGoogleSyncFlow({ interactive: false, quiet: false, publishInitialLocal: false });
            if (!dRes || !dRes.ok || dRes.status === 'account_mismatch' || dRes.status === 'partial') {
              status = 'failed';
              stepResults.push({ key: st.key, status });
              stoppedEarly = true;
              const cnt = summarizeCounts();
              setProg(`Stopped at Step ${i + 1}/${steps.length}: Google Drive sync failed (${cnt.text})`, (cnt.completed / steps.length) * 100, 'err', `${cnt.completed}/${steps.length}`);
              toast('Workflow stopped — resolve Google Drive sync first', 4500);
              return;
            }
          }
        } else if (st.key === 'spotify') {
          if (!cfg.spotifyClientId) {
            status = 'skipped';
          } else {
            const remCd = CC.getSpotifyCooldownRemainingSec();
            if (remCd > 0) {
              status = 'skipped';
              stepResults.push({ key: st.key, status });
              stoppedEarly = true;
              const cnt = summarizeCounts();
              setProg(`Paused at Step ${i + 1}/${steps.length}: Spotify cooling down (${remCd}s) · ${cnt.text}`, (cnt.completed / steps.length) * 100, 'warn', `${cnt.completed}/${steps.length}`);
              ensureSpotifyCooldownTicker();
              toast(`⏸️ Workflow paused — Spotify cooldown (${remCd}s remaining). Resume once timer hits 0.`, 5200);
              return;
            }
            const canRunDirect = Boolean(
              (cfg.spotifyRefreshToken && await CC.refreshSpotifyToken()) ||
              (cfg.spotifyAccessToken && Date.now() < Number(cfg.spotifyExpiresAt || 0))
            );
            if (!canRunDirect) {
              status = 'skipped';
              stepResults.push({ key: st.key, status });
              stoppedEarly = true;
              const cnt = summarizeCounts();
              setProg(`Paused at Step ${i + 1}/${steps.length}: Reconnect Spotify in Section 4 · ${cnt.text}`, (cnt.completed / steps.length) * 100, 'warn', `${cnt.completed}/${steps.length}`);
              toast('Spotify login expired — reconnect in Section 4 and re-run workflow', 4800);
              return;
            }
            const prevDna = spotifyProfile?.tasteDna || document.getElementById('cfgTasteDna')?.value.trim() || '';
            const prevSoft = spotifyProfile?.softSpots || document.getElementById('cfgSoftSpots')?.value.trim() || '';
            const useResume = Boolean(hasActiveSpotifyCheckpoint() && spotifyCheckpoint.mode === spMode);
            const spRes = await CC.syncSpotifyResumable({
              mode: useResume ? 'resume' : spMode,
              resume: useResume,
              existingDna: prevDna,
              existingSoftSpots: prevSoft,
              autoCommitProfile: true
            });
            if (spRes?.completed && spRes.profile) {
              spotifyProfile = spRes.profile;
              spotifyCheckpoint = null;
              tasteCache.clear();
              updateSpotifyUI();
              status = 'completed';
            } else if (spRes?.paused) {
              spotifyCheckpoint = spRes.checkpoint ? CC.normalizeSpotifyCheckpoint(spRes.checkpoint) : await CC.getSpotifyCheckpoint();
              updateSpotifyUI();
              const waitSec = spRes.retryAfterSec || CC.getSpotifyCooldownRemainingSec() || 90;
              status = 'failed';
              stepResults.push({ key: st.key, status });
              stoppedEarly = true;
              const cnt = summarizeCounts();
              setProg(`Paused at Step ${i + 1}/${steps.length}: Spotify cooldown (${waitSec}s) · ${cnt.text}`, (cnt.completed / steps.length) * 100, 'warn', `${cnt.completed}/${steps.length}`);
              if (spRes.reason === 'rate_limit') ensureSpotifyCooldownTicker();
              toast(`⏸️ Workflow paused on Spotify rate limit (${waitSec}s). Progress saved — resume safely once timer completes.`, 5600);
              return;
            } else {
              status = 'failed';
            }
          }
        } else if (st.key === 'draft_taste') {
          if (!CC.isAiReady() || !(spotifyProfile?.totalArtists > 0)) {
            status = 'skipped';
          } else {
            const draftedOk = await analyzeFullSpotifyDNA({ suppressAutoSync: true });
            status = draftedOk ? 'completed' : 'failed';
          }
        } else if (st.key === 'discogs') {
          if (!cfg.discogsToken || !cfg.discogsUser) {
            status = 'skipped';
          } else {
            const dRec = await syncWithDiscogsUI(true, false, { skipDriveGate: true, suppressAutoSync: true });
            status = dRec ? 'completed' : 'failed';
          }
        } else if (st.key === 'recalibrate') {
          if (!CC.isAiReady() || !stashCache.length) {
            status = 'skipped';
          } else {
            const rRes = await recalibrateStashBatch({ skipConfirm: true, silentConfirm: true, scope: recalScope, suppressAutoSync: true });
            if (rRes?.cancelled) {
              rebuildWorkflowCancelled = true;
              status = 'failed';
            } else if (rRes?.skipped) {
              status = 'skipped';
            } else if (rRes?.error || Number(rRes?.failed || 0) > 0) {
              status = 'failed';
            } else {
              status = 'completed';
            }
          }
        } else if (st.key === 'drive_post') {
          if (!CC.isGoogleSignedIn() || cloudAccountMismatch) {
            status = 'skipped';
          } else {
            const pRes = await runGoogleSyncFlow({ interactive: false, quiet: false, publishInitialLocal: true });
            status = (pRes && pRes.ok && pRes.status !== 'partial' && pRes.status !== 'account_mismatch') ? 'completed' : 'failed';
          }
        }

        stepResults.push({ key: st.key, status });
        if (rebuildWorkflowCancelled) {
          stoppedEarly = true;
          const cnt = summarizeCounts();
          setProg(`Cancelled (${cnt.text})`, (cnt.completed / steps.length) * 100, 'warn', `${cnt.completed}/${steps.length}`);
          toast('Maintenance workflow cancelled');
          return;
        }
        setProg(`Step ${i + 1}/${steps.length} ${status}`, ((i + 1) / steps.length) * 100, status === 'failed' ? 'err' : (status === 'skipped' ? 'warn' : 'running'));
      }

      if (!stoppedEarly) {
        const cnt = summarizeCounts();
        const allClean = cnt.failed === 0 && cnt.skipped === 0 && cnt.completed === steps.length;
        const tone = cnt.failed > 0 ? 'err' : (cnt.skipped > 0 ? 'warn' : 'ok');
        const finalPct = allClean ? 100 : (cnt.completed / steps.length) * 100;
        const rightText = allClean ? '100%' : `${cnt.completed}/${steps.length}`;
        const finalMsg = allClean
          ? `✅ Done: ${cnt.completed} completed`
          : `Done: ${cnt.text}`;
        setProg(finalMsg, finalPct, tone, rightText);
        toast(allClean ? `✅ Rebuild complete (${cnt.completed}/${steps.length})` : `⚠️ Rebuild finished — ${cnt.text}`, 4600);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        const cnt = summarizeCounts();
        setProg(`Error: ${err?.message || 'Failed'} (${cnt.text})`, (cnt.completed / steps.length) * 100, 'err', `${cnt.completed}/${steps.length}`);
        toast('Workflow error: ' + (err?.message || 'Failed'), 4800);
      }
    } finally {
      rebuildWorkflowActive = false;
      rebuildWorkflowCancelled = false;
      setStatus('', false);
      setRebuildLockdown(false);
      updateRebuildWorkflowBtn();
      updateSettingsDirtyButtons();
      updateSpotifyUI();
      updateCloudUI();
      updateRecalibrateStashBtn();
    }
  };

  window.saveSettings = (silent = false, scope = 'all') => {
    const sc = scope || 'all';
    // Snapshot prior values of all synced preferences & secrets BEFORE mutating cfg so
    // clicking Sync or saving unchanged settings NEVER advances cfgUpdatedAt and overwrites newer cloud prefs!
    const prefKeys = CC.PREF_KEYS || [
      'geminiModel', 'autoPlayHighlight', 'autoDetective', 'autoGradeOnScan',
      'autoCropPhotos', 'photoQuality', 'homeCountry', 'fetchVgSuggestions',
      'threshold', 'voice', 'showSpotify', 'showApple', 'showDeezer', 'showYoutube'
    ];
    const secretKeys = CC.SECRET_KEYS || [
      'geminiKey', 'discogsToken', 'discogsUser', 'discogsFolderId',
      'discogsFolders', 'discogsFields', 'spotifyClientId'
    ];
    const prevVals = {};
    prefKeys.forEach(k => { prevVals[k] = JSON.stringify(cfg[k]); });
    secretKeys.forEach(k => { prevVals[k] = JSON.stringify(cfg[k]); });

    if (sc === 'all' || sc === 'cloud') {
      cfg.googleClientId = (document.getElementById('cfgGoogleClientId')?.value || '').trim();
      cfg.googleAutoSync = document.getElementById('cfgGoogleAutoSync')?.checked !== false;
      cfg.googleSyncSecrets = Boolean(document.getElementById('cfgGoogleSyncSecrets')?.checked);
    }
    if (sc === 'all' || sc === 'gemini') {
      cfg.geminiKey = document.getElementById('cfgGeminiKey').value.trim();
      cfg.geminiModel = document.getElementById('cfgGeminiModel').value;
      cfg.autoPlayHighlight = document.getElementById('cfgAutoPlay').checked;
      cfg.autoDetective = document.getElementById('cfgAutoDetective').checked;
      cfg.autoGradeOnScan = Boolean(document.getElementById('cfgAutoGradeOnScan')?.checked);
      const scanChk = document.getElementById('scanAutoGradeChk');
      if (scanChk) scanChk.checked = cfg.autoGradeOnScan;
      const acEl = document.getElementById('cfgAutoCropPhotos');
      if (acEl) cfg.autoCropPhotos = Boolean(acEl.checked);
      const pqEl = document.getElementById('cfgPhotoQuality');
      if (pqEl) cfg.photoQuality = pqEl.value || 'medium';
    }
    if (sc === 'all' || sc === 'discogs') {
      cfg.discogsToken = document.getElementById('cfgDiscogsToken').value.trim();
      cfg.discogsFolderId = document.getElementById('cfgDiscogsFolder').value || '1';
      cfg.homeCountry = document.getElementById('cfgHomeCountry').value;
      cfg.fetchVgSuggestions = document.getElementById('cfgFetchVg').checked;
      cfg.threshold = Number(document.getElementById('cfgThreshold').value) || 20;
      cfg.voice = document.getElementById('cfgVoice').checked;
    }
    if (sc === 'all' || sc === 'music') {
      cfg.spotifyClientId = document.getElementById('cfgSpotifyClientId').value.trim();
      cfg.showSpotify = document.getElementById('cfgShowSpotify').checked;
      cfg.showApple = document.getElementById('cfgShowApple').checked;
      cfg.showDeezer = document.getElementById('cfgShowDeezer').checked;
      cfg.showYoutube = document.getElementById('cfgShowYoutube').checked;
    }

    const prefsChanged = prefKeys.some(k => JSON.stringify(cfg[k]) !== prevVals[k]);
    const secretsChanged = Boolean(cfg.googleSyncSecrets) && secretKeys.some(k => JSON.stringify(cfg[k]) !== prevVals[k]);
    const syncedSettingChanged = prefsChanged || secretsChanged;

    CC.persistCfg(syncedSettingChanged);
    refreshNotice();
    updateStageUI();
    updateSettingsDirtyButtons();

    if (prefsChanged) {
      const outPrefs = { cfgUpdatedAt: Number(cfg.cfgUpdatedAt || Date.now()) };
      prefKeys.forEach(k => { outPrefs[k] = cfg[k]; });
      CC.commitLocalMutation({ extraOps: [{ type: 'prefs', prefs: outPrefs }], queueOutbox: true }).then(() => {
        updateCloudUI();
        scheduleGoogleAutoSync();
      }).catch(() => {});
    }
    if (!silent) {
      toast('Settings saved!');
    }
  };

  window.testAiConnection = async () => {
    saveSettings(true, 'gemini');
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
    saveSettings(true, 'discogs');
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
      toast(`✅ Connected as @${id.username} — tap Sync with Discogs when ready to pull your collection.`, 4200);
    } catch (err) { setStatus('', false); toast('Discogs verify failed: ' + err.message, 4000); }
  };

  function populateFolders() {
    const sel = document.getElementById('cfgDiscogsFolder');
    if (!sel) return;
    const folders = getDiscogsFoldersList();
    sel.innerHTML = `<option value="auto">✨ Auto-Match by Format</option>` +
      folders.map(f => `<option value="${f.id}">${esc(f.name)} (${f.count ?? 0})</option>`).join('');
    const desired = String(cfg.discogsFolderId || '1');
    sel.value = desired;
    if (sel.value !== desired) {
      sel.value = desired === 'auto' ? 'auto' : (sel.querySelector('option[value="1"]') ? '1' : (sel.options[0]?.value || 'auto'));
    }
    document.getElementById('discogsUserBadge').textContent = cfg.discogsUser ? `Connected: @${cfg.discogsUser}` : '';
    updateSettingsDirtyButtons();
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
    saveSettings(true, 'music');
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
    saveSettings(true, 'music');
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
    // Automatically repair any verified duplicate Discogs copies, purge legacy false conflicts & compact outbox on startup (zero Discogs/Drive writes!)
    const startupRepair = await CC.repairLocalDiscogsDuplicates().catch(() => null);
    await CC.purgeFalseConflicts().catch(() => null);
    await CC.coalesceCloudOutbox().catch(() => null);
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
    const acEl = document.getElementById('cfgAutoCropPhotos');
    if (acEl) acEl.checked = cfg.autoCropPhotos !== false;
    const pqEl = document.getElementById('cfgPhotoQuality');
    if (pqEl) pqEl.value = cfg.photoQuality || 'medium';
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
    updateSettingsDirtyButtons();
    updateRebuildWorkflowBtn();

    const stashSortSel = document.getElementById('stashSort');
    if (stashSortSel) stashSortSel.value = activeStashSort;

    // Quietly pull cloud updates on tab focus/visibility if signed in & stale > 2 min
    const maybeQuietCloudPull = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      if (!CC.isGoogleSignedIn() || cloudAccountMismatch || googleSyncInFlight) return;
      const now = Date.now();
      const lastCheck = Math.max(Number(cfg.googleLastLoadAt || 0), Number(cfg.googleLastSyncAt || 0), lastQuietFocusPullAt);
      if (now - lastCheck < 120000) return;
      lastQuietFocusPullAt = now;
      performSharedGooglePull({ quiet: true }).catch(() => {});
    };
    document.addEventListener('visibilitychange', maybeQuietCloudPull);
    window.addEventListener('focus', maybeQuietCloudPull);

    document.getElementById('camStage').addEventListener('click', (e) => tapCameraToFocus(e));

    document.querySelectorAll('#scanModeSeg .mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setScanMode(btn.dataset.mode));
    });

    document.querySelectorAll('#formatSeg .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#formatSeg .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFormat = btn.dataset.fmt;
        const otherWrap = document.getElementById('otherFormatWrap');
        if (otherWrap) otherWrap.classList.toggle('hidden', activeFormat !== 'Other');
        const eff = getEffectiveScanFormat();
        if (eff !== 'Auto' && eff !== 'Other') setSelectFormatValue('fFormat', eff);
      });
    });

    document.querySelectorAll('#stashFilters .chip').forEach(ch => {
      ch.addEventListener('click', () => {
        document.querySelectorAll('#stashFilters .chip').forEach(c => c.classList.remove('active'));
        ch.classList.add('active');
        activeStashFilter = ch.dataset.filter;
        const otherStashWrap = document.getElementById('stashOtherFormatWrap');
        if (otherStashWrap) otherStashWrap.classList.toggle('hidden', activeStashFilter !== 'other');
        if (activeStashFilter === 'localonly' || activeStashFilter === 'all') {
          activeDiscogsFolderFilter = null;
        }
        renderStash();
      });
    });

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
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
