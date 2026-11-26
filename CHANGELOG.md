# CrateCheck v1.9.4 Changelog

## Fixes & Upgrades
1. **Audio Mini-Player Upgrades (Album Art, Alt-Version Auto-Play, Direct YouTube & Era-Safe Keys)**:
   - Added a compact 40×40 rounded album artwork thumbnail (`#audioArt`) to the left of `#audioBar` showing Discogs cover art or the staged photo (with format-aware vinyl/CD/tape icon fallback).
   - Split playback identity into `activeTrackBtnKey` (for tracklist/notable button highlights) and `activePlaybackKey` (including album + year) so selecting the same song title on a different album or year always fetches the era-matched recording.
   - Automatically loads and plays safe same-song alternate versions (`res.fallbackClip` when `safeAlt` passes) with a clear marquee label (`alt version — "..." unavailable`).
   - When a track has no 30s stream and no Spotify/Apple/Deezer links, hides `▲` and turns `#audioPlayBtn` into a direct red YouTube search button (`🔴`) + clickable marquee.
2. **Optional "Grade in One Go" Toggle + On-Demand AI Visual Grading**:
   - Added persisted `autoGradeOnScan` (default `false`) as a compact checkbox in the Single Item card (`🏷️ Grade in one go`) mirrored in Settings → 1. Gemini Cloud & Playback.
   - When OFF, `runVisionOCR` uses a faster OCR-only prompt, marks the grading badge `Not Graded Yet`, and exposes a prominent **`✨ AI Grade Photos`** button (`gradeCurrentPhotosOnDemand()`) inside the Inspector's Grading box whenever staged photos are present.
3. **In-App Camera Upgrades (Rear Lens Switcher, Focus Peaking & Pile Review)**:
   - Added rear camera enumeration + live lens switcher (`📷 1x` / `📷 Wide` / `📷 Cam N`, persisted in `preferredCameraId`) plus an ultrawide zoom toggle (`0.5x` / `1x`) when exposed by `caps.zoom`.
   - Added Sony-style red edge **Focus Peaking** (`🎯 Peak`, default OFF) using a throttled ~10fps Sobel gradient overlay on `#camPeakCanvas`, cleanly stopped on `hideCameraUI()`.
   - Kept the Pile camera open after each snap so users can review sharpness via tap-to-zoom lightbox, delete blurry shots, and capture 1–4 shots before tapping **`📚 Finish & Analyze (X)`**.
4. **Multi-Shot Pile / Shelf Scan (Up to 4 Sections + Overlap Dedup) & 2-Finger Pinch+Pan**:
   - Upgraded Pile Scan to `pilePhotos = []` (1–4 shots via camera or multi-file upload) with inline and fullscreen Shot Switchers (`📷 Shot 1`, `📷 Shot 2`, ...), sequential `3072px` ultra-high OCR per section, and smart `artist|title` overlap deduplication keeping richer metadata and better-centered geometry.
   - Tapping any item in the unified Pull List automatically switches to its shot (`photoIdx`) and spotlights it.
   - Upgraded `createZoomPanController` for simultaneous 2-finger pinch-zoom + 2-finger pan with focal-point zoom compensation around the pinch midpoint.
5. **Snapshot Discogs Saves & Folder-Safe Reconciliation**:
   - Captured an immutable tap-time `snap` in `saveCurrentItem` so async Discogs add, field sync, IDB put, and old-copy cleanup never read mutated globals or wipe a newly started scan (`scanRunId !== snap.scanRunIdAtTap`).
   - Updated `ensureDiscogsInstanceDurable` Case 2 reconciliation to match `existing.folderId` and throw a clear error if unseen copies appear in an unexpected folder.
6. **Strict Gemini Deep Search Verdict Validation**:
   - Validated `verdict.outcome`, `best_release_id` membership, and `needs_user` payload in `verifyCandidateBatch` before merging `batchFetchedIds` into `detectiveInspectedIds`, throwing on empty/invalid verdicts so candidates stay retryable.
7. **Version Bump**: Updated cache-busters (`?v=1.9.4`), header badge (`v1.9.4`), and taste cache key (`v194`).
