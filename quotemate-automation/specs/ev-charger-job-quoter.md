# EV charger on the Electrical Job Quote Tool — Spec

> Jon's ask (meeting prep): "a customer requests a new EV charger for their car — maybe try
> Tesla and BYD — it should ask the questions, then propose the price, then allow them to book."
> Surface: the dashboard Electrical Job Quote Tool (`/dashboard/job/electrical`).

## Objective

Make an EV charger enquiry a first-class, demo-able job on the Electrical Job Quote Tool: the
tool asks the qualifying questions a sparky actually needs (car, who supplies the charger,
location, distance to switchboard, phase), produces a grounded G/B/B price that includes the
charger unit when the tradie supplies it, and hands off to the existing send → `/q/[token]` →
$99 site-visit → booking-calendar funnel. Tesla and BYD are the two worked examples.

## Context / background — what already exists (verified 2026-09-01)

The plumbing is live; the content is thin. Do not rebuild what's here:

- **Job type**: `ev_charger` is in the intake enum (`lib/intake/schema.ts:19`), the dashboard
  form registry (`lib/quote/job-fields.ts:189-207` — currently just 2 questions: `room` +
  `phase`), the SMS extractor, the validator (`validate.ts:147` regex → category `ev_charger`),
  and assembly search (`JOB_TYPE_ASSEMBLY` → `'Install EV charger'`).
- **Assembly**: exactly one shared row, `'Install EV charger'` (mig 021) — "Single-phase 7kW
  home charger install on dedicated circuit", $120 ex-GST sundries + 3.0h labour, **excludes
  the charger unit**, `default_enabled=false`. No BOM, no `price_recipe`. It already carries 3
  clarifying questions (mig 033): charger model/on-site?, distance to switchboard, phase/spare
  capacity — the SMS receptionist asks these; **the dashboard form asks none of them**.
- **Pricing data**: zero charger products anywhere (`shared_materials`, `supplier_catalogue`:
  0 rows), no product-brand registry, no `job_type_bounds` row for `ev_charger`. All 7
  electrical tenants have the EV service toggled **OFF** in `tenant_service_offerings`.
  0 of 241 historical intakes mention a charger — this is a genuinely new job type in prod.
- **Pipeline**: form → `POST /api/tenant/job-quote` (prose transcript; recipe-slot codes
  filtered out) → `structureIntake` (Opus) → `/api/estimate/draft` with `tradieDrafted:true`
  (**always held for review — never auto-sends**, by design) → tradie reviews at
  `/dashboard/quote/[share_token]` → Confirm & Send → customer SMS with `/q/[token]` link.
- **Payment/booking**: electrical is site-visit-first (strategy v20) — G/B/B prices are
  **display-only**; the only chargeable amount is the flat **$99 refundable site visit**
  (`/r/[token]/inspection`), then `/q/[token]/book` calendar → `/thanks`, with customer +
  tradie booking SMS. Nothing EV-specific is needed here.
- **Three-phase → inspection is prompt-only**: the form option text
  `'three phase (on-site inspection)'` lands in the transcript and `lib/intake/structure.ts:397`
  tells Opus to set `inspection_required=true`. No deterministic code enforces it (this exact
  field already has a lost-answer bug in its history — see the comment at `job-fields.ts:194-200`).
- **Known contradiction**: the Services-tab copy still lists "EV charger install" as
  inspection-only (`app/dashboard/page.tsx:8334-8340`, `ELECTRICAL_INSPECTION_ONLY`), and SMS
  keeps `'ev charger'/'tesla charger'/'wallbox'` in `UNIVERSAL_INSPECTION_TRIGGERS` — both
  predate the priced path.

## Requirements

**R1 — Question set.** Replace the 2-field `ev_charger` entry in `lib/quote/job-fields.ts`
with 5 fields, in this order (option strings are the Opus contract — they land verbatim in the
transcript):

1. `vehicle` — select, "What car is the charger for?" —
   `['Tesla', 'BYD', 'another EV', 'not sure']`
2. `charger_supply` — select, "Who supplies the charger unit?" —
   `['customer already has the charger', 'we supply the charger', 'not sure']`
3. `room` (keep existing code) — text, "Where is the charger going (garage, carport, external wall)?"
4. `switchboard_distance` — select, "Roughly how far is the switchboard from the charger spot?" —
   `['under 5 m', '5–10 m', 'over 10 m', 'not sure']`
5. `phase` (keep existing code + options unchanged) —
   `['single phase', 'three phase (on-site inspection)', 'not sure']`

