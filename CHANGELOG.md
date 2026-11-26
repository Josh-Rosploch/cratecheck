# Soft Spot v2.0.1 Changelog

## Upgrades & Polish
1. **Built-In Public Google OAuth Client ID & Seamless Reconnect UX**:
   - Wired Soft Spot's public Google OAuth Client ID into `CC.DEFAULT_GOOGLE_CLIENT_ID` so Cloud Sync works out of the box with one tap (custom self-hosted Client ID + setup guide tucked cleanly inside a collapsed **Advanced: Self-Hosting / Custom Google Client ID** disclosure).
   - Flipped `googleSyncSecrets` default to `false` (explicit opt-in for security while preserving existing users' saved setting).
   - Passed `hint: CC.cfg.googleEmail` on Google token requests so returning users skip the account picker when reconnecting.
   - Added an unsynced local changes counter (`cratecheck_cloud_dirty_v1`) that updates `#cloudPill` to `☁️ Reconnect (X)` when changes are saved offline or while signed out.
   - Upgraded Google Drive sync to primary snapshot `softspot_state.json` (with automatic read fallback to legacy `cratecheck_state.json`) plus uniquely named `delta_<timestamp>_<rand>.json` batches merged and compacted before overwriting the snapshot so concurrent offline edits across devices never erase each other.
2. **Full Rebrand: "CrateCheck" → "Soft Spot"**:
   - Updated page `<title>`, header brand (`📼 Soft Spot v2.0.1`), dynamic PWA manifest (`Soft Spot — Media Scanner`), CSV/JSON export filenames (`softspot-stash-YYYY-MM-DD.csv`, `softspot-backup-YYYY-MM-DD.json`), and Settings workflow tip #1 (3-shot Front + Back + Spine flow).
   - Preserved `CrateCheckDB` IndexedDB name and `cratecheck_*` `localStorage` keys unchanged for 100% lossless migration of existing Stash items, photos, and settings.
3. **GitHub Landing Page (`README.md`)**:
   - Added a comprehensive repository-root `README.md` covering live app links (`https://softspot.k1s.co` / `https://ss.k1s.co`), core features, 2-minute user quick start, privacy/security architecture, self-hosting guide, and tech stack.
4. **Version Bump**: Updated cache-busters (`?v=2.0.1`), header badge (`v2.0.1`), and taste cache key (`v201`).
