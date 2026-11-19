# Akunga Commerce — Global Commerce OS Build Brief

## Product intent
Turn this repository from a Vite starter into a credible, global-first commerce operations product for small and mid-sized merchants who sell through WhatsApp, Instagram, social channels, and direct links. The product must help a merchant publish a catalogue, capture orders, manage fulfilment, collect payment status, and retain customer history. It is not a WhatsApp bot and must not claim an official WhatsApp connection until credentials, approved templates, webhooks, and end-to-end delivery are verified.

## Target customers
- Independent retailers and social sellers
- Food, beauty, fashion, electronics, home-goods and specialty merchants
- Small distributors with multiple locations
- Agencies managing commerce for multiple client businesses

Kenya is a useful first validation market, not the product boundary. Support international merchants from the data model onward.

## Core product workflows
1. Organisation setup: legal/display name, country, timezone, locale, base currency, business type, contact details.
2. Catalogue: products, variants, SKU, images, descriptions, categories, price, cost (permission-restricted), tax classification metadata, availability, stock tracking.
3. Channels: public storefront/shareable catalogue, manual social-channel attribution, WhatsApp deep links. Official WhatsApp Business Platform integration must be an adapter behind a feature flag until verified.
4. Orders: draft, pending confirmation, confirmed, preparing, ready, dispatched, delivered, cancelled, refunded. Preserve immutable order-line snapshots of product name, SKU, quantity, unit price and currency.
5. Customer CRM: contact records, consent/preferences, order history, notes, tags, duplicate detection.
6. Inventory: stock movements, reservations, adjustments with reasons, locations, low-stock thresholds. Never permit negative stock silently.
7. Payments: record provider, currency, amount, status, external reference, timestamps and reconciliation status. A manually recorded payment must be visibly marked manual/unverified. Never simulate a successful card, bank, or mobile-money charge.
8. Fulfilment: pickup/delivery, address, delivery fee, assignment, tracking reference and proof of delivery.
9. Analytics: orders, gross sales, refunds, average order value, channel attribution and stock health. Never combine unlike currencies into one total.
10. Team access: owner, admin, manager, sales, fulfilment and read-only analyst roles with server-enforced permissions.

## Global requirements
- ISO 4217 currency codes; money stored as integer minor units or exact decimal types, never binary floating point.
- Currency is explicit on every order, payment, refund and price snapshot.
- Locale-aware formatting and date/time display; persist timestamps in UTC and business timezone separately.
- International phone numbers in E.164; country-specific address fields without assuming Kenyan counties/postcodes.
- Tax fields are configurable metadata only until jurisdiction-specific rules are reviewed by a qualified professional.
- No Kenya-only assumptions in schemas, validation, UI labels or onboarding.

## Architecture direction
Inspect the existing code before changing it. Preserve useful work and avoid a rewrite. Prefer a typed service/repository boundary and schema validation. Recommend Supabase Postgres/Auth/Storage/RLS for the first production-capable backend if no existing backend has been selected. If adding Supabase, provide migrations, RLS policies, generated types and server-side functions where privileged logic is required. Never expose service-role secrets in the browser. Add .env.example with placeholders only.

## Design quality
Create a distinctive, premium merchant workspace: restrained typography, excellent hierarchy, crisp tables, fast keyboard-friendly workflows, purposeful empty states, strong mobile layouts for shop owners working from phones. Avoid generic AI dashboard styling, excessive gradients/glows, robot imagery, emoji icons and decorative clutter. The product must feel like a serious commerce tool.

## Trust, security and reliability
- Tenant isolation enforced in the database, not only the UI.
- Audit log for price, stock, order, payment and role changes.
- Idempotency for order creation, stock mutations and payment webhooks.
- Verify webhook signatures and replay protection before processing.
- Explicit refunds and reversals; never delete financial history.
- Validate file uploads and restrict access to private assets.
- Rate-limit auth and public order endpoints; protect against enumeration.
- Consent-aware messaging; unsubscribe/opt-out handling.
- Backups, restore procedure, migrations and rollback notes.

## Commercial path
- Start with a productized merchant onboarding / catalogue setup service, then convert recurring users to SaaS.
- Design a no-card-required demo workspace with clearly fictional data.
- Pricing is a hypothesis; test it with customers before presenting it as validated.
- Build a simple global landing page with transparent feature boundaries and a clear book-a-demo / start-trial path.
- Do not invent testimonials, transaction volume, integrations, customers or revenue.

## Definition of done for the first release candidate
- A merchant can sign up, create an organisation, add products, share a catalogue, capture an order, update fulfilment, record a payment with correct verification status, and view customer/order history.
- A second organisation cannot access the first organisation's data.
- Currency, timezone and locale tests cover at least three distinct regions.
- Tests cover order totals, refunds, stock reservations/reversals, permissions, idempotency and webhook verification.
- Build, lint, typecheck and tests pass.
- README explains local setup, env vars, architecture, demo mode, integration status and deployment steps.
- Every integration is labelled one of: connected and verified, configured but unverified, adapter only, or not implemented.

## Working rules for the coding agent
1. Inspect repository tree, current app, package scripts and git history before coding.
2. Produce a short audit and implementation plan, then execute the highest-value vertical slice; do not stop after writing a plan.
3. Do not overwrite working product functionality or change unrelated repositories.
4. Run all available checks and fix failures introduced by your work.
5. Work on the feature branch `feat/global-commerce-product-foundation`; commit coherent changes and open a PR to main.
6. Do not deploy, create paid services, send customer messages, charge payments, or use real customer data without explicit approval.
7. Final report must separate implemented, tested, mocked, adapter-only, blocked and unverified items. Include exact commands and results.
