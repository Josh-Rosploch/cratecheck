# Changelog — Soft Spot v2.3.2

## Bug Fixes

1. **Atomic Live-Row Taste Recalibration (Single + Batch) & Accurate Saved Counts**
   - Added `CC.mutateBatchStashItemsIfAlive(updatesList, changedFields, queueOutbox)` in `apis.js` running inside a single `readwrite` IndexedDB transaction under `withLocalCommitLock`, skipping deleted/tombstoned rows, patching only Taste fields onto live rows (preserving concurrent edits to notes, grades, or photos), and updating the dirty counter only after commit.
   - Updated `recalibrateSingleStashItem` and `recalibrateStashBatch` (`app.js`) to commit via atomic live-row mutations (`TASTE_FIELDS`), handle mid-run deletions cleanly, and increment `updatedTotal` only after IndexedDB commit succeeds.

2. **Discogs 429 Cooldown Account Recheck & Strict Legacy Removal Guard**
   - Extracted `assertUserBinding()` in `runDQueue` (`apis.js`) and enforced it before waiting, before the initial `fetch`, and again immediately after the 60s HTTP `429` cooldown before sending the retry `fetch` (while also recording `lastDCall`/`recentDCalls` and preserving `err.status` on retry failure).
   - Hardened `attemptDeleteOldCopy` (`app.js`) and `deleteDiscogsAndStashCopy` (`apis.js`) to refuse automatic remote deletion whenever a legacy synced record lacks both `discogs_account` and `discogs_instance_id`.

3. **Rebuild Workflow Prerequisite Gating & Honest Spotify Auth Reporting**
   - Added prerequisite gating in `runMaintenanceWorkflow` (`app.js`): if Step 1 (Drive pre-sync) is skipped/failed, Steps 4 (Discogs) and 6 (Drive push) are automatically skipped; if Step 2 (Spotify) does not complete, Steps 3 (Auto-Draft Taste) and 5 (Recalibrate) are skipped; if Step 3 fails/skips, Step 5 is skipped.
   - Inspected `spRes.reason` explicitly so `'auth_expired'` reports `"Spotify login expired — reconnect in Settings"` instead of a 90s cooldown, `'rate_limit'` reports the real cooldown duration, and `'cancelled'` aborts cleanly.

4. **Media Unverified Warning Whenever Physical Media Isn't Identified**
   - Added `media_visible` and `packaging_visible` to `runVisionOCR` and instructed Gemini never to copy packaging text into `media_identity` when the physical tape/disc is hidden or unreadable.
   - Evaluated `mediaReadable` vs. `pkgReadable` unconditionally so packaging-only scans trigger an amber **`⚠️ MEDIA UNVERIFIED (PACKAGING ONLY)`** warning banner pausing before Discogs search, with one-tap **`📷 Take Media Close-Up`** and **`📦 Search by Packaging Anyway`** actions (without marking packaging-only saves as Franken-Copies).

5. **String-Aware Gemini JSON Repair & Strict Root-Shape Validation**
   - Replaced global regex trailing-comma removal in `cleanJsonText(raw, opts)` (`apis.js`) with a character-by-character string-literal-aware repair pass (`inString`/`escaped`) that never mutates text inside double-quoted strings.
   - Added `expectedRootType` (`'object'` default — never falling back to an inner `[...]` array) and `validate` predicate checks (`Array.isArray(r?.scores)` / `Array.isArray(r?.items)`) wired through `runGeminiRequest` so shape mismatches trigger automatic retry.

6. **Hardened Scope-Isolated Offline Service Worker (`sw.js`)**
   - Scoped cache prefix & name by `self.registration.scope` (`softspot-shell-<scopeId>-v2.3.2`) so multiple installs/versions on the same origin never delete or collide with each other.
   - Opened `CACHE_NAME` explicitly for all cache reads/writes, fell back to cached shell on HTTP `5xx` server outages, removed `{ ignoreSearch: true }` for versioned `.js`/`.css` assets, and served version-locked `./index.html` for navigation fallbacks.

7. **Concurrent Extra-Photo 3-Way Union Merge & Stable Legacy Backup Identity**
   - Recorded `parentRev` on `photo_slots.extras` revisions in `CC.stampStashRevision` and updated `mergeStashRecordsDeterministic` so direct descendants honor intentional extra removals while concurrent different-device additions union cleanly via `mergePhotoListsUnique`.
   - Restricted `computeLegacyFingerprintSyncId` to immutable identity fields (`artist`, `title`, `format`, `catno`, `year`, `created_at`, `discogs_id`, `discogs_instance_id`) while preserving `#2`, `#3`, ... occurrence suffixes so edited re-exports merge cleanly without duplicating.

8. **Transaction-Safe Dirty Counter, Client ID Auto-Save & Doc Cleanup**
   - Moved `CC.setPendingCloudChanges(nextQueueLen)` in `reconcileDiscogsCollectionIntoStash` (`apis.js`) after `await CC.idbAtomicWrite(...)` resolves.
   - Added `onchange` scoped auto-save handlers to `#cfgGoogleClientId` (`cloud`) and `#cfgSpotifyClientId` (`music`) in `index.html`, bumped taste cache keys to `|v232`, and cleaned up stale Quick Start button names in `README.md`.
