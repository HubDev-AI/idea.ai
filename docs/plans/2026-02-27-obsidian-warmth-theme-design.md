# Obsidian Warmth Theme Redesign

**Date:** 2026-02-27
**Goal:** Replace the cold navy "bootstrap" aesthetic with a warm, craft-quality dark theme inspired by Obsidian/Arc browser.

## Design Principles

1. **Warm neutrals over cold blues** -- background and surface colors are pure warm grays, no blue tint
2. **Elevation over borders** -- surfaces distinguished by background-color steps and shadow, not 1px outlines
3. **Characterful typography** -- Geist + Geist Mono replaces IBM Plex for a modern, distinctive feel
4. **Single warm accent** -- copper/amber (#d4a574) replaces cold blue throughout
5. **Balanced density** -- readable spacing, not wasteful, not cramped

## Color System

| Token | Old (Cold Navy) | New (Warm Obsidian) |
|---|---|---|
| --bg | #0c1016 | #161616 |
| --surface | #141a23 | #1e1e1e |
| --surface-2 | #181f2b | #252525 |
| --line | #2a3242 | #333 |
| --text | #e9edf4 | #ececec |
| --muted | #a6afbe | #888 |
| --accent | #9ec2ff | #d4a574 |
| --link | #9ec2ff | #d4a574 |
| --ok | #4fd18b | #5cb87a |
| --warn | #e8c16f | #d4a23e |
| --err | #ff7f7f | #c75c5c |
| --chip | #1f2735 | #2a2a2a |
| log-bg | #0e141d | #131313 |

## Typography

- **Sans:** Geist (400, 500, 600, 700)
- **Mono:** Geist Mono (400, 500)
- **Headings:** tighter tracking (-0.02em), weight 600-700
- **Labels:** Geist Mono uppercase, smaller sizes

## Surface Treatment

### Borders Removed
- Hero panel: border removed, soft shadow added
- Stat cards: individual borders+bg removed, become bare label/value pairs on hero surface
- Signal rows: individual card-style borders removed, become divider-separated list items
- Status cards: outer border removed, 2px top-accent stripe added
- Thesis cards: outer border removed, left accent stripe retained
- Log console: border removed, shadow added

### Borders Retained
- Dividers between sibling rows (border-bottom on signal rows, connector rows)
- Panel section separators (signal-header bottom border)

## Interactive States

- **Buttons:** background-color shift on hover, scale(0.97) on :active
- **Thesis hover:** background lighten, not border change
- **Thesis active:** left accent stripe becomes --accent
- **Expand toggle:** ghost button, bg appears on hover

## Scope

CSS-only rewrite of styles.css. No JSX restructuring. No new dependencies beyond the Geist font import. All data flow, polling, and component logic unchanged.
