# Customer quote page: five sections, one roofing price, tradie trust video, $99 site-visit funnel — Spec

> Contract for `/build` and `/review`. Grounded in code opened for this spec on 2026-07-17
> (branch `ralph/roofing-3d-capture-upgrades`).
> Repo uses **pnpm**: test gate `pnpm test` (vitest), type gate `pnpm run typecheck`
> (`tsc --noEmit`) — there is **no `check` script**; e2e `pnpm test:e2e` (playwright).
> **Status: BLOCKED on D1–D4 in "Decisions required before build". Do not start until they are answered.**

## Title

Restructure the customer quote page into five sections (overview, job details, tradie trust video, price, $99 CTA), collapse roofing to a single price option, and land the customer on a booking page then a thank-you page after paying.

## Goal

The customer quote page sells exactly one thing: **pay $99 and the tradie comes out and validates this quote in person**. Every section moves the customer toward that button and nothing else. A roofing customer sees one job, one sentence of scope, one price, one button — plus a short video of the actual tradie so the page reads as a real business rather than a generated PDF. After paying, the customer picks a visit time and lands on a thank-you page where the tradie tells them what happens next.

Why: the current page presents up to three priced tiers, an itemised cost breakdown, and no human being. It reads like an invoice. Jon's framing is that we are not selling the roof on this page — we are selling the site visit.

## Role

Principal engineer. Reversible edits to the customer-facing quote surface, its post-payment funnel, and one additive migration. **No pricing-model redesign.** The estimator and the roofing pricing engine keep producing what they produce; this spec changes what the customer is *shown* and the *order* of the funnel.

## Source of intent (Jon, verbatim intent — the product contract)

Recorded across the 2026-07-17 thread. This section is what "correct" means; the Context section below is what the code currently does.

**What we're selling:** "what we are selling is pay me $99 to validate this quote."

**The page, five sections in order:**

1. **Overview of the job** — "simple description of the job determined from conversations on text or voice."
2. **Job details** — "simple summary of the job breakdown, like replace roof — new sarking, battens, colourbond metal sheeting and flashings… but we can confirm this sentence." Plus: **"can we remove at this stage, good, better best, and just have the one option for roof replacement."**
3. **Trust building** — "a short video from the tradie, telling the customer who they are, what we are about, why the tradie roofing company is so good… we will record personal video from them." Plus "maybe even a link to their website." Plus, mentioned earlier: "even jobs we have done near you."
4. **Price** — "simple price view… not a lot of detail, just the price."
5. **CTA** — "book a site inspection… $99 pay button."

**The flow:** "this routes to stripe page / then from that it routes to another landing page, which is booking page / which then routes to another page, with another recording from the tradie, saying thanks, we have received your request and we will be in touch to confirm the exact time of the inspection."

**Also flagged:** "there are some pricing inconsistencies."

**On the videos** (Jon, answering "who will do the recordings?"): **"on the onboarding, we will record it"** and **"we will default it with a quote max video."** Confirmed in follow-up: **two** QuoteMax defaults, one per slot.

So, settled and not open:
- Two video slots per tenant: quote-page intro, post-booking thank-you.
- **QuoteMax films the tradie during onboarding.** The tradie does not self-record and does not upload. No upload UI is in scope.
- **Two QuoteMax default videos** cover any tenant not yet filmed. A tenant's own video replaces its default independently. Section 3 is never empty and never blocks a quote.

**Deferred by the requester (2026-07-17):** no real video content exists yet, so **v1 ships a face-holder placeholder image in both slots** rather than a video player. See R4.

## Context (grounded — code read for this spec)

### The page

- `app/q/[token]/page.tsx` is a 1354-line async RSC (`force-dynamic`, `:58`; `PublicQuotePage`, `:142`) with five inline sub-components at the bottom. There is **no** `layout.tsx`/`loading.tsx`/`error.tsx` under `app/q`; the outermost wrapper is the client component `QuoteChrome` (`:833`).
- Render order (`:834-1123`): `QuoteChrome > [TradieEditor, QuoteSheet > Letterhead, HeroPhoto, QuoteHero, StatGrid, PriceHoldBanner, EarlyBirdBanner, EarlyBirdAppliedBanner, Scope, CustomerPhotosBlock, PreviewSection, RoofHeroStrip, CommercialPaintDetails, (InspectionBlock | RoofingIndicativeBanner+TradeTiers | TierCards), AcceptBlock, risk_flags, GoodToKnow, CredentialFooter]`.
- Three mutually-exclusive tier branches (`:997`, `:1073`): `isInspection && !roofingIndicative` → `InspectionBlock` (no prices, $99 only); `!tradeFormat.usesGenericCard` → optional `RoofingIndicativeBanner` + `TradeTiers`; else `TierCards`.
- **There is no interactive tier picker.** Tiers are static cards; visibility is resolved server-side and is presentation-only (`app/q/_chrome/parts.tsx:350`, `app/q/[token]/TradeTiers.tsx:10`).
- **Zero social proof exists.** No testimonials, ratings, review counts, completed-job counts, warranty badge, or before/after gallery. The only trust signals are the "Most popular" badge, the licence/GST footer rows (`CredentialFooter`, `parts.tsx:455`), and the yellow "Licensed & insured" tagline strip (`parts.tsx:483`).
- **Per-tenant branding is one component only** — the `Letterhead` (`:884`, `parts.tsx:96`): `logo_url`, `business_name`, credential line, contact strip. No tenant colour/font/accent is applied anywhere.
- Uncommitted working-tree change (the only one under `app/q`): `Letterhead`'s no-logo fallback switched from the QuoteMax mark to tenant initials via new untracked `lib/brand/monogram.ts` (`businessInitials`, `:17`), for white-labelling. `lib/brand/` is **untracked** (`?? lib/brand/`) — the tree does not build from a clean clone.
- **The roofing 3D work on this branch does not touch this page.** `git log main..ralph/roofing-3d-capture-upgrades -- app/q` returns zero commits.

### Two roofing customer surfaces — and the one the customer actually lands on

This is the single most misunderstood part of the system and it drives D2.

- `app/q/roof/[token]/page.tsx` (1140 lines) is the measurement-driven surface, keyed by `roofing_measurements.public_token`.
- **`app/q/roof/[token]/page.tsx:178-186`: when a measurement has been promoted to a quote and is NOT yet paid, the page `redirect()`s to `/q/<quote_share_token>`** — the generic page. So **an unpaid roofing customer always ends up on `/q/[token]`**. `/q/roof/[token]` survives only (a) post-payment, as "that payment's receipt + booking surface" (`:170-171`), or (b) for the tradie via `?full=1`.
- Therefore **the page Jon is describing is `/q/[token]` with `trade = 'roofing'`**, not `/q/roof/[token]`.

### The funnel — it already runs the OPPOSITE way to Jon's description

