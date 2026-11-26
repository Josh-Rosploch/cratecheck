# Soft Spot v2.1 Changelog

## Visual Design & Desktop Polish (`DESIGN.md`)
- **Restored Strict Sharp-Corner Borderless Neutral Monochrome Aesthetic:**
  - Enforced `border-radius: 0px` across all cards, panels, modals, buttons, inputs, selects, chips, badges, tracklist rows, audio mini-player, and global status banner (only functional circular camera guides—shutter button, focus ring, spinner—stay circular).
  - Purged all blue/indigo/slate/tinted dark surface washes (`#131316`, `#1c1c21`, `#142028`, `#171420`, `#0d1017`, etc.) back to pure achromatic neutral grayscale (`--bg: #0a0a0a`, `--well: #0d0d0d`, `--card: #121212`, `--card-2: #1a1a1a`, `--card-3: #242424`, `--text: #f3f3f3`, `--muted: #8a8a8a`) with zero decorative `1px` perimeter borders.
  - Replaced tinted alert/selection card fills with neutral tonal surfaces plus crisp left semantic accent bars (`inset 3px 0 0`).
- **Dark Monochrome PC Scrollbars:** Added `color-scheme: dark` and slim dark monochrome scrollbars (`#0a0a0a` track, `#2e2e2e` thumb, `0px` corners) globally and on `.chip-row` so bright white scrollbars no longer appear on Windows desktop browsers.
- **Added `DESIGN.md`:** Codified the permanent Soft Spot design rules (`0px` corners, pure neutral `R===G===B` grayscale surfaces, borderless tonal separation, dark scrollbars, semantic accent discipline).

## Discogs Sync Tracklist & Market Value Hydration
- **Fixed Empty Tracklists & Missing Values on Synced Discogs Items:**
  - Added `CC.hydrateDiscogsReleaseDetails` and `CC.enrichSyncedDiscogsStashItems` in `apis.js`.
  - Automatically hydrates `tracklist`, `country`, `pressing_notes`, `lowest_price`, `vg_plus_price`, `est_price`, `num_for_sale`, `have`, `want`, `is_high_value`, and `is_scarce` right after **Sync with Discogs** (deduplicated by `discogs_id`, cancellable, respecting the 58/min rate limit, and preserving local photos, spines, grades, notes, and Taste scores).
  - Auto-hydrates on demand when opening any Discogs-linked item in Stash Detail that is missing tracklist/values, plus adds a **🔄 Refresh Discogs** button in Stash Detail.

## Delete From Discogs & Stash (Synced) + Local-Only Support
- **Context-Aware Delete in Stash Detail (`CC.deleteDiscogsAndStashCopy`):**
  - Synced Discogs items now show **🗑️ Delete from Discogs & Stash**: confirms live Discogs copy & current folder (handling remote moves cleanly and refusing to guess on ambiguous legacy multi-copy items), deletes from Discogs FIRST, and then removes locally + tombstones to Google Drive so the deleted copy does not reappear on future Discogs syncs. If Discogs deletion fails, the local Stash item is kept intact.
  - Local-only / unlisted items remain fully supported and show **🗑️ Delete from Stash** (local delete + Drive tombstone, zero Discogs calls).

## Future-Proof Multi-Media Support (All Discogs Formats)
- Unified all vinyl variants (`LP`, `12"`, `7"`, `10"`, `Flexi-disc`, `Lathe Cut`, `Acetate`) under **Vinyl** while keeping **Cassette**, **CD**, and **Vinyl** as primary top-level controls.
- Added **Other ▾** format selector in Scanner, `<optgroup label="Other Discogs Media">` in Manual Search, and **Other Media** filter + dropdown in Stash supporting `8-Track Cartridge`, `Reel-To-Reel`, `MiniDisc`, `DAT`, `DVD`, `VHS`, `LaserDisc`, `Blu-ray`, `Betamax`, `UMD`, `Shellac`, `SACD`, `File` (FLAC/WAV/MP3), `Box Set`, and exotic Discogs format names across OCR, Hard Format Gate, Pile Scan, Discogs Sync, and Stash filtering.

## Migration & Compatibility
- Bumped cache-busters (`?v=2.1`), header badge (`v2.1`), and taste cache namespace (`v210`).
- Preserved `CrateCheckDB`, all `cratecheck_*` localStorage/sessionStorage keys, public Google OAuth Client ID, Drive `drive.appdata` sync, and v2.0.3 duplicate-copy repair.
