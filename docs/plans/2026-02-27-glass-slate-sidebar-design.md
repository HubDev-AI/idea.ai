# Glass Slate + Sidebar Redesign

**Date:** 2026-02-27
**Replaces:** Obsidian Warmth theme (too warm, still felt like a generic dashboard)
**Goal:** Fundamentally restructure the layout from vertical-stack dashboard to sidebar app shell. Cool dark slate palette with electric teal accent. Glassmorphism filter bar.

## Layout Structure

```
+--sidebar(240px)--+--------main-content-area---------+
| logo/name        |  filter bar (sticky, glass)       |
|                  |  ---------------------------------|
| CONNECTORS       |  signal feed (full width, scroll) |
| - hn    *        |  signal row                       |
| - gh    *        |  signal row                       |
| - lever *        |  ...                              |
|                  |  pagination                       |
| AI AGENTS        |                                   |
| - claude         +--log-drawer-(collapsed)-----------|
| - codex          |  v Logs (12) LIVE                 |
|                  |  [expand to see entries]           |
| RESEARCH AGENT   |                                   |
| idle             |                                   |
|                  |                                   |
| TOP THESES       |                                   |
| - thesis 1       |                                   |
| - thesis 2       |                                   |
+------------------+-----------------------------------+
```

## Color System

| Token | Value |
|---|---|
| --bg | #13151a |
| --surface | #1a1d24 |
| --surface-2 | #22262e |
| --glass | rgba(255,255,255,0.04) |
| --glass-border | rgba(255,255,255,0.06) |
| --text | #e4e4e7 |
| --muted | #71717a |
| --accent | #2dd4bf |
| --ok | #4ade80 |
| --warn | #fbbf24 |
| --err | #f87171 |

## Typography

Geist Sans + Geist Mono (kept from previous). Sidebar labels: Geist Mono 0.65rem uppercase.

## Components

1. AppShell: sidebar + main wrapper
2. Sidebar: connectors, AI agents, research agent, theses (extracted from main flow)
3. FilterBar: sticky glassmorphism bar with source filter + thesis chips + pagination
4. LogDrawer: collapsible bottom drawer (36px collapsed, up to 40vh expanded)
5. Hero panel: removed, stats integrated into sidebar header
