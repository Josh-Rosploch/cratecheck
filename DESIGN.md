# Soft Spot Design System (`DESIGN.md`)

This document defines the non-negotiable visual identity of **Soft Spot** (v2.1+). Every future revision must preserve these rules unless the owner explicitly requests a redesign.

---

## 1. Geometry — Strict Sharp Corners (`0px`)

- **Default corner radius is `0px` everywhere.**
  - Cards, panels, modals, buttons, inputs, selects, textareas, segmented controls, filter chips, pills, tags, thumbnails, album art, tracklist rows, audio mini-player, global status banner, and scrollbars MUST use `border-radius: 0px`.
  - Never soften or round rectangular UI surfaces (`border-radius: 4px`, `6px`, `8px`, `10px`, `999px` are forbidden on rectangular UI elements).
- **Only functional circular indicators may be `50%`:**
  - `.shutter-btn` (camera shutter button)
  - `.cam-focus-ring` (tap-to-focus viewfinder ring)
  - `.spinner` (loading indicator)

---

## 2. Color System — Pure Neutral Monochrome Dark Surfaces

- **All dark surfaces and neutral text MUST be pure achromatic grayscale (`R === G === B`).**
  - Never tint backgrounds, cards, modals, buttons, inputs, chips, or muted text with blue, indigo, slate, navy, or purple (`#0a0a0b`, `#131316`, `#1c1c21`, `#0f1117`, `#0d1017`, `#142028`, `#171420`, `#94949f`, `#cbd5e1` are strictly forbidden).
- **Canonical Surface Ramp:**
  - `--bg: #0a0a0a` — Page canvas
  - `--well: #0d0d0d` — Recessed wells, inputs, inset lists, photo trays
  - `--card: #121212` — Primary cards, headers, bottom nav, modals
  - `--card-2: #1a1a1a` — Secondary surfaces, pills, controls, hover states
  - `--card-3: #242424` — Active/selected controls, elevated hover surfaces
  - `--text: #f3f3f3` — Primary text
  - `--muted: #8a8a8a` — Secondary/helper text
- **Semantic Accent Discipline:**
  - Semantic colors (`--accent: #38bdf8`, `--green: #22c55e`, `--yellow: #f59e0b`, `--red: #ef4444`, `--purple: #a855f7`, `--spotify: #1db954`) are reserved **exclusively** for:
    - Text and status labels
    - Thin directional status bars (`inset 3px 0 0 <semantic-color>` or `2px` underline/top bar)
    - Primary action buttons / solid badges
    - Keyboard `:focus-visible` outlines
  - **NEVER** wash card, panel, alert, or selected-row backgrounds in tinted blue, navy, purple, green, yellow, or red fills. Selected or alerted containers stay neutral (`--card`, `--card-2`, or `--card-3`) with a crisp left semantic bar.

---

## 3. Elevation & Separation — Borderless Tonal Architecture

- **No decorative `1px` perimeter borders** around cards, buttons, pills, inputs, chips, list rows, or modals.
- Separate UI hierarchy using:
  1. Tonal surface steps (`--bg` → `--card` → `--card-2` → `--card-3`, and `--well` for recessed regions)
  2. Generous consistent spacing (`gap`, `padding`, `margin`)
  3. Subtle directional accent bars (`box-shadow: inset 3px 0 0 ...`) for status/selection states
- Exceptions:
  - Camera viewfinder framing overlays / focus ring / shutter ring (functional camera guides)
  - `:focus-visible` keyboard accessibility outlines
  - `border-top` / `border-bottom` only when truly needed for a table/header structural rule (prefer tonal background contrast first).

---

## 4. Scrollbars — Dark Monochrome on Desktop & Mobile

- Set `color-scheme: dark;` on `:root` / `html` so native controls and browser chrome never render light/white.
- Style all scrollbars (especially `.chip-row` and modal bodies) in slim dark monochrome with `0px` corners:
  - `scrollbar-width: thin; scrollbar-color: #2e2e2e #0a0a0a;`
  - `::-webkit-scrollbar` width/height `6px`, track `#0a0a0a`, thumb `#2e2e2e` (hover `#444444`), `border-radius: 0px`.
  - Never allow a bright white default OS scrollbar to appear on Windows/desktop browsers.

---

## 5. Typography & Layout

- Clean system sans-serif UI (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`), tabular numerals for prices/years/counts, and high-contrast legibility (`#f3f3f3` on `#0a0a0a`/`#121212`).
- Consistent spacing rhythm, predictable alignment across Stash grid cards, and zero layout jitter when banners or the audio mini-player appear.