- **Generic surface (`/q/[token]`, where the roofing customer lands) is BOOK-FIRST, PAY-LAST.** Happy path: `/q/<token>` → `/r/<token>/<tier>` → **`/q/<token>/book?tier=<tier>` (pick slot first)** → `POST /api/q/<token>/book` → Stripe → `/q/<token>/paid`.
- `payRedirectTarget` (`lib/quote/booking.ts:46-84`) **does not special-case `inspection`** — since 2026-07-08 the $99 follows the same book-first order as deposit tiers (`app/r/[token]/[tier]/route.test.ts:40`).
- The rationale is recorded in code: the slot-hold model defers pruning to the payment finalise "so an abandoned checkout never strands a slot" (`app/api/q/[token]/book/route.ts:11-15`).
- `app/q/[token]/paid/page.tsx:225-227` **redirects to `/q/<token>/book` when paid but date-less** — so a $99 payer arriving without a slot is bounced into the picker rather than parked on a thank-you page.
- **The dedicated trade surfaces are PAY-FIRST, BOOK-SECOND — i.e. exactly Jon's order.** `app/api/q/book/[trade]/[token]/route.ts:80-86` requires `paid_at` and returns 409 *"Pay the deposit first, then pick your time."* Its header states: *"These jobs book AFTER paying the deposit / $99 site visit (that's the 'order' the customer places)."* Slots land on `roofing_measurements.scheduled_at` (mig 167); glue is `lib/quote/trade-booking.ts`.
- `app/r/roof/[token]/[tier]/route.ts:34` **rejects any tier but `inspection` with a 400** — the roofing surface has no per-tier deposit at all.
- **Both orders are deliberate, live, and mutually contradictory.** Jon is describing the roofing-surface order on the surface that uses the generic order.

### The $99

- Defined **twice, independently, in two units, neither derived from the other**: `INSPECTION_FEE_AUD_CENTS = 9900` (`lib/stripe/checkout.ts:63`, what Stripe charges) and a separate `99` dollars (`app/api/estimate/draft/route.ts:377`, what the quotes row stores). **There is no `pricing_book.inspection_fee_amount`** — the only `inspection_fee` string in the repo is an aspirational comment at `checkout.ts:61`.
- $99 is **inc-GST**, back-solved by the `/11` divisor to `subtotal_ex_gst = 90.00`, `gst = 9.00` (`draft/route.ts:377-379`) — the only place in the codebase dividing that direction, and unconditional on `gst_registered` unlike the tier path in the same function.
- The number is hardcoded again in the voice prompt (`lib/vapi/voice-prompt.ts:122`), the dashboard calendar (`CalendarTab.tsx:390`), and the pricing page (`app/pricing/page.tsx:260`).
- A **second parallel $99 product** exists: `createRoofingSiteVisitSession` (`checkout.ts:294`) reuses the same 9900 but is keyed by `metadata.roofing_token` and attached to `roofing_measurements`, not `quotes`. Its `success_url` breaks the `/q/<token>/paid` pattern: `/q/roof/<token>?paid=1` (`checkout.ts:320-321`).
- `$99` routes through Stripe Connect identically to a deposit — a 2% platform fee = **$1.98** (`lib/stripe/connect.ts:24`).

### Good/Better/Best — a tier-mode already exists and roofing is already wired for it

- **`lib/quote/tier-visibility.ts` is the declared single source of truth** for "how many price options the customer sees", explicitly a presentation gate applied *after* estimation that never re-prices and never deletes tiers (`:3-8`).
- Modes: `good_better_best | single | good | better | best`. **`single` is the platform default** — `asQuoteTierMode()` defaults to `'single'` (`:27-32`, `:55-58`). `single` renders `[pickRecommendedTier(...)]`, honouring `selected_tier`, else `better → good → best` (`:48`, `:82`, `:120`).
- `pricing_book.quote_tier_mode` is a real shipped per-tenant, per-trade column with a CHECK constraint, default `'single'` (mig 142).
- **Roofing is already tier-mode-capable end to end except one surface:** the dashboard already offers roofers "Single price (recommended option)" (`app/dashboard/page.tsx:5828`); the roofing **PDF** honours it (mig 148, `lib/quote/pdf.ts:614`); the roofing **SMS** honours it (`lib/sms/roofing-compose.ts:109`); **`/q/[token]` honours it** (`:542-549`). **The one outlier is `/q/roof/[token]`, which never reads `pricing_book` and renders all three tiers unconditionally** (`:404-434`).
- Roofing tier labels are `{ good: 'Patch', better: 'Full roof replacement', best: 'Upgraded roof replacement' }` (`lib/quote/trade-format.ts:213`, set by `specs/price-and-tier-fixes.md` item 2). **`better` is literally "Full roof replacement"** — Jon's "one option for roof replacement" — and `app/api/roofing/save-as-quote/route.ts:222-224` already derives `selected_tier` from `p.tiers[1]` (= `better`). **So `single` mode on roofing already resolves to exactly the option Jon wants.**
- Roofing's three tiers are **distinct operational scopes, not cosmetic upsells** (`lib/roofing/pricing.ts:12-14`): Good = patch/spot repair, Better = full re-roof same material, Best = upgrade material. `good` is explicitly **not** a discount on `better`, and `good <= better` is deliberately not asserted — edge works legitimately lift `good` above `better` on small roofs (`pricing.ts:356`, `:401-405`).
- **Changing the producer's arity is blocked five ways** (this is why R3 is a view change, not a pipeline change): `RoofingQuotePrice.tiers` / `MultiRoofQuote.combined.tiers` are fixed **3-tuples** (`lib/roofing/types.ts:391`, `:455`); the save-as-quote Zod schema **hard-rejects** any tiers array whose length ≠ 3 (`lib/roofing/save-as-quote-schema.ts:39-59`); `buildTierObjects` indexes 0/1/2 unconditionally (`save-as-quote-helpers.ts:42-88`); the save route reads `p.tiers[1]`/`[2]` directly (`route.ts:222-233`); `calculateRoofingPrice` builds the tuple literally then runs `assertTierMonotonic` (`pricing.ts:684-689`).
- `app/api/roofing/save-as-quote/route.ts:209-219` carries an explicit **"INTENTIONAL / Do NOT null these tiers"** warning — nulling re-introduces a known blank-roofing-quote bug.
- Precedents that a variable tier count is safe downstream: solar already emits 1–3 tiers (`lib/solar/sizing.ts:285-290`); `TradeTiers` already degrades to one tier with singular copy (`:95-98`); the recommended badge already self-suppresses at one visible tier (`page.tsx:552`); aircon + signage are already excluded from the tier selector as non-G/B/B trades (`dashboard/page.tsx:5860`); `createCheckoutSessionsForQuote` already skips null tiers (`checkout.ts:114-126`). **Nothing in the codebase requires all three of `quotes.good/better/best` to be non-null.**
- `pdf_signature` hashes `tierMode + visibleTierKeys`, so a tier-mode change self-heals the cached PDF (mig 146, `lib/quote/pdf-signature.ts:22-30`).

### Sections 1 and 2 — the prose already exists, and one field is generated then thrown away

