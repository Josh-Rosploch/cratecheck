# 📼 Soft Spot

**Live App:** [softspot.k1s.co](https://softspot.k1s.co) · **Short Link:** [ss.k1s.co](https://ss.k1s.co)

A zero-backend, monochrome industrial Progressive Web App (PWA) for scanning, verifying, grading, pricing, and cataloging physical music media (**Cassettes, CDs, and Vinyl**) in the field at thrift stores/record shops or at home.

---

## Core Features

| Area | Highlights |
| --- | --- |
| **3-Shot Single Item Scan & Auto-UPC** | Guided **Front + Side A → Back + Side B → Optional Spine** capture flow (auto-crops & rotates spines horizontally), live `BarcodeDetector` UPC locking, Sony-style red **Focus Peaking**, rear/ultrawide lens & `0.5x` zoom switching, and tap-to-zoom blur inspection right inside the viewfinder. |
| **Multi-Shot Pile / Shelf Scanner** | Snap or upload **1–4 close-up shelf sections** at `3072px` ultra-high detail (`MEDIA_RESOLUTION_ULTRA_HIGH`) with smart overlap deduplication (`artist\|title\|format` + cat# guard), simultaneous **2-finger pinch + pan zoom**, rotated SVG polygon spotlights, progressive pin rendering, owned-collection badges, and non-blocking rough Discogs pricing. |
| **Zero-Guessing Discogs Verification** | **Hard Format Gate** (`Cassette ≠ CD ≠ Vinyl`), **Top-15 Fast Pass** with automatic `[r=ID]` sibling traversal, cached 25-item **Deep Search**, conservative highest-`have` tie-breaker confirmation, live exact-pressing + another-pressing duplicate detection, and durable add-first/swap-safe Discogs recovery. |
| **Goldmine Grading & Voice Re-Grade** | Optional **"Grade in one go"** toggle (defaults to `Not Graded` for fast thrift scanning so you never coerce ungraded items on Discogs), one-tap on-demand **✨ AI Grade Photos**, spine cut-out detection (hole punches, saw cuts, notches), and continuous hands-free **🎤 AI Voice Re-Grade**. |
| **Personal Taste Engine & Audio Previews** | Editable **Taste Profile + Soft Spots**, local zero-AI **Spotify library matching** with **Liked Songs vs. Playlist-Only** provenance weighting, Stash taste recalibration, and era/album-aware 30s audio previews (Apple Music & Deezer) with album art, safe alternate-version fallback, and direct one-tap YouTube search when unstreamable. |
| **Laser-Aligned Stash & Spine Shelf** | Tabular 4-column Stash grid (`Price \| Taste \| Grade \| Sync`), visual **`SPINES`** stacked shelf view, CSV & JSON backup/restore, and **Google Drive `appDataFolder` Cloud Sync** with SHA-256 incremental photo blobs, deletion tombstones, and collision-safe delta compaction across phone and PC. |

---

## Quick Start (For Users — ~2 Minutes)

1. **Open Soft Spot:** Visit **[https://softspot.k1s.co](https://softspot.k1s.co)** (or **[https://ss.k1s.co](https://ss.k1s.co)**) on Chrome (Android/Desktop) or Safari (iOS), and optionally tap **Add to Home Screen** to install as a full-screen PWA.
2. **Turn On Cloud Sync (Optional):** Open **Settings → 1. Google Drive Cloud Sync** and tap **☁️ Sign in with Google & Sync** to back up and sync your Stash, photos, spines, and Taste Profile across devices.
3. **Add Your Free Gemini API Key:** Open **Settings → 2. Gemini Cloud & Playback**, create a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) *(no paid plan required — free tier includes generous daily scans)*, and paste it in.
4. **Connect Discogs (+ Optional Spotify / Taste Profile):**
   - Open **Settings → 3. Discogs Account & Preferences**, generate a free Personal Access Token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers), paste it, and tap **Verify & Load Folders**.
   - Optionally open **Settings → 4. Music Services & Taste Profile** to write your **Taste Profile & Soft Spots** and/or sync your Spotify library locally.

---

## Privacy & Security Architecture

- **100% Client-Side, Zero Backend:** Soft Spot is pure HTML, CSS, and Vanilla JavaScript with no server, no database, and no analytics. All requests go directly from your browser to Google Gemini, Discogs, Spotify, iTunes/Deezer, and Google Drive.
- **Strictly Sandboxed Google Drive Sync:** Cloud Sync uses **only** the `https://www.googleapis.com/auth/drive.appdata` scope — a hidden, app-specific sandbox folder inside your own Google Drive. Soft Spot **cannot see, read, or modify** any of your normal Drive files or folders.
- **Keys Stay Local by Default:** Your Gemini API key and Discogs token stay strictly in your browser's `localStorage`. Syncing API keys across your own devices inside your private `appDataFolder` is **OFF by default** and requires explicit opt-in (`Sync API Keys & Tokens across my devices`). Rotating Spotify OAuth refresh tokens and device-specific camera preferences are never synced.

---

## Self-Hosting Guide

Soft Spot requires **zero build step** and runs on any static host (such as GitHub Pages):

1. Fork or clone this repository and point GitHub Pages (or any static web server) at the active version directory (e.g., `v2.0.1/` or copied to root).
2. *(Optional)* Add a `CNAME` file for your custom subdomain (e.g., `softspot.yourdomain.com`) with HTTPS enabled (required for in-app Camera, Spotify PKCE, and Google Sign-In).
3. *(Optional)* To use your own Google Cloud OAuth Client ID for Drive Sync:
   - Enable the **Google Drive API** in [Google Cloud Console](https://console.cloud.google.com/apis/library/drive.googleapis.com).
   - Create an **OAuth 2.0 Client ID (Web application)** and add your exact `https://yourdomain.com` as an **Authorized JavaScript Origin**.
   - Open **Settings → 1. Google Drive Cloud Sync → Advanced: Self-Hosting / Custom Google Client ID** and paste your Client ID.

---

## Tech Stack

- **Core:** Plain HTML5, CSS3 (Sharp Monochrome Industrial UI, CSS Grid, `tabular-nums`), Vanilla ES6+ JavaScript — zero frameworks, zero bundlers.
- **Local Storage:** IndexedDB (`stash` & `meta` stores for 1200px WebP photos, cropped spines, and collection indexes) + `localStorage` configuration & durable Discogs recovery ledger.
- **Cloud Sync:** Google Identity Services (GIS) Token Client + Google Drive API v3 (`spaces=appDataFolder`, multipart uploads, SHA-256 hashed photo deduplication, delta compaction).
- **APIs:** Google Gemini REST API (`generateContent` with `MEDIA_RESOLUTION_ULTRA_HIGH`), Discogs API v2 (sliding-window burst queue), Spotify Web API (PKCE OAuth), iTunes Search API & Deezer JSONP (keyless 30s audio previews).