Hard constraint: no new code may collide with `RECIPE_SLOT_CODES`
(`['distance_to_existing_power','circuit_required']`, `lib/quote/recipe-slots.ts:25`) — those
are filtered out of the transcript and the answer would be silently dropped (the historical
`circuit_required` bug). Extend the guard tests (`lib/quote/recipe-slots.test.ts:131-135`,
`app/api/tenant/job-quote/build-transcript.test.ts:63-66`) to cover the new codes.

**R2 — Deterministic three-phase gate.** In `app/api/tenant/job-quote/route.ts`, after
`structureIntake`, if `answers.phase === 'three phase (on-site inspection)'` force
`inspection_required = true` on the intake before insert. Belt over the `structure.ts:397`
prompt rule so the routing never depends on model discretion. `'not sure'` stays
model-discretion (unchanged).

**R3 — Charger products (data, not code).** The demo tenant stocks ≥2 active
`tenant_material_catalogue` rows, category `ev_charger`, with Jon-confirmed ex-GST prices:
e.g. "Tesla Wall Connector (single-phase 7kW)" and a "Type 2 7kW wallbox (BYD-compatible)".
The form's existing product picker (`JobQuoteForm.tsx:194-209`) then surfaces them
automatically, cheapest-first, and pins the pick as `intake.scope.chosen_product`. Do **not**
seed prices into `shared_materials` — the Phase-2 R5 strike stands (no invented wallbox
prices; the pricing book is built WITH the tradie).

**R4 — Service toggle (data).** `'Install EV charger'` → `tenant_service_offerings.enabled=true`
for the demo tenant (Services tab). The dashboard prices regardless of the toggle
(`lookup_assembly` ignores it), but the toggle governs the SMS path and the structurer's
"enabled priced service row" rule — keep them coherent.

**R5 — Services copy fix.** Remove "EV charger install" from `ELECTRICAL_INSPECTION_ONLY`
(`app/dashboard/page.tsx:8334-8340`) so the Services tab stops calling inspection-only a job
the tool now prices.

**R6 — Sanity bounds.** New migration (+ `_down` + runner script) seeding a `job_type_bounds`
row for `ev_charger`/electrical — e.g. max 10 labour hours, $400–$6,000 total ex-GST, marked
PROVISIONAL pending Jon's confirmation — so `checkSanityBounds` is no longer inert for EV
totals.