- **Section 1 source exists.** `intake.scope.description` is a required string bound by the structurer prompt to "the caller's own conversational wording" (`lib/intake/schema.ts:44`, `lib/intake/structure.ts:218-219`). The estimator turns it into **`scope_of_works`**, a real `text` column on `quotes` (`sql/init.sql:103`), already rendered by the page as a titled "Scope of works" section (`page.tsx:936`). **No migration needed for Section 1 on electrical/plumbing.**
- **Section 2 source is generated and discarded.** Both estimator prompts already emit **`scope_short`** — a single-line scope sentence, explicitly forbidden from inventing features (`electrical-estimator.ts:282-283`, `plumbing-estimator.ts:277-278`). **`scope_short` has no DB column anywhere** (grep of the whole `sql/` tree: zero matches). `app/api/estimate/draft/route.ts:801-802` attaches it to an in-memory object for the SMS builder and drops it. `app/api/quote/[id]/edit/route.ts:164-168` documents the ephemerality as a deliberate decision.
- The customer SMS already ships a one-line summary, but **regex-slices the first sentence out of `scope_of_works`** and only falls back to `scope_short` (`lib/sms/templates.ts:948-962`).
- **Roofing bypasses the LLM estimator entirely** — there is no roofing estimator prompt (`lib/estimate/prompt-templates/` holds only electrical + plumbing). Roofing `scope_of_works` is set deterministically to the **Better tier's scope string** (`app/api/roofing/save-as-quote/route.ts:233`), and roofing produces **no `scope_short` at all**.
- **Roofing has no conversational description whatsoever.** `intake.scope` for roofing is `{...inputs, ...metrics}` — a pure measurement snapshot with **no `description` key** (`save-as-quote/route.ts:164-180`). **Jon's Section 1 ("determined from conversations on text or voice") has no source field on the roofing path.** This is D3.
- **The closest thing to Jon's sentence already exists**: `tierScopeLine()` (`lib/roofing/pricing.ts:446-484`) deterministically composes intent + tier + material + area into almost exactly his shape. Separately, `ROOF_SCOPE_BULLETS` (`lib/roofing/report-html.ts:225-235`) is a **hardcoded static const** in the roofing report — identical for every roof, derived from nothing. (Note: **"sarking" does not appear in it**; Jon's example wording is not currently in the codebase.)
- **No write path for `scope_of_works` exists.** The edit route accepts only the three tiers plus two flags (`edit/route.ts:78-97`); it reads `scope_of_works` purely as a read-only grounding input (`:158-169`). The chat-edit route likewise cannot change it. The one live tradie-editable prose surface is `report_doc` (`POST /api/quote/[id]/document`), which **seeds from `scope_of_works` but never writes back** (`lib/quote/report-doc/seed.ts:17-19`). This is D4 ("but we can confirm this sentence").
- `scope_of_works` is read by the approve page, dashboard, followups, RAG context and `tenant/me` — **wide blast radius** on any change to how it is generated.

### Price presentation

- Tier prices are stored **ex-GST** in `quotes.good/better/best.subtotal_ex_gst`; the page converts with `incGst(x) = Math.round(x * 1.10)` (`page.tsx:133`, `:644`). Every displayed price is inc-GST.
- Detail level is already a config: `resolveQuoteDisplayMode({ perQuoteOverride: quotes.display_mode, tenantPreference: pricing_book.quote_display })`, `'itemised' | 'summary'`, hard-defaulting to **`'itemised'`** (`lib/quote/display.ts:49`, `page.tsx:307`). Cards show up to 4 bullets; the full breakdown is an inline `<details>`.
- Prices render in **four** places: tier card (`parts.tsx:405`), sticky bottom bar (`QuoteChrome.tsx:154`), `AcceptBlock` confirmation line, and the itemised `<details>` rows (which are **ex-GST**, `page.tsx:706`).

### Pricing inconsistencies (Jon: "there are some pricing inconsistencies")

Jon did not say which. The adversarial sweep found these, all verified. **`incGst` is re-implemented 5 separate times; only one is exported; there is no shared money/GST module** (`lib/quote/report-html.ts:93` is the only export; copies at `TradeTiers.tsx:71`, `page.tsx:133`, `lib/sms/templates.ts:900`, +1). There is no shared `formatCurrency` either — `fmt` (0dp), `fmtAUD`, `aud0`/`aud2`, `fmtAud` all differ. **No cross-surface price-parity test exists.**

| # | Defect | Evidence |
|---|---|---|
| **P1** | **GST is conditional on `gst_registered` in the three DB-write paths but unconditional (always ×1.1) in every customer-facing display and in the Stripe charge.** For a non-GST-registered tradie the page/SMS/PDF show — and Stripe charges — 10% more than the stored `total_inc_gst`. | `draft/route.ts:441-442`, `edit/route.ts:470-471`, `select-tier.ts:42` vs `page.tsx:644` |
| **P2** | **The quote page hardcodes `depositPct = 30`, ignoring `quotes.deposit_pct`.** `/r` explicitly honours the column and its comment says the hardcoded-30 was a known bug fixed *there* — the identical bug is still live on the page that advertises the number. A tenant on 20% sees 30% advertised and is charged 20%. | `page.tsx:513` vs `app/r/[token]/[tier]/route.ts:179-189` |
| **P3** | Draft route hardcodes `deposit_pct: 30` for both the Stripe mint and the SMS payload, despite its own comment claiming it comes from `pricing_book`. | `draft/route.ts:583`, `:591`, `:804` |
| **P4** | **Early-bird discount is applied at a different point in the GST maths by the two tier renderers on the same page.** `page.tsx` rounds to dollars **then** discounts; `TradeTiers.tsx` discounts the ex-GST base **then** rounds. Same quote, two components, off-by-a-dollar. | `page.tsx:644-646` vs `TradeTiers.tsx:106-107` |
| **P5** | Stripe applies the discount at **cent precision on the unrounded inc-GST** — a third distinct order. | `checkout.ts:235-237` |
| **P6** | **The customer quote SMS never applies the early-booking discount.** It prints the full undiscounted price and deposit while the pay link it embeds mints a **discounted** Session. SMS says "$1000 (deposit $300)", checkout charges $270. | `lib/sms/templates.ts:1021-1022`, `:132-133` |
| **P7** | **The customer PDF has zero discount awareness** — full undiscounted price while the page for the same quote shows the discounted one. `report-html.ts` greps clean for `discount`/`earlyBird`. | `lib/quote/report-html.ts:108` |
| **P8** | Deposit is computed from a **dollar-rounded** base on page + SMS but a **cent-precise** base in Stripe — advertised and charged deposits differ by cents. | `page.tsx:137-140` vs `checkout.ts:80-82` |
| **P9** | The two Stripe session creators disagree on discount support: `createCheckoutSessionsForQuote` (draft-time, writes the links the SMS embeds) has **no `discountPct` param at all**; `createCheckoutSessionForTier` does. | `checkout.ts:100-108` vs `:220-224` |
| **P10** | **Roofing tiers carry BOTH `subtotal_ex_gst` and a GST-aware `total_inc_gst`**, and the roofing pricer honours `gst_registered`. Roofing PDF + SMS use `inc_gst` verbatim; **the generic page ignores the stored `total_inc_gst` and recomputes `× 1.1` unconditionally.** Same tier object, two different numbers. | `lib/roofing/pricing.ts:558-559` vs `page.tsx:644` |
| **P11** | The page is internally inconsistent about `gst_registered`: it **gates** the GST stat tile and footer row on the flag but asserts "10% GST" in hero copy unconditionally. A non-registered tradie's page says "Price includes 10% GST" with no GST row. | `page.tsx:766-767`, `:830-831` |
| **P12** | `lib/sms/templates.ts` holds **two byte-identical copies** of the tier pricing loop that must be hand-synced. | `:128-151` and `:1017-1039` |
| **P13** | Units-naming trap: the SMS `incGst` parameter is named `exGstCents` but is passed **dollars**; a future reader honouring the "cents" contract introduces a 100× error. | `lib/sms/templates.ts:900-903` |
| **P14** | The $99 GST back-solve is unconditional on `gst_registered`, unlike the tier path in the same function. | `draft/route.ts:377-379` vs `:441` |

