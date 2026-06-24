# Per-Trade Quote Formats — Spec

## Objective

Every trade/feature in QuoteMate must render its quote in a layout appropriate to
that trade — on **both** the tradie-facing dashboard Quotes tab and the
customer-facing `/q/` pages. Today, only electrical/plumbing have a fitting
format (the Good/Better/Best card), and that same generic card is wrongly used to
render roofing, solar, aircon and painting quotes. The headline failure is
roofing: a roofing quote should look like the rich Roof-tab measurement results
(Google Maps imagery, per-structure metrics, tiered pricing) — not an electrical
line-item card. This spec makes each trade's quote render in its own dedicated,
deliberately-better format, with a Pay Deposit action wired to the existing
Stripe deposit flow.

Audience: tradies reviewing/sharing saved quotes in the dashboard, and their
customers opening a shared quote link.

## Context / background

Current state (verified by codebase exploration):

- **Trade routing** is keyed on `intakes.trade`. Known values: `electrical`
  (default/fallback), `plumbing`, `roofing`, `solar`, `painting`,
  `commercial-painting`, `aircon`, plus an estimating/estimator tool
  ("Electrical Estimation"). `intakes.job_type` is a sub-category and is NOT used
  for routing.
- **Generic customer page** `app/q/[token]/page.tsx` (~1267 lines) renders the
  Good/Better/Best card from `quotes.good/better/best` jsonb. It branches on
  `intakeTrade === 'roofing'` only to add a `RoofHeroStrip`
  (`app/q/[token]/RoofHeroStrip.tsx`) — otherwise every non-electrical trade
  falls through to the electrical/plumbing layout. Deposit CTA uses
  `/r/{token}/{tier}` short-links backed by `quotes.stripe_links` jsonb.
- **Roofing** already has a dedicated, richer customer page
  `app/q/roof/[token]/page.tsx` driven by the **separate** `roofing_measurements`
  table (`MultiRoofQuote` jsonb in `lib/roofing/types.ts`). It renders the shared
  `RoofMap` component (Google/Esri satellite + Geoscape outlines), per-structure
  metrics (sloped area m², form, hips, valleys, storeys), per-tier pricing, an
  AI "after re-roof" preview, and a **confirm-gate** (prices hidden until
  `confirmed_at` is set over SMS). Dashboard roofing results live at
  `app/dashboard/roofing/measure/page.tsx` + `app/dashboard/roofing/_components/`.
- **Solar** has a dedicated customer page `app/q/solar/[token]/page.tsx` driven by
  the `solar_estimates` table (`SolarEstimate` in `lib/solar/types.ts`) — heatmap,
  hardware cards, tier breakdown, its own confirm-gate, and a deposit CTA
  (`lib/solar/deposit-cta.ts`). Dashboard view: `app/dashboard/_components/SolarTab.tsx`.
- **Commercial Painting** has a dashboard-only workflow
  (`app/dashboard/_components/commercial-painting/CommercialPaintingTab.tsx`):
  upload → classify → AI takeoff → price → quote, backed by `paint_runs`,
  `plan_uploads`, `plan_extractions`. No customer quote page.
- **Paint** (residential) has dashboard measurement UI
  (`app/dashboard/painting/page.tsx`) but no customer quote page and no confirmed
  quote-data shape.
- **Aircon** and the **Electrical Estimation** tool have dashboard tabs
  (`app/dashboard/aircon/`, `estimating`/`estimator` tabs) but their quote-data
  shapes are not yet mapped and they have no customer quote page.
- **Dashboard Quotes tab** is part of the tabbed SPA `app/dashboard/page.tsx`;
  shared quote primitives live in `app/dashboard/_components/quote-ui.tsx`.
- **Brand**: customer/dashboard quote surfaces use the Maintain Technology design
  system (deep navy, vibrant orange accent, bold uppercase display type) — see
  the `maintain-design-system` skill; `/q/roof` and `/q/solar` already follow it.

