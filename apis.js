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

  CC.PRIMARY_MEDIA_FORMATS = ['Cassette', 'CD', 'Vinyl'];
  CC.OTHER_MEDIA_FORMATS = [
    '8-Track Cartridge',
    'Reel-To-Reel',
    'MiniDisc',
    'DAT',
    'DVD',
    'VHS',
    'LaserDisc',
    'Blu-ray',
    'Betamax',
    'UMD',
    'Shellac',
    'SACD',
    'File',
    'Box Set'
  ];
  CC.ALL_MEDIA_FORMATS = [...CC.PRIMARY_MEDIA_FORMATS, ...CC.OTHER_MEDIA_FORMATS];

  CC.isPrimaryMediaFormat = (fmt) => {
    const s = String(fmt || '').trim().toLowerCase();
    return CC.PRIMARY_MEDIA_FORMATS.some(f => f.toLowerCase() === s);
  };

  // Normalize Discogs format arrays/strings into Soft Spot's canonical format names.
  // Unifies all Vinyl sizes/variants (LP, 12", 7", 10", Flexi-disc, Lathe Cut) under "Vinyl",
  // while supporting all Other Discogs media formats cleanly.
  CC.normalizeDiscogsFormat = (rawFormats) => {
    const tokens = [];
    const primaryNames = [];
    if (Array.isArray(rawFormats)) {
      rawFormats.forEach(entry => {
        if (!entry) return;
        if (typeof entry === 'string') {
          const s = entry.trim();
          if (s) { tokens.push(s); primaryNames.push(s); }
        } else if (typeof entry === 'object') {
          if (entry.name) { primaryNames.push(String(entry.name).trim()); tokens.push(String(entry.name).trim()); }
          if (Array.isArray(entry.descriptions)) entry.descriptions.forEach(d => { if (d) tokens.push(String(d).trim()); });
          if (entry.text) tokens.push(String(entry.text).trim());
        }
      });
    } else if (typeof rawFormats === 'string' && rawFormats.trim()) {
      tokens.push(rawFormats.trim());
      primaryNames.push(rawFormats.trim());
    }

    const joined = tokens.join(' | ');
    const primaryJoined = primaryNames.join(' | ');
    if (!joined) return 'Unknown';

    // Check specific non-primary / specialized optical/tape/digital formats first so SACD/DVD/LaserDisc/MiniDisc aren't misclassified
    const checkList = (txt) => {
      if (/\b8[\s-]*track\b/i.test(txt)) return '8-Track Cartridge';
      if (/\breel[\s-]*to[\s-]*reel\b/i.test(txt)) return 'Reel-To-Reel';
      if (/\bmini\s*disc\b/i.test(txt)) return 'MiniDisc';
      if (/\b(dat|digital audio tape)\b/i.test(txt)) return 'DAT';
      if (/\blaser\s*disc\b/i.test(txt)) return 'LaserDisc';
      if (/\bblu[\s-]*ray\b/i.test(txt)) return 'Blu-ray';
      if (/\bbetamax\b/i.test(txt)) return 'Betamax';
      if (/\bumd\b/i.test(txt)) return 'UMD';
      if (/\bsacd\b|\bsuper audio cd\b/i.test(txt)) return 'SACD';
      if (/\bdvd\b|\bdvd-video\b|\bdvd-audio\b/i.test(txt)) return 'DVD';
      if (/\bvhs\b/i.test(txt)) return 'VHS';
      if (/\bshellac\b/i.test(txt)) return 'Shellac';
      if (/\bcassette\b|\bmicrocassette\b/i.test(txt)) return 'Cassette';
      if (/\bvinyl\b|\bflexi[\s-]*disc\b|\blathe cut\b|\bacetate\b|\b(7|10|12)"|\b(7|10|12)\s*inch\b|\b\blp\b/i.test(txt)) return 'Vinyl';
      if (/\b(cd|cdr|cd-r|cd-rom|hdcd|cdv|dualdisc|mini cd)\b/i.test(txt)) return 'CD';
      if (/\b(file|flac|wav|mp3|alac|aiff|aac|ogg|digital)\b/i.test(txt)) return 'File';
      if (/\bbox\s*set\b/i.test(txt)) return 'Box Set';
      return '';
    };

    // Evaluate primary Discogs format entries IN ORDER (skipping container names 'Box Set' and 'All Media')
    // so e.g. a CD + DVD combo resolves to 'CD' while standalone DVD/SACD resolves to 'DVD'/'SACD'.
    const orderedPrimary = primaryNames.filter(n => n && !/^box\s*set$/i.test(n) && !/^all media$/i.test(n));
    for (const pName of orderedPrimary) {
      const hit = checkList(pName);
      if (hit) return hit;
    }
    if (orderedPrimary.length > 0) {
      return orderedPrimary[0];
    }

    const fromPrimary = checkList(primaryJoined);
    if (fromPrimary) return fromPrimary;

    const fromAll = checkList(joined);
    if (fromAll) return fromAll;

    return primaryNames[0] || 'Unknown';
  };

  CC.matchesMediaFormat = (rawFormats, targetFormat) => {
    const target = String(targetFormat || '').trim();
    if (!target || target === 'Auto' || target === 'Unknown') return true;
    const rawStr = Array.isArray(rawFormats)
      ? rawFormats.map(f => typeof f === 'string' ? f : [f?.name, ...(f?.descriptions || []), f?.text].filter(Boolean).join(' ')).join(' ')
      : String(rawFormats || '');
    if (!rawStr.trim()) return true;

    const normalized = CC.normalizeDiscogsFormat(rawFormats);
    if (target === 'Other') {
      return !CC.isPrimaryMediaFormat(normalized);
    }
    if (normalized.toLowerCase() === target.toLowerCase()) return true;

    // Secondary check for multi-format releases (e.g., CD + DVD combo pack)
    if (target === 'Cassette') return /\bcassette\b|\bmicrocassette\b/i.test(rawStr);
    if (target === 'CD') return /\b(cd|cdr|cd-r|hdcd|cdv|dualdisc)\b/i.test(rawStr) && !/\bsacd\b/i.test(rawStr);
    if (target === 'Vinyl') return /\b(vinyl|lp|12"|7"|10"|flexi[\s-]*disc|lathe cut|acetate)\b/i.test(rawStr);
    if (target === '8-Track Cartridge') return /\b8[\s-]*track\b/i.test(rawStr);
    if (target === 'Reel-To-Reel') return /\breel[\s-]*to[\s-]*reel\b/i.test(rawStr);
    if (target === 'MiniDisc') return /\bmini\s*disc\b/i.test(rawStr);
    if (target === 'DAT') return /\b(dat|digital audio tape)\b/i.test(rawStr);
    if (target === 'DVD') return /\bdvd\b/i.test(rawStr);
    if (target === 'VHS') return /\bvhs\b/i.test(rawStr);
    if (target === 'LaserDisc') return /\blaser\s*disc\b/i.test(rawStr);
    if (target === 'Blu-ray') return /\bblu[\s-]*ray\b/i.test(rawStr);
    if (target === 'Betamax') return /\bbetamax\b/i.test(rawStr);
    if (target === 'UMD') return /\bumd\b/i.test(rawStr);
    if (target === 'Shellac') return /\bshellac\b/i.test(rawStr);
    if (target === 'SACD') return /\bsacd\b|\bsuper audio cd\b/i.test(rawStr);
    if (target === 'File') return /\b(file|flac|wav|mp3|alac|aiff|aac|ogg)\b/i.test(rawStr);
    if (target === 'Box Set') return /\bbox\s*set\b/i.test(rawStr);
    return rawStr.toLowerCase().includes(target.toLowerCase());
  };

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
    autoCropPhotos: true,
    photoQuality: 'medium',
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

  // 1) Exact/Edition normalizer: strips ONLY non-recording-changing edition/remaster qualifiers
  //    INCLUDING double-hyphen remasters (e.g. "Save a Prayer - 2009 - Remaster", " - Remastered 2015", " - Mono", " - Album Version")
  //    while keeping alternate-recording qualifiers ("Live", "Acoustic", "Demo", "Remix", "Radio Edit", "Single Version") distinct!
  CC.normTrackEdition = (title) => {
    let s = CC.foldText(title || '').trim();
    const editionParenRx = /[\(\[]\s*(?:\d{4}\s*(?:[-–—]\s*)?)?(?:digital\s+|hd\s+|24[\s-]*bit\s+)?(?:remaster(?:ed)?(?:\s*(?:[-–—]\s*)?\d{4})?|mono|stereo|album\s+(?:version|mix)|lp\s+version|bonus\s+track|deluxe(?:\s+edition)?|anniversary(?:\s+edition)?|reissue|original\s+(?:version|mix|album\s+version)|\d{4}\s*(?:[-–—]\s*)?(?:remaster(?:ed)?|mix|version))\s*[\)\]]/gi;
    const editionDashRx = /\s+[-–—]\s+(?:\d{4}\s*(?:[-–—]\s*)?)?(?:digital\s+|hd\s+|24[\s-]*bit\s+)?(?:remaster(?:ed)?(?:\s*(?:[-–—]\s*)?\d{4})?|mono|stereo|album\s+(?:version|mix)|lp\s+version|bonus\s+track|deluxe(?:\s+edition)?|anniversary(?:\s+edition)?|reissue|original\s+(?:version|mix|album\s+version)|\d{4}\s*(?:[-–—]\s*)?(?:remaster(?:ed)?|mix|version))\b.*$/i;
    for (let i = 0; i < 4; i++) {
      const next = s.replace(editionParenRx, ' ').replace(editionDashRx, '').trim();
      if (next === s || !next) break;
      s = next;
    }
    const cleaned = CC.normFull(s);
    return cleaned || CC.normFull(title || '');
  };

  // 2) Loose/Alt-Version normalizer: also strips alternate recording qualifiers
  //    ("Live", "Acoustic", "Unplugged", "Demo", "Remix", "Radio Edit", "Single Version", "Extended", "Club Mix", "Dub")
  CC.normTrackLoose = (title) => {
    let s = CC.foldText(title || '').replace(/\(.*?\)|\[.*?\]/g, ' ').trim();
    const looseDashRx = /\s+[-–—]\s+(?:\d{4}\s*(?:[-–—]\s*)?)?(?:digital\s+|hd\s+|24[\s-]*bit\s+)?(?:remaster(?:ed)?(?:\s*(?:[-–—]\s*)?\d{4})?|radio\s+edit|single\s+(?:version|edit|mix)|album\s+(?:version|mix)|lp\s+version|night\s+version|club\s+(?:version|mix)|dub\s+(?:version|mix)|(?:us|uk)\s+(?:version|mix|edit)|7["']?\s*(?:version|edit|mix)|12["']?\s*(?:version|edit|mix)|mono|stereo|bonus\s+track|edit|extended(?:\s+[a-z0-9'"]+){0,2}\s+(?:version|mix|edit)|extended|original\s+(?:version|mix)|deluxe(?:\s+edition)?|anniversary(?:\s+edition)?|reissue|live(?:\s+at\b.*|\s+in\b.*|\s+from\b.*|\s+version)?|acoustic(?:\s+version)?|unplugged(?:\s+version)?|demo(?:\s+version)?|(?:[a-z0-9']+\s+){0,2}remix|from\s+["'].*|\d{4}\s*(?:[-–—]\s*)?(?:remaster(?:ed)?|mix|version))\b.*$/i;
    for (let i = 0; i < 4; i++) {
      const next = s.replace(looseDashRx, '').trim();
      if (next === s || !next) break;
      s = next;
    }
    const base = CC.norm(s);
    return base || CC.norm(title || '');
  };

  // Backward-compatible alias
  CC.normTrackBase = CC.normTrackEdition;

  // Auto-Match Target Discogs Folder by item format when cfg.discogsFolderId === 'auto'
  CC.resolveTargetDiscogsFolderId = (itemFormat = '', explicitFolderId = null) => {
    const rawTarget = explicitFolderId !== null && explicitFolderId !== undefined && explicitFolderId !== ''
      ? String(explicitFolderId)
      : String(CC.cfg.discogsFolderId || '1');
    if (rawTarget !== 'auto') return rawTarget || '1';

    const normFmt = CC.normalizeDiscogsFormat(itemFormat || '');
    if (!normFmt || normFmt === 'Unknown') return '1';
    const folders = (Array.isArray(CC.cfg.discogsFolders) ? CC.cfg.discogsFolders : []).filter(f => Number(f.id) !== 0 && Number(f.id) !== 1);
    if (!folders.length) return '1';

    const cleanKey = (str) => CC.foldText(str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const stripPlural = (str) => str.replace(/\b(tapes|records|discs|cartridges|cassettes|cds|vinyls|dvds|vhs|blurays|blu rays|minidiscs|box sets|files)\b/g, (m) => {
      const map = { tapes: 'tape', records: 'record', discs: 'disc', cartridges: 'cartridge', cassettes: 'cassette', cds: 'cd', vinyls: 'vinyl', dvds: 'dvd', vhs: 'vhs', blurays: 'blu ray', 'blu rays': 'blu ray', minidiscs: 'minidisc', 'box sets': 'box set', files: 'file' };
      return map[m] || m;
    }).replace(/s\b/g, '').trim();

    const fmtKey = cleanKey(normFmt);
    const fmtSing = stripPlural(fmtKey);
    const shortAliases = {
      '8 track cartridge': ['8 track', '8 tracks', '8track', '8tracks'],
      'reel to reel': ['reel to reel', 'reel', 'reels'],
      'vinyl': ['vinyl', 'vinyls', 'lp', 'lps', 'records'],
      'cassette': ['cassette', 'cassettes', 'tape', 'tapes'],
      'cd': ['cd', 'cds', 'compact disc', 'compact discs'],
      'dvd': ['dvd', 'dvds'],
      'vhs': ['vhs', 'vhs tapes'],
      'blu ray': ['blu ray', 'blu rays', 'bluray', 'blurays'],
      'minidisc': ['minidisc', 'minidiscs', 'mini disc', 'mini discs']
    };
    const candidates = new Set([fmtKey, fmtSing, ...(shortAliases[fmtKey] || [])].filter(Boolean));

    // Pass 1: exact normalized match or singular/plural match
    for (const f of folders) {
      const fk = cleanKey(f.name);
      const fs = stripPlural(fk);
      if (candidates.has(fk) || candidates.has(fs)) return String(f.id);
    }
    // Pass 2: folder name starts with or contains format word cleanly (e.g. "Vinyl Records")
    for (const f of folders) {
      const fk = cleanKey(f.name);
      const words = new Set(fk.split(' ').filter(Boolean));
      for (const c of candidates) {
        if (c.length >= 2 && (words.has(c) || fk.includes(c))) return String(f.id);
      }
    }
    return '1';
  };

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

  // In-process commit mutex: serializes all local IDB read-modify-write commits (NEVER held across network calls!)
  let localCommitChain = Promise.resolve();
  function withLocalCommitLock(fn) {
    const run = () => Promise.resolve().then(fn);
    const p = localCommitChain.then(run, run);
    localCommitChain = p.catch(() => {});
    return p;
  }

  // Canonical physical Discogs copy identity: normalized account + release ID + instance ID (NEVER folder ID!)
  CC.getDiscogsCopyKey = (rec) => {
    if (!rec || rec.discogs_removed) return '';
    const acct = String(rec.discogs_account || '').trim().toLowerCase();
    const relId = Number(rec.discogs_id || 0);
    const instId = Number(rec.discogs_instance_id || 0);
    if (!acct || !Number.isInteger(relId) || relId <= 0 || !Number.isInteger(instId) || instId <= 0) return '';
    return `${acct}|${relId}|${instId}`;
  };

  CC.formatDuplicateRepairSummary = (mergedCount, discogsCopyCount) => {
    if (!mergedCount) return '';
    const noun = mergedCount === 1 ? 'entry' : 'entries';
    const copyNoun = discogsCopyCount === 1 ? 'copy' : 'copies';
    return `Merged ${mergedCount} duplicate Stash ${noun}. ${discogsCopyCount} Discogs ${copyNoun} in Stash.`;
  };

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
    const boundToken = (CC.cfg.discogsToken || '').trim();
    const boundUser = (CC.cfg.discogsUser || '').trim().toLowerCase();
    dQueue.push({ path, params, method, body, boundToken, boundUser, resolve, reject });
    runDQueue();
  });

  async function runDQueue() {
    if (dBusy || !dQueue.length) return;
    dBusy = true;
    const job = dQueue.shift();
    try {
      const isUserScopedPath = /^\/users\/[^/]+(\/|$)/i.test(String(job.path || ''));
      const assertUserBinding = () => {
        if (isUserScopedPath && (
          (CC.cfg.discogsUser || '').trim().toLowerCase() !== job.boundUser ||
          (CC.cfg.discogsToken || '').trim() !== job.boundToken
        )) {
          throw new Error('Discogs account changed while request was queued — aborted safely');
        }
      };

      assertUserBinding();

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

      // Re-verify account binding immediately before initial fetch
      assertUserBinding();

      const url = new URL('https://api.discogs.com' + job.path);
      Object.entries(job.params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
      if (job.boundToken) url.searchParams.set('token', job.boundToken);

      lastDCall = Date.now();
      recentDCalls.push(lastDCall);
      rateCb(CC.getRateCount());

      const fetchOpts = { method: job.method };
      if (job.body !== null && job.body !== undefined) {
        fetchOpts.headers = { 'Content-Type': 'application/json' };
        fetchOpts.body = JSON.stringify(job.body);
      }

      const res = await fetch(url.toString(), fetchOpts);
      if (res.status === 429) {
        statusCb('Discogs rate limit hit — cooling down 60s...', true);
        await CC.sleep(60000);
        // Re-verify account binding immediately after 60s cooldown before sending retry fetch!
        assertUserBinding();
        lastDCall = Date.now();
        recentDCalls.push(lastDCall);
        rateCb(CC.getRateCount());
        const retry = await fetch(url.toString(), fetchOpts);
        if (retry.status === 204) {
          job.resolve({});
        } else if (!retry.ok) {
          const retryErrTxt = await retry.text().catch(() => '');
          const retryErr = new Error(`Discogs HTTP ${retry.status}: ${retryErrTxt.slice(0, 120)}`);
          retryErr.status = retry.status;
          throw retryErr;
        } else {
          job.resolve(await retry.json().catch(() => ({})));
        }
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
        const primaryFmt = CC.normalizeDiscogsFormat(info.formats);
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

  CC.resolveSpineTransform = (srcW, srcH, rotationHint = '', opts = {}) => {
    const { exactAngle = false } = opts || {};
    const w = Math.max(1, Number(srcW) || 1);
    const h = Math.max(1, Number(srcH) || 1);
    const hint = String(rotationHint ?? '').trim().toLowerCase();
    let angleDeg = 0;
    if (hint === '90cw' || hint === '90') angleDeg = 90;
    else if (hint === '90ccw' || hint === '270' || hint === '-90') angleDeg = 270;
    else if (hint === '180') angleDeg = 180;
    else if (hint === '0') angleDeg = exactAngle ? 0 : (h > w ? 90 : 0);
    else angleDeg = h > w ? 90 : 0;
    if (!exactAngle && h > w && (angleDeg === 0 || angleDeg === 180)) angleDeg = 90;
    return { angleDeg, swapDims: angleDeg === 90 || angleDeg === 270 };
  };

  // Reconcile a complete Discogs collection read into local Stash by (discogs_account, discogs_id, discogs_instance_id)
  // Automatically repairs verified duplicates, preserves local edits/photos/notes, and makes ZERO Discogs writes!
  CC.reconcileDiscogsCollectionIntoStash = async (syncResult, opts = {}) => {
    const { confirmMissingOnline = true } = opts || {};
    if (!syncResult || syncResult.complete !== true || !syncResult.account) {
      throw new Error('Incomplete Discogs sync result — local Stash left untouched');
    }
    const account = String(syncResult.account).trim();
    const acctLower = account.toLowerCase();
    const syncedAt = Number(syncResult.syncedAt || Date.now());
    const copies = Array.isArray(syncResult.copies) ? syncResult.copies : [];

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

    const belongsToAccount = (row) => {
      if (!row.discogs_account) return true;
      return String(row.discogs_account).trim().toLowerCase() === acctLower;
    };

    // Phase 1 (Network ONLY, outside commit lock): confirm any missing previously-linked copies live on Discogs
    const preStash = await CC.idbGetAll('stash');
    const liveMissingCheck = new Map(); // `${relId}:${instId||'none'}` -> { status: 'missing'|'present'|'error', folderId? }
    if (confirmMissingOnline) {
      const checkedKeys = new Set();
      for (const row of preStash) {
        if (!row.synced_to_discogs || !row.discogs_id || !belongsToAccount(row)) continue;
        if (row.discogs_instance_id && remoteByKey.has(copyKey(row.discogs_id, row.discogs_instance_id))) continue;
        if (!row.discogs_instance_id && (remoteByRel.get(Number(row.discogs_id)) || []).length > 0) continue;
        const ck = `${Number(row.discogs_id)}:${row.discogs_instance_id ? Number(row.discogs_instance_id) : 'none'}`;
        if (checkedKeys.has(ck)) continue;
        checkedKeys.add(ck);
        try {
          const liveInsts = await CC.findDiscogsInstances(row.discogs_id, { throwOnError: true });
          if (row.discogs_instance_id) {
            const stillThere = liveInsts.find(r => Number(r.instance_id) === Number(row.discogs_instance_id));
            if (stillThere) {
              liveMissingCheck.set(ck, { status: 'present', folderId: String(stillThere.folder_id ?? '1') });
            } else {
              liveMissingCheck.set(ck, { status: 'missing' });
            }
          } else {
            liveMissingCheck.set(ck, { status: liveInsts.length === 0 ? 'missing' : 'present' });
          }
        } catch (_) {
          liveMissingCheck.set(ck, { status: 'error' });
        }
      }
    }

    // Phase 2 (Fast Atomic Commit inside commit lock against LATEST local IndexedDB state!)
    return withLocalCommitLock(async () => {
      const rawLocalStash = await CC.idbGetAll('stash');
      const existingAliases = await CC.getSyncIdAliases();
      const outboxBefore = await CC.getCloudOutbox();

      const preNormalized = rawLocalStash.map(it => (it.sync_id ? it : { ...it, sync_id: CC.generateSyncId() }));

      // Step A: Automatically merge any existing verified duplicates by (discogs_account, discogs_id, discogs_instance_id)
      const repair = CC.dedupeAndMergeStashRecords(preNormalized, existingAliases);
      const localStash = repair.records;
      const mergedAliases = repair.aliases;
      const localIdsToDelete = [...repair.duplicateLocalIdsToDelete];
      const repairedSyncIds = new Set(repair.repairedSurvivors.map(r => r.sync_id));

      const claimedRemoteKeys = new Set();
      const matchedLocalIds = new Set();
      const toPutBySync = new Map();
      repair.repairedSurvivors.forEach(s => toPutBySync.set(s.sync_id, s));

      let addedCount = 0;
      let movedCount = 0;
      let updatedCount = 0;
      let removedCount = 0;
      let ambiguousCount = 0;

      // Pass 1: Exact match by (discogs_account, discogs_id, discogs_instance_id) — excluding folder ID!
      for (const row of localStash) {
        if (!row.discogs_id || !row.discogs_instance_id || !belongsToAccount(row)) continue;
        const k = copyKey(row.discogs_id, row.discogs_instance_id);
        const rem = remoteByKey.get(k);
        if (!rem) continue;

        claimedRemoteKeys.add(k);
        if (row.id !== undefined) matchedLocalIds.add(row.id);

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
          toPutBySync.set(stamped.sync_id, stamped);
          if (changedFolder) movedCount++;
          else updatedCount++;
        } else if (repairedSyncIds.has(row.sync_id)) {
          toPutBySync.set(row.sync_id, row);
        }
      }

      // Pass 2: Legacy release-only local rows (synced_to_discogs without discogs_instance_id)
      const ambiguousRelIds = new Set();
      for (const row of localStash) {
        if (row.id !== undefined && matchedLocalIds.has(row.id)) continue;
        if (!row.synced_to_discogs || !row.discogs_id || row.discogs_instance_id || !belongsToAccount(row)) continue;

        const unclaimed = (remoteByRel.get(Number(row.discogs_id)) || [])
          .filter(c => !claimedRemoteKeys.has(copyKey(c.discogs_id, c.discogs_instance_id)));

        if (unclaimed.length === 1) {
          const rem = unclaimed[0];
          const k = copyKey(rem.discogs_id, rem.discogs_instance_id);
          claimedRemoteKeys.add(k);
          if (row.id !== undefined) matchedLocalIds.add(row.id);
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
          toPutBySync.set(stamped.sync_id, stamped);
          if (prevFolder && prevFolder !== nextFolder) movedCount++;
          else updatedCount++;
        } else if (unclaimed.length > 1) {
          if (row.id !== undefined) matchedLocalIds.add(row.id);
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
          toPutBySync.set(stamped.sync_id, stamped);
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
          discogs_details_synced_at: 0,
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
        toPutBySync.set(fresh.sync_id, fresh);
        addedCount++;
      }

      // Pass 4: Missing previously-linked copies of the SAME account -> use pre-checked live result
      for (const row of localStash) {
        if (row.id !== undefined && matchedLocalIds.has(row.id)) continue;
        if (!row.synced_to_discogs || !row.discogs_id || !belongsToAccount(row)) continue;

        const ck = `${Number(row.discogs_id)}:${row.discogs_instance_id ? Number(row.discogs_instance_id) : 'none'}`;
        let confirmedMissing = !confirmMissingOnline;
        if (confirmMissingOnline) {
          const chk = liveMissingCheck.get(ck);
          if (chk?.status === 'present' && chk.folderId) {
            const nextFolder = chk.folderId;
            const next = {
              ...row,
              discogs_account: account,
              discogs_folder_id: nextFolder,
              discogs_folder_verified_at: syncedAt,
              discogs_removed: false,
              discogs_removed_at: null
            };
            const stamped = CC.stampStashRevision(next, row, ['discogs_account', 'discogs_folder_id', 'discogs_folder_verified_at', 'discogs_removed', 'discogs_removed_at']);
            toPutBySync.set(stamped.sync_id, stamped);
            if (String(row.discogs_folder_id || '') !== nextFolder) movedCount++;
            continue;
          }
          confirmedMissing = chk?.status === 'missing';
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
          toPutBySync.set(stamped.sync_id, stamped);
          removedCount++;
        }
      }

      const toPut = Array.from(toPutBySync.values());
      const ops = [];
      for (const [retiredSid, entry] of Object.entries(repair.newAliases)) {
        ops.push({
          type: 'retire_sync_id',
          retired_sync_id: retiredSid,
          target_sync_id: entry.targetSyncId,
          copy_key: entry.copyKey,
          retired_at: entry.retiredAt,
          rev: entry.rev
        });
      }
      toPut.forEach(rec => {
        const c = { ...rec };
        delete c.id;
        ops.push({ type: 'upsert_stash', sync_id: rec.sync_id, record: c });
      });
      if (syncResult.collectionIndex) {
        ops.push({ type: 'discogs_index', index: syncResult.collectionIndex });
      }

      let nextQueueLen = null;
      await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
        for (const delId of localIdsToDelete) stashStore.delete(delId);
        for (const rec of toPut) stashStore.put(rec);
        if (Object.keys(repair.newAliases).length > 0) {
          metaStore.put({ key: SYNC_ID_ALIASES_KEY, value: mergedAliases });
        }
        if (syncResult.collectionIndex) {
          metaStore.put({ key: 'discogs_collection_index', value: syncResult.collectionIndex });
        }
        if (ops.length > 0) {
          const outReq = metaStore.get(CLOUD_OUTBOX_KEY);
          outReq.onsuccess = () => {
            const liveQ = Array.isArray(outReq.result?.value?.queue) ? outReq.result.value.queue.slice() : [];
            liveQ.push({
              batchId: CC.newBatchId(),
              accountEmail: CC.cfg.googleBoundEmail || CC.cfg.googleEmail || '',
              createdAt: syncedAt,
              deviceId: CC.getDeviceId(),
              status: 'queued',
              ops
            });
            metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: liveQ } });
            nextQueueLen = liveQ.length;
          };
        }
      });
      if (nextQueueLen !== null) CC.setPendingCloudChanges(nextQueueLen);

      CC.cfg.discogsFolders = syncResult.folders;
      CC.cfg.discogsLastSyncAt = syncedAt;
      if (String(CC.cfg.discogsFolderId) !== 'auto' && !syncResult.folders.some(f => String(f.id) === String(CC.cfg.discogsFolderId))) {
        CC.cfg.discogsFolderId = '1';
      }
      CC.persistCfg();

      const finalStash = await CC.idbGetAll('stash');
      const discogsCopyCount = finalStash.filter(x => x.synced_to_discogs && !x.discogs_removed && x.discogs_id && x.discogs_instance_id).length;

      return {
        account,
        folders: syncResult.folders,
        collectionIndex: syncResult.collectionIndex,
        addedCount,
        movedCount,
        updatedCount,
        removedCount,
        ambiguousCount,
        mergedDuplicateCount: repair.mergedDuplicateCount,
        discogsCopyCount,
        repairSummary: CC.formatDuplicateRepairSummary(repair.mergedDuplicateCount, discogsCopyCount),
        totalCopies: copies.length,
        syncedAt
      };
    });
  };

  CC.syncDiscogsCollectionIndex = async () => {
    const res = await CC.syncDiscogsCollectionFull();
    return res.collectionIndex;
  };

  // ==================== DISCOGS RELEASE DETAIL HYDRATION & DELETE-FROM-BOTH ====================
  let discogsEnrichCancelled = false;
  let discogsEnrichRunning = false;

  CC.cancelDiscogsEnrich = () => {
    discogsEnrichCancelled = true;
  };
  CC.isDiscogsEnrichRunning = () => Boolean(discogsEnrichRunning);

  function cleanDiscogsArtistsArr(arr) {
    return (Array.isArray(arr) ? arr : [])
      .map(a => String(a?.name || '').replace(/\s*\(\d+\)$/, '').trim())
      .filter(Boolean)
      .join(', ');
  }

  function buildDiscogsPressingNotes(release) {
    if (!release) return '';
    const notesParts = [];
    if (Array.isArray(release.formats) && release.formats.length) {
      notesParts.push('Format: ' + release.formats.map(f => [f.name, ...(f.descriptions || []), f.text || ''].filter(Boolean).join(', ')).join(' | '));
    }
    if (release.notes) notesParts.push('\nNotes:\n' + release.notes);
    if (Array.isArray(release.identifiers) && release.identifiers.length) {
      notesParts.push('\nIdentifiers:\n' + release.identifiers.map(x => `• ${x.type}${x.description ? ` (${x.description})` : ''}: ${x.value}`).join('\n'));
    }
    if (Array.isArray(release.companies) && release.companies.length) {
      notesParts.push('\nCompanies:\n' + release.companies.map(c => `• ${c.entity_type_name}: ${c.name}`).join('\n'));
    }
    return notesParts.join('\n').trim();
  }

  // Fetch full Discogs release metadata, tracklist, marketplace stats & VG+ price suggestion for a single release ID
  CC.hydrateDiscogsReleaseDetails = async (releaseId, opts = {}) => {
    const id = Number(releaseId || 0);
    if (!id) throw new Error('Invalid Discogs release ID');
    const { forceRefresh = false } = opts || {};

    if (forceRefresh) CC.releaseDetailCache.delete(id);
    const release = await CC.getReleaseCached(id);

    let statsOk = false;
    let stats = null;
    try {
      const sRes = await CC.discogsFetch(`/marketplace/stats/${id}`);
      if (sRes && typeof sRes === 'object') {
        stats = sRes;
        statsOk = true;
      }
    } catch (_) {
      statsOk = false;
      stats = null;
    }

    let suggestionsOk = false;
    let suggestions = null;
    if (CC.cfg.fetchVgSuggestions !== false) {
      try {
        const sugRes = await CC.discogsFetch(`/marketplace/price_suggestions/${id}`);
        if (sugRes && typeof sugRes === 'object') {
          suggestions = sugRes;
          suggestionsOk = true;
        }
      } catch (_) {
        suggestionsOk = false;
        suggestions = null;
      }
    }

    const tracklist = (release.tracklist || [])
      .filter(t => t && t.type_ !== 'heading' && String(t.title || '').trim())
      .map(t => ({
        pos: t.position || '',
        artist: cleanDiscogsArtistsArr(t.artists),
        title: String(t.title || '').trim()
      }));

    const lowestPrice = statsOk ? (stats?.lowest_price?.value ?? release.lowest_price ?? null) : null;
    const lowestCurrency = statsOk ? (stats?.lowest_price?.currency || 'USD') : 'USD';
    const numForSale = statsOk ? (stats?.num_for_sale ?? release.num_for_sale ?? 0) : null;
    const vgPlusPrice = suggestionsOk ? (suggestions?.['Very Good Plus (VG+)']?.value ?? null) : null;
    const vgPlusCurrency = suggestionsOk ? (suggestions?.['Very Good Plus (VG+)']?.currency || lowestCurrency || 'USD') : 'USD';
    const estPrice = statsOk ? (vgPlusPrice ?? lowestPrice) : null;
    const estCurrency = statsOk ? (vgPlusPrice !== null ? vgPlusCurrency : lowestCurrency) : 'USD';
    const estUsd = statsOk ? CC.toApproxUsd(estPrice, estCurrency) : null;
    const have = Number(release.community?.have ?? 0);
    const want = Number(release.community?.want ?? 0);
    const isHighValue = statsOk ? (estUsd !== null && estUsd >= Number(CC.cfg.threshold || 20)) : false;
    const isScarce = statsOk ? (numForSale === 0 && (want >= 10 || (want > have && want >= 5))) : false;

    return {
      discogs_id: id,
      master_id: Number(release.master_id || 0) || null,
      title: String(release.title || '').trim(),
      artist: cleanDiscogsArtistsArr(release.artists),
      catno: release.labels?.[0]?.catno || '',
      label: release.labels?.[0]?.name || '',
      format: CC.normalizeDiscogsFormat(release.formats),
      year: release.year ? String(release.year) : '',
      country: release.country || '',
      genres: [...(release.genres || []), ...(release.styles || [])],
      tracklist,
      pressing_notes: buildDiscogsPressingNotes(release),
      discogs_thumb: release.thumb || release.images?.[0]?.uri150 || '',
      discogs_url: release.uri || `https://www.discogs.com/release/${id}`,
      stats_ok: statsOk,
      suggestions_ok: suggestionsOk,
      lowest_price: lowestPrice,
      lowest_currency: lowestCurrency,
      vg_plus_price: vgPlusPrice,
      vg_plus_currency: vgPlusCurrency,
      est_price: estPrice,
      est_currency: estCurrency,
      est_usd: estUsd,
      num_for_sale: numForSale,
      have,
      want,
      is_high_value: isHighValue,
      is_scarce: isScarce,
      discogs_details_synced_at: Date.now()
    };
  };

  function needsDiscogsDetailHydration(it) {
    if (!it || !Number(it.discogs_id || 0)) return false;
    if (Number(it.discogs_details_synced_at || 0) > 0) return false;
    return true;
  }

  // Hydrate missing tracklists, pressing notes, country, and marketplace values for Discogs-linked Stash items.
  // Deduplicates by discogs_id, respects the 58/min rate limiter, preserves last known prices when stats fail,
  // commits Stash rows incrementally without touching local photos/grades/notes, and enqueues ONE combined Drive outbox batch!
  CC.enrichSyncedDiscogsStashItems = async (opts = {}) => {
    const {
      stashIds = null,
      releaseIds = null,
      forceRefresh = false,
      quiet = false,
      onItemUpdated = null
    } = opts || {};

    if (!CC.cfg.discogsToken) {
      return { hydratedReleases: 0, updatedRows: 0, failedReleases: 0, statsFailedReleases: 0, cancelled: false, totalTargets: 0 };
    }

    const stashIdSet = Array.isArray(stashIds) ? new Set(stashIds.map(Number)) : null;
    const relIdSet = Array.isArray(releaseIds) ? new Set(releaseIds.map(Number)) : null;
    const allBefore = await CC.idbGetAll('stash');

    const targetRelIds = [];
    const seenRel = new Set();
    for (const it of allBefore) {
      const rid = Number(it.discogs_id || 0);
      if (!rid) continue;
      if (stashIdSet && !stashIdSet.has(Number(it.id))) continue;
      if (relIdSet && !relIdSet.has(rid)) continue;
      if (!forceRefresh && !needsDiscogsDetailHydration(it)) continue;
      if (!seenRel.has(rid)) {
        seenRel.add(rid);
        targetRelIds.push(rid);
      }
    }

    if (!targetRelIds.length) {
      return { hydratedReleases: 0, updatedRows: 0, failedReleases: 0, statsFailedReleases: 0, cancelled: false, totalTargets: 0 };
    }

    discogsEnrichCancelled = false;
    discogsEnrichRunning = true;
    let hydratedReleases = 0;
    let updatedRows = 0;
    let failedReleases = 0;
    let statsFailedReleases = 0;
    const runOutboxOpsBySync = new Map();

    try {
      for (let i = 0; i < targetRelIds.length; i++) {
        if (discogsEnrichCancelled) break;
        const rid = targetRelIds[i];
        if (!quiet) {
          statusCb(
            `🎵 Loading Discogs tracklists & values (${i + 1}/${targetRelIds.length}) · API ${CC.getRateCount()}/58...`,
            true,
            { cancellable: true }
          );
        }

        let details = null;
        try {
          details = await CC.hydrateDiscogsReleaseDetails(rid, { forceRefresh });
        } catch (_) {
          failedReleases++;
          continue;
        }
        if (discogsEnrichCancelled) break;
        if (!details.stats_ok) statsFailedReleases++;

        // Atomically apply hydrated fields to ALL Stash rows matching this releaseId,
        // strictly preserving local photos, spine, grades, notes, taste, folder, AND last-known prices when stats_ok === false!
        const appliedCount = await withLocalCommitLock(async () => {
          const curStash = await CC.idbGetAll('stash');
          const matching = curStash.filter(x => {
            if (Number(x.discogs_id || 0) !== rid) return false;
            if (stashIdSet && !stashIdSet.has(Number(x.id))) return false;
            return true;
          });
          if (!matching.length) return 0;

          const toPut = [];
          for (const row of matching) {
            const next = { ...row };
            const changed = [];
            const applyIfVal = (field, val, onlyIfEmpty = false) => {
              if (val === undefined) return;
              if (onlyIfEmpty && next[field]) return;
              if (JSON.stringify(next[field]) !== JSON.stringify(val)) {
                next[field] = val;
                changed.push(field);
              }
            };

            applyIfVal('tracklist', details.tracklist, false);
            applyIfVal('pressing_notes', details.pressing_notes, false);
            applyIfVal('country', details.country, !details.country);
            if (details.year) applyIfVal('year', details.year, true);
            if (details.label) applyIfVal('label', details.label, true);
            if (details.catno) applyIfVal('catno', details.catno, true);
            if (details.master_id) applyIfVal('master_id', details.master_id, true);
            if (details.genres?.length) applyIfVal('genres', details.genres, false);
            if (details.format) applyIfVal('format', details.format, false);
            if (details.discogs_thumb) {
              applyIfVal('discogs_thumb', details.discogs_thumb, true);
              if (!next.thumb_data_url) applyIfVal('thumb_data_url', details.discogs_thumb, true);
            }
            if (details.discogs_url) applyIfVal('discogs_url', details.discogs_url, true);

            applyIfVal('have', details.have, false);
            applyIfVal('want', details.want, false);

            if (details.suggestions_ok) {
              applyIfVal('vg_plus_price', details.vg_plus_price, false);
              applyIfVal('vg_plus_currency', details.vg_plus_currency, false);
            }
            if (details.stats_ok) {
              applyIfVal('lowest_price', details.lowest_price, false);
              applyIfVal('lowest_currency', details.lowest_currency, false);
              applyIfVal('num_for_sale', details.num_for_sale, false);
              applyIfVal('is_scarce', details.is_scarce, false);

              const effVgPrice = details.suggestions_ok ? details.vg_plus_price : (next.vg_plus_price ?? null);
              const effVgCur = details.suggestions_ok ? details.vg_plus_currency : (next.vg_plus_currency || details.lowest_currency || 'USD');
              const effEstPrice = effVgPrice ?? details.lowest_price;
              const effEstCur = effVgPrice !== null ? effVgCur : details.lowest_currency;
              const effEstUsd = CC.toApproxUsd(effEstPrice, effEstCur);
              const effHighVal = effEstUsd !== null && effEstUsd >= Number(CC.cfg.threshold || 20);

              applyIfVal('est_price', effEstPrice, false);
              applyIfVal('est_currency', effEstCur, false);
              applyIfVal('est_usd', effEstUsd, false);
              applyIfVal('is_high_value', effHighVal, false);
            }

            applyIfVal('discogs_details_synced_at', details.discogs_details_synced_at, false);

            const stamped = CC.stampStashRevision(next, row, changed.length ? changed : ['discogs_details_synced_at']);
            toPut.push(stamped);
            const opCopy = { ...stamped };
            delete opCopy.id;
            runOutboxOpsBySync.set(stamped.sync_id, { type: 'upsert_stash', sync_id: stamped.sync_id, record: opCopy });
          }

          await CC.idbAtomicWrite(({ stashStore }) => {
            for (const rec of toPut) stashStore.put(rec);
          });
          return toPut.length;
        });

        hydratedReleases++;
        updatedRows += appliedCount;
        if (typeof onItemUpdated === 'function') {
          try { await onItemUpdated({ releaseId: rid, details, index: i + 1, total: targetRelIds.length }); } catch (_) {}
        }
      }

      return {
        hydratedReleases,
        updatedRows,
        failedReleases,
        statsFailedReleases,
        cancelled: Boolean(discogsEnrichCancelled),
        totalTargets: targetRelIds.length
      };
    } finally {
      if (runOutboxOpsBySync.size > 0) {
        try {
          await withLocalCommitLock(async () => {
            // Re-read LIVE IndexedDB stash, tombstones & outbox inside ONE readwrite transaction
            // so concurrent tabs or mid-hydration deletions can never be overwritten or resurrected!
            let finalPending = null;
            await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
              const stashReq = stashStore.getAll();
              stashReq.onsuccess = () => {
                const liveStash = stashReq.result || [];
                readMetaInTx(metaStore, ['deleted_sync_ids', CLOUD_OUTBOX_KEY], (m) => {
                  const liveDeleted = m.deleted_sync_ids || {};
                  const liveBySync = new Map();
                  liveStash.forEach(x => { if (x?.sync_id) liveBySync.set(x.sync_id, x); });

                  const freshOps = [];
                  for (const [sid] of runOutboxOpsBySync.entries()) {
                    const liveRec = liveBySync.get(sid);
                    if (!liveRec) continue;
                    const delTs = normTombstoneTs(liveDeleted[sid]);
                    const recTs = Number(liveRec.updated_at || liveRec.created_at || 0);
                    if (delTs > 0 && delTs >= recTs) continue;
                    const opCopy = { ...liveRec };
                    delete opCopy.id;
                    freshOps.push({ type: 'upsert_stash', sync_id: sid, record: opCopy });
                  }

                  if (freshOps.length > 0) {
                    const liveQ = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue.slice() : [];
                    liveQ.push({
                      batchId: CC.newBatchId(),
                      accountEmail: CC.cfg.googleBoundEmail || CC.cfg.googleEmail || '',
                      createdAt: Date.now(),
                      deviceId: CC.getDeviceId(),
                      status: 'queued',
                      ops: freshOps
                    });
                    metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: liveQ } });
                    finalPending = liveQ.length;
                  }
                });
              };
            });
            if (finalPending !== null) CC.setPendingCloudChanges(finalPending);
          });
        } catch (_) {}
      }
      discogsEnrichRunning = false;
    }
  };

  // Delete a Discogs-synced copy from BOTH Discogs AND Local Stash (+ Drive tombstone).
  // Enforces Discogs account ownership, confirms live folder & instance first so remote folder moves work cleanly,
  // and refuses to guess on ambiguous legacy multi-copy items!
  CC.deleteDiscogsAndStashCopy = async (stashItem, opts = {}) => {
    const { deleteRemote = true } = opts || {};
    if (!stashItem) throw new Error('Stash item not found');

    const isSynced = Boolean(stashItem.synced_to_discogs && !stashItem.discogs_removed && stashItem.discogs_id);
    let remoteStatus = 'local_only';
    let deletedInstanceId = null;
    let deletedFolderId = null;

    if (deleteRemote && isSynced) {
      const account = (CC.cfg.discogsUser || '').trim();
      if (!account || !CC.cfg.discogsToken) {
        throw new Error('Connect and verify your Discogs account in Settings to delete this synced copy from Discogs');
      }
      const itemAcct = String(stashItem.discogs_account || '').trim();
      const instNum = Number(stashItem.discogs_instance_id);
      const hasValidInst = Number.isInteger(instNum) && instNum > 0;
      if (!itemAcct || !hasValidInst) {
        throw new Error('This synced copy is missing a verified Discogs account or exact instance ID — run Sync with Discogs first to link the exact copy safely before deleting from Discogs.');
      }
      if (itemAcct.toLowerCase() !== account.toLowerCase()) {
        throw new Error(`This copy belongs to Discogs account @${itemAcct}, not @${account} — switch accounts or delete locally only.`);
      }

      const verifySameAccount = () => {
        if ((CC.cfg.discogsUser || '').trim().toLowerCase() !== account.toLowerCase()) {
          throw new Error('Discogs account changed during delete — aborted safely');
        }
      };

      const relId = Number(stashItem.discogs_id);
      const liveInsts = await CC.findDiscogsInstances(relId, { throwOnError: true });
      verifySameAccount();

      const live = liveInsts.find(r => Number(r.instance_id) === instNum);
      if (live) {
        const actualFolderId = String(live.folder_id ?? stashItem.discogs_folder_id ?? '1');
        verifySameAccount();
        await CC.deleteDiscogsInstance(actualFolderId, relId, instNum);
        remoteStatus = 'deleted_remote';
        deletedInstanceId = instNum;
        deletedFolderId = actualFolderId;
      } else {
        // Already absent on Discogs — safe to remove locally without failing
        remoteStatus = 'already_absent';
      }
    }

    // Only remove locally + tombstone to Drive AFTER Discogs deletion succeeded (or confirmed already absent / local-only)
    await CC.commitLocalMutation({
      deleteStash: { id: stashItem.id, sync_id: stashItem.sync_id || null },
      queueOutbox: Boolean(stashItem.sync_id)
    });

    // Keep cached discogs_collection_index consistent if this was the last local copy of that release
    if (isSynced && stashItem.discogs_id) {
      try {
        const remaining = await CC.idbGetAll('stash');
        const stillHasRel = remaining.some(x => x.synced_to_discogs && !x.discogs_removed && Number(x.discogs_id) === Number(stashItem.discogs_id));
        const idxRec = await CC.idbGet('meta', 'discogs_collection_index');
        if (idxRec?.value) {
          const idx = { ...idxRec.value };
          idx.totalItems = Math.max(0, Number(idx.totalItems || 1) - 1);
          if (!stillHasRel && Array.isArray(idx.releaseIds)) {
            idx.releaseIds = idx.releaseIds.filter(r => Number(r) !== Number(stashItem.discogs_id));
          }
          await CC.idbPut('meta', { key: 'discogs_collection_index', value: idx });
        }
      } catch (_) {}
    }

    return {
      ok: true,
      remoteStatus,
      deletedInstanceId,
      deletedFolderId
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

  function repairJsonStringAware(str) {
    const src = String(str || '');
    const out = [];
    let inString = false;
    let escaped = false;
    const len = src.length;

    for (let i = 0; i < len; i++) {
      const ch = src[i];
      const code = src.charCodeAt(i);

      if (inString) {
        if (escaped) {
          out.push(ch);
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          out.push(ch);
          escaped = true;
          continue;
        }
        if (ch === '"') {
          out.push(ch);
          inString = false;
          continue;
        }
        // Escape raw newlines/tabs inside strings; strip other unescaped ASCII control chars
        if (code < 0x20) {
          if (ch === '\n') out.push('\\n');
          else if (ch === '\r') out.push('\\r');
          else if (ch === '\t') out.push('\\t');
          continue;
        }
        out.push(ch);
        continue;
      }

      if (ch === '"') {
        inString = true;
        out.push(ch);
        continue;
      }

      // Outside strings: drop raw non-whitespace ASCII control chars
      if (code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r') {
        continue;
      }

      // Outside strings: remove trailing commas immediately before '}' or ']'
      if (ch === ',') {
        let j = i + 1;
        while (j < len) {
          const nc = src[j];
          const ncode = src.charCodeAt(j);
          if (nc === ' ' || nc === '\t' || nc === '\n' || nc === '\r' || ncode < 0x20) {
            j++;
            continue;
          }
          break;
        }
        if (j < len && (src[j] === '}' || src[j] === ']')) {
          continue;
        }
      }

      out.push(ch);
    }

    return out.join('').trim();
  }

  function stripLeadingThinkAndFences(str) {
    let s = String(str || '').trim();
    let prev;
    do {
      prev = s;
      // Strip ONLY leading outside-JSON <think>...</think> wrappers and outer code fences (never touch text inside quoted JSON strings!)
      s = s.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '');
      s = s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    } while (s !== prev);
    return s;
  }

  function cleanJsonText(raw, opts = {}) {
    const { expectedRootType = 'object', validate = null } = (opts && typeof opts === 'object') ? opts : {};
    const throwParseErr = (msg = 'Could not parse AI JSON response') => {
      const err = new Error(msg);
      err.code = 'AI_JSON_PARSE';
      throw err;
    };

    const matchesExpected = (val) => {
      if (expectedRootType === 'object') {
        if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
      } else if (expectedRootType === 'array') {
        if (!Array.isArray(val)) return false;
      }
      if (typeof validate === 'function') {
        try {
          if (!validate(val)) return false;
        } catch (_) {
          return false;
        }
      }
      return true;
    };

    const rawTrimmed = String(raw || '').trim();
    if (!rawTrimmed) throwParseErr();

    // 1. Try strict JSON.parse FIRST before stripping <think> so literal "<think>...</think>" inside quoted strings is preserved verbatim!
    let rawParsedOk = false;
    let rawParsedVal = null;
    try {
      rawParsedVal = JSON.parse(rawTrimmed);
      rawParsedOk = true;
    } catch (_) {}
    if (rawParsedOk) {
      if (matchesExpected(rawParsedVal)) return rawParsedVal;
      // Valid JSON whose root type/validation fails (e.g. Array when expecting Object) -> throw immediately, NEVER extract inner {...}!
      throwParseErr('AI JSON root shape did not match expected schema');
    }

    // 2. Strip ONLY leading <think>...</think> wrappers and outer code fences, then try strict + string-aware repaired full parse
    const cleaned = stripLeadingThinkAndFences(rawTrimmed);
    if (!cleaned) throwParseErr();

    for (const fullCand of [cleaned, repairJsonStringAware(cleaned)]) {
      let parsedOk = false;
      let parsedVal = null;
      try {
        parsedVal = JSON.parse(fullCand);
        parsedOk = true;
      } catch (_) {}
      if (parsedOk) {
        if (matchesExpected(parsedVal)) return parsedVal;
        // Full text parsed as valid JSON with wrong root type / failed validation -> throw immediately!
        throwParseErr('AI JSON root shape did not match expected schema');
      }
    }

    // 3. Only extract a substring when there is non-JSON wrapper text whose FIRST structural character matches expectedRootType
    const firstObj = cleaned.indexOf('{');
    const lastObj = cleaned.lastIndexOf('}');
    const firstArr = cleaned.indexOf('[');
    const lastArr = cleaned.lastIndexOf(']');
    let span = '';

    if (expectedRootType === 'object') {
      if (firstObj !== -1 && lastObj > firstObj && (firstArr === -1 || firstObj < firstArr)) {
        span = cleaned.slice(firstObj, lastObj + 1);
      }
    } else if (expectedRootType === 'array') {
      if (firstArr !== -1 && lastArr > firstArr && (firstObj === -1 || firstArr < firstObj)) {
        span = cleaned.slice(firstArr, lastArr + 1);
      }
    } else {
      if (firstArr !== -1 && lastArr > firstArr && (firstObj === -1 || firstArr < firstObj)) {
        span = cleaned.slice(firstArr, lastArr + 1);
      } else if (firstObj !== -1 && lastObj > firstObj) {
        span = cleaned.slice(firstObj, lastObj + 1);
      }
    }

    if (span) {
      for (const sCand of [span, repairJsonStringAware(span)]) {
        try {
          const parsed = JSON.parse(sCand);
          if (matchesExpected(parsed)) return parsed;
        } catch (_) {}
      }
    }

    throwParseErr();
  }
  CC.cleanJsonText = cleanJsonText;

  async function runGeminiRequest(parts, thinkingLevel, opts = {}) {
    const {
      expectJSON = true,
      retryLabel = 'Gemini',
      maxOutputTokens = null,
      mediaResolution = null,
      expectedRootType = 'object',
      validate = null
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
    let jsonRetry = 0;
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
          for (let sec = 5; sec >= 1; sec--) {
            statusCb(`${retryLabel}: connection hiccup — retrying in ${sec}s (try #${attempt + 1})...`, true, { cancellable: true });
            await CC.sleep(1000, signal);
          }
          continue;
        }

        if ([500, 502, 503, 504].includes(res.status)) {
          for (let sec = 5; sec >= 1; sec--) {
            statusCb(`${retryLabel} busy (HTTP ${res.status}) — retrying in ${sec}s (try #${attempt + 1})...`, true, { cancellable: true });
            await CC.sleep(1000, signal);
          }
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

        const finishReason = data.candidates?.[0]?.finishReason || '';
        let parseErr = null;
        if (finishReason === 'MAX_TOKENS') {
          parseErr = new Error('AI JSON response truncated (MAX_TOKENS)');
          parseErr.code = 'AI_JSON_PARSE';
        } else {
          try {
            return cleanJsonText(raw, { expectedRootType, validate });
          } catch (e) {
            parseErr = e;
          }
        }

        if (parseErr && parseErr.code === 'AI_JSON_PARSE' && jsonRetry < 2) {
          jsonRetry++;
          statusCb(`${retryLabel}: malformed AI JSON — retrying (${jsonRetry}/2)...`, true, { cancellable: true });
          await CC.sleep(1500, signal);
          continue;
        }
        throw parseErr;
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
  let spSyncInFlight = false;
  const SP_CHECKPOINT_KEY = 'spotify_checkpoint_v1';
  const SP_COOLDOWN_KEY = 'cratecheck_spotify_cooldown_v1';
  const SP_GAP_MS = 350;
  const SP_MAX_AUTO_RETRIES = 2;

  function loadPersistedSpotifyCooldown() {
    try {
      const raw = JSON.parse(localStorage.getItem(SP_COOLDOWN_KEY) || 'null');
      const until = Number(raw?.until || 0);
      if (until > spCooldownUntil) spCooldownUntil = until;
      if (spCooldownUntil && spCooldownUntil <= Date.now()) {
        spCooldownUntil = 0;
        localStorage.removeItem(SP_COOLDOWN_KEY);
      }
    } catch (_) {}
    return spCooldownUntil;
  }
  loadPersistedSpotifyCooldown();

  CC.getSpotifyCooldownUntil = () => {
    loadPersistedSpotifyCooldown();
    return spCooldownUntil > Date.now() ? spCooldownUntil : 0;
  };

  CC.getSpotifyCooldownRemainingSec = () => {
    const until = CC.getSpotifyCooldownUntil();
    return until > Date.now() ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 0;
  };

  CC.setSpotifyCooldown = (untilMs, meta = {}) => {
    const until = Math.max(Number(untilMs || 0), spCooldownUntil);
    spCooldownUntil = until;
    try {
      localStorage.setItem(SP_COOLDOWN_KEY, JSON.stringify({
        until,
        retryAfterSec: Number(meta.retryAfterSec || Math.ceil((until - Date.now()) / 1000)),
        stage: meta.stage || '',
        at: Date.now()
      }));
    } catch (_) {}
    return until;
  };

  CC.clearSpotifyCooldown = () => {
    spCooldownUntil = 0;
    try { localStorage.removeItem(SP_COOLDOWN_KEY); } catch (_) {}
  };

  CC.isSpotifySyncRunning = () => Boolean(spSyncInFlight);

  CC.cancelSpotifySync = () => {
    if (activeSpCtrl) {
      try { activeSpCtrl.abort(); } catch (_) {}
      activeSpCtrl = null;
    }
  };

  function parseOffsetFromUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      const off = Number(u.searchParams.get('offset') || 0);
      return Number.isFinite(off) && off >= 0 ? off : 0;
    } catch (_) {
      return 0;
    }
  }

  // Upgrade v2.0.2 checkpoints seamlessly into v2.0.3 per-stage progress format
  CC.normalizeSpotifyCheckpoint = (rawCp) => {
    if (!rawCp || typeof rawCp !== 'object') return null;
    const cp = { ...rawCp };
    const stage = cp.stage || (cp.mode === 'full' ? 'top' : 'liked');
    cp.version = 3;
    cp.mode = cp.mode === 'full' ? 'full' : 'liked';
    cp.stage = stage;
    cp.scannedLiked = Number(cp.scannedLiked || 0);
    cp.scannedAlbums = Number(cp.scannedAlbums || 0);
    cp.topRangeIdx = Number(cp.topRangeIdx || 0);
    cp.ownedPlaylists = Array.isArray(cp.ownedPlaylists) ? cp.ownedPlaylists.slice() : [];
    cp.playlistIdx = Number(cp.playlistIdx || 0);
    cp.playlistTracksScanned = Number(cp.playlistTracksScanned || 0);
    cp.skippedPlaylists = Array.isArray(cp.skippedPlaylists) ? cp.skippedPlaylists.slice() : [];
    cp.retryAttempt = Number(cp.retryAttempt || 0);
    cp.cooldownUntil = Number(cp.cooldownUntil || 0);

    if (cp.topDone === undefined) cp.topDone = cp.mode !== 'full' || stage !== 'top';
    if (cp.likedDone === undefined) cp.likedDone = ['albums', 'playlists_list', 'playlist_items', 'done'].includes(stage);
    if (cp.albumsDone === undefined) cp.albumsDone = ['playlists_list', 'playlist_items', 'done'].includes(stage);
    if (cp.playlistsListDone === undefined) cp.playlistsListDone = ['playlist_items', 'done'].includes(stage);

    if (cp.likedPage === undefined) {
      cp.likedPage = stage === 'liked' ? Number(cp.pageNum || 0) : Math.ceil(cp.scannedLiked / 50);
    }
    if (cp.likedOffset === undefined) {
      cp.likedOffset = stage === 'liked' && cp.nextUrl ? parseOffsetFromUrl(cp.nextUrl) : cp.scannedLiked;
    }
    if (cp.albumsPage === undefined) {
      cp.albumsPage = stage === 'albums' ? Number(cp.pageNum || 0) : Math.ceil(cp.scannedAlbums / 50);
    }
    if (cp.albumsOffset === undefined) {
      cp.albumsOffset = stage === 'albums' && cp.nextUrl ? parseOffsetFromUrl(cp.nextUrl) : cp.scannedAlbums;
    }
    if (cp.playlistsListPage === undefined) {
      cp.playlistsListPage = stage === 'playlists_list' ? Number(cp.pageNum || 0) : 0;
    }
    if (cp.playlistPage === undefined) {
      cp.playlistPage = stage === 'playlist_items' ? Math.ceil(cp.playlistTracksScanned / 50) : 0;
    }
    if (cp.cooldownUntil > spCooldownUntil && cp.cooldownUntil > Date.now()) {
      CC.setSpotifyCooldown(cp.cooldownUntil, { stage });
    }
    return cp;
  };

  CC.formatSpotifyProgress = (rawCp) => {
    const cp = CC.normalizeSpotifyCheckpoint(rawCp);
    if (!cp) return '';
    const parts = [];
    const likedFmt = cp.scannedLiked.toLocaleString();

    if (cp.likedDone) {
      parts.push(`Liked Songs complete (${likedFmt})`);
    } else if (cp.stage === 'liked') {
      const pg = cp.likedPage > 0 ? `page ${cp.likedPage}` : 'starting';
      const off = cp.likedOffset > 0 ? `, offset ${cp.likedOffset.toLocaleString()}` : '';
      parts.push(`Liked Songs: ${likedFmt} scanned (${pg}${off})`);
    } else if (cp.stage === 'top') {
      parts.push(`Top Artists & Tracks (${cp.topRangeIdx}/3 ranges)`);
    }

    if (cp.mode === 'full') {
      if (cp.albumsDone) {
        parts.push(`${cp.scannedAlbums.toLocaleString()} saved albums`);
      } else if (cp.stage === 'albums') {
        parts.push(`Saved Albums: ${cp.scannedAlbums.toLocaleString()} scanned (page ${cp.albumsPage || 1})`);
      }

      if (cp.stage === 'playlists_list') {
        const listPg = (cp.playlistsListPage || 0) + 1;
        parts.push(`Listing playlists (page ${listPg}${cp.ownedPlaylists.length ? `, ${cp.ownedPlaylists.length} found` : ''})`);
      } else if (cp.stage === 'playlist_items') {
        const total = cp.ownedPlaylists.length;
        const curPl = cp.ownedPlaylists[cp.playlistIdx];
        if (total > 0 && curPl) {
          const plLabel = cp.playlistTracksScanned > 0
            ? `Playlist ${cp.playlistIdx + 1} of ${total} (${curPl.name}, ${cp.playlistTracksScanned} songs)`
            : `Opening playlist ${cp.playlistIdx + 1} of ${total} (${curPl.name})`;
          parts.push(plLabel);
        } else if (total > 0) {
          parts.push(`${total} playlist(s) scanned`);
        }
      }
      if (cp.skippedPlaylists?.length) {
        parts.push(`${cp.skippedPlaylists.length} skipped`);
      }
    }

    let line = parts.join(' · ') || `Stage: ${cp.stage}`;
    if (cp.lastError) {
      const le = cp.lastError;
      const stTxt = le.status ? `HTTP ${le.status}` : (le.code || 'Error');
      const where = le.playlistName
        ? `playlist "${le.playlistName}"`
        : (le.stageLabel || le.stage || 'sync');
      line += ` — Paused (${stTxt} during ${where})`;
    }
    return line;
  };

  CC.getSpotifyCheckpoint = async () => {
    try {
      const rec = await CC.idbGet('meta', SP_CHECKPOINT_KEY);
      return rec?.value ? CC.normalizeSpotifyCheckpoint(rec.value) : null;
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

  // Single global scheduler for ALL Spotify Web API reads:
  // Strictly blocks all Spotify requests during persisted 429 cooldown, refreshes once on 401, and surfaces real HTTP status.
  function spFetch(url, signal = null, opts = {}) {
    const { maxRetries = SP_MAX_AUTO_RETRIES, failFastOnCooldown = true, backoffAttempt = 0, stage = '' } = opts || {};
    const run = async () => {
      let refreshedOnce = false;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) throw new DOMException('Cancelled by user', 'AbortError');

        const remCooldown = CC.getSpotifyCooldownRemainingSec();
        if (remCooldown > 0) {
          const until = CC.getSpotifyCooldownUntil();
          if (failFastOnCooldown || remCooldown > 5) {
            const err = new Error(`Spotify rate limit cooldown (${remCooldown}s remaining) — wait before resuming`);
            err.code = 'SPOTIFY_RATE_LIMIT';
            err.status = 429;
            err.retryAfterSec = remCooldown;
            err.cooldownUntil = until;
            throw err;
          }
          await CC.sleep(remCooldown * 1000, signal);
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

        if (res.status === 401) {
          if (!refreshedOnce && CC.cfg.spotifyRefreshToken && await CC.refreshSpotifyToken()) {
            refreshedOnce = true;
            continue;
          }
          const err = new Error('Spotify session expired (HTTP 401) — reconnect to resume this sync');
          err.code = 'SPOTIFY_AUTH_EXPIRED';
          err.status = 401;
          throw err;
        }

        if (res.status === 429) {
          const headerSec = parseRetryAfterSeconds(res.headers?.get?.('Retry-After'));
          const waitSec = Math.max(90, headerSec || 90);
          const until = CC.setSpotifyCooldown(Date.now() + waitSec * 1000, { retryAfterSec: waitSec, stage });

          const err = new Error(`Spotify rate limit (HTTP 429 — cooling down for ${waitSec}s, checkpoint saved for resume)`);
          err.code = 'SPOTIFY_RATE_LIMIT';
          err.status = 429;
          err.retryAfterSec = waitSec;
          err.cooldownUntil = until;
          err.usedFallbackBackoff = headerSec < 90;
          throw err;
        }

        if (!res.ok) {
          const err = new Error(`Spotify HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return res.json();
      }
      const rem = CC.getSpotifyCooldownRemainingSec() || 15;
      const err = new Error(`Spotify rate limit retry bound reached (${rem}s cooldown)`);
      err.code = 'SPOTIFY_RATE_LIMIT';
      err.status = 429;
      err.retryAfterSec = rem;
      err.cooldownUntil = CC.getSpotifyCooldownUntil();
      throw err;
    };

    const p = spChain.then(run, run);
    spChain = p.catch(() => {});
    return p;
  }

  CC.beginSpotifyRedirect = async (syncMode = 'liked', opts = {}) => {
    const verifier = randomStr(64);
    const state = randomStr(16);
    const challenge = await sha256B64(verifier);
    localStorage.setItem('sp_pkce_verifier', verifier);
    localStorage.setItem('sp_pkce_state', state);
    localStorage.setItem('sp_sync_mode', syncMode === 'full' ? 'full' : 'liked');
    if (opts?.resumeOnReturn) localStorage.setItem('sp_resume_on_return', '1');
    else localStorage.removeItem('sp_resume_on_return');
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.set('client_id', CC.cfg.spotifyClientId.trim());
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', CC.REDIRECT_URI);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('scope', 'user-library-read user-top-read user-follow-read playlist-read-private playlist-read-collaborative user-read-private');
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
      maxRetriesPerPage = SP_MAX_AUTO_RETRIES,
      autoCommitProfile = true
    } = opts || {};

    if (spSyncInFlight) {
      const existingCp = await CC.getSpotifyCheckpoint();
      return {
        completed: false,
        paused: true,
        reason: 'already_running',
        message: 'Spotify sync is already running',
        checkpoint: existingCp
      };
    }

    // Strictly block ALL Spotify Web API calls (including /v1/me) while Retry-After cooldown is active!
    const existingCpBefore = await CC.getSpotifyCheckpoint();
    const remSecBefore = CC.getSpotifyCooldownRemainingSec();
    if (remSecBefore > 0) {
      const until = CC.getSpotifyCooldownUntil();
      return {
        completed: false,
        paused: true,
        reason: 'rate_limit',
        retryAfterSec: remSecBefore,
        cooldownUntil: until,
        message: `Spotify rate limit cooldown (${remSecBefore}s remaining) — wait before resuming`,
        checkpoint: existingCpBefore
      };
    }

    spSyncInFlight = true;
    CC.cancelSpotifySync();
    const ctrl = new AbortController();
    activeSpCtrl = ctrl;
    const signal = ctrl.signal;

    const normArtistBase = (name) => CC.norm(name).replace(/^the\s+/, '').trim();

    let artistMap = {};
    let trackPairs = new Set();
    let trackTitles = new Set();
    let trackSourcesMap = {};
    let decades = {};
    let playlistSummaries = [];
    // Per-source deduplication sets (using Spotify track ID when available, else normalized artist|title)
    let seenBySource = {
      liked: new Set(),
      top: new Set(),
      album: new Set(),
      playlistById: {}
    };

    const ensureArtist = (name) => {
      const n = CC.norm(name);
      if (!n) return null;
      if (!artistMap[n]) {
        artistMap[n] = {
          name,
          count: 0,
          isTopArtist: false,
          isFollowed: false,
          tracks: new Set(),
          likedTracks: new Set(),
          topTracks: new Set(),
          albumTracks: new Set(),
          playlistTracks: new Set(),
          playlists: new Set(),
          playlistTrackMap: {}
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
        trackSourcesMap[key] = {
          liked: false,
          top: false,
          album: false,
          playlists: new Set(),
          playlistIds: new Set(),
          playlistEntries: new Map(),
          trackIds: new Set()
        };
      }
      return trackSourcesMap[key];
    };

    const addDecade = (dateStr) => {
      const m = String(dateStr || '').match(/^(\d{4})/);
      if (!m) return;
      const dec = `${Math.floor(Number(m[1]) / 10) * 10}s`;
      decades[dec] = (decades[dec] || 0) + 1;
    };

    const getSourceDedupKey = (tr) => {
      const id = String(tr?.id || '').trim();
      if (id) return `id:${id}`;
      const firstArt = normArtistBase(tr?.artists?.[0]?.name || '');
      const nt = CC.norm(tr?.name || '');
      return (firstArt || nt) ? `nt:${firstArt}|${nt}` : '';
    };

    const addTrack = (tr, sourceType = 'playlist', weight = 1, playlistInfo = null) => {
      if (!tr || !tr.name) return false;
      const cleanTitle = tr.name.trim();
      const nt = CC.norm(cleanTitle);
      if (!nt) return false;

      const plId = typeof playlistInfo === 'object' && playlistInfo ? String(playlistInfo.id || '') : '';
      const plName = typeof playlistInfo === 'object' && playlistInfo ? String(playlistInfo.name || '') : String(playlistInfo || '');

      // Deduplicate repeated entries WITHIN the same source so duplicates never inflate weighting!
      const dedupKey = getSourceDedupKey(tr);
      if (dedupKey) {
        if (sourceType === 'playlist') {
          const bucketKey = plId || plName || '_default';
          if (!seenBySource.playlistById[bucketKey]) seenBySource.playlistById[bucketKey] = new Set();
          if (seenBySource.playlistById[bucketKey].has(dedupKey)) return false;
          seenBySource.playlistById[bucketKey].add(dedupKey);
        } else {
          if (!seenBySource[sourceType]) seenBySource[sourceType] = new Set();
          if (seenBySource[sourceType].has(dedupKey)) return false;
          seenBySource[sourceType].add(dedupKey);
        }
      }

      trackTitles.add(nt);
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
          if (plName) {
            rec.playlists.add(plName);
            if (!rec.playlistTrackMap) rec.playlistTrackMap = {};
            if (!rec.playlistTrackMap[plName]) rec.playlistTrackMap[plName] = new Set();
            rec.playlistTrackMap[plName].add(cleanTitle);
          }
        }

        const na = CC.norm(a.name);
        if (na && nt) trackPairs.add(`${na}|${nt}`);
        const srcRec = ensureTrackSource(a.name, cleanTitle);
        if (srcRec) {
          if (tr.id) srcRec.trackIds.add(String(tr.id));
          if (sourceType === 'liked') srcRec.liked = true;
          else if (sourceType === 'top') srcRec.top = true;
          else if (sourceType === 'album') srcRec.album = true;
          else if (sourceType === 'playlist') {
            if (plName) srcRec.playlists.add(plName);
            if (plId) srcRec.playlistIds.add(plId);
            if (plId || plName) srcRec.playlistEntries.set(plId || plName, { id: plId, name: plName });
          }
        }
      });
      return true;
    };

    const serializeAccumulated = () => {
      const allArtists = {};
      Object.entries(artistMap).forEach(([k, v]) => {
        const plTrackMapOut = {};
        Object.entries(v.playlistTrackMap || {}).forEach(([pl, setOrArr]) => {
          plTrackMapOut[pl] = Array.from(setOrArr || []);
        });
        allArtists[k] = {
          name: v.name,
          count: v.count,
          isTopArtist: Boolean(v.isTopArtist),
          isFollowed: Boolean(v.isFollowed),
          tracks: Array.from(v.tracks),
          likedTracks: Array.from(v.likedTracks),
          topTracks: Array.from(v.topTracks),
          albumTracks: Array.from(v.albumTracks),
          playlistTracks: Array.from(v.playlistTracks),
          playlists: Array.from(v.playlists),
          playlistTrackMap: plTrackMapOut
        };
      });
      const trackSources = {};
      Object.entries(trackSourcesMap).forEach(([k, v]) => {
        trackSources[k] = {
          liked: Boolean(v.liked),
          top: Boolean(v.top),
          album: Boolean(v.album),
          playlists: Array.from(v.playlists),
          playlistIds: Array.from(v.playlistIds),
          playlistEntries: Array.from(v.playlistEntries.values()),
          trackIds: Array.from(v.trackIds)
        };
      });
      const playlistSeenOut = {};
      Object.entries(seenBySource.playlistById || {}).forEach(([k, s]) => {
        playlistSeenOut[k] = Array.from(s);
      });
      return {
        allArtists,
        trackSources,
        trackPairs: Array.from(trackPairs),
        trackTitles: Array.from(trackTitles),
        playlistSummaries,
        decades,
        seenBySource: {
          liked: Array.from(seenBySource.liked || []),
          top: Array.from(seenBySource.top || []),
          album: Array.from(seenBySource.album || []),
          playlistById: playlistSeenOut
        }
      };
    };

    const hydrateAccumulated = (acc) => {
      if (!acc) return;
      artistMap = {};
      Object.entries(acc.allArtists || {}).forEach(([k, v]) => {
        const plTrackMapHydrated = {};
        Object.entries(v.playlistTrackMap || {}).forEach(([pl, arr]) => {
          plTrackMapHydrated[pl] = new Set(Array.isArray(arr) ? arr : []);
        });
        artistMap[k] = {
          name: v.name,
          count: Number(v.count || 0),
          isTopArtist: Boolean(v.isTopArtist),
          isFollowed: Boolean(v.isFollowed),
          tracks: new Set(v.tracks || []),
          likedTracks: new Set(v.likedTracks || []),
          topTracks: new Set(v.topTracks || []),
          albumTracks: new Set(v.albumTracks || []),
          playlistTracks: new Set(v.playlistTracks || []),
          playlists: new Set(v.playlists || []),
          playlistTrackMap: plTrackMapHydrated
        };
      });
      trackSourcesMap = {};
      Object.entries(acc.trackSources || {}).forEach(([k, v]) => {
        const entryMap = new Map();
        (v.playlistEntries || []).forEach(pe => {
          if (pe) entryMap.set(pe.id || pe.name, { id: pe.id || '', name: pe.name || '' });
        });
        (v.playlists || []).forEach(pn => {
          if (pn && !Array.from(entryMap.values()).some(e => e.name === pn)) {
            entryMap.set(pn, { id: '', name: pn });
          }
        });
        trackSourcesMap[k] = {
          liked: Boolean(v.liked),
          top: Boolean(v.top),
          album: Boolean(v.album),
          playlists: new Set(v.playlists || []),
          playlistIds: new Set(v.playlistIds || []),
          playlistEntries: entryMap,
          trackIds: new Set(v.trackIds || [])
        };
      });
      trackPairs = new Set(acc.trackPairs || []);
      trackTitles = new Set(acc.trackTitles || []);
      playlistSummaries = Array.isArray(acc.playlistSummaries) ? acc.playlistSummaries.slice() : [];
      decades = Object.assign({}, acc.decades || {});

      const sb = acc.seenBySource || {};
      const plSeen = {};
      Object.entries(sb.playlistById || {}).forEach(([k, arr]) => { plSeen[k] = new Set(arr || []); });
      seenBySource = {
        liked: new Set(sb.liked || []),
        top: new Set(sb.top || []),
        album: new Set(sb.album || []),
        playlistById: plSeen
      };
    };

    let cp = null;
    let activeStageLabel = 'Connecting';
    let activePlaylistName = '';
    let activeRequestUrl = '';

    const saveCheckpoint = async () => {
      if (!cp) return;
      cp.updatedAt = Date.now();
      cp.accumulated = serializeAccumulated();
      await CC.idbPut('meta', { key: SP_CHECKPOINT_KEY, value: cp });
    };

    const spFetchStage = (url, stageName, stageLabel, plName = '') => {
      activeStageLabel = stageLabel;
      activePlaylistName = plName;
      activeRequestUrl = url;
      return spFetch(url, signal, {
        maxRetries: maxRetriesPerPage,
        failFastOnCooldown: true,
        backoffAttempt: Number(cp?.retryAttempt || 0),
        stage: stageName
      });
    };

    try {
      statusCb('Connecting to Spotify...', true, { cancellable: true });
      const me = await spFetchStage('https://api.spotify.com/v1/me', 'connect', 'Connecting to Spotify');
      const accountId = String(me.id || '');
      const displayName = me.display_name || me.id || 'Spotify';

      const savedCp = resume ? existingCpBefore : null;
      if (savedCp && (!savedCp.accountId || savedCp.accountId === accountId) && (requestedMode === 'resume' || savedCp.mode === requestedMode)) {
        cp = CC.normalizeSpotifyCheckpoint(savedCp);
        cp.accountId = accountId;
        cp.userDisplayName = displayName;
        cp.lastError = null;
        cp.cooldownUntil = 0;
        hydrateAccumulated(cp.accumulated);
      } else {
        const mode = requestedMode === 'full' ? 'full' : 'liked';
        cp = CC.normalizeSpotifyCheckpoint({
          version: 3,
          accountId,
          userDisplayName: displayName,
          mode,
          stage: mode === 'full' ? 'top' : 'liked',
          topDone: mode !== 'full',
          topRangeIdx: 0,
          likedDone: false,
          likedPage: 0,
          likedOffset: 0,
          scannedLiked: 0,
          albumsDone: mode !== 'full',
          albumsPage: 0,
          albumsOffset: 0,
          scannedAlbums: 0,
          playlistsListDone: mode !== 'full',
          playlistsListPage: 0,
          nextUrl: mode === 'full' ? '' : 'https://api.spotify.com/v1/me/tracks?limit=50',
          pageNum: 0,
          ownedPlaylists: [],
          playlistIdx: 0,
          playlistPage: 0,
          playlistNextUrl: '',
          playlistTracksScanned: 0,
          skippedPlaylists: [],
          retryAttempt: 0,
          cooldownUntil: 0,
          lastError: null,
          updatedAt: Date.now()
        });
      }

      // Stage 1 (full only): Top Artists & Tracks
      if (cp.stage === 'top') {
        const ranges = ['long_term', 'medium_term', 'short_term'];
        while (cp.topRangeIdx < ranges.length) {
          const range = ranges[cp.topRangeIdx];
          statusCb(`Top Artists & Tracks (${cp.topRangeIdx + 1}/3 · ${range})...`, true, { cancellable: true });
          const topA = await spFetchStage(`https://api.spotify.com/v1/me/top/artists?limit=50&time_range=${range}`, 'top', `Top Artists (${range})`);
          (topA.items || []).forEach((a, i) => {
            const rec = ensureArtist(a.name);
            if (rec) {
              rec.isTopArtist = true;
              rec.count += Math.max(8, 26 - Math.floor(i / 2));
            }
          });
          const topT = await spFetchStage(`https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=${range}`, 'top', `Top Tracks (${range})`);
          (topT.items || []).forEach(t => addTrack(t, 'top', 6));
          cp.topRangeIdx++;
          cp.retryAttempt = 0;
          await saveCheckpoint();
        }
        // Optional graceful fetch of Followed Artists (skips cleanly on 403 if older token lacks user-follow-read)
        try {
          let folUrl = 'https://api.spotify.com/v1/me/following?type=artist&limit=50';
          let folPages = 0;
          while (folUrl && folPages < 10) {
            const folRes = await spFetchStage(folUrl, 'top', 'Followed Artists');
            const items = folRes?.artists?.items || [];
            items.forEach(a => {
              const rec = ensureArtist(a.name);
              if (rec) {
                rec.isFollowed = true;
                rec.count += 6;
              }
            });
            folUrl = folRes?.artists?.next || '';
            folPages++;
          }
        } catch (folErr) {
          if (folErr?.code === 'SPOTIFY_RATE_LIMIT' || folErr?.code === 'SPOTIFY_AUTH_EXPIRED' || folErr?.name === 'AbortError') {
            throw folErr;
          }
          // Ignore 403 scope-missing gracefully so existing tokens never break
        }
        cp.topDone = true;
        cp.stage = 'liked';
        cp.nextUrl = 'https://api.spotify.com/v1/me/tracks?limit=50';
        cp.likedPage = 0;
        cp.likedOffset = 0;
        cp.pageNum = 0;
        await saveCheckpoint();
      }

      // Stage 2 (liked & full): Liked Songs (/me/tracks is the SOLE source of Liked Songs)
      if (cp.stage === 'liked') {
        if (!cp.nextUrl && !cp.likedDone) {
          cp.nextUrl = 'https://api.spotify.com/v1/me/tracks?limit=50';
        }
        while (cp.nextUrl) {
          const nextPageNum = cp.likedPage + 1;
          cp.likedOffset = parseOffsetFromUrl(cp.nextUrl);
          statusCb(`Liked Songs: ${cp.scannedLiked.toLocaleString()} scanned (page ${nextPageNum}, offset ${cp.likedOffset.toLocaleString()})...`, true, { cancellable: true });
          const d = await spFetchStage(cp.nextUrl, 'liked', `Liked Songs (page ${nextPageNum})`);
          (d.items || []).forEach(it => addTrack(it.track, 'liked', 5));
          cp.scannedLiked += (d.items || []).length;
          cp.likedPage = nextPageNum;
          cp.pageNum = nextPageNum;
          cp.nextUrl = d.next || '';
          cp.likedOffset = cp.nextUrl ? parseOffsetFromUrl(cp.nextUrl) : cp.scannedLiked;
          cp.retryAttempt = 0;
          await saveCheckpoint();
        }
        cp.likedDone = true;
        if (cp.mode === 'full') {
          cp.stage = 'albums';
          cp.nextUrl = 'https://api.spotify.com/v1/me/albums?limit=50';
          cp.albumsPage = 0;
          cp.albumsOffset = 0;
          cp.pageNum = 0;
          await saveCheckpoint();
        } else {
          cp.stage = 'done';
        }
      }

      // Stage 3 (full only): Saved Albums
      if (cp.stage === 'albums') {
        if (!cp.nextUrl && !cp.albumsDone) {
          cp.nextUrl = 'https://api.spotify.com/v1/me/albums?limit=50';
        }
        while (cp.nextUrl) {
          const nextPageNum = cp.albumsPage + 1;
          cp.albumsOffset = parseOffsetFromUrl(cp.nextUrl);
          statusCb(`Liked Songs complete (${cp.scannedLiked.toLocaleString()}) · Saved Albums page ${nextPageNum} (${cp.scannedAlbums} scanned)...`, true, { cancellable: true });
          const d = await spFetchStage(cp.nextUrl, 'albums', `Saved Albums (page ${nextPageNum})`);
          (d.items || []).forEach(it => {
            if (it.album?.release_date) addDecade(it.album.release_date);
            (it.album?.artists || []).forEach(a => {
              const rec = ensureArtist(a.name);
              if (rec) rec.count += 4;
            });
            (it.album?.tracks?.items || []).forEach(t => addTrack(t, 'album', 3));
          });
          cp.scannedAlbums += (d.items || []).length;
          cp.albumsPage = nextPageNum;
          cp.pageNum = nextPageNum;
          cp.nextUrl = d.next || '';
          cp.albumsOffset = cp.nextUrl ? parseOffsetFromUrl(cp.nextUrl) : cp.scannedAlbums;
          cp.retryAttempt = 0;
          await saveCheckpoint();
        }
        cp.albumsDone = true;
        cp.stage = 'playlists_list';
        cp.nextUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';
        cp.playlistsListPage = 0;
        cp.ownedPlaylists = [];
        await saveCheckpoint();
      }

      // Stage 4 (full only): Listing accessible playlists (real user playlist named "Liked Songs" stays eligible!)
      if (cp.stage === 'playlists_list') {
        if (!cp.nextUrl && !cp.playlistsListDone) {
          cp.nextUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';
        }
        const seenIds = new Set((cp.ownedPlaylists || []).map(p => p.id));
        while (cp.nextUrl) {
          const nextPageNum = cp.playlistsListPage + 1;
          statusCb(`Liked Songs complete (${cp.scannedLiked.toLocaleString()}) · ${cp.scannedAlbums} saved albums · Listing playlists (page ${nextPageNum})...`, true, { cancellable: true });
          const pls = await spFetchStage(cp.nextUrl, 'playlists_list', `Listing playlists (page ${nextPageNum})`);
          (pls.items || []).forEach(p => {
            if (!p || !p.id || seenIds.has(p.id)) return;
            if (!(p.owner?.id === accountId || p.collaborative)) return;
            const reportedTotal = p.tracks?.total ?? p.items?.total;
            if (reportedTotal === 0) return;
            seenIds.add(p.id);
            cp.ownedPlaylists.push({ id: p.id, name: p.name || 'Playlist' });
          });
          cp.playlistsListPage = nextPageNum;
          cp.nextUrl = pls.next || '';
          cp.retryAttempt = 0;
          await saveCheckpoint();
        }
        cp.playlistsListDone = true;
        cp.stage = 'playlist_items';
        cp.playlistIdx = 0;
        cp.playlistPage = 0;
        cp.playlistNextUrl = cp.ownedPlaylists[0] ? `https://api.spotify.com/v1/playlists/${cp.ownedPlaylists[0].id}/items?limit=50` : '';
        cp.playlistTracksScanned = 0;
        await saveCheckpoint();
      }

      // Stage 5 (full only): Playlist items (403/404 on an individual playlist skips it & continues with remaining!)
      if (cp.stage === 'playlist_items') {
        while (cp.playlistIdx < cp.ownedPlaylists.length) {
          const pl = cp.ownedPlaylists[cp.playlistIdx];
          if (!cp.playlistNextUrl) {
            cp.playlistNextUrl = `https://api.spotify.com/v1/playlists/${pl.id}/items?limit=50`;
            cp.playlistTracksScanned = 0;
            cp.playlistPage = 0;
          }
          let skippedThisPlaylist = false;
          while (cp.playlistNextUrl) {
            const nextPg = cp.playlistPage + 1;
            statusCb(
              `Liked Songs complete (${cp.scannedLiked.toLocaleString()}) · ${cp.scannedAlbums} saved albums · Opening playlist ${cp.playlistIdx + 1} of ${cp.ownedPlaylists.length} (${pl.name}${nextPg > 1 ? `, page ${nextPg}` : ''})...`,
              true,
              { cancellable: true }
            );
            try {
              const pd = await spFetchStage(cp.playlistNextUrl, 'playlist_items', `Playlist ${cp.playlistIdx + 1} of ${cp.ownedPlaylists.length}`, pl.name);
              (pd.items || []).forEach(e => addTrack(e.item || e.track, 'playlist', 1, pl));
              cp.playlistTracksScanned += (pd.items || []).length;
              cp.playlistPage = nextPg;
              cp.playlistNextUrl = pd.next || '';
              cp.retryAttempt = 0;
              await saveCheckpoint();
            } catch (plErr) {
              if (plErr?.status === 403 || plErr?.status === 404) {
                // Record inaccessible playlist as skipped & continue with remaining playlists!
                if (!cp.skippedPlaylists.some(s => s.id === pl.id)) {
                  cp.skippedPlaylists.push({ id: pl.id, name: pl.name, status: plErr.status });
                }
                skippedThisPlaylist = true;
                break;
              }
              throw plErr;
            }
          }
          if (!skippedThisPlaylist && cp.playlistTracksScanned > 0) {
            playlistSummaries.push({ id: pl.id, name: pl.name, count: cp.playlistTracksScanned });
          }
          cp.playlistIdx++;
          cp.playlistTracksScanned = 0;
          cp.playlistPage = 0;
          cp.playlistNextUrl = cp.ownedPlaylists[cp.playlistIdx]
            ? `https://api.spotify.com/v1/playlists/${cp.ownedPlaylists[cp.playlistIdx].id}/items?limit=50`
            : '';
          await saveCheckpoint();
        }
        cp.stage = 'done';
      }

      const finalAcc = serializeAccumulated();
      const topArtists = Object.values(finalAcc.allArtists).sort((a, b) => b.count - a.count).map(x => x.name);

      const profile = {
        provenanceVersion: 3,
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
        skippedPlaylists: cp.skippedPlaylists.slice(),
        decades: finalAcc.decades,
        totalTracks: finalAcc.trackPairs.length || finalAcc.trackTitles.length,
        totalArtists: Object.keys(finalAcc.allArtists).length,
        totalPlaylists: finalAcc.playlistSummaries.length,
        tasteDna: existingDna || '',
        softSpots: existingSoftSpots || '',
        dnaUpdatedAt: existingDna ? Date.now() : 0
      };

      // Keep checkpoint until completed profile is atomically saved to IndexedDB!
      if (autoCommitProfile) {
        await CC.commitLocalMutation({
          metaPuts: [{ key: 'spotify_profile', value: profile }],
          metaDeletes: [SP_CHECKPOINT_KEY],
          extraOps: [{ type: 'spotify_profile', profile }],
          queueOutbox: true
        });
      } else {
        await CC.idbPut('meta', { key: 'spotify_profile', value: profile });
        await CC.clearSpotifyCheckpoint();
      }
      CC.clearSpotifyCooldown();

      return {
        completed: true,
        paused: false,
        profile,
        skippedPlaylists: cp.skippedPlaylists.slice()
      };
    } catch (err) {
      if (cp) {
        if (err?.code === 'SPOTIFY_RATE_LIMIT') {
          cp.cooldownUntil = Number(err.cooldownUntil || CC.getSpotifyCooldownUntil() || 0);
          cp.retryAttempt = Number(cp.retryAttempt || 0) + 1;
        }
        if (err?.name !== 'AbortError') {
          cp.lastError = {
            stage: cp.stage,
            stageLabel: activeStageLabel,
            status: Number(err?.status || (err?.code === 'SPOTIFY_RATE_LIMIT' ? 429 : 0)),
            code: err?.code || '',
            playlistName: activePlaylistName || '',
            url: activeRequestUrl || '',
            message: err?.message || 'Paused',
            needsReconnect: err?.code === 'SPOTIFY_AUTH_EXPIRED' || err?.status === 401,
            at: Date.now()
          };
        }
        try { await saveCheckpoint(); } catch (_) {}
      }

      if (err?.code === 'SPOTIFY_RATE_LIMIT' || err?.code === 'SPOTIFY_AUTH_EXPIRED' || err?.name === 'AbortError' || err?.status) {
        const reason = err?.code === 'SPOTIFY_RATE_LIMIT'
          ? 'rate_limit'
          : err?.code === 'SPOTIFY_AUTH_EXPIRED'
            ? 'auth_expired'
            : err?.name === 'AbortError'
              ? 'cancelled'
              : 'http_error';
        return {
          completed: false,
          paused: true,
          reason,
          status: Number(err?.status || 0),
          retryAfterSec: Number(err?.retryAfterSec || CC.getSpotifyCooldownRemainingSec() || 0),
          cooldownUntil: Number(err?.cooldownUntil || CC.getSpotifyCooldownUntil() || 0),
          stage: cp?.stage || '',
          stageLabel: activeStageLabel,
          playlistName: activePlaylistName,
          message: err?.message || 'Paused',
          checkpoint: cp
        };
      }
      throw err;
    } finally {
      spSyncInFlight = false;
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
  const SYNC_ID_ALIASES_KEY = 'sync_id_aliases_v1';

  const PREF_KEYS = [
    'geminiModel', 'autoPlayHighlight', 'autoDetective', 'autoGradeOnScan',
    'autoCropPhotos', 'photoQuality',
    'homeCountry', 'fetchVgSuggestions', 'threshold', 'voice',
    'showSpotify', 'showApple', 'showDeezer', 'showYoutube'
  ];
  const SECRET_KEYS = [
    'geminiKey', 'discogsToken', 'discogsUser', 'discogsFolderId',
    'discogsFolders', 'discogsFields', 'spotifyClientId'
  ];
  CC.PREF_KEYS = PREF_KEYS;
  CC.SECRET_KEYS = SECRET_KEYS;
  const STASH_MERGE_FIELDS = [
    'title', 'artist', 'catno', 'format', 'year', 'label', 'country', 'genres',
    'media_condition', 'sleeve_condition', 'condition_note',
    'photo_slots', 'thumbs', 'thumb_data_url', 'spine_thumb_url', 'spine_source_url', 'spine_flipped',
    'taste_score', 'taste_verdict', 'taste_summary', 'context_note',
    'notable_songs', 'litmus_track', 'litmus_artist', 'taste_scored_at',
    'discogs_id', 'master_id', 'discogs_account', 'discogs_instance_id',
    'discogs_folder_id', 'discogs_folder_verified_at', 'intended_discogs_folder_id',
    'synced_to_discogs', 'discogs_removed', 'discogs_removed_at', 'discogs_link_ambiguous',
    'pending_discogs_sync', 'pending_field_sync', 'pending_delete_old', 'pending_folder_move',
    'rating', 'is_high_value', 'is_scarce', 'est_price', 'est_currency', 'est_usd',
    'lowest_price', 'lowest_currency', 'vg_plus_price', 'vg_plus_currency',
    'num_for_sale', 'have', 'want', 'tracklist', 'pressing_notes', 'discogs_details_synced_at',
    'discogs_url', 'discogs_thumb', 'is_conservative_tiebreak', 'tiebreak_confirmed', 'spotify_matches',
    'is_franken_copy', 'franken_type', 'franken_note', 'needs_verification'
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
    const fMeta = Object.assign({}, prevRecord?._fieldMeta || rec._fieldMeta || {});
    const fieldsToStamp = Array.isArray(changedFields)
      ? changedFields
      : STASH_MERGE_FIELDS.filter(f => {
          if (!prevRecord) return rec[f] !== undefined && !isMergeValueEmpty(f, rec[f]);
          return JSON.stringify(rec[f]) !== JSON.stringify(prevRecord[f]);
        });
    fieldsToStamp.forEach(f => {
      const entry = { ts: now, rev, deviceId };
      fRevs[f] = entry;
      fMeta[f] = entry;
    });

    // Independent per-slot photo revisions: photo_slots.front / photo_slots.back / photo_slots.extras
    // Allows Phone replacing Front and PC replacing Back to merge cleanly without clobbering each other.
    if (rec.photo_slots && typeof rec.photo_slots === 'object') {
      const prevSlots = prevRecord ? CC.normalizePhotoSlots(prevRecord) : { front: '', back: '', extras: [] };
      const nextSlots = CC.normalizePhotoSlots(rec);

      // Upgraded v2.2.0 record support: if prevRecord had photo_slots or legacy thumbs without
      // per-slot field_revs yet, initialize missing sub-slot revisions from prevRecord's baseline
      // BEFORE stamping the newly changed slot(s) so concurrent Phone/PC edits merge cleanly.
      if (prevRecord) {
        const hasPrevPhotos = Boolean(
          (prevRecord.photo_slots && typeof prevRecord.photo_slots === 'object') ||
          (Array.isArray(prevRecord.thumbs) && prevRecord.thumbs.length > 0) ||
          prevSlots.front || prevSlots.back || prevSlots.extras.length > 0
        );
        if (hasPrevPhotos) {
          const baseParent = prevRecord.field_revs?.photo_slots ||
            prevRecord._fieldMeta?.photo_slots ||
            { ts: Number(prevRecord.updated_at || prevRecord.created_at || 1), rev: prevRecord.rev || '' };
          const baseline = {
            ts: Number(baseParent.ts || prevRecord.updated_at || prevRecord.created_at || 1),
            rev: baseParent.rev || prevRecord.rev || '',
            ...(baseParent.deviceId ? { deviceId: baseParent.deviceId } : {})
          };
          ['photo_slots.front', 'photo_slots.back', 'photo_slots.extras'].forEach(sk => {
            if (!fRevs[sk]) fRevs[sk] = { ...baseline };
            if (!fMeta[sk]) fMeta[sk] = { ...baseline };
          });
        }
      }

      const prevExtrasRev = prevRecord?.field_revs?.['photo_slots.extras']?.rev || null;
      const slotChecks = [
        ['photo_slots.front', prevSlots.front, nextSlots.front, Boolean(nextSlots.front)],
        ['photo_slots.back', prevSlots.back, nextSlots.back, Boolean(nextSlots.back)],
        ['photo_slots.extras', prevSlots.extras, nextSlots.extras, nextSlots.extras.length > 0]
      ];
      slotChecks.forEach(([k, pv, nv, nonEmpty]) => {
        const changed = prevRecord ? (JSON.stringify(pv) !== JSON.stringify(nv)) : nonEmpty;
        if (changed) {
          const entry = k === 'photo_slots.extras'
            ? { ts: now, rev, deviceId, parentRev: prevExtrasRev }
            : { ts: now, rev, deviceId };
          fRevs[k] = entry;
          fMeta[k] = entry;
        }
      });

      // CRDT per-photo extra_added & extra_tombstones tracking alongside photo_slots.extras
      const extraAdded = Object.assign({}, prevSlots.extra_added || {}, nextSlots.extra_added || {});
      const extraTombstones = Object.assign({}, prevSlots.extra_tombstones || {}, nextSlots.extra_tombstones || {});
      const baseExtraMeta = {
        ts: Number(prevRecord?.field_revs?.['photo_slots.extras']?.ts || prevRecord?.updated_at || prevRecord?.created_at || 1),
        rev: String(prevRecord?.field_revs?.['photo_slots.extras']?.rev || prevRecord?.rev || ''),
        ...(prevRecord?.field_revs?.['photo_slots.extras']?.deviceId ? { deviceId: prevRecord.field_revs['photo_slots.extras'].deviceId } : {})
      };
      const prevExtraKeys = new Set();
      prevSlots.extras.forEach(src => {
        const k = CC.getPhotoKey(src);
        if (!k) return;
        prevExtraKeys.add(k);
        if (!extraAdded[k]) extraAdded[k] = { ...baseExtraMeta };
      });
      const nextExtraKeys = new Set();
      nextSlots.extras.forEach(src => {
        const k = CC.getPhotoKey(src);
        if (!k) return;
        nextExtraKeys.add(k);
      });

      if (prevRecord) {
        prevExtraKeys.forEach(k => {
          if (!nextExtraKeys.has(k)) {
            extraTombstones[k] = { ts: now, rev, deviceId };
          }
        });
        nextExtraKeys.forEach(k => {
          const tomb = extraTombstones[k];
          const add = extraAdded[k];
          const wasTombstoned = Boolean(tomb && (!add || compareRevMeta(Number(tomb.ts || 0), String(tomb.rev || ''), Number(add.ts || 0), String(add.rev || '')) >= 0));
          if (!prevExtraKeys.has(k) || wasTombstoned) {
            extraAdded[k] = { ts: now, rev, deviceId };
          }
        });
      } else {
        nextExtraKeys.forEach(k => {
          if (!extraAdded[k]) extraAdded[k] = { ts: now, rev, deviceId };
        });
      }

      rec.photo_slots = {
        front: nextSlots.front,
        back: nextSlots.back,
        extras: nextSlots.extras,
        extra_added: extraAdded,
        extra_tombstones: extraTombstones
      };
    }

    rec.field_revs = fRevs;
    rec._fieldMeta = fMeta;
    return rec;
  };

  CC.getSyncIdAliases = async () => {
    try {
      const rec = await CC.idbGet('meta', SYNC_ID_ALIASES_KEY);
      return Object.assign({}, rec?.value || {});
    } catch (_) {
      return {};
    }
  };

  function resolveCanonicalSyncId(sid, aliasMap) {
    let cur = String(sid || '');
    if (!cur || !aliasMap) return cur;
    const seen = new Set();
    while (aliasMap[cur]?.targetSyncId && !seen.has(cur)) {
      seen.add(cur);
      cur = String(aliasMap[cur].targetSyncId);
    }
    return cur;
  }

  function mergeAliasMaps(a, b) {
    const out = Object.assign({}, a || {});
    Object.entries(b || {}).forEach(([retiredSid, entry]) => {
      if (!retiredSid || !entry?.targetSyncId || retiredSid === entry.targetSyncId) return;
      const prev = out[retiredSid];
      if (!prev) {
        out[retiredSid] = { ...entry };
      } else {
        // Pick deterministic target (lexicographically smaller targetSyncId wins consistently across devices)
        const target = String(entry.targetSyncId).localeCompare(String(prev.targetSyncId)) <= 0
          ? entry.targetSyncId
          : prev.targetSyncId;
        out[retiredSid] = {
          ...prev,
          ...entry,
          targetSyncId: target,
          retiredAt: Math.max(Number(prev.retiredAt || 0), Number(entry.retiredAt || 0))
        };
      }
    });
    // Flatten chains (path compression)
    Object.keys(out).forEach(k => {
      const finalTarget = resolveCanonicalSyncId(k, out);
      if (finalTarget && finalTarget !== k) out[k].targetSyncId = finalTarget;
      else delete out[k];
    });
    return out;
  }

  // Read multiple meta keys inside an active readwrite IndexedDB transaction synchronously via onsuccess chaining
  function readMetaInTx(metaStore, keys, onDone) {
    const out = {};
    let remaining = keys.length;
    if (!remaining) { onDone(out); return; }
    keys.forEach(k => {
      const req = metaStore.get(k);
      req.onsuccess = () => {
        out[k] = req.result?.value;
        if (--remaining === 0) onDone(out);
      };
    });
  }

  function hashString64Hex(str) {
    const s = String(str || '');
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= (c + i);
      h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  // Fast synchronous deterministic photo key helper for CRDT extra-slot tracking
  CC.getPhotoKey = (src) => {
    const s = String(src || '').trim();
    if (!s) return '';
    if (s.startsWith('gdrive:')) return s;
    if (s.startsWith('data:image/')) return 'fp_' + hashString64Hex(s);
    return s;
  };

  function cleanExtraMetaMap(obj) {
    const out = {};
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        if (k && v && typeof v === 'object') out[String(k)] = { ...v };
      }
    }
    return out;
  }

  // Stable named photo slots helper (migrates legacy positional thumbs cleanly)
  CC.normalizePhotoSlots = (rec) => {
    if (rec && rec.photo_slots && typeof rec.photo_slots === 'object') {
      return {
        front: String(rec.photo_slots.front || ''),
        back: String(rec.photo_slots.back || ''),
        extras: Array.isArray(rec.photo_slots.extras) ? rec.photo_slots.extras.filter(Boolean).map(String) : [],
        extra_added: cleanExtraMetaMap(rec.photo_slots.extra_added),
        extra_tombstones: cleanExtraMetaMap(rec.photo_slots.extra_tombstones)
      };
    }
    const legacy = Array.isArray(rec?.thumbs) && rec.thumbs.length
      ? rec.thumbs.filter(Boolean).map(String)
      : (rec?.thumb_data_url && (String(rec.thumb_data_url).startsWith('data:image/') || String(rec.thumb_data_url).startsWith('gdrive:'))
        ? [String(rec.thumb_data_url)]
        : []);
    return {
      front: legacy[0] || '',
      back: legacy[1] || '',
      extras: legacy.slice(2),
      extra_added: {},
      extra_tombstones: {}
    };
  };

  CC.deriveThumbsFromSlots = (slots, discogsThumb = '') => {
    const s = slots || { front: '', back: '', extras: [] };
    const extras = Array.isArray(s.extras) ? s.extras.filter(Boolean) : [];
    const thumbs = [s.front, s.back, ...extras].filter(Boolean);
    const thumb_data_url = s.front || s.back || extras[0] || discogsThumb || '';
    return { thumbs, thumb_data_url };
  };

  // Atomic live-row Stash mutation: re-reads live row + tombstones + outbox inside ONE readwrite transaction.
  // If the item was deleted/tombstoned while photo work was in flight, aborts cleanly without recreating it!
  CC.mutateStashItemIfAlive = async (id, syncId, updaterFn, changedFields = null) => withLocalCommitLock(async () => {
    let outcome = { aborted: true, reason: 'missing', savedStash: null, pendingCount: 0 };
    await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
      readMetaInTx(metaStore, ['deleted_sync_ids', SYNC_ID_ALIASES_KEY, CLOUD_OUTBOX_KEY], (m) => {
        const deletedMap = Object.assign({}, m.deleted_sync_ids || {});
        const aliases = Object.assign({}, m[SYNC_ID_ALIASES_KEY] || {});
        const liveQueue = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue.slice() : [];

        const finishWithLiveRow = (liveRow) => {
          if (!liveRow) {
            outcome = { aborted: true, reason: 'deleted', savedStash: null, pendingCount: liveQueue.length };
            return;
          }
          const canonSid = resolveCanonicalSyncId(liveRow.sync_id || syncId || '', aliases);
          const delTs = normTombstoneTs(deletedMap[canonSid]);
          const recTs = Number(liveRow.updated_at || liveRow.created_at || 0);
          if (delTs > 0 && delTs >= recTs) {
            outcome = { aborted: true, reason: 'tombstoned', savedStash: null, pendingCount: liveQueue.length };
            return;
          }
          const nextRaw = updaterFn({ ...liveRow });
          if (!nextRaw) {
            outcome = { aborted: true, reason: 'noop', savedStash: liveRow, pendingCount: liveQueue.length };
            return;
          }
          const stamped = CC.stampStashRevision(nextRaw, liveRow, changedFields);
          stamped.sync_id = canonSid || stamped.sync_id || CC.generateSyncId();
          if (liveRow.id !== undefined) stamped.id = liveRow.id;
          stashStore.put(stamped);

          const opCopy = { ...stamped };
          delete opCopy.id;
          const now = Date.now();
          liveQueue.push({
            batchId: CC.newBatchId(),
            accountEmail: CC.cfg.googleBoundEmail || CC.cfg.googleEmail || '',
            createdAt: now,
            deviceId: CC.getDeviceId(),
            status: 'queued',
            ops: [{ type: 'upsert_stash', sync_id: stamped.sync_id, record: opCopy }]
          });
          metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: liveQueue } });
          outcome = { aborted: false, reason: '', savedStash: stamped, pendingCount: liveQueue.length };
        };

        if (id !== undefined && id !== null) {
          const getReq = stashStore.get(id);
          getReq.onsuccess = () => {
            if (getReq.result) {
              finishWithLiveRow(getReq.result);
            } else if (syncId) {
              const allReq = stashStore.getAll();
              allReq.onsuccess = () => {
                const targetCanon = resolveCanonicalSyncId(syncId, aliases);
                const found = (allReq.result || []).find(r => resolveCanonicalSyncId(r.sync_id || '', aliases) === targetCanon);
                finishWithLiveRow(found || null);
              };
            } else {
              finishWithLiveRow(null);
            }
          };
        } else if (syncId) {
          const allReq = stashStore.getAll();
          allReq.onsuccess = () => {
            const targetCanon = resolveCanonicalSyncId(syncId, aliases);
            const found = (allReq.result || []).find(r => resolveCanonicalSyncId(r.sync_id || '', aliases) === targetCanon);
            finishWithLiveRow(found || null);
          };
        } else {
          finishWithLiveRow(null);
        }
      });
    });

    if (!outcome.aborted) CC.setPendingCloudChanges(outcome.pendingCount);
    return outcome;
  });

  // Atomic live-row BATCH Stash mutation inside ONE readwrite transaction:
  // Re-reads live stash rows, tombstones, aliases & outbox; skips deleted/tombstoned rows (never resurrects!),
  // applies ONLY patchFn(liveRow) so concurrent edits to notes/grades/photos survive, and queues ONE outbox batch.
  CC.mutateBatchStashItemsIfAlive = async (updatesList = [], changedFields = null, queueOutbox = true) => withLocalCommitLock(async () => {
    let updatedCount = 0;
    let skippedDeletedCount = 0;
    let pendingCount = 0;
    const list = Array.isArray(updatesList) ? updatesList : [];
    if (!list.length) return { updatedCount: 0, skippedDeletedCount: 0, pendingCount: 0 };

    await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
      const allReq = stashStore.getAll();
      allReq.onsuccess = () => {
        const liveRows = Array.isArray(allReq.result) ? allReq.result : [];
        readMetaInTx(metaStore, ['deleted_sync_ids', SYNC_ID_ALIASES_KEY, CLOUD_OUTBOX_KEY], (m) => {
          const deletedMap = Object.assign({}, m.deleted_sync_ids || {});
          const aliases = Object.assign({}, m[SYNC_ID_ALIASES_KEY] || {});
          const liveQueue = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue.slice() : [];
          pendingCount = liveQueue.length;

          const liveById = new Map();
          const liveByCanonSid = new Map();
          liveRows.forEach(r => {
            if (r.id !== undefined && r.id !== null) liveById.set(r.id, r);
            if (r.sync_id) {
              const cSid = resolveCanonicalSyncId(r.sync_id, aliases);
              if (cSid) liveByCanonSid.set(cSid, r);
            }
          });

          const ops = [];
          for (const entry of list) {
            if (!entry || typeof entry.patchFn !== 'function') continue;
            let liveRow = (entry.id !== undefined && entry.id !== null) ? liveById.get(entry.id) : null;
            if (!liveRow && entry.sync_id) {
              const targetCanon = resolveCanonicalSyncId(entry.sync_id, aliases);
              if (targetCanon) liveRow = liveByCanonSid.get(targetCanon) || null;
            }
            if (!liveRow) {
              skippedDeletedCount++;
              continue;
            }
            const canonSid = resolveCanonicalSyncId(liveRow.sync_id || entry.sync_id || '', aliases);
            const delTs = normTombstoneTs(deletedMap[canonSid]);
            const recTs = Number(liveRow.updated_at || liveRow.created_at || 0);
            if (delTs > 0 && delTs >= recTs) {
              skippedDeletedCount++;
              continue;
            }
            const nextRaw = entry.patchFn({ ...liveRow });
            if (!nextRaw) continue;

            const stamped = CC.stampStashRevision(nextRaw, liveRow, changedFields);
            stamped.sync_id = canonSid || stamped.sync_id || CC.generateSyncId();
            if (liveRow.id !== undefined) stamped.id = liveRow.id;
            stashStore.put(stamped);

            if (stamped.id !== undefined && stamped.id !== null) liveById.set(stamped.id, stamped);
            if (stamped.sync_id) liveByCanonSid.set(resolveCanonicalSyncId(stamped.sync_id, aliases), stamped);

            const opCopy = { ...stamped };
            delete opCopy.id;
            ops.push({ type: 'upsert_stash', sync_id: stamped.sync_id, record: opCopy });
            updatedCount++;
          }

          if (queueOutbox && ops.length > 0) {
            liveQueue.push({
              batchId: CC.newBatchId(),
              accountEmail: CC.cfg.googleBoundEmail || CC.cfg.googleEmail || '',
              createdAt: Date.now(),
              deviceId: CC.getDeviceId(),
              status: 'queued',
              ops
            });
            metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: liveQueue } });
            pendingCount = liveQueue.length;
          }
        });
      };
    });

    if (queueOutbox && updatedCount > 0) {
      CC.setPendingCloudChanges(pendingCount);
    }
    return { updatedCount, skippedDeletedCount, pendingCount };
  });

  // Serialized atomic local mutation: reads & updates outbox/tombstones/aliases inside ONE readwrite transaction (safe across tabs!)
  CC.commitLocalMutation = async (opts = {}) => withLocalCommitLock(async () => {
    const {
      upsertStash = null,
      deleteStash = null, // { id, sync_id }
      metaPuts = [],      // [{ key, value }]
      metaDeletes = [],   // ['key']
      extraOps = [],      // [{ type, ... }]
      queueOutbox = true
    } = opts || {};

    let savedStash = upsertStash ? { ...upsertStash } : null;
    let assignedId = savedStash?.id;
    let createdBatch = null;
    let pendingCount = 0;

    await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
      readMetaInTx(metaStore, [CLOUD_OUTBOX_KEY, 'deleted_sync_ids', SYNC_ID_ALIASES_KEY], (m) => {
        const outboxBefore = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue : [];
        const deletedBefore = m.deleted_sync_ids || {};
        const aliases = m[SYNC_ID_ALIASES_KEY] || {};
        const now = Date.now();
        const ops = [...extraOps];

        if (savedStash) {
          if (!savedStash.sync_id) savedStash.sync_id = CC.generateSyncId();
          savedStash.sync_id = resolveCanonicalSyncId(savedStash.sync_id, aliases);
          if (!savedStash.rev) savedStash = CC.stampStashRevision(savedStash, null);
          const opCopy = { ...savedStash };
          delete opCopy.id;
          ops.push({ type: 'upsert_stash', sync_id: savedStash.sync_id, record: opCopy });
        }

        const updatedDeleted = Object.assign({}, deletedBefore);
        const delSyncId = deleteStash?.sync_id ? resolveCanonicalSyncId(deleteStash.sync_id, aliases) : null;
        if (delSyncId) {
          const delEntry = { ts: now, rev: CC.newRev(), deviceId: CC.getDeviceId() };
          updatedDeleted[delSyncId] = delEntry;
          ops.push({ type: 'delete_stash', sync_id: delSyncId, deleted: delEntry });
        }

        const nextQueue = outboxBefore.slice();
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
        pendingCount = nextQueue.length;

        if (savedStash) {
          const req = stashStore.put(savedStash);
          req.onsuccess = () => { assignedId = req.result; savedStash.id = assignedId; };
        }
        if (deleteStash?.id !== undefined && deleteStash?.id !== null) {
          stashStore.delete(deleteStash.id);
        }
        if (delSyncId) {
          metaStore.put({ key: 'deleted_sync_ids', value: updatedDeleted });
        }
        for (const mp of metaPuts) {
          metaStore.put(mp);
        }
        for (const mk of metaDeletes) {
          metaStore.delete(mk);
        }
        if (createdBatch) {
          metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: nextQueue } });
        }
      });
    });

    if (createdBatch) CC.setPendingCloudChanges(pendingCount);
    return { savedStash, assignedId, batch: createdBatch, pendingCount };
  });

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
    const allV2BatchFiles = [];      // every ss_v2_batch_*.json file
    const v2Secrets = new Map();     // batchId -> file
    const legacyDeltas = [];
    const snapshotFiles = [];        // ALL softspot_state.json / cratecheck_state.json files (sorted oldest -> newest)
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
        if (GDRIVE_LEGACY_STATE_NAMES.includes(f.name)) {
          snapshotFiles.push(f);
        }
        const mBatch = f.name.match(GDRIVE_V2_BATCH_RX);
        if (mBatch) {
          allV2BatchFiles.push({ ...f, batchId: mBatch[1] });
          if (!v2Batches.has(mBatch[1])) {
            v2Batches.set(mBatch[1], { ...f, batchId: mBatch[1] });
          }
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

    snapshotFiles.sort((a, b) =>
      String(a.modifiedTime || '').localeCompare(String(b.modifiedTime || '')) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );

    return { map, snapshotFiles, v2Batches, allV2BatchFiles, v2Secrets, legacyDeltas };
  }

  async function uploadAppDataMultipart(name, contentBlob, mimeType, existingFileId = null) {
    const boundary = 'ss_v2_' + Math.random().toString(36).slice(2, 12);
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

  async function deleteAppDataFile(fileId) {
    if (!fileId) return false;
    try {
      await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      return true;
    } catch (err) {
      if (err?.status === 404) return true;
      return false;
    }
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

  function mergePhotoListsUnique(listA, listB) {
    const out = [];
    const seen = new Set();
    const add = (src) => {
      const s = String(src || '').trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };
    (Array.isArray(listA) ? listA : []).forEach(add);
    (Array.isArray(listB) ? listB : []).forEach(add);
    return out;
  }

  CC.USER_CONFLICT_FIELDS = new Set([
    'media_condition',
    'sleeve_condition',
    'condition_note',
    'title',
    'artist',
    'catno',
    'discogs_id'
  ]);

  function isMergeValueEmpty(field, val) {
    if (val === undefined || val === null || val === '') return true;
    if (Array.isArray(val) && val.length === 0) return true;
    if (field === 'photo_slots' && typeof val === 'object') {
      return !val.front && !val.back && (!Array.isArray(val.extras) || val.extras.length === 0);
    }
    if ((field === 'media_condition' || field === 'sleeve_condition') && val === 'Not Graded') return true;
    return false;
  }

  function isGenuineConflictEntry(c) {
    if (!c || !c.field) return false;
    if (!CC.USER_CONFLICT_FIELDS.has(c.field)) return false;
    if (isMergeValueEmpty(c.field, c.retainedVal)) return false;
    if (isMergeValueEmpty(c.field, c.keptVal)) return false;
    return true;
  }

  CC.mergeStashRecordsDeterministic = (localRec, remoteRec, opts = {}) => {
    const { localUnsynced = false, duplicateMerge = false } = opts || {};
    if (!localRec) return { merged: { ...remoteRec }, conflicts: [] };
    if (!remoteRec) return { merged: { ...localRec }, conflicts: [] };

    const locTs = Number(localRec.updated_at || localRec.created_at || 0);
    const remTs = Number(remoteRec.updated_at || remoteRec.created_at || 0);
    const locRev = String(localRec.rev || '');
    const remRev = String(remoteRec.rev || '');

    // Direct ancestry fast paths (only when NOT merging distinct duplicate records and local has no unpushed competing changes)
    if (!duplicateMerge && !localUnsynced && remoteRec.parent_rev && locRev && remoteRec.parent_rev === locRev) {
      const m = { ...remoteRec };
      if (localRec.id !== undefined) m.id = localRec.id;
      return { merged: m, conflicts: [] };
    }
    if (!duplicateMerge && localRec.parent_rev && remRev && localRec.parent_rev === remRev) {
      const m = { ...localRec };
      return { merged: m, conflicts: [] };
    }

    const merged = { ...localRec };
    const conflicts = (Array.isArray(localRec.conflicts) ? localRec.conflicts : []).filter(isGenuineConflictEntry);
    (Array.isArray(remoteRec.conflicts) ? remoteRec.conflicts : []).forEach(c => {
      if (isGenuineConflictEntry(c) && !conflicts.some(x => x.id === c.id)) conflicts.push(c);
    });
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

    // Pre-handle coherent spine unit during duplicate merge (if only one side has a spine, keep all 3 spine fields together!)
    const locHasSpine = Boolean(localRec.spine_thumb_url);
    const remHasSpine = Boolean(remoteRec.spine_thumb_url);
    let spineHandled = false;
    if (duplicateMerge && (locHasSpine !== remHasSpine)) {
      const src = locHasSpine ? localRec : remoteRec;
      const srcRevs = locHasSpine ? locFRevs : remFRevs;
      merged.spine_thumb_url = src.spine_thumb_url || '';
      merged.spine_source_url = src.spine_source_url || '';
      merged.spine_flipped = Boolean(src.spine_flipped);
      ['spine_thumb_url', 'spine_source_url', 'spine_flipped'].forEach(sf => {
        if (srcRevs[sf]) mergedFieldRevs[sf] = srcRevs[sf];
      });
      spineHandled = true;
    }

    for (const f of STASH_MERGE_FIELDS) {
      if (spineHandled && (f === 'spine_thumb_url' || f === 'spine_source_url' || f === 'spine_flipped')) {
        continue;
      }

      const lv = localRec[f];
      const rv = remoteRec[f];
      if (JSON.stringify(lv) === JSON.stringify(rv)) {
        if (remFRevs[f] && (!mergedFieldRevs[f] || remFRevs[f].ts > mergedFieldRevs[f].ts)) {
          mergedFieldRevs[f] = remFRevs[f];
        }
        continue;
      }

      // Independent per-slot photo_slots merge (photo_slots.front, photo_slots.back, photo_slots.extras with per-photo CRDT maps)
      if (f === 'photo_slots') {
        const slL = CC.normalizePhotoSlots({ photo_slots: lv, thumbs: localRec.thumbs, thumb_data_url: localRec.thumb_data_url });
        const slR = CC.normalizePhotoSlots({ photo_slots: rv, thumbs: remoteRec.thumbs, thumb_data_url: remoteRec.thumb_data_url });
        const parentLMeta = locFRevs.photo_slots || localRec._fieldMeta?.photo_slots || null;
        const parentRMeta = remFRevs.photo_slots || remoteRec._fieldMeta?.photo_slots || null;

        const mergeExtraMetaMaps = (mL, mR) => {
          const out = {};
          const keys = new Set([...Object.keys(mL || {}), ...Object.keys(mR || {})]);
          for (const k of keys) {
            const a = mL?.[k] || null;
            const b = mR?.[k] || null;
            if (a && !b) { out[k] = { ...a }; continue; }
            if (b && !a) { out[k] = { ...b }; continue; }
            if (a && b) {
              out[k] = compareRevMeta(Number(b.ts || 0), String(b.rev || ''), Number(a.ts || 0), String(a.rev || '')) > 0
                ? { ...b }
                : { ...a };
            }
          }
          return out;
        };

        const mergedExtraAdded = mergeExtraMetaMaps(slL.extra_added, slR.extra_added);
        const mergedExtraTombstones = mergeExtraMetaMaps(slL.extra_tombstones, slR.extra_tombstones);

        if (duplicateMerge) {
          const combinedExtras = mergePhotoListsUnique(slL.extras, slR.extras);
          const front = slL.front || slR.front || '';
          const back = slL.back || slR.back || '';
          if (slL.front && slR.front && slL.front !== slR.front && !combinedExtras.includes(slR.front)) combinedExtras.push(slR.front);
          if (slL.back && slR.back && slL.back !== slR.back && !combinedExtras.includes(slR.back)) combinedExtras.push(slR.back);
          merged.photo_slots = { front, back, extras: combinedExtras, extra_added: mergedExtraAdded, extra_tombstones: mergedExtraTombstones };
          ['photo_slots.front', 'photo_slots.back', 'photo_slots.extras'].forEach(sk => {
            const lm = locFRevs[sk] || localRec._fieldMeta?.[sk] || parentLMeta;
            const rm = remFRevs[sk] || remoteRec._fieldMeta?.[sk] || parentRMeta;
            const win = compareRevMeta(Number(rm?.ts || remTs), String(rm?.rev || remRev), Number(lm?.ts || locTs), String(lm?.rev || locRev)) > 0
              ? (rm || { ts: remTs, rev: remRev })
              : (lm || { ts: locTs, rev: locRev });
            mergedFieldRevs[sk] = win;
          });
          const winMeta = compareRevMeta(Number(parentRMeta?.ts || remTs), String(parentRMeta?.rev || remRev), Number(parentLMeta?.ts || locTs), String(parentLMeta?.rev || locRev)) > 0
            ? (parentRMeta || { ts: remTs, rev: remRev })
            : (parentLMeta || { ts: locTs, rev: locRev });
          mergedFieldRevs[f] = winMeta;
          continue;
        }

        const mergeSubSlot = (subKey, lSubVal, rSubVal, isArr = false) => {
          const lm = locFRevs[subKey] || localRec._fieldMeta?.[subKey] || (lv ? parentLMeta : null);
          const rm = remFRevs[subKey] || remoteRec._fieldMeta?.[subKey] || (rv ? parentRMeta : null);
          const lEmptySub = isArr ? (!Array.isArray(lSubVal) || lSubVal.length === 0) : !String(lSubVal || '').trim();
          const rEmptySub = isArr ? (!Array.isArray(rSubVal) || rSubVal.length === 0) : !String(rSubVal || '').trim();
          const lHasSubTs = Number(lm?.ts || 0) > 0;
          const rHasSubTs = Number(rm?.ts || 0) > 0;

          if (JSON.stringify(lSubVal) === JSON.stringify(rSubVal)) {
            if (rm && (!lm || Number(rm.ts || 0) > Number(lm.ts || 0))) mergedFieldRevs[subKey] = rm;
            else if (lm) mergedFieldRevs[subKey] = lm;
            return lSubVal;
          }

          // Per-photo CRDT merge for photo_slots.extras:
          // Direct descendant honors removals; concurrent edits union both sides' extras while excluding
          // every photo whose extra_tombstones[key] is newer than or equal to its extra_added[key].
          if (subKey === 'photo_slots.extras' && isArr) {
            if (rm?.parentRev && lm?.rev && rm.parentRev === lm.rev) {
              mergedFieldRevs[subKey] = rm;
              return rSubVal;
            }
            if (lm?.parentRev && rm?.rev && lm.parentRev === rm.rev) {
              mergedFieldRevs[subKey] = lm;
              return lSubVal;
            }
            const lSubTsU = Number(lm?.ts || locTs);
            const rSubTsU = Number(rm?.ts || remTs);
            const lSubRevU = String(lm?.rev || locRev);
            const rSubRevU = String(rm?.rev || remRev);
            const rWinsU = compareRevMeta(rSubTsU, rSubRevU, lSubTsU, lSubRevU) > 0;
            const hasCrdtMeta = Object.keys(mergedExtraAdded).length > 0 || Object.keys(mergedExtraTombstones).length > 0;
            const lDev = String(lm?.deviceId || '');
            const rDev = String(rm?.deviceId || '');
            const sameDevice = Boolean(lDev && rDev && lDev === rDev);

            if (hasCrdtMeta || (!sameDevice && Array.isArray(lSubVal) && lSubVal.length > 0 && Array.isArray(rSubVal) && rSubVal.length > 0)) {
              mergedFieldRevs[subKey] = rWinsU ? (rm || { ts: rSubTsU, rev: rSubRevU }) : (lm || { ts: lSubTsU, rev: lSubRevU });
              const firstList = rWinsU ? rSubVal : lSubVal;
              const secondList = rWinsU ? lSubVal : rSubVal;
              const byKey = new Map();
              const addSrc = (src) => {
                const s = String(src || '').trim();
                if (!s) return;
                const k = CC.getPhotoKey(s);
                if (!k) return;
                if (!byKey.has(k)) {
                  byKey.set(k, s);
                } else if (byKey.get(k).startsWith('gdrive:') && s.startsWith('data:image/')) {
                  byKey.set(k, s);
                }
              };
              (Array.isArray(firstList) ? firstList : []).forEach(addSrc);
              (Array.isArray(secondList) ? secondList : []).forEach(addSrc);

              const surviving = [];
              for (const [k, src] of byKey.entries()) {
                const tomb = mergedExtraTombstones[k];
                if (tomb) {
                  const add = mergedExtraAdded[k];
                  const delTs = Number(tomb.ts || 0);
                  const delRev = String(tomb.rev || '');
                  const addTs = Number(add?.ts || 0);
                  const addRev = String(add?.rev || '');
                  if (compareRevMeta(delTs, delRev, addTs, addRev) >= 0) continue;
                }
                surviving.push(src);
              }
              return surviving;
            }
          }

          if (lEmptySub && !rEmptySub && !lHasSubTs) {
            if (rm) mergedFieldRevs[subKey] = rm;
            return rSubVal;
          }
          if (rEmptySub && !lEmptySub && !rHasSubTs) {
            if (lm) mergedFieldRevs[subKey] = lm;
            return lSubVal;
          }
          if (rHasSubTs && !lHasSubTs) {
            mergedFieldRevs[subKey] = rm;
            return rSubVal;
          }
          if (lHasSubTs && !rHasSubTs) {
            mergedFieldRevs[subKey] = lm;
            return lSubVal;
          }
          const lSubTs = Number(lm?.ts || locTs);
          const rSubTs = Number(rm?.ts || remTs);
          const lSubRev = String(lm?.rev || locRev);
          const rSubRev = String(rm?.rev || remRev);
          const rWins = compareRevMeta(rSubTs, rSubRev, lSubTs, lSubRev) > 0;
          mergedFieldRevs[subKey] = rWins ? (rm || { ts: rSubTs, rev: rSubRev }) : (lm || { ts: lSubTs, rev: lSubRev });
          return rWins ? rSubVal : lSubVal;
        };

        const mergedFront = mergeSubSlot('photo_slots.front', slL.front, slR.front, false);
        const mergedBack = mergeSubSlot('photo_slots.back', slL.back, slR.back, false);
        const mergedExtras = mergeSubSlot('photo_slots.extras', slL.extras, slR.extras, true);
        merged.photo_slots = {
          front: String(mergedFront || ''),
          back: String(mergedBack || ''),
          extras: Array.isArray(mergedExtras) ? mergedExtras.filter(Boolean).map(String) : [],
          extra_added: mergedExtraAdded,
          extra_tombstones: mergedExtraTombstones
        };
        const maxSlotMeta = [
          mergedFieldRevs['photo_slots.front'],
          mergedFieldRevs['photo_slots.back'],
          mergedFieldRevs['photo_slots.extras'],
          parentLMeta,
          parentRMeta
        ].filter(Boolean).sort((a, b) => compareRevMeta(Number(b.ts || 0), String(b.rev || ''), Number(a.ts || 0), String(a.rev || '')))[0];
        if (maxSlotMeta) mergedFieldRevs.photo_slots = maxSlotMeta;
        continue;
      }

      if (duplicateMerge && f === 'thumbs') {
        const combined = mergePhotoListsUnique(lv, rv);
        merged.thumbs = combined;
        const winMeta = compareRevMeta(Number(remFRevs[f]?.ts || remTs), String(remFRevs[f]?.rev || remRev), Number(locFRevs[f]?.ts || locTs), String(locFRevs[f]?.rev || locRev)) > 0
          ? (remFRevs[f] || { ts: remTs, rev: remRev })
          : (locFRevs[f] || { ts: locTs, rev: locRev });
        mergedFieldRevs[f] = winMeta;
        continue;
      }

      if (duplicateMerge && f === 'thumb_data_url') {
        const lIsUser = typeof lv === 'string' && (lv.startsWith('data:image/') || lv.startsWith('gdrive:'));
        const rIsUser = typeof rv === 'string' && (rv.startsWith('data:image/') || rv.startsWith('gdrive:'));
        if (lIsUser && !rIsUser) { merged.thumb_data_url = lv; continue; }
        if (rIsUser && !lIsUser) { merged.thumb_data_url = rv; if (remFRevs[f]) mergedFieldRevs[f] = remFRevs[f]; continue; }
      }

      // Carry forward active pending_folder_move on duplicate merge (newest startedAt wins)
      if (duplicateMerge && f === 'pending_folder_move') {
        if (lv && !rv) { merged.pending_folder_move = lv; continue; }
        if (rv && !lv) { merged.pending_folder_move = rv; if (remFRevs[f]) mergedFieldRevs[f] = remFRevs[f]; continue; }
        if (lv && rv) {
          merged.pending_folder_move = Number(rv.startedAt || 0) > Number(lv.startedAt || 0) ? rv : lv;
          continue;
        }
      }

      // Discogs is authoritative for remote location: strictly newer verified timestamp wins cleanly without replaying moves
      if (DISCOGS_LOC_FIELDS.has(f) && locDiscogsVerTs !== remDiscogsVerTs) {
        if (remDiscogsVerTs > locDiscogsVerTs) {
          merged[f] = rv;
          if (remFRevs[f]) mergedFieldRevs[f] = remFRevs[f];
        }
        continue;
      }

      const lEmpty = isMergeValueEmpty(f, lv);
      const rEmpty = isMergeValueEmpty(f, rv);
      const lMeta = locFRevs[f] || localRec._fieldMeta?.[f] || null;
      const rMeta = remFRevs[f] || remoteRec._fieldMeta?.[f] || null;
      const lHasTs = Number(lMeta?.ts || 0) > 0;
      const rHasTs = Number(rMeta?.ts || 0) > 0;

      // ONLY allow populated value to beat an empty/reset value ("", [], 'Not Graded') automatically when the empty side has NO edit timestamp!
      // If the user intentionally cleared condition_note to "" or reset a grade to 'Not Graded', its timestamp is respected cleanly.
      if (lEmpty && !rEmpty && !lHasTs) {
        merged[f] = rv;
        if (rMeta) mergedFieldRevs[f] = rMeta;
        continue;
      }
      if (rEmpty && !lEmpty && !rHasTs) {
        continue;
      }

      // If only one side has explicit field_revs entry for this field (unrelated field edits on two devices!), take that side cleanly
      if (rHasTs && !lHasTs) {
        merged[f] = rv;
        mergedFieldRevs[f] = rMeta;
        continue;
      }
      if (lHasTs && !rHasTs) {
        continue;
      }

      // Both sides edited the same non-empty field -> converge deterministically by (ts, rev)
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

      // Restrict conflict banners STRICTLY to genuine cross-device edits on USER_CONFLICT_FIELDS!
      const sameDevice = Boolean(lMeta?.deviceId && rMeta?.deviceId && lMeta.deviceId === rMeta.deviceId);
      if (
        CC.USER_CONFLICT_FIELDS.has(f) &&
        !sameDevice &&
        !isMergeValueEmpty(f, keptVal) &&
        !isMergeValueEmpty(f, retainedVal)
      ) {
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

    // Keep derived thumbs / thumb_data_url consistent with photo_slots ONLY when photo_slots has equal or newer revision timestamps than thumbs
    // (so an older photo_slots never overwrites newer thumbs synced from a v2.1.x device!)
    if (merged.photo_slots && typeof merged.photo_slots === 'object') {
      const slotTs = Math.max(
        Number(mergedFieldRevs.photo_slots?.ts || 0),
        Number(mergedFieldRevs['photo_slots.front']?.ts || 0),
        Number(mergedFieldRevs['photo_slots.back']?.ts || 0),
        Number(mergedFieldRevs['photo_slots.extras']?.ts || 0)
      );
      const thumbsTs = Math.max(
        Number(mergedFieldRevs.thumbs?.ts || 0),
        Number(mergedFieldRevs.thumb_data_url?.ts || 0)
      );
      if (slotTs >= thumbsTs || duplicateMerge) {
        const derived = CC.deriveThumbsFromSlots(CC.normalizePhotoSlots(merged), merged.discogs_thumb || '');
        merged.thumbs = derived.thumbs;
        merged.thumb_data_url = derived.thumb_data_url;
      } else if (Array.isArray(merged.thumbs)) {
        // Legacy v2.1.x device had newer thumbs — refresh photo_slots from those newer thumbs
        merged.photo_slots = CC.normalizePhotoSlots({ thumbs: merged.thumbs, thumb_data_url: merged.thumb_data_url });
      }
    } else if (duplicateMerge && Array.isArray(merged.thumbs) && merged.thumbs.length > 0) {
      const curThumb = String(merged.thumb_data_url || '');
      if (!curThumb || (!curThumb.startsWith('data:image/') && !curThumb.startsWith('gdrive:'))) {
        merged.thumb_data_url = merged.thumbs[0];
      }
    }
    // Clear pending_folder_move if verified folder already reached target
    if (merged.pending_folder_move && String(merged.discogs_folder_id || '') === String(merged.pending_folder_move.targetFolderId || '')) {
      merged.pending_folder_move = null;
    }

    merged.field_revs = mergedFieldRevs;
    merged.updated_at = Math.max(locTs, remTs);
    merged.rev = compareRevMeta(remTs, remRev, locTs, locRev) > 0 ? (remRev || locRev) : (locRev || remRev);
    merged.created_at = Math.min(Number(localRec.created_at || merged.updated_at), Number(remoteRec.created_at || merged.updated_at));
    if (conflicts.length) merged.conflicts = conflicts.slice(-10);
    else delete merged.conflicts;
    if (localRec.id !== undefined) merged.id = localRec.id;

    return { merged, conflicts: newConflicts };
  };

  // Purge legacy false conflicts (derived/AI/hydrated fields or empty retainedVal) from Stash & cloud_sync_meta_v2
  CC.purgeFalseConflicts = async () => withLocalCommitLock(async () => {
    const stash = await CC.idbGetAll('stash');
    const syncMeta = await CC.getCloudSyncMeta();
    const toUpdate = [];
    let purgedCount = 0;

    for (const it of stash) {
      if (!Array.isArray(it.conflicts) || it.conflicts.length === 0) continue;
      const kept = it.conflicts.filter(isGenuineConflictEntry);
      if (kept.length !== it.conflicts.length) {
        purgedCount += (it.conflicts.length - kept.length);
        const next = { ...it };
        if (kept.length) next.conflicts = kept;
        else delete next.conflicts;
        toUpdate.push(next);
      }
    }

    const prevMetaLen = (syncMeta.conflicts || []).length;
    const keptMeta = (syncMeta.conflicts || []).filter(isGenuineConflictEntry);
    const metaChanged = keptMeta.length !== prevMetaLen;
    if (metaChanged) {
      purgedCount += (prevMetaLen - keptMeta.length);
      syncMeta.conflicts = keptMeta;
    }

    if (toUpdate.length > 0 || metaChanged) {
      await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
        for (const rec of toUpdate) stashStore.put(rec);
        if (metaChanged) metaStore.put({ key: CLOUD_META_KEY, value: syncMeta });
      });
    }
    return { purgedCount, updatedItems: toUpdate.length };
  });

  // Coalesce queued cloud outbox batches per accountEmail into ONE compact batch inside ONE readwrite transaction:
  // - Tracks timestamps per op so an older upsert_stash NEVER cancels a newer delete_stash tombstone
  // - Merges two upsert_stash ops for the same sync_id field-by-field via mergeStashRecordsDeterministic!
  CC.coalesceCloudOutbox = async () => withLocalCommitLock(async () => {
    let beforeLen = 0;
    let afterLen = 0;

    await CC.idbAtomicWrite(({ metaStore }) => {
      const req = metaStore.get(CLOUD_OUTBOX_KEY);
      req.onsuccess = () => {
        const rawQueue = Array.isArray(req.result?.value?.queue) ? req.result.value.queue : [];
        beforeLen = rawQueue.length;
        if (rawQueue.length <= 1) {
          afterLen = rawQueue.length;
          return;
        }

        const byAccount = new Map();
        for (const batch of rawQueue) {
          const acctKey = String(batch?.accountEmail || '').trim().toLowerCase();
          if (!byAccount.has(acctKey)) byAccount.set(acctKey, []);
          byAccount.get(acctKey).push(batch);
        }

        const opTimestamp = (op, batchCreatedAt) => {
          if (!op) return Number(batchCreatedAt || 0);
          if (op.type === 'delete_stash') return Math.max(normTombstoneTs(op.deleted), Number(batchCreatedAt || 0));
          if (op.type === 'upsert_stash') return Number(op.record?.updated_at || op.record?.created_at || batchCreatedAt || 0);
          return Number(batchCreatedAt || 0);
        };

        const compacted = [];
        for (const [, group] of byAccount.entries()) {
          if (group.length === 1) {
            compacted.push(group[0]);
            continue;
          }
          const opEntryByKey = new Map(); // key -> { op, ts }
          const orderedKeys = [];
          const putEntry = (key, op, ts) => {
            if (!opEntryByKey.has(key)) orderedKeys.push(key);
            opEntryByKey.set(key, { op, ts });
          };
          let isFullSeed = false;
          let latestCreatedAt = 0;
          let accountEmail = '';
          let deviceId = CC.getDeviceId();
          let idxCounter = 0;

          for (const b of group) {
            const bTs = Number(b.createdAt || 0);
            if (b.isFullSeed) isFullSeed = true;
            if (bTs > latestCreatedAt) latestCreatedAt = bTs;
            if (b.accountEmail) accountEmail = b.accountEmail;
            if (b.deviceId) deviceId = b.deviceId;
            for (const op of (b.ops || [])) {
              if (!op || !op.type) continue;
              const ts = opTimestamp(op, bTs);
              if ((op.type === 'upsert_stash' || op.type === 'delete_stash') && op.sync_id) {
                const key = `stash:${op.sync_id}`;
                const prev = opEntryByKey.get(key);
                if (!prev) {
                  putEntry(key, op, ts);
                } else if (prev.op.type === 'delete_stash' && op.type === 'upsert_stash') {
                  if (ts > prev.ts) putEntry(key, op, ts);
                } else if (prev.op.type === 'upsert_stash' && op.type === 'delete_stash') {
                  if (ts >= prev.ts) putEntry(key, op, ts);
                } else if (prev.op.type === 'delete_stash' && op.type === 'delete_stash') {
                  if (ts >= prev.ts) putEntry(key, op, ts);
                } else if (prev.op.type === 'upsert_stash' && op.type === 'upsert_stash') {
                  const mergedRes = CC.mergeStashRecordsDeterministic(prev.op.record, op.record);
                  const cleanRec = { ...mergedRes.merged };
                  delete cleanRec.id;
                  putEntry(key, { type: 'upsert_stash', sync_id: op.sync_id, record: cleanRec }, Math.max(prev.ts, ts));
                }
              } else if (op.type === 'retire_sync_id' && op.retired_sync_id) {
                putEntry(`retire:${op.retired_sync_id}`, op, ts);
              } else if (['prefs', 'discogs_index', 'spotify_profile', 'taste_profile'].includes(op.type)) {
                const key = `single:${op.type}`;
                const prev = opEntryByKey.get(key);
                if (!prev || ts >= prev.ts) putEntry(key, op, ts);
              } else {
                putEntry(`other:${idxCounter++}`, op, ts);
              }
            }
          }

          const ops = orderedKeys.map(k => opEntryByKey.get(k)?.op).filter(Boolean);
          if (ops.length > 0) {
            const mergedBatch = {
              batchId: CC.newBatchId(),
              accountEmail,
              createdAt: latestCreatedAt || Date.now(),
              deviceId,
              status: 'queued',
              ops
            };
            if (isFullSeed) mergedBatch.isFullSeed = true;
            compacted.push(mergedBatch);
          }
        }

        afterLen = compacted.length;
        metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: compacted } });
      };
    });

    CC.setPendingCloudChanges(afterLen);
    return { before: beforeLen, after: afterLen };
  });

  // Commit multiple Stash upserts + ONE combined Drive outbox batch atomically inside ONE readwrite transaction
  CC.commitBatchStashUpserts = async (records = [], queueOutbox = true) => withLocalCommitLock(async () => {
    const valid = (Array.isArray(records) ? records : []).filter(Boolean);
    if (!valid.length) return { count: 0 };
    let pendingCount = 0;
    let putCount = 0;

    await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
      readMetaInTx(metaStore, [CLOUD_OUTBOX_KEY, SYNC_ID_ALIASES_KEY], (m) => {
        const outboxBefore = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue : [];
        const aliases = m[SYNC_ID_ALIASES_KEY] || {};
        const toPut = [];
        const ops = [];

        for (const raw of valid) {
          let rec = { ...raw };
          if (!rec.sync_id) rec.sync_id = CC.generateSyncId();
          rec.sync_id = resolveCanonicalSyncId(rec.sync_id, aliases);
          if (!rec.rev) rec = CC.stampStashRevision(rec, null);
          toPut.push(rec);
          const opCopy = { ...rec };
          delete opCopy.id;
          ops.push({ type: 'upsert_stash', sync_id: rec.sync_id, record: opCopy });
        }

        const nextQueue = outboxBefore.slice();
        if (queueOutbox && ops.length > 0) {
          nextQueue.push({
            batchId: CC.newBatchId(),
            accountEmail: CC.cfg.googleBoundEmail || CC.cfg.googleEmail || '',
            createdAt: Date.now(),
            deviceId: CC.getDeviceId(),
            status: 'queued',
            ops
          });
        }

        for (const rec of toPut) stashStore.put(rec);
        if (queueOutbox && ops.length > 0) {
          metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: nextQueue } });
        }
        putCount = toPut.length;
        pendingCount = nextQueue.length;
      });
    });
    if (queueOutbox && putCount > 0) CC.setPendingCloudChanges(pendingCount);
    return { count: putCount, pendingCount };
  });

  // Deduplicate & deterministically merge records sharing a verified (discogs_account, discogs_id, discogs_instance_id)
  // NEVER merges local-only rows, removed rows, or rows without both confirmed account and instance_id!
  CC.dedupeAndMergeStashRecords = (records, existingAliases = {}) => {
    const aliases = mergeAliasMaps(existingAliases, {});
    const newAliases = {};
    const duplicateLocalIdsToDelete = [];
    const newConflicts = [];
    const repairedSurvivors = [];
    let mergedDuplicateCount = 0;

    // Step 1: Collapse any rows that resolve to the same canonical sync_id through existing aliases
    const byCanonSync = new Map();
    for (const rawRec of (records || [])) {
      if (!rawRec) continue;
      const origSid = String(rawRec.sync_id || CC.generateSyncId());
      const canonSid = resolveCanonicalSyncId(origSid, aliases);
      const rec = origSid === canonSid ? { ...rawRec, sync_id: canonSid } : { ...rawRec, sync_id: canonSid };

      const prev = byCanonSync.get(canonSid);
      if (!prev) {
        byCanonSync.set(canonSid, rec);
      } else {
        // Pick local ID to keep (prefer the row that already had canonSid)
        const keepId = (origSid === canonSid && rawRec.id !== undefined)
          ? rawRec.id
          : (prev.id !== undefined ? prev.id : rawRec.id);
        const dropId = (keepId === rawRec.id) ? prev.id : rawRec.id;
        if (dropId !== undefined && dropId !== null && dropId !== keepId) {
          duplicateLocalIdsToDelete.push(dropId);
        }
        const mRes = CC.mergeStashRecordsDeterministic(prev, rec, { duplicateMerge: true });
        mRes.merged.sync_id = canonSid;
        if (keepId !== undefined) mRes.merged.id = keepId;
        byCanonSync.set(canonSid, mRes.merged);
        if (mRes.conflicts.length) newConflicts.push(...mRes.conflicts);
        mergedDuplicateCount++;
        repairedSurvivors.push(mRes.merged);
      }
    }

    // Step 2: Group verified physical Discogs copies by canonical copy key.
    // Pre-scan all records to collect distinct non-empty normalized accounts per (relId, instId)
    // so an unowned legacy row ONLY merges when EXACTLY ONE unique account owns that (relId, instId).
    const accountsByRelInst = new Map();
    for (const rec of byCanonSync.values()) {
      if (rec.discogs_removed) continue;
      const ckOwned = CC.getDiscogsCopyKey(rec);
      const relId = Number(rec.discogs_id || 0);
      const instId = Number(rec.discogs_instance_id || 0);
      const acct = String(rec.discogs_account || '').trim().toLowerCase();
      if (ckOwned && relId > 0 && instId > 0 && acct) {
        const pairKey = `${relId}|${instId}`;
        if (!accountsByRelInst.has(pairKey)) accountsByRelInst.set(pairKey, new Map());
        accountsByRelInst.get(pairKey).set(acct, ckOwned);
      }
    }

    const copyGroups = new Map();
    const ungrouped = [];
    for (const rec of byCanonSync.values()) {
      let ck = CC.getDiscogsCopyKey(rec);
      const instId = Number(rec.discogs_instance_id || 0);
      const relId = Number(rec.discogs_id || 0);
      if (!ck && !rec.discogs_removed && instId > 0 && relId > 0) {
        const acctMap = accountsByRelInst.get(`${relId}|${instId}`);
        if (acctMap && acctMap.size === 1) {
          ck = Array.from(acctMap.values())[0];
        } else if (acctMap && acctMap.size >= 2) {
          // Ambiguous multi-account ownership: NEVER guess — leave unmerged & flag for user review!
          ungrouped.push({ ...rec, discogs_link_ambiguous: true });
          continue;
        } else {
          ck = `_inst|${relId}|${instId}`;
        }
      }
      if (!ck) {
        ungrouped.push(rec);
      } else {
        if (!copyGroups.has(ck)) copyGroups.set(ck, []);
        copyGroups.get(ck).push(rec);
      }
    }

    const finalRecords = [...ungrouped];
    const now = Date.now();

    for (const [ck, group] of copyGroups.entries()) {
      if (group.length === 1) {
        finalRecords.push(group[0]);
        continue;
      }

      // Deterministic survivor across ALL devices: lexicographically smallest sync_id ALWAYS wins!
      const sorted = group.slice().sort((a, b) => String(a.sync_id || '').localeCompare(String(b.sync_id || '')));
      const survivorSid = sorted[0].sync_id;
      const keepId = sorted.find(r => r.id !== undefined && r.id !== null)?.id;

      let acc = { ...sorted[0], sync_id: survivorSid };
      if (keepId !== undefined) acc.id = keepId;

      for (let i = 1; i < sorted.length; i++) {
        const dup = sorted[i];
        const retiredSid = dup.sync_id;
        if (dup.id !== undefined && dup.id !== null && dup.id !== keepId) {
          duplicateLocalIdsToDelete.push(dup.id);
        }
        const mRes = CC.mergeStashRecordsDeterministic(acc, dup, { duplicateMerge: true });
        acc = mRes.merged;
        acc.sync_id = survivorSid;
        if (keepId !== undefined) acc.id = keepId;
        if (mRes.conflicts.length) newConflicts.push(...mRes.conflicts);

        if (retiredSid && retiredSid !== survivorSid) {
          const entry = { targetSyncId: survivorSid, copyKey: ck, retiredAt: now, rev: CC.newRev() };
          aliases[retiredSid] = entry;
          newAliases[retiredSid] = entry;
        }
        mergedDuplicateCount++;
      }

      // Stamp fresh revision on repaired survivor so Drive sync propagates the merged fields cleanly
      acc = CC.stampStashRevision(acc, sorted[0]);
      acc.sync_id = survivorSid;
      if (keepId !== undefined) acc.id = keepId;
      finalRecords.push(acc);
      repairedSurvivors.push(acc);
    }

    const finalAliases = mergeAliasMaps(aliases, newAliases);
    // Dedupe repairedSurvivors by sync_id
    const survBySync = new Map();
    repairedSurvivors.forEach(s => {
      const f = finalRecords.find(r => r.sync_id === s.sync_id) || s;
      survBySync.set(f.sync_id, f);
    });

    return {
      records: finalRecords,
      repairedSurvivors: Array.from(survBySync.values()),
      mergedDuplicateCount,
      aliases: finalAliases,
      newAliases,
      duplicateLocalIdsToDelete: Array.from(new Set(duplicateLocalIdsToDelete)),
      conflicts: newConflicts
    };
  };

  // Local-only duplicate repair (ZERO Discogs writes, ZERO Drive writes; reads & writes outbox inside ONE readwrite transaction!)
  CC.repairLocalDiscogsDuplicates = async () => withLocalCommitLock(async () => {
    let mergedDuplicateCount = 0;
    let discogsCopyCount = 0;
    let repairSummary = '';
    let nextPendingCount = null;

    await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
      const allReq = stashStore.getAll();
      allReq.onsuccess = () => {
        const rawStash = Array.isArray(allReq.result) ? allReq.result : [];
        readMetaInTx(metaStore, [SYNC_ID_ALIASES_KEY, CLOUD_OUTBOX_KEY], (m) => {
          const existingAliases = Object.assign({}, m[SYNC_ID_ALIASES_KEY] || {});
          const outboxBefore = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue : [];

          const repair = CC.dedupeAndMergeStashRecords(rawStash, existingAliases);
          mergedDuplicateCount = repair.mergedDuplicateCount;
          if (repair.mergedDuplicateCount === 0 && Object.keys(repair.newAliases).length === 0) {
            discogsCopyCount = rawStash.filter(x => Boolean(CC.getDiscogsCopyKey(x))).length;
            repairSummary = '';
            return;
          }

          const now = Date.now();
          const ops = [];
          for (const [retiredSid, entry] of Object.entries(repair.newAliases)) {
            ops.push({
              type: 'retire_sync_id',
              retired_sync_id: retiredSid,
              target_sync_id: entry.targetSyncId,
              copy_key: entry.copyKey,
              retired_at: entry.retiredAt,
              rev: entry.rev
            });
          }
          repair.repairedSurvivors.forEach(s => {
            const c = { ...s };
            delete c.id;
            ops.push({ type: 'upsert_stash', sync_id: s.sync_id, record: c });
          });

          const nextQueue = outboxBefore.slice();
          if (ops.length > 0) {
            nextQueue.push({
              batchId: CC.newBatchId(),
              accountEmail: CC.cfg.googleBoundEmail || CC.cfg.googleEmail || '',
              createdAt: now,
              deviceId: CC.getDeviceId(),
              status: 'queued',
              ops
            });
          }

          for (const delId of repair.duplicateLocalIdsToDelete) stashStore.delete(delId);
          for (const rec of repair.repairedSurvivors) stashStore.put(rec);
          metaStore.put({ key: SYNC_ID_ALIASES_KEY, value: repair.aliases });
          if (ops.length > 0) {
            metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: nextQueue } });
            nextPendingCount = nextQueue.length;
          }

          discogsCopyCount = repair.records.filter(x => Boolean(CC.getDiscogsCopyKey(x))).length;
          repairSummary = CC.formatDuplicateRepairSummary(repair.mergedDuplicateCount, discogsCopyCount);
        });
      };
    });

    if (nextPendingCount !== null) CC.setPendingCloudChanges(nextPendingCount);
    return {
      mergedDuplicateCount,
      discogsCopyCount,
      repairSummary
    };
  });

  function collectUnsyncedSyncIds(outboxQueue, aliasMap = {}) {
    const s = new Set();
    (outboxQueue || []).forEach(b => {
      (b.ops || []).forEach(op => {
        if (op?.sync_id) s.add(resolveCanonicalSyncId(op.sync_id, aliasMap));
      });
    });
    return s;
  }

  // Single shared READ-ONLY pull path (ZERO Drive writes!) used by Connect Google Drive, Load, and Sync Now.
  // Phase 1 performs ALL network reads without holding the local commit lock.
  // Phase 2 reconciles against the LATEST local IndexedDB state at commit time so concurrent edits are never overwritten!
  CC.pullFromGoogleDrive = async (opts = {}) => {
    const { quiet = false, skipAccountBindOnEmpty = false, _prefetchedListing = null } = opts || {};
    const report = (msg) => { if (!quiet) statusCb(msg, true); };

    const email = await identifyGoogleAccount();
    const preLocalStash = await CC.idbGetAll('stash');
    const preLocalSpotify = (await CC.idbGet('meta', 'spotify_profile'))?.value || null;
    const preOutboxQueue = await CC.getCloudOutbox();
    const hasLocalDataPre = preLocalStash.length > 0 || preOutboxQueue.length > 0 || Boolean(preLocalSpotify?.tasteDna || preLocalSpotify?.softSpots || preLocalSpotify?.totalTracks);

    // Account switch protection: pause and warn before mixing two different Google accounts
    if (CC.cfg.googleBoundEmail && CC.cfg.googleBoundEmail !== email && hasLocalDataPre) {
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

    // Read ALL present snapshot files (including multiple softspot_state.json / cratecheck_state.json files, oldest -> newest!)
    const legacySnapshotFiles = Array.isArray(listing.snapshotFiles) && listing.snapshotFiles.length
      ? listing.snapshotFiles
      : GDRIVE_LEGACY_STATE_NAMES.map(n => fileMap.get(n)).filter(Boolean);
    const hasCloudData = Boolean(legacySnapshotFiles.length > 0 || v2Batches.size > 0 || legacyDeltas.length > 0);
    const preSyncMeta = await CC.getCloudSyncMeta();
    const alreadyAppliedIds = preSyncMeta?.appliedBatchIds || {};
    const hasExistingLocalState = Boolean(preLocalStash.length > 0 || Object.keys(alreadyAppliedIds).length > 0);

    if (!hasCloudData) {
      // Still repair any verified local duplicates safely with zero Drive writes
      const localRepair = await CC.repairLocalDiscogsDuplicates();
      const latestStash = await CC.idbGetAll('stash');
      const latestSp = (await CC.idbGet('meta', 'spotify_profile'))?.value || null;
      const hasLocalNow = latestStash.length > 0 || Boolean(latestSp?.tasteDna || latestSp?.softSpots || latestSp?.totalTracks);
      if (!skipAccountBindOnEmpty && !hasLocalNow) {
        CC.cfg.googleBoundEmail = email;
      }
      CC.cfg.googleLastLoadAt = Date.now();
      CC.persistCfg();
      return {
        ok: true,
        status: 'empty_cloud',
        emptyCloud: true,
        email,
        hasLocalData: hasLocalNow,
        stashCount: latestStash.length,
        mergedDuplicateCount: localRepair.mergedDuplicateCount,
        discogsCopyCount: localRepair.discogsCopyCount,
        repairSummary: localRepair.repairSummary,
        appliedBatches: 0,
        downloadedPhotos: 0,
        conflicts: [],
        partialErrors: [],
        listing
      };
    }

    // ==================== PHASE 1: NETWORK DOWNLOADS ONLY (NO COMMIT LOCK HELD) ====================
    const cloudRawItems = [];
    const cloudDeleted = {};
    const cloudAliases = {};
    let cloudSpotify = null;
    let cloudDiscogsIdx = null;
    let cloudPrefs = null;
    let cloudSecrets = null;
    const partialErrors = [];
    const seenRemoteBatchIds = [];

    const foldRemoteTombstone = (sid, entry) => {
      if (!sid) return;
      const nextTs = normTombstoneTs(entry);
      const prevTs = normTombstoneTs(cloudDeleted[sid]);
      if (nextTs > prevTs) cloudDeleted[sid] = typeof entry === 'object' ? entry : { ts: nextTs };
    };

    const foldRemoteAlias = (retiredSid, targetSid, copyKey = '', retiredAt = 0, rev = '') => {
      if (!retiredSid || !targetSid || retiredSid === targetSid) return;
      const prev = cloudAliases[retiredSid];
      if (!prev) {
        cloudAliases[retiredSid] = { targetSyncId: targetSid, copyKey, retiredAt, rev };
      } else {
        const winTarget = String(targetSid).localeCompare(String(prev.targetSyncId)) <= 0 ? targetSid : prev.targetSyncId;
        cloudAliases[retiredSid] = {
          ...prev,
          targetSyncId: winTarget,
          copyKey: copyKey || prev.copyKey,
          retiredAt: Math.max(Number(prev.retiredAt || 0), Number(retiredAt || 0))
        };
      }
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

    // A. Read ALL present snapshot files (softspot_state.json AND legacy cratecheck_state.json)
    const compactedBatchIdSet = new Set();
    for (const snapFile of legacySnapshotFiles) {
      if (!snapFile?.id) continue;
      try {
        report(`☁️ Reading cloud state (${snapFile.name})...`);
        const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(snapFile.id)}?alt=media`);
        const snap = await res.json();
        if (!snap || typeof snap !== 'object') {
          partialErrors.push(`Malformed cloud snapshot ${snapFile.name}`);
          continue;
        }
        (snap.stash || []).forEach(it => { if (it?.sync_id) cloudRawItems.push(it); });
        Object.entries(snap.tombstones || snap.deleted_sync_ids || {}).forEach(([sid, ts]) => foldRemoteTombstone(sid, ts));
        Object.entries(snap.sync_id_aliases || {}).forEach(([retiredSid, entry]) => {
          if (entry?.targetSyncId) foldRemoteAlias(retiredSid, entry.targetSyncId, entry.copyKey || '', entry.retiredAt || 0, entry.rev || '');
        });
        if (snap.spotify_profile || snap.spotifyProfile) foldRemoteSpotify(snap.spotify_profile || snap.spotifyProfile);
        if (snap.discogs_index || snap.discogsCollectionIndex) {
          const idx = snap.discogs_index || snap.discogsCollectionIndex;
          if (!cloudDiscogsIdx || Number(idx.syncedAt || 0) >= Number(cloudDiscogsIdx.syncedAt || 0)) {
            cloudDiscogsIdx = idx;
          }
        }
        if (snap.prefs) {
          if (!cloudPrefs || Number(snap.prefs.cfgUpdatedAt || 0) >= Number(cloudPrefs.cfgUpdatedAt || 0)) {
            cloudPrefs = snap.prefs;
          }
        }
        if (CC.cfg.googleSyncSecrets && snap.secrets) cloudSecrets = snap.secrets;
        if (Array.isArray(snap.compactedBatchIds)) snap.compactedBatchIds.forEach(bid => compactedBatchIdSet.add(bid));
      } catch (e) {
        partialErrors.push(`Failed reading snapshot ${snapFile.name}: ${e.message}`);
      }
    }

    // B. Legacy delta_*.json migration inputs
    for (const df of legacyDeltas) {
      try {
        const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(df.id)}?alt=media`);
        const dJson = await res.json();
        (dJson?.items || []).forEach(it => { if (it?.sync_id) cloudRawItems.push(it); });
        Object.entries(dJson?.deleted_sync_ids || {}).forEach(([sid, ts]) => foldRemoteTombstone(sid, ts));
      } catch (e) {
        partialErrors.push(`Skipped unreadable legacy delta ${df.name}: ${e.message}`);
      }
    }

    // C. Immutable v2 batches (fast incremental pull: skip batches already applied locally when device already has synced state)
    const sortedV2 = Array.from(v2Batches.values())
      .filter(bf => !compactedBatchIdSet.has(bf.batchId))
      .filter(bf => !(hasExistingLocalState && Boolean(alreadyAppliedIds[bf.batchId])))
      .sort((a, b) =>
        String(a.modifiedTime || '').localeCompare(String(b.modifiedTime || '')) || a.batchId.localeCompare(b.batchId)
      );
    const loadedBatches = [];
    for (let i = 0; i < sortedV2.length; i++) {
      const bf = sortedV2[i];
      report(`☁️ Reading cloud batch ${i + 1}/${sortedV2.length}...`);
      try {
        const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(bf.id)}?alt=media`);
        const bJson = await res.json();
        if (!bJson || !Array.isArray(bJson.ops)) {
          partialErrors.push(`Malformed cloud batch ${bf.name}`);
          continue;
        }
        loadedBatches.push({ batchId: bf.batchId, createdAt: Number(bJson.createdAt || 0), ops: bJson.ops });
      } catch (e) {
        // Do NOT mark this batchId as applied — keep it pending for retry on next pull!
        partialErrors.push(`Failed reading batch ${bf.name}: ${e.message}`);
      }
    }
    loadedBatches.sort((a, b) => (a.createdAt - b.createdAt) || a.batchId.localeCompare(b.batchId));

    for (const b of loadedBatches) {
      seenRemoteBatchIds.push(b.batchId);
      for (const op of b.ops) {
        if (!op || !op.type) continue;
        if (op.type === 'retire_sync_id' && op.retired_sync_id && op.target_sync_id) {
          foldRemoteAlias(op.retired_sync_id, op.target_sync_id, op.copy_key || '', op.retired_at || b.createdAt, op.rev || '');
        } else if (op.type === 'upsert_stash' && op.record) {
          cloudRawItems.push(op.record);
        } else if (op.type === 'delete_stash' && op.sync_id) {
          foldRemoteTombstone(op.sync_id, op.deleted || b.createdAt);
        } else if (op.type === 'spotify_profile' && op.profile) {
          foldRemoteSpotify(op.profile);
        } else if (op.type === 'taste_profile') {
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

    // E. Download all needed gdrive:img_<hash>.webp photos over the network BEFORE acquiring the local commit lock!
    const neededPhotoNames = new Set();
    const collectItemPhotoRefs = (it, targetSet) => {
      if (!it || typeof it !== 'object') return;
      const addRef = (val) => {
        const s = String(val || '');
        if (s.startsWith('gdrive:')) targetSet.add(s.slice(7));
      };
      if (it.photo_slots && typeof it.photo_slots === 'object') {
        addRef(it.photo_slots.front);
        addRef(it.photo_slots.back);
        if (Array.isArray(it.photo_slots.extras)) it.photo_slots.extras.forEach(addRef);
      }
      if (Array.isArray(it.thumbs)) it.thumbs.forEach(addRef);
      addRef(it.thumb_data_url);
      addRef(it.spine_thumb_url);
      addRef(it.spine_source_url);
    };

    const batchPhotoRefs = new Map(); // batchId -> Set<fname>
    for (const b of loadedBatches) {
      const refSet = new Set();
      for (const op of (b.ops || [])) {
        if (op?.type === 'upsert_stash' && op.record) collectItemPhotoRefs(op.record, refSet);
      }
      if (refSet.size > 0) batchPhotoRefs.set(b.batchId, refSet);
    }

    cloudRawItems.forEach(it => collectItemPhotoRefs(it, neededPhotoNames));
    preLocalStash.forEach(it => collectItemPhotoRefs(it, neededPhotoNames));

    let downloadedPhotos = 0;
    const dlCache = new Map();
    const failedPhotoNames = new Set();
    for (const fname of neededPhotoNames) {
      const fInfo = fileMap.get(fname);
      if (!fInfo?.id) {
        failedPhotoNames.add(fname);
        partialErrors.push(`Missing photo asset ${fname} on Drive`);
        continue;
      }
      try {
        report(`☁️ Downloading photo ${downloadedPhotos + 1}...`);
        const res = await gdriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fInfo.id)}?alt=media`);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        dlCache.set(fname, dataUrl);
        downloadedPhotos++;
      } catch (e) {
        failedPhotoNames.add(fname);
        partialErrors.push(`Failed downloading ${fname}: ${e.message}`);
      }
    }

    // ==================== PHASE 2: SINGLE-TRANSACTION ATOMIC RECONCILIATION ====================
    // Reads live stashStore, deleted_sync_ids, aliases, outbox, syncMeta, spotify_profile, and discogs_collection_index
    // inside the EXACT SAME readwrite transaction where merged state is written — so another tab deleting an item
    // mid-pull can NEVER be undone or have its tombstone stripped!
    return withLocalCommitLock(async () => {
      let appliedBatchCount = 0;
      let mergedStashCount = 0;
      let totalMergedDups = 0;
      let discogsCopyCount = 0;
      let deletedCount = 0;
      let allNewConflictsOut = [];
      let mergedSpotifyOut = null;
      let mergedDiscogsIdxOut = null;
      let nextOutboxLen = 0;

      const hydrateFromCache = (val) => {
        const s = String(val || '');
        if (!s.startsWith('gdrive:')) return s;
        const fname = s.slice(7);
        if (dlCache.has(fname)) return dlCache.get(fname);
        return s;
      };

      const hydrateExtraMetaMapFromCache = (mapObj) => {
        const out = {};
        if (!mapObj || typeof mapObj !== 'object' || Array.isArray(mapObj)) return out;
        for (const [rawKey, meta] of Object.entries(mapObj)) {
          if (!rawKey || !meta || typeof meta !== 'object') continue;
          let mappedKey = String(rawKey);
          if (mappedKey.startsWith('gdrive:')) {
            const fname = mappedKey.slice(7);
            if (dlCache.has(fname)) mappedKey = CC.getPhotoKey(dlCache.get(fname));
          }
          const prev = out[mappedKey];
          if (!prev || compareRevMeta(Number(meta.ts || 0), String(meta.rev || ''), Number(prev.ts || 0), String(prev.rev || '')) > 0) {
            out[mappedKey] = { ...meta };
          }
        }
        return out;
      };

      const hydrateItemPhotosFromCache = (rawObj) => {
        if (!rawObj || typeof rawObj !== 'object') return rawObj;
        const item = { ...rawObj };
        if (item.photo_slots && typeof item.photo_slots === 'object') {
          item.photo_slots = {
            front: hydrateFromCache(item.photo_slots.front || ''),
            back: hydrateFromCache(item.photo_slots.back || ''),
            extras: Array.isArray(item.photo_slots.extras) ? item.photo_slots.extras.map(hydrateFromCache).filter(Boolean) : [],
            extra_added: hydrateExtraMetaMapFromCache(item.photo_slots.extra_added),
            extra_tombstones: hydrateExtraMetaMapFromCache(item.photo_slots.extra_tombstones)
          };
          const derived = CC.deriveThumbsFromSlots(item.photo_slots, item.discogs_thumb || '');
          item.thumbs = derived.thumbs;
          item.thumb_data_url = derived.thumb_data_url;
        } else {
          if (Array.isArray(item.thumbs)) {
            item.thumbs = item.thumbs.map(hydrateFromCache).filter(Boolean);
          }
          if (item.thumb_data_url) item.thumb_data_url = hydrateFromCache(item.thumb_data_url);
        }
        if (item.spine_thumb_url) item.spine_thumb_url = hydrateFromCache(item.spine_thumb_url);
        if (item.spine_source_url) item.spine_source_url = hydrateFromCache(item.spine_source_url);
        return item;
      };

      await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
        const allReq = stashStore.getAll();
        allReq.onsuccess = () => {
          const rawLocalStash = Array.isArray(allReq.result) ? allReq.result : [];
          readMetaInTx(
            metaStore,
            ['spotify_profile', 'discogs_collection_index', 'deleted_sync_ids', SYNC_ID_ALIASES_KEY, CLOUD_META_KEY, CLOUD_OUTBOX_KEY],
            (m) => {
              const localSpotify = m.spotify_profile || null;
              const localDiscogsIdx = m.discogs_collection_index || null;
              const localDeleted = Object.assign({}, m.deleted_sync_ids || {});
              const localAliases = Object.assign({}, m[SYNC_ID_ALIASES_KEY] || {});
              const vMeta = m[CLOUD_META_KEY] || {};
              const syncMeta = {
                appliedBatchIds: Object.assign({}, vMeta.appliedBatchIds || {}),
                conflicts: Array.isArray(vMeta.conflicts) ? vMeta.conflicts.slice() : [],
                deviceId: vMeta.deviceId || CC.getDeviceId()
              };
              const outboxQueue = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue : [];

              seenRemoteBatchIds.forEach(bid => {
                const refs = batchPhotoRefs.get(bid);
                const hasFailedPhoto = refs ? Array.from(refs).some(fn => failedPhotoNames.has(fn)) : false;
                if (hasFailedPhoto) return; // Keep unapplied so next sync retries failed photo downloads!
                if (!syncMeta.appliedBatchIds[bid]) appliedBatchCount++;
                syncMeta.appliedBatchIds[bid] = Date.now();
              });

              const mergedAliases = mergeAliasMaps(localAliases, cloudAliases);
              const unsyncedSyncIds = collectUnsyncedSyncIds(outboxQueue, mergedAliases);

              // Hydrate remote photos from dlCache BEFORE folding/merging against localBySync
              // so identical local data:image/... and downloaded Drive photos compare equal and never duplicate!
              const cloudStashBySync = new Map();
              for (const rawIt of cloudRawItems) {
                if (!rawIt?.sync_id) continue;
                const canonSid = resolveCanonicalSyncId(rawIt.sync_id, mergedAliases);
                const hydratedRemote = hydrateItemPhotosFromCache(canonSid === rawIt.sync_id ? rawIt : { ...rawIt, sync_id: canonSid });
                const prev = cloudStashBySync.get(canonSid);
                if (!prev) {
                  cloudStashBySync.set(canonSid, hydratedRemote);
                } else {
                  const mRes = CC.mergeStashRecordsDeterministic(prev, hydratedRemote, { duplicateMerge: rawIt.sync_id !== canonSid });
                  mRes.merged.sync_id = canonSid;
                  cloudStashBySync.set(canonSid, mRes.merged);
                }
              }

              // Normalize & hydrate local rows & collapse any local rows pointing to a retired sync_id
              const localBySync = new Map();
              const localIdsToDelete = [];
              let retiredLocalMergedCount = 0;
              for (const rawLoc of rawLocalStash) {
                const origSid = rawLoc.sync_id || CC.generateSyncId();
                const canonSid = resolveCanonicalSyncId(origSid, mergedAliases);
                const loc = hydrateItemPhotosFromCache({ ...rawLoc, sync_id: canonSid });
                const prev = localBySync.get(canonSid);
                if (!prev) {
                  localBySync.set(canonSid, loc);
                } else {
                  const keepId = (origSid === canonSid && rawLoc.id !== undefined) ? rawLoc.id : prev.id;
                  const dropId = keepId === rawLoc.id ? prev.id : rawLoc.id;
                  if (dropId !== undefined && dropId !== null && dropId !== keepId) localIdsToDelete.push(dropId);
                  const mRes = CC.mergeStashRecordsDeterministic(prev, loc, { duplicateMerge: true });
                  mRes.merged.sync_id = canonSid;
                  if (keepId !== undefined) mRes.merged.id = keepId;
                  localBySync.set(canonSid, mRes.merged);
                  retiredLocalMergedCount++;
                }
              }

              // Merge intentional deletions (distinct from duplicate retirements!)
              const mergedDeleted = {};
              Object.entries(localDeleted).forEach(([sid, entry]) => {
                const csid = resolveCanonicalSyncId(sid, mergedAliases);
                if (normTombstoneTs(entry) > normTombstoneTs(mergedDeleted[csid])) mergedDeleted[csid] = entry;
              });
              Object.entries(cloudDeleted).forEach(([sid, entry]) => {
                const csid = resolveCanonicalSyncId(sid, mergedAliases);
                if (normTombstoneTs(entry) > normTombstoneTs(mergedDeleted[csid])) mergedDeleted[csid] = entry;
              });

              const allSyncIds = new Set([...localBySync.keys(), ...cloudStashBySync.keys()]);
              const combinedBeforeDedupe = [];
              const allNewConflicts = [];

              for (const sid of allSyncIds) {
                const loc = localBySync.get(sid) || null;
                const rem = cloudStashBySync.get(sid) || null;
                const mergedRes = CC.mergeStashRecordsDeterministic(loc, rem, { localUnsynced: unsyncedSyncIds.has(sid) });
                const rec = mergedRes.merged;
                if (mergedRes.conflicts.length) allNewConflicts.push(...mergedRes.conflicts);

                const recTs = Number(rec.updated_at || rec.created_at || 0);
                const delTs = normTombstoneTs(mergedDeleted[sid]);
                if (delTs > 0 && delTs >= recTs) {
                  if (loc?.id !== undefined) localIdsToDelete.push(loc.id);
                  continue;
                }
                if (delTs > 0 && recTs > delTs) {
                  delete mergedDeleted[sid];
                }
                combinedBeforeDedupe.push(rec);
              }

              for (let idx = 0; idx < combinedBeforeDedupe.length; idx++) {
                combinedBeforeDedupe[idx] = hydrateItemPhotosFromCache(combinedBeforeDedupe[idx]);
              }

              const repair = CC.dedupeAndMergeStashRecords(combinedBeforeDedupe, mergedAliases);
              const mergedStash = repair.records;
              const finalAliases = repair.aliases;
              repair.duplicateLocalIdsToDelete.forEach(did => {
                if (!localIdsToDelete.includes(did)) localIdsToDelete.push(did);
              });
              if (repair.conflicts.length) allNewConflicts.push(...repair.conflicts);

              const nextOutbox = outboxQueue.slice();
              const newAliasEntries = Object.entries(repair.newAliases);
              if (newAliasEntries.length > 0) {
                const repairOps = [];
                for (const [retiredSid, entry] of newAliasEntries) {
                  repairOps.push({
                    type: 'retire_sync_id',
                    retired_sync_id: retiredSid,
                    target_sync_id: entry.targetSyncId,
                    copy_key: entry.copyKey,
                    retired_at: entry.retiredAt,
                    rev: entry.rev
                  });
                }
                repair.repairedSurvivors.forEach(s => {
                  const c = { ...s };
                  delete c.id;
                  repairOps.push({ type: 'upsert_stash', sync_id: s.sync_id, record: c });
                });
                nextOutbox.push({
                  batchId: CC.newBatchId(),
                  accountEmail: email,
                  createdAt: Date.now(),
                  deviceId: CC.getDeviceId(),
                  status: 'queued',
                  ops: repairOps
                });
              }

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

              syncMeta.conflicts = [...syncMeta.conflicts, ...allNewConflicts].slice(-20);

              for (const delId of localIdsToDelete) stashStore.delete(delId);
              for (const item of mergedStash) stashStore.put(item);
              metaStore.put({ key: 'deleted_sync_ids', value: mergedDeleted });
              metaStore.put({ key: SYNC_ID_ALIASES_KEY, value: finalAliases });
              metaStore.put({ key: CLOUD_META_KEY, value: syncMeta });
              if (newAliasEntries.length > 0) {
                metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: nextOutbox } });
              }
              if (mergedSpotify) metaStore.put({ key: 'spotify_profile', value: mergedSpotify });
              if (mergedDiscogsIdx) metaStore.put({ key: 'discogs_collection_index', value: mergedDiscogsIdx });

              mergedStashCount = mergedStash.length;
              totalMergedDups = repair.mergedDuplicateCount + retiredLocalMergedCount;
              discogsCopyCount = mergedStash.filter(x => Boolean(CC.getDiscogsCopyKey(x))).length;
              deletedCount = localIdsToDelete.length;
              allNewConflictsOut = allNewConflicts;
              mergedSpotifyOut = mergedSpotify;
              mergedDiscogsIdxOut = mergedDiscogsIdx;
              nextOutboxLen = nextOutbox.length;
            }
          );
        };
      });

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

      CC.setPendingCloudChanges(nextOutboxLen);
      CC.cfg.googleBoundEmail = email;
      CC.cfg.googleLastLoadAt = Date.now();
      CC.persistCfg();

      return {
        ok: true,
        status: partialErrors.length ? 'partial' : 'loaded',
        emptyCloud: false,
        email,
        stashCount: mergedStashCount,
        mergedDuplicateCount: totalMergedDups,
        discogsCopyCount,
        repairSummary: CC.formatDuplicateRepairSummary(totalMergedDups, discogsCopyCount),
        appliedBatches: appliedBatchCount,
        downloadedPhotos,
        deletedCount,
        conflicts: allNewConflictsOut,
        partialErrors,
        spotifyProfile: mergedSpotifyOut,
        discogsCollectionIndex: mergedDiscogsIdxOut,
        listing
      };
    });
  };

  // Queue unqueued local profile items into outbox (reads & writes CLOUD_OUTBOX_KEY inside ONE readwrite transaction!)
  CC.queueFullLocalProfileToOutbox = async (targetEmail) => withLocalCommitLock(async () => {
    let nextPendingCount = null;

    await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
      const allReq = stashStore.getAll();
      allReq.onsuccess = () => {
        const localStash = Array.isArray(allReq.result) ? allReq.result : [];
        readMetaInTx(
          metaStore,
          [CLOUD_OUTBOX_KEY, 'deleted_sync_ids', SYNC_ID_ALIASES_KEY, 'spotify_profile', 'discogs_collection_index'],
          (m) => {
            const existingOutbox = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue : [];
            if (existingOutbox.some(b => b.isFullSeed && (!b.accountEmail || b.accountEmail === targetEmail))) {
              return;
            }
            const localDeleted = m.deleted_sync_ids || {};
            const localAliases = m[SYNC_ID_ALIASES_KEY] || {};
            const localSpotify = m.spotify_profile || null;
            const localDiscogsIdx = m.discogs_collection_index || null;

            const queuedSyncIds = new Set();
            const queuedTypes = new Set();
            const queuedRetired = new Set();
            existingOutbox.forEach(b => {
              (b.ops || []).forEach(op => {
                if (op?.type) queuedTypes.add(op.type);
                if (op?.sync_id) queuedSyncIds.add(op.sync_id);
                if (op?.retired_sync_id) queuedRetired.add(op.retired_sync_id);
              });
            });

            const ops = [];
            const needsSyncIdPut = [];
            Object.entries(localAliases).forEach(([retiredSid, entry]) => {
              if (!queuedRetired.has(retiredSid) && entry?.targetSyncId) {
                ops.push({
                  type: 'retire_sync_id',
                  retired_sync_id: retiredSid,
                  target_sync_id: entry.targetSyncId,
                  copy_key: entry.copyKey || '',
                  retired_at: entry.retiredAt || Date.now(),
                  rev: entry.rev || CC.newRev()
                });
              }
            });
            for (const it of localStash) {
              if (!it.sync_id) {
                it.sync_id = CC.generateSyncId();
                needsSyncIdPut.push(it);
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

            if (ops.length > 0 || needsSyncIdPut.length > 0) {
              const nextQueue = existingOutbox.slice();
              if (ops.length > 0) {
                nextQueue.push({
                  batchId: CC.newBatchId(),
                  accountEmail: targetEmail,
                  createdAt: Date.now(),
                  deviceId: CC.getDeviceId(),
                  status: 'queued',
                  isFullSeed: true,
                  ops
                });
              }
              for (const it of needsSyncIdPut) stashStore.put(it);
              if (ops.length > 0) {
                metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: nextQueue } });
                nextPendingCount = nextQueue.length;
              }
            }
          }
        );
      };
    });

    CC.cfg.googleBoundEmail = targetEmail;
    CC.persistCfg();
    if (nextPendingCount !== null) CC.setPendingCloudChanges(nextPendingCount);
  });

  // Full Two-Way Sync: pull -> merge/repair -> upload missing photos -> upload immutable v2 batches -> acknowledge ONLY uploaded batches under commit lock
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
    const allRemoteBatchFiles = Array.isArray(pullRes.listing.allV2BatchFiles) ? pullRes.listing.allV2BatchFiles : Array.from(existingV2Batches.values());
    const legacyDeltaFiles = Array.isArray(pullRes.listing.legacyDeltas) ? pullRes.listing.legacyDeltas : [];

    if (pullRes.emptyCloud) {
      if (!publishInitialLocal && pullRes.hasLocalData && !CC.cfg.googleBoundEmail) {
        return { ...pullRes, awaitingExplicitPublish: true };
      }
      await CC.queueFullLocalProfileToOutbox(email);
    } else if (!CC.cfg.googleBoundEmail) {
      CC.cfg.googleBoundEmail = email;
      CC.persistCfg();
    }

    // 2. Coalesce redundant queued outbox batches, then atomically snapshot & mark matching-account batches 'uploading' inside ONE readwrite transaction
    await CC.coalesceCloudOutbox();
    const activeEmailNorm = String(email || '').trim().toLowerCase();
    const batchMatchesActiveAccount = (b) => {
      const bAcct = String(b?.accountEmail || '').trim().toLowerCase();
      return !bAcct || bAcct === activeEmailNorm;
    };

    const batchesToUpload = [];
    await withLocalCommitLock(async () => {
      await CC.idbAtomicWrite(({ metaStore }) => {
        const req = metaStore.get(CLOUD_OUTBOX_KEY);
        req.onsuccess = () => {
          const currentOutbox = Array.isArray(req.result?.value?.queue) ? req.result.value.queue : [];
          if (!currentOutbox.length) return;
          const marked = currentOutbox.map(b => {
            if (batchMatchesActiveAccount(b)) {
              const mb = { ...b, status: 'uploading' };
              batchesToUpload.push(mb);
              return mb;
            }
            return b; // Leave another account's pending batch strictly isolated!
          });
          metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: marked } });
        };
      });
    });

    let uploadedPhotos = 0;
    let uploadedBatches = 0;
    let compactedBatches = 0;
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
      if (out.photo_slots && typeof out.photo_slots === 'object') {
        const keyRemap = new Map();
        const extras = [];
        for (const e of (Array.isArray(out.photo_slots.extras) ? out.photo_slots.extras : [])) {
          const origKey = CC.getPhotoKey(e);
          const ref = await uploadPhotoIfMissing(e);
          if (origKey && ref) keyRemap.set(origKey, ref);
          extras.push(ref);
        }
        const remapExtraMeta = async (mapObj) => {
          const resMap = {};
          if (!mapObj || typeof mapObj !== 'object' || Array.isArray(mapObj)) return resMap;
          for (const [k, v] of Object.entries(mapObj)) {
            if (!k || !v || typeof v !== 'object') continue;
            let nextK = keyRemap.get(k) || k;
            if (nextK.startsWith('data:image/')) {
              nextK = await uploadPhotoIfMissing(nextK);
            }
            resMap[nextK] = { ...v };
          }
          return resMap;
        };
        out.photo_slots = {
          front: out.photo_slots.front ? await uploadPhotoIfMissing(out.photo_slots.front) : '',
          back: out.photo_slots.back ? await uploadPhotoIfMissing(out.photo_slots.back) : '',
          extras: extras.filter(Boolean),
          extra_added: await remapExtraMeta(out.photo_slots.extra_added),
          extra_tombstones: await remapExtraMeta(out.photo_slots.extra_tombstones)
        };
        const derived = CC.deriveThumbsFromSlots(out.photo_slots, out.discogs_thumb || '');
        out.thumbs = derived.thumbs;
        out.thumb_data_url = derived.thumb_data_url;
      } else {
        if (Array.isArray(out.thumbs)) {
          const nextT = [];
          for (const t of out.thumbs) nextT.push(await uploadPhotoIfMissing(t));
          out.thumbs = nextT;
        }
        if (out.thumb_data_url) out.thumb_data_url = await uploadPhotoIfMissing(out.thumb_data_url);
      }
      if (out.spine_thumb_url) out.spine_thumb_url = await uploadPhotoIfMissing(out.spine_thumb_url);
      if (out.spine_source_url) out.spine_source_url = await uploadPhotoIfMissing(out.spine_source_url);
      return out;
    };

    const acknowledgedBatchIds = new Set();

    // Upload each coalesced outbox batch as a NEW immutable ss_v2_batch_<batchId>.json file (POST).
    // NEVER overwrite softspot_state.json and NEVER auto-delete remote Drive files during sync so
    // concurrent phone + PC syncs can never clobber or drop an unmerged batch!
    for (let i = 0; i < batchesToUpload.length; i++) {
      const batch = batchesToUpload[i];
      const fname = `ss_v2_batch_${batch.batchId}.json`;
      if (existingV2Batches.has(batch.batchId) || fileMap.has(fname)) {
        acknowledgedBatchIds.add(batch.batchId);
        continue;
      }

      const cleanOps = [];
      for (const op of (batch.ops || [])) {
        if (!op || !op.type) continue;
        if (op.type === 'upsert_stash' && op.record) {
          cleanOps.push({ ...op, record: await dehydrateRecord(op.record) });
        } else {
          cleanOps.push(op);
        }
      }

      report(`☁️ Uploading sync batch ${i + 1}/${batchesToUpload.length}...`);
      const payload = {
        formatVersion: 2,
        batchId: batch.batchId,
        createdAt: Number(batch.createdAt || Date.now()),
        deviceId: batch.deviceId || CC.getDeviceId(),
        ops: cleanOps
      };
      const created = await uploadAppDataMultipart(
        fname,
        new Blob([JSON.stringify(payload)], { type: 'application/json' }),
        'application/json'
      );
      if (!created?.id) {
        throw new Error(`Failed to confirm upload of ${fname}`);
      }
      fileMap.set(fname, { id: created.id, name: fname });
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

    // 3. Atomically acknowledge ONLY uploaded batchIds inside ONE readwrite transaction, preserving ANY batch queued mid-upload or from another tab!
    let remainingQueue = [];
    let finalStashCount = 0;
    await withLocalCommitLock(async () => {
      await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
        readMetaInTx(metaStore, [CLOUD_OUTBOX_KEY, CLOUD_META_KEY], (m) => {
          const latestOutbox = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue : [];
          const remaining = latestOutbox.filter(b => !acknowledgedBatchIds.has(b.batchId));
          const v = m[CLOUD_META_KEY] || {};
          const syncMeta = {
            appliedBatchIds: Object.assign({}, v.appliedBatchIds || {}),
            conflicts: Array.isArray(v.conflicts) ? v.conflicts : [],
            deviceId: v.deviceId || CC.getDeviceId()
          };
          acknowledgedBatchIds.forEach(bid => { syncMeta.appliedBatchIds[bid] = Date.now(); });

          metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: remaining } });
          metaStore.put({ key: CLOUD_META_KEY, value: syncMeta });
          remainingQueue = remaining;
        });
        const cntReq = stashStore.getAll();
        cntReq.onsuccess = () => { finalStashCount = (cntReq.result || []).length; };
      });
      CC.setPendingCloudChanges(remainingQueue.length);
    });

    CC.cfg.googleLastSyncAt = Date.now();
    CC.persistCfg();

    return {
      ok: true,
      status: pullRes.partialErrors?.length ? 'partial' : 'synced',
      email,
      stashCount: finalStashCount,
      mergedDuplicateCount: pullRes.mergedDuplicateCount || 0,
      discogsCopyCount: pullRes.discogsCopyCount || 0,
      repairSummary: pullRes.repairSummary || '',
      appliedBatches: pullRes.appliedBatches || 0,
      uploadedBatches,
      compactedBatches,
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

  // Deterministic legacy fallback ID for pre-sync_id backups (immutable identity fields only so editing notes/grades never creates duplicates)
  function computeLegacyFingerprintSyncId(rec) {
    const raw = [
      CC.norm(rec?.artist || ''),
      CC.norm(rec?.title || ''),
      CC.norm(rec?.format || ''),
      CC.norm(rec?.catno || ''),
      String(rec?.year || '').trim(),
      String(Number(rec?.created_at || 0)),
      String(Number(rec?.discogs_id || 0)),
      String(Number(rec?.discogs_instance_id || 0))
    ].join('|');
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= (c + i);
      h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    return `legacy_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
  }
  CC.computeLegacyFingerprintSyncId = computeLegacyFingerprintSyncId;

  // Atomic, idempotent JSON backup restore inside ONE readwrite IndexedDB transaction:
  // merges by canonical sync_id (or deterministic legacy_<hash> for pre-sync_id backups) via mergeStashRecordsDeterministic
  // preserving original rev/updated_at/field_revs, merges deleted_sync_ids & sync_id_aliases, dedupes Discogs copies,
  // and merges spotifyProfile by syncedAt/dnaUpdatedAt.
  CC.importJsonBackupAtomic = async (data) => withLocalCommitLock(async () => {
    const incomingStash = Array.isArray(data?.stash) ? data.stash : [];
    const incomingDeleted = (data?.deleted_sync_ids && typeof data.deleted_sync_ids === 'object' && !Array.isArray(data.deleted_sync_ids))
      ? data.deleted_sync_ids
      : {};
    const incomingAliases = (data?.sync_id_aliases && typeof data.sync_id_aliases === 'object' && !Array.isArray(data.sync_id_aliases))
      ? data.sync_id_aliases
      : {};
    const incomingSpotify = (data?.spotifyProfile && typeof data.spotifyProfile === 'object')
      ? data.spotifyProfile
      : null;
    const backupSource = String(
      data?.deviceId ||
      data?.sourceId ||
      data?.backupSource ||
      data?.spotifyProfile?.accountId ||
      data?.discogsUser ||
      data?.cfg?.discogsUser ||
      ''
    ).trim().toLowerCase();
    const backupSourceHash = backupSource ? hashString64Hex(backupSource) : '';

    let totalStashCount = 0;
    let changedStashCount = 0;
    let mergedSpotifyOut = null;
    let pendingCount = 0;

    await CC.idbAtomicWrite(({ stashStore, metaStore }) => {
      const allReq = stashStore.getAll();
      allReq.onsuccess = () => {
        const liveRows = Array.isArray(allReq.result) ? allReq.result : [];
        readMetaInTx(metaStore, ['deleted_sync_ids', SYNC_ID_ALIASES_KEY, 'spotify_profile', CLOUD_OUTBOX_KEY], (m) => {
          const liveDeleted = Object.assign({}, m.deleted_sync_ids || {});
          const liveAliases = Object.assign({}, m[SYNC_ID_ALIASES_KEY] || {});
          const liveSpotify = m.spotify_profile || null;
          const liveQueue = Array.isArray(m[CLOUD_OUTBOX_KEY]?.queue) ? m[CLOUD_OUTBOX_KEY].queue.slice() : [];

          // 1. Merge aliases
          let mergedAliases = mergeAliasMaps(liveAliases, incomingAliases);

          // 2. Merge tombstones (newest timestamp wins per canonical sync_id)
          const mergedDeleted = {};
          const foldDel = (rawSid, entry) => {
            const cSid = resolveCanonicalSyncId(rawSid, mergedAliases);
            if (!cSid) return;
            const nextTs = normTombstoneTs(entry);
            const prevTs = normTombstoneTs(mergedDeleted[cSid]);
            if (nextTs > prevTs) mergedDeleted[cSid] = typeof entry === 'object' ? { ...entry } : { ts: nextTs };
          };
          Object.entries(liveDeleted).forEach(([k, v]) => foldDel(k, v));
          Object.entries(incomingDeleted).forEach(([k, v]) => foldDel(k, v));

          // 3. Index live stash by canonical sync_id AND by deterministic legacy fingerprint (preserving occurrence index for distinct copies)
          const bySyncId = new Map();
          const legacyFpToSyncId = new Map();
          const liveFpCounts = new Map();
          const liveSnapshotJsonBySid = new Map();
          liveRows.forEach(r => {
            const copy = { ...r };
            const baseFp = computeLegacyFingerprintSyncId(copy);
            const occ = (liveFpCounts.get(baseFp) || 0) + 1;
            liveFpCounts.set(baseFp, occ);
            const occFp = occ > 1 ? `${baseFp}#${occ}` : baseFp;
            if (!copy.sync_id) copy.sync_id = occFp;
            copy.sync_id = resolveCanonicalSyncId(copy.sync_id, mergedAliases);
            if (!legacyFpToSyncId.has(occFp)) legacyFpToSyncId.set(occFp, copy.sync_id);
            if (String(copy.sync_id).startsWith('legacy_') && !legacyFpToSyncId.has(copy.sync_id)) {
              legacyFpToSyncId.set(copy.sync_id, copy.sync_id);
            }
            const noId = { ...copy };
            delete noId.id;
            liveSnapshotJsonBySid.set(copy.sync_id, JSON.stringify(noId));
            if (bySyncId.has(copy.sync_id)) {
              const prev = bySyncId.get(copy.sync_id);
              const res = CC.mergeStashRecordsDeterministic(prev, copy);
              bySyncId.set(copy.sync_id, { ...res.merged, id: prev.id });
            } else {
              bySyncId.set(copy.sync_id, copy);
            }
          });

          // 4. Merge incoming stash preserving original rev / updated_at / field_revs / _fieldMeta
          //    For legacy backups lacking sync_id: anchor identity on original row id (legacy_orig_id) + source/created_at
          //    before falling back to deterministic fingerprint + occurrence index (#2, #3, ...).
          const findLiveByLegacyOrigId = (origId, rawItem) => {
            const origStr = String(origId);
            const rawCreated = Number(rawItem?.created_at || 0);
            const rawDiscogsId = Number(rawItem?.discogs_id || 0);
            const rawCatNorm = CC.norm(rawItem?.catno || '');
            const rawFmtNorm = CC.norm(rawItem?.format || '');
            for (const existing of bySyncId.values()) {
              if (existing?.legacy_orig_id === undefined || existing?.legacy_orig_id === null) continue;
              if (String(existing.legacy_orig_id) !== origStr) continue;
              if (rawCreated > 0) {
                if (Number(existing.created_at || 0) === rawCreated) return existing.sync_id;
              } else {
                const sameDiscogs = rawDiscogsId > 0 && Number(existing.discogs_id || 0) === rawDiscogsId;
                const sameCatFmt = Boolean(rawCatNorm && CC.norm(existing.catno || '') === rawCatNorm && CC.norm(existing.format || '') === rawFmtNorm);
                if (sameDiscogs || sameCatFmt) return existing.sync_id;
              }
            }
            return '';
          };

          const incomingFpCounts = new Map();
          for (const rawItem of incomingStash) {
            if (!rawItem || typeof rawItem !== 'object') continue;
            const origId = (rawItem.id !== undefined && rawItem.id !== null && String(rawItem.id).trim() !== '') ? rawItem.id : null;
            const imp = { ...rawItem };
            delete imp.id;
            const baseFp = computeLegacyFingerprintSyncId(imp);
            const occ = (incomingFpCounts.get(baseFp) || 0) + 1;
            incomingFpCounts.set(baseFp, occ);
            const occFp = occ > 1 ? `${baseFp}#${occ}` : baseFp;
            if (!imp.sync_id) {
              if (origId !== null) {
                imp.legacy_orig_id = origId;
                if (backupSource) imp.legacy_source = backupSource;
                if (backupSourceHash) {
                  imp.sync_id = `legacy_src_${backupSourceHash}_id_${String(origId)}`;
                } else {
                  const matchedSid = findLiveByLegacyOrigId(origId, rawItem);
                  if (matchedSid) {
                    imp.sync_id = matchedSid;
                  } else if (Number(rawItem.created_at || 0) > 0) {
                    imp.sync_id = `legacy_id_${String(origId)}_c_${Number(rawItem.created_at)}`;
                  } else {
                    imp.sync_id = legacyFpToSyncId.get(occFp) || occFp;
                  }
                }
              } else {
                imp.sync_id = legacyFpToSyncId.get(occFp) || occFp;
              }
            }
            imp.sync_id = resolveCanonicalSyncId(imp.sync_id, mergedAliases);
            if (!legacyFpToSyncId.has(occFp)) legacyFpToSyncId.set(occFp, imp.sync_id);
            if (!imp.photo_slots) imp.photo_slots = CC.normalizePhotoSlots(imp);
            const impDerived = CC.deriveThumbsFromSlots(imp.photo_slots, imp.discogs_thumb || '');
            imp.thumbs = impDerived.thumbs;
            imp.thumb_data_url = impDerived.thumb_data_url;
            if (!imp.field_revs || typeof imp.field_revs !== 'object') imp.field_revs = {};
            if (!imp.created_at) imp.created_at = Number(imp.updated_at || 0);

            const delTs = normTombstoneTs(mergedDeleted[imp.sync_id]);
            const impTs = Number(imp.updated_at || imp.created_at || 0);
            if (delTs > 0 && delTs >= impTs) continue;

            if (bySyncId.has(imp.sync_id)) {
              const existing = bySyncId.get(imp.sync_id);
              const res = CC.mergeStashRecordsDeterministic(existing, imp);
              const nextRec = { ...res.merged, sync_id: imp.sync_id };
              if (existing.id !== undefined) nextRec.id = existing.id;
              if (nextRec.legacy_orig_id === undefined && imp.legacy_orig_id !== undefined) nextRec.legacy_orig_id = imp.legacy_orig_id;
              if (nextRec.legacy_source === undefined && imp.legacy_source !== undefined) nextRec.legacy_source = imp.legacy_source;
              bySyncId.set(imp.sync_id, nextRec);
            } else {
              const canonical = CC.mergeStashRecordsDeterministic(imp, imp).merged;
              canonical.sync_id = imp.sync_id;
              if (imp.legacy_orig_id !== undefined) canonical.legacy_orig_id = imp.legacy_orig_id;
              if (imp.legacy_source !== undefined) canonical.legacy_source = imp.legacy_source;
              bySyncId.set(imp.sync_id, canonical);
            }
          }

          // 5. Dedupe any duplicate Discogs copies deterministically
          const repair = CC.dedupeAndMergeStashRecords(Array.from(bySyncId.values()), mergedAliases);
          mergedAliases = repair.aliases;
          const finalRows = repair.records.filter(r => {
            const delTs = normTombstoneTs(mergedDeleted[r.sync_id]);
            const recTs = Number(r.updated_at || r.created_at || 0);
            return !(delTs > 0 && delTs >= recTs);
          });

          // Determine IDs to remove (deduped or newly tombstoned)
          const survivingIds = new Set(finalRows.map(r => r.id).filter(id => id !== undefined && id !== null));
          const idsToDelete = new Set(repair.duplicateLocalIdsToDelete || []);
          liveRows.forEach(r => {
            if (r.id !== undefined && r.id !== null && !survivingIds.has(r.id)) {
              idsToDelete.add(r.id);
            }
          });

          // Persist changed/new rows & collect outbox ops ONLY for rows that actually changed
          const ops = [];
          idsToDelete.forEach(delId => stashStore.delete(delId));
          finalRows.forEach(r => {
            const noId = { ...r };
            delete noId.id;
            const nextJson = JSON.stringify(noId);
            const prevJson = liveSnapshotJsonBySid.get(r.sync_id);
            if (nextJson !== prevJson) {
              stashStore.put(r);
              ops.push({ type: 'upsert_stash', sync_id: r.sync_id, record: noId });
              changedStashCount++;
            }
          });

          // Queue any newly imported tombstones
          Object.entries(mergedDeleted).forEach(([sid, entry]) => {
            if (normTombstoneTs(entry) > normTombstoneTs(liveDeleted[sid])) {
              ops.push({ type: 'delete_stash', sync_id: sid, deleted: entry });
            }
          });

          // 6. Merge spotifyProfile by syncedAt / dnaUpdatedAt
          let nextSpotify = liveSpotify ? { ...liveSpotify } : null;
          let spotifyChanged = false;
          if (incomingSpotify) {
            if (!nextSpotify) {
              nextSpotify = { ...incomingSpotify };
              spotifyChanged = true;
            } else {
              const incSync = Number(incomingSpotify.syncedAt || 0);
              const curSync = Number(nextSpotify.syncedAt || 0);
              const incDna = Number(incomingSpotify.dnaUpdatedAt || 0);
              const curDna = Number(nextSpotify.dnaUpdatedAt || 0);
              const base = incSync > curSync ? { ...incomingSpotify } : { ...nextSpotify };
              if (incDna > curDna) {
                base.tasteDna = incomingSpotify.tasteDna || '';
                base.softSpots = incomingSpotify.softSpots || '';
                base.dnaUpdatedAt = incDna;
              } else if (curDna >= incDna) {
                base.tasteDna = nextSpotify.tasteDna || '';
                base.softSpots = nextSpotify.softSpots || '';
                base.dnaUpdatedAt = curDna;
              }
              if (JSON.stringify(base) !== JSON.stringify(nextSpotify)) {
                nextSpotify = base;
                spotifyChanged = true;
              }
            }
          }
          if (spotifyChanged && nextSpotify) {
            metaStore.put({ key: 'spotify_profile', value: nextSpotify });
            ops.push({ type: 'spotify_profile', profile: nextSpotify });
          }

          metaStore.put({ key: 'deleted_sync_ids', value: mergedDeleted });
          metaStore.put({ key: SYNC_ID_ALIASES_KEY, value: mergedAliases });

          if (ops.length > 0) {
            liveQueue.push({
              batchId: CC.newBatchId(),
              accountEmail: CC.cfg.googleBoundEmail || CC.cfg.googleEmail || '',
              createdAt: Date.now(),
              deviceId: CC.getDeviceId(),
              status: 'queued',
              ops
            });
            metaStore.put({ key: CLOUD_OUTBOX_KEY, value: { queue: liveQueue } });
          }

          totalStashCount = finalRows.length;
          mergedSpotifyOut = nextSpotify;
          pendingCount = liveQueue.length;
        });
      };
    });

    CC.setPendingCloudChanges(pendingCount);
    return {
      totalStashCount,
      changedStashCount,
      spotifyProfile: mergedSpotifyOut,
      pendingCount
    };
  });

  window.CC = CC;
})();
