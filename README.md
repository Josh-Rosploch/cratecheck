# 📼 Soft Spot

**Live App:** [softspot.k1s.co](https://softspot.k1s.co) · **Short Link:** [ss.k1s.co](https://ss.k1s.co)

A zero-backend, sharp monochrome industrial Progressive Web App (PWA) for scanning, verifying, grading, pricing, and cataloging physical media (**Cassettes, CDs, Vinyl, and Other Discogs Media** — 8-Track, Reel-To-Reel, MiniDisc, DAT, DVD, VHS, LaserDisc, Blu-ray, Shellac, SACD, and more) in the field at thrift stores/record shops or at home on phone and PC.

---

## Core Features (v2.1.1)

| Area | Highlights |
| --- | --- |
| **3-Shot Single Item Scan & Auto-UPC** | Guided **Front + Side A → Back + Side B → Optional Spine** capture flow, live `BarcodeDetector` UPC locking, Sony-style red **Focus Peaking**, rear/ultrawide lens & `0.5x` zoom switching, multi-media **Other ▾** format selector, and tap-to-zoom blur inspection. |
| **Multi-Shot Pile / Shelf Scanner** | Snap or upload **1–4 close-up shelf sections** at `3072px` ultra-high detail (`MEDIA_RESOLUTION_ULTRA_HIGH`) with smart overlap deduplication (`artist\|title\|format` + cat# guard), simultaneous **2-finger pinch + pan zoom**, rotated SVG polygon spotlights, progressive pin rendering, owned-collection badges, and non-blocking rough Discogs pricing. |
| **Zero-Guessing Discogs Sync, Hydration & Folder Mirroring** | **Hard Format Gate** across all Discogs formats, **Top-15 Fast Pass** + `[r=ID]` sibling traversal, cached 25-item **Deep Search**, **🔄 Sync with Discogs** mirroring copies & folders 1-to-1 while automatically hydrating tracklists, pressing notes & market values (preserving last known prices if stats fail), in-place **📁 Move to Folder**, and account-guarded **🗑️ Delete from Discogs & Stash** alongside local-only support. |
| **Direct Stash Photo Manager & Interactive Crop/Rotate** | Streamlined 4-button Stash photo manager (**Front / Back / Spine / Extra**) with an offline pure-Canvas **✂️ Crop & Rotate** modal, one-tap **↻ 90°** spine rotation, and crisp WebP storage synced across devices and the `SPINES` shelf. |
| **Goldmine Grading & Voice Re-Grade** | Optional **"Grade in one go"** toggle (defaults to `Not Graded` for fast thrift scanning), one-tap on-demand **✨ AI Grade Photos**, spine cut-out detection (hole punches, saw cuts, notches), and continuous hands-free **🎤 AI Voice Re-Grade**. |
| **Personal Taste Engine & Resumable Spotify Sync** | Editable **Taste Profile + Soft Spots**, local zero-AI **Spotify library matching** (**💚 Sync Liked Songs** fast pass or optional **🎧 Full Library Pass** with page-by-page checkpointing and **▶ Resume Spotify Sync**), batch Stash recalibration with notable songs & litmus tracks, and overlaid-art 30s audio previews (Apple Music & Deezer) with direct YouTube fallback. |
| **Safe Two-Device Google Drive Sync** | Private `drive.appdata` sync using coalesced immutable versioned batches (`ss_v2_batch_*.json`), SHA-256 deduplicated photo blobs, deterministic field-level merging (conflicts strictly scoped to genuine cross-device user edits), deletion tombstones, and account-switch protection across phone and PC. |

---

## Quick Start (Phone + PC — ~2 Minutes)

1. **Open Soft Spot:** Visit **[https://softspot.k1s.co](https://softspot.k1s.co)** (or **[https://ss.k1s.co](https://ss.k1s.co)**) on Chrome (Android/Desktop) or Safari (iOS), and optionally tap **Add to Home Screen** to install as a full-screen PWA.
2. **Connect Google Drive:** Open **Settings → 1. Google Drive Cloud Sync** and tap **☁️ Connect Google Drive**:
   - **☁️ Connect Google Drive:** Signs in, identifies your Google account, and immediately loads your existing cloud profile, photos, spines, Taste Profile, Soft Spots, and applicable settings in one click. If Drive is empty and you already have local data, Soft Spot shows a clear empty-cloud status and waits for you to tap **🔄 Sync Now**.
   - **⬇️ Load from Google Drive:** Pulls and merges cloud updates locally with **zero Drive writes**, preserving local-only items and unsynced edits while retaining any competing edits for review.
   - **🔄 Sync Now:** Pulls, merges, uploads missing photos, and uploads pending batches. Once connected and bound to your Google account, optional **Auto-Sync** quietly keeps edits synced in the background.
3. **Add Your Free Gemini API Key:** Open **Settings → 2. Gemini Cloud & Playback**, create a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) *(free tier includes generous daily scans)*, and paste it in.
4. **Connect Discogs (+ Optional Spotify / Taste Profile):**
   - Open **Settings → 3. Discogs Account & Preferences**, generate a free Personal Access Token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers), paste it, and tap **🔗 Verify & Load Folders**. Tap **🔄 Sync with Discogs** (in Stash or Settings) anytime to pull your collection copies and mirror your Discogs folders; Stash also auto-refreshes quietly when returning to the app after 5 minutes.
   - Open **Settings → 4. Music Services & Taste Profile** to edit your **Taste Profile & Soft Spots** and optionally run **💚 Sync Liked Songs** (or **🎧 Full Library Pass** — resumable via **▶ Resume Spotify Sync** if paused or rate-limited).

---

## Upgrading & Domain Migration Notes

- **Update Both Phone & PC to v2.1.1:** v2.1.1 uses coalesced immutable versioned Drive batches (`ss_v2_batch_*.json`), automatically repairs verified duplicate Discogs copies, purges legacy false conflicts, and reads legacy v2.0.1 snapshots (`softspot_state.json` / `cratecheck_state.json`) and `delta_*.json` files as migration inputs. Update **both** your phone and PC to v2.1.1 for the cleanest two-device Drive sync.
- **Migrating a Local-Only Stash from an Old Domain:** Browser IndexedDB storage is scoped per origin (`https://old-domain` vs `https://softspot.k1s.co`). If you have an unsynced local-only Stash on an older domain:
  1. Open the old domain → **Settings → 5. Data, Backup & Workflow Guide** → tap **⬇️ Export JSON**.
  2. Open Soft Spot on the new domain → **Settings → 5. Data, Backup & Workflow Guide** → tap **⬆️ Restore JSON**.
  3. Optionally connect Google Drive and tap **🔄 Sync Now** to publish your restored profile to the cloud.

---

## Privacy & Security Architecture

- **100% Client-Side, Zero Backend:** Soft Spot is pure HTML, CSS, and Vanilla JavaScript with no server, no database, and no analytics. All requests go directly from your browser to Google Gemini, Discogs, Spotify, iTunes/Deezer, and Google Drive.
- **Strictly Sandboxed Google Drive Sync:** Cloud Sync uses **only** the `https://www.googleapis.com/auth/drive.appdata` scope — a hidden, app-specific sandbox folder inside your own Google Drive. Soft Spot **cannot see, read, or modify** any of your normal Drive files or folders.
- **Keys Stay Local by Default:** Your Gemini API key and Discogs token stay strictly in your browser's `localStorage`. Syncing API keys across your own devices is **OFF by default** (`Sync API Keys & Tokens across my devices`) and, when explicitly enabled, writes only to a separate `ss_v2_secrets_*.json` file inside your private `appDataFolder` — never mixed into normal Stash/photo batches. Rotating Spotify OAuth tokens and device-specific camera preferences stay strictly local.

---

## Self-Hosting Guide

Soft Spot requires **zero build step** and runs on any static host (such as GitHub Pages):

1. Fork or clone this repository and point GitHub Pages (or any static web server) at the active version directory (e.g., `v2.1.1/` or copied to root).
2. *(Optional)* Add a `CNAME` file for your custom subdomain (e.g., `softspot.yourdomain.com`) with HTTPS enabled (required for in-app Camera, Spotify PKCE, and Google Sign-In).
3. *(Optional)* To use your own Google Cloud OAuth Client ID for Drive Sync:
   - Enable the **Google Drive API** in [Google Cloud Console](https://console.cloud.google.com/apis/library/drive.googleapis.com).
   - Create an **OAuth 2.0 Client ID (Web application)** and add your exact `https://yourdomain.com` as an **Authorized JavaScript Origin**.
   - Open **Settings → 1. Google Drive Cloud Sync → Advanced: Self-Hosting / Custom Google Client ID** and paste your Client ID.

---

## Tech Stack

- **Core:** Plain HTML5, CSS3 (Sharp Monochrome Industrial UI, CSS Grid, `tabular-nums`), Vanilla ES6+ JavaScript — zero frameworks, zero bundlers.
- **Local Storage:** IndexedDB (`CrateCheckDB` with `stash` & `meta` stores for 1600×1600 WebP previews, cropped spines, Spotify checkpoints, Drive outbox, and collection indexes) + `localStorage` configuration & durable Discogs recovery ledger.
- **Cloud Sync:** Google Identity Services (GIS) Token Client + Google Drive API v3 (`spaces=appDataFolder`, immutable `ss_v2_batch_*.json` logs, SHA-256 hashed photo deduplication, deterministic per-field merge).
- **APIs:** Google Gemini REST API (`generateContent` with `MEDIA_RESOLUTION_ULTRA_HIGH`), Discogs API v2 (sliding-window burst queue + collection-instance folder moves), Spotify Web API (PKCE OAuth + single global rate-limit scheduler), iTunes Search API & Deezer JSONP (keyless 30s audio previews).