Not verifiable from code: whether any live tenant has `pricing_book.gst_registered = false`. **P1's blast radius depends on that DB fact** — check before sizing P1.

### "Jobs we've done near you" — no data source exists

Answering it needs **four** things, and none exist:
1. **A completion signal.** The quotes ladder is `draft → sent → viewed → paid → accepted` (`lib/quote/lifecycle.ts:34-40`); `accepted` means *deposit paid + slot booked*, i.e. work **scheduled**, not finished. (Nuance: `quotes.completed_at` **does** exist (mig 160) and is written by `app/api/quote/[id]/complete/route.ts:87` gated on `paid_at` — this is the one real terminal signal, and it has a route test.)
2. **A normalised location.** `intakes.address`/`suburb` are **LLM-extracted free text**, no validation, no normalisation, frequently null (`lib/intake/structure.ts:209-211`). **No lat/lng, no postcode, no geohash, no PostGIS, no index on suburb or address anywhere** on the quote pipeline. `lat/lng` exist only on `studios` (unrelated). "Penrith", "penrith", "Penrith NSW", "Penrith 2750" are four distinct strings.
3. **A consent-to-publish model.** None exists — and `quotes.preview_image_path` is a render **of the customer's own uploaded photo of their property**; it is PII, and every serving path today is token-gated to that one customer. Roofing "after" images derive from Google satellite imagery — a different but equally real licensing constraint for public redisplay.
4. **A gallery component.** None exists anywhere in `app/` or `redesign/`.

Closest existing rows: `invoice_extractions` (mig 075) has `customer_suburb + job_type_guess + scope_description + total_inc_gst + invoice_date` and an invoice implies completed work — but it exists for **pricing calibration, not display**. `tenant_historical_quotes` (mig 137) has **no location field at all**.

**Recommendation: out of scope for v1.** It is a four-part build (completion signal → geocoding → consent → gallery), not a section on a page.

### Design system

- **Canonical tokens are the YAML frontmatter of `../DESIGN.md`**: canvas `#16120F`, sunken `#1E1813`, card `#2B2422`, hairline `#3A322C`, accent `#FFC400` (press `#E6AC00`, soft `#FFD23D`, on-accent ink `#1C1812`), text `#F6F1EA`/`#C3B8AC`/`#A2968A`. Fonts Manrope (display + body) + JetBrains Mono (labels/prices/metadata). 4px spacing grid.
- **`app/q/[token]` already uses the canonical yellow/charcoal tokens.** A grep for the retired hexes (`#0E1622`, `#FF5A1F`) across the whole `app/q` tree returns **zero** hits. It renders inside a self-contained `.qm-quote` token scope that re-pins every colour locally so the site theme cannot leak in (`app/globals.css:738-769`), exposing `--qm-r-card` 16px / `--qm-r-ctl` 10px.
- **Radius:** `../DESIGN.md:203` carries a product-owner "Register note (radii)" dated 2026-07 that **explicitly supersedes** the square-corner spec still sitting in `redesign/DesignSystem`. Brand register (this page) = ~8px controls, 12–16px cards. **`redesign/DesignSystem` is stale here — DESIGN.md wins.**
- **`redesign/DesignSystem` React primitives are NOT importable.** They are `.jsx` outside the Next app root; `tsconfig.json:25-29` maps only `@/*` → `./*`. Zero `app/` or `lib/` files import them. **The real primitive library is `app/q/_chrome/parts.tsx`** — pure, server-safe, inline-styled, driven by the `.qm-quote` scope.
- **`MONO` and `SANS` in `parts.tsx:14-15` are module-private (no `export`).** Importing them fails to compile. A new section must re-declare them locally or export them first. *(Build-blocking detail, not a nitpick.)*
- **For the face-holder card, two components already solve it**: `SkeletonTile` (aspect-4/3, animate-pulse gradient, border, centred icon + title + subtitle, `small` variant) and `ClickableImage`, both at `app/q/[token]/PreviewSection.tsx:212-272`. **Both are module-private `function` declarations** — export or lift to reuse. `HeroPhoto` (`parts.tsx:163-175`) is the full-bleed media primitive with a graceful no-src fallback.
- **For the price block**: reuse the `TierCards` treatment — mono, weight 800, 24px, `tabular-nums`, with a 9px mono "inc GST" note (`parts.tsx:404-407`). **For the CTA**: reuse `.qm-cta` (`app/globals.css:868-871`, `parts.tsx:418-421`).
- **Hard rules binding new sections**: The One Signal Rule (yellow only, ≤~10% of surface); The Dark-on-Yellow Rule (`#1C1812` on yellow — **white is forbidden**, ~1.4:1); All-Caps Display Rule; **Australian English** (colour, organise, licence n./license v., tradie); **zero emoji, absolute** (substitute Lucide line glyphs or mono `· > *`); **no exclamation marks, no em-dashes** (a deliberately-stripped AI tell — use a full stop, comma, or middot). WCAG 2.1 AA, a 2px `--accent-soft` focus ring never removed, `prefers-reduced-motion` collapsing all animation, 44px minimum targets.
- **The print/PDF path must not break**: Gotenberg renders via print media; `.qm-print-hide` strips fixed chrome and `.qm-sheet` flattens borders/radius/shadow/animation (`app/globals.css:889-907`). Any fixed-position or animated new section needs the print treatment.
- **The Letterhead is white-label**: a logo-less tradie falls back to **the tradie's own initials**, explicitly never the QuoteMax mark, because "a customer of Bob's Plumbing should see Bob's brand" (`parts.tsx:104-107`). **This constrains the trust section**: a QuoteMax-branded default video sits in tension with that rule — see D5.

### Tenants, storage, onboarding

