# CrateCheck v1.9.2 Changelog

## Fixes & Upgrades
1. **Spotify Sync Rate-Limit Fix (Proactive Throttle + Exponential Backoff + Cancel)**:
   - Added a dedicated `AbortController` (`CC.cancelSpotifySync()`, wired into `cancelActiveAI()` / `✕ Cancel`) so Spotify sync stops immediately on cancel.
   - Proactively throttled paginated Spotify requests and playlist sweeps (~350ms gap), deduplicated playlist IDs, and skipped 0-track playlists.
   - Fixed the infinite `pausing 3s...` 429 loop when CORS hides `Retry-After` by applying exponential backoff (`5s → 10s → 20s → 40s → 60s`) with a live ticking countdown and `{ cancellable: true }`.
2. **Unicode / Turkish Folding, Strict Artist-Bound Spotify Matching & Audio Previews**:
   - Added `CC.foldText(s)` (`ı` → `i`, `İ` → `I`, NFD diacritic stripping) inside `CC.norm` and `CC.normFull`.
   - Removed blind title-only Spotify track matching in `checkLocalSpotify`; every track match now requires BOTH artist (with leading `"the "` stripped) and track title to match, including compilation tracks formatted as `"Artist - Title"`.
   - Made `(radio)`, `(radio edit)`, `(single version)`, and `(edit)` lenient in `scoreAudioCandidate`, and added automatic fallback to parenthetical-stripped (`baseQ`) and ASCII-folded (`CC.foldText(baseQ)`) queries across Apple Music, Deezer, and Spotify.
3. **Two-Tier Discogs Verification (Fast Top-10 → Deep Search) & Club Anti-Hallucination Guard**:
   - Set default auto-verification to a fast **Top 10** pass (`VERIFY_INITIAL_LIMIT = 10` + up to 8 `[r=ID]` siblings) and added **`🔎 Deep Search`** (`runDeepDiscogsSearch()`) to sweep all remaining pressings in cached 25-item batches with `✕ Cancel`.
   - Preserved prior plausible hits so users are never stranded after a later batch returns `not_found`, always providing **`↩️ Back to Top Matches`** and **`View All X Matches`**.
   - Added `club_evidence` to Vision OCR and forced `club_edition = 'Unknown'` if `CRC`/`BMG` is guessed without quoted visible text from the photo.
4. **Stash Taste Recalibration & Stale Indicator**:
   - Recorded `taste_scored_at` on scored items and showed a subtle `🔄 Taste updated` badge whenever your Taste Profile or Spotify sync is newer than an item's score.
   - Added **`🔄 Re-Score`** inside Stash Detail (`recalibrateSingleStashItem`) and **`🔄 Recalibrate Taste`** in the Stash toolbar (`recalibrateStashBatch`, 20 items/call, cancellable with live progress).
5. **Durable Discogs Recovery Across Closes & Stricter Old-Copy Retention**:
   - Added `{ throwOnError }` to `CC.findDiscogsInstances` so transient lookup errors in `attemptDeleteOldCopy` never clear `pending_delete_old`.
   - Kept `pending_delete_old` untouched whenever **any** Media/Sleeve/Notes field write fails (`fieldRes.failedCount > 0`).
   - Added a durable `localStorage` ledger (`cratecheck_pending_discogs_v1`) that records intent before `POST`, saves `newInstanceId` immediately after `POST`, reconciles uncertain prior adds before re-POSTing, and clears only after IndexedDB save succeeds.
6. **Pile Pricing Mid-Sweep Fix & Crisp Spotlight Stroke**:
   - Refactored `fetchPileItemPrice` to take the item object directly and `fetchAllPilePrices` to iterate a snapshot (`pileResults.slice()`) so Taste re-sorting mid-sweep never skips or misassigns a tape.
   - Fixed `.pile-spotlight-stroke` double-shrinking by setting `stroke-width: 3px;` alongside `vector-effect="non-scaling-stroke"`.
7. **Version Bump**: Updated cache-busters (`?v=1.9.2`), header badge (`v1.9.2`), and taste cache key (`v192`).
