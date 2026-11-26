# Changelog — Soft Spot v2.3.1

## Highlights

1. **Bulletproof Gemini JSON Parsing, Auto-Retry & Resilient Recalibration**
   - Upgraded `cleanJsonText()` (`apis.js`) to strip `<think>` blocks and code fences, extract outermost `{...}` / `[...]` spans, strip raw ASCII control characters, remove trailing commas before `}` / `]`, and throw `err.code = 'AI_JSON_PARSE'` on persistent malformed JSON.
   - Added automatic 2-retry recovery (1.5s delay with live status banner) in `runGeminiRequest()` whenever `finishReason === 'MAX_TOKENS'` or `cleanJsonText()` throws `AI_JSON_PARSE`.
   - Lowered `recalibrateStashBatch` chunk size from `10` to `5` (keeping `maxOutputTokens: 8192`) and added an automatic 1-item-at-a-time fallback whenever a 5-item chunk fails with `AI_JSON_PARSE`, continuing past any single bad item and reporting exact succeeded/failed counts.

2. **Contextual Stash Recalibrate Button & One-Tap Per-Item `🔄 TASTE`**
   - Added a contextual **`🔄 Recalibrate All (N)`** button inside `#view-stash` (hidden whenever `staleCount === 0`, shown automatically whenever stale items exist).
   - Converted every Stash card's stale **`🔄 TASTE`** badge into a clickable one-tap button calling `recalibrateSingleStashItem(id)` directly without opening the detail view.

3. **Rebuild Workflow: No Mid-Run Drive Pushes, UI Lockdown & Honest Step Reporting**
   - Suppressed `scheduleGoogleAutoSync()` during active Rebuild runs, cleared pending auto-sync timers on start, and passed `{ suppressAutoSync: true }` to Steps 2–5 (`syncWithDiscogsUI` also `{ skipDriveGate: true }`, `recalibrateStashBatch` also `{ skipConfirm: true }`) so Google Drive only executes in Step 1 and Step 6.
   - Added full Settings + Rebuild control lockdown and bottom-nav tab-switch protection while Rebuild runs (keeping **`✕ Cancel`** enabled and always unlocking in `finally`).
   - Replaced optimistic `100%` completion with honest per-step tracking (`completed` / `skipped` / `failed`), showing exact counts and yellow/red semantic bars whenever any step was skipped or failed.
   - Made the Rebuild action bar flex full-width so **`▶ Run Selected Steps`** spans 100% width when **`✕ Cancel`** is hidden.

4. **Franken-Copy Evidence Isolation & `⚠️ Media unverified` Warning**
   - Strictly isolated `fTitle`, `fArtist`, `fCatno`, `fLabel`, `fYear`, `fBarcode`, and `currentExtracted.cleaned_catalog_variants` in `'media'` mode (`runVisionOCR` and `switchFrankenVerifyMode`) so packaging clues never leak into physical media searches.
   - Added a prominent **`⚠️ Media unverified`** warning inside `#frankenBanner` when physical media text is unreadable while packaging is readable, preventing silent Discogs searches using mismatched packaging clues.

5. **Upgraded v2.2.0 Photo-Slot Revision Initialization**
   - Updated `CC.stampStashRevision` to initialize missing `photo_slots.front` / `back` / `extras` entries from `prevRecord`'s baseline timestamp/rev before stamping newly changed slot(s), ensuring concurrent Phone/PC photo edits on upgraded v2.2.0 records merge cleanly.

6. **Queue-Time Discogs Credential Binding**
   - Bound `boundToken` and `boundUser` at queue push time in `CC.discogsFetch()` and enforced live account/token verification inside `runDQueue()` before issuing `/users/...` requests so queued requests never fire against a switched Discogs account.

7. **Legacy JSON Restore: Preserve Distinct Copies + Stay Idempotent**
   - Expanded `computeLegacyFingerprintSyncId()` to include `condition_note`, `media_condition`, and `sleeve_condition`, and appended deterministic occurrence indices (`#2`, `#3`, ...) in array order in `CC.importJsonBackupAtomic()` so real duplicate legacy copies survive restore while re-importing the same file remains 100% idempotent.

8. **Scoped Settings Saves, Uniform Left-Side Order & Preserve `'auto'` Folder**
   - Placed **`Save Settings`** on the **LEFT** and **`🔗 Verify & Load Folders`** on the **RIGHT** in Settings #3 to match Settings #2 and #4.
   - Added `scope` support to `saveSettings(silent, scope)` so Gemini saves only commit Gemini/playback/photo fields and Discogs saves only commit Discogs fields.
   - Preserved `cfg.discogsFolderId === 'auto'` across Discogs collection sync (`reconcileDiscogsCollectionIntoStash`) and folder dropdown rendering (`populateFolders`).

9. **True Offline App-Shell Caching (Service Worker)**
   - Added `./sw.js` (`softspot-shell-v2.3.1`) with pre-cached app shell, network-first + offline cache fallback for same-origin shell assets, old cache cleanup, and third-party API exclusion, safely registered on load in `app.js`.

10. **Spine Re-Slot Crop Guard & Scanner Polish**
    - Added a dedicated `photo.spineCropped` flag set only after spine cropping/rotation so re-slotted spines in `runVisionOCR` always get cropped and rotated upright.
    - Updated `renderInspector` format-mismatch alerts to use `getEffectiveScanFormat()` + `CC.matchesMediaFormat()`, and delegated single-mode `removeCameraShot` deletions to `removeStagedPhoto`.
