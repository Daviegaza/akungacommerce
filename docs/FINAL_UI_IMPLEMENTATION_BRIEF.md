# Fungua final visual redesign — implementation brief

This is an implementation task, not a planning exercise. Work directly in the current branch `feat/global-commerce-product-foundation`. Preserve the existing commerce domain logic, routes, query keys, permission checks, gateways, and tests. Do not replace working workflows with static mockups.

## Outcome

Deliver a coherent, premium global commerce product across:
- Marketing landing page and demo shop
- Merchant workspace shell and every workspace page
- Public storefront, product detail, cart, checkout, tracking, and rider views
- Authentication, onboarding, settings, and team invitation surfaces
- Brand mark, wordmark, favicon, app icons, social image, and light/dark/reversed variants

The product should feel like a mature commerce platform: calm, precise, editorial, highly usable, and trustworthy. Avoid generic AI dashboard styling, oversized gradients, glows, emoji icons, decorative charts, excessive rounded cards, and gratuitous animation.

## Brand direction

Keep the proposed name Fungua and the line “Open commerce. Everywhere.” provisional; do not claim trademark/domain clearance. Refine the existing open-frame/F concept into a distinctive, legible vector identity. The mark must work at 16px, 24px, 32px, monochrome, reverse, and as a standalone app icon. Maintain a restrained graphite/off-white/cobalt palette. Produce a consistent logo system: primary horizontal lockup, stacked lockup, symbol, mono, reverse, favicon, 192/512 app icons, Apple touch icon and social image. Ensure SVG viewBoxes, padding, optical alignment and contrast are correct. Avoid rasterizing the core logo.

## Visual system

1. Establish consistent type scale, line heights, spacing, surfaces, borders, radii, shadows, focus rings and motion tokens in the existing design system.
2. Prefer clear page hierarchy and generous but efficient whitespace. Use dense, scannable data tables for operational work.
3. Use Lucide icons consistently, same stroke weight and optical size. No emoji as UI icons.
4. Make controls, table rows, filters, tabs, drawers, dialogs, toasts and forms visually consistent.
5. Provide purposeful loading, empty, error, success, permission-denied and offline states.
6. Keep colour meaning consistent and accessible. Never use colour alone to communicate status.
7. Respect reduced-motion preferences and keyboard navigation.

## Workspace pages

Audit and redesign every page in `src/app/pages`, not only Today:
- Dashboard / Today
- Orders, new order, order detail, invoice
- Products, product import, inventory
- Customers, customer detail, customer re-engagement
- Payments, fulfilment, analytics
- Storefront settings, selling tools, trust
- Settings, platform review, team invitation, not found, auth and onboarding

Improve the desktop information architecture and mobile navigation. On mobile, prioritize the most frequent actions and ensure no table, modal, form, drawer, or sticky control causes horizontal overflow or is hidden behind safe areas. Keep permission-aware navigation and action visibility intact.

## Storefront and buyer journeys

Redesign all public surfaces with a strong merchant identity and excellent product discovery:
- Shop home/category/search/filter/sort
- Product detail/gallery/variants/quantity
- Cart and checkout
- Payment instructions and order confirmation
- Buyer tracking and payment tracking
- Rider fulfilment and status updates

Make checkout especially clear on small screens. Keep price/currency, delivery/pickup, fees, payment status, consent and order totals unambiguous. Never imply a provider payment succeeded unless the backend confirms it. Preserve WhatsApp deep-link disclosures and do not claim official WhatsApp integration is connected.

## Logo and asset consistency

Update the React logo component and every matching asset under `public/brand` and `public/`. Confirm browser favicon, manifest icons, Apple touch icon and Open Graph image match the approved mark and palette. Check transparent padding and rendering on light/dark backgrounds. Update brand guidelines and design docs to reflect the final system.

## Engineering constraints

- Inspect before editing; make incremental changes, not a rewrite.
- Preserve all existing functionality, data contracts, permissions and tenant boundaries.
- Do not introduce fake live data, fake customer testimonials, fabricated revenue or unsupported integration claims.
- Keep demo data visibly fictional and local-only.
- Keep financial values currency-aware; do not combine different currencies in a single total.
- Do not expose service-role keys or provider secrets.
- Do not change migrations, auth, payment logic or production configuration as part of this visual pass.
- Add/update component tests where meaningful.
- Keep dependencies minimal; prefer existing components and packages.

## Required verification — do not skip

Run:
```bash
npm run typecheck
npm test
npm run build
npm run lint
```

Then run the app against the existing demo mode and inspect screenshots at 1440, 1024, 768, 390 and 360 CSS pixels. Inspect both light and dark themes. Verify:
- No horizontal overflow
- No clipped dialogs/popovers/dropdowns
- Sticky header/sidebar/mobile nav behave correctly
- Focus visibility and keyboard interaction
- Loading/empty/error states
- No console errors or missing assets
- Logo legibility at favicon and app-icon sizes
- All existing routes and core interactions still work

Use Playwright or the existing browser test setup for repeatable viewport checks. Save before/after screenshots in a clearly named, ignored local artifact directory; do not commit bulky screenshot output unless requested.

## Completion report

At the end, report:
1. Every page/surface actually redesigned.
2. Exact logo assets changed.
3. Tests run and their actual results.
4. Viewports/themes inspected and any remaining issues.
5. Commit SHA and PR link.

Do not say “complete” if any route, responsive pass, or test remains unverified. Do not merge or deploy production.