- **`tenants` is created in migration 015, NOT `sql/init.sql`** (init only ALTERs it). Reading init.sql alone yields a badly incomplete picture.
- **`website_url` already exists** (mig 141:21) and is already carried on `TenantIdentity` (`lib/quote/tenant-identity.ts:14-30`), which the letterhead already loads. **Jon's "link to their website" needs no new column and no new query.** `logo_path` also already exists (mig 015:41) — mig 141 only added `logo_url` alongside.
- **Highest migration is 174. A new migration must be 175**, paired with `scripts/run-migration-175.mjs` per repo convention.
- **No `video_url`/`intro_video`/`asset_url` column exists on `tenants`.** These would be genuinely new.
- `loadTenantIdentity()` uses a deliberate **two-select graceful-degradation** pattern: base columns, then a **separate best-effort select** for mig-141 columns so a pre-migration deploy degrades to nulls instead of 500-ing the public quote page (`tenant-identity.ts:6-10`, `:50-55`). **Any new tenants column read by the quote page must join the second select, not the first.**
- Storage: **seven** buckets (`intake-photos` private/signed, **`tenant-logos` PUBLIC**, `quote-pdfs`, `flyer-assets`, `plan-pdfs`, `roof-models`, `catalogue-images`). Two public-URL strategies: private → `createSignedUrl` 24h TTL, re-signed on render; **public → `getPublicUrl()`, stable, never expires** — deliberately, because the letterhead renders it as a plain `<img src>`.
- **`tenant-logos` was provisioned IN SQL by mig 141:25-37** (public, 2 MB cap, mime allowlist, on-conflict upsert into `storage.buckets`) — precedent that a new asset bucket can be created in-migration. (`quote-pdfs` uses a script instead; both patterns are live.)
- `uploadTenantLogo()` **sanitises SVG** before storing to the public bucket (strips `<script>`, `<foreignObject>`, `on*=`, `javascript:`) because a public-bucket SVG from our origin is stored XSS (`lib/storage/upload.ts:95-112`). Any new public asset path handling SVG must reuse `sanitizeSvg()`.
- `app/api/onboard/activate/route.ts:117-141` inserts brand fields with `|| null` coercion and has **full rollback semantics** (`:236-242`, `:397-404`, `:501-509`) — new columns inherit that safety free. `POST /api/tenant/logo` is the post-onboarding asset-change precedent.
- **There is no generated `database.types.ts`** anywhere — no canonical `Tenant` type. Every consumer hand-writes its own partial row type.
- Uncommitted: `lib/onboard/schema.ts` dropped the `superRefine` making `logo_url` **required** for web onboarding (now optional on every channel, initials monogram is the fallback); `app/onboard/page.tsx` dropped logo from the Step-1 gate; `lib/onboard/schema.test.ts` inverted the reject-assertion to accept. **`lib/brand/` is untracked and imported by the modified onboard page.**
- Working-tree junk at repo root that is not source and should not be committed: `0`, `50e6`, `AttributeError`, `covered`, `{,-`.

### Existing contracts and test blast radius

- **`specs/price-and-tier-fixes.md`** (2026-07-15) already set the roofing labels to `{good:'Patch', better:'Full roof replacement', best:'Upgraded roof replacement'}` and de-duped the five display maps via `tierLabelsForTrade`. It explicitly ruled **pricing.ts, the PDF, and the stored `labelWord` out of scope** — that constraint was for that build, not this one, but the label strings it set are now the contract.
- **`specs/quote-visual-parity.md`** (2026-07-10) governs the property-visuals block and is **cited in live code** as the contract (`lib/quote/property-visuals.ts:1`). Its standing constraints that bind here: never trigger a billable Gemini/AI render from a PDF or a customer page load; PDFs stay under 5 MB; API keys stay server-side; house test style is **node-env vitest with DI/fake objects (no `vi.mock`), colocated `*.test.ts`**; migrations follow the repo convention **including `notify pgrst, 'reload schema'`**.
- **`lib/quote/report-adapters/registry.ts`** is a trade→adapter registry for the unified PDF quote viewer that **classifies roofing as `TRADIE_AUTHORED` rendering Good/Better/Best** (`:10`, `:14`), consumed by the edit route, chat-edit route, and `app/dashboard/quote/[token]/QuoteReportViewerClient.tsx`. **It — not the estimator — is what the edit routes actually branch on.** A roofing single-price change must reckon with it.
- **`lib/quote/tier-materialise.ts` (`seedLineItems`)** exists precisely because a tier jsonb with no `line_items` **400s** the edit route's min-1-line schema. Any new single-price tier shape must satisfy it.
- **`lib/quote/send-customer.ts`** (`buildQuoteEmail`, behind the dashboard "Send to Customer" and the approve route) renders quote content to Resend. **A five-section restructure changes what the email says** — no topic covered email.
- **Breaking e2e**: `tests/e2e/roofing-quote-workflow.spec.ts` is the only end-to-end coverage of this flow and hard-asserts (a) the **Better-tier inc-GST figure renders on `/q/[token]` for a roofing quote** (`:144`) and (b) **`/r/<token>/better` 302s to `/q/<token>/book`** (`:165`). R3 breaks (a); R7 breaks (b).
- **Breaking unit tests**: `lib/quote/report-html.test.ts` asserts the PDF "renders every tier with inc-GST headline prices" using a **roofing** fixture and drives `resolveVisibleTiers` (`:12`, `:87`).
- **`app/q/[token]/page.tsx` has zero unit or component tests** (1354 lines). No e2e covers the electrical/plumbing customer page, `/q/[token]/paid`, or `/q/[token]/cancelled`. 35 `*.test.ts` live under `lib/quote` alone; the load-bearing ones here are `tier-visibility` (14 cases), `report-html`, `select-tier`, `accept`, `booking`, `paid-confirm`, `trade-format`, `hold`, `early-bird`, `display`, `pdf-signature`, `tier-materialise`, `trade-booking`.
- Dead/known-bad nearby: `app/q/[token]/TierBreakdownToggle.tsx` has **zero importers** (superseded by the inline `<details>`); `app/q/[token]/cancelled/page.tsx` is a **17-line unstyled stub** with no DB read and **no link back into the funnel** — a cancelled customer dead-ends.

## Decisions required before build (BLOCKING)

These change what gets built. **Do not guess; do not start R6–R8 until D1 and D2 are answered.**

