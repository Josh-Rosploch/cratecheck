# CrateCheck v1.9.3 Changelog

## Fixes & Upgrades
1. **Global Floating Status Banner & Live Recalibration Buttons**:
   - Replaced the inline `#statusBanner` (Scan) and `#settingsStatusBanner` (Settings) with a single fixed floating `#globalStatusBanner` (`z-index: 78`) visible across Scan, Stash, Settings, and Stash Detail without scrolling.
   - Automatically docks above the bottom nav when the audio bar is hidden and directly above `#audioBar` when `body.has-audio` is active, while toggling `body.has-status` and lifting `.toast` above both when both are shown.
   - Updated `#btnRecalibrateStash` with live batch progress text (e.g., `⏳ Recalibrating 1–20 of 45...`) disabled until `finally`, and disabled/labeled `#sdBtnRescore` (`⏳ Re-Scoring...`) during single-item Stash Detail re-scoring.
2. **Active Play / Pause Indicator in Tracklists & Notable Songs**:
   - Added `data-play-key` to every Tracklist, Test Song, and Notable Song play button in both Single Inspector and Stash Detail.
   - Added `activeClipState` (`idle` / `loading` / `playing` / `paused`) and `syncTrackPlayButtons()` to highlight active rows and switch the matching button between `…`, `⏸`, and `▶` across `play`, `pause`, `ended`, clip loads, stops, and re-renders.
   - Tapping the play button of the currently loaded track now cleanly toggles play/pause (`toggleHighlightAudio()`) instead of restarting from `0:00`.
3. **Era- & Album-Aware Audio Preview Matching**:
   - Passed `targetYear` through `loadHighlightClip` → `CC.fetchAudioAndPlatforms` → `queryApple`, `queryDeezerJSONP`, and `querySpotifyExact` → `scoreAudioCandidate`, extracting candidate release years from Apple (`releaseDate`) and Spotify (`album.release_date`).
   - Raised `albSim` weight (`0.05` → `0.18`), added `+0.16` for era matches (`|candYear - targetYear| <= 2`), penalized `-0.24` for later releases (`candYear > targetYear + 5`) off the original album, and penalized `-0.26` for unrequested `re-record`, `live`, `acoustic`, `unplugged`, `anniversary`, or later parenthetical year tags while keeping standard `(Remastered)` tags on the original album unpenalized.
4. **In-Camera Photo Delete & Tap-to-Inspect Blur Check**:
   - Upgraded `#camThumbs` in the 2-Shot Viewfinder with `.cam-thumb-item` wrappers featuring a top-right `×` delete button (`removeCameraShot`) and tap-to-zoom inspection via `openStagedLightbox` above `#cameraModal` (`z-index: 98` vs `95`).
   - Deleting a shot inside the viewfinder immediately updates `#camStepBadge`, `#camCountLbl`, `#camThumbs`, and the staged preview strip.
5. **Serialized Discogs Saves, Cross-Path Ledger Recovery & Ambiguous Reconciliation Guard**:
   - Added an in-flight `activeDiscogsSaves` lock across `saveCurrentItem` and `pushStashToDiscogs` and disabled `#btnSaveBoth`, `#btnSaveLocal`, and `#sdBtnPushDiscogs` while saving to prevent duplicate Discogs `POST`s from overlapping taps.
   - Unified cross-path recovery so `saveCurrentItem(false)` ("Save Local Only") checks both `ledgerKey` and `rel:<discogs_id>` and attaches any already-`created` Discogs instance before clearing both keys on IDB success; `pushStashToDiscogs` also checks and clears both `stash:<id>` and `rel:<discogs_id>`.
   - Guarded `ensureDiscogsInstanceDurable` Case 2 reconciliation so if multiple new `instance_id`s appear remotely (`newlyCreated.length > 1`), it throws a clear error listing all new IDs instead of guessing `newlyCreated[0]`.
6. **Canceled Deep Search Retry Fix**:
   - Updated `verifyCandidateBatch` to track fetched IDs locally in `batchFetchedIds` (still populating `CC.releaseDetailCache`) and only merge into `detectiveInspectedIds` / `detectiveInspectedCount` after `CC.callAI` returns a usable, non-canceled verdict.
7. **Version Bump**: Updated cache-busters (`?v=1.9.3`), header badge (`v1.9.3`), and taste cache key (`v193`).
