# Rafu design system

Rafu ("shelf" in Swahili) is the proposed brand name. It is set in `src/brand/brand.ts`.

Research behind these choices: `reports/Lively global ecommerce UI.md`, which is local and not committed.

## Principle: alive because it is real

A Rafu screen should feel alive because things on it genuinely change and respond: photos, motion, live data and fast feedback. It should not rely on decoration, fake urgency or invented numbers.

## Brand

- **Mark:** `public/rafu-mark.svg` is a hibiscus rounded square with two white shelves and a mango "product" dot. Use the `<RafuLogo/>` component (`src/brand/RafuLogo.tsx`) and never redraw it.
- **Brand colour, hibiscus `#FF3D6E`** (`bg-brand`, `text-brand`, `bg-brand-soft`). Use it for primary calls to action in the shopper storefront, active states, the logo and a few accents. Do not paint whole page backgrounds with it.
- **Deal colour, mango `#FFB020`** (`bg-mango`, `text-on-mango`). Use it only for real deals: a compare-at price, scheduled drops and "new" badges.
- **Neutrals:** warm paper `canvas`, white `panel`, ink `#160F1E`. Dark mode is fully supported through the tokens.
- **Status colours:** `pos` (green), `warn`, `neg`, `info`, each with a `-soft` variant. Each status always uses the same tone wherever it appears.
- **Type:**
  - Headings use `font-display`, which is Bricolage Grotesque at 700–800 with tight tracking. Example: `text-3xl font-extrabold tracking-tight`.
  - Body text is Inter.
  - Numbers get `tnum`.
  - Do not use all-caps body text.
- **Radius and shadow:**
  - Cards: `rounded-[var(--radius-card)]` or `rounded-2xl`.
  - Controls: `rounded-xl`.
  - Shadows: `shadow-[var(--shadow-card)]`, lifting to `shadow-[var(--shadow-lift)]` on hover.

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
  - First-sale and milestone celebration (confetti-free: a gentle hibiscus burst and a message, respecting reduced motion).
- **Orders:** status tabs with counts. Order cards show product thumbnails, customer initials avatar, a payment badge and the next action button.
- **Products:** image grid by default with an optional list view, inline stock badge, and an "Out of stock" overlay.
- **Bottom tab bar on phones** with a hibiscus floating "New order" button.

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

- Contrast ≥ 4.5:1 for text. Hibiscus on white is used for large or bold text and icons; button text is white on hibiscus.
- Tap targets ≥ 44px. Visible focus rings are in brand colour.
- Every icon button has an `aria-label`.
- Images need `alt` text, using the product name as a fallback.

## Maps

- **Stack:** `maplibre-gl` with `@vis.gl/react-maplibre`, using the OpenFreeMap "liberty" style (`https://tiles.openfreemap.org/styles/liberty`). It is free, needs no key and allows commercial use, but comes with no SLA.
- **Loading:** lazy-load maps only on the checkout, tracking, delivery-zone and Today screens.
- **Attribution:** keep it visible.
- **Geocoding:** no autocomplete against public Nominatim. Use pin-drop plus a manual landmark field. Reverse geocoding is optional and must be cached and rate-limited.
