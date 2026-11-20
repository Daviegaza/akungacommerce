# Fungua brand guidelines

**Status:** proposed identity, pending trademark and domain clearance and the owner's approval.
Do not use ® or ™, and do not describe the name as registered or a domain as owned.

- **Name:** Fungua. In Swahili, *fungua* means "open" or "unfasten". That is the whole story; do not add an etymology.
- **Line:** Open commerce. Everywhere.
- **Positioning:** Fungua is a commerce operating system. It helps businesses sell across storefronts, social channels and
  physical touchpoints, and manage products, orders, inventory, customers, payments and fulfilment from one connected workspace.
- **Source of truth:** `src/brand/brand.ts` (name and copy) and `src/brand/FunguaLogo.tsx` (geometry). The files in
  `public/brand/` are exported from that geometry.

## 1. Logo

### Assets

| File | Use |
| --- | --- |
| `public/brand/fungua-logo.svg` | Combined logo (mark + wordmark) on light backgrounds. The default. |
| `public/brand/fungua-logo-reversed.svg` | Combined logo on graphite or dark backgrounds. |
| `public/brand/fungua-logo-mono.svg` | One colour (`currentColor`): print, embossing, single-ink use. |
| `public/fungua-mark.svg` | Mark alone, full colour, light backgrounds. |
| `public/brand/fungua-mark-reversed.svg` | Mark alone on dark backgrounds. |
| `public/brand/fungua-mark-mono.svg` | Mark alone, one colour. |
| `public/brand/fungua-wordmark.svg`, `-reversed.svg` | Wordmark alone, where the mark already appears nearby. |
| `public/favicon.svg`, `public/brand/fungua-app-icon.svg` | App icon: the mark on a graphite tile. Favicon and home-screen icon. |
| `public/apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | PNG app icons for platforms that need them. |
| `public/og-image.png` | 1200 × 630 social sharing image. |

In code, use `<FunguaLogo />`, `<FunguaMark />`, `<FunguaWordmark />` or `<FunguaAppIcon />`. Each takes
`tone="brand" | "mono" | "reversed"`. `brand` follows the light/dark theme automatically. Never paste raw SVG.

### Construction

The mark is an **F set inside an open frame**. The frame is broken at two corners, so the shape reads as an opening and as
two connected pathways. That is the idea behind the name: access, movement and connection.

- **Grid:** 64 × 64 units, with the artwork inside 10–54 (10 units of built-in margin on every side).
- **Stroke:** 8 units everywhere. Every corner and end is square: no rounding, no tapering.
- **The F (ink):** a stem 10–18 on x from y 10–44. A top bar 10–40 on x at y 10–18. A middle bar 18–34 on x at y 26–34.
- **The frame (accent):** a vertical 46–54 on x from y 24–54. A horizontal 24–54 on x at y 46–54.
- **Openings:** 6 units between the end of the top bar and the frame, and 6 units between the foot of the stem and the
  frame. These gaps are the identity. Never close them, and keep them visible at every size.
- **Wordmark:** "fungua" in lowercase Geist SemiBold, tracking −3.5%, outlined as vector paths.
- **Lockup:** the wordmark's x-height is centred on the mark, and the gap between mark and wordmark is 0.22 × the mark height.

### Clear space

Keep clear space on every side equal to **the stroke width × 2**: 16 units of the 64-unit mark, or a quarter of the mark's
height. Nothing may enter it: no text, edges or other logos.

### Minimum sizes

| Element | Screen | Print |
| --- | --- | --- |
| Mark | 16 px | 5 mm |
| Combined logo (mark height) | 18 px | 6 mm |
| Wordmark alone (glyph height) | 14 px | 4 mm |

Below 16 px, use the app icon (mark on a graphite tile) instead of the bare mark.

### Misuse

Do not:
- recolour the two parts in anything other than the palette below, or swap the colours of the F and the frame;
- close the openings, add outlines, shadows, glows or gradients;
- rotate, skew, stretch or round the corners;
- set the wordmark in another typeface, or retype it instead of using the outlined file;
- put the full-colour mark on photos or busy colour (use the app icon or the reversed version);
- put the brand mark inside a merchant's storefront header, where the merchant's brand leads (a small "Powered by" in the
  footer is the only Fungua presence there);
- use emoji, carts, bags, sparkles or robots alongside the logo as if they were part of it.

## 2. Colour

One accent, used sparingly. Graphite gives structure; neutral off-white surfaces stay quiet.

| Role | Token | Light | Dark |
| --- | --- | --- | --- |
| Graphite (structure, text, primary buttons) | `ink`, `primary` | `#0E1420` | `#EDF0F5` |
| Canvas (page) | `canvas` | `#F7F7F4` | `#0B0F17` |
| Panel (surfaces) | `panel` | `#FFFFFF` | `#121826` |
| Sunken (wells, hover) | `sunken` | `#F0F1F3` | `#080B12` |
| Secondary text | `ink-2` | `#475063` | `#B4BCCB` |
| Tertiary text | `ink-3` | `#646D80` | `#8892A4` |
| Hairlines | `line`, `line-strong` | `#E5E7EB`, `#D3D7DE` | `#1F2636`, `#2C3446` |
| **Cobalt (accent)** | `brand` | `#2F5BEA` | `#7B9BFF` |
| Text on cobalt | `on-brand` | `#FFFFFF` | `#0B0F17` |
| Positive | `pos` | `#0B7D56` | `#3DD598` |
| Warning | `warn` | `#A15C07` | `#F2B85C` |
| Negative | `neg` | `#C8322B` | `#FF8A80` |

