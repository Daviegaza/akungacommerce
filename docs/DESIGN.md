# Fungua design system

Fungua is the proposed brand name (pending clearance), set in `src/brand/brand.ts`. Identity, logo, colour values,
typography and voice: [BRAND_GUIDELINES.md](BRAND_GUIDELINES.md). Tokens: `src/index.css` (`--ak-*`, light and dark).

## Principles

1. **Structured and calm.** Graphite structure, quiet off-white surfaces, one cobalt accent used sparingly. It should feel like a mature product, not a template.
2. **Open, not boxed.** Sections are separated by space and hairlines, not by nested cards. Avoid a card inside a card, and avoid a floating panel when an edge-attached one will do.
3. **Dense but readable.** Operational screens favour tables and lists with tabular figures over big tiles. Every number is real.
4. **The merchant's brand leads on storefronts.** Platform styling stays in the workspace and marketing site. Storefront chrome takes the shop's own name, logo and imagery; Fungua appears only as a small footer credit.
5. **Alive because it is real.** Motion and live updates reflect real changes. There is no decoration, fake urgency or invented numbers.

## Foundations

- **Type:** Geist for everything, Geist Mono for codes. Weights 400/500/600, sentence case, `tnum` on all figures.
  - Page title: 24–28 px.
  - Section title: 15 px semibold.
  - Labels: 13 px.
- **Colour:** semantic tokens only (`ink`, `ink-2`, `ink-3`, `canvas`, `panel`, `sunken`, `line`, `brand`, `pos`, `warn`, `neg`). Never hard-code hex values in components.
  - `mango` remains as the token name for real deals (a compare-at price or a drop), now a restrained amber.
- **Radius:**
  - Controls: 8 px (`rounded-lg`).
  - Cards and tables: 12 px (`--radius-card`).
  - Badges: 6 px (`rounded-md`).
  - Pills only for toggles.
- **Elevation:** surfaces use a 1 px hairline, not shadows. `--shadow-lift` is only for menus, sheets and previews that float.
- **Spacing:**
  - 4 px base.
  - 40 px between page sections in the workspace, 80–112 px on marketing pages.
- **Focus:** a 2 px cobalt outline with a 2 px offset on every interactive element.
- **Layout:**
  - Workspace sidebar from 768 px, with grouped navigation (Catalogue, Business, Channels).
  - Below 768 px, a flat bottom tab bar with a "New order" tab.
  - Content max-width is 1240 px.

## Components and patterns

### Shopper storefront (most important surface)

**Product card**
- **Image:** square, `rounded-2xl`, `object-cover`. Swipe or dot gallery when there are 2+ images.
- **Wishlist:** heart in the top-right corner. It is stored locally and pops on tap (`ak-pop`).
- **Text:** name in 2 lines max, then the price in bold display font. If a compare-at price exists, it appears struck through in ink-3 with a mango "−23%" chip.
- **Variants:** colour swatches.
- **Delivery promise:** shown only if the merchant has set it, for example "Delivers today in Westlands".
- **Quick add:** a circular "+" button. On tap it gives a short scale animation and the cart badge bumps.

**Home**
- The shop header has a cover image, logo, name, a verified-contact line and a real rating (only once real reviews exist).
- Sticky search with suggestions.
- Horizontally scrolling category chips with images.
- "New this week" and "Drops" rails.
- A 2-column grid on phones, 3–4 columns on desktop.

**Product page**
- Full-bleed gallery with thumbnails.
- Variant pickers as chips.
- Stock line computed from real data, for example "Only 3 left" when available stock ≤ the low-stock threshold.
- Delivery estimate from zones.
- Sticky bottom bar with **Add to cart** (brand) and **Order on WhatsApp** (secondary, green WhatsApp glyph).
- Share button.

**Cart and checkout**
- The cart is a slide-up drawer on phones and a side drawer on desktop.
- Guest checkout fits on one page:
  1. Phone, name.
  2. Delivery or pickup.
  3. Map pin address, then landmark and building fields.
  4. Payment.
- **Always show the full total including delivery before the pay button.**
- Payment methods are M-Pesa (STK when configured; otherwise Till/Paybill instructions with the order reference), cash on delivery (only if the merchant enabled it), and card (adapter only, hidden until configured).

**Order tracking page**
- No login needed.
- Big status timeline with real timestamps.
- Map showing the shop pin and the drop-off pin.
- Rider name and phone once assigned.
- **Never animate a fake courier.**

### Merchant workspace

- **Today:**
  - Greeting.
  - KPI tiles with sparkline and comparison to the previous period, per currency.
  - A queue that can't be dismissed ("3 to confirm, 2 to pack").
  - Live activity feed (new order, payment recorded, stock low) with relative times.
  - Map of today's deliveries.
  - Sale chime: WebAudio, off by default, with a toggle in the header.
  - First-sale and milestone celebration (confetti-free: a short message, respecting reduced motion).
- **Orders:** status tabs with counts. Order cards show product thumbnails, customer initials avatar, a payment badge and the next action button.
- **Products:** image grid by default with an optional list view, inline stock badge, and an "Out of stock" overlay.
- **Bottom tab bar on phones** with a flat "New order" tab (no floating button).

## Motion

- Durations of 150–350ms with `cubic-bezier(.2,.8,.2,1)`.
- Use framer-motion for drawers, sheets and list insertions, and `ak-rise` for content entering.
- Use skeleton loaders for full-page loads.
- Everything respects `prefers-reduced-motion`; the CSS already enforces this.

## Honesty rules (enforced in code, not just copy)

- No countdown unless the merchant scheduled a real end time. It must disappear at that time and can never reset.
- "Only N left" comes only from real available stock. "N sold" comes only from delivered orders and is hidden when below 5.
- Ratings and reviews come only from verified, delivered orders. There is no manual review entry.
- A compare-at price must be greater than the price, and it is labelled "was". Merchants are warned about the EU 30-day rule.
- The total includes delivery before payment. There are no hidden fees.
- No fake moving rider marker and no fake visitor counts.

## Accessibility

- Contrast ≥ 4.5:1 for text (measured values in BRAND_GUIDELINES.md §2). White on cobalt in light mode; dark text on light cobalt in dark mode.
- Tap targets ≥ 44px. Visible focus rings are in brand colour.
- Every icon button has an `aria-label`.
- Images need `alt` text, using the product name as a fallback.

## Maps

- **Stack:** `maplibre-gl` with `@vis.gl/react-maplibre`, using the OpenFreeMap "liberty" style (`https://tiles.openfreemap.org/styles/liberty`). It is free, needs no key and allows commercial use, but comes with no SLA.
- **Loading:** lazy-load maps only on the checkout, tracking, delivery-zone and Today screens.
- **Attribution:** keep it visible.
- **Geocoding:** no autocomplete against public Nominatim. Use pin-drop plus a manual landmark field. Reverse geocoding is optional and must be cached and rate-limited.