- **D1 — Reverse the funnel order?** Jon describes **pay → book → thank-you**. `/q/[token]` is **book → pay → paid** and has been deliberately since 2026-07-08, with the recorded rationale that an abandoned checkout never strands a slot (`app/api/q/[token]/book/route.ts:11-15`). The opposite order is equally deliberate on the trade surfaces (`app/api/q/book/[trade]/[token]/route.ts:80-86`). **Reversing it for the $99 means an unpaid customer can no longer hold a time, and a paid customer who never picks a slot becomes a new state to chase.** Options: (a) reverse for `tier=inspection` only, leaving deposit tiers book-first; (b) reverse for all tiers on `/q/[token]`; (c) keep book-first and instead make the *existing* `/q/<token>/paid` page the thank-you page Jon wants. **Recommendation: (a).** It matches Jon's words for the product he named ($99), leaves the deposit funnel's slot-hold model untouched, and mirrors an order already proven on the roofing surface. (c) is the smallest diff and worth putting to Jon, because the pages he wants largely exist already — they just run in the other order.
- **D2 — Which surface is "the quote page"?** Evidence says `/q/[token]` with `trade='roofing'`, because `/q/roof/[token]:184` redirects unpaid promoted quotes there. **Confirm Jon is describing `/q/[token]`.** If he is describing `/q/roof/[token]` (e.g. he has been looking at a `?full=1` tradie view or a paid receipt), the scope changes completely — that page has no tier-mode wiring, its own $99 route, and its own booking table. **Recommendation: build for `/q/[token]`; treat `/q/roof/[token]` as R3b only.**
- **D3 — Section 1 for roofing.** Jon wants "a simple description of the job determined from conversations on text or voice". **Roofing has no conversational description** — `intake.scope` is a measurement snapshot with no `description` key, and roofing never runs the LLM structurer. Options: (a) Section 1 for roofing renders the deterministic scope line (`tierScopeLine`) and Jon's "from conversations" wording simply does not apply to roofing; (b) capture a description on the roofing intake path (new work, new field); (c) Section 1 falls back to the address + roof form for roofing. **Recommendation: (a)**, and tell Jon that on roofing the overview is derived from the measurement, not a conversation.
- **D4 — Who confirms the Section 2 sentence?** Jon: "but we can confirm this sentence." **No write path for `scope_of_works` exists** and no tier carries a description. Options: (a) generated and shown as-is, no confirmation (v1); (b) add `scope_short` to the edit route's schema so the tradie can edit it pre-send; (c) reuse the existing `report_doc` editor, which already seeds from `scope_of_works` — but it never writes back, so the customer page would still show the unedited string. **Recommendation: (a) for v1, (b) next** — and note (c) is a trap: editing the report doc does **not** change what the customer page shows.
- **D5 — QuoteMax-branded default video vs the white-label rule.** `parts.tsx:104-107` states a logo-less tradie must never show the QuoteMax mark because "a customer of Bob's Plumbing should see Bob's brand". A **QuoteMax-branded default video in the tradie's trust section directly contradicts that.** Options: (a) the default is unbranded/generic (about the *process*, not about QuoteMax); (b) accept the contradiction for pilot tenants only; (c) hide Section 3 when the tenant has no video. Jon explicitly rejected (c) ("we will default it with a quote max video"). **Recommendation: (a)** — brief the default video as "how the $99 site visit works" with no QuoteMax branding on screen. **Put this to Jon before filming.**
- **D6 — Which pricing inconsistencies?** Jon named none. P1, P2, P6, P7 are the money-visible ones (customer sees a number we do not charge). **Recommendation: fix P1, P2, P4, P6, P7 in this spec; defer P3/P5/P8/P9/P12/P13 to a follow-up** unless Jon names others. **Check the DB for any `gst_registered = false` tenant before sizing P1.**
- **D7 — "Jobs we've done near you".** Recommend **out of scope for v1** (see Context). Confirm with Jon that it drops from Section 3.

## Task

### R1 — Section 1: Overview of the job

Render `quotes.scope_of_works` as the first section of the sheet, retitled from "Scope of works" to plain-English framing. The render surface already exists (`page.tsx:936`, the `Scope` component). Per **D3**, roofing's overview derives from the measurement, not a conversation.

- Section order becomes: Letterhead → **[1] Overview** → **[2] Job details** → **[3] Trust** → **[4] Price** → **[5] CTA** → credential footer.
- Numbered-card treatment (`../DESIGN.md:226`: mono accent number + uppercase Manrope 800 title) — the existing signature component, already used by `PreviewSection` as "03 ·" / "04 ·".

### R2 — Section 2: Job details (one sentence)

- **Persist `scope_short`.** Add `quotes.scope_short text` (migration 175). In `app/api/estimate/draft/route.ts:801-802`, write it to the row instead of discarding it. `app/api/quote/[id]/edit/route.ts:164-168`'s "ephemeral" comment must be updated — it documents the behaviour this R reverses.
- **Roofing has no `scope_short`.** Populate it on the roofing path from the existing pure `tierScopeLine()` (`lib/roofing/pricing.ts:446`) for the **recommended tier**, written at `app/api/roofing/save-as-quote/route.ts`. This is the sentence in Jon's example shape.
- Render `scope_short` as Section 2, falling back to the SMS's existing first-sentence slice of `scope_of_works` (`lib/sms/templates.ts:948-962`) when null, so pre-migration rows still render.
- Per **D4**, v1 shows it as generated. Do **not** wire the `report_doc` editor to it.

### R3 — One price option for roofing

**This is a view change, not a pipeline change.** The producer keeps emitting three tiers (five hard blockers to changing arity — see Context; and `save-as-quote/route.ts:209-219` explicitly forbids nulling them).

- **R3a — Config, not code, for `/q/[token]`.** Set `pricing_book.quote_tier_mode = 'single'` where `trade = 'roofing'`. `single` → `pickRecommendedTier` → honours `selected_tier`, which `save-as-quote/route.ts:222-224` already sets from `tiers[1]` = `better` = **"Full roof replacement"** — exactly Jon's one option. **`/q/[token]` already honours this** (`:542-549`). No page change required for the customer-facing path.
  - Ship it as a **data change in migration 175** (`update pricing_book set quote_tier_mode='single' where trade='roofing'`), not a code default, so a tenant can still be moved back.
  - `pdf_signature` (mig 146) self-heals the cached PDF. The roofing PDF and SMS already honour tier mode.
- **R3b — Close the one outlier.** `app/q/roof/[token]/page.tsx:404-434` renders all three tiers unconditionally and never reads `pricing_book`. Wire it to `resolveVisibleTiers` exactly as `app/q/paint/[token]/page.tsx:123-129` already does. *(Post-payment receipt + `?full=1` tradie view only — but it is the last customer-reachable surface out of step.)*
- **R3c — Do not touch** `app/dashboard/roofing/measure/page.tsx:738` or `app/m/[token]/MeasurementReview.tsx:454`. Both hardcode three tiers; both are **tradie-internal**, and the tradie must keep seeing all three to choose. Note this explicitly so `/review` does not flag it.
- **Reckon with `lib/quote/report-adapters/registry.ts:10-14`**, which classifies roofing as `TRADIE_AUTHORED` rendering G/B/B and is what the edit + chat-edit routes branch on. Confirm a `single`-mode roofing quote still edits without a 400 (see `lib/quote/tier-materialise.ts`).

### R4 — Section 3: Trust (face-holder placeholder in v1)

- **Migration 175 adds four nullable `text` columns to `tenants`**, following the mig-141 precedent exactly (public URL + optional storage path): `intro_video_url`, `intro_video_path`, `thankyou_video_url`, `thankyou_video_path`.
  - **No upload UI.** QuoteMax films and sets these (D-confirmed by Jon). No onboarding-wizard change, no `/api/tenant/video` route in v1.
  - **No storage bucket in v1** — nothing to store yet. When the first video is filmed, either host externally and set the URL, or add a public `tenant-videos` bucket following mig 141:25-37. Adding the bucket now is speculative.
