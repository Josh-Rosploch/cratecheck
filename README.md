# 📼 Soft Spot

**Live App:** [softspot.k1s.co](https://softspot.k1s.co) · **Short Link:** [ss.k1s.co](https://ss.k1s.co)

A zero-backend, sharp monochrome industrial Progressive Web App (PWA) for scanning, verifying, grading, pricing, and cataloging physical media (**Cassettes, CDs, Vinyl, and Other Discogs Media** — 8-Track, Reel-To-Reel, MiniDisc, DAT, DVD, VHS, LaserDisc, Blu-ray, Shellac, SACD, and more) in the field at thrift stores/record shops or at home on phone and PC.

---

## Core Features (v2.3.2)

| Area | Highlights |
| --- | --- |
| **Smart Photo Role Auto-ID, Reliable Auto-Crop & 1x Main Camera** | Guided **Front + Side A → Back + Side B → Optional Spine** capture flow using **stable named slots** (`front` / `back` / `spine` / `extras`) where Gemini **auto-identifies each photo's true role** (accidental Back-first snaps auto-slot cleanly!), reliable `MEDIUM`-thinking auto-crop that always frames physical media and inspects **letter-top direction** for upright spines, main **1x rear camera** locking with late-stream race guards, live `BarcodeDetector` UPC locking, red **Focus Peaking**, configurable **Photo Save Resolution** (`Low 800px` / `Medium 1200px` / `High 1600px` / `Very High 2400px` / `Raw Original`), and full-res `#cropModal` parity. |
| **🧟 Franken-Copy Detector & 📥 Offline Thrift Queue** | Independently inspects **Packaging** (J-card/jacket/insert) vs. **Physical Media** (cassette shell/disc/vinyl label) to catch wrong-album, wrong-pressing, or wrong-format Franken-Copies with one-tap **`📼 Verify Media (Default)`**, **`📦 Verify Packaging Instead`**, and **`💾 Also Save Orphan Packaging Locally`** actions + **`🧟 FRANKEN`** badges. In thrift stores without signal, tap **`📥 Save Now, Verify Later`** to queue photos & UPC 100% offline under **`⏳ To Verify`**, then tap **`🔍 Verify & Price Now`** at home to preload photos & UPC back into the scanner in one step. |
| **Multi-Shot Pile / Shelf Scanner** | Snap or upload **1–4 close-up shelf sections** at `3072px` ultra-high detail (`MEDIA_RESOLUTION_ULTRA_HIGH`) with smart overlap deduplication (`artist\|title\|format` + cat# guard), shared `getSpotifyLookup()` matching (so `"The Doors"` matches `"Doors"`), simultaneous **2-finger pinch + pan zoom**, rotated SVG polygon spotlights, owned-collection badges, and non-blocking rough Discogs pricing. |
| **Drive-First Discogs Sync, Auto-Match Folders & Strict Ownership** | **Hard Format Gate**, **Top-15 Fast Pass** + `[r=ID]` sibling traversal, honest marketplace outage handling (`Unavailable`), **`✨ Auto-Match by Format`** Target Discogs Folder (e.g., `Cassette` → `Cassettes`, `CD` → `CDs`), **📁 Move to Folder**, and strict **Discogs account ownership guards** (including a fresh account re-check immediately before old-copy deletion). |
| **Clean Sorted Stash, A–Z Scrubber & Atomic Photo Manager** | Streamlined Stash tab with persisted **Sort** (`Newest Added`, `Artist A–Z`, `Title A–Z`, `Highest/Lowest Value`, `Highest Taste`, `Year`), monochrome **Artist / Title group headers**, a fixed right-edge **`# A–Z` scrub rail** with tap & thumb-drag scroll, per-slot photo revisions (`photo_slots.front` / `back` / `extras`) so Phone & PC edits merge without clobbering, and atomic live-row IndexedDB mutations. |
| **All-Photo AI Grading & Compact Safe Voice Re-Grade** | Cloud-synced **"Grade in one go"** toggle, one-tap **✨ AI Grade Photos** inspecting every labeled photo with **verbatim transcription** of stamps & markings, plus a compact **🎤 AI Voice Re-Grade** bar with an inline **`✕ Cancel`** button that stops listening with zero AI calls. |
| **Personal Taste Engine, Exact vs. Alt-Version Spotify Matching & 90s Cooldown** | Editable **Taste Profile + Soft Spots**, strict **90-second** Spotify HTTP 429 cooldown with resumable checkpoints, two-tier track matching (`normTrackEdition` for double-hyphen remasters like `"Save a Prayer - 2009 - Remaster"` vs. `normTrackLoose` for live/acoustic/remix `Alt Version` badges), **`💚 HOW YOU KNOW THEM`** leading with **`⭐ On this release:`**, and **Priority #1** Taste scoring. |
| **Safe Multi-Tab Drive Sync, Maintenance Workflow & Atomic Backups** | Single-transaction `readwrite` Google Drive pulls/outbox reconciliation, quiet background pull on focus when stale > 2 min, uniform dirty-state Settings controls, **🔧 Rebuild & Sync Workflow** checklist + progress bar in Settings #5 (never grades or re-encodes photos), and **v11 self-contained atomic idempotent JSON export/restore** (with deterministic `legacy_<hash>` fallback IDs for pre-`sync_id` backups). |

---

## Quick Start (Phone + PC — ~2 Minutes)

1. **Open Soft Spot:** Visit **[https://softspot.k1s.co](https://softspot.k1s.co)** (or **[https://ss.k1s.co](https://ss.k1s.co)**) on Chrome (Android/Desktop) or Safari (iOS), and optionally tap **Add to Home Screen** to install as a full-screen PWA.
2. **Connect Google Drive:** Open **Settings → 1. Google Drive Cloud Sync** and tap **☁️ Connect Google Drive**:
   - **☁️ Connect Google Drive:** Signs in, identifies your Google account, and immediately loads your existing cloud profile, photos, spines, Taste Profile, Soft Spots, and applicable settings in one click. If Drive is empty and you already have local data, Soft Spot shows a clear empty-cloud status and waits for you to tap **🔄 Sync Now**.
   - **🔄 Sync Now:** Pulls, merges, uploads missing photos, and uploads pending batches. Once connected and bound to your Google account, optional **Auto-Sync** quietly keeps edits synced in the background (or tap the header **Cloud** pill anytime to check for remote updates).
3. **Add Your Free Gemini API Key:** Open **Settings → 2. Gemini Cloud & Playback**, create a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) *(free tier includes generous daily scans)*, and paste it in.
4. **Connect Discogs (+ Optional Spotify / Taste Profile):**
   - Open **Settings → 3. Discogs Account & Preferences**, generate a free Personal Access Token at [discogs.com/settings/developers](https://www.discogs.com/settings/developers), paste it, and tap **🔗 Verify & Load Folders**. Tap **🔄 Sync with Discogs** in Settings anytime to pull your collection copies and mirror your Discogs folders (Google Drive automatically syncs first when connected so your photos and grades stay protected). Tap the header **Cloud** pill or **Settings → 🔄 Sync Now** anytime to sync phone & PC.
   - Open **Settings → 4. Music Services & Taste Profile** to edit your **Taste Profile & Soft Spots** and optionally run **💚 Sync Liked Songs** (or **🎧 Full Library Pass** — resumable via **▶ Resume Spotify Sync** if paused or rate-limited).

---

## Upgrading & Domain Migration Notes

- **Update Both Phone & PC to v2.3.2:** v2.3.2 adds atomic live-row batch/single taste recalibration, Discogs 429 cooldown account rechecks and strict legacy deletion guards, Rebuild Workflow prerequisite gating with accurate Spotify auth-expiry reporting, unconditional `⚠️ Media unverified (packaging only)` detection, string-aware Gemini JSON repair with root-shape validation, scope-isolated offline service worker caching (`sw.js`), 3-way concurrent extra-photo union merges, and immutable legacy backup fingerprinting. Update **both** your phone and PC to v2.3.2 for the safest two-device sync.
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

1. Fork or clone this repository and point GitHub Pages (or any static web server) at the active version directory (e.g., `v2.3.2/` or copied to root).
2. *(Optional)* Add a `CNAME` file for your custom subdomain (e.g., `softspot.yourdomain.com`) with HTTPS enabled (required for in-app Camera, Spotify PKCE, and Google Sign-In).
3. *(Optional)* To use your own Google Cloud OAuth Client ID for Drive Sync:
   - Enable the **Google Drive API** in [Google Cloud Console](https://console.cloud.google.com/apis/library/drive.googleapis.com).
   - Create an **OAuth 2.0 Client ID (Web application)** and add your exact `https://yourdomain.com` as an **Authorized JavaScript Origin**.
   - Open **Settings → 1. Google Drive Cloud Sync → Advanced: Self-Hosting / Custom Google Client ID** and paste your Client ID.

---

## Tech Stack

- **Core:** Plain HTML5, CSS3 (Sharp Monochrome Industrial UI, CSS Grid, `tabular-nums`), Vanilla ES6+ JavaScript — zero frameworks, zero bundlers.
- **Local Storage:** IndexedDB (`CrateCheckDB` with `stash` & `meta` stores for user-configured WebP/Raw photos, cropped spines, Spotify checkpoints, Drive outbox, and collection indexes) + `localStorage` configuration & durable Discogs recovery ledger.
- **Cloud Sync:** Google Identity Services (GIS) Token Client + Google Drive API v3 (`spaces=appDataFolder`, coalesced immutable `ss_v2_batch_*.json` uploads + backwards-compatible snapshot reading, SHA-256 hashed photo deduplication, deterministic per-field merge).
- **APIs:** Google Gemini REST API (`generateContent` with `MEDIA_RESOLUTION_ULTRA_HIGH`), Discogs API v2 (sliding-window burst queue + collection-instance folder moves), Spotify Web API (PKCE OAuth + single global rate-limit scheduler), iTunes Search API & Deezer JSONP (keyless 30s audio previews).
