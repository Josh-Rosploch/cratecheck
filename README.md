# 📼 Soft Spot

**Live App:** [softspot.k1s.co](https://softspot.k1s.co) · **Short Link:** [ss.k1s.co](https://ss.k1s.co)

A zero-backend, sharp monochrome industrial Progressive Web App (PWA) for scanning, verifying, grading, pricing, and cataloging physical media (**Cassettes, CDs, Vinyl, and Other Discogs Media** — 8-Track, Reel-To-Reel, MiniDisc, DAT, DVD, VHS, LaserDisc, Blu-ray, Shellac, SACD, and more) in the field at thrift stores/record shops or at home on phone and PC.

---

## Core Features (v2.2.0)

| Area | Highlights |
| --- | --- |
| **3-Shot Single Item Scan, Stable Photo Slots & 1x Main Camera** | Guided **Front + Side A → Back + Side B → Optional Spine** capture flow using **stable named slots** (`front` / `back` / `spine` / `extras` — deleting Back never shifts Spine or Extras), main **1x rear camera** locking with late-stream race guards, live `BarcodeDetector` UPC locking with **`✕`** clear-and-ignore, Sony-style red **Focus Peaking**, configurable **✂️ Auto-crop toggle** & **Photo Save Resolution** (`Low 800px` / `Medium 1200px` / `High 1600px` / `Very High 2400px` / `Raw Original`), full-res `#cropModal` parity with cumulative rotation, and a pre-save **Photos to Save** strip inside the Inspector. |
| **Multi-Shot Pile / Shelf Scanner** | Snap or upload **1–4 close-up shelf sections** at `3072px` ultra-high detail (`MEDIA_RESOLUTION_ULTRA_HIGH`) with smart overlap deduplication (`artist\|title\|format` + cat# guard), simultaneous **2-finger pinch + pan zoom**, rotated SVG polygon spotlights, progressive pin rendering, owned-collection badges, and non-blocking rough Discogs pricing. |
| **Drive-First Discogs Sync, Honest Outage Handling & Strict Account Ownership** | **Hard Format Gate** with ordered primary-format normalization (`CD + DVD` → `CD`, empty → `Unknown`), **Top-15 Fast Pass** + `[r=ID]` sibling traversal, honest marketplace outage handling (`Unavailable` instead of false `0 listed` / `SCARCE`), explicit user-triggered **🔄 Sync with Discogs** (gated on clean Google Drive sync), **📁 Move to Folder**, and strict **Discogs account ownership guards** across `Save Grade`, `Edit / Re-Check`, `Move to Folder`, `Retry Remove Old Copy`, and `Delete`. |
| **Clean Stash Photo Manager, Atomic Live-Row Edits & Lightbox Zoom** | Borderless sharp-corner Stash Detail gallery backed by synced named **`photo_slots`** (adding Back on an empty item never gets overwritten when adding Front later) and atomic live-row IndexedDB mutations (in-flight photo edits can never resurrect a deleted item); **📷 Manage Photos** reveals **➕ Add Photo** next to **✓ Done** plus compact **`🔄` / `✂️` / `↻` / `✕`** overlays; neutral monochrome placeholders appear for any unresolved Drive photo refs; fullscreen Lightbox supports **1x–6x mouse scroll-wheel zoom**, click-and-drag pan, touch pinch-zoom, and double-click `1x ↔ 2.5x`. |
| **All-Photo AI Grading & Verbatim Stamps** | Cloud-synced **"Grade in one go"** toggle (defaults to `Not Graded` for fast thrift scanning), one-tap **✨ AI Grade Photos** inspecting **every** labeled photo (`[Front]`, `[Back]`, `[Spine]`, `[Extra]`) downscaled to 2048px JPEG for reliable grading of punch/drill holes, saw cuts, cracked hinges, and **verbatim transcription** of ink/property stamps & handwritten markings, plus race-guarded continuous **🎤 AI Voice Re-Grade**. |
| **Personal Taste Engine, Remaster-Aware Spotify Matching & On-Release Priority #1** | Editable **Taste Profile + Soft Spots**, remaster/edition-aware local Spotify matching (`normTrackBase` matches e.g. `"Save a Prayer - 2009 Remaster"` ↔ `"Save A Prayer"`), **`💚 HOW YOU KNOW THEM`** narrative card leading with **`⭐ On this release:`** Liked Songs (and accurate compilation reporting), **Priority #1** Taste scoring for on-release Liked/Top tracks, distinct icons (**`🎧 Taste & Context`**, **`💚 HOW YOU KNOW THEM`**, **`▶️ Test Song:`**), batch Stash recalibration, and overlaid-art 30s audio previews with direct YouTube fallback. |
| **Safe Multi-Tab & Account-Isolated Google Drive Sync + Atomic Backups** | Private `drive.appdata` sync using single-transaction cross-tab atomic outbox updates, account-isolated batch uploads, full multi-snapshot discovery (reads every `softspot_state.json` / `cratecheck_state.json`), safe failed-photo retry (unresolved `gdrive:` refs stay intact without marking the batch applied), SHA-256 deduplicated photo blobs, and **v11 self-contained atomic idempotent JSON export/restore** (including tombstones & sync-ID aliases). |

---

## Quick Start (Phone + PC — ~2 Minutes)

1. **Open Soft Spot:** Visit **[https://softspot.k1s.co](https://softspot.k1s.co)** (or **[https://ss.k1s.co](https://ss.k1s.co)**) on Chrome (Android/Desktop) or Safari (iOS), and optionally tap **Add to Home Screen** to install as a full-screen PWA.
2. **Connect Google Drive:** Open **Settings → 1. Google Drive Cloud Sync** and tap **☁️ Connect Google Drive**:
   - **☁️ Connect Google Drive:** Signs in, identifies your Google account, and immediately loads your existing cloud profile, photos, spines, Taste Profile, Soft Spots, and applicable settings in one click. If Drive is empty and you already have local data, Soft Spot shows a clear empty-cloud status and waits for you to tap **🔄 Sync Now**.
   - **⬇️ Load from Google Drive:** Pulls and merges cloud updates locally with **zero Drive writes**, preserving local-only items and unsynced edits while retaining any competing edits for review.
   - **🔄 Sync Now:** Pulls, merges, uploads missing photos, and uploads pending batches. Once connected and bound to your Google account, optional **Auto-Sync** quietly keeps edits synced in the background.
3. **Add Your Free Gemini API Key:** Open **Settings → 2. Gemini Cloud & Playback**, create a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) *(free tier includes generous daily scans)*, and paste it in.
4. **Connect Discogs (+ Optional Spotify / Taste Profile):**
   - Open **Settings → 3. Discogs Account & Preferences**, generate a free Personal Access Token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers), paste it, and tap **🔗 Verify & Load Folders**. Tap **🔄 Sync with Discogs** in Settings anytime to pull your collection copies and mirror your Discogs folders (Google Drive automatically syncs first when connected so your photos and grades stay protected). Tap **☁️ Sync with Cloud** in Stash anytime to sync phone & PC.
   - Open **Settings → 4. Music Services & Taste Profile** to edit your **Taste Profile & Soft Spots** and optionally run **💚 Sync Liked Songs** (or **🎧 Full Library Pass** — resumable via **▶ Resume Spotify Sync** if paused or rate-limited).

---

## Upgrading & Domain Migration Notes

- **Update Both Phone & PC to v2.2.0:** v2.2.0 adds remaster-aware Spotify matching with On-Release Liked Songs as Priority #1, stable named photo slots (`front`/`back`/`spine`/`extras`), atomic live-row photo edits, single-transaction cross-tab & account-isolated Drive sync, strict Discogs account ownership guards, and atomic idempotent v11 JSON backups. Update **both** your phone and PC to v2.2.0 for the safest two-device sync.
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

1. Fork or clone this repository and point GitHub Pages (or any static web server) at the active version directory (e.g., `v2.2.0/` or copied to root).
2. *(Optional)* Add a `CNAME` file for your custom subdomain (e.g., `softspot.yourdomain.com`) with HTTPS enabled (required for in-app Camera, Spotify PKCE, and Google Sign-In).
3. *(Optional)* To use your own Google Cloud OAuth Client ID for Drive Sync:
   - Enable the **Google Drive API** in [Google Cloud Console](https://console.cloud.google.com/apis/library/drive.googleapis.com).
   - Create an **OAuth 2.0 Client ID (Web application)** and add your exact `https://yourdomain.com` as an **Authorized JavaScript Origin**.
   - Open **Settings → 1. Google Drive Cloud Sync → Advanced: Self-Hosting / Custom Google Client ID** and paste your Client ID.

---

## Tech Stack

- **Core:** Plain HTML5, CSS3 (Sharp Monochrome Industrial UI, CSS Grid, `tabular-nums`), Vanilla ES6+ JavaScript — zero frameworks, zero bundlers.
- **Local Storage:** IndexedDB (`CrateCheckDB` with `stash` & `meta` stores for 1600×1600 WebP previews, cropped spines, Spotify checkpoints, Drive outbox, and collection indexes) + `localStorage` configuration & durable Discogs recovery ledger.
- **Cloud Sync:** Google Identity Services (GIS) Token Client + Google Drive API v3 (`spaces=appDataFolder`, coalesced immutable `ss_v2_batch_*.json` uploads + backwards-compatible snapshot reading, SHA-256 hashed photo deduplication, deterministic per-field merge).
- **APIs:** Google Gemini REST API (`generateContent` with `MEDIA_RESOLUTION_ULTRA_HIGH`), Discogs API v2 (sliding-window burst queue + collection-instance folder moves), Spotify Web API (PKCE OAuth + single global rate-limit scheduler), iTunes Search API & Deezer JSONP (keyless 30s audio previews).
