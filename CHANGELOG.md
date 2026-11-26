# Soft Spot v2.1.6 Changelog

Built from `./v2.1.5/` while strictly preserving `DESIGN.md` (`0px` sharp monochrome corners, pure achromatic dark palette `#0a0a0a`–`#242424`, borderless tonal elevation, dark PC scrollbars), IndexedDB (`CrateCheckDB`), and all `cratecheck_*` storage keys.

## What's New & Fixed

1. **Photo Settings: Auto-Crop Toggle & Save Resolution Picker (`index.html`, `apis.js`, `app.js`)**
   - Added synced preferences `autoCropPhotos` (default `true`) and `photoQuality` (default `'medium'`) inside **Settings → 2. 🤖 Gemini Cloud & Playback** (`Low 800px`, `Medium 1200px (Recommended)`, `High 1600px`, `Very High 2400px`, `Raw Original`).
   - Added shared `getPhotoQualitySpec()` wired across every save/crop path (`decodeBlobToPhotoPair`, `captureViewfinderShot`, `stagePhotoFiles`, `cropImageByBox`, `applyCropModal`, `handleStashPhotoFiles`), keeping Gemini AI payloads independently capped at `2048px` JPEG and preserving 1:1 native cropped/uncropped pixels in `raw` mode.

2. **Immediate Auto-Crop on Upload + Pre-Save Preview & Upgraded Crop Modal (`index.html`, `app.js`, `style.css`)**
   - Added shared fast `autoCropImageWithGemini(dataUrl, slot)` helper (`<= 1280px` JPEG) returning `box_2d` and upright `spine_rotation` (`0 | 90 | 180 | 270`).
   - Scanner uploads (`stagePhotoFiles`) and camera shots immediately auto-crop when `autoCropPhotos` is ON while retaining uncropped `origDataUrl` (and skipping redundant re-crops in `runVisionOCR`).
   - Added a **Photos to Save** preview strip inside `#inspectorCard` right above the Save buttons with per-photo **`✂️ Crop`** overrides against the uncropped original.
   - Added **`✨ Auto-Crop`** and **`Full Frame`** buttons to `#cropModal`, and updated Stash Detail single-photo uploads (Front / Back / Spine / Extra) to auto-crop and open `#cropModal` pre-framed for one-tap review (multi-file Extra uploads batch auto-crop and save directly).

3. **Concurrent Google Drive Sync & Cleanup Data-Loss Fixes (`apis.js`, `app.js`)**
   - Restored immutable `ss_v2_batch_<batchId>.json` (`POST`) uploads in `syncNowWithGoogleDrive` and disabled automatic remote Drive file overwrites/deletions so concurrent phone + PC syncs never drop or clobber another device's edits.
   - `pullFromGoogleDrive` now reads **all** present snapshots (`softspot_state.json` and `cratecheck_state.json`), skips already-applied `ss_v2_batch_*.json` files for faster pulls on synced devices (while still reading everything on fresh devices), leaves failed batch reads unapplied with `status: 'partial'`, and `syncWithDiscogsUI` strictly aborts if the Drive-first pull is partial or errored.

4. **Stale Settings Overwrite Fix (`app.js`)**
   - `saveSettings` snapshots synced preference values before mutating `CC.cfg` and only advances `cfgUpdatedAt` / queues a `prefs` outbox op when a synced setting actually changed.

5. **One-Tap Stash `☁️ Sync with Cloud` After Reconnect (`app.js`)**
   - After `syncStashWithCloudUI()` reconnects an expired Drive session, it now automatically continues into `syncGoogleDriveNow()` when pending local changes are queued.

6. **Camera Lens-Switch Recovery & Cleared UPC Cooldown (`app.js`)**
   - `bindStreamToViewfinder` immediately recovers via `openHighResCameraStream('')` (or cleanly closes & falls back) if switching away from a secondary/ultrawide rear lens fails after stopping the previous stream.
   - `clearStagedUpc` ignores the just-cleared barcode until it leaves the camera frame for 3 consecutive misses (~1.3s), while locking any *different* barcode immediately.

7. **Accurate Spotify `🎧 HOW YOU KNOW THEM` Liked Song Counts (`app.js`)**
   - `checkLocalSpotify` keeps `likedSongs` strictly from `likedTracks` when provenance is present, passing `topTracks` and `albumTracks` separately so `buildSpotifyHowYouKnowHtml` never counts top tracks or saved-album tracks as Liked Songs.

8. **Unambiguous Multi-Account Discogs Deduplication (`apis.js`)**
   - `dedupeAndMergeStashRecords` pre-scans all records per `(discogs_id, discogs_instance_id)` and only merges an unowned legacy row when **exactly one** unique normalized account exists; when 2+ different accounts exist, unowned rows stay unmerged and are flagged `discogs_link_ambiguous: true` regardless of input order.
