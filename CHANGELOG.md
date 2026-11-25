# CrateCheck v1.9.1 Changelog

## Targeted Fixes & Polish
1. **Per-Part `MEDIA_RESOLUTION_ULTRA_HIGH` + Clean 400 Fallback Cascade**:
   - Moved `MEDIA_RESOLUTION_ULTRA_HIGH` in `apis.js` (`runGeminiRequest`) from global `generationConfig` onto each `inline_data` image part (`mediaResolution: { level: 'MEDIA_RESOLUTION_ULTRA_HIGH' }`).
   - Added a 4-step HTTP 400 cascade: per-part `ULTRA_HIGH` + thinking → global `MEDIA_RESOLUTION_HIGH` + thinking → no `mediaResolution` + thinking → no `mediaResolution` + no thinking.
2. **Smooth Pinch-Zoom & Panning on Dense Shelves + Crisp SVG Outlines**:
   - Removed the `.pile-pin` early exit on `pointerdown` in `createZoomPanController` so 2-finger pinch-zoom and 1-finger panning work even when fingers land directly on numbered pins.
   - Replaced inline `.pile-pin` `onclick` handlers with `data-pile-idx`, distinguishing clean single-finger taps (`< 8px`, no multi-touch) from pans/pinches.
   - Added `vector-effect="non-scaling-stroke"` and zoom-compensated stroke width (`--zoom-scale`) to SVG spotlight polygons and circles so highlights stay crisp at 4×–6× zoom.
3. **Progressive Pile Scan Rendering + Ownership Badges**:
   - Renders all numbered pins, SVG overlay, `📀 Owned` badges (from Discogs Collection Index + Local Stash), and the Pull List immediately after OCR completes without waiting for Step 2 batch Taste scoring.
   - Runs Taste scoring non-blockingly, preserves the selected item across re-sorting, and keeps pins/prices/Verify usable with a `🔄 Retry Taste` button if Step 2 fails or is cancelled.
4. **Memory-Safe 24MP+ JPEG Decoding on Mobile Chrome**:
   - Added pure-JS `readJpegDimensions(blob)` (reading JPEG SOF markers + EXIF orientation from the first 128KB) so large 24MP–61MP camera JPEGs pass `{ resizeWidth, resizeHeight, resizeQuality: 'high' }` on the very first `createImageBitmap` call without allocating a full-size bitmap in RAM.
5. **Hardened Discogs Retries, Pending Field Sync & Multi-Copy Warnings**:
   - Cached `_pendingDiscogsAdd` on `currentInspected` so retrying after an IndexedDB save failure resumes without creating a duplicate Discogs copy.
   - Persisted `pending_field_sync` on Stash records; `retryRemoveOldDiscogsCopy` now finishes syncing fields on the new pressing before deleting `pending_delete_old`.
   - Fixed false-positive `"✅ Stash & Discogs updated cleanly!"` toast when a `sameRelease` edit finds `0` or `> 1` remote copies without a saved `instanceId`.
6. **Conservative Tie-Breaker Confirmation Carried Through Stash**:
   - Persisted `is_conservative_tiebreak` and `tiebreak_confirmed` on saved Stash records and enforced the same confirmation checkbox before `Push to Discogs` in Stash Detail.
7. **Clean Cloud Taste Prompts (Zero Raw Spotify Artist Dumps)**:
   - Removed the 150–200 raw Spotify `topArtists` fallback from ordinary Single and Pile cloud taste scoring prompts (relying strictly on the editable Taste Profile, Soft Spots, and per-release local match flags).
8. **Version Bump**: Updated cache-busters (`?v=1.9.1`), header badge (`v1.9.1`), and taste cache key (`v191`).