- **Surface them via `lib/quote/tenant-identity.ts`.** Add the four columns to the **second, best-effort select** (`:50-55`) and to `TenantIdentity` (`:14-30`) — **not** the base select, or a pre-175 deploy 500s the public quote page.
- **v1 renders a face-holder placeholder, always**, because no video content exists. Both a null column and (for now) a set one render the placeholder; wiring a real player is a follow-up.
  - Reuse the existing `SkeletonTile` pattern (`PreviewSection.tsx:253-272`) — **export it or lift it to `parts.tsx`; it is currently module-private.** Same for `MONO`/`SANS` (`parts.tsx:14-15`) if the new section needs them.
  - Face-holder = a 4:3/16:9 tile on `--ink-card` with a hairline border, a centred Lucide user/play line glyph (strokeWidth 1.75), and a mono caption. **No emoji. No exclamation marks. No em-dashes.** Australian English.
  - Caption must be honest about what it is — it is a placeholder, not a loading state. Do not use `animate-pulse` (that reads as "loading", and it is not).
- **Website link:** render `TenantIdentity.website_url` — **already loaded, no new column, no new query.** Link only when it parses as an absolute `https://` URL (the `GOOGLE_BOOKING_URL` guard at `lib/quote/booking.ts:125-138` is the in-repo precedent).
- **"Jobs we've done near you" is out of scope** per **D7**.
- Per **D5**, resolve the QuoteMax-branded-default vs white-label contradiction before filming.
- **Print path:** the placeholder must render sanely or hide under `.qm-print-hide` — Gotenberg renders this page to the customer PDF.

### R5 — Section 4: Price (just the price)

- Render one price: the single visible tier's inc-GST figure, in the existing `TierCards` price treatment (mono, 800, 24px, `tabular-nums`, 9px "inc GST" note — `parts.tsx:404-407`).
- **"Not a lot of detail" is already a config**: set `pricing_book.quote_display = 'summary'` for roofing rather than adding a new flag (`lib/quote/display.ts:49`; hard default is `'itemised'`). Ship as a data change in migration 175 alongside R3a.
- Suppress the itemised `<details>` breakdown in `summary` mode (it is the surface whose rows are **ex-GST** and do not sum to the inc-GST headline — P-note in Context).
- **The recommended badge already self-suppresses** at one visible tier (`page.tsx:552`). Do not add a second suppression.

### R6 — Section 5: CTA ($99 site inspection) — *blocked on D1*

- One primary CTA: **"Book a site inspection — $99"**, using `.qm-cta` (`app/globals.css:868-871`). Dark-on-yellow (`#1C1812`); **white on yellow is forbidden**.
- Target follows D1. Today it is `/r/<token>/inspection` (`page.tsx:590`), which the page already builds directly rather than depending on a stored `stripe_links.inspection` (`:486`) — keep that.
- **Single source of truth for the fee.** The $99 is currently defined twice in two units (`checkout.ts:63` cents, `draft/route.ts:377` dollars) and hardcoded again in the voice prompt, dashboard, and pricing page. **Export one constant and have the CTA copy read from it** rather than hardcoding a fifth `$99`. Do **not** attempt `pricing_book.inspection_fee_amount` in this spec — that is a per-tenant pricing decision nobody has made.
- Roofing indicative quotes **already** withhold the per-tier deposit CTA and route to the $99 (`page.tsx:1032`) — this is already Jon's behaviour; preserve it.

### R7 — Post-payment booking page — *blocked on D1*

Per D1(a): for `tier=inspection` only, `payRedirectTarget` (`lib/quote/booking.ts:46-84`) stops routing to `/q/<token>/book` **before** payment and instead mints Stripe directly; `/q/<token>/paid` then routes a date-less inspection payer to the picker rather than the `:225-227` redirect doing it implicitly.

- `POST /api/q/[token]/book` must then **require `paid_at` for `tier=inspection`**, mirroring `app/api/q/book/[trade]/[token]/route.ts:80-86` verbatim ("Pay the deposit first, then pick your time.", 409).
- **Leave deposit tiers (`good`/`better`/`best`) book-first.** Do not touch the slot-hold model.
- The `/book` page's 6-state machine (`app/q/[token]/book/page.tsx:219-276`) gains no new state — a paid inspection lands in `PickState`.
- **Known race, do not regress:** no slot-level lock or DB constraint prevents two customers reserving the same window; the exclusion is a read-then-write (`buildBookedKeys`) with an acknowledged race.

### R8 — Thank-you page with the tradie's second video — *blocked on D1*

- After a slot is picked, land the customer on a confirmation page carrying the **thank-you face-holder placeholder** (R4) and Jon's message: *we have received your request and we will be in touch to confirm the exact time of the inspection.*
- **`app/q/[token]/paid/page.tsx` already exists and already renders a booked/confirmed state** with a "What's booked" card (Tradie / Job / Visit / Suburb / Quote ref / Tier paid). **Extend it; do not create a fourth page.** Under D1(c) this page *is* the answer.
- **It still uses the retired Maintain design system** (Topo SVG, `BrandMark`, `Shell`) while `/q/[token]` uses the canonical `.qm-quote` tokens. Migrating it is in scope for visual continuity; flag it if it balloons.
- **Do not regress the webhook race guard** (`paid/page.tsx:182-220`): when `paid_at` is null but `?session_id=` is present it retrieves the Session, validates via `sessionConfirmsQuote`, and runs the same `finalisePaidQuote` the webhook runs. It has **no test** — add one.
- Fix the dead-end while here: `app/q/[token]/cancelled/page.tsx` is a 17-line unstyled stub with no link back into the funnel.

### R9 — Pricing inconsistencies — *scope set by D6*

Recommended set:

- **P2 (page hardcodes `depositPct = 30`)** — read `quotes.deposit_pct` exactly as `app/r/[token]/[tier]/route.ts:179-189` already does. Smallest, most clearly-a-bug fix; the page advertises a number the checkout does not charge.
- **P1 (GST unconditional in display + Stripe, conditional in the DB writes)** — **check the DB for a `gst_registered = false` tenant first.** If none exists, this is latent, not live: fix it, but size it accordingly.
- **P4 (two renderers discount at different points in the GST maths)** — pick one order and make both use it. Prefer `TradeTiers`' order (discount the ex-GST base, then convert and round once) — fewer rounding steps.
- **P6 (SMS never applies the discount but links a discounted Session)** and **P7 (PDF has zero discount awareness)** — both show a customer a number we do not charge.
- **Extract one shared money module** (`lib/quote/money.ts` or similar) exporting `incGst` + one `formatCurrency`, and route the 5 duplicate `incGst` copies and 4 formatters through it. **Everything above is a symptom of its absence.** Keep it pure; colocate `money.test.ts`.
- **Add the cross-surface parity test that does not exist**: one fixture quote, assert page / SMS / PDF / Stripe agree on total, deposit, and discounted total. **This is the regression net for the whole table** and is worth more than any individual fix.

