# CrateCheck v1.9 Changelog

## High-Res Photo Upload Fixes
- **Memory-Safe 24MP+ Decoding & Descriptive Errors**: Rewrote `decodeBlobToPhotoPair` to use `createImageBitmap` with high-quality resizing (handling 6000x4000+ Sony/DSLR JPEGs smoothly on Android Chrome without canvas OOM), with graceful `Image()` fallback. Fixed `Photo error: undefined` by always rejecting with real `Error` messages containing filename, MIME type, and file size, plus explicit rejection of unsupported camera RAW files (`.arw`, `.dng`, `.cr2`, `.nef`, etc.).
- **Resolution Tiers & Ultra-High Gemini Media Resolution**: Single-item scans export **2048px JPEG (0.90)** for AI and **1200px WebP (0.80)** for Stash; Pile/Shelf scans export **3072px JPEG (0.92)** for AI (with `mediaResolution: 'MEDIA_RESOLUTION_ULTRA_HIGH'` and automatic HTTP 400 fallback) and **2048px WebP (0.82)** for crisp zooming.

## Modernized Pile / Shelf Scan
- **Shared Format Filter**: Moved `Auto / Cassette / CD / Vinyl` above the Single / Pile mode switch so format filtering applies to both Single and Pile scans.
- **Full-Res Camera & Auto-Analyze**: Pile Scan now uses the full-res `ImageCapture` + autofocus + tap-to-focus camera viewfinder (`openCameraViewfinder('pile')`) and automatically starts `runPileScan()` immediately after capture or photo upload (with Clear and Re-Analyze controls).
- **Dense-Shelf OCR & Front-Cover Support**: Supports Cassettes, CDs, and Vinyl (both spines and front covers/faces), scans systematically row-by-row/stack-by-stack for 60–100+ items, and raises Pile OCR `maxOutputTokens` to `16384`.
- **Rotated 4-Corner SVG Overlay + Zoomable Viewport + Fullscreen Modal**: Requests both center `point` and tight 4-corner rotated `poly` (with `box_2d` fallback). Displays uncluttered numbered center pins by default and dims/spotlights the exact rotated polygon on selection. Added Pointer Events pinch-to-zoom + 1-finger pan (`touch-action: none`) with `+` / `−` / `Reset` controls and a Fullscreen Pile Modal that keeps the SVG overlay and highlight bar attached.
- **Smarter Pile Taste Scoring & Clean Verify Flow**: Batch Pile scoring now evaluates both the specific album/release (era, style, studio vs compilation) and the artist instead of auto-boosting any artist in Spotify. Clicking `🔍 Verify This Tape` or `Verify ›` switches to Single mode cleanly with zero prefilled metadata and immediately launches the 2-Shot Camera while preserving the Pile tab.

## Streamlined Single-Item UI & Manual/ID Modal
- **Camera Finish & Search**: Changed Single-mode viewfinder's bottom-left button to **`🔍 Finish & Search (X)`** to close and immediately run `runFullScan()`, while keeping top-right `Done` to close without searching.
- **Cleaner Single Card & Modal**: Removed redundant standalone `Scan UPC` button in favor of a primary **`📷 Take Photos (2-Shot + Auto-UPC)`** button plus **`🖼️ Upload Photos`** and **`⌨️ Manual / Discogs URL`**. Replaced the inline `#extractCard` accordion with a clean **Manual Search & Discogs ID Modal** separating Section A (Discogs URL/ID) and Section B (Manual Search Fields).

## Honest Pricing, FX-to-USD Threshold & Collection Index
- **Honest Pile Pricing**: Stopped masking `/marketplace/stats` failures as `0 listed`; network/HTTP errors now surface `⚠️ Price unavailable · Tap to retry`. Pile prices are clearly labeled as rough estimates (`~Ask:` / `~VG+:`).
- **Currency-Aware High-Value Threshold**: Added `CC.toApproxUsd` (`USD, EUR, GBP, CAD, AUD, JPY, CHF, SEK, MXN, BRL, NZD, ZAR`) and `CC.formatMoneyWithUsd` so non-USD listings compare approximate USD against the High-Value threshold while showing original currency + `(~$XX)`.
- **Owned in Another Pressing Alert**: Added **🔄 Sync Discogs Collection Index** in Settings (paginating `/collection/folders/0/releases` into IndexedDB) so Inspector alerts on both exact pressing ownership and ownership of the same album in another pressing/format.

## Hardened Discogs Swaps, Honest Tie-Breaker & Clearer Taste Profile
- **Crash-Safe Add-First Swaps**: Persists the new `discogs_id`, `newInstanceId`, and `pending_delete_old` to IndexedDB **before** deleting the old copy; keeps the old copy untouched if all field writes fail or if multiple remote copies exist without a saved `instance_id`; preserves `pending_delete_old` across local-only edits for later Push to Discogs.
- **Honest Tie-Breaker Confirmation**: Conservative tie-breaker picks now return `likely_match` (`conservative_tiebreak: true`), display a yellow **`🎯 Likely Match (Most Common)`** badge, and require checking an explicit confirmation box before saving to Discogs.
- **Clearer Taste Profile Settings**: Put editable **Your Taste Profile** and **Soft Spots & Niche Pockets** front-and-center in Settings, clarifying that Spotify sync powers zero-AI local matching and **🧠 Auto-Draft Profile** is an optional one-time helper.
- **Version Bump**: Updated all references to `1.9` (`?v=1.9`, header badge `v1.9`, JSON backup `version: 9`, taste cache key `v19`).
