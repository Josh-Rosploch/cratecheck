# Changelog — Soft Spot v2.3.3

## Bug Fixes

1. **Require Both Verified Account & Exact Instance ID Before Discogs Delete**
   - Hardened `attemptDeleteOldCopy` (`app.js`) and `CC.deleteDiscogsAndStashCopy` (`apis.js`) to require BOTH a verified matching Discogs account AND a positive integer `instanceId` verified present on Discogs before issuing any remote `DELETE`—never guessing even when Discogs has 1 copy of the release.

2. **Strict Taste Score Validation + Stale Pressing/Profile Guard**
   - Added `parseValidTasteResult(raw)` (`app.js`) strictly validating finite `1..10` scores (never coercing `null`/`undefined`/`""`/`"N/A"` to `5/10`) and wired strict `validate` predicates into `runTasteAnalysis`, `recalibrateSingleStashItem`, and `recalibrateStashBatch` (including null-entry filtering on batch score maps).
   - Captured each item's pressing fingerprint (`discogs_id`, `artist`, `title`, `format`) and `startProfileTs` before calling Gemini, aborting/skipping writes inside `patchFn(liveRow)` if the pressing was replaced or the Taste Profile changed mid-flight.
   - Bumped Taste cache keys to `|v233`.

3. **CRDT Per-Photo Extra-Slot Tracking + Hydrate Before Merge**
   - Added `CC.getPhotoKey(src)` (`apis.js`) and per-photo `photo_slots.extra_added` / `photo_slots.extra_tombstones` CRDT maps in `stampStashRevision`, `dehydrateRecord`, and `mergeStashRecordsDeterministic` so Phone removing Extra A while PC adds Extra C converges cleanly to `[B, C]` without resurrecting A.
   - Hydrated remote `gdrive:` photo refs and CRDT key maps from `dlCache` in `pullFromGoogleDrive` **before** folding/merging against local rows so identical local and downloaded photos never duplicate.

4. **Stable Legacy Backup Identity Using Original Row ID**
   - Stamped `deviceId: CC.getDeviceId()` onto `exportJSON` payloads (`app.js`).
   - Updated `CC.importJsonBackupAtomic` (`apis.js`) to preserve `legacy_orig_id` / `legacy_source` and derive stable legacy IDs (`legacy_src_<hash>_id_<id>`, live `legacy_orig_id` + `created_at` match, or `legacy_id_<id>_c_<created_at>`) before falling back to fingerprint + `#occ`.

5. **Atomic Upgrade-Safe & Collision-Free Service Worker (`sw.js`)**
   - Hashed `SCOPE_PATH` to a deterministic hex `SCOPE_ID` (`s_<16hex>`) so paths like `/soft-spot/` and `/soft_spot/` never collide in cache prefixes.
   - Guarded runtime cache writes against half-upgraded offline shells: `./index.html` is only cached when it references `app.js?v=2.3.3`, `apis.js?v=2.3.3`, and `style.css?v=2.3.3`, and `.js`/`.css` assets are only cached when `?v=2.3.3` matches `SHELL_VERSION`.

6. **Rebuild Workflow Safeguard Hardening**
   - Treated `awaitingExplicitPublish`, `account_mismatch`, `partial`, or `!ok` from Step 1 (Drive pre-sync) as not completed, blocking Steps 4 and 6.
   - Passed `{ skipDriveGate: true }` to Step 4 (`syncWithDiscogsUI`) ONLY when Step 1 was checked and completed cleanly; when Step 1 is unchecked, Step 4 enforces its normal Drive-first gate.
   - Added immediate cancellation checks after every `await` (including Spotify token refresh) so cancelling during token renewal never launches library sync.

7. **Contradictory OCR `media_visible: false` Guard, 4-Photo Close-Up Fix & Offline Auto-Crop**
   - Enforced `mediaReadable = ext.media_visible !== false && isIdentityReadable(medId)` in `runVisionOCR` so `⚠️ MEDIA UNVERIFIED (PACKAGING ONLY)` triggers even if cover text is mistakenly echoed into `media_identity`.
   - Added `openMediaCloseUpCamera()` (`camReplaceSlotOnMax`) so `#frankenBanner`'s `📷 Take Media Close-Up` works cleanly even when 4 photos are already staged (replacing the last Extra or Back slot).
   - Passed `!isQueued` into `hydratePhotoPairFromSavedDataUrl` in `startEditStashItem` so offline-queued photos (`needs_verification: true`) have `autoCropped: false` and auto-crop cleanly once back online.

8. **Strict JSON Recovery (`cleanJsonText`)**
   - Attempted strict `JSON.parse(rawTrimmed)` before stripping `<think>` wrappers so literal `"<think>...</think>"` inside quoted strings is preserved verbatim.
   - Threw `AI_JSON_PARSE` immediately whenever valid parsed JSON has the wrong root type (e.g. root JSON array `[{...}]` when `expectedRootType === 'object'`), and restricted substring extraction to responses whose first structural character matches `expectedRootType`.
