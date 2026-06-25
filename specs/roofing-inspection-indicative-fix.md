# Build prompt: on-site/inspection-flagged roofing quotes render as all-zero to customers

> Hand this file to a fresh Claude Code session run from the repo root. It is a
> build-ready prompt — the root cause is already diagnosed and verified against
> the code (file:line references below are confirmed). The agent's job is to
> apply the fix end-to-end, verify it, and report coverage.
>
> **CORRECTION (supersedes the single-surface framing below):** there are **two**
> live customer roofing surfaces and **both** must be fixed —
> **`/q/roof/[token]`** (`app/q/roof/[token]/page.tsx`, gate `showPrices = confirmed && !isInspection`
> at `:152-154`), the primary SMS-receptionist path the customer is actually texted
> (`app/api/sms/inbound/route.ts:487`/`:629`), **and** **`/q/[token]`**
> (`app/q/[token]/page.tsx:623`), the `save-as-quote` path. Where this doc treats
> `/q/[token]` as "the live surface, not `/q/roof/[token]`," that is wrong. The
> authoritative, corrected spec is
> [`specs/roofing-inspection-indicative-quotes.md`](roofing-inspection-indicative-quotes.md) —
> prefer it; this file remains useful for the verified file:line root cause.

---

## Role
You are a senior full-stack engineer working in the `quotemate-automation/` Next.js 16 App Router app (Supabase, AU/NZ trades quoting). You will fix a specific, already-diagnosed bug end-to-end: locate the code, apply the change, verify it, and report coverage. Before writing any Next.js code, read `quotemate-automation/AGENTS.md` and the relevant guide under `node_modules/next/dist/docs/` — this is Next 16 and differs from older conventions.

## Context
**Bug:** When a roofing measurement routes to `inspection_required` (complex roof form, COLORBOND / steep / unknown pitch, cement-sheet, 3+ storeys, null area, or outside Geoscape coverage — see `requiresInspection()` in `lib/roofing/pricing.ts:58-120`), the customer's quote page shows **no price** (an apparently blank/$0 quote), while the tradie-owner view shows a real price for the *same* job. The founder wants on-site-flagged roofing jobs to stop reading as blank/zero, and the two views to agree.

**Verified root cause (cite these — they are confirmed in the code):**
- Roofing persists **real** computed tiers in `quotes.good/better/best` even on inspection: `buildTierObjects()` always returns full tiers (`lib/roofing/save-as-quote-helpers.ts:16-46`) and `app/api/roofing/save-as-quote/route.ts:177-209` writes them alongside `needs_inspection: true`. So the numbers exist in the DB — this is a render/consistency bug, **not** an upstream zeroing bug.
- The customer share link is `${origin}/q/${share_token}` (`app/api/roofing/save-as-quote/route.ts:224`) → the **generic** customer page `app/q/[token]/page.tsx` (which explicitly handles roofing customers — see comment at `:621-622`). This is the live customer surface, **not** `/q/roof/[token]`.
- Customer price suppression happens at `app/q/[token]/page.tsx:623`: `{isInspection ? <InspectionBlock .../> : <priced tier cards>}`, where `isInspection = !!quote.needs_inspection` (`:419`). The comment at `:450` bakes in a false assumption — *"an inspection quote has no priced tiers"* — which is untrue for roofing.
- Owner-side leak (the "owner sees a price" half): `TradieEditor` (`app/q/[token]/page.tsx:467-508`) is fed `quote.good/better/best` unconditionally with no `isInspection` check; it is an owner-only overlay ("renders nothing for customers", `:466`).
- Multi-structure: the combined total filters to `quotable = chosen.filter(s => !isInspection(s))` and sums only those (`lib/sms/roofing-compose.ts:228-240`; mirror in `lib/roofing/selection.ts:122-182`), so an inspection-routed primary collapses the headline toward $0.
- Inspection SMS states no price: `composeInspectionMessage()` (`lib/sms/roofing-compose.ts:143-161`).

**Out of scope — do not touch:** the ungroundable-estimate inspection fallback for other trades, which correctly nulls tiers and shows the $99 route: `app/api/estimate/draft/route.ts:~399-415`, `forceInspectionTiers()` in `lib/estimate/inspection-normalize.ts`, `lib/estimate/run.ts`, and `buildInspectionQuoteSms()` in `lib/sms/templates.ts`.