Decisions locked during the spec interview:

1. Scope covers **both** surfaces (dashboard Quotes tab + customer `/q/` pages).
2. Trades in scope: Electrical, Plumbing, Electrical Estimation, Aircon, Roofing,
   Solar, Commercial Paint, Paint.
3. **Electrical + Plumbing keep the generic Good/Better/Best format** as the
   shared baseline. Every other trade gets a bespoke format.
4. "Electrical Estimation" is a **separate** feature (the estimator tool), not the
   standard electrical quote, and gets its own dedicated format.
5. Dashboard Quotes tab renders each non-generic quote as a **rich inline panel**
   (the trade's full view) with a Pay Deposit action.
6. The four net-new trades (Aircon, Commercial Paint, Paint, Electrical
   Estimation) get **full bespoke formats now**: dashboard rich panel + customer
   `/q/` page + deposit.
7. **Pay Deposit reuses the existing Stripe deposit flow** (`/r/{token}/{tier}`
   short-links / solar deposit-CTA pattern): a real pay button on the customer
   page; a share/preview of the deposit link on the dashboard.

## Requirements

### A. Routing & the generic-format boundary

1. A single source of truth maps a quote/estimate to its trade and selects the
   renderer. Resolve trade from `intakes.trade` for `quotes`-table rows, and from
   the originating table for trade-specific stores (`roofing_measurements`,
   `solar_estimates`, `paint_runs`, and the aircon / estimator stores once
   mapped).
2. The generic Good/Better/Best layout (`app/q/[token]/page.tsx` body) renders
   **only** for `electrical` and `plumbing`. For any other trade the system must
   route to / render that trade's dedicated format instead of the electrical
   card. A roofing, solar, aircon, painting, commercial-painting, or
   estimation quote must never display the generic electrical line-item card.
3. Trade detection must have an explicit, logged fallback: an unknown/unmapped
   trade renders the generic baseline AND emits a warning (so a new trade can't
   silently inherit the electrical card without anyone noticing).

### B. Dashboard Quotes tab (tradie-facing)

4. On the Quotes tab, each quote row expands into a **rich inline panel** showing
   that trade's full view (e.g. roofing: `RoofMap` + per-structure metrics +
   tier pricing; solar: heatmap + hardware + tiers). Electrical/plumbing rows
   keep the existing Good/Better/Best rendering.
5. The inline panel reuses the same components as the customer-facing page for
   that trade (e.g. roofing reuses `RoofMap` / the structure-breakdown component)
   so the tradie and customer see a consistent view.
6. The dashboard panel **always shows full prices** to the tradie, even for
   roofing/solar quotes whose customer view is still behind the confirm-gate.
7. Each panel includes a **Pay Deposit** affordance: on the dashboard this shows
   and lets the tradie copy/share the customer deposit link (per tier where
   applicable) — it is not a live charge on the dashboard.
8. The Quotes tab list must remain scannable: the collapsed row shows a
   trade-styled summary (trade label, address/customer, headline total or tier
   range, status, a thumbnail where one exists) before expansion.

### C. Customer-facing `/q/` pages

9. **Roofing** customer quotes render the rich roof format with the actual
   Google Maps / satellite imagery and full measurement data carried onto the
   page — at parity with (or richer than) the dashboard Roof-tab results. Roofing
   quotes must reach `app/q/roof/[token]` (or an equivalent rich renderer), never
   the generic `/q/[token]` electrical card. The existing confirm-gate behavior
   (price-free building picker pre-confirm; full priced breakdown + AI after-image
   post-confirm) is preserved.
10. **Solar** customer quotes render the dedicated solar format (heatmap, hardware
    cards, tier breakdown) with its confirm-gate preserved; never the generic card.
