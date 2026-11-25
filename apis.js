(() => {
  'use strict';

  const CC = {};
  CC.REDIRECT_URI = location.origin + location.pathname;
  CC.CFG_KEY = 'cratecheck_cfg_v1';

  CC.cfg = Object.assign({
    geminiKey: '',
    geminiModel: 'gemini-3.5-flash-lite',
    autoPlayHighlight: true,
    autoDetective: true,
    discogsToken: '',
    discogsUser: '',
    discogsFolderId: '1',
    discogsFolders: [{ id: 1, name: 'Uncategorized' }],
    homeCountry: 'US',
    fetchVgSuggestions: true,
    threshold: 20,
    voice: false,
    spotifyClientId: '',
    spotifyAccessToken: '',
    spotifyRefreshToken: '',
    spotifyExpiresAt: 0
  }, JSON.parse(localStorage.getItem(CC.CFG_KEY) || '{}'));

  CC.persistCfg = () => localStorage.setItem(CC.CFG_KEY, JSON.stringify(CC.cfg));
  CC.sleep = (ms) => new Promise(r => setTimeout(r, ms));
  CC.esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CC.norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

  CC.similarity = (a, b) => {
    const ta = new Set(CC.norm(a).split(' ').filter(w => w.length > 1));
    const tb = new Set(CC.norm(b).split(' ').filter(w => w.length > 1));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    ta.forEach(w => { if (tb.has(w)) inter++; });
    const na = CC.norm(a), nb = CC.norm(b);
    const sub = (na && nb && (na.includes(nb) || nb.includes(na))) ? 0.25 : 0;
    return Math.min(1, inter / (ta.size + tb.size - inter) + sub);
  };

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

  // ==================== DISCOGS RATE-LIMITED API ====================
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

  CC.discogsFetch = (path, params = {}, method = 'GET') => new Promise((resolve, reject) => {
    dQueue.push({ path, params, method, resolve, reject });
    runDQueue();
  });

  async function runDQueue() {
    if (dBusy || !dQueue.length) return;
    dBusy = true;
    const job = dQueue.shift();
    try {
      const now = Date.now();
      recentDCalls = recentDCalls.filter(t => now - t < 60000);
      if (recentDCalls.length >= 49) {
        const waitMs = 60500 - (now - recentDCalls[0]);
        statusCb(`Cooling down Discogs rate limit (${Math.ceil(waitMs / 1000)}s)...`, true);
        await CC.sleep(Math.max(1000, waitMs));
      }
      const gap = Date.now() - lastDCall;
      if (gap < 1200) await CC.sleep(1200 - gap);

      const url = new URL('https://api.discogs.com' + job.path);
      Object.entries(job.params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
      if (CC.cfg.discogsToken) url.searchParams.set('token', CC.cfg.discogsToken.trim());

      lastDCall = Date.now();
      recentDCalls.push(lastDCall);
      rateCb(recentDCalls.length);

      const res = await fetch(url.toString(), { method: job.method });
      if (res.status === 429) {
        statusCb('Discogs rate limit hit — waiting 60s...', true);
        await CC.sleep(60000);
        const retry = await fetch(url.toString(), { method: job.method });
        if (!retry.ok) throw new Error(`Discogs HTTP ${retry.status}`);
        job.resolve(await retry.json().catch(() => ({})));
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
    if (CC.releaseDetailCache.has(releaseId)) return CC.releaseDetailCache.get(releaseId);
    const data = await CC.discogsFetch(`/releases/${releaseId}`);
    CC.releaseDetailCache.set(releaseId, data);
    return data;
  };

  // ==================== GEMINI API ====================
  CC.callGeminiJSON = async (parts) => {
    const model = (CC.cfg.geminiModel || 'gemini-3.5-flash-lite').trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(CC.cfg.geminiKey.trim())}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.15 }
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 140)}`);
    }
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    try { return JSON.parse(cleaned); }
    catch (_) {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('Could not parse Gemini JSON');
    }
  };

  // ==================== KEYLESS 30s AUDIO HIGHLIGHT FETCHER ====================
  async function searchKeylessClip(artist, track, album) {
    const queries = [];
    if (artist && track) queries.push(`${artist} ${track}`);
    if (artist && album) queries.push(`${artist} ${album}`);

    // 1. Keyless Apple/iTunes Search API (direct CORS, 30s M4A clip, no app/account)
    for (const term of queries) {
      try {
        const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=8`);
        if (!res.ok) continue;
        const data = await res.json();
        const items = (data.results || []).filter(r => r.previewUrl);
        if (!items.length) continue;

        const best = items.map(r => {
          const aSim = artist ? CC.similarity(artist, r.artistName || '') : 0.5;
          const tSim = track ? CC.similarity(track, r.trackName || '') : 0.4;
          const isTribute = /karaoke|tribute|cover band|lullaby/i.test(`${r.artistName} ${r.collectionName}`);
          return { r, score: aSim * 0.6 + tSim * 0.4 - (isTribute ? 0.5 : 0) };
        }).sort((a, b) => b.score - a.score)[0];

        if (best && best.score >= 0.35) {
          return {
            previewUrl: best.r.previewUrl,
            trackName: best.r.trackName,
            artistName: best.r.artistName
          };
        }
      } catch (_) {}
    }

    // 2. Fallback: Deezer JSONP (keyless 30s MP3 clip)
    for (const q of queries) {
      const dz = await searchDeezerJSONP(q, artist, track);
      if (dz) return dz;
    }
    return null;
  }

  function searchDeezerJSONP(query, artist, track) {
    return new Promise((resolve) => {
      const cbName = '_dzcb_' + Math.random().toString(36).slice(2, 9);
      const script = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); resolve(null); }, 4500);

      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = (payload) => {
        cleanup();
        const list = (payload?.data || []).filter(x => x.preview);
        if (!list.length) { resolve(null); return; }
        const best = list.map(x => ({
          x,
          score: (artist ? CC.similarity(artist, x.artist?.name || '') * 0.6 : 0.3) +
                 (track ? CC.similarity(track, x.title || '') * 0.4 : 0.2)
        })).sort((a, b) => b.score - a.score)[0];

        if (best && best.score >= 0.3) {
          resolve({ previewUrl: best.x.preview, trackName: best.x.title, artistName: best.x.artist?.name || artist });
        } else resolve(null);
      };

      script.onerror = () => { cleanup(); resolve(null); };
      script.src = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=6&output=jsonp&callback=${cbName}`;
      document.body.appendChild(script);
    });
  }

  CC.fetchAudioHighlight = searchKeylessClip;

  // ==================== SPOTIFY PKCE OAUTH & UNCAPPED SYNC ====================
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

  CC.syncSpotifyAll = async () => {
    statusCb('Starting uncapped Spotify sync...', true);
    const artistCounts = {};
    const trackTitles = new Set();

    const addArtist = (name, weight = 1) => {
      const n = CC.norm(name);
      if (!n) return;
      if (!artistCounts[n]) artistCounts[n] = { name, count: 0 };
      artistCounts[n].count += weight;
    };
    const addTrack = (tr, weight = 1) => {
      if (!tr || !tr.name) return;
      const nt = CC.norm(tr.name);
      if (nt) trackTitles.add(nt);
      (tr.artists || []).forEach(a => addArtist(a.name, weight));
    };

    const me = await spFetch('https://api.spotify.com/v1/me');

    for (const range of ['long_term', 'medium_term']) {
      const topA = await spFetch(`https://api.spotify.com/v1/me/top/artists?limit=50&time_range=${range}`).catch(() => ({ items: [] }));
      (topA.items || []).forEach((a, i) => addArtist(a.name, Math.max(5, 25 - Math.floor(i / 2))));
    }
    const topT = await spFetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term').catch(() => ({ items: [] }));
    (topT.items || []).forEach(t => addTrack(t, 4));

    let next = 'https://api.spotify.com/v1/me/tracks?limit=50';
    let count = 0;
    while (next) {
      statusCb(`Syncing Liked Songs (${count} scanned)...`, true);
      const d = await spFetch(next);
      (d.items || []).forEach(it => addTrack(it.track, 2));
      count += (d.items || []).length;
      next = d.next;
      if (next) await CC.sleep(80);
    }

    next = 'https://api.spotify.com/v1/me/albums?limit=50';
    count = 0;
    while (next) {
      statusCb(`Syncing Saved Albums (${count} scanned)...`, true);
      const d = await spFetch(next).catch(() => ({ items: [], next: null }));
      (d.items || []).forEach(it => {
        (it.album?.artists || []).forEach(a => addArtist(a.name, 4));
        (it.album?.tracks?.items || []).forEach(t => addTrack(t, 1));
      });
      count += (d.items || []).length;
      next = d.next;
      if (next) await CC.sleep(80);
    }

    const owned = [];
    let plUrl = 'https://api.spotify.com/v1/me/playlists?limit=50';
    while (plUrl) {
      statusCb(`Finding your playlists (${owned.length} owned)...`, true);
      const pls = await spFetch(plUrl).catch(() => ({ items: [], next: null }));
      (pls.items || []).forEach(p => { if (p && (p.owner?.id === me.id || p.collaborative)) owned.push(p); });
      plUrl = pls.next;
      if (plUrl) await CC.sleep(80);
    }

    for (let i = 0; i < owned.length; i++) {
      const pl = owned[i];
      let pNext = `https://api.spotify.com/v1/playlists/${pl.id}/items?limit=50`;
      let pTracks = 0;
      while (pNext) {
        statusCb(`Playlist ${i + 1}/${owned.length}: ${pl.name} (${pTracks} songs)...`, true);
        const pd = await spFetch(pNext).catch(() => ({ items: [], next: null }));
        (pd.items || []).forEach(e => addTrack(e.item || e.track, 1));
        pTracks += (pd.items || []).length;
        pNext = pd.next;
        if (pNext) await CC.sleep(80);
      }
    }

    const topArtists = Object.values(artistCounts).sort((a, b) => b.count - a.count).slice(0, 120).map(x => x.name);
    return {
      syncedAt: Date.now(),
      userDisplayName: me.display_name || me.id,
      topArtists,
      allArtists: artistCounts,
      trackTitles: Array.from(trackTitles),
      totalTracks: trackTitles.size,
      totalArtists: Object.keys(artistCounts).length,
      totalPlaylists: owned.length
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