**R7 — Priced draft.** With `vehicle=Tesla`, `phase=single phase`, and a pinned Wall Connector:
the draft yields non-null G/B/B whose lines ground against the `'Install EV charger'` assembly
($120 + 3.0h at the tenant's book rate) plus the pinned charger unit when
`charger_supply = 'we supply the charger'`; install-only (no unit line) when the customer
supplies it. Quote is held for tradie review (`tradieDrafted` — existing behaviour) and sent
via Confirm & Send.

**R8 — Booking (verify, no build).** The existing funnel carries the demo unchanged:
`/q/[token]` shows G/B/B + the single $99 CTA → `/r/[token]/inspection` Stripe mint →
`/q/[token]/book` calendar → `/thanks`, customer + tradie SMS. Verify the demo tenant has
`tenant_id` set on the quote, availability windows that produce slots, and `owner_mobile` set.

## Non-goals

- **SMS parity work**: adding `ev_charger` to `JOB_TYPE_CATEGORY` (SMS product offers) and
  `REQUIRED_BY_JOB`, fixing the extract-slots contradictory example ("Tesla wall charger" →
  `power_points` at `:347-354` vs `ev_charger` at `:429`), or removing EV terms from
  `UNIVERSAL_INSPECTION_TRIGGERS`. Note: SMS EV quoting already works once R4's toggle is on
  (the mig-033 MUST-ASK questions fire) — parity polish is phase 2.
- **A deterministic BOM/price-recipe for EV** — distance travels as prose for Opus, not as
  price bands. Wiring bands needs new slot codes in `RECIPE_SLOT_CODES` + `recipeSlotsFrom`
  and risks the price-authority preflight trap (`run.ts:162-222`: a recipe with a required
  category the tenant hasn't stocked turns every EV enquiry into a $99 inspection). Later.
- **Widening the product-attribute allowlist** (`smart/dimmable/integrated_driver` — no
  kW/phase/tethered keys). Charger specs live in the product name/description for now.
- Voice persona changes, the `/quote-request` web form EV option, auto-send for
  dashboard-drafted quotes (structurally held by design).

## Constraints

- Registry-shaped change: questions are data in `job-fields.ts`, not new UI. No new deps.
- Field codes must never collide with `RECIPE_SLOT_CODES`; option strings are the Opus
  contract — changing them changes routing.
- Currency ex-GST in data, inc-GST on display. AU English, no emoji (design system).
- DB change = migration `NNN_*.sql` + `NNN_down.sql` + `scripts/run-migration-NNN.mjs`,
  applied to prod Supabase; keep `sql/init.sql` representative.
- Stripe is test mode — demo pays with `4242 4242 4242 4242`.
- Charger unit prices come from Jon, never invented.

## Demo prerequisites (config-only, doable today without a deploy)

1. Toggle "Install EV charger" ON in the demo tenant's Services tab (R4).
2. Stock the two charger products in the tenant catalogue with Jon's prices (R3).
3. Confirm the tenant's availability template shows sensible booking windows and
   `owner_mobile` is set (silent-notify black hole otherwise).
4. Have a Stripe test card ready; confirm `APP_URL` is set in the deployed env.
5. Demo on the electrical tenant — if demoing SMS too, avoid a phone number with an open
   roofing/painting thread (thread-capture debt) and answer "single phase" to stay on the
   priced path.

## Edge cases to handle

- `phase = 'three phase (on-site inspection)'` → deterministic `needs_inspection` quote:
  tiers nulled, $99-only SMS/page. Expected, not a failure.
- `phase = 'not sure'` → priceable; Opus may add a risk flag; price confirmed on the $99 visit.
- `charger_supply = 'we supply'` but **no product pinned** → Opus has nothing grounded to
  price the unit against → grounding validator may downgrade the whole quote to inspection.
  Acceptable behaviour; the demo always pins a product.
- `switchboard_distance = 'over 10 m'` → Opus may scope extra labour (grounds against
  the book hourly rate). If it invents ungrounded material lines the validator downgrades to
  $99 — acceptable; demo uses 'under 5 m'.
- Customer-supplied unknown-brand charger → install-only quote; assembly exclusions text
  already covers the unit.
- Existing solar on the property → `has_solar` risk flag ("load assessment before new
  high-load work") already fires for `ev_charger`; leave as-is.
- Tenant with EV toggle OFF uses the dashboard tool anyway → still prices (documented
  inconsistency; R4 keeps the demo tenant coherent, wider fix out of scope).
- Absurd Opus total (e.g. 20h labour) → caught by the new R6 bounds row → inspection route,
  visible to the tradie at review, never sent silently.

## Definition of done

- [ ] `/dashboard/job/electrical` with job type "EV charger" shows the 5 R1 questions in order.
- [ ] New field codes are provably not recipe slots: extended guard tests in
      `recipe-slots.test.ts` + `build-transcript.test.ts` pass; all 5 answers appear in the
      transcript in registry order.
- [ ] Draft A (Tesla, we-supply, pinned Wall Connector, under 5 m, single phase) → priced
      G/B/B, charger-unit line present, `pricing_path ≠ 'inspection'`, quote held for review.
- [ ] Draft B (BYD, customer-supplies, single phase) → priced install-only draft, no unit line.
- [ ] Draft C (three phase) → `needs_inspection=true` with tiers nulled — asserted via the R2
      deterministic stamp (unit test), not model behaviour.
- [ ] `job_type_bounds` row for `ev_charger` live in prod; `checkSanityBounds` returns it.
- [ ] Services tab: EV charger toggle ON for the demo tenant and no longer listed as
      inspection-only.
- [ ] E2E demo pass: Confirm & Send → customer SMS with `/q/[token]` → page shows G/B/B +
      $99 CTA → Stripe test-card payment → calendar slot booked → `/thanks` → tradie booking
      SMS received.
- [ ] `vitest` suite green; `tsc`/`eslint` clean.

## Open questions (for Jon, ideally before the build)

1. **Charger prices**: his supply cost + sell price for the Tesla Wall Connector and a
   BYD-compatible Type 2 unit (R3 blocks on this — we don't invent prices).
2. **Supply model**: does he normally supply the unit, or does the customer buy it?
   (Sets the sensible default option order in R1-Q2.)
3. **Three-phase**: happy to keep it inspection-only, or does he want a priced three-phase
   install path later?
4. **Labour**: is 3.0h + $120 sundries right for a straightforward single-phase install, and
   what are sane bounds for R6 (we've drafted 10h / $400–$6,000 ex-GST)?
5. **Demo tenant**: which tenant is he demoing on (Sparky `6dca084c…` vs atomic-electrical
   `829702af…`)? Their book rates differ ($110/h vs $120/h + $350 call-out minimum).
6. **Distance pricing**: fine to confirm cable-run cost on the $99 visit for now (default),
   or does he want distance to move the quoted price deterministically (bigger phase-2 job)?