Logo colours: F `#0E1420` with frame `#2F5BEA` on light; F `#FFFFFF` with frame `#7B9BFF` on dark.

**Accessibility (WCAG 2.2 AA, measured):**
- White on cobalt `#2F5BEA` is 5.5:1, and dark text on dark-mode cobalt `#7B9BFF` passes too.
- Body text `#0E1420` on canvas is 17.2:1.
- Tertiary text `#646D80` on canvas meets 4.5:1. In dark mode `#8892A4` on panel is 5.7:1.
- Status colours meet 4.5:1 on their surfaces.
- Never use colour alone to carry meaning: status badges always include a word.

Use cobalt for the primary call to action on a screen, links, focus rings and the active part of a chart, not for large
backgrounds. Status colours are for status only.

## 3. Typography

- **Geist** (SIL Open Font License) for every interface and marketing text. **Geist Mono** for codes and references.
  Tabular figures (`tnum`) for every amount, count and time.
- **Weights:** 400 for body text, 500 for labels and navigation, 600 for headings and emphasis. Do not go above 600 in the interface.
- **Scale:**
  - Hero headline: clamp 40–72 px, line height 1.02, tracking −3.5%.
  - Section heading: 28–40 px, −2.5%.
  - Page title: 24–28 px.
  - Section title: 15 px semibold.
  - Body: 15–17 px.
  - Labels: 13 px.
  - Meta: 11–12 px.
- **Case:** sentence case everywhere. Uppercase only for small navigation group labels.

## 4. Iconography

- [Lucide](https://lucide.dev) outline icons, 1.75–2 px stroke, at 16, 18 or 20 px. They sit next to a text label wherever
  space allows.
- Icons are neutral (`ink-2` or `ink-3`). Colour an icon only to carry status (for example warning amber on low stock).
- No illustrations, mascots, 3D or emoji in the product interface.

## 5. Light and dark

Every surface supports both themes through the tokens. Dark mode is graphite, never pure black, and has the same hierarchy:
panels are slightly lighter than the canvas, hairlines stay visible, and cobalt lightens to `#7B9BFF` with dark text on
it. Logos switch to their reversed versions automatically when `tone="brand"`.

## 6. Voice and messaging

- **Clear, calm, exact.** Say what happens, in plain words. "Payment recorded, marked unverified", not "Boom! You got paid".
- **Honest by default.** Never invent customers, numbers, reviews, urgency or activity. If something is not connected
  yet, say so.
- **Global, not generic.** Write for any country. Name local methods (M-Pesa, bank transfer, cards) where they apply,
  never as the default for everyone.
- **Short sentences.** One idea per sentence. No exclamation marks in the product interface.
- **Do:** "Open commerce. Everywhere." · "Every order lands in one queue." · "Customers pay into your own accounts."
- **Don't:** "Revolutionary AI-powered commerce", "Trusted by thousands", "The #1 platform", or any claim not backed by data.

### Boilerplate

> Fungua is a commerce operating system for businesses that sell through their own storefront, social channels and in
> person. Products, orders, inventory, customers, payments and fulfilment run from one connected workspace.
