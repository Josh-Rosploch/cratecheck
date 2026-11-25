(() => {
  'use strict';

  const CC = {};
  CC.REDIRECT_URI = location.origin + location.pathname;
  CC.CFG_KEY = 'cratecheck_cfg_v1';

  CC.MEDIA_GRADES = [
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

  CC.cfg = Object.assign({
    aiProvider: 'gemini',
    ollamaUrl: '',
    ollamaModel: 'qwen3.8:27b',
    ollamaFallback: false,
    geminiKey: '',
    geminiModel: 'gemini-3.5-flash-lite',
    autoPlayHighlight: true,
    autoDetective: true,
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
  }, JSON.parse(localStorage.getItem(CC.CFG_KEY) || '{}'));

  CC.persistCfg = () => localStorage.setItem(CC.CFG_KEY, JSON.stringify(CC.cfg));

  CC.isAiReady = () => {
    if (CC.cfg.aiProvider === 'ollama') return Boolean(CC.cfg.ollamaUrl?.trim() && CC.cfg.ollamaModel?.trim());
    return Boolean(CC.cfg.geminiKey?.trim());
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
  CC.norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  CC.normFull = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

  CC.findDiscogsInstances = async (releaseId) => {
    if (!CC.cfg.discogsUser || !releaseId) return [];
    const data = await CC.discogsFetch(`/users/${encodeURIComponent(CC.cfg.discogsUser)}/collection/releases/${releaseId}`).catch(() => null);
    return Array.isArray(data?.releases) ? data.releases : [];
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
    if (!CC.cfg.discogsUser || !releaseId || !instanceId) return 0;
    const f = CC.cfg.discogsFields || { media: 1, sleeve: 2, notes: 3 };
    const updates = [];
    if (f.media && mediaCond) updates.push({ id: f.media, val: mediaCond });
    if (f.sleeve && sleeveCond) updates.push({ id: f.sleeve, val: sleeveCond });
    if (f.notes && notes !== undefined && notes !== null) updates.push({ id: f.notes, val: notes });

    let okCount = 0;
    for (const u of updates) {
      try {
        await CC.discogsFetch(
          `/users/${encodeURIComponent(CC.cfg.discogsUser)}/collection/folders/${encodeURIComponent(folderId || '1')}/releases/${releaseId}/instances/${instanceId}/fields/${u.id}`,
          {},
          'POST',
          { value: u.val }
        );
        okCount++;
      } catch (_) {}
    }
    return okCount;
  };

  // ==================== UNIFIED AI ENGINE (LOCAL PC OLLAMA + GEMINI CLOUD) ====================
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

  CC.listOllamaModels = async (rawUrl) => {
    const base = String(rawUrl || CC.cfg.ollamaUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('Enter your Ollama HTTPS URL first');
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || []).map(m => m.name).filter(Boolean);
  };

  async function runOllamaRequest(parts, thinkingLevel, opts) {
    const { expectJSON = true, retryLabel = 'Local PC' } = opts;
    const base = String(CC.cfg.ollamaUrl || '').trim().replace(/\/+$/, '');
    const model = String(CC.cfg.ollamaModel || 'qwen3.8:27b').trim();
    if (!base || !model) throw new Error('Set your Ollama URL & Model in Settings');

    const promptText = parts.filter(p => p.text).map(p => p.text).join('\n\n');
    const images = parts.filter(p => p.inline_data?.data).map(p => p.inline_data.data);

    // Dynamically size num_ctx so Ollama never silently truncates large Discogs/Spotify prompts
    const estTokens = Math.ceil(promptText.length / 3) + images.length * 1600 + 4096;
    let numCtx = 16384;
    if (estTokens > 65536) numCtx = 131072;
    else if (estTokens > 32768) numCtx = 65536;
    else if (estTokens > 16384) numCtx = 32768;

    const ctrl = new AbortController();
    activeAiCtrl = ctrl;
    const signal = ctrl.signal;

    const sendChat = (useThink) => {
      const body = {
        model,
        stream: false,
        messages: [{ role: 'user', content: promptText, ...(images.length ? { images } : {}) }],
        options: { temperature: 0.1, num_ctx: numCtx }
      };
      if (expectJSON) body.format = 'json';
      if (useThink) body.think = true;
      return fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      });
    };

    try {
      let res = await sendChat(Boolean(thinkingLevel));
      if (res.status === 400 && thinkingLevel) res = await sendChat(false);
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        const e = new Error(`Ollama HTTP ${res.status}: ${t.slice(0, 140)}`);
        e.status = res.status;
        throw e;
      }

      const data = await res.json();
      let raw = data?.message?.content || '';

      // Edge-case safeguard: if a thinking model filled message.thinking and left content empty under JSON mode, retry once with think:false
      if (!raw.trim() && thinkingLevel) {
        statusCb(`${retryLabel}: finalizing structured output on PC...`, true, { cancellable: true });
        const retryRes = await sendChat(false);
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          raw = retryData?.message?.content || '';
        }
      }

      if (!expectJSON) return String(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      return cleanJsonText(raw);
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted) throw new DOMException('Cancelled by user', 'AbortError');
      err.isOllamaNet = !err.status;
      throw err;
    } finally {
      if (activeAiCtrl === ctrl) activeAiCtrl = null;
    }
  }

  async function runGeminiRequest(parts, thinkingLevel, opts) {
    const { expectJSON = true, retryLabel = 'Gemini' } = opts;
    if (!CC.cfg.geminiKey?.trim()) throw new Error('Add your Gemini API Key in Settings');
    const model = (CC.cfg.geminiModel || 'gemini-3.5-flash-lite').trim();
    const url = `[https://generativelanguage.googleapis.com/v1beta/models/$](https://generativelanguage.googleapis.com/v1beta/models/$){encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(CC.cfg.geminiKey.trim())}`;

    const ctrl = new AbortController();
    activeAiCtrl = ctrl;
    const signal = ctrl.signal;

    const send = (useThinking) => {
      const genCfg = { temperature: 0.1 };
      if (expectJSON) genCfg.responseMimeType = 'application/json';
      if (useThinking && thinkingLevel) genCfg.thinkingConfig = { thinkingLevel };
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: genCfg }),
        signal
      });
    };

    let attempt = 0;
    try {
      while (true) {
        if (signal.aborted) throw new DOMException('Cancelled by user', 'AbortError');
        attempt++;
        let res = null;
        try {
          res = await send(true);
          if (res.status === 400 && thinkingLevel) res = await send(false);
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

  CC.callAI = async (parts, thinkingLevel = null, opts = {}) => {
    if (CC.cfg.aiProvider === 'ollama') {
      try {
        return await runOllamaRequest(parts, thinkingLevel, opts);
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (CC.cfg.ollamaFallback && CC.cfg.geminiKey?.trim()) {
          statusCb(`Local PC unreachable — falling back to Gemini Cloud...`, true, { cancellable: true });
          return await runGeminiRequest(parts, thinkingLevel, opts);
        }
        throw new Error(`Local PC (${CC.cfg.ollamaModel}): ${err.message}`);
      }
    }
    return await runGeminiRequest(parts, thinkingLevel, opts);
  };
  CC.callGeminiJSON = CC.callAI;

  // ==================== REMIX-AWARE AUDIO PREVIEW + PLATFORM AVAILABILITY ====================
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

  function scoreAudioCandidate(candArtist, candTrack, candAlbum, targetArtist, rawTrack, targetAlbum, strictTrack) {
    const isVarious = !targetArtist || /^various(\s+artists)?$/i.test(targetArtist.trim());
    const aSim = isVarious ? 0.7 : CC.similarity(targetArtist, candArtist || '');
    const isTribute = /karaoke|tribute|cover band|lullaby|in the style of/i.test(`${candArtist} ${candAlbum} ${candTrack}`);
    if (isTribute) return { score: -1, versionMatched: false };

    const req = splitTrackVersion(rawTrack);
    const cand = splitTrackVersion(candTrack);
    const tSimBase = req.base ? CC.similarity(req.base, cand.base || candTrack || '') : 0;
    const albSim = targetAlbum ? CC.similarity(targetAlbum, candAlbum || '') : 0;

    if (strictTrack && req.base) {
      if (tSimBase < 0.45) return { score: -1, versionMatched: false };
      if (!isVarious && aSim < 0.35) return { score: -1, versionMatched: false };

      let score = tSimBase * 0.50 + aSim * 0.25 + albSim * 0.05;
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

        if (distinctRatio >= 0.5 || vSim >= 0.55) {
          score += 0.45 + distinctRatio * 0.25;
          versionMatched = true;
        } else if (reqV.includes('radio') && (candV.includes('radio') || (!candV && !/remix|mix|extended|club|dub/i.test(candFull)))) {
          score += 0.30;
          versionMatched = candV.includes('radio');
        } else if (candV && /remix|mix|line dance|dub|club|extended|karaoke/i.test(candV)) {
          score -= 0.25;
        }
      } else {
        if (cand.version && /remix|line dance|dub|club mix|extended|karaoke|instrumental/i.test(cand.version)) score -= 0.22;
        else score += 0.12;
      }
      return { score, versionMatched };
    }

    if (!isVarious && aSim < 0.45) return { score: -1, versionMatched: false };
    if (targetAlbum && albSim < 0.35) return { score: -1, versionMatched: false };
    return { score: aSim * 0.55 + albSim * 0.45, versionMatched: true };
  }

  async function queryApple(term, artist, rawTrack, album, strictTrack) {
    try {
      const res = await fetch(`[https://itunes.apple.com/search?term=$](https://itunes.apple.com/search?term=$){encodeURIComponent(term)}&media=music&entity=song&limit=25`);
      if (!res.ok) return null;
      const data = await res.json();
      const items = (data.results || []).filter(r => r.previewUrl || r.trackViewUrl);
      if (!items.length) return null;
      const best = items
        .map(r => {
          const ev = scoreAudioCandidate(r.artistName, r.trackName, r.collectionName, artist, rawTrack, album, strictTrack);
          return { r, score: ev.score, versionMatched: ev.versionMatched };
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
        exactVersion: best.versionMatched
      };
    } catch (_) { return null; }
  }

  function queryDeezerJSONP(query, artist, rawTrack, album, strictTrack) {
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
            const ev = scoreAudioCandidate(x.artist?.name, x.title, x.album?.title, artist, rawTrack, album, strictTrack);
            return { x, score: ev.score, versionMatched: ev.versionMatched };
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
            exactVersion: best.versionMatched
          });
        } else resolve(null);
      };

      script.onerror = () => { cleanup(); resolve(null); };
      script.src = `[https://api.deezer.com/search?q=$](https://api.deezer.com/search?q=$){encodeURIComponent(query)}&limit=20&output=jsonp&callback=${cbName}`;
      document.body.appendChild(script);
    });
  }

  async function querySpotifyExact(query, artist, rawTrack, album, strictTrack) {
    if (!CC.cfg.spotifyAccessToken && !CC.cfg.spotifyRefreshToken) return null;
    try {
      const d = await spFetch(`[https://api.spotify.com/v1/search?q=$](https://api.spotify.com/v1/search?q=$){encodeURIComponent(query)}&type=track&limit=10`);
      const list = d?.tracks?.items || [];
      if (!list.length) return null;
      const best = list
        .map(x => {
          const aName = (x.artists || []).map(a => a.name).join(', ');
          const ev = scoreAudioCandidate(aName, x.name, x.album?.name, artist, rawTrack, album, strictTrack);
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

  CC.fetchAudioAndPlatforms = async (artist, track, album, strictTrack = true) => {
    const isVarious = !artist || /^various(\s+artists)?$/i.test(artist.trim());
    const rawTrack = String(track || '').trim();
    const { base, version } = splitTrackVersion(rawTrack);
    const prefix = isVarious ? '' : `${artist} `;

    const primaryQ = (base && version) ? `${prefix}${base} ${version}`.trim()
      : (base ? `${prefix}${base}`.trim() : `${prefix}${album}`.trim());
    const baseQ = base ? `${prefix}${base}`.trim() : primaryQ;
    const ytUrl = `[https://www.youtube.com/results?search_query=$](https://www.youtube.com/results?search_query=$){encodeURIComponent(primaryQ)}`;

    const [ap1, dz1, sp1] = await Promise.all([
      queryApple(primaryQ, artist, rawTrack, album, strictTrack),
      queryDeezerJSONP(primaryQ, artist, rawTrack, album, strictTrack),
      CC.cfg.showSpotify ? querySpotifyExact(primaryQ, artist, rawTrack, album, strictTrack) : Promise.resolve(null)
    ]);

    let apBest = ap1, dzBest = dz1, spBest = sp1;

    if (version && !ap1?.exactVersion && !dz1?.exactVersion) {
      const [ap2, dz2] = await Promise.all([
        queryApple(baseQ, artist, rawTrack, album, strictTrack),
        queryDeezerJSONP(baseQ, artist, rawTrack, album, strictTrack)
      ]);
      if (!apBest || (ap2 && ap2.score > apBest.score)) apBest = ap2;
      if (!dzBest || (dz2 && dz2.score > dzBest.score)) dzBest = dz2;
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
      const res = await fetch('[https://accounts.spotify.com/api/token](https://accounts.spotify.com/api/token)', {
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

  async function spFetch(url) {
    if (Date.now() > CC.cfg.spotifyExpiresAt && CC.cfg.spotifyRefreshToken) await CC.refreshSpotifyToken();
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + CC.cfg.spotifyAccessToken } });
    if (res.status === 429) {
      const waitSec = Number(res.headers.get('Retry-After')) || 3;
      statusCb(`Spotify rate limit — pausing ${waitSec}s...`, true);
      await CC.sleep(waitSec * 1000 + 250);
      return spFetch(url);
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
    const authUrl = new URL('[https://accounts.spotify.com/authorize](https://accounts.spotify.com/authorize)');
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
    const res = await fetch('[https://accounts.spotify.com/api/token](https://accounts.spotify.com/api/token)', {
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

  CC.syncSpotifyAll = async (existingDna = '') => {
    statusCb('Starting complete Spotify library sync...', true);
    const artistMap = {};
    const trackPairs = new Set();
    const trackTitles = new Set();
    const decades = {};
    const playlistSummaries = [];

    const ensureArtist = (name) => {
      const n = CC.norm(name);
      if (!n) return null;
      if (!artistMap[n]) artistMap[n] = { name, count: 0, tracks: new Set(), playlists: new Set() };
      return artistMap[n];
    };

    const addDecade = (dateStr) => {
      const m = String(dateStr || '').match(/^(\d{4})/);
      if (!m) return;
      const dec = `${Math.floor(Number(m[1]) / 10) * 10}s`;
      decades[dec] = (decades[dec] || 0) + 1;
    };

    const addTrack = (tr, weight = 1, playlistName = '') => {
      if (!tr || !tr.name) return;
      const nt = CC.norm(tr.name);
      if (nt) trackTitles.add(nt);
      if (tr.album?.release_date) addDecade(tr.album.release_date);
      (tr.artists || []).forEach(a => {
        const rec = ensureArtist(a.name);
        if (!rec) return;
        rec.count += weight;
        rec.tracks.add(tr.name.trim());
        if (playlistName) rec.playlists.add(playlistName);
        const na = CC.norm(a.name);
        if (na && nt) trackPairs.add(`${na}|${nt}`);
      });
    };

    const me = await spFetch('[https://api.spotify.com/v1/me](https://api.spotify.com/v1/me)');

    for (const range of ['long_term', 'medium_term', 'short_term']) {
      statusCb(`Syncing Top Artists & Tracks (${range})...`, true);
      const topA = await spFetch(`[https://api.spotify.com/v1/me/top/artists?limit=50&time_range=$](https://api.spotify.com/v1/me/top/artists?limit=50&time_range=$){range}`).catch(() => ({ items: [] }));
      (topA.items || []).forEach((a, i) => {
        const rec = ensureArtist(a.name);
        if (rec) rec.count += Math.max(4, 20 - Math.floor(i / 3));
      });
      const topT = await spFetch(`[https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=$](https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=$){range}`).catch(() => ({ items: [] }));
      (topT.items || []).forEach(t => addTrack(t, 3));
    }

    let next = '[https://api.spotify.com/v1/me/tracks?limit=50](https://api.spotify.com/v1/me/tracks?limit=50)';
    let count = 0;
    while (next) {
      statusCb(`Syncing Liked Songs (${count} scanned)...`, true);
      const d = await spFetch(next);
      (d.items || []).forEach(it => addTrack(it.track, 2));
      count += (d.items || []).length;
      next = d.next;
      if (next) await CC.sleep(70);
    }

    next = '[https://api.spotify.com/v1/me/albums?limit=50](https://api.spotify.com/v1/me/albums?limit=50)';
    count = 0;
    while (next) {
      statusCb(`Syncing Saved Albums (${count} scanned)...`, true);
      const d = await spFetch(next).catch(() => ({ items: [], next: null }));
      (d.items || []).forEach(it => {
        if (it.album?.release_date) addDecade(it.album.release_date);
        (it.album?.artists || []).forEach(a => {
          const rec = ensureArtist(a.name);
          if (rec) rec.count += 4;
        });
        (it.album?.tracks?.items || []).forEach(t => addTrack(t, 1));
      });
      count += (d.items || []).length;
      next = d.next;
      if (next) await CC.sleep(70);
    }

    const owned = [];
    let plUrl = '[https://api.spotify.com/v1/me/playlists?limit=50](https://api.spotify.com/v1/me/playlists?limit=50)';
    while (plUrl) {
      statusCb(`Finding your playlists (${owned.length} owned)...`, true);
      const pls = await spFetch(plUrl).catch(() => ({ items: [], next: null }));
      (pls.items || []).forEach(p => { if (p && (p.owner?.id === me.id || p.collaborative)) owned.push(p); });
      plUrl = pls.next;
      if (plUrl) await CC.sleep(70);
    }

    for (let i = 0; i < owned.length; i++) {
      const pl = owned[i];
      let pNext = `[https://api.spotify.com/v1/playlists/$](https://api.spotify.com/v1/playlists/$){pl.id}/items?limit=50`;
      let pTracks = 0;
      while (pNext) {
        statusCb(`Playlist ${i + 1}/${owned.length}: ${pl.name} (${pTracks} songs)...`, true);
        const pd = await spFetch(pNext).catch(() => ({ items: [], next: null }));
        (pd.items || []).forEach(e => addTrack(e.item || e.track, 1, pl.name));
        pTracks += (pd.items || []).length;
        pNext = pd.next;
        if (pNext) await CC.sleep(70);
      }
      playlistSummaries.push({ name: pl.name, count: pTracks });
    }

    const allArtists = {};
    Object.entries(artistMap).forEach(([k, v]) => {
      allArtists[k] = {
        name: v.name,
        count: v.count,
        tracks: Array.from(v.tracks),
        playlists: Array.from(v.playlists)
      };
    });

    const topArtists = Object.values(allArtists).sort((a, b) => b.count - a.count).map(x => x.name);

    return {
      syncedAt: Date.now(),
      userDisplayName: me.display_name || me.id,
      topArtists,
      allArtists,
      trackPairs: Array.from(trackPairs),
      trackTitles: Array.from(trackTitles),
      playlistSummaries,
      decades,
      totalTracks: trackPairs.size || trackTitles.size,
      totalArtists: Object.keys(allArtists).length,
      totalPlaylists: owned.length,
      tasteDna: existingDna || '',
      dnaUpdatedAt: existingDna ? Date.now() : 0
    };
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

  window.CC = CC;
})();