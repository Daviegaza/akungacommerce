# Fungua brand guidelines

**Status:** proposed identity, pending trademark and domain clearance and the owner's approval. Do not use ® or ™, and do not describe the name as registered or a domain as owned.

- **Name:** Fungua. In Swahili, *fungua* means "open" or "unfasten". Do not invent a longer etymology.
- **Line:** Open commerce. Everywhere.
- **Positioning:** A commerce operating system for businesses selling through their own storefront, social channels and in person.
- **Source of truth:** `src/brand/brand.ts` for name and copy; `src/brand/FunguaLogo.tsx` for vector geometry.

## Identity concept

The refreshed symbol is a **forward-moving F aperture**. A strong graphite F anchors the left side; a cobalt exit path opens to the right. The mark represents access, movement and a direct route into commerce. It is intentionally geometric and legible at small sizes, without literal carts, bags, gradients or decorative effects.

## Logo assets

| Asset | Intended use |
| --- | --- |
| `public/brand/fungua-logo.svg` | Primary full-colour lockup on light surfaces |
| `public/brand/fungua-logo-reversed.svg` | Reversed lockup on dark surfaces |
| `public/brand/fungua-logo-mono.svg` | Single-colour print and embossing |
| `public/brand/fungua-mark-mono.svg` | Single-colour symbol |
| `public/brand/fungua-mark-reversed.svg` | Reversed symbol |
| `public/brand/fungua-wordmark.svg` and `-reversed.svg` | Wordmark-only placements |
| `public/brand/fungua-app-icon.svg`, `public/favicon.svg` | Graphite tile with reversed mark |
| `public/apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Raster platform icons; refresh before final app-store packaging |
| `public/og-image.png` | Social share artwork; refresh before public launch |

In React, use `<FunguaLogo />`, `<FunguaMark />`, `<FunguaWordmark />` or `<FunguaAppIcon />`. Do not paste ad-hoc logo SVGs into components.

## Construction and use

- **Grid:** 64 × 64 units. Preserve the left F anchor and rightward exit path.
- **F:** geometric stem, full-width top bar and shorter middle bar. Square terminals and corners.
- **Exit path:** cobalt arrow-like aperture that points outward. It is a flat shape, never a gradient, glow or shadow.
- **Wordmark:** lowercase outlined Geist wordmark. Do not retype it in a substitute font.
- **Lockup:** keep the mark and wordmark optically centred; preserve the supplied proportions.
- **Clear space:** at least one quarter of the mark height on every side.
- **Minimum size:** 16 px for the standalone mark; use the graphite app-icon tile on busy surfaces.
- Never stretch, skew, rotate, outline, round or recolour the artwork outside the approved palette.
- The merchant's brand leads on public storefronts. Fungua appears only as a small footer credit there.

## Colour

| Role | Light | Dark |
| --- | --- | --- |
| Graphite / primary ink | `#0E1420` | `#EDF0F5` |
| Canvas | `#F7F7F4` | `#0B0F17` |
| Panel | `#FFFFFF` | `#121826` |
| Hairline | `#E5E7EB` | `#1F2636` |
| Cobalt accent | `#2F5BEA` | `#7B9BFF` |
| Logo exit path | `#2F5BEA` | `#9DB5FF` |
| Positive | `#0B7D56` | `#3DD598` |
| Warning | `#A15C07` | `#F2B85C` |
| Negative | `#C8322B` | `#FF8A80` |

Use cobalt for primary actions, links, focus and selected states—not as a large decorative background. Use status colours only to communicate status, and never by colour alone.

## Typography and interface

- Geist for interface and marketing text; Geist Mono for codes and references.
- Weights 400, 500 and 600. Sentence case. Tabular figures for amounts, counts and times.
- Hero headline: 48–86 px responsive, tight line height and restrained negative tracking.
- Page title: 24–28 px. Section title: 15–18 px. Body: 15–17 px. Labels: 12–13 px.
- Lucide outline icons at 16, 18 or 20 px. No emoji, mascots, robots, 3D or generic AI motifs in the product interface.
- Hairlines and spacing define surfaces. Avoid nested cards, excessive shadows, glow effects and ornamental gradients.
- Every screen supports light and dark themes through semantic tokens. Tap targets are at least 44 px; visible focus states and reduced-motion support are required.

## Voice

Clear, calm and exact. Be honest about what is connected and verified. Never invent customers, transaction volumes, reviews, urgency or integrations. Write for global businesses; mention local payment methods only where they apply.

**Boilerplate:** Fungua is a commerce operating system for businesses that sell through their own storefront, social channels and in person. Products, orders, inventory, customers, payments and fulfilment run from one connected workspace.