11. **Aircon, Commercial Paint, Paint, Electrical Estimation** each get a new
    dedicated customer `/q/` page presenting that trade's generated data in a
    layout fit for it (see §E for per-trade content). Each must surface the real
    generated data for that job, not placeholder copy.
12. Every customer page includes a **Pay Deposit** action wired to the existing
    Stripe deposit flow (`/r/{token}/{tier}` short-links or the
    `lib/solar/deposit-cta.ts` pattern), using that quote's stored Stripe links.
13. All customer pages use the Maintain Technology design system for visual
    consistency.

### D. Quality bar ("better than before")

14. Each bespoke format must be a deliberate visual/UX upgrade over rendering the
    same data in the generic card — using the trade's distinctive data (maps,
    metrics, heatmaps, takeoff tables, hardware lists) as first-class content, not
    squeezed into Good/Better/Best line items.
15. All formats are responsive (mobile-first; customers open these on phones) and
    accessible (semantic headings, alt text on imagery, sufficient contrast).

### E. Per-trade content requirements

16. **Electrical** (baseline) — unchanged generic Good/Better/Best card.
17. **Plumbing** (baseline) — unchanged generic Good/Better/Best card.
18. **Roofing** — satellite/Google Maps imagery (`RoofMap`), per-structure metrics
    (sloped area m², roof form, hips, valleys, storeys), per-tier pricing
    (patch/repair · re-roof · upgrade), AI after-image preview, deposit. Confirm-gate
    preserved on the customer side.
19. **Solar** — system-size/heatmap imagery, hardware/component cards, per-tier
    breakdown, assumptions, deposit. Confirm-gate preserved on the customer side.
20. **Commercial Paint** — plan/takeoff-based view: extracted areas/surfaces from
    `plan_extractions`, line-item takeoff, total, deposit. Layout suits a
    tender/takeoff, not a residential G/B/B card.
21. **Paint** (residential) — measurement-driven view (rooms/surfaces/areas),
    pricing, optional before/after or sample imagery if available, deposit.
22. **Aircon** — view driven by the aircon estimate data (system type/capacity,
    units, install scope, pricing tiers if present), deposit.
23. **Electrical Estimation** — a format suited to the estimator tool's detailed
    output (itemised estimate / takeoff), distinct from the standard electrical
    G/B/B quote.
24. Before building each of the four net-new formats (Aircon, Paint, Commercial
    Paint, Electrical Estimation), the builder must first map that feature's
    actual data shape from the code/DB and confirm the field-level layout — no
    invented fields (see Open questions).

## Non-goals

- Changing the underlying pricing, estimation, or measurement logic. This is a
  **presentation/routing** change; the generated data per trade is preserved.
- Redesigning the electrical/plumbing generic format. It stays as the baseline.
- Building Stripe Connect / real funds-split. Continue using the existing
  test-mode deposit flow exactly as it works today.
- Adding brand-new trades beyond those listed, or building the v9 `trades`
  registry. Work within the trades that already exist.
- Changing the confirm-gate policy (when prices unlock). Preserve current behavior
  for roofing/solar; don't add gating to trades that don't have it.
- Signage (out of scope — not named for this spec).

## Constraints

- Next.js 16 App Router (read `quotemate-automation/AGENTS.md` and the relevant
  `node_modules/next/dist/docs/` guide before writing Next code — Next 16 has
  breaking changes vs. training knowledge).
- Reuse existing components rather than rebuilding: roofing → `RoofMap` and the
  dashboard roofing `_components`; solar → `SolarTab` pieces / `/q/solar`
  components; deposit → `/r/{token}/{tier}` + `lib/solar/deposit-cta.ts`.
- Multi-tenant isolation is app-layer `tenant_id` filtering (service-role key);
  any new dashboard/customer query must keep tenant scoping intact.
