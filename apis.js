(() => {
  'use strict';

  const CC = {};
  CC.REDIRECT_URI = location.origin + location.pathname;
  // Migration safety: keep legacy IndexedDB / localStorage keys unchanged so existing Stash & settings persist
  CC.CFG_KEY = 'cratecheck_cfg_v1';
  CC.CLOUD_DIRTY_KEY = 'cratecheck_cloud_dirty_v1';
  CC.DEFAULT_GOOGLE_CLIENT_ID = '409160262973-fr2ostrkem4nqpcp6p6igjqf2hjdp7fn.apps.googleusercontent.com';

  CC.MEDIA_GRADES = [
    'Not Graded',
    'Mint (M)',
    'Near Mint (NM or M-)',
    'Very Good Plus (VG+)',
    'Very Good (VG)',
    'Good Plus (G+)',
    'Good (G)',
    'Fair (F)',
    'Poor (P)'
  ];

  CC.SLEEVE_GRADES = [
    'Mint (M)',
    'Near Mint (NM or M-)',
    'Very Good Plus (VG+)',
    'Very Good (VG)',
    'Good Plus (G+)',
    'Good (G)',
    'Fair (F)',
    'Poor (P)',
    'Generic',
    'Not Graded',
    'No Cover'
  ];

  let storedCfg = {};
  try {
    storedCfg = JSON.parse(localStorage.getItem(CC.CFG_KEY) || '{}') || {};
  } catch (_) {
    storedCfg = {};
  }

  CC.cfg = Object.assign({
    geminiKey: '',
    geminiModel: 'gemini-3.5-flash-lite',
    autoPlayHighlight: true,
    autoDetective: true,
    autoGradeOnScan: false,
    preferredCameraId: '',
    googleClientId: '',
    googleAutoSync: true,
    googleSyncSecrets: false,
    googleLastSyncAt: 0,
    googleEmail: '',
    cfgUpdatedAt: 0,
    discogsToken: '',
    discogsUser: '',
    discogsFolderId: '1',
    discogsFolders: [{ id: 1, name: 'Uncategorized' }],
    discogsFields: { media: 1, sleeve: 2, notes: 3 },
    homeCountry: 'US',
    fetchVgSuggestions: true,
    threshold: 20,
    voice: false,
    spotifyClientId: '',
    spotifyAccessToken: '',
    spotifyRefreshToken: '',
    spotifyExpiresAt: 0,
    showSpotify: true,
    showApple: true,
    showDeezer: true,
    showYoutube: true
  }, storedCfg);

  // Cleanly strip any legacy Ollama keys so upgrades land directly in Gemini Cloud mode
  delete CC.cfg.aiProvider;
  delete CC.cfg.ollamaUrl;
  delete CC.cfg.ollamaModel;
  delete CC.cfg.ollamaFallback;

  CC.persistCfg = (touchTimestamp = false) => {
    if (touchTimestamp) CC.cfg.cfgUpdatedAt = Date.now();
    localStorage.setItem(CC.CFG_KEY, JSON.stringify(CC.cfg));
  };

  CC.generateSyncId = () => {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (_) {}
    return 'cc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
  };

  CC.isAiReady = () => Boolean(CC.cfg.geminiKey?.trim());

  // Lightweight approximate FX-to-USD rates for currency-aware High-Value threshold checks
  CC.FX_TO_USD = {
    USD: 1.0,
    EUR: 1.09,
    GBP: 1.27,
    CAD: 0.72,
    AUD: 0.65,
    JPY: 0.0066,
    CHF: 1.13,
    SEK: 0.095,
    MXN: 0.050,
    BRL: 0.17,
    NZD: 0.60,
    ZAR: 0.055
  };

  CC.toApproxUsd = (val, currency = 'USD') => {
    if (val === null || val === undefined || val === '' || !Number.isFinite(Number(val))) return null;
    const code = String(currency || 'USD').trim().toUpperCase();
    const rate = CC.FX_TO_USD[code];
    if (!rate) return null;
    return Number(val) * rate;
  };

  CC.formatMoney = (val, currency = 'USD') => {
    if (val === null || val === undefined || val === '' || !Number.isFinite(Number(val))) return '—';
    const num = Number(val);
    const code = String(currency || 'USD').trim().toUpperCase();
    const symMap = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'CA$', AUD: 'A$', NZD: 'NZ$' };
    const decimals = code === 'JPY' ? 0 : 2;
    if (symMap[code]) return `${symMap[code]}${num.toFixed(decimals)}`;
    return `${code} ${num.toFixed(decimals)}`;
  };

  CC.formatMoneyWithUsd = (val, currency = 'USD') => {
    const base = CC.formatMoney(val, currency);
    if (base === '—') return base;
    const code = String(currency || 'USD').trim().toUpperCase();
    if (code === 'USD') return base;
    const usd = CC.toApproxUsd(val, code);
    if (usd === null) return base;
    const usdStr = usd >= 10 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`;
    return `${base} (~${usdStr})`;
  };

  CC.sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new DOMException('Cancelled', 'AbortError'));
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });

  CC.esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CC.foldText = (s) => String(s || '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  CC.norm = (s) => CC.foldText(s).toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  CC.normFull = (s) => CC.foldText(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function tokenSim(na, nb) {
    const ta = new Set(na.split(' ').filter(w => w.length > 1));
    const tb = new Set(nb.split(' ').filter(w => w.length > 1));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    ta.forEach(w => { if (tb.has(w)) inter++; });
    const sub = (na && nb && (na.includes(nb) || nb.includes(na))) ? 0.25 : 0;
    return Math.min(1, inter / (ta.size + tb.size - inter) + sub);
  }

  CC.similarity = (a, b) => tokenSim(CC.norm(a), CC.norm(b));
  CC.simFull = (a, b) => tokenSim(CC.normFull(a), CC.normFull(b));

  let statusCb = () => {};
  let rateCb = () => {};
  CC.setStatusCallback = (fn) => { statusCb = fn; };
  CC.setRateCallback = (fn) => { rateCb = fn; };

  // ==================== INDEXEDDB ====================
  let db = null;
  CC.openDB = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('CrateCheckDB', 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('stash')) d.createObjectStore('stash', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });

  CC.idbGet = (store, key) => new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  CC.idbPut = (store, val) => new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).put(val);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  CC.idbDelete = (store, key) => new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    r.onsuccess = () => res(); r.onerror = () => rej(r.error);
  });
  CC.idbGetAll = (store) => new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });

  // ==================== DISCOGS SMART BURST QUEUE (60/MIN REAL LIMIT) ====================
  const dQueue = [];
  let dBusy = false;
  let lastDCall = 0;
  let recentDCalls = [];
  CC.releaseDetailCache = new Map();

  CC.getRateCount = () => {
    const now = Date.now();
    recentDCalls = recentDCalls.filter(t => now - t < 60000);
    return recentDCalls.length;
  };

  CC.discogsFetch = (path, params = {}, method = 'GET', body = null) => new Promise((resolve, reject) => {
    dQueue.push({ path, params, method, body, resolve, reject });
    runDQueue();
  });

  async function runDQueue() {
    if (dBusy || !dQueue.length) return;
    dBusy = true;
    const job = dQueue.shift();
    try {
      const now = Date.now();
      recentDCalls = recentDCalls.filter(t => now - t < 60000);
      if (recentDCalls.length >= 57) {
        const waitMs = 60600 - (now - recentDCalls[0]);
        statusCb(`Discogs 60/min ceiling reached — resuming in ${Math.ceil(waitMs / 1000)}s...`, true);
        await CC.sleep(Math.max(1000, waitMs));
      }
      const minGap = recentDCalls.length > 42 ? 950 : 160;
      const gap = Date.now() - lastDCall;
      if (gap < minGap) await CC.sleep(minGap - gap);

      const url = new URL('https://api.discogs.com' + job.path);
      Object.entries(job.params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
      if (CC.cfg.discogsToken) url.searchParams.set('token', CC.cfg.discogsToken.trim());

      lastDCall = Date.now();
      recentDCalls.push(lastDCall);
      rateCb(recentDCalls.length);

      const fetchOpts = { method: job.method };
      if (job.body !== null && job.body !== undefined) {
        fetchOpts.headers = { 'Content-Type': 'application/json' };
        fetchOpts.body = JSON.stringify(job.body);
      }

      const res = await fetch(url.toString(), fetchOpts);
      if (res.status === 429) {
        statusCb('Discogs rate limit hit — cooling down 60s...', true);
        await CC.sleep(60000);
        const retry = await fetch(url.toString(), fetchOpts);
        if (!retry.ok) throw new Error(`Discogs HTTP ${retry.status}`);
        job.resolve(await retry.json().catch(() => ({})));
      } else if (res.status === 204) {
        job.resolve({});
      } else if (!res.ok) {
        const errTxt = await res.text().catch(() => '');
        const err = new Error(`Discogs HTTP ${res.status}: ${errTxt.slice(0, 120)}`);
        err.status = res.status;
        throw err;
      } else {
        job.resolve(await res.json().catch(() => ({})));
      }
    } catch (e) {
      job.reject(e);
    } finally {
      dBusy = false;
      if (dQueue.length) runDQueue();
    }
  }

  CC.getReleaseCached = async (releaseId) => {
    const id = Number(releaseId);
    if (CC.releaseDetailCache.has(id)) return CC.releaseDetailCache.get(id);
    const data = await CC.discogsFetch(`/releases/${id}`);
    CC.releaseDetailCache.set(id, data);
    return data;
  };

  CC.findDiscogsInstances = async (releaseId, opts = {}) => {
    const { throwOnError = false } = opts || {};
    if (!CC.cfg.discogsUser || !releaseId) return [];
    try {
      const data = await CC.discogsFetch(`/users/${encodeURIComponent(CC.cfg.discogsUser)}/collection/releases/${releaseId}`);
      return Array.isArray(data?.releases) ? data.releases : [];
    } catch (err) {
      if (throwOnError) throw err;
      return [];
    }
  };

  CC.deleteDiscogsInstance = async (folderId, releaseId, instanceId) => {
    if (!CC.cfg.discogsUser || !releaseId || !instanceId) return false;
    await CC.discogsFetch(
      `/users/${encodeURIComponent(CC.cfg.discogsUser)}/collection/folders/${encodeURIComponent(folderId || '1')}/releases/${releaseId}/instances/${instanceId}`,
      {},
      'DELETE'
    );
    return true;
  };

  CC.syncDiscogsInstanceFields = async (folderId, releaseId, instanceId, mediaCond, sleeveCond, notes) => {
    if (!CC.cfg.discogsUser || !releaseId || !instanceId) {
      return { okCount: 0, failedCount: 0, errors: [] };
    }
    const f = CC.cfg.discogsFields || { media: 1, sleeve: 2, notes: 3 };
    const updates = [];
    const mediaSet = Boolean(mediaCond && mediaCond !== 'Not Graded');
    const sleeveSet = Boolean(sleeveCond && sleeveCond !== 'Not Graded');
    const isUngraded = !mediaSet;
    const noteStr = notes !== undefined && notes !== null ? String(notes) : '';

    if (f.media && mediaSet) updates.push({ id: f.media, val: mediaCond, label: 'Media Condition' });
    if (f.sleeve && sleeveSet) updates.push({ id: f.sleeve, val: sleeveCond, label: 'Sleeve Condition' });
    if (f.notes && (!isUngraded || noteStr.trim() !== '')) updates.push({ id: f.notes, val: noteStr, label: 'Notes' });

    let okCount = 0;
    let failedCount = 0;
    const errors = [];
    for (const u of updates) {
      try {
        await CC.discogsFetch(
          `/users/${encodeURIComponent(CC.cfg.discogsUser)}/collection/folders/${encodeURIComponent(folderId || '1')}/releases/${releaseId}/instances/${instanceId}/fields/${u.id}`,
          {},
          'POST',
          { value: u.val }
        );
        okCount++;
      } catch (err) {
        failedCount++;
        errors.push(`${u.label}: ${err?.message || 'Write failed'}`);
      }
    }
    return { okCount, failedCount, errors };
  };

  CC.syncDiscogsCollectionIndex = async () => {
    if (!CC.cfg.discogsUser || !CC.cfg.discogsToken) {
      throw new Error('Verify your Discogs account first');
    }
    const releaseIds = new Set();
    const masterIds = new Set();
    const masterMap = {};
    const albumKeys = {};
    let page = 1;
    let totalPages = 1;
    let totalItems = 0;

    const pushEntry = (mapObj, key, entry) => {
      if (!key) return;
      if (!mapObj[key]) mapObj[key] = [];
      if (!mapObj[key].some(e => e.releaseId === entry.releaseId)) {
        mapObj[key].push(entry);
      }
    };

    while (page <= totalPages) {
      statusCb(`📀 Syncing Discogs Collection Index (page ${page}/${totalPages})...`, true);
      const res = await CC.discogsFetch(
        `/users/${encodeURIComponent(CC.cfg.discogsUser)}/collection/folders/0/releases`,
        { per_page: 100, page }
      );
      totalPages = Number(res?.pagination?.pages || 1);
      const list = Array.isArray(res?.releases) ? res.releases : [];
      totalItems += list.length;

      for (const item of list) {
        const info = item.basic_information || {};
        const relId = Number(info.id || item.id || 0);
        if (!relId) continue;
        releaseIds.add(relId);

        const mId = Number(info.master_id || 0);
        const artist = (info.artists || []).map(a => String(a.name || '').replace(/\s*\(\d+\)$/, '')).join(', ').trim();
        const title = String(info.title || '').trim();
        const format = (info.formats || []).map(f => f.name).filter(Boolean).join(', ');
        const year = info.year || '';
        const entry = { releaseId: relId, artist, title, format, year };

        if (mId > 0) {
          masterIds.add(mId);
          pushEntry(masterMap, String(mId), entry);
        }
        const na = CC.norm(artist);
        const nt = CC.norm(title);
        if (na && nt) {
          pushEntry(albumKeys, `${na}|${nt}`, entry);
        }
      }
      page++;
    }

    return {
      username: CC.cfg.discogsUser,
      syncedAt: Date.now(),
      totalItems,
      releaseIds: Array.from(releaseIds),
      masterIds: Array.from(masterIds),
      masterMap,
      albumKeys
    };
  };

  // ==================== GEMINI CLOUD AI ENGINE (WITH INFINITE 5s AUTO-RETRY) ====================
  let activeAiCtrl = null;

  CC.cancelAI = () => {
    if (activeAiCtrl) {
      try { activeAiCtrl.abort(); } catch (_) {}
      activeAiCtrl = null;
    }
  };
  CC.cancelGemini = CC.cancelAI;

  function cleanJsonText(raw) {
    const noThink = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const cleaned = noThink.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    try { return JSON.parse(cleaned); }
    catch (_) {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('Could not parse AI JSON response');
    }
  }

  async function runGeminiRequest(parts, thinkingLevel, opts = {}) {
    const {
      expectJSON = true,
      retryLabel = 'Gemini',
      maxOutputTokens = null,
      mediaResolution = null
    } = opts;
    if (!CC.cfg.geminiKey?.trim()) throw new Error('Add your Gemini API Key in Settings');
    const model = (CC.cfg.geminiModel || 'gemini-3.5-flash-lite').trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(CC.cfg.geminiKey.trim())}`;

    const ctrl = new AbortController();
    activeAiCtrl = ctrl;
    const signal = ctrl.signal;

    const send = (useThinking, resMode) => {
      const genCfg = { temperature: 0.1 };
      if (expectJSON) genCfg.responseMimeType = 'application/json';
      if (maxOutputTokens) genCfg.maxOutputTokens = maxOutputTokens;
      if (useThinking && thinkingLevel) genCfg.thinkingConfig = { thinkingLevel };

      let reqParts = parts;
      if (resMode === 'per_part_ultra') {
        reqParts = parts.map(p => (p && p.inline_data)
          ? { ...p, mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' } }
          : p
        );
      } else if (resMode === 'global_high') {
        genCfg.mediaResolution = 'MEDIA_RESOLUTION_HIGH';
      } else if (resMode === 'global_opt' && mediaResolution) {
        genCfg.mediaResolution = mediaResolution;
      }

      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: reqParts }], generationConfig: genCfg }),
        signal
      });
    };

    const isUltra = mediaResolution === 'MEDIA_RESOLUTION_ULTRA_HIGH';

    let attempt = 0;
    try {
      while (true) {
        if (signal.aborted) throw new DOMException('Cancelled by user', 'AbortError');
        attempt++;
        let res = null;
        try {
          if (isUltra) {
            // Clean 4-step 400 cascade:
            // 1) Per-part ULTRA_HIGH + thinking -> 2) Global HIGH + thinking -> 3) No mediaResolution + thinking -> 4) No mediaResolution + no thinking
            res = await send(true, 'per_part_ultra');
            if (res.status === 400) res = await send(true, 'global_high');
            if (res.status === 400) res = await send(true, 'none');
            if (res.status === 400 && thinkingLevel) res = await send(false, 'none');
          } else if (mediaResolution) {
            res = await send(true, 'global_opt');
            if (res.status === 400) res = await send(true, 'none');
            if (res.status === 400 && thinkingLevel) res = await send(false, 'none');
          } else {
            res = await send(true, 'none');
            if (res.status === 400 && thinkingLevel) res = await send(false, 'none');
          }
        } catch (netErr) {
          if (netErr.name === 'AbortError' || signal.aborted) throw new DOMException('Cancelled by user', 'AbortError');
          statusCb(`${retryLabel}: connection hiccup — retrying in 5s (try #${attempt + 1})...`, true, { cancellable: true });
          await CC.sleep(5000, signal);
          continue;
        }

        if ([500, 502, 503, 504].includes(res.status)) {
          statusCb(`${retryLabel} busy (HTTP ${res.status}) — retrying in 5s (try #${attempt + 1})...`, true, { cancellable: true });
          await CC.sleep(5000, signal);
          continue;
        }

        if (!res.ok) {
          const t = await res.text().catch(() => '');
          const e = new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 160)}`);
          e.status = res.status;
          throw e;
        }

        const data = await res.json();
        const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        if (!expectJSON) return raw.trim();
        return cleanJsonText(raw);
      }
    } finally {
      if (activeAiCtrl === ctrl) activeAiCtrl = null;
    }
  }

  CC.callAI = async (parts, thinkingLevel = null, opts = {}) => runGeminiRequest(parts, thinkingLevel, opts);
  CC.callGeminiJSON = CC.callAI;

  // ==================== ERA-, ALBUM- & REMIX-AWARE AUDIO PREVIEW + PLATFORM AVAILABILITY ====================
  function extractYear4(val) {
    const m = String(val || '').match(/\b(19\d{2}|20\d{2})\b/);
    return m ? Number(m[1]) : null;
  }

  function splitTrackVersion(raw) {
    const str = String(raw || '').trim();
    const parts = [];
    const parens = str.match(/[\(\[]([^\)\]]+)[\)\]]/g);
    if (parens) parens.forEach(p => parts.push(p.slice(1, -1).trim()));
    let base = str.replace(/[\(\[][^\)\]]*[\)\]]/g, '').trim();
    const dashMatch = base.match(/^(.*?)\s+[-–—]\s+(.*\b(?:mix|remix|version|edit|dub|extended|radio|club|instrumental|acoustic|live|remaster\w*)\b.*)$/i);
    if (dashMatch) { base = dashMatch[1].trim(); parts.push(dashMatch[2].trim()); }
    return { base, version: parts.join(' ').trim() };
  }

  function scoreAudioCandidate(candArtist, candTrack, candAlbum, targetArtist, rawTrack, targetAlbum, strictTrack, targetYear = null, candYear = null) {
    const isVarious = !targetArtist || /^various(\s+artists)?$/i.test(targetArtist.trim());
    const aSim = isVarious ? 0.7 : CC.similarity(targetArtist, candArtist || '');
    const isTribute = /karaoke|tribute|cover band|lullaby|in the style of/i.test(`${candArtist} ${candAlbum} ${candTrack}`);
    if (isTribute) return { score: -1, versionMatched: false, safeAlt: false };

    const req = splitTrackVersion(rawTrack);
    const cand = splitTrackVersion(candTrack);
    const tSimBase = req.base ? CC.similarity(req.base, cand.base || candTrack || '') : 0;
    const albSim = targetAlbum ? CC.similarity(targetAlbum, candAlbum || '') : 0;
    const tYear = extractYear4(targetYear);
    const cYear = extractYear4(candYear);

    const applyEraAndAltAdjustments = (baseScore) => {
      let adj = baseScore;
      if (tYear && cYear) {
        if (Math.abs(cYear - tYear) <= 2) adj += 0.16;
        else if (cYear > tYear + 5 && albSim < 0.65) adj -= 0.24;
      }

      const reqText = String(rawTrack || '');
      const reqAsksAlt = /\b(re-?record\w*|live|acoustic|unplugged|anniversary)\b/i.test(reqText) ||
        Boolean(tYear && Array.from(reqText.matchAll(/\b(19\d{2}|20\d{2})\b/g)).some(m => Number(m[1]) > tYear + 5));

      if (!reqAsksAlt) {
        const candMeta = `${candTrack || ''} ${candAlbum || ''}`;
        const candNonTitle = `${cand.version || ''} ${candAlbum || ''}`;
        const hasReRecordOrAnniv = /\b(re-?record\w*|unplugged|anniversary)\b/i.test(candMeta);
        const reqBaseHasLive = /\blive\b/i.test(req.base || '');
        const reqBaseHasAcoustic = /\bacoustic\b/i.test(req.base || '');
        const hasLiveOrAcoustic =
          (!reqBaseHasLive && /\blive\b/i.test(candMeta)) ||
          (reqBaseHasLive && /\blive\b/i.test(candNonTitle)) ||
          (!reqBaseHasAcoustic && /\bacoustic\b/i.test(candMeta)) ||
          (reqBaseHasAcoustic && /\bacoustic\b/i.test(candNonTitle));

        let hasLaterParenYear = false;
        if (tYear) {
          const parenGroups = candMeta.match(/[\(\[]([^\)\]]+)[\)\]]/g) || [];
          for (const g of parenGroups) {
            const inner = g.slice(1, -1);
            const isStandardRemasterOnOrigAlb = /\bremaster\w*\b/i.test(inner) && albSim >= 0.65;
            if (isStandardRemasterOnOrigAlb) continue;
            const yrs = Array.from(inner.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map(m => Number(m[1]));
            if (yrs.some(y => y > tYear + 5)) {
              hasLaterParenYear = true;
              break;
            }
          }
        }

        if (hasReRecordOrAnniv || hasLiveOrAcoustic || hasLaterParenYear) {
          adj -= 0.26;
        }
      }
      return adj;
    };

    if (strictTrack && req.base) {
      if (tSimBase < 0.45) return { score: -1, versionMatched: false, safeAlt: false };
      if (!isVarious && aSim < 0.35) return { score: -1, versionMatched: false, safeAlt: false };

      let score = tSimBase * 0.50 + aSim * 0.25 + albSim * 0.18;
      let versionMatched = !req.version;

      if (req.version) {
        const reqV = CC.normFull(req.version);
        const candFull = CC.normFull(candTrack || '');
        const candV = CC.normFull(cand.version || '');
        const vSim = Math.max(CC.simFull(req.version, cand.version || ''), CC.simFull(req.version, candTrack || ''));
        const stop = new Set(['mix', 'remix', 'version', 'edit', 'the', 'and', 'original', 'single']);
        const reqDistinct = reqV.split(' ').filter(w => w.length > 2 && !stop.has(w));
        const distinctHits = reqDistinct.filter(w => candFull.includes(w)).length;
        const distinctRatio = reqDistinct.length ? (distinctHits / reqDistinct.length) : vSim;
        const isLenientEdit = /^(radio(\s+edit|\s+version|\s+mix)?|single(\s+version|\s+edit)?|edit|album(\s+version)?|original(\s+version|\s+mix)?)$/i.test(reqV);
        const candIsNonStudio = /remix|line dance|dub|club|extended|karaoke|instrumental/i.test(candV || '');

        if (distinctRatio >= 0.5 || vSim >= 0.55) {
          score += 0.45 + distinctRatio * 0.25;
          versionMatched = true;
        } else if (isLenientEdit && !candIsNonStudio) {
          score += 0.30;
          versionMatched = true;
        } else if (candV && /remix|mix|line dance|dub|club|extended|karaoke/i.test(candV)) {
          score -= 0.25;
        }
      } else {
        if (cand.version && /remix|line dance|dub|club mix|extended|karaoke|instrumental/i.test(cand.version)) score -= 0.22;
        else score += 0.12;
      }
      score = applyEraAndAltAdjustments(score);
      const safeAlt = tSimBase >= 0.55 && (isVarious || aSim >= 0.45);
      return { score, versionMatched, safeAlt };
    }

    if (!isVarious && aSim < 0.45) return { score: -1, versionMatched: false, safeAlt: false };
    if (targetAlbum && albSim < 0.35) return { score: -1, versionMatched: false, safeAlt: false };
    return { score: applyEraAndAltAdjustments(aSim * 0.55 + albSim * 0.45), versionMatched: true, safeAlt: false };
  }

  async function queryApple(term, artist, rawTrack, album, strictTrack, targetYear = null) {
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=25`);
      if (!res.ok) return null;
      const data = await res.json();
      const items = (data.results || []).filter(r => r.previewUrl || r.trackViewUrl);
      if (!items.length) return null;
      const best = items
        .map(r => {
          const candYear = extractYear4(r.releaseDate);
          const ev = scoreAudioCandidate(r.artistName, r.trackName, r.collectionName, artist, rawTrack, album, strictTrack, targetYear, candYear);
          return { r, score: ev.score, versionMatched: ev.versionMatched, safeAlt: Boolean(ev.safeAlt) };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      if (!best) return null;
      return {
        previewUrl: best.r.previewUrl || '',
        externalUrl: best.r.trackViewUrl || '',
        trackName: best.r.trackName,
        artistName: best.r.artistName,
        score: best.score,
        exactVersion: best.versionMatched,
        safeAlt: best.safeAlt
      };
    } catch (_) { return null; }
  }

  function queryDeezerJSONP(query, artist, rawTrack, album, strictTrack, targetYear = null) {
    return new Promise((resolve) => {
      const cbName = '_dzcb_' + Math.random().toString(36).slice(2, 9);
      const script = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); resolve(null); }, 4500);
      function cleanup() { clearTimeout(timer); delete window[cbName]; if (script.parentNode) script.parentNode.removeChild(script); }

      window[cbName] = (payload) => {
        cleanup();
        const list = (payload?.data || []).filter(x => x.preview || x.link);
        if (!list.length) { resolve(null); return; }
        const best = list
          .map(x => {
            const candYear = extractYear4(x.album?.release_date || x.release_date);
            const ev = scoreAudioCandidate(x.artist?.name, x.title, x.album?.title, artist, rawTrack, album, strictTrack, targetYear, candYear);
            return { x, score: ev.score, versionMatched: ev.versionMatched, safeAlt: Boolean(ev.safeAlt) };
          })
          .filter(y => y.score > 0)
          .sort((a, b) => b.score - a.score)[0];
        if (best) {
          resolve({
            previewUrl: best.x.preview || '',
            externalUrl: best.x.link || '',
            trackName: best.x.title,
            artistName: best.x.artist?.name || artist,
            score: best.score,
            exactVersion: best.versionMatched,
            safeAlt: best.safeAlt
          });
        } else resolve(null);
      };

      script.onerror = () => { cleanup(); resolve(null); };
      script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=20&output=jsonp&callback=${cbName}`;
      document.body.appendChild(script);
    });
  }

  async function querySpotifyExact(query, artist, rawTrack, album, strictTrack, targetYear = null) {
    if (!CC.cfg.spotifyAccessToken && !CC.cfg.spotifyRefreshToken) return null;
    try {
      const d = await spFetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`);
      const list = d?.tracks?.items || [];
      if (!list.length) return null;
      const best = list
        .map(x => {
          const aName = (x.artists || []).map(a => a.name).join(', ');
          const candYear = extractYear4(x.album?.release_date);
          const ev = scoreAudioCandidate(aName, x.name, x.album?.name, artist, rawTrack, album, strictTrack, targetYear, candYear);
          return { x, aName, score: ev.score, versionMatched: ev.versionMatched };
        })
        .filter(y => y.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      if (!best) return null;
      return {
        externalUrl: best.x.external_urls?.spotify || '',
        trackName: best.x.name,
        artistName: best.aName,
        score: best.score,
        exactVersion: best.versionMatched
      };
    } catch (_) { return null; }
  }

  CC.fetchAudioAndPlatforms = async (artist, track, album, strictTrack = true, targetYear = null) => {
    const isVarious = !artist || /^various(\s+artists)?$/i.test(artist.trim());
    const rawTrack = String(track || '').trim();
    const { base, version } = splitTrackVersion(rawTrack);
    const prefix = isVarious ? '' : `${artist} `;

    const primaryQ = (base && version) ? `${prefix}${base} ${version}`.trim()
      : (base ? `${prefix}${base}`.trim() : `${prefix}${album}`.trim());
    const baseQ = base ? `${prefix}${base}`.trim() : primaryQ;
    const foldedBaseQ = CC.foldText(baseQ).trim();
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(primaryQ)}`;

    const pickBetter = (cur, next) => (!cur || (next && ((next.exactVersion && !cur.exactVersion) || (next.exactVersion === cur.exactVersion && next.score > cur.score)))) ? next : cur;

    const [ap1, dz1, sp1] = await Promise.all([
      queryApple(primaryQ, artist, rawTrack, album, strictTrack, targetYear),
      queryDeezerJSONP(primaryQ, artist, rawTrack, album, strictTrack, targetYear),
      CC.cfg.showSpotify ? querySpotifyExact(primaryQ, artist, rawTrack, album, strictTrack, targetYear) : Promise.resolve(null)
    ]);

    let apBest = ap1, dzBest = dz1, spBest = sp1;

    // Fallback 1: parentheticals/brackets stripped (baseQ) across ALL enabled services lacking an exact match
    if (baseQ && baseQ !== primaryQ && (!apBest?.exactVersion || !dzBest?.exactVersion || (CC.cfg.showSpotify && !spBest?.exactVersion))) {
      const [ap2, dz2, sp2] = await Promise.all([
        !apBest?.exactVersion ? queryApple(baseQ, artist, rawTrack, album, strictTrack, targetYear) : Promise.resolve(null),
        !dzBest?.exactVersion ? queryDeezerJSONP(baseQ, artist, rawTrack, album, strictTrack, targetYear) : Promise.resolve(null),
        (CC.cfg.showSpotify && !spBest?.exactVersion) ? querySpotifyExact(baseQ, artist, rawTrack, album, strictTrack, targetYear) : Promise.resolve(null)
      ]);
      apBest = pickBetter(apBest, ap2);
      dzBest = pickBetter(dzBest, dz2);
      spBest = pickBetter(spBest, sp2);
    }

    // Fallback 2: ASCII-folded query (e.g., Turkish/accented titles) across ALL enabled services lacking an exact match
    if (foldedBaseQ && foldedBaseQ !== baseQ && foldedBaseQ !== primaryQ && (!apBest?.exactVersion || !dzBest?.exactVersion || (CC.cfg.showSpotify && !spBest?.exactVersion))) {
      const [ap3, dz3, sp3] = await Promise.all([
        !apBest?.exactVersion ? queryApple(foldedBaseQ, artist, rawTrack, album, strictTrack, targetYear) : Promise.resolve(null),
        !dzBest?.exactVersion ? queryDeezerJSONP(foldedBaseQ, artist, rawTrack, album, strictTrack, targetYear) : Promise.resolve(null),
        (CC.cfg.showSpotify && !spBest?.exactVersion) ? querySpotifyExact(foldedBaseQ, artist, rawTrack, album, strictTrack, targetYear) : Promise.resolve(null)
      ]);
      apBest = pickBetter(apBest, ap3);
      dzBest = pickBetter(dzBest, dz3);
      spBest = pickBetter(spBest, sp3);
    }

    const streamCandidates = [apBest, dzBest].filter(x => x && x.previewUrl);
    const exactStream = streamCandidates.filter(x => x.exactVersion).sort((a, b) => b.score - a.score)[0] || null;
    const altStream = !exactStream ? (streamCandidates.sort((a, b) => b.score - a.score)[0] || null) : null;

    return {
      clip: exactStream,
      fallbackClip: altStream,
      requestedVersion: version || '',
      platforms: {
        spotify: spBest?.externalUrl ? { url: spBest.externalUrl, label: `Spotify${spBest.exactVersion === false ? ' (closest)' : ''}` } : null,
        apple: apBest?.externalUrl ? { url: apBest.externalUrl, label: `Apple Music${apBest.exactVersion === false ? ' (closest)' : ''}` } : null,
        deezer: dzBest?.externalUrl ? { url: dzBest.externalUrl, label: `Deezer${dzBest.exactVersion === false ? ' (closest)' : ''}` } : null,
        youtube: { url: ytUrl, label: 'YouTube' }
      }
    };
  };

  // ==================== SPOTIFY PKCE OAUTH & 100% FULL LIBRARY SYNC ====================
  let activeSpCtrl = null;

  CC.cancelSpotifySync = () => {
    if (activeSpCtrl) {
      try { activeSpCtrl.abort(); } catch (_) {}
      activeSpCtrl = null;
    }
  };

  function randomStr(len) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, x => chars[x % chars.length]).join('');
  }

  async function sha256B64(plain) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
    return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  CC.refreshSpotifyToken = async () => {
    if (!CC.cfg.spotifyRefreshToken || !CC.cfg.spotifyClientId) return false;
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CC.cfg.spotifyClientId.trim(),
          grant_type: 'refresh_token',
          refresh_token: CC.cfg.spotifyRefreshToken
        })
      });
      if (!res.ok) return false;
      const tok = await res.json();
      CC.cfg.spotifyAccessToken = tok.access_token;
      if (tok.refresh_token) CC.cfg.spotifyRefreshToken = tok.refresh_token;
      CC.cfg.spotifyExpiresAt = Date.now() + (tok.expires_in - 60) * 1000;
      CC.persistCfg();
      return true;
    } catch (_) { return false; }
  };

  async function spFetch(url, signal = null, attempt = 0) {
    if (signal?.aborted) throw new DOMException('Cancelled by user', 'AbortError');
    if (Date.now() > CC.cfg.spotifyExpiresAt && CC.cfg.spotifyRefreshToken) await CC.refreshSpotifyToken();
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + CC.cfg.spotifyAccessToken },
      ...(signal ? { signal } : {})
    });
    if (res.status === 429) {
      const nextAttempt = attempt + 1;
      const headerWaitSec = Number(res.headers.get('Retry-After')) || 0;
      const waitSec = Math.max(headerWaitSec, Math.min(60, 5 * Math.pow(2, nextAttempt - 1)));
      for (let rem = Math.ceil(waitSec); rem > 0; rem--) {
        if (signal?.aborted) throw new DOMException('Cancelled by user', 'AbortError');
        statusCb(`Spotify rate limit — resuming in ${rem}s (retry #${nextAttempt})...`, true, { cancellable: true });
        await CC.sleep(1000, signal);
      }
      return spFetch(url, signal, nextAttempt);
    }
    if (!res.ok) throw new Error(`Spotify HTTP ${res.status}`);
    return res.json();
  }

  CC.beginSpotifyRedirect = async () => {
    const verifier = randomStr(64);
    const state = randomStr(16);
    const challenge = await sha256B64(verifier);
    localStorage.setItem('sp_pkce_verifier', verifier);
    localStorage.setItem('sp_pkce_state', state);
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.set('client_id', CC.cfg.spotifyClientId.trim());
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', CC.REDIRECT_URI);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('scope', 'user-library-read user-top-read playlist-read-private playlist-read-collaborative user-read-private');
    authUrl.searchParams.set('state', state);
    location.href = authUrl.toString();
  };

  CC.exchangeSpotifyCode = async (code, state) => {
    const savedState = localStorage.getItem('sp_pkce_state');
    const verifier = localStorage.getItem('sp_pkce_verifier');
    if (!verifier || state !== savedState) throw new Error('Spotify state mismatch — try connecting again');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CC.cfg.spotifyClientId.trim(),
        grant_type: 'authorization_code',
        code,
        redirect_uri: CC.REDIRECT_URI,
        code_verifier: verifier
      })
    });
    const tok = await res.json();
    if (!res.ok) throw new Error(tok.error_description || tok.error || 'Token exchange failed');
    CC.cfg.spotifyAccessToken = tok.access_token;
    if (tok.refresh_token) CC.cfg.spotifyRefreshToken = tok.refresh_token;
    CC.cfg.spotifyExpiresAt = Date.now() + (tok.expires_in - 60) * 1000;
    CC.persistCfg();
  };

  CC.syncSpotifyAll = async (existingDna = '', existingSoftSpots = '') => {
    CC.cancelSpotifySync();
    const ctrl = new AbortController();
    activeSpCtrl = ctrl;
    const signal = ctrl.signal;
    const SP_GAP_MS = 350;

    const spFetchSafe = async (url) => {
      try {
        return await spFetch(url, signal);
      } catch (err) {
        if (err.name === 'AbortError' || signal.aborted) throw err;
        return { items: [], next: null };
      }
    };

    statusCb('Starting complete Spotify library sync...', true, { cancellable: true });
    const artistMap = {};
    const trackPairs = new Set();
    const trackTitles = new Set();
    const trackSourcesMap = {};
    const decades = {};
    const playlistSummaries = [];

    const normArtistBase = (name) => CC.norm(name).replace(/^the\s+/, '').trim();

    const ensureArtist = (name) => {
      const n = CC.norm(name);
      if (!n) return null;
      if (!artistMap[n]) {
        artistMap[n] = {
          name,
          count: 0,
          isTopArtist: false,
          tracks: new Set(),
          likedTracks: new Set(),
          topTracks: new Set(),
          albumTracks: new Set(),
          playlistTracks: new Set(),
          playlists: new Set()
        };
      }
      return artistMap[n];
    };

    const ensureTrackSource = (artistName, trackTitle) => {
      const na = normArtistBase(artistName);
      const nt = CC.norm(trackTitle);
      if (!na || !nt) return null;
      const key = `${na}|${nt}`;
      if (!trackSourcesMap[key]) {
        trackSourcesMap[key] = { liked: false, top: false, album: false, playlists: new Set() };
      }
      return trackSourcesMap[key];
    };

    const addDecade = (dateStr) => {
      const m = String(dateStr || '').match(/^(\d{4})/);
      if (!m) return;
      const dec = `${Math.floor(Number(m[1]) / 10) * 10}s`;
      decades[dec] = (decades[dec] || 0) + 1;
    };

    const addTrack = (tr, sourceType = 'playlist', weight = 1, playlistName = '') => {
      if (!tr || !tr.name) return;
      const cleanTitle = tr.name.trim();
      const nt = CC.norm(cleanTitle);
      if (nt) trackTitles.add(nt);
      if (tr.album?.release_date) addDecade(tr.album.release_date);
      (tr.artists || []).forEach(a => {
        const rec = ensureArtist(a.name);
        if (!rec) return;
        rec.count += weight;
        rec.tracks.add(cleanTitle);
        if (sourceType === 'liked') rec.likedTracks.add(cleanTitle);
        else if (sourceType === 'top') rec.topTracks.add(cleanTitle);
        else if (sourceType === 'album') rec.albumTracks.add(cleanTitle);
        else if (sourceType === 'playlist') {
          rec.playlistTracks.add(cleanTitle);
          if (playlistName) rec.playlists.add(playlistName);
        }

        const na = CC.norm(a.name);
        if (na && nt) trackPairs.add(`${na}|${nt}`);
        const srcRec = ensureTrackSource(a.name, cleanTitle);
        if (srcRec) {
          if (sourceType === 'liked') srcRec.liked = true;
          else if (sourceType === 'top') srcRec.top = true;
          else if (sourceType === 'album') srcRec.album = true;
          else if (sourceType === 'playlist' && playlistName) srcRec.playlists.add(playlistName);
        }
      });
    };

    try {
      const me = await spFetch('https://api.spotify.com/v1/me', signal);

      for (const range of ['long_term', 'medium_term', 'short_term']) {
        statusCb(`Syncing Top Artists & Tracks (${range})...`, true, { cancellable: true });
        await CC.sleep(SP_GAP_MS, signal);
        const topA = await spFetchSafe(`https://api.spotify.com/v1/me/top/artists?limit=50&time_range=${range}`);
        (topA.items || []).forEach((a, i) => {
          const rec = ensureArtist(a.name);
          if (rec) {
            rec.isTopArtist = true;
            rec.count += Math.max(8, 26 - Math.floor(i / 2));
          }
        });
        await CC.sleep(SP_GAP_MS, signal);
        const topT = await spFetchSafe(`https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=${range}`);
        (topT.items || []).forEach(t => addTrack(t, 'top', 6));
      }

      let next = 'https://api.spotify.com/v1/me/tracks?limit=50';
      let count = 0;
      while (next) {
        statusCb(`Syncing Liked Songs (${count} scanned)...`, true, { cancellable: true });
        await CC.sleep(SP_GAP_MS, signal);
        const d = await spFetch(next, signal);
        (d.items || []).forEach(it => addTrack(it.track, 'liked', 5));
        count += (d.items || []).length;
        next = d.next;
      }

      next = 'https://api.spotify.com/v1/me/albums?limit=50';
      count = 0;
      while (next) {
        statusCb(`Syncing Saved Albums (${count} scanned)...`, true, { cancellable: true });
        await CC.sleep(SP_GAP_MS, signal);
        const d = await spFetchSafe(next);
        (d.items || []).forEach(it => {
          if (it.album?.release_date) addDecade(it.album.release_date);
          (it.album?.artists || []).forEach(a => {
            const rec = ensureArtist(a.name);
            if (rec) rec.count += 4;
          });
          (it.album?.tracks?.items || []).forEach(t => addTrack(t, 'album', 3));
        });
        count += (d.items || []).length;
        next = d.next;
      }

      const owned = [];
      const seenPlaylistIds = new Set();
      let plUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';
      while (plUrl) {
        statusCb(`Finding your playlists (${owned.length} non-empty)...`, true, { cancellable: true });
        await CC.sleep(SP_GAP_MS, signal);
        const pls = await spFetchSafe(plUrl);
        (pls.items || []).forEach(p => {
          if (!p || !p.id || seenPlaylistIds.has(p.id)) return;
          if (!(p.owner?.id === me.id || p.collaborative)) return;
          seenPlaylistIds.add(p.id);
          const reportedTotal = p.tracks?.total ?? p.items?.total;
          if (reportedTotal === 0) return; // skip 0-track playlists
          owned.push(p);
        });
        plUrl = pls.next;
      }

      for (let i = 0; i < owned.length; i++) {
        const pl = owned[i];
        let pNext = `https://api.spotify.com/v1/playlists/${pl.id}/items?limit=50`;
        let pTracks = 0;
        while (pNext) {
          statusCb(`Playlist ${i + 1}/${owned.length}: ${pl.name} (${pTracks} songs)...`, true, { cancellable: true });
          await CC.sleep(SP_GAP_MS, signal);
          const pd = await spFetchSafe(pNext);
          (pd.items || []).forEach(e => addTrack(e.item || e.track, 'playlist', 1, pl.name));
          pTracks += (pd.items || []).length;
          pNext = pd.next;
        }
        if (pTracks > 0) playlistSummaries.push({ name: pl.name, count: pTracks });
      }

      const allArtists = {};
      Object.entries(artistMap).forEach(([k, v]) => {
        allArtists[k] = {
          name: v.name,
          count: v.count,
          isTopArtist: Boolean(v.isTopArtist),
          tracks: Array.from(v.tracks),
          likedTracks: Array.from(v.likedTracks),
          topTracks: Array.from(v.topTracks),
          albumTracks: Array.from(v.albumTracks),
          playlistTracks: Array.from(v.playlistTracks),
          playlists: Array.from(v.playlists)
        };
      });

      const trackSources = {};
      Object.entries(trackSourcesMap).forEach(([k, v]) => {
        trackSources[k] = {
          liked: Boolean(v.liked),
          top: Boolean(v.top),
          album: Boolean(v.album),
          playlists: Array.from(v.playlists)
        };
      });

      const topArtists = Object.values(allArtists).sort((a, b) => b.count - a.count).map(x => x.name);

      return {
        provenanceVersion: 2,
        syncedAt: Date.now(),
        userDisplayName: me.display_name || me.id,
        topArtists,
        allArtists,
        trackSources,
        trackPairs: Array.from(trackPairs),
        trackTitles: Array.from(trackTitles),
        playlistSummaries,
        decades,
        totalTracks: trackPairs.size || trackTitles.size,
        totalArtists: Object.keys(allArtists).length,
        totalPlaylists: owned.length,
        tasteDna: existingDna || '',
        softSpots: existingSoftSpots || '',
        dnaUpdatedAt: existingDna ? Date.now() : 0
      };
    } finally {
      if (activeSpCtrl === ctrl) activeSpCtrl = null;
    }
  };

  CC.parseCSV = (text) => {
    const out = [];
    let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], next = text[i + 1];
      if (inQ) {
        if (c === '"' && next === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && next === '\n') i++;
          row.push(cur);
          if (row.some(x => x !== '')) out.push(row);
          row = []; cur = '';
        } else cur += c;
      }
    }
    if (cur || row.length) { row.push(cur); out.push(row); }
    return out;
  };

  // ==================== GOOGLE DRIVE APPDATAFOLDER CLOUD SYNC ====================
  const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const GDRIVE_STATE_FILENAME = 'softspot_state.json';
  const GDRIVE_LEGACY_STATE_FILENAME = 'cratecheck_state.json';
  const GDRIVE_SESSION_KEY = 'cratecheck_gdrive_sess_v1';
  const GDRIVE_DELTA_RX = /^delta_\d+_[a-z0-9]+\.json$/i;

  let gToken = '';
  let gTokenExp = 0;
  try {
    const savedSess = JSON.parse(sessionStorage.getItem(GDRIVE_SESSION_KEY) || 'null');
    if (savedSess?.token && savedSess.exp > Date.now() + 20000) {
      gToken = savedSess.token;
      gTokenExp = savedSess.exp;
    }
  } catch (_) {}

  CC.getPendingCloudChanges = () => {
    try { return Math.max(0, Number(localStorage.getItem(CC.CLOUD_DIRTY_KEY) || 0) || 0); }
    catch (_) { return 0; }
  };

  CC.setPendingCloudChanges = (count) => {
    try { localStorage.setItem(CC.CLOUD_DIRTY_KEY, String(Math.max(0, Math.floor(Number(count) || 0)))); }
    catch (_) {}
  };

  CC.recordLocalCloudChange = async (syncId = null, isDelete = false) => {
    const nextCount = CC.getPendingCloudChanges() + 1;
    CC.setPendingCloudChanges(nextCount);
    if (syncId) {
      try {
        const rec = (await CC.idbGet('meta', 'cloud_dirty_batch'))?.value || { modified: [], deleted: {} };
        const modSet = new Set(Array.isArray(rec.modified) ? rec.modified : []);
        const delMap = Object.assign({}, rec.deleted || {});
        if (isDelete) {
          modSet.delete(syncId);
          delMap[syncId] = Date.now();
        } else {
          modSet.add(syncId);
          delete delMap[syncId];
        }
        await CC.idbPut('meta', {
          key: 'cloud_dirty_batch',
          value: { modified: Array.from(modSet), deleted: delMap }
        });
      } catch (_) {}
    }
    return nextCount;
  };

  CC.isGoogleSignedIn = () => Boolean(gToken && Date.now() < gTokenExp - 15000);

  CC.getGoogleClientId = () => (CC.cfg.googleClientId || CC.DEFAULT_GOOGLE_CLIENT_ID || '').trim();

  CC.requestGoogleAccessToken = (promptMode = '') => new Promise((resolve, reject) => {
    const clientId = CC.getGoogleClientId();
    if (!clientId) {
      reject(new Error('Google OAuth Client ID is missing — check Settings → 1. Google Drive Cloud Sync'));
      return;
    }
    if (!window.google?.accounts?.oauth2?.initTokenClient) {
      reject(new Error('Google Sign-In library is still loading or unavailable offline'));
      return;
    }
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GDRIVE_SCOPE,
        callback: (resp) => {
          if (!resp || resp.error || !resp.access_token) {
            reject(new Error(resp?.error_description || resp?.error || 'Google sign-in cancelled'));
            return;
          }
          gToken = resp.access_token;
          gTokenExp = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
          try {
            sessionStorage.setItem(GDRIVE_SESSION_KEY, JSON.stringify({ token: gToken, exp: gTokenExp }));
          } catch (_) {}
          resolve(gToken);
        },
        error_callback: (err) => {
          reject(new Error(err?.message || err?.type || 'Google sign-in popup blocked or closed'));
        }
      });
      const reqOpts = { prompt: promptMode };
      if (CC.cfg.googleEmail) reqOpts.hint = CC.cfg.googleEmail;
      client.requestAccessToken(reqOpts);
    } catch (err) {
      reject(err);
    }
  });

  CC.signOutGoogle = () => {
    const tok = gToken;
    gToken = '';
    gTokenExp = 0;
    try { sessionStorage.removeItem(GDRIVE_SESSION_KEY); } catch (_) {}
    CC.cfg.googleEmail = '';
    CC.persistCfg();
    try {
      if (tok && window.google?.accounts?.oauth2?.revoke) {
        window.google.accounts.oauth2.revoke(tok, () => {});
      }
    } catch (_) {}
  };

  CC.hashDataUrlToFilename = async (dataUrl) => {
    const str = String(dataUrl || '');
    try {
      if (window.crypto?.subtle) {
        const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
        return `img_${hex.slice(0, 16)}.webp`;
      }
    } catch (_) {}
    let h1 = 0xdeadbeef ^ str.length;
    let h2 = 0x41c6ce57 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    const hex = ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).slice(0, 16);
    return `img_${hex}.webp`;
  };

  function dataUrlToBlob(dataUrl) {
    const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1];
    const bin = atob(m[2]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error || new Error('Failed to decode Drive image'));
      r.readAsDataURL(blob);
    });
  }

  async function gdriveFetch(url, opts = {}) {
    if (!CC.isGoogleSignedIn()) throw new Error('Not signed in to Google Drive');
    const headers = Object.assign({}, opts.headers || {}, { Authorization: `Bearer ${gToken}` });
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      gToken = '';
      gTokenExp = 0;
      try { sessionStorage.removeItem(GDRIVE_SESSION_KEY); } catch (_) {}
      throw new Error('Google session expired — tap Sign in with Google & Sync');
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Google Drive HTTP ${res.status}: ${txt.slice(0, 140)}`);
    }
    return res;
  }

  async function listAppDataFiles() {
    const map = new Map();
    const deltaFiles = [];
    let pageToken = '';
    while (true) {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('spaces', 'appDataFolder');
      url.searchParams.set('fields', 'nextPageToken,files(id,name,modifiedTime)');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await gdriveFetch(url.toString());
      const data = await res.json();
      (data.files || []).forEach(f => {
        if (!f?.name) return;
        if (GDRIVE_DELTA_RX.test(f.name)) {
          deltaFiles.push(f);
        }
        const prev = map.get(f.name);
        if (!prev || String(f.modifiedTime || '') > String(prev.modifiedTime || '')) {
          map.set(f.name, f);
        }
      });
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return { map, deltaFiles };
  }

  async function deleteAppDataFileSafe(fileId) {
    if (!fileId) return;
    try {
      await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    } catch (_) {}
  }

  async function uploadAppDataMultipart(name, contentBlob, mimeType, existingFileId = null) {
    const boundary = 'ss_sync_' + Math.random().toString(36).slice(2, 12);
    const meta = existingFileId ? { name } : { name, parents: ['appDataFolder'] };
    const head =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = new Blob([head, contentBlob, tail], { type: `multipart/related; boundary=${boundary}` });

    const endpoint = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    const res = await gdriveFetch(endpoint, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    return res.json();
  }

  CC.syncWithGoogleDrive = async (opts = {}) => {
    const { interactive = false, quiet = false } = opts;
    if (!CC.isGoogleSignedIn()) {
      if (!interactive) throw new Error('Google Drive session expired');
      await CC.requestGoogleAccessToken('');
    }

    const report = (msg) => { if (!quiet) statusCb(msg, true); };

    // Fetch user email cleanly via Drive about endpoint (works within drive.appdata scope)
    try {
      const aboutRes = await gdriveFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)');
      const about = await aboutRes.json();
      if (about?.user?.emailAddress) {
        CC.cfg.googleEmail = about.user.emailAddress;
        CC.persistCfg();
      }
    } catch (_) {}

    report('☁️ Listing Google Drive appDataFolder...');
    const { map: fileMap, deltaFiles } = await listAppDataFiles();

    // 1. Load local state from IndexedDB
    const rawLocalStash = await CC.idbGetAll('stash');
    for (const it of rawLocalStash) {
      if (!it.sync_id) {
        it.sync_id = CC.generateSyncId();
        await CC.idbPut('stash', it);
      }
    }
    const localBySync = new Map();
    rawLocalStash.forEach(it => localBySync.set(it.sync_id, it));

    const localDeletedRec = await CC.idbGet('meta', 'deleted_sync_ids');
    const localDeleted = Object.assign({}, localDeletedRec?.value || {});
    const localSpotify = (await CC.idbGet('meta', 'spotify_profile'))?.value || null;
    const localDiscogsIdx = (await CC.idbGet('meta', 'discogs_collection_index'))?.value || null;
    const localDirtyBatch = (await CC.idbGet('meta', 'cloud_dirty_batch'))?.value || { modified: [], deleted: {} };

    let uploadedPhotos = 0;
    let downloadedPhotos = 0;
    const downloadedCache = new Map();
    const uploadedSet = new Set();

    const processImageField = async (val) => {
      const s = String(val || '');
      if (!s) return { localVal: '', remoteVal: '' };

      if (s.startsWith('data:image/')) {
        const fname = await CC.hashDataUrlToFilename(s);
        if (!fileMap.has(fname) && !uploadedSet.has(fname)) {
          const blob = dataUrlToBlob(s);
          if (blob) {
            report(`☁️ Uploading photo ${uploadedPhotos + 1}...`);
            const created = await uploadAppDataMultipart(fname, blob, blob.type || 'image/webp', null);
            fileMap.set(fname, { id: created.id, name: fname });
            uploadedSet.add(fname);
            uploadedPhotos++;
          }
        }
        return { localVal: s, remoteVal: `gdrive:${fname}` };
      }

      if (s.startsWith('gdrive:')) {
        const fname = s.slice(7);
        if (downloadedCache.has(fname)) {
          return { localVal: downloadedCache.get(fname), remoteVal: s };
        }
        const fInfo = fileMap.get(fname);
        if (fInfo?.id) {
          report(`☁️ Downloading photo ${downloadedPhotos + 1}...`);
          const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fInfo.id)}?alt=media`);
          const blob = await res.blob();
          const dataUrl = await blobToDataUrl(blob);
          downloadedCache.set(fname, dataUrl);
          downloadedPhotos++;
          return { localVal: dataUrl, remoteVal: s };
        }
        return { localVal: '', remoteVal: s };
      }

      return { localVal: s, remoteVal: s };
    };

    const dehydrateItemForRemote = async (item) => {
      const remoteItem = { ...item };
      delete remoteItem.id;
      if (Array.isArray(item.thumbs)) {
        const remThumbs = [];
        for (const t of item.thumbs) {
          const r = await processImageField(t);
          if (r.remoteVal) remThumbs.push(r.remoteVal);
        }
        remoteItem.thumbs = remThumbs;
      }
      if (item.thumb_data_url) {
        const r = await processImageField(item.thumb_data_url);
        remoteItem.thumb_data_url = r.remoteVal || remoteItem.thumbs?.[0] || remoteItem.discogs_thumb || '';
      }
      if (item.spine_thumb_url) {
        const r = await processImageField(item.spine_thumb_url);
        remoteItem.spine_thumb_url = r.remoteVal;
      }
      return remoteItem;
    };

    // 2. Collision-safe delta write: upload our local dirty batch as a uniquely named delta file
    //    BEFORE overwriting softspot_state.json so concurrent offline edits on another device can never erase ours.
    let ownDeltaFileId = null;
    const dirtyModIds = Array.isArray(localDirtyBatch.modified) ? localDirtyBatch.modified : [];
    const dirtyDelMap = Object.assign({}, localDirtyBatch.deleted || {});
    if (dirtyModIds.length > 0 || Object.keys(dirtyDelMap).length > 0) {
      const deltaItems = [];
      for (const sid of dirtyModIds) {
        const loc = localBySync.get(sid);
        if (loc) deltaItems.push(await dehydrateItemForRemote(loc));
      }
      if (deltaItems.length > 0 || Object.keys(dirtyDelMap).length > 0) {
        report('☁️ Writing collision-safe sync delta...');
        const deltaName = `delta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
        const deltaBlob = new Blob([JSON.stringify({
          version: 10,
          createdAt: Date.now(),
          items: deltaItems,
          deleted_sync_ids: dirtyDelMap
        })], { type: 'application/json' });
        const createdDelta = await uploadAppDataMultipart(deltaName, deltaBlob, 'application/json', null);
        ownDeltaFileId = createdDelta?.id || null;
      }
    }

    // 3. Download existing softspot_state.json (automatically falling back to legacy cratecheck_state.json)
    const primaryStateFile = fileMap.get(GDRIVE_STATE_FILENAME) || null;
    const legacyStateFile = !primaryStateFile ? (fileMap.get(GDRIVE_LEGACY_STATE_FILENAME) || null) : null;
    const readStateFile = primaryStateFile || legacyStateFile;
    let remoteState = null;
    if (readStateFile?.id) {
      report('☁️ Downloading cloud snapshot...');
      const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(readStateFile.id)}?alt=media`);
      try { remoteState = await res.json(); } catch (_) { remoteState = null; }
    }

    // 4. Download & fold ALL pending delta_*.json files from appDataFolder into the remote state
    const remoteBySync = new Map();
    (remoteState?.stash || []).forEach(it => {
      if (it?.sync_id) remoteBySync.set(it.sync_id, it);
    });
    const remoteDeleted = Object.assign({}, remoteState?.deleted_sync_ids || {});
    const mergedDeltaFileIds = [];

    for (const df of deltaFiles) {
      if (!df?.id || df.id === ownDeltaFileId) continue;
      try {
        report(`☁️ Merging remote delta (${mergedDeltaFileIds.length + 1}/${deltaFiles.length})...`);
        const dRes = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(df.id)}?alt=media`);
        const dJson = await dRes.json();
        (dJson?.items || []).forEach(it => {
          if (!it?.sync_id) return;
          const prev = remoteBySync.get(it.sync_id);
          const prevTs = prev ? Number(prev.updated_at || prev.created_at || 0) : -1;
          const nextTs = Number(it.updated_at || it.created_at || 0);
          if (!prev || nextTs >= prevTs) remoteBySync.set(it.sync_id, it);
        });
        Object.entries(dJson?.deleted_sync_ids || {}).forEach(([sid, ts]) => {
          const nTs = Number(ts) || 0;
          if (!remoteDeleted[sid] || nTs > remoteDeleted[sid]) remoteDeleted[sid] = nTs;
        });
        mergedDeltaFileIds.push(df.id);
      } catch (_) {}
    }

    // 5. Merge deleted_sync_ids tombstones
    const mergedDeleted = Object.assign({}, localDeleted);
    Object.entries(remoteDeleted).forEach(([sid, ts]) => {
      const nTs = Number(ts) || 0;
      if (!mergedDeleted[sid] || nTs > mergedDeleted[sid]) mergedDeleted[sid] = nTs;
    });

    // 6. Two-way merge Stash items by sync_id
    const allSyncIds = new Set([...localBySync.keys(), ...remoteBySync.keys()]);
    const mergedItems = [];
    const localIdsToDelete = [];

    for (const sid of allSyncIds) {
      const loc = localBySync.get(sid) || null;
      const rem = remoteBySync.get(sid) || null;
      const locTs = loc ? Number(loc.updated_at || loc.created_at || 0) : -1;
      const remTs = rem ? Number(rem.updated_at || rem.created_at || 0) : -1;
      const winner = locTs >= remTs ? { ...loc } : { ...rem };
      if (loc?.id !== undefined) winner.id = loc.id;
      else delete winner.id;

      const winTs = Number(winner.updated_at || winner.created_at || 0);
      const delTs = Number(mergedDeleted[sid] || 0);
      if (delTs > winTs) {
        if (loc?.id !== undefined) localIdsToDelete.push(loc.id);
        continue;
      }
      if (delTs && winTs >= delTs) {
        delete mergedDeleted[sid];
      }
      mergedItems.push(winner);
    }

    // 7. Hydrate local items & build lightweight remote items (gdrive:img_<hash>.webp refs)
    const hydratedForLocal = [];
    const lightweightForRemote = [];

    for (const item of mergedItems) {
      const localItem = { ...item };
      const remoteItem = { ...item };
      delete remoteItem.id;

      if (Array.isArray(item.thumbs)) {
        const locThumbs = [];
        const remThumbs = [];
        for (const t of item.thumbs) {
          const r = await processImageField(t);
          if (r.localVal) locThumbs.push(r.localVal);
          if (r.remoteVal) remThumbs.push(r.remoteVal);
        }
        localItem.thumbs = locThumbs;
        remoteItem.thumbs = remThumbs;
      }

      if (item.thumb_data_url) {
        const r = await processImageField(item.thumb_data_url);
        localItem.thumb_data_url = r.localVal || localItem.thumbs?.[0] || localItem.discogs_thumb || '';
        remoteItem.thumb_data_url = r.remoteVal || remoteItem.thumbs?.[0] || remoteItem.discogs_thumb || '';
      }

      if (item.spine_thumb_url) {
        const r = await processImageField(item.spine_thumb_url);
        localItem.spine_thumb_url = r.localVal;
        remoteItem.spine_thumb_url = r.remoteVal;
      }

      hydratedForLocal.push(localItem);
      lightweightForRemote.push(remoteItem);
    }

    // 8. Merge spotifyProfile & discogsCollectionIndex by latest timestamp
    const spTime = (p) => p ? Math.max(Number(p.syncedAt || 0), Number(p.dnaUpdatedAt || 0)) : 0;
    const remSpotify = remoteState?.spotifyProfile || null;
    let mergedSpotify = spTime(remSpotify) > spTime(localSpotify) ? remSpotify : localSpotify;
    if (localSpotify && remSpotify) {
      const baseSp = Number(remSpotify.syncedAt || 0) > Number(localSpotify.syncedAt || 0) ? { ...remSpotify } : { ...localSpotify };
      if (Number(localSpotify.dnaUpdatedAt || 0) >= Number(remSpotify.dnaUpdatedAt || 0)) {
        baseSp.tasteDna = localSpotify.tasteDna || '';
        baseSp.softSpots = localSpotify.softSpots || '';
        baseSp.dnaUpdatedAt = localSpotify.dnaUpdatedAt || 0;
      } else {
        baseSp.tasteDna = remSpotify.tasteDna || '';
        baseSp.softSpots = remSpotify.softSpots || '';
        baseSp.dnaUpdatedAt = remSpotify.dnaUpdatedAt || 0;
      }
      mergedSpotify = baseSp;
    }

    const remDiscogsIdx = remoteState?.discogsCollectionIndex || null;
    const mergedDiscogsIdx = Number(remDiscogsIdx?.syncedAt || 0) > Number(localDiscogsIdx?.syncedAt || 0)
      ? remDiscogsIdx
      : localDiscogsIdx;

    // 9. Merge preferences & optional secrets (NEVER sync spotifyRefreshToken/AccessToken/preferredCameraId)
    const PREF_KEYS = [
      'geminiModel', 'autoPlayHighlight', 'autoDetective', 'autoGradeOnScan',
      'homeCountry', 'fetchVgSuggestions', 'threshold', 'voice',
      'showSpotify', 'showApple', 'showDeezer', 'showYoutube'
    ];
    const SECRET_KEYS = [
      'geminiKey', 'discogsToken', 'discogsUser', 'discogsFolderId',
      'discogsFolders', 'discogsFields', 'spotifyClientId'
    ];

    const remPrefs = remoteState?.prefs || null;
    const remCfgTs = Number(remPrefs?.cfgUpdatedAt || 0);
    const locCfgTs = Number(CC.cfg.cfgUpdatedAt || 0);
    if (remPrefs) {
      if (remCfgTs > locCfgTs) {
        PREF_KEYS.forEach(k => { if (remPrefs[k] !== undefined) CC.cfg[k] = remPrefs[k]; });
        CC.cfg.cfgUpdatedAt = remCfgTs;
      }
      if (CC.cfg.googleSyncSecrets && remoteState?.secrets) {
        SECRET_KEYS.forEach(k => {
          const rVal = remoteState.secrets[k];
          const lVal = CC.cfg[k];
          const rEmpty = rVal === undefined || rVal === null || rVal === '';
          const lEmpty = lVal === undefined || lVal === null || lVal === '';
          if (!rEmpty && (lEmpty || remCfgTs > locCfgTs)) {
            CC.cfg[k] = rVal;
          }
        });
      }
    }

    const outPrefs = { cfgUpdatedAt: Number(CC.cfg.cfgUpdatedAt || Date.now()) };
    PREF_KEYS.forEach(k => { outPrefs[k] = CC.cfg[k]; });
    const outSecrets = CC.cfg.googleSyncSecrets ? {} : (remoteState?.secrets || null);
    if (CC.cfg.googleSyncSecrets) {
      SECRET_KEYS.forEach(k => { outSecrets[k] = CC.cfg[k]; });
    }

    // 10. Persist merged state back to local IndexedDB
    report('☁️ Updating local Stash...');
    for (const delId of localIdsToDelete) {
      await CC.idbDelete('stash', delId);
    }
    for (const item of hydratedForLocal) {
      await CC.idbPut('stash', item);
    }
    await CC.idbPut('meta', { key: 'deleted_sync_ids', value: mergedDeleted });
    if (mergedSpotify) await CC.idbPut('meta', { key: 'spotify_profile', value: mergedSpotify });
    if (mergedDiscogsIdx) await CC.idbPut('meta', { key: 'discogs_collection_index', value: mergedDiscogsIdx });

    // 11. Upload compacted softspot_state.json to appDataFolder (PATCH if exists, else POST)
    report('☁️ Saving compacted snapshot to Google Drive...');
    const payload = {
      version: 10,
      syncedAt: Date.now(),
      stash: lightweightForRemote,
      deleted_sync_ids: mergedDeleted,
      spotifyProfile: mergedSpotify,
      discogsCollectionIndex: mergedDiscogsIdx,
      prefs: outPrefs,
      secrets: outSecrets
    };
    const jsonBlob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    await uploadAppDataMultipart(GDRIVE_STATE_FILENAME, jsonBlob, 'application/json', primaryStateFile?.id || null);

    // 12. Clean up merged delta files + reset dirty counter
    const toClean = [...mergedDeltaFileIds];
    if (ownDeltaFileId) toClean.push(ownDeltaFileId);
    for (const fid of toClean) {
      await deleteAppDataFileSafe(fid);
    }
    await CC.idbPut('meta', { key: 'cloud_dirty_batch', value: { modified: [], deleted: {} } });
    CC.setPendingCloudChanges(0);

    CC.cfg.googleLastSyncAt = Date.now();
    CC.persistCfg();

    return {
      stashCount: hydratedForLocal.length,
      uploadedPhotos,
      downloadedPhotos,
      deletedCount: localIdsToDelete.length,
      mergedDeltas: mergedDeltaFileIds.length,
      spotifyProfile: mergedSpotify,
      discogsCollectionIndex: mergedDiscogsIdx
    };
  };

  window.CC = CC;
})();
