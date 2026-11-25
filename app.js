(() => {
  'use strict';
  const CC = window.CC;
  const { cfg, esc, norm, similarity } = CC;

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
  let activeFormat = 'Auto';
  let activeStashFilter = 'all';

  let stagedPhotos = []; // [{ apiB64, thumbWebp }]
  let stagedUpc = '';
  let currentExtracted = null;
  let currentCandidates = [];
  let visibleCandidateIds = null;
  let detectiveDiffs = {};
  let detectivePickId = null;
  let detectiveEliminatedIds = new Set();
  let currentInspected = null;

  const tasteCache = new Map();
  let barcodeStream = null;
  let barcodeRaf = null;
  let activeClipKey = '';
  let scanRunId = 0;

  // ==================== UI HELPERS ====================
  function toast(msg, ms = 2800) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function setStatus(text, show = true) {
    document.getElementById('statusText').textContent = text;
    document.getElementById('statusBanner').classList.toggle('show', show);
    const st = document.getElementById('settingsStatusBanner');
    if (st) {
      document.getElementById('settingsStatusText').textContent = text;
      st.classList.toggle('show', show);
    }
  }

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

  window.switchView = (name) => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    document.getElementById('view-' + name).classList.add('active');
    if (name === 'stash') renderStash();
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  // ==================== 30s AUDIO HIGHLIGHT PLAYER ====================
  const audioEl = document.getElementById('previewAudio');

  function unlockAudioForAutoplay() {
    if (!cfg.autoPlayHighlight) return;
    try {
      audioEl.pause();
      audioEl.src = SILENT_WAV;
      const p = audioEl.play();
      if (p && p.then) p.then(() => { audioEl.pause(); audioEl.currentTime = 0; }).catch(() => {});
    } catch (_) {}
  }

  function stopHighlightAudio() {
    try { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } catch (_) {}
    activeClipKey = '';
    document.getElementById('audioBar').classList.add('hidden');
    document.getElementById('audioProgress').style.width = '0%';
    document.getElementById('audioPlayBtn').textContent = '▶';
  }

  window.toggleHighlightAudio = () => {
    if (!audioEl.src || audioEl.src === SILENT_WAV) return;
    if (audioEl.paused) {
      audioEl.play().catch(() => toast('Tap play again to start audio'));
    } else {
      audioEl.pause();
    }
  };

  audioEl.addEventListener('play', () => { document.getElementById('audioPlayBtn').textContent = '⏸'; });
  audioEl.addEventListener('pause', () => { document.getElementById('audioPlayBtn').textContent = '▶'; });
  audioEl.addEventListener('ended', () => {
    document.getElementById('audioPlayBtn').textContent = '▶';
    document.getElementById('audioProgress').style.width = '0%';
  });
  audioEl.addEventListener('timeupdate', () => {
    if (audioEl.duration && isFinite(audioEl.duration)) {
      document.getElementById('audioProgress').style.width = `${Math.min(100, (audioEl.currentTime / audioEl.duration) * 100)}%`;
    }
  });

  async function loadHighlightClip(artist, track, album, myRunId, forceReplace = false) {
    if (!artist && !track && !album) return;
    const key = norm(`${artist}|${track || album}`);
    if (!forceReplace && activeClipKey && !audioEl.paused) return;
    if (key === activeClipKey && audioEl.src && audioEl.src !== SILENT_WAV) return;

    const bar = document.getElementById('audioBar');
    const titleEl = document.getElementById('audioTitle');
    const linksEl = document.getElementById('audioExtLinks');
    const ytQ = encodeURIComponent(`${artist} ${track || album}`.trim());
    const spQ = encodeURIComponent(`${artist} ${track || album}`.trim());

    bar.classList.remove('hidden');
    titleEl.textContent = `Finding 30s highlight: ${track || album}...`;
    linksEl.innerHTML = `
      <a class="btn btn-secondary btn-sm" style="padding:5px 8px;" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${ytQ}">▶ YT</a>
      <a class="btn btn-secondary btn-sm" style="padding:5px 8px;" target="_blank" rel="noopener" href="https://open.spotify.com/search/${spQ}">🎧</a>
    `;

    const clip = await CC.fetchAudioHighlight(artist, track, album);
    if (myRunId !== scanRunId) return;

    if (!clip) {
      titleEl.textContent = `No 30s stream found for "${track || album}" — try ▶ YT`;
      document.getElementById('audioPlayBtn').textContent = '—';
      return;
    }

    activeClipKey = key;
    titleEl.textContent = `🎵 ${clip.trackName} — ${clip.artistName}`;
    audioEl.src = clip.previewUrl;
    audioEl.currentTime = 0;

    if (cfg.autoPlayHighlight) {
      audioEl.play().catch(() => {
        document.getElementById('audioPlayBtn').textContent = '▶';
        titleEl.textContent = `Tap ▶ for 30s clip: ${clip.trackName}`;
      });
    } else {
      document.getElementById('audioPlayBtn').textContent = '▶';
    }
  }

  // ==================== PHOTO & UPC STAGING (ZERO API CALLS UNTIL SEARCH) ====================
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
      toast(`Photo ${stagedPhotos.length} staged — add more or tap Search`);
    } catch (err) {
      setStatus('', false);
      toast('Photo error: ' + err.message);
    }
  }

  window.removeStagedPhoto = (idx) => {
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

    const strip = document.getElementById('previewStrip');
    strip.innerHTML = stagedPhotos.map((p, i) => `
      <div class="preview-item">
        <img src="${p.thumbWebp}" />
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

  // ==================== LIVE UPC SCANNER (STAGES ONLY, DOES NOT AUTO-SEARCH) ====================
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
      closeBarcodeScanner();
      toast('Camera error: ' + err.message);
    }
  };

  window.closeBarcodeScanner = () => {
    if (barcodeRaf) cancelAnimationFrame(barcodeRaf);
    barcodeRaf = null;
    if (barcodeStream) { barcodeStream.getTracks().forEach(t => t.stop()); barcodeStream = null; }
    document.getElementById('barcodeVideo').srcObject = null;
    document.getElementById('barcodeModal').classList.add('hidden');
  };

  // ==================== SINGLE-BUTTON SEARCH & ANALYZE PIPELINE ====================
  window.runFullScan = async () => {
    scanRunId++;
    const myRunId = scanRunId;
    stopHighlightAudio();
    unlockAudioForAutoplay();

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
    setStatus(`Reading ${stagedPhotos.length} photo(s) with Gemini...`, true);
    const fmtHint = activeFormat === 'Auto' ? 'Auto-detect Cassette, CD, or Vinyl' : `User selected format: ${activeFormat}`;
    const upcHint = stagedUpc ? `User also scanned UPC barcode: ${stagedUpc}.` : '';
    const prompt = `You are a physical music media OCR & pressing-identification expert. Inspect ALL attached photos together. ${fmtHint}. ${upcHint}
Return ONLY valid JSON:
{
  "detected_format": "Cassette" | "CD" | "Vinyl",
  "raw_catalog_number": "exact catalog code printed on shell/spine/disc, or empty string",
  "cleaned_catalog_variants": ["catalog variations stripping hyphens/spaces/price prefixes"],
  "barcode": "digits only UPC/EAN if visible, else empty string",
  "album_title": "album or release title",
  "artists": ["main artist name(s)"],
  "label": "record label name or empty string",
  "year": "4-digit copyright/release year printed, else empty string",
  "country_clues": "country printed (e.g. 'Printed in U.S.A.') or 'Not visible'",
  "club_edition": "None" | "CRC" | "BMG" | "Unknown",
  "physical_details": "plain-English description of visible physical features (plastic shell color, paper label vs printed directly on plastic, numbers inside the little tape window like 100-50-0, cover colors, club logos)",
  "condition_note": "short note like 'Loose cassette shell' or 'Standard'",
  "signature_song": "the single most famous or representative song on this album if you recognize it (so we can play a 30s highlight immediately), else empty string",
  "visible_tracks": ["any song titles visible in the photos"]
}`;

    const parts = [{ text: prompt }, ...stagedPhotos.map(p => ({ inline_data: { mime_type: 'image/jpeg', data: p.apiB64 } }))];

    try {
      const ext = await CC.callGeminiJSON(parts);
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
      document.getElementById('fNote').value = ext.condition_note || 'Standard';

      const clues = [
        ext.country_clues && ext.country_clues !== 'Not visible' ? `Country: ${ext.country_clues}` : '',
        ext.club_edition && ext.club_edition !== 'Unknown' ? `Club: ${ext.club_edition}` : '',
        ext.physical_details ? `Clues: ${ext.physical_details}` : ''
      ].filter(Boolean).join(' · ');
      document.getElementById('detectedCluesLine').textContent = clues;

      document.getElementById('extractCard').classList.remove('hidden');
      document.getElementById('extractDetails').open = false;
      speakText(`${ext.artists?.[0] || ''} ${ext.album_title || ''}`);

      // Kick off 30s highlight immediately while Discogs searches!
      const leadArtist = Array.isArray(ext.artists) ? ext.artists[0] : (ext.artists || '');
      if (leadArtist && (ext.signature_song || ext.album_title)) {
        loadHighlightClip(leadArtist, ext.signature_song || '', ext.album_title || '', myRunId, false);
      }
      return true;
    } catch (err) {
      setStatus('', false);
      toast('Gemini error: ' + err.message, 4000);
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
      renderCandidates(false); // keep hidden by default!

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
    } else {
      card.classList.add('hidden');
    }
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

CRITICAL RULES FOR SPEED & SIMPLICITY:
1. User's home country is "${cfg.homeCountry || 'US'}". Rule out obvious foreign pressings (e.g. India/Turkey/Europe) when the photo shows US text/address or has no foreign language.
2. DO NOT bother the user with a question over trivial factory micro-differences (like slightly different cassette screws, molding plant stamps, or tiny text spacing) on common pressings! If the remaining candidates are basically the same country & edition, pick the most popular matching one (highest "have" count that matches the photo) and set status="confident".
3. ONLY set status="needs_question" when 2+ variants have an EASY-TO-SPOT physical difference that actually matters (e.g. Solid White plastic shell vs Clear see-through plastic shell; Club Edition with "CRC"/"BMG" printed on it vs normal retail; different country; or a noticeably rare/valuable pressing vs a common reissue) AND you can't already tell from the photo.
4. ZERO COLLECTOR JARGON! Never say "J-card", "inlay", "matrix", "runout", "IFPI", "shell mold", "timing window", or "beveled". Use everyday words:
   - "the plastic cassette itself" (white vs clear see-through vs black)
   - "the paper cover inside the case"
   - "the little numbers inside the clear middle window of the tape (like 100-50-0)"
   - "the letters 'CRC' or 'BMG' printed on the spine or back cover"

Scanned info: ${JSON.stringify({
  title: document.getElementById('fTitle').value,
  artist: document.getElementById('fArtist').value,
  catno: document.getElementById('fCatno').value,
  barcode: document.getElementById('fBarcode').value,
  country_clues: currentExtracted?.country_clues || 'Not visible',
  club_edition: currentExtracted?.club_edition || 'Unknown',
  physical_details: currentExtracted?.physical_details || 'No photo (UPC/manual)'
})}

Discogs Variants:
${JSON.stringify(dossiers, null, 2)}

Return ONLY valid JSON:
{
  "status": "confident" | "needs_question",
  "best_release_id": number,
  "eliminated_ids": [numbers ruled out],
  "reasoning": "1 short, plain-English sentence explaining which pressing this matches and why.",
  "candidate_diffs": [{ "id": number, "short_diff": "plain-English 6-10 word summary" }],
  "question": null or {
    "prompt": "One super simple, jargon-free question",
    "how_to_check": "Plain 1-sentence tip telling them exactly where to glance",
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
    } catch (err) {
      setStatus('', false);
      // Fallback: inspect top ranked match so user isn't stalled
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
    const ids = (opt.matching_ids || []).filter(id => currentCandidates.some(c => c.id === id));

    if (ids.length === 1) {
      detectivePickId = ids[0];
      document.getElementById('detectiveQuestionBox').classList.add('hidden');
      document.getElementById('detectiveBadge').innerHTML = `<span class="badge badge-green" style="margin:0;">✅ Locked In</span>`;
      document.getElementById('detectiveReasoning').textContent = `Selected: ${opt.label}`;
      await inspectCandidate(currentCandidates.findIndex(c => c.id === ids[0]), scanRunId);
    } else if (ids.length > 1) {
      await runVariantDetective(ids, scanRunId);
    } else {
      renderCandidates(true);
    }
  };

  // ==================== INSPECTOR + TASTE + FEEDBACK ====================
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

      const artistName = (release.artists || []).map(a => a.name.replace(/\s*\(\d+\)$/, '')).join(', ') ||
                         (cand.title.includes(' - ') ? cand.title.split(' - ')[0] : '');
      const albumTitle = release.title || (cand.title.includes(' - ') ? cand.title.split(' - ').slice(1).join(' - ') : cand.title);
      const catno = release.labels?.[0]?.catno || cand.catno || document.getElementById('fCatno').value.trim();
      const label = release.labels?.[0]?.name || (Array.isArray(cand.label) ? cand.label[0] : '');
      const format = document.getElementById('fFormat').value;
      const tracklist = (release.tracklist || []).filter(t => t.type_ !== 'heading').map(t => ({ pos: t.position || '', title: t.title || '' }));

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

      currentInspected = {
        discogs_id: release.id, title: albumTitle, artist: artistName, catno, format,
        year: release.year || cand.year || '', label, country: release.country || cand.country || '',
        genres: [...(release.genres || []), ...(release.styles || [])],
        condition_note: document.getElementById('fNote').value.trim() || 'Standard',
        lowest_price: lowestPrice, vg_plus_price: vgPlusPrice, est_price: estPrice,
        num_for_sale: numForSale, have, want, is_high_value: isHighValue, is_scarce: isScarce,
        tracklist, pressing_notes: notesParts.join('\n').trim(),
        discogs_url: release.uri || `https://www.discogs.com/release/${release.id}`,
        discogs_thumb: release.thumb || cand.thumb || '',
        taste_score: null, taste_verdict: null, taste_summary: '', notable_songs: [], litmus_track: '',
        spotify_matches: { artistHit: false, matchedTracks: [] }
      };

      // Keep candidates panel hidden unless user explicitly opened it
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
    const tracks = (currentExtracted?.visible_tracks || []).map((t, i) => ({ pos: String(i + 1), title: t }));

    currentInspected = {
      discogs_id: null, title, artist,
      catno: document.getElementById('fCatno').value.trim(),
      format: document.getElementById('fFormat').value,
      year: document.getElementById('fYear').value.trim(),
      label: document.getElementById('fLabel').value.trim(),
      country: '', genres: [], condition_note: document.getElementById('fNote').value.trim() || 'Standard',
      lowest_price: null, vg_plus_price: null, est_price: null, num_for_sale: null,
      have: 0, want: 0, is_high_value: false, is_scarce: false, tracklist: tracks, pressing_notes: '',
      discogs_url: '', discogs_thumb: '', taste_score: null, taste_verdict: null,
      taste_summary: '', notable_songs: [], litmus_track: '', spotify_matches: { artistHit: false, matchedTracks: [] }
    };

    renderInspector(currentInspected, false);
    document.getElementById('inspectorCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    await runTasteAnalysis(currentInspected, scanRunId);
  };

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
              `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="https://www.discogs.com/sell/history/${item.discogs_id}">📈 Sales History</a>` + links;
    }
    document.getElementById('inspLinks').innerHTML = links;

    const nw = document.getElementById('pressingNotesDetails');
    nw.classList.toggle('hidden', !item.pressing_notes);
    if (item.pressing_notes) document.getElementById('inspNotes').textContent = item.pressing_notes;

    const btnWrong = document.getElementById('btnWrongPressing');
    if (currentCandidates.length > 1) {
      btnWrong.classList.remove('hidden');
      btnWrong.textContent = `Wrong pressing? View all ${currentCandidates.length} Discogs matches ▾`;
    } else btnWrong.classList.add('hidden');

    const saveBtn = document.getElementById('btnSaveBoth');
    saveBtn.disabled = !hasDiscogs || !cfg.discogsToken || !cfg.discogsUser;
    saveBtn.textContent = !hasDiscogs ? 'Not on Discogs (Use Save Local Only below)'
      : (!cfg.discogsUser ? 'Verify Discogs in Settings to Enable Save' : '✅ Confirm & Add to Discogs + Local Stash');

    // Local Spotify match
    const localMatch = checkLocalSpotify(item);
    item.spotify_matches = localMatch;
    renderTracklist(item.tracklist, localMatch.matchedTracks);

    let badges = '';
    if (localMatch.artistHit) badges += `<span class="badge badge-green">🎸 Artist in Your Spotify</span>`;
    if (localMatch.matchedTracks.length) badges += `<span class="badge badge-green">🎵 ${localMatch.matchedTracks.length} Track(s) in Your Library</span>`;
    if (!spotifyProfile) badges += `<span class="badge badge-yellow">Spotify not synced yet</span>`;
    document.getElementById('tasteLocalBadges').innerHTML = badges;
    document.getElementById('tasteScore').textContent = '...';
    document.getElementById('tasteBody').textContent = 'Checking your Spotify taste & picking the best test song...';
    document.getElementById('tasteHits').innerHTML = '';
    document.getElementById('tasteVoteRow').classList.add('hidden');
  }

  function renderTracklist(tracks, matched = []) {
    const mSet = new Set(matched.map(norm));
    document.getElementById('trackCount').textContent = tracks.length;
    const el = document.getElementById('inspTracklist');
    if (!tracks.length) { el.innerHTML = `<div style="color:var(--muted);">No tracklist available.</div>`; return; }
    el.innerHTML = tracks.map(t => {
      const hit = mSet.has(norm(t.title));
      return `<div class="track-row ${hit ? 'track-hit' : ''}">
        <span>${esc(t.pos ? t.pos + ' · ' : '')}${esc(t.title)}</span>
        <div class="inline-actions" style="gap:4px;">
          ${hit ? '<span class="badge badge-green" style="margin:0;">In Spotify</span>' : ''}
          <button class="btn btn-secondary btn-sm" style="min-height:26px; padding:2px 7px; font-size:0.72rem;" onclick="previewSpecificTrack(${JSON.stringify(t.title)})">▶</button>
        </div>
      </div>`;
    }).join('');
  }

  window.previewSpecificTrack = (trackTitle) => {
    if (!currentInspected) return;
    unlockAudioForAutoplay();
    const prevAuto = cfg.autoPlayHighlight;
    cfg.autoPlayHighlight = true;
    loadHighlightClip(currentInspected.artist, trackTitle, currentInspected.title, scanRunId, true)
      .finally(() => { cfg.autoPlayHighlight = prevAuto; });
  };

  function checkLocalSpotify(item) {
    if (!spotifyProfile) return { artistHit: false, matchedTracks: [] };
    const artistNorms = String(item.artist || '').split(/,|&|\band\b|feat\.?/i).map(norm).filter(Boolean);
    const artistHit = artistNorms.some(a => Boolean(spotifyProfile.allArtists?.[a]));
    const trackSet = new Set(spotifyProfile.trackTitles || []);
    const matchedTracks = (item.tracklist || []).filter(t => norm(t.title).length > 2 && trackSet.has(norm(t.title))).map(t => t.title);
    return { artistHit, matchedTracks };
  }

  function renderVoteState(item) {
    const row = document.getElementById('tasteVoteRow');
    row.classList.remove('hidden');
    const existing = tasteFeedback.find(f => norm(f.artist) === norm(item.artist) && norm(f.title) === norm(item.title));
    document.getElementById('btnVoteUp').className = 'vote-btn' + (existing?.liked === true ? ' active-up' : '');
    document.getElementById('btnVoteDown').className = 'vote-btn' + (existing?.liked === false ? ' active-down' : '');
  }

  window.submitTasteVote = async (liked) => {
    if (!currentInspected) return;
    const keyA = norm(currentInspected.artist), keyT = norm(currentInspected.title);
    tasteFeedback = tasteFeedback.filter(f => !(norm(f.artist) === keyA && norm(f.title) === keyT));
    tasteFeedback.unshift({
      artist: currentInspected.artist,
      title: currentInspected.title,
      track: currentInspected.litmus_track || '',
      genres: (currentInspected.genres || []).slice(0, 4),
      liked,
      at: Date.now()
    });
    if (tasteFeedback.length > 200) tasteFeedback = tasteFeedback.slice(0, 200);
    await CC.idbPut('meta', { key: 'taste_feedback', value: tasteFeedback });
    tasteCache.clear();
    renderVoteState(currentInspected);
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

  function applyTasteUI(item, res, myRunId) {
    item.taste_score = res.score;
    item.taste_verdict = res.verdict;
    item.taste_summary = res.summary;
    item.notable_songs = Array.isArray(res.notable_songs) ? res.notable_songs : [];
    item.litmus_track = res.litmus_track || item.tracklist?.[0]?.title || '';

    const vClass = res.verdict === 'KEEP' ? 'badge-green' : res.verdict === 'LISTEN' ? 'badge-blue' : 'badge-red';
    document.getElementById('tasteScore').innerHTML = `${esc(res.score)}/10 <span class="badge ${vClass}" style="vertical-align:middle;">${esc(res.verdict)}</span>`;
    document.getElementById('tasteBody').textContent = res.summary || '';

    let hitsHtml = '';
    if (item.litmus_track) {
      hitsHtml += `<div style="margin-bottom:5px;"><strong>🎧 Test Song:</strong> ${esc(item.litmus_track)}</div>`;
    }
    if (item.notable_songs.length) {
      hitsHtml += `<strong>⭐ Notable Songs:</strong><br>` + item.notable_songs.map(s => `• ${esc(s)}`).join('<br>');
    }
    document.getElementById('tasteHits').innerHTML = hitsHtml || `<span style="color:var(--muted);">No major mainstream hits identified.</span>`;
    renderVoteState(item);

    // Load 30s highlight if nothing is playing yet (e.g. UPC-only scan or album Gemini didn't recognize by cover)
    if (item.litmus_track || item.title) {
      loadHighlightClip(item.artist, item.litmus_track, item.title, myRunId, false);
    }
  }

  async function runTasteAnalysis(item, myRunId) {
    if (!cfg.geminiKey) {
      document.getElementById('tasteScore').textContent = '—';
      document.getElementById('tasteBody').textContent = 'Add Gemini API Key to enable Taste & Test Song check.';
      return;
    }

    const cacheKey = `${norm(item.artist)}|${norm(item.title)}`;
    if (tasteCache.has(cacheKey)) { applyTasteUI(item, tasteCache.get(cacheKey), myRunId); return; }

    const topArtists = (spotifyProfile?.topArtists || []).slice(0, 60).join(', ');
    const tracksStr = (item.tracklist || []).slice(0, 24).map(t => t.title).join('; ');
    const recentUp = tasteFeedback.filter(f => f.liked).slice(0, 20).map(f => `${f.artist} - ${f.title}`).join('; ');
    const recentDn = tasteFeedback.filter(f => !f.liked).slice(0, 20).map(f => `${f.artist} - ${f.title}`).join('; ');

    const prompt = `Evaluate whether the user would like this physical music release, pick ONE best "litmus test" song from the tracklist to preview, and list any recognizable hits. Speak directly to "you".
Release: "${item.artist} - ${item.title}" (${item.year || '?'}, ${item.format}, Genres: ${(item.genres || []).join(', ') || 'unknown'}).
Tracklist: ${tracksStr || 'Unknown'}.
Spotify Matches: Artist in library=${item.spotify_matches.artistHit}, Exact tracks=${item.spotify_matches.matchedTracks.join(', ') || 'None'}.
Top Spotify Artists: ${topArtists || 'Not synced'}.
Recent 👍 Liked Scans: ${recentUp || 'None'}.
Recent 👎 Disliked Scans: ${recentDn || 'None'}.

Return ONLY valid JSON:
{
  "score": 1 to 10 integer,
  "verdict": "KEEP" | "LISTEN" | "SELL / SKIP",
  "litmus_track": "exact title of the single best/most famous track from the tracklist to play a 30s clip of",
  "summary": "1-2 punchy sentences speaking directly to 'you', referencing your Spotify artists or past 👍/👎 ratings when relevant.",
  "notable_songs": ["Track Name — short reason it's recognizable (max 3 items, or empty array)"]
}`;

    try {
      const res = await CC.callGeminiJSON([{ text: prompt }]);
      tasteCache.set(cacheKey, res);
      if (myRunId !== scanRunId || currentInspected !== item) return;
      applyTasteUI(item, res, myRunId);
    } catch (err) {
      document.getElementById('tasteScore').textContent = '?';
      document.getElementById('tasteBody').textContent = 'Taste check error: ' + err.message;
    }
  }

  // ==================== SAVE & RESET ====================
  window.saveCurrentItem = async (syncToDiscogs) => {
    if (!currentInspected) return;
    let synced = false;
    if (syncToDiscogs) {
      if (!cfg.discogsToken || !cfg.discogsUser || !currentInspected.discogs_id) { toast('Verify Discogs in Settings first'); return; }
      setStatus('Adding release to your official Discogs collection...', true);
      try {
        await CC.discogsFetch(`/users/${encodeURIComponent(cfg.discogsUser)}/collection/folders/${encodeURIComponent(cfg.discogsFolderId || '1')}/releases/${currentInspected.discogs_id}`, {}, 'POST');
        synced = true;
      } catch (err) { setStatus('', false); toast('Discogs save failed: ' + err.message, 4500); return; }
    }

    const record = {
      ...currentInspected,
      synced_to_discogs: synced,
      thumb_data_url: stagedPhotos[0]?.thumbWebp || currentInspected.discogs_thumb || '',
      created_at: Date.now()
    };
    try {
      await CC.idbPut('stash', record);
      await loadStashCache();
      setStatus('', false);
      toast(synced ? '✅ Saved to Discogs & Local Stash!' : '💾 Saved to Local Stash!');
      resetScanner();
    } catch (err) { setStatus('', false); toast('Local save failed: ' + err.message); }
  };

  window.resetScanner = () => {
    scanRunId++;
    stopHighlightAudio();
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
    ['fTitle', 'fArtist', 'fCatno', 'fBarcode', 'fLabel', 'fYear', 'fNote'].forEach(id => document.getElementById(id).value = '');
    updateStageUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ==================== LOCAL STASH & BACKUP ====================
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
      if (activeStashFilter === 'localonly' && it.synced_to_discogs) return false;
      if (!q) return true;
      return norm(`${it.artist} ${it.title} ${it.catno} ${it.label} ${it.condition_note} ${(it.tracklist || []).map(t => t.title).join(' ')}`).includes(q);
    });

    const totalVal = filtered.reduce((s, it) => s + (Number(it.est_price) || 0), 0);
    document.getElementById('stashStats').textContent = `${filtered.length} items · ~$${totalVal.toFixed(0)}`;

    const list = document.getElementById('stashList');
    if (!filtered.length) { list.innerHTML = `<div class="card"><p>No matching items yet.</p></div>`; return; }

    list.innerHTML = filtered.map(it => {
      const pBadge = it.est_price != null ? `<span class="badge ${it.is_high_value ? 'badge-yellow' : 'badge-blue'}">$${Number(it.est_price).toFixed(2)}</span>` : '';
      const sBadge = it.is_scarce ? `<span class="badge badge-purple">💎 Scarce</span>` : '';
      const tBadge = it.taste_score ? `<span class="badge ${it.taste_score >= 7 ? 'badge-green' : 'badge-blue'}">🎧 ${it.taste_score}/10</span>` : '';
      const syncB = it.synced_to_discogs ? `<span class="badge badge-green">In Discogs</span>` : `<span class="badge badge-yellow">Local Only</span>`;
      return `
        <div class="stash-item">
          <img class="stash-thumb" src="${esc(it.thumb_data_url || '')}" onerror="this.style.visibility='hidden'" />
          <div class="stash-body">
            <div class="candidate-title">${esc(it.artist)} — ${esc(it.title)}</div>
            <div class="candidate-sub">${esc(it.format)} · ${esc(it.country || '?')} · ${esc(it.year || '?')} · ${esc(it.catno || 'No Cat#')}</div>
            <div style="margin-bottom:6px;">${pBadge}${sBadge}${tBadge}${syncB}</div>
            ${it.taste_summary ? `<div style="font-size:0.78rem; color:var(--muted); margin-bottom:6px;">${esc(it.taste_summary)}</div>` : ''}
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              ${it.discogs_url ? `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener" href="${esc(it.discogs_url)}">Discogs</a>` : ''}
              ${(!it.synced_to_discogs && it.discogs_id) ? `<button class="btn btn-green btn-sm" onclick="pushStashToDiscogs(${it.id})">Push to Discogs</button>` : ''}
              <button class="btn btn-danger btn-sm" onclick="deleteStashItem(${it.id})">Delete</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  };

  window.pushStashToDiscogs = async (id) => {
    const it = stashCache.find(x => x.id === id);
    if (!it || !it.discogs_id || !cfg.discogsUser) { toast('Verify Discogs in Settings first'); return; }
    try {
      await CC.discogsFetch(`/users/${encodeURIComponent(cfg.discogsUser)}/collection/folders/${encodeURIComponent(cfg.discogsFolderId || '1')}/releases/${it.discogs_id}`, {}, 'POST');
      it.synced_to_discogs = true;
      await CC.idbPut('stash', it);
      await loadStashCache(); renderStash();
      toast('✅ Added to Discogs!');
    } catch (e) { toast('Failed: ' + e.message); }
  };

  window.deleteStashItem = async (id) => {
    if (!confirm('Remove from Local Stash?')) return;
    await CC.idbDelete('stash', id);
    await loadStashCache(); renderStash();
    toast('Deleted');
  };

  function dl(content, filename, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  window.exportCSV = () => {
    if (!stashCache.length) { toast('Nothing to export'); return; }
    const cols = ['artist', 'title', 'format', 'country', 'catno', 'label', 'year', 'est_price', 'lowest_price', 'num_for_sale', 'have', 'want', 'is_high_value', 'is_scarce', 'taste_score', 'taste_verdict', 'synced_to_discogs', 'condition_note', 'discogs_url'];
    const c = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    dl([cols.join(','), ...stashCache.map(it => cols.map(k => c(it[k])).join(','))].join('\n'), `cratecheck-stash-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  };

  window.exportJSON = () => {
    dl(JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), stash: stashCache, spotifyProfile, tasteFeedback }), `cratecheck-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
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
      toast(`✅ Gemini key verified!`);
    } catch (err) {
      badge.style.color = 'var(--red)'; badge.textContent = '❌ Error';
      toast('Gemini test failed: ' + err.message, 5000);
    }
  };

  window.verifyDiscogsAccount = async () => {
    saveSettings(true);
    if (!cfg.discogsToken) { toast('Paste your Discogs Token first'); return; }
    setStatus('Verifying Discogs & loading folders...', true);
    try {
      const id = await CC.discogsFetch('/oauth/identity');
      cfg.discogsUser = id.username;
      const fRes = await CC.discogsFetch(`/users/${encodeURIComponent(id.username)}/collection/folders`);
      cfg.discogsFolders = (fRes.folders || []).filter(f => f.id !== 0);
      if (!cfg.discogsFolders.length) cfg.discogsFolders = [{ id: 1, name: 'Uncategorized' }];
      populateFolders(); CC.persistCfg();
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

    // Handle Spotify OAuth return
    const p = new URLSearchParams(location.search);
    if (p.get('error')) { history.replaceState({}, '', location.pathname); toast('Spotify login cancelled'); }
    else if (p.get('code')) {
      const code = p.get('code'), state = p.get('state');
      history.replaceState({}, '', location.pathname);
      setStatus('Connecting Spotify...', true);
      try { await CC.exchangeSpotifyCode(code, state); await runSpotifySyncUI(); }
      catch (e) { setStatus('', false); toast('Spotify error: ' + e.message, 4500); }
    }
  }

  init();
})();