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
    googleBoundEmail: '',
    googleLastLoadAt: 0,
    googleLastSyncAt: 0,
    googleEmail: '',
    discogsLastSyncAt: 0,
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

  CC.getDeviceId = () => {
    const key = 'cratecheck_device_id_v1';
    try {
      let id = localStorage.getItem(key);
      if (!id) {
        id = 'dev_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(key, id);
      }
      return id;
    } catch (_) {
      return 'dev_local';
    }
  };

  CC.newRev = () => 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  CC.newBatchId = () => Date.now().toString(36) + '_' + CC.getDeviceId().slice(-4) + '_' + Math.random().toString(36).slice(2, 8);

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

  // Atomic multi-store IndexedDB transaction helper (e.g., persist stash record + cloud outbox together)
  CC.idbAtomicWrite = (fn) => new Promise((resolve, reject) => {
    const tx = db.transaction(['stash', 'meta'], 'readwrite');
    const stashStore = tx.objectStore('stash');
    const metaStore = tx.objectStore('meta');
    let resultVal;
    let fnErr = null;
    tx.oncomplete = () => resolve(resultVal);
    tx.onerror = () => reject(fnErr || tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(fnErr || tx.error || new Error('IndexedDB transaction aborted'));
    try {
      resultVal = fn({ stashStore, metaStore, tx });
    } catch (e) {
      fnErr = e;
      try { tx.abort(); } catch (_) {}
    }
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

  CC.moveDiscogsInstanceFolder = async (releaseId, instanceId, targetFolderId, opts = {}) => {
    const { expectedSourceFolderId = null, force = false } = opts || {};
    const account = (CC.cfg.discogsUser || '').trim();
    if (!account || !CC.cfg.discogsToken) throw new Error('Connect and verify your Discogs account first');
    const relId = Number(releaseId);
    const instId = Number(instanceId);
    const targetStr = String(targetFolderId);
    if (!relId || !instId) throw new Error('Missing Discogs release or instance ID');
    if (!targetStr || targetStr === '0') throw new Error('Cannot move a copy into the "All" view — choose a real Discogs folder');

    const checkAccount = () => {
      if ((CC.cfg.discogsUser || '').trim() !== account) {
        throw new Error('Discogs account changed during move — aborted safely');
      }
    };

    // 1. Confirm live current source folder & rating on Discogs
    const liveInsts = await CC.findDiscogsInstances(relId, { throwOnError: true });
    checkAccount();
    const live = liveInsts.find(r => Number(r.instance_id) === instId);
    if (!live) {
      const err = new Error(`Discogs copy #${instId} for release #${relId} was not found on @${account}`);
      err.code = 'INSTANCE_NOT_FOUND';
      throw err;
    }

    const actualFolderId = String(live.folder_id ?? '1');
    const rating = Number(live.rating || 0);

    if (actualFolderId === targetStr) {
      return { ok: true, status: 'already_in_target', releaseId: relId, instanceId: instId, fromFolderId: actualFolderId, folderId: targetStr, rating };
    }

    if (!force && expectedSourceFolderId && actualFolderId !== String(expectedSourceFolderId)) {
      return {
        ok: false,
        status: 'conflict_third_folder',
        releaseId: relId,
        instanceId: instId,
        expectedSourceFolderId: String(expectedSourceFolderId),
        actualFolderId,
        targetFolderId: targetStr,
        rating
      };
    }

    // 2. Move the existing instance in-place using Discogs' authenticated collection-instance update endpoint
    const body = { folder_id: Number(targetStr) };
    if (rating > 0) body.rating = rating;
    await CC.discogsFetch(
      `/users/${encodeURIComponent(account)}/collection/folders/${encodeURIComponent(actualFolderId)}/releases/${relId}/instances/${instId}`,
      {},
      'POST',
      body
    );
    checkAccount();

    // 3. Readback verification: confirm the same instance_id is now in targetFolderId with rating intact
    const afterInsts = await CC.findDiscogsInstances(relId, { throwOnError: true });
    checkAccount();
    const verified = afterInsts.find(r => Number(r.instance_id) === instId);
    if (!verified || String(verified.folder_id ?? '1') !== targetStr) {
      throw new Error(`Move verification failed: instance #${instId} is in folder ${verified?.folder_id ?? '?'} instead of ${targetStr}`);
    }

    return {
      ok: true,
      status: 'moved',
      releaseId: relId,
      instanceId: instId,
      fromFolderId: actualFolderId,
      folderId: targetStr,
      rating: Number(verified.rating ?? rating)
    };
  };

  CC.syncDiscogsCollectionFull = async (opts = {}) => {
    const { quiet = false } = opts || {};
    const account = (CC.cfg.discogsUser || '').trim();
    if (!account || !CC.cfg.discogsToken) {
      throw new Error('Verify your Discogs account first');
    }

    const checkAccount = () => {
      if ((CC.cfg.discogsUser || '').trim() !== account) {
        throw new Error('Discogs account switched mid-sync — aborted safely');
      }
    };

    const report = (msg) => { if (!quiet) statusCb(msg, true); };

    // 1. Fetch authenticated user's actual folder list (keep all folders except 0 = "All" view)
    report('📀 Reading Discogs folders...');
    const fRes = await CC.discogsFetch(`/users/${encodeURIComponent(account)}/collection/folders`);
    checkAccount();
    const rawFolders = Array.isArray(fRes?.folders) ? fRes.folders : [];
    const folders = rawFolders
      .filter(f => Number(f.id) !== 0)
      .map(f => ({ id: Number(f.id), name: String(f.name || `Folder ${f.id}`), count: Number(f.count || 0) }));
    if (!folders.some(f => f.id === 1)) {
      folders.unshift({ id: 1, name: 'Uncategorized', count: 0 });
    }

    // 2. Paginate ALL collection copies across folder 0 (All view) and validate completeness
    const releaseIds = new Set();
    const masterIds = new Set();
    const masterMap = {};
    const albumKeys = {};
    const copies = [];
    const seenInstanceKeys = new Set();
    const fieldIds = CC.cfg.discogsFields || { media: 1, sleeve: 2, notes: 3 };

    const pushEntry = (mapObj, key, entry) => {
      if (!key) return;
      if (!mapObj[key]) mapObj[key] = [];
      if (!mapObj[key].some(e => e.releaseId === entry.releaseId)) {
        mapObj[key].push(entry);
      }
    };

    let page = 1;
    let totalPages = 1;
    let expectedTotalItems = null;

    while (page <= totalPages) {
      checkAccount();
      report(`📀 Syncing with Discogs (page ${page}/${totalPages})...`);
      const res = await CC.discogsFetch(
        `/users/${encodeURIComponent(account)}/collection/folders/0/releases`,
        { per_page: 100, page }
      );
      checkAccount();
      if (!res || !Array.isArray(res.releases)) {
        throw new Error(`Malformed Discogs collection response on page ${page}`);
      }
      if (res.pagination) {
        totalPages = Math.max(1, Number(res.pagination.pages || 1));
        if (typeof res.pagination.items === 'number') expectedTotalItems = res.pagination.items;
      }

      for (const item of res.releases) {
        const info = item.basic_information || {};
        const relId = Number(info.id || item.id || 0);
        const instId = Number(item.instance_id || 0);
        if (!relId || !instId) continue;

        const copyKey = `${relId}:${instId}`;
        if (seenInstanceKeys.has(copyKey)) continue;
        seenInstanceKeys.add(copyKey);

        releaseIds.add(relId);
        const mId = Number(info.master_id || 0);
        const artist = (info.artists || []).map(a => String(a.name || '').replace(/\s*\(\d+\)$/, '')).join(', ').trim() || 'Unknown Artist';
        const title = String(info.title || '').trim() || 'Untitled Release';
        const formatNames = (info.formats || []).map(f => f.name).filter(Boolean);
        const primaryFmt = formatNames.find(n => /^(Cassette|CD|Vinyl)$/i.test(n)) || formatNames[0] || 'Vinyl';
        const format = formatNames.join(', ');
        const year = info.year ? String(info.year) : '';
        const label = info.labels?.[0]?.name || '';
        const catno = info.labels?.[0]?.catno || '';
        const folderId = String(item.folder_id ?? '1');
        const thumb = info.thumb || info.cover_image || '';
        const rating = Number(item.rating || 0);

        let mediaCond = 'Not Graded';
        let sleeveCond = 'Not Graded';
        let condNote = '';
        if (Array.isArray(item.notes)) {
          for (const n of item.notes) {
            const fid = Number(n.field_id);
            const val = String(n.value || '').trim();
            if (!val) continue;
            if (fid === Number(fieldIds.media)) mediaCond = val;
            else if (fid === Number(fieldIds.sleeve)) sleeveCond = val;
            else if (fid === Number(fieldIds.notes)) condNote = val;
          }
        }

        copies.push({
          discogs_account: account,
          discogs_id: relId,
          discogs_instance_id: instId,
          discogs_folder_id: folderId,
          master_id: mId || null,
          artist,
          title,
          format: primaryFmt,
          year,
          label,
          catno,
          genres: [...(info.genres || []), ...(info.styles || [])],
          discogs_thumb: thumb,
          discogs_url: `https://www.discogs.com/release/${relId}`,
          rating,
          media_condition: mediaCond,
          sleeve_condition: sleeveCond,
          condition_note: condNote,
          date_added: item.date_added ? Date.parse(item.date_added) || Date.now() : Date.now()
        });

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

    const complete = expectedTotalItems === null || copies.length >= expectedTotalItems || (page > totalPages && expectedTotalItems === 0);
    if (!complete) {
      throw new Error(`Incomplete Discogs collection read (received ${copies.length} of ${expectedTotalItems} items) — existing rows kept untouched`);
    }

    const syncedAt = Date.now();
    const collectionIndex = {
      username: account,
      syncedAt,
      totalItems: copies.length,
      releaseIds: Array.from(releaseIds),
      masterIds: Array.from(masterIds),
      masterMap,
      albumKeys
    };

    return {
      complete: true,
      account,
      syncedAt,
      folders,
      copies,
      collectionIndex
    };
  };

  // Pure geometry helpers (shared by app.js and automated tests)
  CC.computeSquareFitRect = (srcW, srcH, size = 1600) => {
    const w = Math.max(1, Number(srcW) || 1);
    const h = Math.max(1, Number(srcH) || 1);
    const s = Math.max(1, Math.round(Number(size) || 1600));
    const scale = Math.min(s / w, s / h);
    const drawW = Math.max(1, Math.round(w * scale));
    const drawH = Math.max(1, Math.round(h * scale));
    const dx = Math.floor((s - drawW) / 2);
    const dy = Math.floor((s - drawH) / 2);
    return { size: s, drawW, drawH, dx, dy };
  };

  CC.resolveSpineTransform = (srcW, srcH, rotationHint = '') => {
    const w = Math.max(1, Number(srcW) || 1);
    const h = Math.max(1, Number(srcH) || 1);
    const hint = String(rotationHint || '').trim().toLowerCase();
    let angleDeg = 0;
    if (hint === '90cw' || hint === '90') angleDeg = 90;
    else if (hint === '90ccw' || hint === '270' || hint === '-90') angleDeg = 270;
    else if (hint === '180') angleDeg = 180;
    else if (hint === '0') angleDeg = h > w ? 90 : 0;
    else angleDeg = h > w ? 90 : 0;
    if (h > w && (angleDeg === 0 || angleDeg === 180)) angleDeg = 90;
    return { angleDeg, swapDims: angleDeg === 90 || angleDeg === 270 };
  };

  // Reconcile a complete Discogs collection read into local Stash by (discogs_account, discogs_id, discogs_instance_id)
  CC.reconcileDiscogsCollectionIntoStash = async (syncResult, opts = {}) => {
    const { confirmMissingOnline = true } = opts || {};
    if (!syncResult || syncResult.complete !== true || !syncResult.account) {
      throw new Error('Incomplete Discogs sync result — local Stash left untouched');
    }
    const account = String(syncResult.account).trim();
    const acctLower = account.toLowerCase();
    const syncedAt = Number(syncResult.syncedAt || Date.now());
    const copies = Array.isArray(syncResult.copies) ? syncResult.copies : [];

    const localStash = await CC.idbGetAll('stash');
    for (const it of localStash) {
      if (!it.sync_id) {
        it.sync_id = CC.generateSyncId();
        await CC.idbPut('stash', it);
      }
    }

    const copyKey = (relId, instId) => `${Number(relId)}:${Number(instId)}`;
    const remoteByKey = new Map();
    const remoteByRel = new Map();
    copies.forEach(c => {
      const k = copyKey(c.discogs_id, c.discogs_instance_id);
      remoteByKey.set(k, c);
      const rk = Number(c.discogs_id);
      if (!remoteByRel.has(rk)) remoteByRel.set(rk, []);
      remoteByRel.get(rk).push(c);
    });

    const claimedRemoteKeys = new Set();
    const matchedLocalIds = new Set();
    const toPut = [];
    let addedCount = 0;
    let movedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;
    let ambiguousCount = 0;

    const belongsToAccount = (row) => {
      if (!row.discogs_account) return true;
      return String(row.discogs_account).trim().toLowerCase() === acctLower;
    };

    // Pass 1: Exact match by (discogs_account, discogs_id, discogs_instance_id) — excluding folder ID!
    for (const row of localStash) {
      if (!row.discogs_id || !row.discogs_instance_id || !belongsToAccount(row)) continue;
      const k = copyKey(row.discogs_id, row.discogs_instance_id);
      const rem = remoteByKey.get(k);
      if (!rem) continue;

      claimedRemoteKeys.add(k);
      matchedLocalIds.add(row.id);

      const prevFolder = String(row.discogs_folder_id || '');
      const nextFolder = String(rem.discogs_folder_id || '1');
      const changedFolder = prevFolder !== nextFolder;
      const changedFields = [];
      const next = { ...row };

      if (next.discogs_account !== account) { next.discogs_account = account; changedFields.push('discogs_account'); }
      if (String(next.discogs_folder_id || '') !== nextFolder) { next.discogs_folder_id = nextFolder; changedFields.push('discogs_folder_id'); }
      if (!next.synced_to_discogs) { next.synced_to_discogs = true; changedFields.push('synced_to_discogs'); }
      if (next.discogs_removed) { next.discogs_removed = false; next.discogs_removed_at = null; changedFields.push('discogs_removed', 'discogs_removed_at'); }
      if (next.discogs_link_ambiguous) { next.discogs_link_ambiguous = false; next.discogs_ambiguous_candidates = null; changedFields.push('discogs_link_ambiguous'); }
      if (Number(next.rating || 0) !== Number(rem.rating || 0)) { next.rating = Number(rem.rating || 0); changedFields.push('rating'); }
      if (!next.master_id && rem.master_id) { next.master_id = rem.master_id; changedFields.push('master_id'); }
      if (!next.discogs_thumb && rem.discogs_thumb) { next.discogs_thumb = rem.discogs_thumb; changedFields.push('discogs_thumb'); }
      if (!next.thumb_data_url && rem.discogs_thumb) { next.thumb_data_url = rem.discogs_thumb; changedFields.push('thumb_data_url'); }
      if ((!next.media_condition || next.media_condition === 'Not Graded') && rem.media_condition && rem.media_condition !== 'Not Graded') {
        next.media_condition = rem.media_condition;
        changedFields.push('media_condition');
      }
      if ((!next.sleeve_condition || next.sleeve_condition === 'Not Graded') && rem.sleeve_condition && rem.sleeve_condition !== 'Not Graded') {
        next.sleeve_condition = rem.sleeve_condition;
        changedFields.push('sleeve_condition');
      }
      if (!next.condition_note && rem.condition_note) {
        next.condition_note = rem.condition_note;
        changedFields.push('condition_note');
      }
      if (next.pending_folder_move && String(next.pending_folder_move.targetFolderId) === nextFolder) {
        next.pending_folder_move = null;
        changedFields.push('pending_folder_move');
      }

      if (changedFields.length > 0) {
        next.discogs_folder_verified_at = syncedAt;
        changedFields.push('discogs_folder_verified_at');
        const stamped = CC.stampStashRevision(next, row, changedFields);
        toPut.push(stamped);
        if (changedFolder) movedCount++;
        else updatedCount++;
      }
    }

    // Pass 2: Legacy release-only local rows (synced_to_discogs without discogs_instance_id)
    const ambiguousRelIds = new Set();
    for (const row of localStash) {
      if (matchedLocalIds.has(row.id)) continue;
      if (!row.synced_to_discogs || !row.discogs_id || row.discogs_instance_id || !belongsToAccount(row)) continue;

      const unclaimed = (remoteByRel.get(Number(row.discogs_id)) || [])
        .filter(c => !claimedRemoteKeys.has(copyKey(c.discogs_id, c.discogs_instance_id)));

      if (unclaimed.length === 1) {
        const rem = unclaimed[0];
        const k = copyKey(rem.discogs_id, rem.discogs_instance_id);
        claimedRemoteKeys.add(k);
        matchedLocalIds.add(row.id);
        const prevFolder = String(row.discogs_folder_id || '');
        const nextFolder = String(rem.discogs_folder_id || '1');
        const next = {
          ...row,
          discogs_account: account,
          discogs_instance_id: rem.discogs_instance_id,
          discogs_folder_id: nextFolder,
          discogs_folder_verified_at: syncedAt,
          synced_to_discogs: true,
          discogs_removed: false,
          discogs_removed_at: null,
          discogs_link_ambiguous: false,
          discogs_ambiguous_candidates: null,
          rating: Number(rem.rating || row.rating || 0)
        };
        const stamped = CC.stampStashRevision(next, row, [
          'discogs_account', 'discogs_instance_id', 'discogs_folder_id',
          'discogs_folder_verified_at', 'synced_to_discogs', 'discogs_removed',
          'discogs_removed_at', 'discogs_link_ambiguous', 'rating'
        ]);
        toPut.push(stamped);
        if (prevFolder && prevFolder !== nextFolder) movedCount++;
        else updatedCount++;
      } else if (unclaimed.length > 1) {
        matchedLocalIds.add(row.id);
        ambiguousRelIds.add(Number(row.discogs_id));
        const candidates = unclaimed.map(c => ({
          instance_id: c.discogs_instance_id,
          folder_id: String(c.discogs_folder_id || '1'),
          rating: Number(c.rating || 0)
        }));
        const next = {
          ...row,
          discogs_account: account,
          discogs_link_ambiguous: true,
          discogs_ambiguous_candidates: candidates
        };
        const stamped = CC.stampStashRevision(next, row, ['discogs_account', 'discogs_link_ambiguous']);
        toPut.push(stamped);
        ambiguousCount++;
      }
    }

    // Pass 3: New Discogs copies -> create distinct Stash rows
    for (const rem of copies) {
      const k = copyKey(rem.discogs_id, rem.discogs_instance_id);
      if (claimedRemoteKeys.has(k)) continue;
      if (ambiguousRelIds.has(Number(rem.discogs_id))) continue;

      const fresh = CC.stampStashRevision({
        sync_id: CC.generateSyncId(),
        discogs_account: account,
        discogs_id: rem.discogs_id,
        discogs_instance_id: rem.discogs_instance_id,
        discogs_folder_id: String(rem.discogs_folder_id || '1'),
        discogs_folder_verified_at: syncedAt,
        master_id: rem.master_id || null,
        title: rem.title,
        artist: rem.artist,
        catno: rem.catno || '',
        format: rem.format || 'Vinyl',
        year: rem.year || '',
        label: rem.label || '',
        country: '',
        genres: rem.genres || [],
        media_condition: rem.media_condition || 'Not Graded',
        sleeve_condition: rem.sleeve_condition || 'Not Graded',
        condition_note: rem.condition_note || '',
        rating: Number(rem.rating || 0),
        thumbs: [],
        thumb_data_url: rem.discogs_thumb || '',
        spine_thumb_url: '',
        spine_source_url: '',
        spine_flipped: false,
        discogs_thumb: rem.discogs_thumb || '',
        discogs_url: rem.discogs_url || `https://www.discogs.com/release/${rem.discogs_id}`,
        synced_to_discogs: true,
        discogs_removed: false,
        discogs_removed_at: null,
        pending_discogs_sync: false,
        pending_field_sync: false,
        pending_delete_old: null,
        is_high_value: false,
        is_scarce: false,
        est_price: null,
        est_currency: 'USD',
        est_usd: null,
        lowest_price: null,
        lowest_currency: 'USD',
        vg_plus_price: null,
        vg_plus_currency: 'USD',
        num_for_sale: null,
        have: 0,
        want: 0,
        tracklist: [],
        pressing_notes: '',
        taste_score: null,
        taste_verdict: null,
        taste_summary: '',
        context_note: '',
        notable_songs: [],
        litmus_track: '',
        litmus_artist: '',
        created_at: rem.date_added || syncedAt,
        updated_at: syncedAt
      }, null);
      toPut.push(fresh);
      addedCount++;
    }

    // Pass 4: Missing previously-linked copies of the SAME account -> confirm live before marking Removed from Discogs
    for (const row of localStash) {
      if (matchedLocalIds.has(row.id)) continue;
      if (!row.synced_to_discogs || !row.discogs_id || !belongsToAccount(row)) continue;

      let confirmedMissing = false;
      if (confirmMissingOnline) {
        try {
          const liveInsts = await CC.findDiscogsInstances(row.discogs_id, { throwOnError: true });
          if (row.discogs_instance_id) {
            const stillThere = liveInsts.find(r => Number(r.instance_id) === Number(row.discogs_instance_id));
            if (stillThere) {
              const nextFolder = String(stillThere.folder_id ?? '1');
              const next = {
                ...row,
                discogs_account: account,
                discogs_folder_id: nextFolder,
                discogs_folder_verified_at: syncedAt,
                discogs_removed: false,
                discogs_removed_at: null
              };
              toPut.push(CC.stampStashRevision(next, row, ['discogs_account', 'discogs_folder_id', 'discogs_folder_verified_at', 'discogs_removed', 'discogs_removed_at']));
              if (String(row.discogs_folder_id || '') !== nextFolder) movedCount++;
              continue;
            }
            confirmedMissing = true;
          } else {
            confirmedMissing = liveInsts.length === 0;
          }
        } catch (_) {
          confirmedMissing = false;
        }
      } else {
        confirmedMissing = true;
      }

      if (confirmedMissing) {
        const next = {
          ...row,
          discogs_account: account,
          synced_to_discogs: false,
          discogs_removed: true,
          discogs_removed_at: syncedAt,
          discogs_folder_verified_at: syncedAt,
          discogs_instance_id: null,
          discogs_folder_id: null,
          pending_folder_move: null
        };
        const stamped = CC.stampStashRevision(next, row, [
          'discogs_account', 'synced_to_discogs', 'discogs_removed', 'discogs_removed_at',
          'discogs_folder_verified_at', 'discogs_instance_id', 'discogs_folder_id', 'pending_folder_move'
        ]);
        toPut.push(stamped);
        removedCount++;
      }
    }

    const ops = toPut.map(rec => {
      const c = { ...rec };
      delete c.id;
      return { type: 'upsert_stash', sync_id: rec.sync_id, record: c };
    });
    if (syncResult.collectionIndex) {
      ops.push({ type: 'discogs_index', index: syncResult.collectionIndex });
    }

    const outboxBefore = await CC.getCloudOutbox();
    const nextQueue = outboxBefore.slice();
    if (ops.length > 0) {
      nextQueue.push({
        batchId: CC.newBatchId(),
        accountEmail: CC.cfg.googleBoundEmail || CC.cfg.googleEmail || '',
        createdAt: syncedAt,
        deviceId: CC.getDeviceId(),
        status: 'queued',
        ops
      });
    }

    await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
      for (const rec of toPut) stashStore.put(rec);
      if (syncResult.collectionIndex) {
        metaStore.put({ key: 'discogs_collection_index', value: syncResult.collectionIndex });
      }
      if (ops.length > 0) {
        metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: nextQueue } });
      }
    });

    if (ops.length > 0) CC.setPendingCloudChanges(nextQueue.length);

    CC.cfg.discogsFolders = syncResult.folders;
    CC.cfg.discogsLastSyncAt = syncedAt;
    if (!syncResult.folders.some(f => String(f.id) === String(CC.cfg.discogsFolderId))) {
      CC.cfg.discogsFolderId = '1';
    }
    CC.persistCfg();

    return {
      account,
      folders: syncResult.folders,
      collectionIndex: syncResult.collectionIndex,
      addedCount,
      movedCount,
      updatedCount,
      removedCount,
      ambiguousCount,
      totalCopies: copies.length,
      syncedAt
    };
  };

  CC.syncDiscogsCollectionIndex = async () => {
    const res = await CC.syncDiscogsCollectionFull();
    return res.collectionIndex;
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

  // ==================== SPOTIFY PKCE OAUTH, SINGLE SCHEDULER & RESUMABLE CHECKPOINTED SYNC ====================
  let activeSpCtrl = null;
  let spCooldownUntil = 0;
  let spLastCallAt = 0;
  let spChain = Promise.resolve();
  const SP_CHECKPOINT_KEY = 'spotify_checkpoint_v1';
  const SP_GAP_MS = 350;
  const SP_MAX_AUTO_RETRIES = 2;

  CC.cancelSpotifySync = () => {
    if (activeSpCtrl) {
      try { activeSpCtrl.abort(); } catch (_) {}
      activeSpCtrl = null;
    }
  };

  CC.getSpotifyCheckpoint = async () => {
    try {
      const rec = await CC.idbGet('meta', SP_CHECKPOINT_KEY);
      return rec?.value || null;
    } catch (_) {
      return null;
    }
  };

  CC.clearSpotifyCheckpoint = async () => {
    try { await CC.idbDelete('meta', SP_CHECKPOINT_KEY); } catch (_) {}
  };

  function parseRetryAfterSeconds(headerVal) {
    if (!headerVal) return 0;
    const asNum = Number(headerVal);
    if (Number.isFinite(asNum) && asNum > 0) return Math.ceil(asNum);
    const asDate = Date.parse(headerVal);
    if (Number.isFinite(asDate)) {
      return Math.max(1, Math.ceil((asDate - Date.now()) / 1000));
    }
    return 0;
  }

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

  // Single global scheduler for ALL Spotify reads: pauses all callers during 429 cooldown & bounds retries
  function spFetch(url, signal = null, opts = {}) {
    const { maxRetries = SP_MAX_AUTO_RETRIES, failFastOnCooldown = false } = opts || {};
    const run = async () => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) throw new DOMException('Cancelled by user', 'AbortError');

        const now = Date.now();
        if (spCooldownUntil > now) {
          const remSec = Math.ceil((spCooldownUntil - now) / 1000);
          if (failFastOnCooldown || remSec > 35) {
            const err = new Error(`Spotify rate limit cooldown (${remSec}s remaining) — paused cleanly for resume`);
            err.code = 'SPOTIFY_RATE_LIMIT';
            err.retryAfterSec = remSec;
            throw err;
          }
          for (let rem = remSec; rem > 0; rem--) {
            if (signal?.aborted) throw new DOMException('Cancelled by user', 'AbortError');
            statusCb(`Spotify rate limit — resuming in ${rem}s...`, true, { cancellable: true });
            await CC.sleep(1000, signal);
          }
        }

        const gap = Date.now() - spLastCallAt;
        if (gap < SP_GAP_MS) await CC.sleep(SP_GAP_MS - gap, signal);

        if (Date.now() > CC.cfg.spotifyExpiresAt && CC.cfg.spotifyRefreshToken) {
          await CC.refreshSpotifyToken();
        }
        spLastCallAt = Date.now();
        const res = await fetch(url, {
          headers: { Authorization: 'Bearer ' + CC.cfg.spotifyAccessToken },
          ...(signal ? { signal } : {})
        });

        if (res.status === 429) {
          const headerSec = parseRetryAfterSeconds(res.headers?.get?.('Retry-After'));
          const fallbackSec = Math.min(60, 10 * Math.pow(2, attempt));
          const waitSec = headerSec > 0 ? headerSec : fallbackSec;
          spCooldownUntil = Date.now() + waitSec * 1000;

          if (attempt >= maxRetries || waitSec > 35 || failFastOnCooldown) {
            const err = new Error(`Spotify rate limit (HTTP 429, Retry-After ${waitSec}s) — checkpoint saved for resume`);
            err.code = 'SPOTIFY_RATE_LIMIT';
            err.retryAfterSec = waitSec;
            throw err;
          }

          for (let rem = waitSec; rem > 0; rem--) {
            if (signal?.aborted) throw new DOMException('Cancelled by user', 'AbortError');
            statusCb(`Spotify rate limit — resuming in ${rem}s (retry ${attempt + 1}/${maxRetries})...`, true, { cancellable: true });
            await CC.sleep(1000, signal);
          }
          continue;
        }

        if (!res.ok) {
          const err = new Error(`Spotify HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      }
      const err = new Error('Spotify rate limit retry bound reached — checkpoint saved for resume');
      err.code = 'SPOTIFY_RATE_LIMIT';
      err.retryAfterSec = Math.max(10, Math.ceil((spCooldownUntil - Date.now()) / 1000));
      throw err;
    };

    const p = spChain.then(run, run);
    spChain = p.catch(() => {});
    return p;
  }

  CC.beginSpotifyRedirect = async (syncMode = 'liked') => {
    const verifier = randomStr(64);
    const state = randomStr(16);
    const challenge = await sha256B64(verifier);
    localStorage.setItem('sp_pkce_verifier', verifier);
    localStorage.setItem('sp_pkce_state', state);
    localStorage.setItem('sp_sync_mode', syncMode === 'full' ? 'full' : 'liked');
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

  CC.syncSpotifyResumable = async (opts = {}) => {
    const {
      mode: requestedMode = 'liked',
      resume = false,
      existingDna = '',
      existingSoftSpots = '',
      maxRetriesPerPage = SP_MAX_AUTO_RETRIES
    } = opts || {};

    CC.cancelSpotifySync();
    const ctrl = new AbortController();
    activeSpCtrl = ctrl;
    const signal = ctrl.signal;

    const spFetchPage = (url) => spFetch(url, signal, { maxRetries: maxRetriesPerPage });
    const normArtistBase = (name) => CC.norm(name).replace(/^the\s+/, '').trim();

    let artistMap = {};
    let trackPairs = new Set();
    let trackTitles = new Set();
    let trackSourcesMap = {};
    let decades = {};
    let playlistSummaries = [];

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

    const serializeAccumulated = () => {
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
      return {
        allArtists,
        trackSources,
        trackPairs: Array.from(trackPairs),
        trackTitles: Array.from(trackTitles),
        playlistSummaries,
        decades
      };
    };

    const hydrateAccumulated = (acc) => {
      if (!acc) return;
      artistMap = {};
      Object.entries(acc.allArtists || {}).forEach(([k, v]) => {
        artistMap[k] = {
          name: v.name,
          count: Number(v.count || 0),
          isTopArtist: Boolean(v.isTopArtist),
          tracks: new Set(v.tracks || []),
          likedTracks: new Set(v.likedTracks || []),
          topTracks: new Set(v.topTracks || []),
          albumTracks: new Set(v.albumTracks || []),
          playlistTracks: new Set(v.playlistTracks || []),
          playlists: new Set(v.playlists || [])
        };
      });
      trackSourcesMap = {};
      Object.entries(acc.trackSources || {}).forEach(([k, v]) => {
        trackSourcesMap[k] = {
          liked: Boolean(v.liked),
          top: Boolean(v.top),
          album: Boolean(v.album),
          playlists: new Set(v.playlists || [])
        };
      });
      trackPairs = new Set(acc.trackPairs || []);
      trackTitles = new Set(acc.trackTitles || []);
      playlistSummaries = Array.isArray(acc.playlistSummaries) ? acc.playlistSummaries.slice() : [];
      decades = Object.assign({}, acc.decades || {});
    };

    let cp = null;
    try {
      statusCb('Connecting to Spotify...', true, { cancellable: true });
      const me = await spFetchPage('https://api.spotify.com/v1/me');
      const accountId = String(me.id || '');
      const displayName = me.display_name || me.id || 'Spotify';

      const savedCp = resume ? await CC.getSpotifyCheckpoint() : null;
      if (savedCp && savedCp.accountId === accountId && (requestedMode === 'resume' || savedCp.mode === requestedMode)) {
        cp = savedCp;
        hydrateAccumulated(cp.accumulated);
      } else {
        const mode = requestedMode === 'full' ? 'full' : 'liked';
        cp = {
          accountId,
          userDisplayName: displayName,
          mode,
          stage: mode === 'full' ? 'top' : 'liked',
          topRangeIdx: 0,
          nextUrl: mode === 'full' ? '' : 'https://api.spotify.com/v1/me/tracks?limit=50',
          pageNum: 0,
          scannedLiked: 0,
          scannedAlbums: 0,
          ownedPlaylists: [],
          playlistIdx: 0,
          playlistNextUrl: '',
          playlistTracksScanned: 0,
          updatedAt: Date.now()
        };
      }

      const saveCheckpoint = async () => {
        cp.updatedAt = Date.now();
        cp.accumulated = serializeAccumulated();
        await CC.idbPut('meta', { key: SP_CHECKPOINT_KEY, value: cp });
      };

      // Stage 1 (full only): Top Artists & Tracks
      if (cp.stage === 'top') {
        const ranges = ['long_term', 'medium_term', 'short_term'];
        while (cp.topRangeIdx < ranges.length) {
          const range = ranges[cp.topRangeIdx];
          statusCb(`Syncing Top Artists & Tracks (${range})...`, true, { cancellable: true });
          const topA = await spFetchPage(`https://api.spotify.com/v1/me/top/artists?limit=50&time_range=${range}`);
          (topA.items || []).forEach((a, i) => {
            const rec = ensureArtist(a.name);
            if (rec) {
              rec.isTopArtist = true;
              rec.count += Math.max(8, 26 - Math.floor(i / 2));
            }
          });
          const topT = await spFetchPage(`https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=${range}`);
          (topT.items || []).forEach(t => addTrack(t, 'top', 6));
          cp.topRangeIdx++;
          await saveCheckpoint();
        }
        cp.stage = 'liked';
        cp.nextUrl = 'https://api.spotify.com/v1/me/tracks?limit=50';
        cp.pageNum = 0;
        await saveCheckpoint();
      }

      // Stage 2 (liked & full): Liked Songs (page-by-page checkpointed)
      if (cp.stage === 'liked') {
        while (cp.nextUrl) {
          const nextPageNum = cp.pageNum + 1;
          statusCb(`Syncing Liked Songs (page ${nextPageNum} · ${cp.scannedLiked} scanned)...`, true, { cancellable: true });
          const d = await spFetchPage(cp.nextUrl);
          (d.items || []).forEach(it => addTrack(it.track, 'liked', 5));
          cp.scannedLiked += (d.items || []).length;
          cp.pageNum = nextPageNum;
          cp.nextUrl = d.next || '';
          await saveCheckpoint();
        }
        if (cp.mode === 'full') {
          cp.stage = 'albums';
          cp.nextUrl = 'https://api.spotify.com/v1/me/albums?limit=50';
          cp.pageNum = 0;
          await saveCheckpoint();
        } else {
          cp.stage = 'done';
        }
      }

      // Stage 3 (full only): Saved Albums
      if (cp.stage === 'albums') {
        while (cp.nextUrl) {
          const nextPageNum = cp.pageNum + 1;
          statusCb(`Syncing Saved Albums (page ${nextPageNum} · ${cp.scannedAlbums} scanned)...`, true, { cancellable: true });
          const d = await spFetchPage(cp.nextUrl);
          (d.items || []).forEach(it => {
            if (it.album?.release_date) addDecade(it.album.release_date);
            (it.album?.artists || []).forEach(a => {
              const rec = ensureArtist(a.name);
              if (rec) rec.count += 4;
            });
            (it.album?.tracks?.items || []).forEach(t => addTrack(t, 'album', 3));
          });
          cp.scannedAlbums += (d.items || []).length;
          cp.pageNum = nextPageNum;
          cp.nextUrl = d.next || '';
          await saveCheckpoint();
        }
        cp.stage = 'playlists_list';
        cp.nextUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';
        cp.ownedPlaylists = [];
        await saveCheckpoint();
      }

      // Stage 4 (full only): Owned Playlists list
      if (cp.stage === 'playlists_list') {
        const seenIds = new Set((cp.ownedPlaylists || []).map(p => p.id));
        while (cp.nextUrl) {
          statusCb(`Finding your playlists (${cp.ownedPlaylists.length} non-empty)...`, true, { cancellable: true });
          const pls = await spFetchPage(cp.nextUrl);
          (pls.items || []).forEach(p => {
            if (!p || !p.id || seenIds.has(p.id)) return;
            if (!(p.owner?.id === accountId || p.collaborative)) return;
            const reportedTotal = p.tracks?.total ?? p.items?.total;
            if (reportedTotal === 0) return;
            seenIds.add(p.id);
            cp.ownedPlaylists.push({ id: p.id, name: p.name || 'Playlist' });
          });
          cp.nextUrl = pls.next || '';
          await saveCheckpoint();
        }
        cp.stage = 'playlist_items';
        cp.playlistIdx = 0;
        cp.playlistNextUrl = cp.ownedPlaylists[0] ? `https://api.spotify.com/v1/playlists/${cp.ownedPlaylists[0].id}/items?limit=50` : '';
        cp.playlistTracksScanned = 0;
        await saveCheckpoint();
      }

      // Stage 5 (full only): Playlist items
      if (cp.stage === 'playlist_items') {
        while (cp.playlistIdx < cp.ownedPlaylists.length) {
          const pl = cp.ownedPlaylists[cp.playlistIdx];
          if (!cp.playlistNextUrl) {
            cp.playlistNextUrl = `https://api.spotify.com/v1/playlists/${pl.id}/items?limit=50`;
            cp.playlistTracksScanned = 0;
          }
          while (cp.playlistNextUrl) {
            statusCb(`Playlist ${cp.playlistIdx + 1}/${cp.ownedPlaylists.length}: ${pl.name} (${cp.playlistTracksScanned} songs)...`, true, { cancellable: true });
            const pd = await spFetchPage(cp.playlistNextUrl);
            (pd.items || []).forEach(e => addTrack(e.item || e.track, 'playlist', 1, pl.name));
            cp.playlistTracksScanned += (pd.items || []).length;
            cp.playlistNextUrl = pd.next || '';
            await saveCheckpoint();
          }
          if (cp.playlistTracksScanned > 0) {
            playlistSummaries.push({ name: pl.name, count: cp.playlistTracksScanned });
          }
          cp.playlistIdx++;
          cp.playlistTracksScanned = 0;
          cp.playlistNextUrl = cp.ownedPlaylists[cp.playlistIdx]
            ? `https://api.spotify.com/v1/playlists/${cp.ownedPlaylists[cp.playlistIdx].id}/items?limit=50`
            : '';
          await saveCheckpoint();
        }
        cp.stage = 'done';
      }

      const finalAcc = serializeAccumulated();
      const topArtists = Object.values(finalAcc.allArtists).sort((a, b) => b.count - a.count).map(x => x.name);
      await CC.clearSpotifyCheckpoint();

      const profile = {
        provenanceVersion: 2,
        syncMode: cp.mode,
        accountId,
        syncedAt: Date.now(),
        userDisplayName: displayName,
        topArtists,
        allArtists: finalAcc.allArtists,
        trackSources: finalAcc.trackSources,
        trackPairs: finalAcc.trackPairs,
        trackTitles: finalAcc.trackTitles,
        playlistSummaries: finalAcc.playlistSummaries,
        decades: finalAcc.decades,
        totalTracks: finalAcc.trackPairs.length || finalAcc.trackTitles.length,
        totalArtists: Object.keys(finalAcc.allArtists).length,
        totalPlaylists: (cp.ownedPlaylists || []).length,
        tasteDna: existingDna || '',
        softSpots: existingSoftSpots || '',
        dnaUpdatedAt: existingDna ? Date.now() : 0
      };

      return { completed: true, paused: false, profile };
    } catch (err) {
      if (err?.code === 'SPOTIFY_RATE_LIMIT' || err?.name === 'AbortError') {
        return {
          completed: false,
          paused: true,
          reason: err?.code === 'SPOTIFY_RATE_LIMIT' ? 'rate_limit' : 'cancelled',
          retryAfterSec: Number(err?.retryAfterSec || 0),
          message: err?.message || 'Paused',
          checkpoint: cp
        };
      }
      throw err;
    } finally {
      if (activeSpCtrl === ctrl) activeSpCtrl = null;
    }
  };

  CC.syncSpotifyAll = async (existingDna = '', existingSoftSpots = '') => {
    const r = await CC.syncSpotifyResumable({ mode: 'full', existingDna, existingSoftSpots });
    if (!r.completed) throw new Error(r.message || 'Spotify sync paused');
    return r.profile;
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

  // ==================== GOOGLE DRIVE V2 IMMUTABLE-BATCH CLOUD SYNC ====================
  const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const GDRIVE_V2_BATCH_RX = /^ss_v2_batch_([a-z0-9_-]+)\.json$/i;
  const GDRIVE_V2_SECRETS_RX = /^ss_v2_secrets_([a-z0-9_-]+)\.json$/i;
  const GDRIVE_LEGACY_STATE_NAMES = ['softspot_state.json', 'cratecheck_state.json'];
  const GDRIVE_LEGACY_DELTA_RX = /^delta_\d+_[a-z0-9]+\.json$/i;
  const GDRIVE_SESSION_KEY = 'cratecheck_gdrive_sess_v1';
  const CLOUD_OUTBOX_KEY = 'cloud_outbox_v2';
  const CLOUD_META_KEY = 'cloud_sync_meta_v2';

  const PREF_KEYS = [
    'geminiModel', 'autoPlayHighlight', 'autoDetective', 'autoGradeOnScan',
    'homeCountry', 'fetchVgSuggestions', 'threshold', 'voice',
    'showSpotify', 'showApple', 'showDeezer', 'showYoutube'
  ];
  const SECRET_KEYS = [
    'geminiKey', 'discogsToken', 'discogsUser', 'discogsFolderId',
    'discogsFolders', 'discogsFields', 'spotifyClientId'
  ];
  const STASH_MERGE_FIELDS = [
    'title', 'artist', 'catno', 'format', 'year', 'label', 'country', 'genres',
    'media_condition', 'sleeve_condition', 'condition_note',
    'thumbs', 'thumb_data_url', 'spine_thumb_url', 'spine_source_url', 'spine_flipped',
    'taste_score', 'taste_verdict', 'taste_summary', 'context_note',
    'notable_songs', 'litmus_track', 'litmus_artist', 'taste_scored_at',
    'discogs_id', 'master_id', 'discogs_account', 'discogs_instance_id',
    'discogs_folder_id', 'discogs_folder_verified_at', 'intended_discogs_folder_id',
    'synced_to_discogs', 'discogs_removed', 'discogs_removed_at', 'discogs_link_ambiguous',
    'pending_discogs_sync', 'pending_field_sync', 'pending_delete_old', 'pending_folder_move',
    'rating', 'is_high_value', 'is_scarce', 'est_price', 'est_currency', 'est_usd',
    'lowest_price', 'lowest_currency', 'vg_plus_price', 'vg_plus_currency',
    'num_for_sale', 'have', 'want', 'tracklist', 'pressing_notes',
    'discogs_url', 'discogs_thumb', 'is_conservative_tiebreak', 'tiebreak_confirmed', 'spotify_matches'
  ];

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

  CC.getCloudOutbox = async () => {
    try {
      const rec = await CC.idbGet('meta', CLOUD_OUTBOX_KEY);
      const q = Array.isArray(rec?.value?.queue) ? rec.value.queue : [];
      return q;
    } catch (_) { return []; }
  };

  CC.getCloudSyncMeta = async () => {
    try {
      const rec = await CC.idbGet('meta', CLOUD_META_KEY);
      const v = rec?.value || {};
      return {
        appliedBatchIds: Object.assign({}, v.appliedBatchIds || {}),
        conflicts: Array.isArray(v.conflicts) ? v.conflicts : [],
        deviceId: v.deviceId || CC.getDeviceId()
      };
    } catch (_) {
      return { appliedBatchIds: {}, conflicts: [], deviceId: CC.getDeviceId() };
    }
  };

  // Stamp revision ancestry & per-field revisions on a Stash record before committing
  CC.stampStashRevision = (record, prevRecord = null, changedFields = null) => {
    const now = Date.now();
    const rev = CC.newRev();
    const deviceId = CC.getDeviceId();
    const rec = { ...record };
    if (!rec.sync_id) rec.sync_id = prevRecord?.sync_id || CC.generateSyncId();
    rec.parent_rev = prevRecord?.rev || rec.rev || null;
    rec.rev = rev;
    rec.updated_at = now;
    if (!rec.created_at) rec.created_at = prevRecord?.created_at || now;

    const fRevs = Object.assign({}, prevRecord?.field_revs || rec.field_revs || {});
    const fieldsToStamp = Array.isArray(changedFields)
      ? changedFields
      : STASH_MERGE_FIELDS.filter(f => {
          if (!prevRecord) return rec[f] !== undefined;
          return JSON.stringify(rec[f]) !== JSON.stringify(prevRecord[f]);
        });
    fieldsToStamp.forEach(f => { fRevs[f] = { ts: now, rev, deviceId }; });
    rec.field_revs = fRevs;
    return rec;
  };

  // Atomically commit local stash/meta changes AND append an immutable outbox batch in ONE IndexedDB transaction
  CC.commitLocalMutation = async (opts = {}) => {
    const {
      upsertStash = null,
      deleteStash = null, // { id, sync_id }
      metaPuts = [],      // [{ key, value }]
      extraOps = [],      // [{ type, ... }]
      queueOutbox = true
    } = opts || {};

    const outboxBefore = await CC.getCloudOutbox();
    const deletedBefore = (await CC.idbGet('meta', 'deleted_sync_ids'))?.value || {};
    const now = Date.now();
    const ops = [...extraOps];
    let savedStash = upsertStash ? { ...upsertStash } : null;

    if (savedStash) {
      if (!savedStash.sync_id) savedStash.sync_id = CC.generateSyncId();
      if (!savedStash.rev) savedStash = CC.stampStashRevision(savedStash, null);
      const opCopy = { ...savedStash };
      delete opCopy.id;
      ops.push({ type: 'upsert_stash', sync_id: savedStash.sync_id, record: opCopy });
    }

    const updatedDeleted = Object.assign({}, deletedBefore);
    if (deleteStash?.sync_id) {
      const delEntry = { ts: now, rev: CC.newRev(), deviceId: CC.getDeviceId() };
      updatedDeleted[deleteStash.sync_id] = delEntry;
      ops.push({ type: 'delete_stash', sync_id: deleteStash.sync_id, deleted: delEntry });
    }

    const nextQueue = outboxBefore.slice();
    let createdBatch = null;
    if (queueOutbox && ops.length > 0) {
      createdBatch = {
        batchId: CC.newBatchId(),
        accountEmail: CC.cfg.googleBoundEmail || CC.cfg.googleEmail || '',
        createdAt: now,
        deviceId: CC.getDeviceId(),
        status: 'queued',
        ops
      };
      nextQueue.push(createdBatch);
    }

    let assignedId = savedStash?.id;
    await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
      if (savedStash) {
        const req = stashStore.put(savedStash);
        req.onsuccess = () => { assignedId = req.result; savedStash.id = assignedId; };
      }
      if (deleteStash?.id !== undefined && deleteStash?.id !== null) {
        stashStore.delete(deleteStash.id);
      }
      if (deleteStash?.sync_id) {
        metaStore.put({ key: 'deleted_sync_ids', value: updatedDeleted });
      }
      for (const mp of metaPuts) {
        metaStore.put(mp);
      }
      if (createdBatch) {
        metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: nextQueue } });
      }
    });

    if (createdBatch) CC.setPendingCloudChanges(nextQueue.length);
    return { savedStash, assignedId, batch: createdBatch, pendingCount: nextQueue.length };
  };

  CC.recordLocalCloudChange = async (syncId = null, isDelete = false, extraOps = []) => {
    const ops = [...extraOps];
    if (syncId && !isDelete) {
      const all = await CC.idbGetAll('stash');
      const found = all.find(x => x.sync_id === syncId);
      if (found) {
        const copy = { ...found };
        delete copy.id;
        ops.push({ type: 'upsert_stash', sync_id: syncId, record: copy });
      }
    } else if (syncId && isDelete) {
      ops.push({ type: 'delete_stash', sync_id: syncId, deleted: { ts: Date.now(), rev: CC.newRev(), deviceId: CC.getDeviceId() } });
    }
    if (!ops.length) {
      const cur = await CC.getCloudOutbox();
      CC.setPendingCloudChanges(cur.length);
      return cur.length;
    }
    const res = await CC.commitLocalMutation({ extraOps: ops, queueOutbox: true });
    return res.pendingCount;
  };

  CC.isGoogleSignedIn = () => Boolean(gToken && Date.now() < gTokenExp - 15000);

  CC.getGoogleClientId = () => (CC.cfg.googleClientId || CC.DEFAULT_GOOGLE_CLIENT_ID || '').trim();

  CC.requestGoogleAccessToken = (promptMode = '', explicitHint = '') => new Promise((resolve, reject) => {
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
      const hintEmail = explicitHint || CC.cfg.googleEmail || CC.cfg.googleBoundEmail || '';
      if (hintEmail) reqOpts.hint = hintEmail;
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
    if (!CC.isGoogleSignedIn()) {
      const err = new Error('Google Drive session expired — tap Reconnect Google Drive');
      err.code = 'GOOGLE_AUTH_EXPIRED';
      throw err;
    }
    const headers = Object.assign({}, opts.headers || {}, { Authorization: `Bearer ${gToken}` });
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      gToken = '';
      gTokenExp = 0;
      try { sessionStorage.removeItem(GDRIVE_SESSION_KEY); } catch (_) {}
      const err = new Error('Google session expired — tap Reconnect Google Drive');
      err.code = 'GOOGLE_AUTH_EXPIRED';
      throw err;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error(`Google Drive HTTP ${res.status}: ${txt.slice(0, 140)}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function identifyGoogleAccount() {
    const aboutRes = await gdriveFetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)');
    const about = await aboutRes.json();
    const email = String(about?.user?.emailAddress || '').trim().toLowerCase();
    if (!email) throw new Error('Could not identify Google account email');
    CC.cfg.googleEmail = email;
    CC.persistCfg();
    return email;
  }

  async function listAppDataFiles() {
    const map = new Map();
    const v2Batches = new Map();     // batchId -> file
    const v2Secrets = new Map();     // batchId -> file
    const legacyDeltas = [];
    let pageToken = '';
    const seenTokens = new Set();

    while (true) {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('spaces', 'appDataFolder');
      url.searchParams.set('fields', 'nextPageToken,files(id,name,modifiedTime)');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await gdriveFetch(url.toString());
      const data = await res.json();
      if (!data || !Array.isArray(data.files)) {
        throw new Error('Malformed Google Drive file listing response');
      }
      data.files.forEach(f => {
        if (!f?.name || !f?.id) return;
        const prev = map.get(f.name);
        if (!prev || String(f.modifiedTime || '') > String(prev.modifiedTime || '')) {
          map.set(f.name, f);
        }
        const mBatch = f.name.match(GDRIVE_V2_BATCH_RX);
        if (mBatch && !v2Batches.has(mBatch[1])) {
          v2Batches.set(mBatch[1], { ...f, batchId: mBatch[1] });
        }
        const mSec = f.name.match(GDRIVE_V2_SECRETS_RX);
        if (mSec && !v2Secrets.has(mSec[1])) {
          v2Secrets.set(mSec[1], { ...f, batchId: mSec[1] });
        }
        if (GDRIVE_LEGACY_DELTA_RX.test(f.name)) {
          legacyDeltas.push(f);
        }
      });
      if (!data.nextPageToken) break;
      if (seenTokens.has(data.nextPageToken)) {
        throw new Error('Incomplete Google Drive listing (repeated page token)');
      }
      seenTokens.add(data.nextPageToken);
      pageToken = data.nextPageToken;
    }

    return { map, v2Batches, v2Secrets, legacyDeltas };
  }

  async function uploadAppDataMultipart(name, contentBlob, mimeType) {
    const boundary = 'ss_v2_' + Math.random().toString(36).slice(2, 12);
    const meta = { name, parents: ['appDataFolder'] };
    const head =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = new Blob([head, contentBlob, tail], { type: `multipart/related; boundary=${boundary}` });

    const res = await gdriveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    return res.json();
  }

  function normTombstoneTs(entry) {
    if (!entry) return 0;
    if (typeof entry === 'number') return entry;
    return Number(entry.ts || 0);
  }

  function compareRevMeta(aTs, aRev, bTs, bRev) {
    if (aTs !== bTs) return aTs - bTs;
    return String(aRev || '').localeCompare(String(bRev || ''));
  }

  CC.mergeStashRecordsDeterministic = (localRec, remoteRec, opts = {}) => {
    const { localUnsynced = false } = opts || {};
    if (!localRec) return { merged: { ...remoteRec }, conflicts: [] };
    if (!remoteRec) return { merged: { ...localRec }, conflicts: [] };

    const locTs = Number(localRec.updated_at || localRec.created_at || 0);
    const remTs = Number(remoteRec.updated_at || remoteRec.created_at || 0);
    const locRev = String(localRec.rev || '');
    const remRev = String(remoteRec.rev || '');

    // Direct ancestry fast paths (only when local has no unpushed competing changes)
    if (!localUnsynced && remoteRec.parent_rev && locRev && remoteRec.parent_rev === locRev) {
      const m = { ...remoteRec };
      if (localRec.id !== undefined) m.id = localRec.id;
      return { merged: m, conflicts: [] };
    }
    if (localRec.parent_rev && remRev && localRec.parent_rev === remRev) {
      const m = { ...localRec };
      return { merged: m, conflicts: [] };
    }

    const merged = { ...localRec };
    const conflicts = Array.isArray(localRec.conflicts) ? localRec.conflicts.slice() : [];
    const mergedFieldRevs = Object.assign({}, localRec.field_revs || {});
    const locFRevs = localRec.field_revs || {};
    const remFRevs = remoteRec.field_revs || {};
    const newConflicts = [];

    const DISCOGS_LOC_FIELDS = new Set([
      'discogs_folder_id', 'discogs_folder_verified_at', 'discogs_instance_id',
      'synced_to_discogs', 'discogs_removed', 'discogs_removed_at', 'discogs_account', 'rating'
    ]);
    const locDiscogsVerTs = Number(localRec.discogs_folder_verified_at || 0);
    const remDiscogsVerTs = Number(remoteRec.discogs_folder_verified_at || 0);

    for (const f of STASH_MERGE_FIELDS) {
      const lv = localRec[f];
      const rv = remoteRec[f];
      if (JSON.stringify(lv) === JSON.stringify(rv)) {
        if (remFRevs[f] && (!mergedFieldRevs[f] || remFRevs[f].ts > mergedFieldRevs[f].ts)) {
          mergedFieldRevs[f] = remFRevs[f];
        }
        continue;
      }

      // Discogs is authoritative for remote location: strictly newer verified timestamp wins cleanly without replaying moves
      if (DISCOGS_LOC_FIELDS.has(f) && locDiscogsVerTs !== remDiscogsVerTs) {
        if (remDiscogsVerTs > locDiscogsVerTs) {
          merged[f] = rv;
          if (remFRevs[f]) mergedFieldRevs[f] = remFRevs[f];
        }
        continue;
      }

      const lEmpty = lv === undefined || lv === null || lv === '' || (Array.isArray(lv) && lv.length === 0);
      const rEmpty = rv === undefined || rv === null || rv === '' || (Array.isArray(rv) && rv.length === 0);

      // Prefer non-empty when the other side never touched this field
      const lMeta = locFRevs[f] || null;
      const rMeta = remFRevs[f] || null;

      if (lEmpty && !rEmpty && !lMeta) {
        merged[f] = rv;
        if (rMeta) mergedFieldRevs[f] = rMeta;
        continue;
      }
      if (rEmpty && !lEmpty && !rMeta) {
        continue;
      }

      // If only one side has explicit field_revs entry for this field (unrelated field edits on two devices!), take that side cleanly
      if (rMeta && !lMeta) {
        merged[f] = rv;
        mergedFieldRevs[f] = rMeta;
        continue;
      }
      if (lMeta && !rMeta) {
        continue;
      }

      // Both sides edited the same field -> converge deterministically by (ts, rev) and retain competing value!
      const lFieldTs = lMeta ? Number(lMeta.ts || locTs) : locTs;
      const rFieldTs = rMeta ? Number(rMeta.ts || remTs) : remTs;
      const lFieldRev = lMeta ? String(lMeta.rev || locRev) : locRev;
      const rFieldRev = rMeta ? String(rMeta.rev || remRev) : remRev;

      const cmp = compareRevMeta(rFieldTs, rFieldRev, lFieldTs, lFieldRev);
      const remoteWins = cmp > 0;
      const keptVal = remoteWins ? rv : lv;
      const retainedVal = remoteWins ? lv : rv;

      merged[f] = keptVal;
      mergedFieldRevs[f] = remoteWins
        ? (rMeta || { ts: rFieldTs, rev: rFieldRev })
        : (lMeta || { ts: lFieldTs, rev: lFieldRev });

      // Retain competing value for user-meaningful fields
      if (!['updated_at', 'num_for_sale', 'have', 'want', 'lowest_price', 'vg_plus_price', 'est_price', 'est_usd'].includes(f)) {
        const cEntry = {
          id: `${localRec.sync_id}:${f}:${Math.max(lFieldTs, rFieldTs)}`,
          sync_id: localRec.sync_id,
          itemLabel: `${merged.artist || '?'} — ${merged.title || '?'}`,
          field: f,
          keptVal,
          retainedVal,
          detectedAt: Date.now()
        };
        if (!conflicts.some(c => c.id === cEntry.id)) {
          conflicts.push(cEntry);
          newConflicts.push(cEntry);
        }
      }
    }

    merged.field_revs = mergedFieldRevs;
    merged.updated_at = Math.max(locTs, remTs);
    merged.rev = compareRevMeta(remTs, remRev, locTs, locRev) > 0 ? (remRev || locRev) : (locRev || remRev);
    merged.created_at = Math.min(Number(localRec.created_at || merged.updated_at), Number(remoteRec.created_at || merged.updated_at));
    if (conflicts.length) merged.conflicts = conflicts.slice(-10);
    if (localRec.id !== undefined) merged.id = localRec.id;

    return { merged, conflicts: newConflicts };
  };

  function collectUnsyncedSyncIds(outboxQueue) {
    const s = new Set();
    (outboxQueue || []).forEach(b => {
      (b.ops || []).forEach(op => {
        if (op?.sync_id) s.add(op.sync_id);
      });
    });
    return s;
  }

  // Single shared READ-ONLY pull path (ZERO Drive writes!) used by Connect Google Drive, Load, and Sync Now
  CC.pullFromGoogleDrive = async (opts = {}) => {
    const { quiet = false, skipAccountBindOnEmpty = false, _prefetchedListing = null } = opts || {};
    const report = (msg) => { if (!quiet) statusCb(msg, true); };

    const email = await identifyGoogleAccount();
    const rawLocalStash = await CC.idbGetAll('stash');
    for (const it of rawLocalStash) {
      if (!it.sync_id) {
        it.sync_id = CC.generateSyncId();
        await CC.idbPut('stash', it);
      }
    }
    const localSpotify = (await CC.idbGet('meta', 'spotify_profile'))?.value || null;
    const localDiscogsIdx = (await CC.idbGet('meta', 'discogs_collection_index'))?.value || null;
    const hasLocalData = rawLocalStash.length > 0 || Boolean(localSpotify?.tasteDna || localSpotify?.softSpots || localSpotify?.totalTracks);

    // Account switch protection: pause and warn before mixing two different Google accounts
    if (CC.cfg.googleBoundEmail && CC.cfg.googleBoundEmail !== email && hasLocalData) {
      return {
        ok: false,
        status: 'account_mismatch',
        previousEmail: CC.cfg.googleBoundEmail,
        currentEmail: email
      };
    }

    report('☁️ Checking Google Drive appDataFolder...');
    const listing = _prefetchedListing || await listAppDataFiles();
    const { map: fileMap, v2Batches, v2Secrets, legacyDeltas } = listing;

    const legacySnapshotFile = GDRIVE_LEGACY_STATE_NAMES.map(n => fileMap.get(n)).find(Boolean) || null;
    const hasCloudData = Boolean(legacySnapshotFile || v2Batches.size > 0 || legacyDeltas.length > 0);

    if (!hasCloudData) {
      if (!skipAccountBindOnEmpty && !hasLocalData) {
        CC.cfg.googleBoundEmail = email;
      }
      CC.cfg.googleLastLoadAt = Date.now();
      CC.persistCfg();
      return {
        ok: true,
        status: 'empty_cloud',
        emptyCloud: true,
        email,
        hasLocalData,
        stashCount: rawLocalStash.length,
        appliedBatches: 0,
        downloadedPhotos: 0,
        conflicts: [],
        partialErrors: [],
        listing
      };
    }

    const syncMeta = await CC.getCloudSyncMeta();
    const outboxQueue = await CC.getCloudOutbox();
    const unsyncedSyncIds = collectUnsyncedSyncIds(outboxQueue);

    // Build cloud reconstructed state from legacy snapshot + legacy deltas + immutable v2 batches (read-only!)
    const cloudStashBySync = new Map();
    const cloudDeleted = {};
    let cloudSpotify = null;
    let cloudDiscogsIdx = null;
    let cloudPrefs = null;
    let cloudSecrets = null;
    const partialErrors = [];
    let appliedBatchCount = 0;

    const foldRemoteStashItem = (it) => {
      if (!it?.sync_id) return;
      const prev = cloudStashBySync.get(it.sync_id);
      if (!prev) {
        cloudStashBySync.set(it.sync_id, { ...it });
      } else {
        const res = CC.mergeStashRecordsDeterministic(prev, it);
        cloudStashBySync.set(it.sync_id, res.merged);
      }
    };

    const foldRemoteTombstone = (sid, entry) => {
      if (!sid) return;
      const nextTs = normTombstoneTs(entry);
      const prevTs = normTombstoneTs(cloudDeleted[sid]);
      if (nextTs > prevTs) cloudDeleted[sid] = typeof entry === 'object' ? entry : { ts: nextTs };
    };

    const foldRemoteSpotify = (sp) => {
      if (!sp) return;
      if (!cloudSpotify) { cloudSpotify = { ...sp }; return; }
      const base = Number(sp.syncedAt || 0) > Number(cloudSpotify.syncedAt || 0) ? { ...sp } : { ...cloudSpotify };
      if (Number(sp.dnaUpdatedAt || 0) >= Number(cloudSpotify.dnaUpdatedAt || 0)) {
        base.tasteDna = sp.tasteDna || '';
        base.softSpots = sp.softSpots || '';
        base.dnaUpdatedAt = sp.dnaUpdatedAt || 0;
      }
      cloudSpotify = base;
    };

    // A. Legacy snapshot migration input (softspot_state.json or cratecheck_state.json)
    if (legacySnapshotFile?.id) {
      report(`☁️ Reading cloud snapshot (${legacySnapshotFile.name})...`);
      const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(legacySnapshotFile.id)}?alt=media`);
      const snap = await res.json();
      if (!snap || typeof snap !== 'object') throw new Error('Malformed cloud snapshot JSON');
      (snap.stash || []).forEach(foldRemoteStashItem);
      Object.entries(snap.deleted_sync_ids || {}).forEach(([sid, ts]) => foldRemoteTombstone(sid, ts));
      if (snap.spotifyProfile) foldRemoteSpotify(snap.spotifyProfile);
      if (snap.discogsCollectionIndex) cloudDiscogsIdx = snap.discogsCollectionIndex;
      if (snap.prefs) cloudPrefs = snap.prefs;
      if (CC.cfg.googleSyncSecrets && snap.secrets) cloudSecrets = snap.secrets;
    }

    // B. Legacy delta_*.json migration inputs
    for (const df of legacyDeltas) {
      try {
        const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(df.id)}?alt=media`);
        const dJson = await res.json();
        (dJson?.items || []).forEach(foldRemoteStashItem);
        Object.entries(dJson?.deleted_sync_ids || {}).forEach(([sid, ts]) => foldRemoteTombstone(sid, ts));
      } catch (e) {
        partialErrors.push(`Skipped unreadable legacy delta ${df.name}: ${e.message}`);
      }
    }

    // C. Immutable v2 batches (deduplicated by batchId, applied in deterministic timestamp order)
    const sortedV2 = Array.from(v2Batches.values()).sort((a, b) =>
      String(a.modifiedTime || '').localeCompare(String(b.modifiedTime || '')) || a.batchId.localeCompare(b.batchId)
    );
    const loadedBatches = [];
    for (let i = 0; i < sortedV2.length; i++) {
      const bf = sortedV2[i];
      report(`☁️ Reading cloud batch ${i + 1}/${sortedV2.length}...`);
      const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(bf.id)}?alt=media`);
      const bJson = await res.json();
      if (!bJson || !Array.isArray(bJson.ops)) {
        throw new Error(`Malformed cloud batch ${bf.name}`);
      }
      loadedBatches.push({ batchId: bf.batchId, createdAt: Number(bJson.createdAt || 0), ops: bJson.ops });
    }
    loadedBatches.sort((a, b) => (a.createdAt - b.createdAt) || a.batchId.localeCompare(b.batchId));

    for (const b of loadedBatches) {
      if (!syncMeta.appliedBatchIds[b.batchId]) appliedBatchCount++;
      for (const op of b.ops) {
        if (!op || !op.type) continue;
        if (op.type === 'upsert_stash' && op.record) foldRemoteStashItem(op.record);
        else if (op.type === 'delete_stash' && op.sync_id) foldRemoteTombstone(op.sync_id, op.deleted || b.createdAt);
        else if (op.type === 'spotify_profile' && op.profile) foldRemoteSpotify(op.profile);
        else if (op.type === 'taste_profile') {
          foldRemoteSpotify({
            ...(cloudSpotify || {}),
            tasteDna: op.tasteDna ?? '',
            softSpots: op.softSpots ?? '',
            dnaUpdatedAt: Number(op.dnaUpdatedAt || b.createdAt)
          });
        } else if (op.type === 'discogs_index' && op.index) {
          if (!cloudDiscogsIdx || Number(op.index.syncedAt || 0) >= Number(cloudDiscogsIdx.syncedAt || 0)) {
            cloudDiscogsIdx = op.index;
          }
        } else if (op.type === 'prefs' && op.prefs) {
          if (!cloudPrefs || Number(op.prefs.cfgUpdatedAt || 0) >= Number(cloudPrefs.cfgUpdatedAt || 0)) {
            cloudPrefs = op.prefs;
          }
        }
      }
      syncMeta.appliedBatchIds[b.batchId] = Date.now();
    }

    // D. Separate opt-in secrets batches (ONLY when user explicitly opted in!)
    if (CC.cfg.googleSyncSecrets && v2Secrets.size > 0) {
      const sortedSec = Array.from(v2Secrets.values()).sort((a, b) =>
        String(a.modifiedTime || '').localeCompare(String(b.modifiedTime || '')) || a.batchId.localeCompare(b.batchId)
      );
      for (const sf of sortedSec) {
        try {
          const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sf.id)}?alt=media`);
          const sJson = await res.json();
          if (sJson?.secrets) {
            if (!cloudSecrets || Number(sJson.cfgUpdatedAt || 0) >= Number(cloudSecrets._ts || 0)) {
              cloudSecrets = { ...sJson.secrets, _ts: Number(sJson.cfgUpdatedAt || 0) };
            }
          }
        } catch (_) {}
      }
    }

    // Merge cloud state into local state (preserving local-only items and unsynced local edits!)
    const localBySync = new Map();
    rawLocalStash.forEach(it => localBySync.set(it.sync_id, it));
    const localDeleted = Object.assign({}, (await CC.idbGet('meta', 'deleted_sync_ids'))?.value || {});
    const mergedDeleted = Object.assign({}, localDeleted);
    Object.entries(cloudDeleted).forEach(([sid, entry]) => {
      if (normTombstoneTs(entry) > normTombstoneTs(mergedDeleted[sid])) mergedDeleted[sid] = entry;
    });

    const allSyncIds = new Set([...localBySync.keys(), ...cloudStashBySync.keys()]);
    const mergedStash = [];
    const localIdsToDelete = [];
    const allNewConflicts = [];

    for (const sid of allSyncIds) {
      const loc = localBySync.get(sid) || null;
      const rem = cloudStashBySync.get(sid) || null;
      const mergedRes = CC.mergeStashRecordsDeterministic(loc, rem, { localUnsynced: unsyncedSyncIds.has(sid) });
      const rec = mergedRes.merged;
      if (mergedRes.conflicts.length) allNewConflicts.push(...mergedRes.conflicts);

      const recTs = Number(rec.updated_at || rec.created_at || 0);
      const delTs = normTombstoneTs(mergedDeleted[sid]);
      // Stale edit must NEVER resurrect a deleted item (deletion wins unless edit is strictly newer!)
      if (delTs > 0 && delTs >= recTs) {
        if (loc?.id !== undefined) localIdsToDelete.push(loc.id);
        continue;
      }
      if (delTs > 0 && recTs > delTs) {
        delete mergedDeleted[sid];
      }
      mergedStash.push(rec);
    }

    // Hydrate any missing gdrive:img_<hash>.webp photos (preserving local photo & gdrive: ref on download failure!)
    let downloadedPhotos = 0;
    const dlCache = new Map();

    const hydrateField = async (val, localFallbackVal = '') => {
      const s = String(val || '');
      if (!s.startsWith('gdrive:')) return s;
      const fname = s.slice(7);
      if (dlCache.has(fname)) return dlCache.get(fname);
      const fInfo = fileMap.get(fname);
      if (!fInfo?.id) {
        partialErrors.push(`Missing photo asset ${fname} on Drive`);
        return localFallbackVal && localFallbackVal.startsWith('data:image/') ? localFallbackVal : s;
      }
      try {
        report(`☁️ Downloading photo ${downloadedPhotos + 1}...`);
        const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fInfo.id)}?alt=media`);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        dlCache.set(fname, dataUrl);
        downloadedPhotos++;
        return dataUrl;
      } catch (e) {
        partialErrors.push(`Failed downloading ${fname}: ${e.message}`);
        return localFallbackVal && localFallbackVal.startsWith('data:image/') ? localFallbackVal : s;
      }
    };

    for (const item of mergedStash) {
      const prevLoc = localBySync.get(item.sync_id) || {};
      if (Array.isArray(item.thumbs)) {
        const out = [];
        for (let i = 0; i < item.thumbs.length; i++) {
          const fb = Array.isArray(prevLoc.thumbs) ? (prevLoc.thumbs[i] || '') : '';
          const h = await hydrateField(item.thumbs[i], fb);
          if (h) out.push(h);
        }
        item.thumbs = out;
      }
      if (item.thumb_data_url) {
        item.thumb_data_url = await hydrateField(item.thumb_data_url, prevLoc.thumb_data_url || '');
      }
      if (item.spine_thumb_url) {
        item.spine_thumb_url = await hydrateField(item.spine_thumb_url, prevLoc.spine_thumb_url || '');
      }
      if (item.spine_source_url) {
        item.spine_source_url = await hydrateField(item.spine_source_url, prevLoc.spine_source_url || '');
      }
    }

    // Merge Spotify Profile + Taste Profile/Soft Spots
    let mergedSpotify = localSpotify;
    if (cloudSpotify) {
      if (!localSpotify) {
        mergedSpotify = { ...cloudSpotify };
      } else {
        const base = Number(cloudSpotify.syncedAt || 0) > Number(localSpotify.syncedAt || 0)
          ? { ...cloudSpotify }
          : { ...localSpotify };
        if (Number(cloudSpotify.dnaUpdatedAt || 0) > Number(localSpotify.dnaUpdatedAt || 0)) {
          base.tasteDna = cloudSpotify.tasteDna || '';
          base.softSpots = cloudSpotify.softSpots || '';
          base.dnaUpdatedAt = cloudSpotify.dnaUpdatedAt || 0;
        } else {
          base.tasteDna = localSpotify.tasteDna || '';
          base.softSpots = localSpotify.softSpots || '';
          base.dnaUpdatedAt = localSpotify.dnaUpdatedAt || 0;
        }
        mergedSpotify = base;
      }
    }

    const mergedDiscogsIdx = Number(cloudDiscogsIdx?.syncedAt || 0) > Number(localDiscogsIdx?.syncedAt || 0)
      ? cloudDiscogsIdx
      : localDiscogsIdx;

    // Merge syncable preferences (never touching device-specific preferredCameraId or Spotify OAuth tokens)
    if (cloudPrefs && Number(cloudPrefs.cfgUpdatedAt || 0) > Number(CC.cfg.cfgUpdatedAt || 0)) {
      PREF_KEYS.forEach(k => { if (cloudPrefs[k] !== undefined) CC.cfg[k] = cloudPrefs[k]; });
      CC.cfg.cfgUpdatedAt = Number(cloudPrefs.cfgUpdatedAt);
    }
    if (CC.cfg.googleSyncSecrets && cloudSecrets) {
      SECRET_KEYS.forEach(k => {
        const rVal = cloudSecrets[k];
        const lVal = CC.cfg[k];
        const rEmpty = rVal === undefined || rVal === null || rVal === '';
        const lEmpty = lVal === undefined || lVal === null || lVal === '';
        if (!rEmpty && (lEmpty || Number(cloudSecrets._ts || 0) > Number(CC.cfg.cfgUpdatedAt || 0))) {
          CC.cfg[k] = rVal;
        }
      });
    }

    // Persist merged state to IndexedDB (keeping outbox untouched on read-only Load!)
    syncMeta.conflicts = [...syncMeta.conflicts, ...allNewConflicts].slice(-20);
    for (const delId of localIdsToDelete) await CC.idbDelete('stash', delId);
    for (const item of mergedStash) await CC.idbPut('stash', item);
    await CC.idbPut('meta', { key: 'deleted_sync_ids', value: mergedDeleted });
    await CC.idbPut('meta', { key: CLOUD_META_KEY, value: syncMeta });
    if (mergedSpotify) await CC.idbPut('meta', { key: 'spotify_profile', value: mergedSpotify });
    if (mergedDiscogsIdx) await CC.idbPut('meta', { key: 'discogs_collection_index', value: mergedDiscogsIdx });

    CC.cfg.googleBoundEmail = email;
    CC.cfg.googleLastLoadAt = Date.now();
    CC.persistCfg();

    return {
      ok: true,
      status: partialErrors.length ? 'partial' : 'loaded',
      emptyCloud: false,
      email,
      stashCount: mergedStash.length,
      appliedBatches: appliedBatchCount,
      downloadedPhotos,
      deletedCount: localIdsToDelete.length,
      conflicts: allNewConflicts,
      partialErrors,
      spotifyProfile: mergedSpotify,
      discogsCollectionIndex: mergedDiscogsIdx,
      listing
    };
  };

  // Queue unqueued local profile items into outbox (idempotent: never duplicates items already queued in outbox!)
  CC.queueFullLocalProfileToOutbox = async (targetEmail) => {
    const existingOutbox = await CC.getCloudOutbox();
    // If an unacknowledged full-profile seed batch for this account is already queued, reuse its stable batchId!
    if (existingOutbox.some(b => b.isFullSeed && (!b.accountEmail || b.accountEmail === targetEmail))) {
      CC.cfg.googleBoundEmail = targetEmail;
      CC.persistCfg();
      return;
    }

    const queuedSyncIds = new Set();
    const queuedTypes = new Set();
    existingOutbox.forEach(b => {
      (b.ops || []).forEach(op => {
        if (op?.type) queuedTypes.add(op.type);
        if (op?.sync_id) queuedSyncIds.add(op.sync_id);
      });
    });

    const localStash = await CC.idbGetAll('stash');
    const localDeleted = (await CC.idbGet('meta', 'deleted_sync_ids'))?.value || {};
    const localSpotify = (await CC.idbGet('meta', 'spotify_profile'))?.value || null;
    const localDiscogsIdx = (await CC.idbGet('meta', 'discogs_collection_index'))?.value || null;

    const ops = [];
    for (const it of localStash) {
      if (!it.sync_id) {
        it.sync_id = CC.generateSyncId();
        await CC.idbPut('stash', it);
      }
      if (queuedSyncIds.has(it.sync_id)) continue;
      const copy = { ...it };
      delete copy.id;
      ops.push({ type: 'upsert_stash', sync_id: it.sync_id, record: copy });
    }
    Object.entries(localDeleted).forEach(([sid, entry]) => {
      if (!queuedSyncIds.has(sid)) {
        ops.push({ type: 'delete_stash', sync_id: sid, deleted: entry });
      }
    });
    if (localSpotify && !queuedTypes.has('spotify_profile')) {
      ops.push({ type: 'spotify_profile', profile: localSpotify });
    }
    if (localDiscogsIdx && !queuedTypes.has('discogs_index')) {
      ops.push({ type: 'discogs_index', index: localDiscogsIdx });
    }

    if (ops.length > 0 || existingOutbox.length === 0) {
      const outPrefs = { cfgUpdatedAt: Number(CC.cfg.cfgUpdatedAt || Date.now()) };
      PREF_KEYS.forEach(k => { outPrefs[k] = CC.cfg[k]; });
      ops.push({ type: 'prefs', prefs: outPrefs });
    }

    CC.cfg.googleBoundEmail = targetEmail;
    CC.persistCfg();

    if (ops.length > 0) {
      const nextQueue = existingOutbox.slice();
      nextQueue.push({
        batchId: CC.newBatchId(),
        accountEmail: targetEmail,
        createdAt: Date.now(),
        deviceId: CC.getDeviceId(),
        status: 'queued',
        isFullSeed: true,
        ops
      });
      await CC.idbPut('meta', { key: CLOUD_OUTBOX_KEY, value: { queue: nextQueue } });
      CC.setPendingCloudChanges(nextQueue.length);
    }
  };

  // Full Two-Way Sync: pull -> merge -> upload missing photos -> upload immutable v2 batches -> acknowledge only uploaded batches
  CC.syncNowWithGoogleDrive = async (opts = {}) => {
    const { interactive = false, quiet = false, publishInitialLocal = false } = opts || {};
    if (!CC.isGoogleSignedIn()) {
      if (!interactive) {
        const err = new Error('Google Drive session expired — tap Reconnect Google Drive');
        err.code = 'GOOGLE_AUTH_EXPIRED';
        throw err;
      }
      await CC.requestGoogleAccessToken('');
    }

    const report = (msg) => { if (!quiet) statusCb(msg, true); };

    // 1. Always pull & merge first via the single shared pull path
    const pullRes = await CC.pullFromGoogleDrive({ quiet, skipAccountBindOnEmpty: true });
    if (!pullRes.ok) return pullRes; // e.g., account_mismatch

    const email = pullRes.email;
    const fileMap = pullRes.listing.map;
    const existingV2Batches = pullRes.listing.v2Batches;

    if (pullRes.emptyCloud) {
      if (!publishInitialLocal && pullRes.hasLocalData && !CC.cfg.googleBoundEmail) {
        return { ...pullRes, awaitingExplicitPublish: true };
      }
      await CC.queueFullLocalProfileToOutbox(email);
    } else if (!CC.cfg.googleBoundEmail) {
      CC.cfg.googleBoundEmail = email;
      CC.persistCfg();
    }

    // 2. Snapshot current outbox queue and persist 'uploading' state with stable batchIds BEFORE network writes
    const currentOutbox = await CC.getCloudOutbox();
    const batchesToUpload = currentOutbox.map(b => ({ ...b, status: 'uploading' }));
    if (batchesToUpload.length > 0) {
      await CC.idbPut('meta', { key: CLOUD_OUTBOX_KEY, value: { queue: batchesToUpload } });
    }

    let uploadedPhotos = 0;
    let uploadedBatches = 0;
    const uploadedPhotoSet = new Set();

    const uploadPhotoIfMissing = async (val) => {
      const s = String(val || '');
      if (!s.startsWith('data:image/')) return s;
      const fname = await CC.hashDataUrlToFilename(s);
      if (!fileMap.has(fname) && !uploadedPhotoSet.has(fname)) {
        const blob = dataUrlToBlob(s);
        if (blob) {
          report(`☁️ Uploading photo ${uploadedPhotos + 1}...`);
          const created = await uploadAppDataMultipart(fname, blob, blob.type || 'image/webp');
          fileMap.set(fname, { id: created.id, name: fname });
          uploadedPhotoSet.add(fname);
          uploadedPhotos++;
        }
      }
      return `gdrive:${fname}`;
    };

    const dehydrateRecord = async (rec) => {
      const out = { ...rec };
      delete out.id;
      if (Array.isArray(out.thumbs)) {
        const nextT = [];
        for (const t of out.thumbs) nextT.push(await uploadPhotoIfMissing(t));
        out.thumbs = nextT;
      }
      if (out.thumb_data_url) out.thumb_data_url = await uploadPhotoIfMissing(out.thumb_data_url);
      if (out.spine_thumb_url) out.spine_thumb_url = await uploadPhotoIfMissing(out.spine_thumb_url);
      if (out.spine_source_url) out.spine_source_url = await uploadPhotoIfMissing(out.spine_source_url);
      return out;
    };

    const acknowledgedBatchIds = new Set();

    for (let i = 0; i < batchesToUpload.length; i++) {
      const batch = batchesToUpload[i];
      // If a previous interrupted upload already landed under this exact batchId, acknowledge without duplicating!
      if (existingV2Batches.has(batch.batchId)) {
        acknowledgedBatchIds.add(batch.batchId);
        continue;
      }

      const dehydratedOps = [];
      for (const op of (batch.ops || [])) {
        if (op.type === 'upsert_stash' && op.record) {
          dehydratedOps.push({ ...op, record: await dehydrateRecord(op.record) });
        } else {
          dehydratedOps.push(op);
        }
      }

      // Upload immutable v2 batch (NEVER includes credentials or Spotify OAuth tokens!)
      report(`☁️ Uploading sync batch ${i + 1}/${batchesToUpload.length}...`);
      const batchPayload = {
        formatVersion: 2,
        batchId: batch.batchId,
        createdAt: batch.createdAt,
        deviceId: batch.deviceId || CC.getDeviceId(),
        ops: dehydratedOps
      };
      const fname = `ss_v2_batch_${batch.batchId}.json`;
      const created = await uploadAppDataMultipart(
        fname,
        new Blob([JSON.stringify(batchPayload)], { type: 'application/json' }),
        'application/json'
      );
      existingV2Batches.set(batch.batchId, { id: created.id, name: fname, batchId: batch.batchId });
      acknowledgedBatchIds.add(batch.batchId);
      uploadedBatches++;
    }

    // Optional separate secrets batch ONLY when user explicitly opted in
    if (CC.cfg.googleSyncSecrets && (uploadedBatches > 0 || publishInitialLocal)) {
      const secretsObj = {};
      SECRET_KEYS.forEach(k => { secretsObj[k] = CC.cfg[k]; });
      const secBatchId = CC.newBatchId();
      const secBlob = new Blob([JSON.stringify({
        formatVersion: 2,
        batchId: secBatchId,
        cfgUpdatedAt: Number(CC.cfg.cfgUpdatedAt || Date.now()),
        secrets: secretsObj
      })], { type: 'application/json' });
      await uploadAppDataMultipart(`ss_v2_secrets_${secBatchId}.json`, secBlob, 'application/json');
    }

    // 3. Atomically acknowledge ONLY uploaded batchIds, preserving any NEW edits made mid-upload!
    const latestOutbox = await CC.getCloudOutbox();
    const remainingQueue = latestOutbox.filter(b => !acknowledgedBatchIds.has(b.batchId));
    const syncMeta = await CC.getCloudSyncMeta();
    acknowledgedBatchIds.forEach(bid => { syncMeta.appliedBatchIds[bid] = Date.now(); });

    await CC.idbPut('meta', { key: CLOUD_OUTBOX_KEY, value: { queue: remainingQueue } });
    await CC.idbPut('meta', { key: CLOUD_META_KEY, value: syncMeta });
    CC.setPendingCloudChanges(remainingQueue.length);

    CC.cfg.googleLastSyncAt = Date.now();
    CC.persistCfg();

    return {
      ok: true,
      status: pullRes.partialErrors?.length ? 'partial' : 'synced',
      email,
      stashCount: (await CC.idbGetAll('stash')).length,
      appliedBatches: pullRes.appliedBatches || 0,
      uploadedBatches,
      uploadedPhotos,
      downloadedPhotos: pullRes.downloadedPhotos || 0,
      remainingPending: remainingQueue.length,
      conflicts: pullRes.conflicts || [],
      partialErrors: pullRes.partialErrors || [],
      spotifyProfile: pullRes.spotifyProfile || null,
      discogsCollectionIndex: pullRes.discogsCollectionIndex || null
    };
  };

  // Alias for backward compatibility
  CC.syncWithGoogleDrive = CC.syncNowWithGoogleDrive;

  window.CC = CC;
})();
