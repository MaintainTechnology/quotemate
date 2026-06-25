# Roofing inspection quotes — indicative pricing instead of blank/$0 — Spec

> Status: **BUILT + REVIEWED (PASS), 2026-06-25.** All decisions confirmed by the
> founder (indicative range; mixed-job total = priced secondaries only; ship on
> with no feature flag) and the reconciliation principle accepted (Open Q#1
> resolved). All three open questions are now resolved. Companion build prompt
> with verified file:line root cause:
> [`specs/roofing-inspection-indicative-fix.md`](roofing-inspection-indicative-fix.md).
>
> **Update (Open question #3 resolved by code search):** there are **two live
> customer roofing surfaces**, and the fix must cover **both** — `/q/roof/[token]`
> (the primary SMS-receptionist path, backed by `roofing_measurements.public_token`)
> **and** `/q/[token]` (the `save-as-quote`/`quotes.share_token` path). `/q/roof/[token]`
> is NOT legacy. An earlier note in this conversation that called it legacy was wrong.

## Objective
When a roofing measurement routes to `inspection_required` (a "needs on-site visit" job — complex roof form, COLORBOND / steep / unknown pitch, cement-sheet, 3+ storeys, null area, or outside Geoscape coverage), the customer's quote page currently shows **no price at all** — an apparently blank/$0 quote — while the tradie-owner view shows a real price for the *same* job. The grounded Good/Better/Best numbers exist in the database; they are only hidden at customer render. This fix shows those grounded numbers to the customer as an **indicative estimate** ("subject to on-site confirmation") so on-site-flagged roofing jobs never read as blank/zero, and so the customer and owner views stop disagreeing. It is for QuoteMate's roofing customers and the tradies who send them quotes.

## Context / background
**Verified root cause (confirmed against the code):**
- Roofing persists real computed tiers in `quotes.good/better/best` even on inspection: `buildTierObjects()` always returns full tiers (`lib/roofing/save-as-quote-helpers.ts:16-46`) and `app/api/roofing/save-as-quote/route.ts:177-209` writes them alongside `needs_inspection: true`. The numbers are in the DB — this is a render/consistency bug, not an upstream zeroing bug.
- **There are two live customer roofing surfaces — both have this bug and both must be fixed:**
  - **`/q/roof/[token]` — the primary, SMS-receptionist path** (`app/q/roof/[token]/page.tsx`), backed by `roofing_measurements.public_token`. The SMS receptionist sends the customer here (`app/api/sms/inbound/route.ts:487`, `:629` build `${baseUrl}/q/roof/${token}`); dashboard "View" and PDF links target it too (`app/dashboard/page.tsx:11759`, `app/api/tenant/trade-jobs/route.ts:83`, `lib/quote/pdf.ts:303`). This is almost certainly the founder's actual repro path. Price suppression: `isInspection = row.routing === 'inspection_required' || quote?.routing?.decision === 'inspection_required'` (`:152`) → `showPrices = confirmed && !isInspection` (`:154`), which hides the combined total (`:233`) and per-structure prices (`StructureBreakdown showPrices=` at `:263`). **Note:** this page **already** implements the chosen mixed-job behavior via `partitionRoofQuote()` (`:138-150`) — it excludes inspection-routed structures from the headline total and labels them "on inspection." The bug is purely the wholesale `showPrices` gate plus the lack of an indicative fallback when the *whole* job is inspection-routed.
  - **`/q/[token]` — the `save-as-quote` path** (`app/q/[token]/page.tsx`), backed by `quotes.share_token`. The share link `${origin}/q/${share_token}` is built at `app/api/roofing/save-as-quote/route.ts:224`; the page explicitly handles roofing customers (comment at `:621-622`). Price suppression is at `:623`: `{isInspection ? <InspectionBlock .../> : <priced tiers>}`, where `isInspection = !!quote.needs_inspection` (`:419`); the comment at `:450` encodes a false assumption — *"an inspection quote has no priced tiers"* — untrue for roofing.
- Owner-side: `TradieEditor` (`app/q/[token]/page.tsx:467-508`) receives `good/better/best` unconditionally (no `isInspection` check); it is an owner-only overlay ("renders nothing for customers", `:466`). This is why the owner sees a price and the customer sees none.
- Multi-structure totals exclude inspection-routed structures: `quotable = chosen.filter(s => !isInspection(s))` then sum only those (`lib/sms/roofing-compose.ts:228-240`; mirror in `lib/roofing/selection.ts:122-182`).
- Inspection SMS states no price: `composeInspectionMessage()` (`lib/sms/roofing-compose.ts:143-161`).
- Inspection trigger: `requiresInspection()` (`lib/roofing/pricing.ts:58-120`).
- Owner measurement-review page: `app/m/[token]/MeasurementReview.tsx:255-270` (already shows numbers).

**Unifying principle behind the founder's choices (the rule that resolves all cases):**
> **Indicative numbers are a fallback shown only when the job has no firm price to anchor on. When any structure is cleanly priced, lead with the firm number and label the inspection-routed parts "priced on site."**

This single rule makes the founder's two answers consistent:
- No firm price anywhere (single inspection-routed roof, or all structures inspection-routed) → show grounded tiers as an **indicative range**.
- At least one firm-priced structure (mixed job) → headline total = **firm priced structures only**; inspection-routed structures show **"priced on site"** (no number in the headline).

**Owner ↔ customer consistency, stated precisely:** the app must never show the customer a blank/$0 while the owner sees a price. For a whole-job-inspection quote the customer sees the *same* indicative tiers the owner sees. In a mixed job the customer sees firm secondaries + "priced on site" for inspection structures while the owner still sees the underlying numbers in their editor — this difference is intentional working data, not the bug.

## Requirements
1. Apply the fix to **both** live customer roofing surfaces — `app/q/roof/[token]/page.tsx` (the SMS-receptionist path; gate at `:152-154`) **and** `app/q/[token]/page.tsx` (the `save-as-quote` path; gate at `:623`). On each, when a roofing quote is `inspection_required` **and** it has no firm-priced structure (single inspection-routed structure, or all structures inspection-routed), render the grounded Good/Better/Best tiers to the customer instead of suppressing them. On `/q/roof/[token]` this means decoupling `showPrices` from `isInspection` so the combined total (`:233`) and per-structure prices render, and adding an indicative fallback so an all-inspection job sums all structures (since `partitionRoofQuote()` would otherwise exclude them and leave a $0 total). On `/q/[token]` this means replacing the `isInspection ? <InspectionBlock> : <tiers>` branch so roofing inspection quotes with non-null tiers show the tiers.
2. Those indicative tiers must carry a clear, visible label that the price is an estimate confirmed on site — e.g. a banner "Indicative estimate — your final price is confirmed after a quick on-site visit" — plus the existing inspection reason text and an on-site booking CTA. **The "$99 refundable site visit" CTA is surface-specific** (resolved — see Open question #2): show it only on `/q/[token]`, which has the real $99 inspection Stripe link (`stripeLinks.inspection`). On `/q/roof/[token]` the on-site visit is booked through the existing "reply YES to our SMS" flow and **no $99 charge exists**, so that surface shows the indicative label + a reply-to-book CTA and must **not** fabricate a $99 figure (R8). Do not invent a $99 Stripe checkout on `/q/roof/[token]`.
3. For a **mixed** roofing job (≥1 cleanly-priced structure + ≥1 inspection-routed structure), the customer headline Good/Better/Best total must equal the sum of the **cleanly-priced structures only**; each inspection-routed structure is shown as "priced on site" with no dollar figure in the headline. The headline total must be > $0. `/q/roof/[token]` already implements this via `partitionRoofQuote()` (`:138-150`) — preserve it (it must keep working once `showPrices` is decoupled from `isInspection`). `/q/[token]` must gain the equivalent behavior if it serves multi-structure roofing quotes.
4. The customer must never see a blank or $0 roofing quote. Every inspection-routed roofing quote resolves to either (a) an indicative range, or (b) firm secondaries + "priced on site" — never nothing.
5. Roofing inspection quotes keep their real tiers in `quotes.good/better/best` in the database (do not null them). Add a short code comment near `app/api/roofing/save-as-quote/route.ts:177-209` recording that this is intentional so the tiers are not later nulled.
6. The owner views (`app/m/[token]/MeasurementReview.tsx` and the `TradieEditor` overlay) keep showing numbers; align their wording to the same "indicative — confirmed on site" language used on the customer page for the whole-job-inspection case. No change to *whether* the owner sees numbers.
7. Update the roofing inspection SMS (`composeInspectionMessage()` and the multi-structure path in `lib/sms/roofing-compose.ts`) so the text matches the page: the indicative range for whole-job-inspection, or firm secondaries + "priced on site" note for mixed jobs. Keep AU phrasing.
8. Customer-visible indicative numbers must come only from the engine output already stored in `quotes.good/better/best`. Never fabricate or re-derive prices in the render/SMS layer.
9. The fix is scoped to roofing only (by `trade` / the roofing surfaces). Generic tier rendering for other trades is unchanged.
10. Ship the behavior on, with **no feature flag** — no `ROOFING_INSPECTION_INDICATIVE_PRICES` env var or equivalent gate.

## Non-goals
- Changing the ungroundable-estimate inspection fallback for **electrical / plumbing / painting / solar**. Those correctly null tiers and show the $99-only route via `app/api/estimate/draft/route.ts:~399-415`, `forceInspectionTiers()` (`lib/estimate/inspection-normalize.ts`), `lib/estimate/run.ts`, and `buildInspectionQuoteSms()` (`lib/sms/templates.ts`). Leave them exactly as-is.
- Changing when a roof routes to inspection (`requiresInspection()` logic in `lib/roofing/pricing.ts` stays as-is).
- Adding a feature flag, A/B test, or staged rollout.
- Re-pricing, re-estimating, or improving roofing price accuracy. This fix changes *display/consistency*, not the numbers.
- Reworking the owner dashboard CRM or the measurement flow beyond the wording alignment in Requirement 6.

## Constraints
- Next.js 16 App Router (`quotemate-automation/`). Read `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guide before writing Next code — this is not the Next.js in training data.
- Money conventions: store ex-GST, display inc-GST, AU formatting (`en-AU`). Do not change how `inc_gst`/`ex_gst` are stored or computed.
- Multi-tenant: scope all changes by the roofing `trade`; do not leak indicative behavior into other trades' rendering.
- If any DB/schema change proves necessary (none is expected — the tiers already persist), add a new `sql/migrations/NNN_*.sql` + matching `scripts/run-migration-NNN.mjs`; do not edit applied migrations.
- No fabricated prices reaching customers — grounding/money-path discipline (tiers come only from stored engine output).

## Edge cases to handle
- Single complex/COLORBOND/steep/cement-sheet/3-storey roof, inspection-routed → indicative Good/Better/Best shown, labelled "subject to on-site confirmation"; never $0. *(This is the founder's exact repro.)*
- All structures in a multi-structure job inspection-routed → indicative total summing all structures; never $0.
- Mixed job (≥1 firm + ≥1 inspection) → headline = firm-priced structures only; inspection structures show "priced on site"; headline > $0.
- A roofing inspection quote whose tiers are unexpectedly null/empty (defensive) → fall back to the existing "$99 on-site quote required" non-blank state; do **not** render a $0 quote and do not fabricate numbers.
- Non-roofing inspection quote (electrical/plumbing/painting/solar) → unchanged: null tiers, $99 inspection route, `buildInspectionQuoteSms()`.
- Owner opening the same token → still sees numbers (no regression); whole-job-inspection wording matches the customer's "indicative" framing.
- Customer opening a roofing inspection quote via SMS link → page and SMS tell the same story (indicative range, or firm + "priced on site").
- Customer arriving via the SMS-receptionist link (`/q/roof/[token]`) on an inspection-routed roof → must show the indicative range (whole-job) or firm secondaries + "on inspection" (mixed); never blank/$0. This is the primary path and must be covered, not just `/q/[token]`.

## Definition of done
- [ ] A single complex roofing job (`inspection_required`, no firm-priced structure) renders indicative Good/Better/Best to the customer on **both** `/q/roof/[token]` and `/q/[token]` — no blank/$0 quote on either surface.
- [ ] Those indicative tiers show a visible "subject to on-site confirmation" label and an on-site booking CTA. The **$99 refundable** CTA appears on `/q/[token]` (which has the $99 inspection Stripe link); `/q/roof/[token]` shows a "reply to book" CTA via its native SMS flow and intentionally states no $99 figure (no such charge exists on that surface — see Open question #2).
- [ ] For a whole-job-inspection roofing quote, the tier numbers the customer sees equal the numbers the owner sees for the same token.
- [ ] A mixed job shows a customer headline total = sum of cleanly-priced structures only, with inspection-routed structures labelled "priced on site"; the headline is > $0.
- [ ] The roofing inspection SMS states the indicative range (whole-job) or firm secondaries + "priced on site" (mixed), matching the page copy.
- [ ] Electrical/plumbing/painting/solar inspection quotes are unchanged (null tiers, $99 route, `buildInspectionQuoteSms()`) — verified by an existing-trade check.
- [ ] No customer-visible price is fabricated: indicative numbers trace to stored `quotes.good/better/best`.
- [ ] Roofing inspection quotes still persist their tiers in the DB (not nulled), with the intent documented near `save-as-quote/route.ts:177-209`.
- [ ] No feature flag / env gate was added for this behavior.
- [ ] GST inc/ex display and AU formatting are unchanged.
- [ ] Project typecheck/lint pass; roofing tests pass.

## Open questions
1. **RESOLVED (founder confirmed via interview + accepted the build, 2026-06-25):** the reconciliation principle holds — *"indicative is a fallback shown only when there is no firm price; lead with firm prices when any exist."* The resulting mixed-job discontinuity is **intended**: a lone complex roof shows an indicative range, but adding a single cleanly-priced firm structure (e.g. a shed) flips that roof to "priced on site" and the headline becomes the firm secondary total. This follows directly from the founder's "only priced secondaries in total" choice and keeps the page and SMS consistent (both lead with the firm price when one exists). The build implements exactly this (`hasFirmPrice` gate on `/q/roof/[token]`; `buildRoofingReplyMessage` routes by quotable-presence).
2. **RESOLVED (review, 2026-06-25):** the **"$99 refundable site visit" CTA is scoped to `/q/[token]`** — the only roofing surface with a real $99 inspection charge (the `stripeLinks.inspection` Stripe link). `/q/roof/[token]` books the on-site visit through its existing "reply YES to our SMS" flow and has **no $99 charge**, so it shows the indicative "subject to on-site confirmation" label + a reply-to-book CTA and must **not** fabricate a $99 figure (would violate R8's no-fabrication rule). The build implements exactly this. Remaining wording is the founder's to finalise (banner/label tone), but no code change is required: if roofing on-site visits later *do* become a $99 charge, add the "$99 refundable" copy to the `/q/roof/[token]` banner then. Default banner copy shipped: `/q/[token]` → "Indicative estimate from your satellite measurement. Your final price is confirmed at a quick on-site visit ($99, refundable and credited to your job)."; `/q/roof/[token]` → "Subject to on-site confirmation … your roofer confirms the final price at a quick on-site visit. Reply to our text and we'll book a time."
3. **RESOLVED (code search):** `/q/roof/[token]` is a **live** customer surface — the primary SMS-receptionist roofing path (`roofing_measurements.public_token`; linked from `app/api/sms/inbound/route.ts:487`/`:629`, the dashboard, and PDFs). It is **not** legacy. Both it and `/q/[token]` (the `save-as-quote`/`quotes.share_token` path) must get the fix; the SMS path is most likely the founder's repro. Remaining sub-question: do both entry points get exercised in production today, or is one dominant? Worth a quick check at build time to prioritise, but **both must be fixed regardless.**