## Constraints

- **No pricing-model redesign.** The estimator and `lib/roofing/pricing.ts` keep producing three tiers. R3 is a **view** change (`resolveVisibleTiers`), full stop.
- **Do not null `quotes.good/better/best` for roofing** — `save-as-quote/route.ts:209-219` explicitly forbids it and nulling re-introduces a known blank-roofing-quote bug.
- **Do not change tier arity** — five hard blockers (fixed 3-tuples, a length-3 Zod gate, positional indexing ×2, `assertTierMonotonic`).
- **Do not touch** `pricing.ts`, the stored `labelWord`, or the roofing tier labels set by `specs/price-and-tier-fixes.md`.
- **Never trigger a billable Gemini/AI render from a PDF or a customer page load** (`specs/quote-visual-parity.md`). PDFs stay under 5 MB. API keys stay server-side.
- **One migration only: 175**, paired with `scripts/run-migration-175.mjs`, following repo convention **including `notify pgrst, 'reload schema'`**. Additive only — no drops, no renames.
- **New `tenants` columns join the SECOND best-effort select** in `lib/quote/tenant-identity.ts`, never the base select.
- **Design:** canonical tokens only (`../DESIGN.md` frontmatter wins over the stale `redesign/DesignSystem`). `redesign/DesignSystem` primitives are **not importable** — compose from `app/q/_chrome/parts.tsx`. **Australian English; zero emoji; no exclamation marks; no em-dashes.** Dark-on-yellow only. WCAG 2.1 AA, 44px targets, focus ring never removed, `prefers-reduced-motion` honoured.
- **House test style:** node-env vitest, DI/fake objects (**no `vi.mock`**), colocated `*.test.ts`.
- **Next 16:** `params` is a `Promise` — await it. Read `node_modules/next/dist/docs/` before writing route handlers.
- **Commit `lib/brand/`** (currently untracked and imported by the modified onboard page — the tree does not build from a clean clone). **Do not commit** the root junk: `0`, `50e6`, `AttributeError`, `covered`, `{,-`.
- Minimal: no new files beyond this spec, the migration + runner, the shared money module, and tests. No unrelated refactors.

## Acceptance criteria & gates

1. **`pnpm test` green**, including new/updated:
   - `lib/quote/money.test.ts` (new) — `incGst` conditional on `gst_registered`; one `formatCurrency`; discount order applied once.
   - **Cross-surface parity test (new)** — one fixture quote; page, SMS, PDF and the Stripe line item agree on total, deposit, and discounted total. *(The single most valuable test in this spec.)*
   - `lib/quote/tier-visibility.test.ts` — a roofing quote in `single` mode resolves to `better` ("Full roof replacement") via `selected_tier`.
   - `lib/quote/report-html.test.ts` — **existing roofing fixture asserts every tier renders**; update for single-mode roofing.
   - `lib/quote/tenant-identity.test.ts` — the four video columns degrade to null on a pre-175 schema without throwing.
   - `app/api/estimate/draft` — `scope_short` is persisted, not discarded.
   - Roofing `scope_short` is populated from `tierScopeLine()` for the recommended tier.
   - *(If D1 = a)* `lib/quote/booking.test.ts` — `tier=inspection` mints Stripe pre-slot; `POST /api/q/[token]/book` 409s an unpaid inspection; **deposit tiers still book-first**.
   - `app/q/[token]/paid` webhook-race guard — currently untested; add coverage.
2. **`pnpm run typecheck` green.**
3. **`pnpm test:e2e` green**, including:
   - `tests/e2e/roofing-quote-workflow.spec.ts` — **will break at `:144` (asserts the Better inc-GST figure renders among tiers) and `:165` (asserts `/r/<token>/better` 302s to `/q/<token>/book`)**. Update deliberately, not by deleting assertions.
   - New: a seeded roofing quote on `/q/[token]` renders exactly five sections, **one** price, the face-holder placeholder, and one $99 CTA.
   - New: `/q/[token]/paid` renders the thank-you placeholder.
4. **Live verification** (`/verify` with `/playwright-cli`) on the dev server: a seeded roofing quote at `/q/[token]` shows one option labelled "Full roof replacement", one price, the two placeholders in the right slots, and the $99 CTA; the funnel walks end-to-end in the D1-agreed order. Screenshot evidence in both light and dark (`data-qm-theme`) — the page ships a theme toggle.
5. **PDF unbroken**: the Gotenberg render of a restructured quote still produces a sane document (the page's PDF button is `/api/q/download?path=…&theme=…`).
6. **`/review` confirms every R1–R9 item; `/code-review` reports no blocker/major.**
7. **Explicitly out of scope, state so in the review**: "jobs we've done near you" (D7), tradie-internal three-tier surfaces (R3c), `scope_of_works` write path (D4), video upload UI, `tenant-videos` bucket, real video playback.

## Examples

<example>
**Why R3 is config, not code.** `pickRecommendedTier` honours `selected_tier`; `app/api/roofing/save-as-quote/route.ts:222-224` already sets `selected_tier` from `p.tiers[1]`; `trade-format.ts:213` already names `better` **"Full roof replacement"**. So `quote_tier_mode='single'` on `trade='roofing'` renders precisely Jon's "one option for roof replacement" with **no page change** — `/q/[token]:542-549` already reads the mode. The work is one `update` in migration 175 plus closing the `/q/roof/[token]` outlier (R3b).
</example>

<example>
**The funnel Jon describes already exists — on the other surface.** `app/api/q/book/[trade]/[token]/route.ts:80-86` is pay-first, book-second, with the comment: *"These jobs book AFTER paying the deposit / $99 site visit (that's the 'order' the customer places), so we require paid_at before accepting a slot."* That is Jon's order, verbatim, already shipped for roofing measurements. D1 is really: which of our two existing, deliberate, contradictory orders wins on `/q/[token]`.
</example>

<example>
**Section 2's sentence is generated today and thrown away.** `electrical-estimator.ts:282-283` emits `scope_short`; `draft/route.ts:801-802` hands it to the SMS builder and drops it; no column exists. R2 is mostly *stop discarding it* — the generation, the grounding rule ("must not invent features"), and the ≤80-char guidance already exist.
</example>

<example>
**Do not import from `redesign/DesignSystem`.** It is `.jsx` outside the app root and `tsconfig.json:25-29` maps only `@/*` → `./*`. Zero app files import it. Compose from `app/q/_chrome/parts.tsx` — and note `MONO`/`SANS` (`:14-15`) and `SkeletonTile` (`PreviewSection.tsx:253`) are **module-private**; export them before reuse or the build fails.
</example>

<example>
**The white-label tension in D5.** `parts.tsx:104-107`: a logo-less tradie shows **their own initials**, never the QuoteMax mark, because "a customer of Bob's Plumbing should see Bob's brand". Jon's "default it with a quote max video" puts a QuoteMax asset in the tradie's trust section. Brief the default as an unbranded "how the site visit works" film and the rule holds.
</example>