- Customer `/q/` pages are public and token-gated (service-role read against the
  trade's table by `public_token`/`share_token`); keep that pattern and don't
  leak prices past the confirm-gate.
- Maintain Technology design system (`maintain-design-system` skill) for all
  surfaces.
- Money-touching steps stay tool-grounded; deposit links come from stored Stripe
  link data, never computed ad hoc in the view.

## Edge cases to handle

- Unknown/unmapped trade value → render generic baseline + log a warning; never
  silently style a non-electrical trade as electrical.
- Roofing/solar quote opened by customer **before confirm** → show the existing
  price-free pre-confirm view (building picker / heatmap), no prices, no deposit
  button.
- Same quote opened by tradie on dashboard → full prices + deposit share link,
  regardless of confirm state.
- Missing imagery (no satellite tile / heatmap / plan) → graceful fallback
  (placeholder + the rest of the data still renders), not a broken layout.
- Quote with no Stripe deposit links yet → hide/disable the Pay Deposit action
  with a clear state, don't render a dead link.
- Net-new trade quote whose data shape isn't fully populated → render available
  fields and degrade gracefully; don't crash on missing optional fields.
- Legacy roofing quotes that exist as `quotes`-table rows (rendered via the old
  `RoofHeroStrip` path) vs. `roofing_measurements` rows → both must reach the rich
  roofing format, not the electrical card.
- Mobile viewport → maps/metrics/takeoff tables reflow without horizontal scroll.

## Definition of done

- [ ] Opening a **roofing** quote on the customer side renders the rich roof
      format (Google Maps/satellite imagery + per-structure metrics + tier
      pricing + after-image), never the electrical card; confirm-gate intact.
- [ ] Opening a **solar** quote on the customer side renders the dedicated solar
      format, never the electrical card; confirm-gate intact.
- [ ] **Electrical** and **plumbing** quotes still render the unchanged generic
      Good/Better/Best format.
- [ ] On the dashboard Quotes tab, expanding a roofing/solar/aircon/paint/
      commercial-paint/estimation row shows that trade's **rich inline panel**
      (reusing the customer-side components) with full prices for the tradie.
- [ ] A **Pay Deposit** action appears on every in-scope quote: a real Stripe
      deposit button on the customer page, and a copy/share deposit link on the
      dashboard, both sourced from the quote's stored Stripe links.
- [ ] Net-new customer `/q/` pages exist and render real data for **Aircon**,
      **Commercial Paint**, **Paint**, and **Electrical Estimation** (no
      placeholder-only pages).
- [ ] An unmapped/unknown trade falls back to the generic baseline and logs a
      warning (verified by forcing an unknown trade value).
- [ ] Every in-scope customer page is responsive on a phone viewport and passes a
      basic a11y check (headings, image alt text, contrast).
- [ ] No regression: existing `/q/roof` and `/q/solar` pages and the dashboard
      roofing/solar tabs still work.
- [ ] Each bespoke format is demonstrably richer than the same data in the generic
      card (side-by-side review sign-off).

## Open questions

- **Aircon** data shape: what does the aircon estimate store and where
  (table/columns/jsonb)? Needed to design its format and customer page.
- **Paint (residential)** data shape: is there a persisted quote/estimate for a
  completed paint job, or only the dashboard measurement UI? If none, does this
  spec also define the minimal persisted shape, or is that a prerequisite?
- **Electrical Estimation** tool: what is its output data model, and is its
  customer deliverable a quote or an itemised estimate document?
- **Commercial Paint** customer sharing: is there a `public_token` path for
  `paint_runs`, or does one need to be added for the customer `/q/` page?
- **Deposit per tier vs. flat**: roofing/solar use per-tier deposits; do
  aircon/paint/commercial-paint use a single deposit or tiers? Confirms the Pay
  Deposit UI per trade.
- **Dashboard Quotes tab data source**: does the tab currently list only
  `quotes`-table rows, or also the trade-specific tables
  (`roofing_measurements`/`solar_estimates`/`paint_runs`)? The rich-inline-panel
  work depends on unifying these into the list.