## Task
Make on-site-flagged **roofing** quotes render their grounded computed tiers as an **indicative estimate labelled "subject to on-site confirmation"** instead of a blank/$0 quote, and make the customer and owner views (and the SMS) tell one consistent story. Implement in this order:

1. **Establish the invariant.** Roofing inspection quotes keep their real tiers in the DB and every surface treats them as *indicative*. Add a short comment near `app/api/roofing/save-as-quote/route.ts:177-209` documenting this so no one later "fixes" it by nulling the tiers. Do **not** null roofing tiers on inspection.
2. **Customer page — `app/q/[token]/page.tsx` (`:419`, `:450`, `:623`).** When `isInspection` is true *and* priced tiers exist (roofing), render the tier cards inside an "indicative estimate" wrapper — a prominent banner ("Indicative estimate — your final price is confirmed after a quick on-site visit; $99, refundable, credited to your job") plus the existing inspection reason — instead of suppressing them via `InspectionBlock`. When `isInspection` is true and tiers are null (ungroundable trades), keep the current `InspectionBlock`/$99-only behavior unchanged. Fix the false `:450` assumption accordingly.
3. **Owner consistency — `app/m/[token]/MeasurementReview.tsx:255-270` and the `TradieEditor` overlay.** Align wording to the same "indicative — confirmed on site" language so owner and customer read identically. No change to *whether* the owner sees numbers.
4. **Multi-structure total — `lib/roofing/selection.ts:122-182` and `lib/sms/roofing-compose.ts:228-240`.** When the primary is inspection-routed, ensure the customer still sees a non-zero **indicative** combined total rather than a $0 collapse.
5. **SMS — `lib/sms/roofing-compose.ts:143-161`.** Update `composeInspectionMessage()` to include the indicative range and the on-site step, matching the page copy. Keep AU phrasing.
6. **Feature-flag it.** Gate the new behavior behind a new env flag `ROOFING_INSPECTION_INDICATIVE_PRICES` (default off in dev), wired in the customer page, `MeasurementReview`, and `roofing-compose`. Flag off ⇒ current behavior preserved.

## Constraints
- Roofing only. Scope by `trade` / the roofing surfaces; do not change generic tier rendering for electrical/plumbing/painting/solar.
- Never fabricate or re-derive prices in the render layer — indicative numbers come only from the engine output already stored in `quotes.good/better/best`.
- Preserve the ungroundable inspection fallback (null tiers + $99 route) exactly; verify it with an existing-trade check before finishing.
- Keep money conventions: store ex-GST, display inc-GST, AU formatting.
- A `$0`/blank quote is never a valid customer state — the outcome is either an indicative roofing number or the explicit "$99 on-site quote required" state for ungroundable trades.
- If any DB/schema change is needed, add a `sql/migrations/NNN_*.sql` + matching `scripts/run-migration-NNN.mjs`; do not edit applied migrations.
- Ask before proceeding only if you hit a genuine blocker (e.g. `/q/roof/[token]` turns out to still serve live customers, or the indicative-vs-blocked product decision is contested). Otherwise implement the indicative approach as specified.

## Output Format
1. A short **plan** (files you'll touch + the one-line change each).
2. The **diffs**, applied to the working tree.
3. **Verification:** run the project's typecheck/lint and any roofing tests; paste the actual results. Confirm (a) a roofing inspection quote now shows an indicative-labelled price to the customer, (b) owner and customer views agree, and (c) an electrical/plumbing inspection quote is unchanged (null tiers, $99 route).
4. A **coverage table** mapping each of the 6 task steps to the change that satisfied it, flagging anything deferred.

---

## Open product decisions to confirm with the founder (if contested)
- **Indicative vs blocked:** default is to show the grounded roofing tiers as an indicative range. The alternative (keep hiding prices, but make owner + customer both hide) was rejected because it leaves the customer with a blank quote — the exact symptom being fixed.
- **Multi-structure primary-on-inspection:** should the customer total be (a) the indicative full total including the primary, or (b) only quotable secondaries with the primary shown as "on inspection"? Default to (a) so the headline is never $0.
- **Flag default:** `ROOFING_INSPECTION_INDICATIVE_PRICES` default off in dev; decide prod default at rollout.
