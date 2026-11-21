# Fungua brand guidelines

**Status:** proposed identity, pending trademark and domain clearance and the owner's approval. Do not use ® or ™, and do not describe the name as registered or a domain as owned.

- **Name:** Fungua. In Swahili, *fungua* means "open" or "unfasten". Do not invent a longer etymology.
- **Line:** Open commerce. Everywhere.
- **Positioning:** A commerce operating system for businesses selling through their own storefront, social channels and in person.
- **Source of truth:** `src/brand/brand.ts` for name and copy; `src/brand/FunguaLogo.tsx` for vector geometry.

## Identity concept

The symbol is **the open path**: an F whose middle bar unfastens. The graphite stroke stops, a small opening follows, and the
bar continues in cobalt as a path moving forward. It reads as the letter F, as something opening, and as a route onward, which
is all the name needs. It is geometric and legible at 16 px, with no carts, bags, gradients or decorative effects.

## Logo assets

| Asset | Intended use |
| --- | --- |
| `public/brand/fungua-logo.svg` | Primary horizontal lockup, full colour, light surfaces |
| `public/brand/fungua-logo-reversed.svg` | Horizontal lockup on graphite or dark surfaces |
| `public/brand/fungua-logo-mono.svg` | Horizontal lockup, one colour (`currentColor`): print, embossing |
| `public/brand/fungua-logo-stacked.svg`, `-stacked-reversed.svg`, `-stacked-mono.svg` | Stacked lockup (mark above wordmark): sign-in, splash, square placements |
| `public/fungua-mark.svg` | Symbol, full colour, light surfaces |
| `public/brand/fungua-mark-reversed.svg`, `fungua-mark-mono.svg` | Symbol reversed / one colour |
| `public/brand/fungua-wordmark.svg` and `-reversed.svg` | Wordmark-only placements |
| `public/brand/fungua-app-icon.svg`, `public/favicon.svg` | App icon: reversed mark at 87.5% on a graphite tile (radius 15/64) |
| `public/icon-192.png`, `icon-512.png` | Manifest icons (transparent corners) |
| `public/icon-maskable-512.png` | Android maskable icon: full-bleed graphite, mark inside the central 60% safe zone |
| `public/apple-touch-icon.png` | 180 × 180, full-bleed graphite (iOS applies its own mask) |
| `public/og-image.png` | 1200 × 630 social image |

All of these are generated from the geometry in `src/brand/FunguaLogo.tsx` by `node scripts/brand-assets.mjs`. Never edit an
exported file by hand; change the source and regenerate. In React, use `<FunguaLogo />` (`layout="stacked"` for the stacked
lockup), `<FunguaMark />`, `<FunguaWordmark />` or `<FunguaAppIcon />`. Do not paste ad-hoc logo SVGs into components.

## Construction and use

- **Grid:** 64 × 64 units; the artwork spans x 8–56 and y 9–55, so it is optically centred with built-in margin.
- **Stroke:** 8 units everywhere. Square terminals and corners; no rounding.
- **F (ink):** stem x 8–17, y 9–55; top bar to x 39 (y 9–17); middle bar x 17–29 (y 27–35).
- **Opening:** 4 units between the end of the graphite middle bar (x 29) and the start of the cobalt path (x 33). This gap is
  the idea of the mark. Never close it.
- **Path (accent):** shaft x 33–43 on the middle-bar line (y 27–35), arrowhead from x 43 (y 18–44) to a point at x 56, y 31.
  The shaft is exactly the middle bar's thickness, so the bar visibly continues. Flat colour only.
- **Wordmark:** "fungua" in lowercase Geist SemiBold, −3.5% tracking, outlined. Do not retype it in a substitute font.
- **Horizontal lockup:** wordmark x-height centred on the mark; the wordmark starts 6 units after the mark's 64-unit box.
- **Stacked lockup:** mark at 1.5× the wordmark's scale, centred above it.
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
| Logo path (accent part of the mark) | `#2F5BEA` | `#9DB5FF` |
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
