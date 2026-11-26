# Changelog — Soft Spot v2.2.0

## Highlights

1. **Spotify Remaster/Edition Matching, On-Release Priority #1 & Distinct Section Emojis**
   - Added `CC.normTrackBase(title)` to strip parenthetical/bracketed tags and trailing hyphenated release/edition suffixes (`- 2009 Remaster`, `- Radio Edit`, `- Single Version`, `- Mono`, `- Stereo`, `- Bonus Track`, etc.) so Spotify tracks like `"Save a Prayer - 2009 Remaster"` match Discogs tracklists like `"Save A Prayer"`.
   - Indexed and matched both exact normalized titles and base titles in `getSpotifyLookup` and `checkLocalSpotify`, merging provenance flags across variants.
   - Updated **`💚 HOW YOU KNOW THEM`** to lead with **`⭐ On this release:`** (Liked Songs first, then Top/Saved-Album/Playlist hits) and fixed the Compilation branch so followed/top artists with 0 Liked Songs are never listed under `"Featured artists you have liked songs from"`.
   - Added **HARD RULE #0** across `runTasteAnalysis`, `recalibrateSingleStashItem`, and `recalibrateStashBatch` (bumping taste cache key to `|v220`) making on-release Liked Songs / Top Tracks the #1 KEEP signal.
   - Split section icons cleanly into **`🎧 Taste & Context`**, **`💚 HOW YOU KNOW THEM`**, and **`▶️ Test Song:`**.

2. **Stable Named Photo Slots, Full-Res Crop Parity & AI Grading Payload Cap**
   - Replaced positional scanner photo arrays with stable named `stagedSlots` (`front`, `back`, `spine`, `extras`) so removing `back` never shifts `spine` or `extras`, and camera capture fills the first empty slot cleanly.
   - Added synced `photo_slots: { front, back, extras }` to Stash records (migrating legacy `thumbs` via `CC.normalizePhotoSlots` and deriving `thumbs` / `thumb_data_url` via `CC.deriveThumbsFromSlots`). Edit/Re-Check now merges per-slot so untouched photos survive.
   - Upgraded `#cropModal` to slice directly from `origImg` with cumulative `rotationDeg` before scaling once to `cfg.photoQuality`, tracked `rotationDeg` on staged slots, rethrew `AbortError` in `autoCropImageWithGemini`, and honored `batchAutoCropCancelled` across multi-photo auto-crop loops.
   - Downscaled all Stash grading images via `renderDataUrlToCompactJpegB64(src, 2048, 0.88)` inside async `buildLabeledGradingImageParts`.

3. **Atomic Live-Row Photo Mutations & Safe Multi-Tab / Account-Isolated Drive Sync**
   - Added `CC.mutateStashItemIfAlive` so every Stash photo add/replace/crop/rotate/remove re-reads the live row, tombstones, and outbox inside one `readwrite` transaction and aborts cleanly if the item was deleted while editing.
   - Converted outbox updates in `commitLocalMutation`, `commitBatchStashUpserts`, `coalesceCloudOutbox`, `reconcileDiscogsCollectionIntoStash`, `enrichSyncedDiscogsStashItems`, and `syncNowWithGoogleDrive` to read and write inside a single `readwrite` IndexedDB transaction.
   - Hardened Google Drive pulls/uploads: reads **all** present `softspot_state.json` / `cratecheck_state.json` snapshots oldest-to-newest, preserves unresolved `gdrive:` refs (with neutral `.photo-unresolved-ph` placeholders in UI) without marking batches applied when photo downloads fail, treats non-empty outbox queues as local data in account mismatch detection, and isolates batch uploads strictly to the active Google account.

4. **Strict Discogs Account Ownership Guards**
   - Added `isOwnedByActiveDiscogsAccount` guards across `saveStashEdits`, `saveCurrentItem`, `moveStashItemFolder`, `retryRemoveOldDiscogsCopy`, and `attemptDeleteOldCopy`.
   - `saveStashEdits` blocks remote writes for copies owned by another Discogs account and commits locally before declaring full success.
   - `saveCurrentItem` preserves verified `discogs_account` and `discogs_folder_verified_at` on local-only saves, and stamps `account` onto `pending_delete_old` so `attemptDeleteOldCopy` verifies exact `instanceId` and account ownership before deleting.

5. **Async Race Guards, Honest Discogs Outages, Format & Pref Sync Fixes**
   - Added sequence/race guards for late camera streams (`camOpenSeq`), pressing selection (`inspectSeq`), staged photo imports (`stageSeq`), and voice re-grading (`regradeWithAI`).
   - Updated `inspectCandidate` to track `statsOk` on `/marketplace/stats/:id` and display `Unavailable` (with `isScarce = false` and `discogs_details_synced_at = 0`) during Discogs stats outages instead of false `0 listed` / `SCARCE`.
   - Fixed `CC.normalizeDiscogsFormat` to return `'Unknown'` when empty and evaluate primary entries in order (skipping `'Box Set'` / `'All Media'`) so `CD + DVD` resolves to `'CD'`.
   - Fixed `toggleAutoGradeOnScan` to bump `cfgUpdatedAt`, queue a `prefs` outbox batch, and trigger `scheduleGoogleAutoSync()`.

6. **Atomic Idempotent JSON Restore & Self-Contained v11 JSON Export**
   - Upgraded `exportJSON` to `version: 11` including `deleted_sync_ids`, `sync_id_aliases`, automatic Drive hydration when signed in, and an `unresolvedDrivePhotos` count/warning.
   - Upgraded `importJSON` (backed by `CC.importJsonBackupAtomic`) to separate JSON parse/schema errors from IndexedDB write errors and perform a single-transaction, 100% idempotent merge preserving original record revisions/timestamps and deduplicating copies.
