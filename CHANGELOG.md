# Changelog — Soft Spot v2.3.0

## Highlights

1. **Two-Device Sync, Live-Row, Ownership & Backup Reliability**
   - Upgraded `pullFromGoogleDrive` Phase 2, `repairLocalDiscogsDuplicates`, and `queueFullLocalProfileToOutbox` to read & write `stash`, `deleted_sync_ids`, `sync_id_aliases`, `cloud_outbox_v2`, and `cloud_sync_meta_v2` inside ONE `readwrite` IndexedDB transaction so concurrent deletions in another tab can never be undone or lose tombstones.
   - Updated `saveStashEdits` to commit locally via `CC.mutateStashItemIfAlive` so items deleted while waiting on Discogs are never resurrected.
   - Added independent per-slot photo revisions (`field_revs['photo_slots.front']`, `field_revs['photo_slots.back']`, `field_revs['photo_slots.extras']`) so Phone replacing Front and PC replacing Back merge cleanly, while guarding `thumbs` derivation so older `photo_slots` never overwrite newer `thumbs` from v2.1.x devices.
   - Added a fresh Discogs account re-verification immediately before `CC.deleteDiscogsInstance` in `attemptDeleteOldCopy`.
   - Added deterministic `legacy_<hash>` fallback IDs in `CC.importJsonBackupAtomic` so legacy pre-`sync_id` JSON backups restore 100% idempotently without duplicates.
   - Applied the exact same staleness guard inside `regradeWithAI`'s `catch` block so failed Voice Re-Grades from a prior pressing never overwrite the current pressing's UI or retry memo.

2. **Smart Auto-Identify Photo Roles, Reliable Auto-Crop & Upright Spines**
   - Stopped assuming photo slot order in `runVisionOCR` and `autoCropImageWithGemini` — Gemini now identifies each photo's true visual role (`front`, `back`, `spine`, `extra`) and auto-slots staged photos cleanly.
   - Upgraded auto-crop to `thinkingLevel: 'MEDIUM'`, always requiring `[ymin, xmin, ymax, xmax]` (skipping canvas cropping only when the box already covers `>= 96%` of both width and height), explicitly checking **letter-top direction** (`top` → `0`, `bottom` → `180`, `left` → `90`, `right` → `270`) so upside-down spines rotate upright reliably, and avoiding redundant double crop passes.

3. **🧟 Franken-Copy Detector (Packaging vs. Physical Media Mismatch)**
   - `runVisionOCR` now reads `packaging_identity` and `media_identity` independently and flags `different_album`, `different_pressing`, or `different_format` mismatches.
   - Renders a high-visibility **`🧟 FRANKEN-COPY DETECTED`** warning banner defaulting Discogs search to physical media, pre-setting `No Cover` for wrong-album/format cases, offering **`📼 Verify Media (Default)`**, **`📦 Verify Packaging Instead`**, and **`💾 Also Save Orphan Packaging Locally`**, persisting `is_franken_copy`/`franken_type`/`franken_note`, and instructing `verifyCandidateBatch` never to ignore media-vs-packaging contradictions.

4. **📥 Offline Thrift Queue ("Save Now, Verify Later")**
   - Added **`📥 Save Now, Verify Later`** in the Single Item scanner (100% offline, zero AI/Discogs calls) saving staged photos, UPC, and format with `needs_verification: true`.
   - Added the **`⏳ To Verify`** Stash filter chip/badge and Stash Detail **`🔍 Verify & Price Now`** button that preloads saved photos & UPC straight back into the scanner and clears `needs_verification: false` on save.

5. **Stash Sorting, Group Headings, A–Z Scrubber & Streamlined Stash Tab**
   - Removed the 4 redundant action buttons from `#view-stash` and added a persisted Sort dropdown (`Newest Added`, `Artist A–Z`, `Title A–Z`, `Highest/Lowest Value`, `Highest Taste`, `Year Newest/Oldest`).
   - Added crisp monochrome Artist / Title group headings (ignoring leading `"The "`) and a fixed right-edge **`# A–Z` alphabet scrubber rail** supporting tap & thumb-drag smooth scrolling.

6. **Settings UI Uniformity, Dirty-State Buttons, Auto-Match Folders & Rebuild Workflow**
   - Removed `⬇️ Load from Google Drive`; unified full-width 50/50 `.btn-row` action bars across Settings #1, #2, and #3; added dirty-state disabling (`updateSettingsDirtyButtons`) for Gemini Save, Discogs Save, Taste Save, and Cloud Sync Now (with quiet focus/visibility pull when signed in and stale > 2 min).
   - Added **`✨ Auto-Match by Format`** (`value="auto"`) to Target Discogs Folder (`CC.resolveTargetDiscogsFolderId`).
   - Added **🔧 Rebuild & Sync Workflow** checklist + progress bar + Cancel inside Settings #5 (runs selected steps sequentially with zero AI grading and zero photo re-encoding, pausing cleanly on Spotify rate limits).

7. **Spotify 90s Cooldown, Exact vs. Alt-Version Matching, Compact Voice Re-Grade & DRY Consolidation**
   - Enforced `Math.max(90, headerSec || 90)` cooldown on Spotify HTTP 429 in `spFetch`.
   - Split track matching into `CC.normTrackEdition` (supporting double-hyphen remasters like `"Save a Prayer - 2009 - Remaster"`) vs. `CC.normTrackLoose` (alt-version fallback showing muted/blue `Alt Version` badges and `"Another version you like"` narrative), fixed grammar in `buildSpotifyHowYouKnowHtml`, and shared `getSpotifyLookup()` with Pile Scan.
   - Made Voice Re-Grade compact (`.btn-sm`) with an inline **`✕ Cancel`** button that stops listening with zero AI calls.
   - Consolidated `getPhotoQualitySpec()` across all rotate/crop/save paths (removing hardcoded `960`/`0.82` in `rotateStashSpine90`) and unified Taste prompt construction into `buildTasteEvaluationPrompt()` (`|v230`).
