# Soft Spot v2.0.3 Changelog

## 1. Discogs Copy Deduplication & Automatic Duplicate Repair
- Enforced verified physical copy identity (`normalized discogs_account + discogs_id + discogs_instance_id`, excluding mutable folder ID) across both Discogs reconciliation and Google Drive merge alongside Soft Spot `sync_id`s.
- Automatically repairs existing verified duplicate Stash entries (such as 20 Discogs copies doubled to 40 rows after independent phone/PC syncs) with **zero Discogs writes**, reporting a plain-language summary (e.g., *"Merged 20 duplicate Stash entries. 20 Discogs copies in Stash."*).
- Deterministic survivor selection (smallest `sync_id`) guarantees phone and desktop converge to the exact same survivor while preserving local photos, `gdrive:` photo references, spine orientation, notes, grades, verified Discogs folders, pending local folder moves, and competing conflict values for review.
- Persists retired-ID mappings in `sync_id_aliases_v1` (kept strictly distinct from intentional deletion tombstones in `deleted_sync_ids`) and propagates `retire_sync_id` ops in Drive v2 batches so stale snapshots, old queued batches, or previously offline devices reconcile newer edits into the surviving row without reviving duplicates.
- Keeps local-only items, ambiguous legacy links, and distinct owned copies of the same release (different `instance_id`s) untouched and separate.

## 2. Race-Free IndexedDB, Outbox & Drive Sync
- Added a local commit lock (`withLocalCommitLock`) serializing all local IndexedDB read-modify-write commits while keeping every network request strictly outside locks and transactions.
- Fixed the Drive pull overwrite race: `pullFromGoogleDrive` downloads remote batches and photos first, then reconciles against the **latest** local IndexedDB state at commit time so edits made during a delayed pull always survive.
- Fixed the outbox race: overlapping saves both persist locally and both append to `cloud_outbox_v2`, and acknowledging uploaded batches preserves any batch queued mid-upload.
- Read-only **Load from Google Drive** repairs the local view and queues any necessary duplicate-repair batch for the next write-capable **Sync Now** while making **zero** Drive writes itself.

## 3. Reliable Checkpointed Spotify Sync & Provenance
- Replaced shared `pageNum` counters with explicit per-stage progress tracking (`likedPage`/`likedOffset`/`likedDone`, `albumsPage`/`albumsDone`, `playlistsListPage`, `playlistIdx`/`playlistPage`, `skippedPlaylists`, and structured `lastError` with stage, HTTP status, and playlist name).
- Persisted `Retry-After` cooldown deadlines across reloads (`cratecheck_spotify_cooldown_v1` + checkpoint) with bounded fallback backoff; strictly blocks all Spotify Web API requests (including `/v1/me`) during cooldown and guards against overlapping runs.
- Individual playlist `403`/`404` responses are recorded as skipped while remaining accessible playlists complete and skipped names are reported at the end; playlist-list failures surface separately; expired logins (`401`) support reconnect-and-resume of the same saved run; checkpoints stay intact until the completed profile commits atomically to IndexedDB.
- `/me/tracks` remains the sole source of Liked Songs while real user playlists named `"Liked Songs"` stay eligible as playlists. Deduplicates repeated tracks within the same source using Spotify track IDs (falling back to normalized artist/title) without inflating taste weights, while preserving full cross-source provenance (Liked Songs, saved albums, top tracks, and playlists with names & IDs).
- Fully migrates and resumes existing v2.0.2 checkpoints (including checkpoints paused in the playlist stages).

## 4. Clear Spotify Controls
- Renamed **Full Library Pass** to **Sync Full Library** everywhere with a short scope description underneath, kept **Sync Liked Songs** and **Sync Full Library** together, and moved **Auto-Draft Profile** into the editable Taste Profile section.
- Gave **Resume Spotify Sync** a stable, always-visible location: disabled with explanation when idle, showing a live countdown during cooldown, and becoming the primary action when a checkpoint exists (with explicit confirmation before starting a fresh sync that would discard saved progress).
- Separated the active completed profile summary from live/paused sync progress.

## 5. Borderless Dark UI Polish
- Removed decorative 1px borders across cards, settings panels, buttons, inputs, tabs, pills, chips, menus, audio bar, status banner, and Stash items (including inline styles in HTML and JS-generated markup).
- Kept the dark Soft Spot palette with subtle tonal layering, modest corner radii, generous spacing, understated secondary button fills, prominent primary actions, visible keyboard `:focus-visible` outlines, comfortable touch targets, and crisp camera viewfinder guides.
