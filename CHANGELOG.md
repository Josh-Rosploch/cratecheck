# Soft Spot v2.1.5 Changelog

Built from `./v2.1.1/` while strictly preserving `DESIGN.md` (`0px` sharp monochrome corners, achromatic neutral dark surfaces `#0a0a0a`–`#242424`, borderless tonal elevation, dark PC scrollbars), IndexedDB (`CrateCheckDB`), and all `cratecheck_*` storage keys.

## What's New & Fixed

1. **Single-File Google Drive Compaction & Sync Race Fixes (`apis.js`)**
   - **One-file `softspot_state.json` compaction:** `syncNowWithGoogleDrive` uploads ONE compacted `softspot_state.json` snapshot containing merged `stash` (dehydrated `gdrive:` photo refs), `tombstones`/`deleted_sync_ids`, `sync_id_aliases`, `spotify_profile`, `discogs_index`, and `prefs`. Only **after** the new snapshot upload succeeds are absorbed `ss_v2_batch_*.json` and legacy `delta_*.json`/`cratecheck_state.json` files deleted from `appDataFolder`.
   - **Outbox race fix:** `coalesceCloudOutbox` preserves newer `delete_stash` tombstones against older `upsert_stash` entries and merges multiple upserts for the same `sync_id` field-by-field; `enrichSyncedDiscogsStashItems` re-reads live IndexedDB state & tombstones before queuing updates.
   - **Intentional clear / `Not Graded` reset preservation:** `mergeStashRecordsDeterministic` respects explicit edit timestamps (`_fieldMeta` / `field_revs`) so clearing notes or resetting a grade to `Not Graded` is no longer overwritten by older populated values.

2. **Drive-Before-Discogs Sync Order, Stash `☁️ Sync with Cloud`, & No Auto Discogs Imports (`index.html`, `app.js`, `apis.js`)**
   - Replaced Stash's `Sync with Discogs` button with **`☁️ Sync with Cloud`** (`#btnStashSyncCloud`), keeping **`🔄 Sync with Discogs`** exclusively in **Settings → 3. Discogs Account & Preferences**.
   - Added a **Drive-first safety gate** on `syncWithDiscogsUI`: when signed into Google Drive, Drive syncs first before Discogs runs (aborting Discogs if Drive fails); if Drive was configured but signed out/expired, Discogs sync is blocked with a clear prompt; local-only users proceed normally.
   - Removed all automatic background Discogs imports (`switchView('stash')`, `visibilitychange`, `focus`, and post-verify auto-sync) so Discogs only syncs when explicitly triggered by the user.
   - Added a `discogs_instance_id` deduplication safeguard in `dedupeAndMergeStashRecords` so duplicate copies merge while preserving photos, spines, grades, and taste data.

3. **All-Photo AI Grading + Verbatim Stamps & Spine Inspection (`app.js`)**
   - `runVisionOCR` (when grading), `gradeCurrentPhotosOnDemand`, and `regradeWithAI` now send **every** labeled photo (`[Front]`, `[Back]`, `[Spine]`, `[Extra ...]`) via `buildLabeledGradingImageParts`.
   - Prompts explicitly require inspecting `[Spine]` for punch holes, drill holes, saw cuts/notches, cracked hinges, and fading/creases, plus **verbatim transcription** of notable ink stamps, radio/club property stamps, stickers, and handwritten markings.

4. **Auto-Cropped `1600px` Scan Photos, Upright Spines & No Duplicate `Extra 1` Spine (`app.js`, `apis.js`)**
   - `runVisionOCR` requests normalized `photo_crops` bounding boxes (`[ymin, xmin, ymax, xmax]`, `0–1000`) and exact upright `spine_rotation` (`0 | 90 | 180 | 270`) to auto-crop all staged covers to `1600px` WebP (quality `0.85`) and upright spines to `1200px` wide (with manual `✂️` tweak still available on staged thumbnails).
   - Dedicated Spine slot (index `2`) is stored strictly in `spine_thumb_url` / `spine_source_url` and never duplicated into `thumbs` (`Extra 1`).

5. **Main 1x Rear Camera Locking & Clear UPC Button (`style.css`, `app.js`)**
   - Camera startup picks the primary 1x rear lens (excluding ultrawide/wide/0.5x/0.6x/macro/tele/depth/IR/ToF devices, preferring `camera2 0, facing back`), requests `3840×2160` ideal resolution, and resets `zoom: 1.0` when `caps.zoom.min < 1`.
   - Added a direct **`✕`** button on `#camUpcBadge` in the live camera HUD to clear a mis-scanned barcode without closing the camera.

6. **Clean Stash Detail Photo Manager (`app.js`, `style.css`)**
   - Normal Stash Detail view displays crisp, uncluttered cover tiles and spine strip with zero floating edit/crop/rotate buttons.
   - Removed the bulky `.sd-photo-panel` dropdown; **`📷 Manage Photos`** toggles Manage Mode, revealing **`➕ Add Photo`** (inline `Front / Back / Spine / Extra` menu) right next to **`✓ Done`** and compact sharp-corner **`🔄` / `✂️` / `↻` / `✕`** overlay actions directly on every tile and spine.

7. **Fullscreen Lightbox Scroll-Wheel Zoom & Pan (`index.html`, `style.css`, `app.js`)**
   - Added smooth `1x–6x` mouse scroll-wheel zoom toward cursor, click-and-drag pan when zoomed, touch pinch-zoom & drag, double-click / double-tap `1x ↔ 2.5x` toggle, and automatic transform reset on slide switch or close.

8. **Spotify `🎧 HOW YOU KNOW THEM` Narrative Card (`apis.js`, `app.js`, `style.css`)**
   - Spotify sync now records followed artists (`user-follow-read`, graceful fallback) and per-playlist track lists (`playlistTrackMap`).
   - Replaced cryptic Spotify pills in Scan Results and Stash Detail with a clear **`🎧 HOW YOU KNOW THEM`** paragraph card covering 1–3 liked songs (naming every song), 4+ liked songs (count + examples + followed/playlists), playlist-only (0 liked songs explicitly stated), exact album-track hits, Various Artists compilations, and no-match fallback.
