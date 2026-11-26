# Soft Spot v2.1.1 Changelog

## Critical Discogs Reliability & Safety Fixes
- **Discogs Account Guard on Delete:** `CC.deleteDiscogsAndStashCopy` now verifies `stashItem.discogs_account` against the active Discogs account before querying live instances and re-verifies before sending `DELETE`. In Stash Detail, synced copies belonging to a different Discogs account render **🗑️ Delete from Stash (Local Only)**.
- **Stopped Stash Detail Auto-Hydration Loop:** `needsDiscogsDetailHydration` no longer re-triggers on releases already stamped with `discogs_details_synced_at > 0` (including legitimately empty tracklists), and `openStashDetail` tracks per-session silent attempts (`autoHydrateAttemptedIds`) and avoids re-rendering on failed silent refreshes.
- **Last-Known Price Preservation:** `CC.hydrateDiscogsReleaseDetails` tracks `stats_ok` and `suggestions_ok` explicitly instead of swallowing `/marketplace/stats` failures. When marketplace stats fail, `CC.enrichSyncedDiscogsStashItems` preserves all previously saved price/value/scarcity fields untouched and surfaces a clear warning on manual Refresh.

## Google Drive Conflict & Outbox Cleanup
- **Genuine Cross-Device Conflicts Only:** Restricted conflict retention in `CC.mergeStashRecordsDeterministic` strictly to `CC.USER_CONFLICT_FIELDS` (`media_condition`, `sleeve_condition`, `condition_note`, `title`, `artist`, `catno`, `discogs_id`), silently preferring populated values over empty/ungraded values and ignoring same-device edits. All derived/hydrated/AI fields converge silently.
- **Startup False-Conflict Purge & Readable Formatting:** Added `CC.purgeFalseConflicts()` on startup to clear legacy false conflicts from Stash and `cloud_sync_meta_v2`, plus `formatConflictValue()` so arrays/objects never display `[object Object]`.
- **Outbox Coalescing:** Added `CC.coalesceCloudOutbox()` (runs on startup and before Drive upload) to compact queued batches per account into a single batch keeping only the latest op per `sync_id`/singleton key. `CC.enrichSyncedDiscogsStashItems` and `recalibrateStashBatch` now enqueue one combined batch per run/chunk instead of one per item.

## Photo Manager & Interactive Crop / 90° Rotate Modal
- **Simplified 4-Button Stash Photo Manager:** Replaced the 7 separate Camera/Upload buttons with 4 clean native file picker buttons (`Front`, `Back`, `Spine`, `Extra Photo`) without `capture` so Android offers Camera or Gallery and Desktop opens File Explorer cleanly.
- **Offline Interactive Crop & 90° Rotate (`#cropModal`):** Added a sharp-corner monochrome pure-Canvas cropper (touch & mouse drag/corner-resize, `↻ Rotate 90°`, `Reset`, `Apply Crop`) that opens automatically on manual Spine uploads (removing blind 90° auto-rotation) and via `✂️ Crop` on any Front/Back/Extra/Spine photo. Saves crisp WebP (`max 1200px` covers with no black padding bars; `max 960px` wide spines).
- **One-Tap `↻ 90°` Spine Rotation & Clean Copy-Paste:** Switched spine quick-rotate buttons from `↻ Flip 180°` to `↻ 90°` and set `alt=""` on `.photo-tile img`.

## Richer Batch Taste Recalibration & UI Polish
- **Full Taste Metadata in Batch Recalibration:** Lowered `BATCH_SIZE` to `10` (with up to 24 sample tracks per release) and populated `context_note`, `litmus_track`, `litmus_artist`, and up to 4 `notable_songs` alongside score/verdict/summary in a single atomic batch commit per chunk.
- **Audio Mini-Player Polish:** Overlaid `#audioPlayBtn` directly onto `#audioArt` inside a single `44px × 44px` sharp square and anchored `#openInMenu` inside `#audioBar` directly above `▲` on both desktop and mobile.
- **Live Gemini Retry Countdown & Smooth Spinner:** `runGeminiRequest` now counts down `5s → 4s → 3s → 2s → 1s` on network/5xx retries, and `renderBanner` updates text in place without resetting `.spinner`.
- Bumped cache-busters (`?v=2.1.1`), header badge (`v2.1.1`), and taste cache namespace (`v211`).
