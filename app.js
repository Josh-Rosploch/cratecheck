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

  let spotifyProfile = null;
  let tasteFeedback = [];
  let stashCache = [];
  let currentView = 'scan';
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
  let currentInspected = null;
  let activeStashItem = null;

  const tasteCache = new Map();
  let barcodeStream = null;
  let barcodeRaf = null;
  let activeClipKey = '';
  let scanRunId = 0;
  let clipReqId = 0;
  let activeRecognition = null;
  let pendingRetryFn = null;
  let pendingVoiceRetry = null; // { source, spoken, btnId }

  // ==================== UI HELPERS & RETRY BANNER ====================
  function toast(msg, ms = 2800) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function setStatus(text, show = true) {
    pendingRetryFn = null;
    const banner = document.getElementById('statusBanner');
    banner.style.borderColor = '';
    banner.innerHTML = `<div class="spinner"></div><div id="statusText">${esc(text)}</div>`;
    banner.classList.toggle('show', show);
    const st = document.getElementById('settingsStatusBanner');
    if (st) {
      document.getElementById('settingsStatusText').textContent = text;
      st.classList.toggle('show', show);
    }
  }

  function showRetryBanner(msg, retryFn) {
    pendingRetryFn = retryFn;
    const banner = document.getElementById('statusBanner');
    banner.style.borderColor = 'var(--yellow)';
    banner.innerHTML = `
      <div style="flex:1; font-size:0.85rem; color:#fde68a;">⚠️ ${esc(msg)}</div>
      <button type="button" class="btn btn-sm" style="flex:0 0 auto;" onclick="triggerPendingRetry()">🔄 Tap to Retry</button>
    `;
    banner.classList.add('show');
  }

  window.triggerPendingRetry = () => {
    if (typeof pendingRetryFn === 'function') {
      const fn = pendingRetryFn;
      pendingRetryFn = null;
      fn();
    }
  };

  function updateRatePill(count = CC.getRateCount()) {
    const pill = document.getElementById('ratePill');
    pill.textContent = `API ${count}/50`;
    pill.className = 'pill ' + (count >= 45 ? 'err' : count >= 35 ? 'warn' : 'ok');
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
    if (m) return m[1].split(' ')[0];
    return g;
  }

  function normalizeGrade(val, allowed, fallback) {
    if (!val) return fallback;
    const exact = allowed.find(g => g.toLowerCase() === String(val).trim().toLowerCase());
    if (exact) return exact;
    const n = norm(val);
    const fuzzy = allowed.find(g => norm(g).includes(n) || n.includes(norm(g)));
    return fuzzy || fallback;
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

  window.switchView = (name, fromPop = false) => {
    const viewChanged = name !== currentView;
    hideStashDetailUI();
    hideBarcodeUI();

    if (!fromPop) {
      try {
        if (history.state?.modal) {
          history.replaceState({ view: name, modal: null }, '');
        } else if (viewChanged) {
          history.pushState({ view: name, modal: null }, '');
        }
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
    if (st.modal !== 'barcode') hideBarcodeUI();

    if (st.modal === 'stashDetail' && st.itemId) {
      if (currentView !== 'stash') switchView('stash', true);
      openStashDetail(st.itemId, true);
    } else {
      hideStashDetailUI();
      switchView(st.view || 'scan', true);
    }
  });

  // ==================== 1-TAP AI VOICE RE-GRADE (WITH RETRY MEMORY) ====================
  const VOICE_BTN_IDLE = "🎤 Don't Agree? AI Voice Re-Grade";

  window.voiceRegrade = (source, btnId) => {
    if (!cfg.geminiKey) { toast('Add your Gemini API Key in Settings first'); return; }

    // If last voice re-grade failed on Gemini 503, tapping retries without re-speaking!
    if (pendingVoiceRetry && pendingVoiceRetry.source === source && pendingVoiceRetry.btnId === btnId) {
      const saved = pendingVoiceRetry;
      pendingVoiceRetry = null;
      regradeWithAI(saved.source, saved.spoken, saved.btnId);
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast('Voice mic not supported in this browser — use Chrome on Android!', 3800);
      return;
    }

    const btn = document.getElementById(btnId);
    if (activeRecognition) {
      try { activeRecognition.stop(); } catch (_) {}
      activeRecognition = null;
      return;
    }

    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    activeRecognition = rec;

    if (btn) { btn.classList.add('listening'); btn.textContent = '🔴 Listening... describe any flaws (tap to stop)'; }
    if (!audioEl.paused) audioEl.pause();

    let gotResult = false;
    rec.onresult = (e) => {
      const spoken = e.results?.[0]?.[0]?.transcript?.trim();
      if (spoken) {
        gotResult = true;
        regradeWithAI(source, spoken, btnId);
      }
    };
    rec.onerror = (e) => {
      if (e.error !== 'aborted') toast('Mic error: ' + e.error, 3200);
    };
    rec.onend = () => {
      activeRecognition = null;
      if (btn && !gotResult) {
        btn.classList.remove('listening');
        btn.textContent = VOICE_BTN_IDLE;
      }
    };
    try { rec.start(); } catch (_) { activeRecognition = null; }
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
    toast(`🎤 Heard: "${spokenDescription.slice(0, 65)}${spokenDescription.length > 65 ? '…' : ''}"`, 3000);

    const prompt = `You are a strict, conservative Discogs/Goldmine seller grading assistant.
The seller is NOT a professional grader, so they just described the item's flaws out loud in plain English.
Re-examine the attached photo(s) closely using what they just told you, TRUST their physical and playback observations completely, pick the exact conservative Discogs Media Condition and Sleeve Condition grades for them, and rewrite their observations into a clean, concise, buyer-ready Discogs condition report.

Item: "${item.artist} - ${item.title}" (${item.format || 'Cassette'})
Previous AI estimate: Media="${mediaEl?.value || ''}", Sleeve="${sleeveEl?.value || ''}"
Previous note: "${priorNote || 'None'}"
Seller's voice description: "${spokenDescription}"

STRICT DISCOGS GOLDMINE RULES:
- Media Condition MUST be one of: ${JSON.stringify(MEDIA_GRADES)}
  * "Mint (M)" ONLY if factory sealed in shrink wrap.
  * "Near Mint (NM or M-)" = spotless, zero visible flaws, plays flawlessly.
  * "Very Good Plus (VG+)" = very clean, only tiny handling scuffs, crisp flat label, plays cleanly.
  * "Very Good (VG)" = noticeable scratches/scuffs, light label wear/fading, or light background noise; structurally intact.
  * "Good Plus (G+)" = heavy scratches/scuffing on shell/disc, peeling/warped/bubbling/stained label, writing, or noticeable playback issues (e.g. slightly sluggish/warbly).
  * "Good (G)" / "Fair (F)" / "Poor (P)" = cracked/broken shell, missing felt pressure pad, mangled tape, heavy skips/sluggish playback, or torn/unreadable label.
- Sleeve Condition MUST be one of: ${JSON.stringify(SLEEVE_GRADES)}
  * Loose with no case/cover = "No Cover". Plain blank replacement = "Generic".
  * "Very Good Plus (VG+)" = clean insert, minor edge wear, light case scuffs, no cracks.
  * "Very Good (VG)" = creases, sticker residue, moderate case scratches, or a small crack.
  * "Good Plus (G+)" = paint/ink/water stains on insert, heavy creases, ripped flap, heavily scratched or cracked case.
  * "Good (G)" / "Fair (F)" / "Poor (P)" = severe stains obscuring artwork, torn/missing pieces, or heavy water/mold damage.
- CONSERVATIVE RULE: When between two grades, ALWAYS choose the LOWER grade so buyers are never disappointed. NEVER use the word "mint" unless factory sealed.

Return ONLY valid JSON:
{
  "media_condition": "exact Discogs media grade from list",
  "sleeve_condition": "exact Discogs sleeve grade from list",
  "polished_note": "clean, factual, buyer-ready Discogs listing note rewording all flaws the seller mentioned plus anything visible in photos (1-2 short sentences, no fluff)"
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
      const res = await CC.callGeminiJSON(parts, 'MEDIUM');
      pendingVoiceRetry = null;
      const newMedia = normalizeGrade(res.media_condition, MEDIA_GRADES, mediaEl.value);
      const newSleeve = normalizeGrade(res.sleeve_condition, SLEEVE_GRADES, sleeveEl.value);
      mediaEl.value = newMedia;
      sleeveEl.value = newSleeve;
      if (res.polished_note) notesEl.value = res.polished_note.trim();

      item.media_condition = newMedia;
      item.sleeve_condition = newSleeve;
      item.condition_note = notesEl.value.trim();

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
        btn.textContent = '🔄 Gemini Busy (3/3) — Tap to Retry Re-Grade';
      }
      toast(err.message, 4500);
    }
  }

  // ==================== FLOATING 30s AUDIO MINI-PLAYER ====================
  const audioEl = document.getElementById('previewAudio');

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
    try { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } catch (_) {}
    activeClipKey = '';
    document.getElementById('audioBar').classList.add('hidden');
    document.body.classList.remove('has-audio');
    document.getElementById('audioProgress').style.width = '0%';
    document.getElementById('audioPlayBtn').textContent = '▶';
  };

  window.toggleHighlightAudio = () => {
    if (!audioEl.src || audioEl.src === SILENT_WAV) return;
    audioEl.muted = false;
    if (audioEl.paused) audioEl.play().catch(() => toast('Tap ▶ again to start audio'));
    else audioEl.pause();
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
    const bar = document.getElementById('audioBar');
    const titleEl = document.getElementById('audioTitle');
    const linksEl = document.getElementById('audioExtLinks');
    const labelTarget = track || album;
    const isVar = !artist || /^various(\s+artists)?$/i.test(artist.trim());
    const searchQ = encodeURIComponent(`${isVar ? '' : artist} ${labelTarget}`.trim());

    bar.classList.remove('hidden');
    document.body.classList.add('has-audio');
    document.getElementById('audioPlayBtn').textContent = '…';
    document.getElementById('audioProgress').style.width = '0%';
    titleEl.textContent = `Finding 30s clip: ${labelTarget}...`;
    linksEl.innerHTML = `
      <a class="btn btn-secondary btn-sm" style="padding:5px 8px;" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${searchQ}">▶ YT</a>
      <a class="btn btn-secondary btn-sm" style="padding:5px 8px;" target="_blank" rel="noopener" href="https://open.spotify.com/search/${searchQ}">🎧</a>
    `;

    const clip = await CC.fetchAudioHighlight(artist, track, album, strictTrack);
    if ((!ignoreRunId && myRunId !== scanRunId) || myClipReq !== clipReqId) return;

    if (!clip) {
      activeClipKey = '';
      try { audioEl.pause(); audioEl.removeAttribute('src'); } catch (_) {}
      titleEl.textContent = `No 30s clip for "${labelTarget}" — tap ▶ YT`;
      document.getElementById('audioPlayBtn').textContent = '—';
      if (notifyUser) toast(`No 30s stream for "${labelTarget}" — try ▶ YT`, 3000);
      return;
    }

    activeClipKey = key;
    const fallbackNote = clip.exactVersion === false ? ' (closest stream)' : '';
    titleEl.textContent = `🎵 ${clip.trackName} — ${clip.artistName}${fallbackNote}`;
    audioEl.muted = false;
    audioEl.src = clip.previewUrl;
    audioEl.load();
    audioEl.currentTime = 0;

    if (forcePlay) {
      audioEl.play().catch(() => {
        document.getElementById('audioPlayBtn').textContent = '▶';
        titleEl.textContent = `Tap ▶ for 30s clip: ${clip.trackName}`;
      });
    } else {
      document.getElementById('audioPlayBtn').textContent = '▶';
    }
  }

  // ==================== PHOTO & UPC STAGING (2-PHOTO FLOW) ====================
  function compressImage(file, maxDim, mime, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL(mime, quality));
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  async function stagePhotoFile(file) {
    if (!file) return;
    if (stagedPhotos.length >= 4) { toast('Max 4 photos per scan'); return; }
    setStatus('Adding photo...', true);
    try {
      const apiUrl = await compressImage(file, 1536, 'image/jpeg', 0.82);
      const thumbWebp = await compressImage(file, 600, 'image/webp', 0.6);
      stagedPhotos.push({ apiB64: apiUrl.split(',')[1], thumbWebp });
      updateStageUI();
      setStatus('', false);
      toast(stagedPhotos.length === 1 ? 'Front/Side A staged — flip for Back/Side B or tap Search' : `Photo ${stagedPhotos.length} staged — ready to Search!`);
    } catch (err) {
      setStatus('', false);
      toast('Photo error: ' + err.message);
    }
  }

  window.removeStagedPhoto = (idx) => { stagedPhotos.splice(idx, 1); updateStageUI(); };
  window.clearStagedUpc = () => { stagedUpc = ''; document.getElementById('fBarcode').value = ''; updateStageUI(); };

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

    const lbl = document.getElementById('btnAddPhotoLabel');
    if (stagedPhotos.length === 0) lbl.textContent = 'Front / Side A';
    else if (stagedPhotos.length === 1) lbl.textContent = 'Back / Side B';
    else lbl.textContent = `+ Photo (${stagedPhotos.length}/4)`;

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
      <div class="preview-item">
        <img src="${p.thumbWebp}" />
        <span class="preview-tag">${tags[i] || `Photo ${i+1}`}</span>
        <button class="preview-remove" onclick="removeStagedPhoto(${i})" title="Remove">×</button>
      </div>
    `).join('');
  };

  window.toggleManualEntry = () => {
    document.getElementById('extractCard').classList.remove('hidden');
    document.getElementById('extractDetails').open = true;
    if (activeFormat !== 'Auto') document.getElementById('fFormat').value = activeFormat;
    document.getElementById('fCatno').focus();
  };

  // ==================== LIVE UPC SCANNER ====================
  window.openBarcodeScanner = async () => {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      toast('Live UPC scanner not supported here — snap a photo of the barcode instead!', 3500);
      document.getElementById('camStage').click();
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
          if (codes?.[0]?.rawValue) {
            const code = codes[0].rawValue.replace(/\D/g, '');
            if (code.length >= 8) {
              closeBarcodeScanner();
              playChime();
              stagedUpc = code;
              document.getElementById('fBarcode').value = code;
              updateStageUI();
              toast(`║▌ UPC staged: ${code} — add photos or tap Search`);
              return;
            }
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

  // ==================== SINGLE-BUTTON SEARCH & ANALYZE ====================
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
    setStatus(`Inspecting ${stagedPhotos.length} photo(s) closely & strictly grading...`, true);
    const fmtHint = activeFormat === 'Auto' ? 'Auto-detect Cassette, CD, or Vinyl' : `User selected format: ${activeFormat}`;
    const upcHint = stagedUpc ? `User also scanned UPC barcode: ${stagedUpc}.` : '';
    const prompt = `You are a physical music media OCR, Discogs pressing-ID, and strict Goldmine/Discogs visual grading expert. Inspect ALL attached photos carefully (often Photo 1 = Front/Side A, Photo 2 = Back/Side B). ${fmtHint}. ${upcHint}

OCR NOTE: Ignore non-catalog manufacturing/tax/standard codes (such as Dolby, HX Pro, TSE, TS-2240, KTB, JASRAC, GEMA, BIEM) when extracting "raw_catalog_number".

STRICT DISCOGS SELLER GRADING RULES (Be brutally honest and conservative — never over-grade!):
1. FIRST scan every square inch of the photo(s) for flaws and list every single one in "media_defects" and "sleeve_defects": scratches, scuffs, peeling/bubbling/warped/stained labels, faded ink, yellowing, cracks, paint/ink/water stains, creases, rips, stickers, missing felt pressure pad, or dirty/cloudy plastic.
2. Media Condition MUST be one of: ${JSON.stringify(MEDIA_GRADES)}
   * "Mint (M)": ONLY if factory sealed in unopened shrink wrap.
   * "Near Mint (NM or M-)": Spotless, looks brand new, ZERO visible scratches, scuffs, or label wear.
   * "Very Good Plus (VG+)": Very clean; only tiny barely-visible handling scuffs; label/print crisp and flat.
   * "Very Good (VG)": Clear surface scuffs/scratches, light label wear, minor fading, or small sticker — structurally intact.
   * "Good Plus (G+)": Heavy scratching/scuffing on shell/disc, OR peeling/warped/bubbling/stained label, OR writing/heavy yellowing.
   * "Good (G)" / "Fair (F)" / "Poor (P)": Cracked/broken shell, missing/loose felt pressure pad, torn/unreadable label, or damaged tape/deep gouges.
3. Sleeve Condition MUST be one of: ${JSON.stringify(SLEEVE_GRADES)}
   * Loose item with no case/cover shown = "No Cover". Plain blank replacement = "Generic".
   * "Very Good Plus (VG+)": Clean insert with minimal edge wear; light case scuffs, no cracks.
   * "Very Good (VG)": Noticeable creases, edge/corner wear, sticker residue, moderate case scratches, or a small case crack.
   * "Good Plus (G+)": Paint/ink/liquid stains on insert, heavy creasing, ripped flap, heavily scratched/cracked case, or water warping.
   * "Good (G)" / "Fair (F)" / "Poor (P)": Severe paint/stains obscuring artwork, torn/missing pieces, or heavy water/mold damage.
4. CONSERVATIVE RULE: When between two grades, ALWAYS pick the LOWER grade. NEVER use the word "mint" in "condition_note" unless factory sealed. Summarize the exact visible defects in "condition_note".

Return ONLY valid JSON (list defects BEFORE grades):
{
  "detected_format": "Cassette" | "CD" | "Vinyl",
  "raw_catalog_number": "exact record-label catalog code printed on shell/spine/disc, or empty string",
  "cleaned_catalog_variants": ["catalog variations stripping hyphens/spaces/price prefixes"],
  "barcode": "digits only UPC/EAN if visible, else empty string",
  "album_title": "album or release title",
  "artists": ["main artist name(s), or 'Various' if a multi-artist compilation"],
  "label": "record label name or empty string",
  "year": "4-digit copyright/release year printed, else empty string",
  "country_clues": "country printed (e.g. 'Printed in U.S.A.') or 'Not visible'",
  "club_edition": "None" | "CRC" | "BMG" | "Unknown",
  "physical_details": "plain-English description of visible physical features (plastic shell color, paper label vs direct print, numbers in tape window, cover color, club stamps)",
  "media_defects": ["list every visible flaw on cassette shell/label/disc, or empty array if spotless"],
  "sleeve_defects": ["list every visible flaw on case/insert (paint, stains, cracks, scratches, creases), or empty array if spotless"],
  "media_condition": "exact Discogs media grade from list above",
  "sleeve_condition": "exact Discogs sleeve grade from list above",
  "condition_note": "blunt, factual seller note listing the actual flaws found above (NEVER say 'mint' unless factory sealed)",
  "visible_tracks": ["any song titles visible in the photos"]
}`;

    const parts = [{ text: prompt }, ...stagedPhotos.map(p => ({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }))];

    try {
      const ext = await CC.callGeminiJSON(parts, 'MEDIUM');
      if (myRunId !== scanRunId) return false;
      currentExtracted = ext;
      if (activeFormat !== 'Auto') ext.detected_format = activeFormat;

      document.getElementById('fTitle').value = ext.album_title || '';
      document.getElementById('fArtist').value = Array.isArray(ext.artists) ? ext.artists.join(', ') : (ext.artists || '');
      document.getElementById('fCatno').value = ext.raw_catalog_number || '';
      const finalBarcode = stagedUpc || (ext.barcode || '').replace(/\D/g, '');
      document.getElementById('fBarcode').value = finalBarcode;
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
      if (err.isRetryable) {
        showRetryBanner(err.message, () => runFullScan());
      } else {
        setStatus('', false);
        toast('Gemini error: ' + err.message, 4500);
      }
      return false;
    }
  }

  // ==================== SMART DISCOGS SEARCH ====================
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
    const format = document.getElementById('fFormat').value;
    const label = document.getElementById('fLabel').value.trim();

    if (!title && !artist && !catno && !barcode) { toast('Add a photo, UPC, or title first'); return; }

    document.getElementById('inspectorCard').classList.add('hidden');
    document.getElementById('detectiveCard').classList.add('hidden');
    document.getElementById('candidatesCard').classList.add('hidden');
    detectiveDiffs = {};
    detectivePickId = null;
    detectiveEliminatedIds = new Set();
    visibleCandidateIds = null;
    setStatus('Searching Discogs...', true);

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
      const catMatch = rawCat && itemCat && (itemCat === rawCat || itemCat.includes(rawCat) || rawCat.includes(itemCat));
      const fmtList = (Array.isArray(it.format) ? it.format : [it.format || '']).join(' ').toLowerCase();
      const isClub = fmtList.includes('club');
      const have = it.community?.have || 0;

      let score = sim * 0.58 + (catMatch ? 0.22 : 0);
      if (it._tier === 'barcode') score += 0.14;
      if (prefCountry && it.country) {
        if (norm(it.country) === norm(prefCountry)) score += (photoCountry ? 0.18 : 0.09);
        else if (photoCountry) score -= 0.12;
      }
      if (clubDetected === 'None' && isClub) score -= 0.12;
      if ((clubDetected === 'CRC' || clubDetected === 'BMG') && isClub) score += 0.15;
      score += Math.min(0.08, Math.log10(have + 1) * 0.035);
      return { sim, catMatch, isClub, score };
    };

    try {
      if (barcode) {
        const bp = { type: 'release', barcode, per_page: 10 };
        if (activeFormat !== 'Auto') bp.format = format;
        add(await CC.discogsFetch('/database/search', bp), 'barcode');
        if (pool.size === 0 && bp.format) add(await CC.discogsFetch('/database/search', { type: 'release', barcode, per_page: 10 }), 'barcode');
      }
      if (catno && pool.size < 3) {
        add(await CC.discogsFetch('/database/search', { type: 'release', catno, format, per_page: 10 }), 'catno');
      }

      let bestSim = 0;
      pool.forEach(it => { bestSim = Math.max(bestSim, scoreItem(it).sim); });

      const variants = (currentExtracted?.cleaned_catalog_variants || []).filter(v => v && norm(v) !== norm(catno)).slice(0, 2);
      if ((pool.size === 0 || bestSim < 0.45) && variants.length) {
        for (const v of variants) add(await CC.discogsFetch('/database/search', { type: 'release', catno: v, format, label, per_page: 8 }), 'variant');
        pool.forEach(it => { bestSim = Math.max(bestSim, scoreItem(it).sim); });
      }

      if ((pool.size === 0 || bestSim < 0.45) && (title || artist)) {
        const q = `${artist} ${title}`.trim();
        add(await CC.discogsFetch('/database/search', { type: 'release', q, format, per_page: 10 }), 'text');
        if (pool.size === 0) add(await CC.discogsFetch('/database/search', { type: 'release', q, per_page: 8 }), 'broad');
      }

      if (myRunId !== scanRunId) return;

      const ranked = Array.from(pool.values()).map(it => ({ ...it, _check: scoreItem(it) }))
        .sort((a, b) => b._check.score - a._check.score).slice(0, 6);

      currentCandidates = ranked;
      renderCandidates(false);

      if (ranked.length === 0) {
        setStatus('', false);
        document.getElementById('extractCard').classList.remove('hidden');
        document.getElementById('extractDetails').open = true;
        toast('No Discogs matches — tweak details or tap "Not on Discogs?"', 3800);
      } else if (ranked.length === 1) {
        await inspectCandidate(0, myRunId);
      } else if (cfg.autoDetective && cfg.geminiKey) {
        await runVariantDetective(null, myRunId);
      } else {
        setStatus('', false);
        renderCandidates(true);
      }
    } catch (err) {
      setStatus('', false);
      toast('Discogs search failed: ' + err.message, 4000);
    }
  };

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
    document.getElementById('btnManualDetective').classList.toggle('hidden', currentCandidates.length < 2);

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
            <div class="candidate-sub">${esc(it.year || '?')} · ${esc(lblText)} · <strong>${esc(it.catno || 'No Cat#')}</strong> · <strong>${esc(it.country || '?')}</strong></div>
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

  // ==================== PLAIN-ENGLISH AI VARIANT DETECTIVE ====================
  window.runVariantDetective = async (subsetIds = null, myRunId = scanRunId) => {
    if (!cfg.geminiKey || currentCandidates.length < 2) return;
    const pool = subsetIds
      ? currentCandidates.filter(c => subsetIds.includes(c.id))
      : currentCandidates.slice(0, 4);

    if (pool.length < 2) {
      if (pool.length === 1) await inspectCandidate(currentCandidates.indexOf(pool[0]), myRunId);
      return;
    }

    setStatus(`🕵️ Checking pressing differences (${pool.length} variants)...`, true);

    try {
      const dossiers = [];
      for (let i = 0; i < pool.length; i++) {
        const rel = await CC.getReleaseCached(pool[i].id);
        if (myRunId !== scanRunId) return;
        dossiers.push({
          id: rel.id,
          year: rel.year || '?',
          country: rel.country || '?',
          catno: rel.labels?.[0]?.catno || pool[i].catno || '',
          formats: (rel.formats || []).map(f => [f.name, ...(f.descriptions || []), f.text || ''].filter(Boolean).join(', ')).join(' | '),
          notes: (rel.notes || '').slice(0, 420),
          identifiers: (rel.identifiers || []).slice(0, 8).map(x => `${x.type}${x.description ? ` (${x.description})` : ''}: ${x.value}`).join('; ').slice(0, 320),
          have: rel.community?.have || 0,
          want: rel.community?.want || 0
        });
      }

      const prompt = `You are a fast, plain-English Discogs Variant Matcher helping someone catalog cassettes/CDs/vinyl quickly.
Compare the user's photo(s) against these ${dossiers.length} Discogs listings.

CRITICAL RULES:
1. User's home country is "${cfg.homeCountry || 'US'}". Rule out obvious foreign pressings when the photo shows US text/address or has no foreign language.
2. DO NOT ask a question over trivial factory micro-differences (screws, mold stamps, tiny spacing) on common pressings — pick the most popular matching one ("have" count) and set status="confident".
3. ONLY set status="needs_question" when 2+ variants have an EASY-TO-SPOT physical difference that matters (e.g. solid white vs clear see-through plastic cassette; "CRC"/"BMG" club stamp vs retail; different country; rare vs common pressing) AND you can't already see it in the photo(s).
4. ZERO COLLECTOR JARGON! Never say "J-card", "inlay", "matrix", "runout", "IFPI", "shell mold", or "timing window". Use everyday words like "the plastic cassette", "the paper cover", "the little numbers inside the clear tape window", "the letters CRC or BMG".

Scanned info: ${JSON.stringify({
  title: document.getElementById('fTitle').value,
  artist: document.getElementById('fArtist').value,
  catno: document.getElementById('fCatno').value,
  barcode: document.getElementById('fBarcode').value,
  country_clues: currentExtracted?.country_clues || 'Not visible',
  club_edition: currentExtracted?.club_edition || 'Unknown',
  physical_details: currentExtracted?.physical_details || 'No photo'
})}

Discogs Variants:
${JSON.stringify(dossiers, null, 2)}

Return ONLY valid JSON:
{
  "status": "confident" | "needs_question",
  "best_release_id": number,
  "eliminated_ids": [numbers ruled out],
  "reasoning": "1 short plain-English sentence explaining which pressing matches and why.",
  "candidate_diffs": [{ "id": number, "short_diff": "plain-English 6-10 word summary" }],
  "question": null or {
    "prompt": "One super simple, jargon-free question",
    "how_to_check": "Plain 1-sentence tip telling them where to glance",
    "options": [{ "label": "Simple everyday description", "matching_ids": [number] }]
  }
}`;

      const parts = [{ text: prompt }, ...stagedPhotos.map(p => ({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }))];
      const verdict = await CC.callGeminiJSON(parts);
      if (myRunId !== scanRunId) return;

      (verdict.candidate_diffs || []).forEach(d => { if (d.id && d.short_diff) detectiveDiffs[d.id] = d.short_diff; });
      detectiveEliminatedIds = new Set(verdict.eliminated_ids || []);
      detectivePickId = verdict.best_release_id || pool[0].id;

      renderDetectiveCard(verdict, pool);
      renderCandidates(false);

      const pickIdx = currentCandidates.findIndex(c => c.id === detectivePickId);
      if (verdict.status === 'confident' && pickIdx !== -1) {
        await inspectCandidate(pickIdx, myRunId);
      } else {
        setStatus('', false);
        document.getElementById('detectiveCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch (_) {
      setStatus('', false);
      await inspectCandidate(0, myRunId);
    }
  };

  function renderDetectiveCard(verdict, pool) {
    const card = document.getElementById('detectiveCard');
    card.classList.remove('hidden');

    const isConf = verdict.status === 'confident';
    document.getElementById('detectiveBadge').innerHTML = `<span class="badge ${isConf ? 'badge-green' : 'badge-yellow'}" style="margin:0;">${isConf ? '✅ Auto-Matched' : '❓ Quick Check'}</span>`;
    document.getElementById('detectiveReasoning').textContent = verdict.reasoning || '';

    const qBox = document.getElementById('detectiveQuestionBox');
    document.getElementById('btnToggleManualPick').classList.toggle('hidden', isConf);

    if (!isConf && verdict.question?.options?.length) {
      qBox.classList.remove('hidden');
      const mostCommon = [...pool].sort((a, b) => (b.community?.have || 0) - (a.community?.have || 0))[0];
      window._detectiveOptions = [
        ...verdict.question.options,
        { label: `🤷 Not sure — just pick the most common one (${mostCommon.country || '?'}, ${mostCommon.year || '?'})`, matching_ids: [mostCommon.id], isFallback: true }
      ];
      qBox.innerHTML = `
        <div style="font-weight:800; font-size:0.92rem;">${esc(verdict.question.prompt)}</div>
        ${verdict.question.how_to_check ? `<div class="detective-hint">👀 ${esc(verdict.question.how_to_check)}</div>` : ''}
        <div>
          ${window._detectiveOptions.map((opt, i) => `
            <button class="opt-btn ${opt.isFallback ? 'fallback-opt' : ''}" onclick="answerDetective(${i})">${esc(opt.label)}</button>
          `).join('')}
        </div>
      `;
    } else {
      qBox.classList.add('hidden');
      qBox.innerHTML = '';
    }
  }

  window.answerDetective = async (optIdx) => {
    const opt = (window._detectiveOptions || [])[optIdx];
    if (!opt) return;
    unlockAudioForAutoplay(false);
    const ids = (opt.matching_ids || []).filter(id => currentCandidates.some(c => c.id === id));

    if (ids.length === 1) {
      detectivePickId = ids[0];
      document.getElementById('detectiveQuestionBox').classList.add('hidden');
      document.getElementById('detectiveBadge').innerHTML = `<span class="badge badge-green" style="margin:0;">✅ Locked In</span>`;
      document.getElementById('detectiveReasoning').textContent = `Selected: ${opt.label}`;
      await inspectCandidate(currentCandidates.findIndex(c => c.id === ids[0]), scanRunId);
    } else if (ids.length > 1) {
      await runVariantDetective(ids, scanRunId);
    } else renderCandidates(true);
  };

  // ==================== INSPECTOR + TASTE + GRADING ====================
  function cleanDiscogsArtist(arr) {
    return (arr || []).map(a => a.name.replace(/\s*\(\d+\)$/, '')).join(', ');
  }

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
    setStatus('Loading price, tracklist & taste check...', true);

    try {
      const release = await CC.getReleaseCached(cand.id);
      if (myRunId !== scanRunId) return;
      const stats = await CC.discogsFetch(`/marketplace/stats/${cand.id}`).catch(() => ({}));

      let suggestions = null;
      if (cfg.fetchVgSuggestions) {
        try { suggestions = await CC.discogsFetch(`/marketplace/price_suggestions/${cand.id}`); }
        catch (err) {
          if (err.status === 403 || err.status === 404) {
            cfg.fetchVgSuggestions = false;
            document.getElementById('cfgFetchVg').checked = false;
            CC.persistCfg();
          }
        }
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
      if (release.identifiers?.length) notesParts.push('\nIdentifiers:\n' + release.identifiers.map(x => `• ${x.type}: ${x.value}`).join('\n'));

      const prevAlbumKey = currentInspected ? `${norm(currentInspected.artist)}|${norm(currentInspected.title)}` : '';
      const nextAlbumKey = `${norm(artistName)}|${norm(albumTitle)}`;
      if (prevAlbumKey && prevAlbumKey !== nextAlbumKey) stopHighlightAudio();

      const aiMedia = normalizeGrade(currentExtracted?.media_condition, MEDIA_GRADES, 'Very Good Plus (VG+)');
      const aiSleeve = normalizeGrade(currentExtracted?.sleeve_condition, SLEEVE_GRADES, 'Very Good Plus (VG+)');

      currentInspected = {
        discogs_id: release.id, title: albumTitle, artist: artistName, catno, format,
        year: release.year || cand.year || '', label, country: release.country || cand.country || '',
        genres: [...(release.genres || []), ...(release.styles || [])],
        media_condition: aiMedia,
        sleeve_condition: aiSleeve,
        condition_note: currentExtracted?.condition_note || '',
        lowest_price: lowestPrice, vg_plus_price: vgPlusPrice, est_price: estPrice,
        num_for_sale: numForSale, have, want, is_high_value: isHighValue, is_scarce: isScarce,
        tracklist, pressing_notes: notesParts.join('\n').trim(),
        discogs_url: release.uri || `https://www.discogs.com/release/${release.id}`,
        discogs_thumb: release.thumb || cand.thumb || '',
        taste_score: null, taste_verdict: null, taste_summary: '', notable_songs: [],
        litmus_track: '', litmus_artist: '',
        culturally_significant: false, cultural_label: '', cultural_reason: '',
        spotify_matches: { artistHit: false, matchedArtists: [], matchedTracks: [] }
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

    currentInspected = {
      discogs_id: null, title, artist,
      catno: document.getElementById('fCatno').value.trim(),
      format: document.getElementById('fFormat').value,
      year: document.getElementById('fYear').value.trim(),
      label: document.getElementById('fLabel').value.trim(),
      country: '', genres: [],
      media_condition: normalizeGrade(currentExtracted?.media_condition, MEDIA_GRADES, 'Very Good Plus (VG+)'),
      sleeve_condition: normalizeGrade(currentExtracted?.sleeve_condition, SLEEVE_GRADES, 'Very Good Plus (VG+)'),
      condition_note: currentExtracted?.condition_note || '',
      lowest_price: null, vg_plus_price: null, est_price: null, num_for_sale: null,
      have: 0, want: 0, is_high_value: false, is_scarce: false, tracklist: tracks, pressing_notes: '',
      discogs_url: '', discogs_thumb: '', taste_score: null, taste_verdict: null,
      taste_summary: '', notable_songs: [], litmus_track: '', litmus_artist: '',
      culturally_significant: false, cultural_label: '', cultural_reason: '',
      spotify_matches: { artistHit: false, matchedArtists: [], matchedTracks: [] }
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
    const dup = stashCache.find(s => (item.discogs_id && s.discogs_id === item.discogs_id) || (norm(s.artist) === norm(item.artist) && norm(s.title) === norm(item.title)));
    if (dup) alerts += `<div class="alert-box alert-dup">⚠️ Already in your Local Stash (${new Date(dup.created_at).toLocaleDateString()}).</div>`;
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
    if (item.pressing_notes) document.getElementById('inspNotes').textContent = item.pressing_notes;

    document.getElementById('gMediaCond').innerHTML = gradeOptionsHtml(MEDIA_GRADES, item.media_condition);
    document.getElementById('gSleeveCond').innerHTML = gradeOptionsHtml(SLEEVE_GRADES, item.sleeve_condition);
    document.getElementById('gNotes').value = item.condition_note || '';
    document.getElementById('aiGradeHint').textContent = stagedPhotos.length ? `AI Graded (${stagedPhotos.length} photo${stagedPhotos.length > 1 ? 's' : ''})` : 'Manual Grade';

    const vBtn = document.getElementById('btnVoiceRegradeScan');
    if (vBtn) { vBtn.disabled = false; vBtn.textContent = VOICE_BTN_IDLE; }

    const btnWrong = document.getElementById('btnWrongPressing');
    if (currentCandidates.length > 1) {
      btnWrong.classList.remove('hidden');
      btnWrong.textContent = `Wrong pressing? View all ${currentCandidates.length} Discogs matches ▾`;
    } else btnWrong.classList.add('hidden');

    const saveBtn = document.getElementById('btnSaveBoth');
    saveBtn.disabled = !hasDiscogs || !cfg.discogsToken || !cfg.discogsUser;
    saveBtn.textContent = !hasDiscogs ? 'Not on Discogs (Use Save Local Only below)'
      : (!cfg.discogsUser ? 'Verify Discogs in Settings to Enable Save' : '✅ Confirm & Add to Discogs + Local Stash');

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
    if (!spotifyProfile) badges += `<span class="badge badge-yellow">Spotify not synced yet</span>`;
    document.getElementById('tasteLocalBadges').innerHTML = badges;
    document.getElementById('tasteScore').textContent = '...';
    document.getElementById('tasteBody').textContent = 'Checking your Spotify taste, cultural significance & notable songs...';
    document.getElementById('tasteHits').innerHTML = '';
    const cBox = document.getElementById('culturalBox');
    cBox.classList.add('hidden'); cBox.innerHTML = '';
    document.getElementById('tasteVoteRow').classList.add('hidden');
  }

  // ==================== PREVIEW HANDLERS (SCAN + STASH) ====================
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

  // ==================== SPOTIFY LOCAL MATCH + TASTE & CULTURAL AI ====================
  function checkLocalSpotify(item) {
    if (!spotifyProfile) return { artistHit: false, matchedArtists: [], matchedTracks: [] };
    const matchedArtistsSet = new Set();
    const checkStr = (str) => {
      if (!str || /^various(\s+artists)?$/i.test(str.trim())) return;
      String(str).split(/,|&|\band\b|feat\.?/i).forEach(part => {
        const n = norm(part);
        if (n && spotifyProfile.allArtists?.[n]) matchedArtistsSet.add(spotifyProfile.allArtists[n].name || part.trim());
      });
    };
    checkStr(item.artist);
    (item.tracklist || []).forEach(t => { if (t.artist) checkStr(t.artist); });

    const trackSet = new Set(spotifyProfile.trackTitles || []);
    const matchedTracks = (item.tracklist || [])
      .filter(t => norm(t.title).length > 2 && trackSet.has(norm(t.title)))
      .map(t => t.artist ? `${t.artist} - ${t.title}` : t.title);

    const matchedArtists = Array.from(matchedArtistsSet);
    return { artistHit: matchedArtists.length > 0, matchedArtists, matchedTracks };
  }

  function renderVoteState(item, upId = 'btnVoteUp', downId = 'btnVoteDown') {
    const upEl = document.getElementById(upId), dnEl = document.getElementById(downId);
    if (!upEl || !dnEl) return;
    const existing = tasteFeedback.find(f => norm(f.artist) === norm(item.artist) && norm(f.title) === norm(item.title));
    upEl.className = 'vote-btn' + (existing?.liked === true ? ' active-up' : '');
    dnEl.className = 'vote-btn' + (existing?.liked === false ? ' active-down' : '');
  }

  window.submitTasteVote = async (liked, forStash = false) => {
    const target = forStash ? activeStashItem : currentInspected;
    if (!target) return;
    const keyA = norm(target.artist), keyT = norm(target.title);
    tasteFeedback = tasteFeedback.filter(f => !(norm(f.artist) === keyA && norm(f.title) === keyT));
    tasteFeedback.unshift({
      artist: target.artist, title: target.title, track: target.litmus_track || '',
      genres: (target.genres || []).slice(0, 4), liked, at: Date.now()
    });
    if (tasteFeedback.length > 200) tasteFeedback = tasteFeedback.slice(0, 200);
    await CC.idbPut('meta', { key: 'taste_feedback', value: tasteFeedback });
    tasteCache.clear();
    renderVoteState(target, forStash ? 'sdVoteUp' : 'btnVoteUp', forStash ? 'sdVoteDown' : 'btnVoteDown');
    updateFeedbackUI();
    toast(liked ? '👍 Noted! Future scans will favor this vibe.' : '👎 Noted! Future scans will score this style lower.');
  };

  window.clearTasteFeedback = async () => {
    if (!confirm('Clear all your 👍 / 👎 taste ratings?')) return;
    tasteFeedback = [];
    await CC.idbPut('meta', { key: 'taste_feedback', value: [] });
    tasteCache.clear();
    updateFeedbackUI();
    toast('Taste ratings cleared');
  };

  function updateFeedbackUI() {
    const up = tasteFeedback.filter(f => f.liked).length;
    const dn = tasteFeedback.filter(f => !f.liked).length;
    document.getElementById('feedbackSummary').textContent = tasteFeedback.length
      ? `Learned from your scans: 👍 ${up} liked · 👎 ${dn} passed`
      : 'No 👍/👎 scan ratings yet — rate songs after scanning to sharpen recommendations.';
  }

  function verdictBadgeClass(verdict) {
    if (verdict === 'KEEP') return 'badge-green';
    if (verdict === 'KEEP (ICONIC)') return 'badge-gold';
    if (verdict === 'LISTEN') return 'badge-blue';
    return 'badge-red';
  }

  function applyTasteUI(item, res, myRunId) {
    item.taste_score = res.score;
    item.taste_verdict = res.verdict;
    item.taste_summary = res.summary;
    item.notable_songs = normalizeNotableList(res.notable_songs, item.artist);
    item.litmus_track = res.litmus_track || item.tracklist?.[0]?.title || '';
    item.litmus_artist = res.litmus_artist || '';
    item.culturally_significant = Boolean(res.culturally_significant);
    item.cultural_label = res.cultural_label || '';
    item.cultural_reason = res.cultural_reason || '';

    const star = item.culturally_significant ? `<span class="score-star" title="Culturally Significant">*</span>` : '';
    document.getElementById('tasteScore').innerHTML = `${esc(res.score)}/10${star} <span class="badge ${verdictBadgeClass(res.verdict)}" style="vertical-align:middle;">${esc(res.verdict)}</span>`;
    document.getElementById('tasteBody').textContent = res.summary || '';

    const cBox = document.getElementById('culturalBox');
    if (item.culturally_significant && item.cultural_reason) {
      cBox.classList.remove('hidden');
      cBox.innerHTML = `<strong>🏛️ Culturally Significant${item.cultural_label ? ` · ${esc(item.cultural_label)}` : ''} (*):</strong> ${esc(item.cultural_reason)}`;
    } else {
      cBox.classList.add('hidden');
      cBox.innerHTML = '';
    }

    document.getElementById('tasteHits').innerHTML = buildNotableHitsHtml(item, 'scan');
    document.getElementById('tasteVoteRow').classList.remove('hidden');
    renderVoteState(item);

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
    document.getElementById('tasteBody').textContent = 'Retrying Taste & Cultural Check...';
    runTasteAnalysis(currentInspected, scanRunId);
  };

  async function runTasteAnalysis(item, myRunId) {
    if (!cfg.geminiKey) {
      document.getElementById('tasteScore').textContent = '—';
      document.getElementById('tasteBody').textContent = 'Add Gemini API Key to enable Taste & Cultural Check.';
      return;
    }

    const cacheKey = `${norm(item.artist)}|${norm(item.title)}|v153`;
    if (tasteCache.has(cacheKey)) { applyTasteUI(item, tasteCache.get(cacheKey), myRunId); return; }

    const topArtists = (spotifyProfile?.topArtists || []).slice(0, 60).join(', ');
    const tracksStr = (item.tracklist || []).slice(0, 32).map(t => t.artist ? `${t.artist} - ${t.title}` : t.title).join('; ');
    const recentUp = tasteFeedback.filter(f => f.liked).slice(0, 20).map(f => `${f.artist} - ${f.title}`).join('; ');
    const recentDn = tasteFeedback.filter(f => !f.liked).slice(0, 20).map(f => `${f.artist} - ${f.title}`).join('; ');

    const prompt = `Evaluate this physical music release on TWO separate axes for a collector:
Axis 1 — Personal Taste (1-10): How well does this match their Spotify taste & past 👍/👎 ratings?
Axis 2 — Cultural Significance (true/false): Even if it scores low for their personal genres (e.g., 3/10), is this culturally significant media worth keeping because it contains a massive pop-culture staple, stadium/wedding/gym-class anthem, meme classic, or iconic Top 40 hit almost everyone instantly recognizes (e.g. "Cotton Eye Joe", "Pump Up The Jam", "Kokomo", "Manic Monday", Michael Jackson's Thriller, iconic movie soundtracks)?

Release: "${item.artist} - ${item.title}" (${item.year || '?'}, ${item.format}, Genres: ${(item.genres || []).join(', ') || 'unknown'}).
Tracklist: ${tracksStr || 'Unknown'}.
Spotify Matches: Artists in library=${item.spotify_matches.matchedArtists.join(', ') || 'None'}, Exact tracks=${item.spotify_matches.matchedTracks.join(', ') || 'None'}.
Top Spotify Artists: ${topArtists || 'Not synced'}.
Recent 👍 Liked Scans: ${recentUp || 'None'}.
Recent 👎 Disliked Scans: ${recentDn || 'None'}.

Verdict rules:
- "KEEP" if score >= 7.
- "KEEP (ICONIC)" if score < 7 BUT culturally_significant is true.
- "LISTEN" if score is 5-6 and not iconic.
- "SELL / SKIP" if score <= 4 and NOT culturally_significant.

Return ONLY valid JSON:
{
  "score": 1 to 10 integer (strictly personal Spotify taste match),
  "verdict": "KEEP" | "KEEP (ICONIC)" | "LISTEN" | "SELL / SKIP",
  "culturally_significant": boolean,
  "cultural_label": "short 2-4 word tag if true (e.g. '90s Dance Anthem', 'Pop Culture Staple', 'Iconic Hit Comp'), else empty string",
  "cultural_reason": "if culturally_significant is true, 1-2 punchy sentences explaining WHY this is culturally famous and naming the exact ubiquitous songs you'd immediately recognize. Else empty string.",
  "litmus_track": "exact song title from Tracklist above (WITHOUT artist prefix) of the single best/most famous track to auto-preview",
  "litmus_artist": "performing artist of litmus_track",
  "summary": "1-2 punchy sentences speaking directly to 'you' about how this fits your personal Spotify taste.",
  "notable_songs": [
    { "artist": "performing artist", "title": "exact song title from Tracklist", "reason": "short 6-12 word reason it's famous/recognizable" }
  ]
}
Include ALL genuinely famous/recognizable songs on the release in notable_songs (up to 6 for hit compilations/greatest hits, or empty array if none).`;

    try {
      const res = await CC.callGeminiJSON([{ text: prompt }]);
      setStatus('', false);
      tasteCache.set(cacheKey, res);
      if (myRunId !== scanRunId || currentInspected !== item) return;
      applyTasteUI(item, res, myRunId);
    } catch (err) {
      setStatus('', false);
      if (myRunId !== scanRunId || currentInspected !== item) return;
      document.getElementById('tasteScore').textContent = '⚠️';
      document.getElementById('tasteBody').innerHTML = `
        <div style="margin-bottom:8px; color:#fde68a;">${esc(err.message)}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="retryCurrentTaste()">🔄 Tap to Retry Taste Check</button>
      `;
    }
  }

  // ==================== SAVE TO DISCOGS (WITH GRADES & NOTES) + STASH ====================
  window.saveCurrentItem = async (syncToDiscogs) => {
    if (!currentInspected) return;

    const mediaCond = document.getElementById('gMediaCond').value || 'Very Good Plus (VG+)';
    const sleeveCond = document.getElementById('gSleeveCond').value || 'Very Good Plus (VG+)';
    const condNote = document.getElementById('gNotes').value.trim();

    currentInspected.media_condition = mediaCond;
    currentInspected.sleeve_condition = sleeveCond;
    currentInspected.condition_note = condNote;

    let synced = false;
    let instanceId = null;
    let fieldsSynced = 0;

    if (syncToDiscogs) {
      if (!cfg.discogsToken || !cfg.discogsUser || !currentInspected.discogs_id) { toast('Verify Discogs in Settings first'); return; }
      const folderId = cfg.discogsFolderId || '1';
      setStatus('Adding release & grades to your Discogs collection...', true);
      try {
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
      } catch (err) {
        setStatus('', false);
        toast('Discogs save failed: ' + err.message, 4500);
        return;
      }
    }

    const thumbs = stagedPhotos.slice(0, 2).map(p => p.thumbWebp);
    const record = {
      ...currentInspected,
      synced_to_discogs: synced,
      discogs_folder_id: synced ? (cfg.discogsFolderId || '1') : null,
      discogs_instance_id: instanceId,
      thumbs,
      thumb_data_url: thumbs[0] || currentInspected.discogs_thumb || '',
      created_at: Date.now()
    };

    try {
      await CC.idbPut('stash', record);
      await loadStashCache();
      setStatus('', false);
      toast(synced ? `✅ Saved to Discogs${fieldsSynced ? ' (with grades!)' : ''} & Stash!` : '💾 Saved to Local Stash!');
      resetScanner();
    } catch (err) { setStatus('', false); toast('Local save failed: ' + err.message); }
  };

  window.resetScanner = () => {
    scanRunId++;
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
    currentInspected = null;

    document.getElementById('camStage').value = '';
    document.getElementById('detectiveCard').classList.add('hidden');
    document.getElementById('extractCard').classList.add('hidden');
    document.getElementById('candidatesCard').classList.add('hidden');
    document.getElementById('inspectorCard').classList.add('hidden');
    document.getElementById('detectedCluesLine').textContent = '';
    ['fTitle', 'fArtist', 'fCatno', 'fBarcode', 'fLabel', 'fYear', 'gNotes'].forEach(id => {
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
  }

  window.renderStash = () => {
    const q = norm(document.getElementById('stashSearch').value);
    const filtered = stashCache.filter(it => {
      if (['Cassette', 'CD', 'Vinyl'].includes(activeStashFilter) && it.format !== activeStashFilter) return false;
      if (activeStashFilter === 'highvalue' && !it.is_high_value && !it.is_scarce) return false;
      if (activeStashFilter === 'keep' && (it.taste_score || 0) < 7) return false;
      if (activeStashFilter === 'iconic' && !it.culturally_significant) return false;
      if (activeStashFilter === 'localonly' && it.synced_to_discogs) return false;
      if (!q) return true;
      return norm(`${it.artist} ${it.title} ${it.catno} ${it.label} ${it.condition_note} ${it.cultural_label || ''} ${(it.tracklist || []).map(t => `${t.artist || ''} ${t.title}`).join(' ')}`).includes(q);
    });

    const totalVal = filtered.reduce((s, it) => s + (Number(it.est_price) || 0), 0);
    document.getElementById('stashStats').textContent = `${filtered.length} items · ~$${totalVal.toFixed(0)}`;

    const list = document.getElementById('stashList');
    if (!filtered.length) { list.innerHTML = `<div class="card"><p>No matching items yet.</p></div>`; return; }

    list.innerHTML = filtered.map(it => {
      const pBadge = it.est_price != null ? `<span class="badge ${it.is_high_value ? 'badge-yellow' : 'badge-blue'}">$${Number(it.est_price).toFixed(2)}</span>` : '';
      const sBadge = it.is_scarce ? `<span class="badge badge-purple">💎 Scarce</span>` : '';
      const star = it.culturally_significant ? '*' : '';
      const tBadge = it.taste_score ? `<span class="badge ${it.taste_score >= 7 ? 'badge-green' : 'badge-blue'}">🎧 ${it.taste_score}/10${star}</span>` : '';
      const iBadge = it.culturally_significant ? `<span class="badge badge-gold">🏛️ ${esc(it.cultural_label || 'Iconic')}</span>` : '';
      const gTxt = it.media_condition ? `${shortGrade(it.media_condition)}/${shortGrade(it.sleeve_condition || '')}` : '';
      const gBadge = gTxt ? `<span class="badge" style="background:#0d1017; color:var(--muted);">${esc(gTxt)}</span>` : '';
      const syncB = it.synced_to_discogs ? `<span class="badge badge-green">Discogs</span>` : `<span class="badge badge-yellow">Local</span>`;

      return `
        <div class="stash-item" onclick="openStashDetail(${it.id})">
          <img class="stash-thumb" src="${esc(it.thumb_data_url || '')}" onerror="this.style.visibility='hidden'" />
          <div class="stash-body">
            <div class="candidate-title">${esc(it.artist)} — ${esc(it.title)}</div>
            <div class="candidate-sub">${esc(it.format)} · ${esc(it.country || '?')} · ${esc(it.year || '?')} · ${esc(it.catno || 'No Cat#')}</div>
            <div>${pBadge}${sBadge}${tBadge}${iBadge}${gBadge}${syncB}</div>
          </div>
          <span class="stash-chev">›</span>
        </div>
      `;
    }).join('');
  };

  window.openStashDetail = (id, fromPop = false) => {
    const it = stashCache.find(x => x.id === id);
    if (!it) return;
    activeStashItem = it;
    pendingVoiceRetry = null;

    if (!fromPop) {
      try {
        if (history.state?.modal === 'stashDetail') {
          history.replaceState({ view: 'stash', modal: 'stashDetail', itemId: id }, '');
        } else {
          history.pushState({ view: 'stash', modal: 'stashDetail', itemId: id }, '');
        }
      } catch (_) {}
    }

    document.getElementById('sdHeaderTitle').textContent = `${it.artist} — ${it.title}`;
    const photos = (Array.isArray(it.thumbs) && it.thumbs.length) ? it.thumbs : (it.thumb_data_url ? [it.thumb_data_url] : []);
    const localMatch = checkLocalSpotify(it);
    const hasDiscogs = Boolean(it.discogs_id);
    const star = it.culturally_significant ? `<span class="score-star">*</span>` : '';

    const ebayQ = encodeURIComponent(`${it.artist} ${it.title} ${it.format} ${it.catno}`.trim());
    let links = `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.ebay.com/sch/i.html?_nkw=${ebayQ}&LH_Sold=1&LH_Complete=1">💸 eBay Sold</a>`;
    if (hasDiscogs) {
      links = `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${esc(it.discogs_url)}">💿 Discogs</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/history/${it.discogs_id}">📈 Sales History</a>` +
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/post/${it.discogs_id}">🏷️ Sell on Discogs</a>` + links;
    }

    let alerts = '';
    if (it.is_high_value) alerts += `<div class="alert-box alert-high-value">🔥 HIGH VALUE ($${Number(it.est_price).toFixed(2)}) — SET ASIDE!</div>`;
    if (it.is_scarce) alerts += `<div class="alert-box alert-scarce">💎 SCARCE (0 for sale, ${it.want} want / ${it.have} have) — CHECK SOLD!</div>`;

    let localBadges = '';
    if (localMatch.artistHit) localBadges += `<span class="badge badge-green">🎸 Artist in Your Spotify</span>`;
    if (localMatch.matchedTracks.length) localBadges += `<span class="badge badge-green">🎵 ${localMatch.matchedTracks.length} Track(s) in Your Library</span>`;

    const body = document.getElementById('sdBody');
    body.innerHTML = `
      ${photos.length ? `<div class="detail-photos">${photos.map(src => `<img src="${esc(src)}" />`).join('')}</div>` : ''}

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
          <strong style="font-size:0.92rem;">🎧 Taste &amp; Cultural Check</strong>
          <span class="taste-score">${it.taste_score ? `${esc(it.taste_score)}/10${star}` : '—'} ${it.taste_verdict ? `<span class="badge ${verdictBadgeClass(it.taste_verdict)}" style="vertical-align:middle;">${esc(it.taste_verdict)}</span>` : ''}</span>
        </div>
        <div style="margin-bottom:6px;">${localBadges}</div>
        <div style="font-size:0.87rem; color:#e2e8f0;">${esc(it.taste_summary || 'No taste summary saved.')}</div>
        ${(it.culturally_significant && it.cultural_reason) ? `<div class="cultural-box"><strong>🏛️ Culturally Significant${it.cultural_label ? ` · ${esc(it.cultural_label)}` : ''} (*):</strong> ${esc(it.cultural_reason)}</div>` : ''}
        <div style="margin-top:10px; font-size:0.84rem; color:#cbd5e1;">${buildNotableHitsHtml(it, 'stash')}</div>
        <div class="vote-row">
          <span style="font-size:0.78rem; color:var(--muted); font-weight:600;">Like this vibe?</span>
          <div class="inline-actions" style="gap:6px;">
            <button id="sdVoteUp" class="vote-btn" onclick="submitTasteVote(true, true)">👍 Liked It</button>
            <button id="sdVoteDown" class="vote-btn" onclick="submitTasteVote(false, true)">👎 Not for Me</button>
          </div>
        </div>
      </div>

      <div class="section-block">
        <div class="section-heading">🎵 Tracklist (${(it.tracklist || []).length})</div>
        <div class="tracklist-open">${buildTracklistHtml(it.tracklist || [], localMatch.matchedTracks, 'stash')}</div>
      </div>

      ${it.pressing_notes ? `
        <div class="section-block">
          <div class="section-heading">🔎 Pressing Notes &amp; Identifiers</div>
          <div class="notes-box">${esc(it.pressing_notes)}</div>
        </div>
      ` : ''}

      <div class="grade-box">
        <strong style="display:block; font-size:0.92rem; margin-bottom:8px;">🏷️ Discogs Grading &amp; Notes</strong>
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
        <button id="btnVoiceRegradeStash" type="button" class="btn btn-purple dictate-btn" style="width:100%; min-height:42px; font-size:0.86rem; margin-bottom:8px;" onclick="voiceRegrade('stash', 'btnVoiceRegradeStash')">
          ${VOICE_BTN_IDLE}
        </button>
        <div style="margin-bottom:10px;">
          <label class="field-label">Condition / Listing Report</label>
          <textarea id="sdNotes" rows="2">${esc(it.condition_note || '')}</textarea>
        </div>
        <div class="inline-actions">
          <button class="btn btn-sm" onclick="saveStashEdits(${it.id})">💾 Save Grade &amp; Notes</button>
          ${(!it.synced_to_discogs && it.discogs_id) ? `<button class="btn btn-green btn-sm" onclick="pushStashToDiscogs(${it.id})">✅ Push to Discogs</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="deleteStashItem(${it.id})">🗑️ Delete</button>
        </div>
      </div>
    `;

    renderVoteState(it, 'sdVoteUp', 'sdVoteDown');
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

    await CC.idbPut('stash', it);
    await loadStashCache();
    renderStash();

    if (it.synced_to_discogs && it.discogs_id && it.discogs_instance_id && cfg.discogsUser) {
      const fId = it.discogs_folder_id || cfg.discogsFolderId || '1';
      await CC.syncDiscogsInstanceFields(fId, it.discogs_id, it.discogs_instance_id, it.media_condition, it.sleeve_condition, it.condition_note);
      toast('✅ Updated Stash & Discogs grades!');
    } else {
      toast('💾 Grade & notes saved!');
    }
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
      if (activeStashItem?.id === id) openStashDetail(id);
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
    const cols = ['artist', 'title', 'format', 'country', 'catno', 'label', 'year', 'media_condition', 'sleeve_condition', 'condition_note', 'est_price', 'lowest_price', 'num_for_sale', 'have', 'want', 'is_high_value', 'is_scarce', 'taste_score', 'taste_verdict', 'culturally_significant', 'cultural_label', 'synced_to_discogs', 'discogs_url'];
    const c = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    dl([cols.join(','), ...stashCache.map(it => cols.map(k => c(it[k])).join(','))].join('\n'), `cratecheck-stash-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  window.exportJSON = () => {
    dl(JSON.stringify({ version: 5, exportedAt: new Date().toISOString(), stash: stashCache, spotifyProfile, tasteFeedback }), `cratecheck-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    toast('JSON backup downloaded');
  };

  window.importJSON = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (Array.isArray(data.stash)) {
        for (const item of data.stash) { const copy = { ...item }; delete copy.id; await CC.idbPut('stash', copy); }
      }
      if (data.spotifyProfile) { spotifyProfile = data.spotifyProfile; await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile }); updateSpotifyUI(); }
      if (Array.isArray(data.tasteFeedback)) { tasteFeedback = data.tasteFeedback; await CC.idbPut('meta', { key: 'taste_feedback', value: tasteFeedback }); updateFeedbackUI(); }
      await loadStashCache(); renderStash();
      toast('Backup restored!');
    } catch (e) { toast('Invalid JSON: ' + e.message); }
  };

  // ==================== SETTINGS & SPOTIFY WIRING ====================
  function refreshNotice() {
    document.getElementById('setupNotice').classList.toggle('hidden', Boolean(cfg.geminiKey && cfg.discogsToken));
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
      await CC.callGeminiJSON([{ text: 'Return ONLY valid JSON: {"ok": true}' }]);
      badge.style.color = 'var(--green)'; badge.textContent = `✅ Connected (${cfg.geminiModel})`;
      setStatus('', false);
      toast('✅ Gemini key verified!');
    } catch (err) {
      setStatus('', false);
      badge.style.color = 'var(--red)'; badge.textContent = '❌ Error';
      toast('Gemini test failed: ' + err.message, 5000);
    }
  };

  window.verifyDiscogsAccount = async () => {
    saveSettings(true);
    if (!cfg.discogsToken) { toast('Paste your Discogs Token first'); return; }
    setStatus('Verifying Discogs, folders & custom grading fields...', true);
    try {
      const id = await CC.discogsFetch('/oauth/identity');
      cfg.discogsUser = id.username;
      const fRes = await CC.discogsFetch(`/users/${encodeURIComponent(id.username)}/collection/folders`);
      cfg.discogsFolders = (fRes.folders || []).filter(f => f.id !== 0);
      if (!cfg.discogsFolders.length) cfg.discogsFolders = [{ id: 1, name: 'Uncategorized' }];

      const fieldsRes = await CC.discogsFetch(`/users/${encodeURIComponent(id.username)}/collection/fields`).catch(() => null);
      if (fieldsRes?.fields?.length) {
        const findId = (rx, def) => (fieldsRes.fields.find(x => rx.test(x.name || ''))?.id) || def;
        cfg.discogsFields = {
          media: findId(/media/i, 1),
          sleeve: findId(/sleeve/i, 2),
          notes: findId(/note/i, 3)
        };
      }

      populateFolders(); CC.persistCfg();
      setStatus('', false);
      toast(`✅ Connected as @${id.username} (folders & grading synced)`);
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
    try {
      spotifyProfile = await CC.syncSpotifyAll();
      await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
      tasteCache.clear();
      updateSpotifyUI();
      setStatus('', false);
      toast(`🎧 Synced ${spotifyProfile.totalTracks} tracks & ${spotifyProfile.totalArtists} artists!`, 4000);
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

    const artistCounts = Object.assign({}, spotifyProfile?.allArtists || {});
    const trackSet = new Set(spotifyProfile?.trackTitles || []);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][tIdx]) trackSet.add(norm(rows[i][tIdx]));
      if (rows[i][aIdx]) rows[i][aIdx].split(/;|,/).forEach(name => {
        const clean = name.trim(), n = norm(clean);
        if (!n) return;
        if (!artistCounts[n]) artistCounts[n] = { name: clean, count: 0 };
        artistCounts[n].count += 1;
      });
    }
    const topArtists = Object.values(artistCounts).sort((a, b) => b.count - a.count).slice(0, 120).map(x => x.name);
    spotifyProfile = { syncedAt: Date.now(), userDisplayName: spotifyProfile?.userDisplayName || 'Exportify CSV', topArtists, allArtists: artistCounts, trackTitles: Array.from(trackSet), totalTracks: trackSet.size, totalArtists: Object.keys(artistCounts).length, totalPlaylists: spotifyProfile?.totalPlaylists || 0 };
    await CC.idbPut('meta', { key: 'spotify_profile', value: spotifyProfile });
    tasteCache.clear(); updateSpotifyUI();
    toast(`Merged! Total: ${spotifyProfile.totalTracks} tracks.`);
  };

  function updateSpotifyUI() {
    const pill = document.getElementById('spotifyPill');
    const sum = document.getElementById('spotifySummary');
    if (spotifyProfile) {
      pill.textContent = `Spotify: ${spotifyProfile.totalArtists} art`;
      pill.className = 'pill ok';
      const pl = spotifyProfile.totalPlaylists ? ` · ${spotifyProfile.totalPlaylists} playlists` : '';
      sum.textContent = `✅ Synced (${spotifyProfile.userDisplayName}): ${spotifyProfile.totalTracks} tracks · ${spotifyProfile.totalArtists} artists${pl}`;
    } else {
      pill.textContent = 'Spotify: Off'; pill.className = 'pill'; sum.textContent = 'Not synced yet.';
    }
  }

  window.copyRedirectUri = async () => {
    try { await navigator.clipboard.writeText(CC.REDIRECT_URI); toast('Redirect URI copied!'); }
    catch (_) { prompt('Copy Redirect URI:', CC.REDIRECT_URI); }
  };

  // ==================== INIT ====================
  async function init() {
    CC.setStatusCallback(setStatus);
    CC.setRateCallback(updateRatePill);
    await CC.openDB();
    await loadStashCache();

    const spRec = await CC.idbGet('meta', 'spotify_profile');
    if (spRec?.value) spotifyProfile = spRec.value;
    const fbRec = await CC.idbGet('meta', 'taste_feedback');
    if (Array.isArray(fbRec?.value)) tasteFeedback = fbRec.value;

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
    document.getElementById('redirectUriText').textContent = CC.REDIRECT_URI;
    document.getElementById('guideRedirectUri').textContent = CC.REDIRECT_URI;

    document.getElementById('gMediaCond').innerHTML = gradeOptionsHtml(MEDIA_GRADES, 'Very Good Plus (VG+)');
    document.getElementById('gSleeveCond').innerHTML = gradeOptionsHtml(SLEEVE_GRADES, 'Very Good Plus (VG+)');

    populateFolders();
    updateSpotifyUI();
    updateFeedbackUI();
    refreshNotice();
    updateStageUI();

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

    document.getElementById('camStage').addEventListener('change', (e) => {
      stagePhotoFile(e.target.files[0]);
      e.target.value = '';
    });

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