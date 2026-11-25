# CrateCheck v1.8 Changelog

## Bug Fixes
- **Repaired all 15 corrupted Markdown API URLs in `apis.js`**: Restored clean URL strings for Gemini API, Apple Music / iTunes search, Deezer JSONP previews, Spotify OAuth + Web API sync/search, and YouTube fallback links.
- **Removed Local PC / Ollama Backend**: Stripped Ollama provider switching, URL/model settings, and fallback logic. Routed all AI requests directly to Gemini Cloud (`runGeminiRequest`) with infinite 5-second auto-retry and `✕ Cancel` for HTTP 500/502/503/504 and network errors (stopping immediately on hard 4xx errors). Legacy v1.7 Ollama `localStorage` keys are stripped safely on load.

## Upgrades
- **Recoverable Discogs Writes & Live Collection Duplicate Check**:
  - Pressing swaps during Stash edits now add the new verified pressing and sync its Media/Sleeve/Notes fields **before** deleting the old Discogs instance (old copy is never deleted if adding fails).
  - Editing to a different `discogs_id` and choosing **Save Local Only** clears the stale `discogs_instance_id`, sets `synced_to_discogs: false`, and flags `pending_discogs_sync: true`.
  - `syncDiscogsInstanceFields` now returns `{ okCount, failedCount, errors }` and surfaces warning toasts when any grade/note write fails.
  - `inspectCandidate` / `renderInspector` checks your live Discogs collection (`findDiscogsInstances`) in addition to Local Stash and displays an ownership alert if already owned on Discogs.
- **Full-Resolution + Autofocus 2-Shot In-App Camera**:
  - Upgraded to `ImageCapture.takePhoto()` when supported, with high-resolution video constraints, continuous autofocus (`focusMode: 'continuous'`), and tap-to-focus on the viewfinder.
  - Exports **2048px JPEG (0.90)** for Gemini Vision and **1200px WebP (0.80)** for IndexedDB Stash storage, while keeping live `BarcodeDetector` UPC scanning and canvas video fallback.
- **Zero-Guessing Verification Engine Upgrades**:
  - Raised automatic candidate sweep to **45 pressings** per run (plus up to 12 auto-followed `[r=ID]` siblings) with live Discogs rate progress updates.
  - Added strict **Photo-Scope / Loose-Tape Awareness** to Vision OCR and Verification prompts so missing cases/J-cards are recognized as loose media and never trigger unanswerable case/insert questions.
  - Added a **Conservative Tie-Breaker** that automatically selects the most common pressing (highest `community.have`) when multiple pressings match every visible shell clue and only differ by absent/uncheckable case or insert details.
- **Taste DNA & Niche Soft-Spots**:
  - `checkLocalSpotify` now matches both exact `(artist, track)` pairs and distinctive multi-word track titles (`>= 2` words and `>= 7` chars) across the synced library.
  - Added a hard rule forbidding Gemini from dismissing releases that match any artist or track in the user's Spotify library.
  - Added an editable **Soft Spots & Niche Pockets** field in Settings (stored alongside `tasteDna` in IndexedDB and preserved across syncs/backups) injected with equal first-class weight into Single and Pile taste scoring.
- **Faster, Non-Blocking Pile / Shelf Scan**:
  - Renders spines, Taste scores, and tap-to-highlight spotlight boxes immediately after OCR + batch Taste scoring without blocking on per-tape Discogs requests.
  - Lazily fetches Discogs pricing on tap or via a non-blocking **💰 Check Prices** background sweep, preserving real currency symbols/codes (`USD`/`EUR`/`GBP`/etc.), clearly labeling `Ask:` vs `VG+:` prices, and linking directly to Discogs Sales History.
- **Version Bump**: Updated cache-busters (`?v=1.8`), header badge (`v1.8`), JSON backup schema (`version: 8`), and taste cache key (`v18`).
