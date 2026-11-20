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
  - Page title (`PageHeader`): 30–34 px, tracking −4.5%, with an optional small uppercase eyebrow.
  - Section title (`Section`): 16 px semibold.
  - Labels: 13 px. Meta: 12 px in `ink-3`.
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
- **Focus:** a 2 px cobalt outline with a 3 px offset on every interactive element (global `:focus-visible`).
- **Motion:** 150–240 ms, `cubic-bezier(.2,.8,.2,1)`, colour/opacity/transform only. Everything collapses to ~0 ms
  under `prefers-reduced-motion`.
- **Layout:**
  - Workspace sidebar from 768 px (248 px, 264 px from 1280 px), with grouped navigation (Catalogue, Business, Channels).
    The active item has a quiet ink tint and a 3 px cobalt edge marker; icons stay neutral.
  - Below 768 px, a flat 64 px bottom tab bar (Today, Orders, New order, Products, More) above the safe area.
  - Content max-width is 1280 px.

### Shared workspace components (`src/app/ui`)

- **Tabs (`PillTabs`):** an underlined strip on a hairline, with small count chips. Not floating pills.
- **Table (`Table/Th/Td`):** one hairline panel, a quiet `sunken` header band, 12 px vertical row padding. Edge to edge on
  phones inside an `overflow-x-auto` wrapper; operational lists switch to compact divided rows below 768 px.
- **Card:** a 1 px hairline surface with no shadow and no hover lift. Use it once per area, never nested.
- **Badge:** 22 px high, `rounded-md`, always with a word. `brand` is the soft cobalt tint, not a solid block.
- **Notice / ErrorNotice:** body text stays ink; only the icon (and a faint tint for warnings and errors) carries tone.
- **Sheet:** attached to the right edge on wide screens (full height, hairline border) and a bottom sheet on phones.
- **Avatar:** neutral initials with a hairline ring; the name is always next to it.

## Components and patterns

### Shopper storefront (most important surface)

The merchant's brand leads. There is no merchant colour setting, so identity comes from the shop's logo, cover photo, name,
tagline and product photography. Storefront actions (Add to cart, Checkout, Place order) are **graphite**
(`bg-primary`), not Fungua cobalt, and the no-logo fallback is a neutral initial. Fungua appears only as a small grey
"Powered by Fungua" footer credit. The same applies to buyer tracking and the rider page.

**Product card**
- **Image:** square, `rounded-lg` with a hairline, `object-cover`. Swipe or dot gallery when there are 2+ images.
- **Wishlist:** heart in the top-right corner. It is stored locally and pops on tap (`ak-pop`).
- **Text:** name in 2 lines max, then the price in semibold with tabular figures. If a compare-at price exists, it appears struck through in ink-3 with a mango "−23%" chip.
- **Variants:** colour swatches.
- **Delivery promise:** shown only if the merchant has set it, for example "Delivers today in Westlands".
- **Quick add:** a small graphite "+" button. On tap it gives a short scale animation and the cart badge bumps.

**Home**
- The shop header has a cover image, logo, name, a verified-contact line and a real rating (only once real reviews exist).
- Sticky search with suggestions.
- Horizontally scrolling underlined category row with counts (text only).
- "New this week" and "Drops" rails.
- A 2-column grid on phones, 3–4 columns on desktop.

**Product page**
- Full-bleed gallery with thumbnails.
- Variant pickers as chips.
- Stock line computed from real data, for example "Only 3 left" when available stock ≤ the low-stock threshold.
- Delivery estimate from zones.
- Sticky bottom bar on phones with **Add to cart** (graphite) and **Order on WhatsApp** (secondary, with the "opens your own WhatsApp, nothing is sent until you press send" note).
- Share button.

**Cart and checkout**
- The cart is a slide-up drawer on phones and a side drawer on desktop.
- Guest checkout fits on one page, in numbered steps separated by hairlines:
  1. Contact (full name, phone number).
  2. Delivery or pickup (map pin, landmark and building fields for delivery).
  3. Payment (the methods this shop offers).
  4. Review and place: policy, consent, errors and **Place order · total**.
- The order summary is a sticky side column on wide screens and a collapsed "Show order summary" bar with the total at
  the top on phones. On phones, Place order is pinned above the safe area.
- **Always show the full total including delivery before the pay button.**
- Payment methods depend on the shop's country and settings: for example M-Pesa (STK when configured, otherwise
  Till/Paybill instructions with the order reference), bank transfer, cash on delivery (only if enabled) and card
  (adapter only, hidden until configured).

**Order tracking page**
- No login needed. The merchant's name leads; actions are graphite.
- A large current-status headline with a simple step bar, then the timeline with real timestamps.
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
- **Orders:** underlined status tabs with counts. A dense table from 768 px (order, customer, channel, fulfilment,
  payment, status, total, age, next step); a compact divided list on phones.
- **Products:** list (table) view by default with an optional quieter grid; stock is stated in words.
- **Inventory, customers, payments, team:** tables from 768 px, divided rows on phones.
- **Settings and Storefront:** two-column sections on wide screens (title and description left, fields right).
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
- Tap targets ≥ 40px (44px for buyer and rider actions). Visible focus rings are in brand colour.
- Every icon button has an `aria-label`.
- Images need `alt` text, using the product name as a fallback.

## Maps

- **Stack:** `maplibre-gl` with `@vis.gl/react-maplibre`, using the OpenFreeMap "liberty" style (`https://tiles.openfreemap.org/styles/liberty`). It is free, needs no key and allows commercial use, but comes with no SLA.
- **Loading:** lazy-load maps only on the checkout, tracking, delivery-zone and Today screens.
- **Attribution:** keep it visible.
- **Geocoding:** no autocomplete against public Nominatim. Use pin-drop plus a manual landmark field. Reverse geocoding is optional and must be cached and rate-limited.
