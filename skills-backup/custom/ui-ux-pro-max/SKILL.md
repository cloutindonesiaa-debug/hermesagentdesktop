---
name: ui-ux-pro-max
description: AI-powered design intelligence — 67 UI styles, 161 color palettes, 57 font pairings, 99 UX guidelines. Use when building landing pages, dashboards, or any web UI for local business clients.
trigger: "Load together with popular-web-designs for combined design references. Use for premium UI/UX patterns, component inspiration, and design system layering."
version: 1.2.0
author: NextLevelBuilder (installed via hermesatlas)
platforms: [html-tailwind, react, nextjs, vue, svelte, flutter, react-native, swiftui]
---

# UI/UX Pro Max

Design intelligence for building professional landing pages and web UIs.

## Script Path

**Important:** The search script lives at:
```
~/.hermes/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py
```

Do NOT use `skills/ui-ux-pro-max/scripts/search.py` — that path is wrong and will fail.

## Prerequisites

Dependencies (already installed on this system):
```bash
uv pip install rich fire pandas tqdm
```

## Design System Generator (start here)

```bash
python3 ~/.hermes/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <keywords>" --design-system -p "Project Name"
```

Example:
```bash
python3 ~/.hermes/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "restaurant food delivery" --design-system -p "Warung Jaya"
```

Output: complete design system with pattern, style, colors, typography, effects, and anti-patterns.

## Domain Searches

```bash
# Style options
python3 ~/.hermes/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "glassmorphism dark" --domain style

# Color palettes
python3 ~/.hermes/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "fintech saas" --domain color

# Font pairings
python3 ~/.hermes/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "elegant modern" --domain typography

# UX best practices
python3 ~/.hermes/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "animation accessibility" --domain ux

# Landing page structure
python3 ~/.hermes/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "hero social-proof cta" --domain landing
```

## Persist Design System

```bash
python3 ~/.hermes/skills/ui-ux-pro-max/src/ui-ux-pro-max/scripts/search.py "<query>" --design-system --persist -p "Project Name"
```

Creates `design-system/MASTER.md` + `design-system/pages/<page>.md` for hierarchical retrieval across sessions.

## Common Rules

- **No emojis as icons** — use SVG (Phosphor, Heroicons)
- **Touch targets** ≥44pt
- **Micro-interactions** 150-300ms with native easing
- **Color contrast** ≥4.5:1 body, ≥3:1 secondary
- **Spacing rhythm** 4/8dp system
- **Safe areas** respect notch/status bar

## Pre-Delivery Checklist

- [ ] No emojis used as structural icons
- [ ] All icons from consistent icon family
- [ ] Touch targets ≥44pt
- [ ] Animation timing 150-300ms
- [ ] Color contrast verified in both light/dark
- [ ] Safe areas respected
- [ ] Responsive at 375px, 768px, 1024px
