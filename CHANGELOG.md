# Soft Spot v2.0.2 Changelog

## Highlights
Soft Spot v2.0.2 focuses on reliable phone-to-PC workflows: safe two-device Google Drive sync, full Discogs collection & folder mirroring with in-place moves, larger uncropped 1600×1600 square previews with direct Stash photo management & manual 180° spine flipping, and resumable checkpointed Spotify syncing.

---

## 1. Clear Google Drive Actions & Account Safety
- **☁️ Connect Google Drive:** Signs in, identifies the account, and immediately awaits the single shared pull path (`CC.pullFromGoogleDrive`) — a fresh PC recovers an existing cloud profile, photos, spines, Taste Profile, Soft Spots, and applicable settings in one click. Shows a clear empty-cloud state when Drive has no profile and waits for an explicit **Sync Now** before publishing an existing local profile.
- **⬇️ Load from Google Drive:** Runs the exact same pull-and-merge path with **zero Drive writes**, preserving local-only items, queued edits, and retaining competing unsynced edits for review.
- **🔄 Sync Now:** Pulls, merges, uploads missing hashed photos, and uploads pending immutable batches. Auto-sync runs quietly after edits once connected and bound to that Google account, with in-tab serialization and automatic follow-up passes if edits arrive mid-sync.
- **Account-Switch Protection:** Detects when a different Google account signs in over existing local data, pauses uploads, and offers **Reconnect `<previous>`** or **Import Local Profile into `<new>`** without losing local records.
- **Credentials Security:** API keys/tokens remain opt-in (`googleSyncSecrets: false` by default), masked via `.secret-input` (zero `<input type="password">`), stored only in a separate `ss_v2_secrets_*.json` file when opted in, and never mixed into normal Stash/photo batches. Spotify OAuth tokens stay strictly local.

## 2. Immutable-Batch Two-Device Drive Sync
- Replaced destructive snapshot-rewrite / delta-deletion with immutable versioned batches (`ss_v2_batch_<batchId>.json`) in `drive.appdata` while continuing to read legacy `softspot_state.json`, `cratecheck_state.json`, and `delta_*.json` as migration inputs.
- Atomic IndexedDB transactions (`CC.commitLocalMutation`) persist each local edit alongside its outbox entry under a stable `batchId`. Retries reuse the same `batchId` idempotently and acknowledge only uploaded batches so edits made mid-upload remain queued.
- Deterministic per-record (`rev` / `parent_rev`) and per-field (`field_revs`) merge combines unrelated phone/PC edits cleanly, converges competing same-field edits deterministically while retaining the competing value for one-tap review in Stash Detail & Settings, and ensures stale edits never resurrect tombstoned deletions.
- Keeps Discogs authoritative for remote folder location via `discogs_folder_verified_at` so Drive sync never replays a completed Discogs move.
- Failed or missing photo downloads preserve any local copy and retain the `gdrive:` reference for later retry.

## 3. Sync with Discogs, Folder Mirroring & Move to Folder
- Standardized visible actions to **🔄 Sync with Discogs** across Stash toolbar, Stash empty state, and Settings.
- Auto-refreshes when opening Stash or returning to the app (`visibilitychange` / `focus`) with a 5-minute freshness window, single in-flight run per account, and existing 60/min rate limiting.
- Mirrors actual Discogs folders 1-to-1 in `#stashFolderRow` (excluding folder `0` "All", preserving empty custom folders, renames, and Uncategorized `1`), while keeping unsynced and removed copies under **Local Only**.
- Reconciles copies by canonical `(discogs_account, discogs_id, discogs_instance_id)` (excluding folder ID): new Discogs copies create rows, multiple copies of the same release stay distinct, remote moves update the existing row in place preserving `sync_id`, photos, spine, grades, and notes, and ambiguous release-only links surface for manual confirmation.
- **📁 Move to Folder** in Stash Detail moves linked copies in place via Discogs' collection-instance endpoint (preserving `instance_id` and `rating`, confirming source before moving and destination after, handling uncertain timeouts safely, and presenting both choices on 3rd-folder conflicts). Local-only items store an `intended_discogs_folder_id` locally with zero remote writes.
- Confirms missing copies live after a complete collection read before moving them to `Local Only` with a **Removed from Discogs** alert (preserving all local photos, spines, grades, and notes). Failed or partial collection reads leave existing rows untouched.

## 4. Larger Stash Photos, 1600×1600 Uncropped Square Previews & Spine Orientation / Flip 180°
- Added inline **📷 Add Photos** manager directly inside Stash Detail (take or upload Front, Back, Spine, or Extra; append by default plus explicit replace/remove) working completely offline with zero Gemini calls, zero Discogs writes, and zero grade changes.
- New Front/Back photos generate crisp `1600 × 1600` WebP previews fitting the entire uncropped image inside a square with neutral `#0d0d0d` padding (never cropping or stretching; existing saved photos remain intact; uncropped high-res JPEG stays intact for OCR/barcodes/spine cropping).
- Upgraded Stash Detail and single-item photo review (`#previewStrip`) to a responsive `.photo-gallery` showing 2 equal side-by-side square tiles for Front & Back (single cover capped at `420px`) with a full-width horizontal Spine strip below.
- Added OCR `rotation_hint` spine landscape normalization plus a visible **↻ Flip 180°** button in both single-item photo review and Stash Detail (works on legacy spines and without AI), preserving `spine_source_url` and syncing the rotated `spine_thumb_url` + `spine_flipped` across devices and the SPINES shelf.

## 5. Resumable Checkpointed Spotify Sync
- Added **💚 Sync Liked Songs** (fast default) alongside optional **🎧 Full Library Pass**.
- Routed all Spotify calls through a single global scheduler (`spFetch`) that honors `Retry-After` (with conservative backoff when unavailable), pauses other Spotify requests during cooldown, and bounds automatic retries.
- Persists page-by-page checkpoints (`spotify_checkpoint_v1`) scoped to account & sync mode so rate limits, cancellations, or reloads resume cleanly via **▶ Resume Spotify Sync** without repeating completed pages or overwriting an existing usable Spotify profile, Taste Profile, or Soft Spots.
