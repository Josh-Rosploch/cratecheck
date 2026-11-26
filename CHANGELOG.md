# CrateCheck v2.0 Changelog

## Major Upgrades & Fixes
1. **Sharp Monochrome Industrial Redesign & Laser-Aligned Stash Grid**:
   - Enforced `0px` sharp corners across cards, buttons, inputs, selects, modals, badges, pills, thumbnails, audio bar, status banner, and tabs (retaining circular geometry only on the camera shutter, focus ring, and spinner).
   - Replaced navy/slate surfaces and AI gradients with pure neutral monochrome (`#0a0a0a` / `#121212` / `#1a1a1a` / `#2c2c2c` / `#444444`), reserving semantic colors strictly for status accents, badges, and key actions, with `tabular-nums` on numeric metrics.
   - Redesigned `.stash-item` with a laser-aligned 4-column data grid (`78px 62px 72px 1fr`: **Price** | **Taste** | **Grade** | **Sync Status**) aligned vertically down the entire Stash list.
2. **Hard Format Verification Gate, Top-15 Fast Pass & Smart Auto Format**:
   - Preserved Gemini's true visual `detected_format` (`Cassette` / `CD` / `Vinyl` / `Unknown`) without overriding it with the format filter, warning immediately on format mismatches.
   - Added **RULE #0 (Hard Format Gate)** to the verification prompt plus JS pre- and post-guards disqualifying wrong-format candidates (`Cassette ≠ CD ≠ Vinyl`) so a Cassette can never match a CD or Vinyl listing.
   - Applied detected visual format to Auto barcode searches (falling back to unfiltered only on 0 hits), raised `VERIFY_INITIAL_LIMIT` to **15**, and validated `candidate_diffs`, `eliminated_ids`, and `question.options` arrays before mutating `detectiveInspectedIds`.
3. **3-Shot Single Workflow, Spine Auto-Crop & Stash Spine-Shelf View**:
   - Updated Single-Item camera flow and preview tags to **Shot 1: Front + Side A**, **Shot 2: Back + Side B**, **Shot 3: Spine (Optional — Auto-Crops)**, **Shot 4: Extra Detail (Optional)**.
   - Added spine cut-out inspection (hole punches, saw cuts, notched corners, promo stamps) to OCR & grading prompts and automatic horizontal WebP cropping (`spine_thumb_url`, auto-rotating 90° when vertical) from Gemini's `spine_crop` box.
   - Added a **`LIST` | `SPINES`** toggle in Stash rendering a stacked horizontal spine shelf (using cropped spine photos or crisp monospace typographic strips).
4. **Camera Polish & Zero Browser Password Popups**:
   - Centered `#camShutterBtn` in a `1fr auto 1fr` grid, replaced camera `Done` with `✕`, and exposed all `videoinput` devices in `#camLensBtn` (defaulting to rear on open).
   - Eliminated Focus Peaking lag by requesting `1920x1080` live video (`ImageCapture.takePhoto()` still captures full native resolution), shrinking the peaking canvas to `160px`, reusing pre-allocated `Uint8Array` / `ImageData` buffers at ~8fps, and pausing `BarcodeDetector` while peaking is ON.
   - Replaced `<input type="password">` on `#cfgGeminiKey` and `#cfgDiscogsToken` with `type="text"` + `.secret-input` (`-webkit-text-security: disc`) + inline `Show/Hide` toggles to stop Chrome "Save password?" popups.
5. **Spotify Provenance & Weighting (Liked Songs > Saved Albums > Playlist-Only)**:
   - Upgraded `CC.syncSpotifyAll` to record per-artist `likedTracks`, `topTracks`, `albumTracks`, `playlistTracks`, `isTopArtist` and per-track `trackSources`, weighting Top/Liked tracks higher than Saved Albums and Playlists.
   - Upgraded `checkLocalSpotify`, Inspector/Stash badges (`💚 X Liked Songs` vs `📂 Playlist Only`), and Taste/Recalibration prompts so Playlist-Only matches are treated honestly as casual familiarity.
6. **Unset `Not Graded` Media Default & Multi-Shot Pile Dedup Fix**:
   - Added `'Not Graded'` as the first `CC.MEDIA_GRADES` option, defaulted ungraded scans to `'Not Graded'` (media & sleeve), and skipped writing `'Not Graded'` media (and empty notes when ungraded) in `CC.syncDiscogsInstanceFields`.
   - Updated `runPileScan` overlap deduplication to key by `artist|title|format` and never merge items with conflicting non-empty catalog numbers.
7. **Google Drive Cloud Sync (`appDataFolder`)**:
   - Added Google Identity Services sign-in using strictly sandboxed `https://www.googleapis.com/auth/drive.appdata`, header `#cloudPill`, and **1. ☁️ Google Drive Cloud Sync** accordion in Settings.
   - Implemented stable `sync_id`s, `deleted_sync_ids` tombstones, SHA-256 incremental photo blob sync (`img_<16hex>.webp` uploaded once and referenced via `gdrive:` in `cratecheck_state.json`), two-way merge across Stash/Spotify/Discogs index/prefs/optional secrets, and quiet debounced Auto-Sync.
8. **Version Bump**: Updated cache-busters (`?v=2.0`), header badge (`v2.0`), JSON backup (`version: 10`), and taste cache key (`v200`).
