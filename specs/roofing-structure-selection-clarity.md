# Roofing structure-selection clarity — Spec

## Objective
On the roofing Measurement Results page (`/m/[token]`) a combined estimate sums
all **included** structures (main dwelling + sheds/garages) into one headline
total, but the UI barely signals *which* structures feed it. A tradie (Jon) who
left secondary structures ticked in a prior session saw an inflated total and
assumed a bug — the maths was correct, the page was just ambiguous. This spec
removes that ambiguity on the tradie page, mirrors the minimal fix to the
read-only customer quote page (`/q/roof/[token]`), and corrects a latent default
where a never-saved selection silently totals *all* structures instead of the
intended primary-only. It is a clarity + small-correctness change; it does **not**
alter how totals are calculated.

## Context / background
Verified against the codebase during this session:

- The per-structure **"In job"** checkbox lives in
  [`MeasurementReview.tsx`](../quotemate-automation/app/m/[token]/MeasurementReview.tsx)
  (lines ~226–235). Toggling does an optimistic `PATCH /api/roofing/measurement/[token]`
  with `{ included_indices }`, persisting a 1-based set to the
  `roofing_measurements.included_indices` column (migration 140). It survives reload.
- **One canonical summation** computes every total: `combinedTotalsForIndices` →
  `narrowQuoteToStructures`
  ([`selection.ts:125`](../quotemate-automation/lib/roofing/selection.ts),
  [`roofing-compose.ts:233`](../quotemate-automation/lib/sms/roofing-compose.ts)).
  Tradie `/m`, dashboard preview, customer page, and PDF all funnel through it so
  they can never drift. **There is no separate "secondary structures" subtotal in code.**
- **Two defaults exist today, and they disagree:** the save writer persists
  *primary-only* via `primaryStructureIndices()`
  ([`save/route.ts:96`](../quotemate-automation/app/api/roofing/save/route.ts)),
  but every *reader* treats a NULL/empty `included_indices` as **ALL structures**
  ([`selection.ts:11,80-81`](../quotemate-automation/lib/roofing/selection.ts);
  [`/m/[token]/page.tsx:62`](../quotemate-automation/app/m/[token]/page.tsx)).
  So an unsaved/never-touched record silently totals everything — a second root
  cause of the same confusion.
- Migration 140 backfilled existing rows to an **explicit** all-structures array;
  only rows with no usable quote stayed NULL. So after 140, a genuine NULL is an
  edge state (empty/quote-less rows, or a read before the first save). The
  dashboard happy-path auto-saves the primary-only default and redirects to `/m`,
  so persisted rows normally already carry a non-empty selection.
- An **included-but-inspection-routed** structure is listed but contributes **$0**
  to the headline (the summation filters to quotable structures only).
- Today the only excluded-card cue on `/m` is `opacity-55` (no text). The customer
  page already has a `· Not included` suffix + callout; its Combined-estimate
  header shows **area only** (no structure count).
- The customer page is a **read-only** server component; inclusion is resolved
  server-side and a `?s=`/SMS pick can only *narrow* the tradie's set, never widen it.

## Requirements

### A. Tradie Measurement Results page — `/m/[token]` (display-only)
1. Each structure card shows an explicit textual inclusion state (e.g. an
   `In job` / `Not in job` pill) next to the existing "Main dwelling / Secondary
   structure · NN" label, so inclusion is legible from text alone — not from
   opacity/colour. The existing `opacity-55` treatment may remain in addition.
2. When ≥1 **secondary** structure is included, the Combined-total block states
   how many secondaries are included **and** their marginal dollar contribution
   per tier (good/better/best), e.g. *"Includes 2 secondary structures:
   +$X better."* The existing "· N structures included · {area} m²" count stays.
3. The secondary marginal figure is derived **only** through the canonical helper,
   computed as `combinedTotalsForIndices(quote, included)` minus
   `combinedTotalsForIndices(quote, included ∩ primaryStructureIndices(quote))`,
   per tier (inc-GST and ex-GST as displayed). No new reducer; no free-form
   re-summing of tier amounts in the component.
4. A non-blocking notice surfaces a non-default selection, shown **only when** the
   included set differs from primary-only (i.e. ≥1 secondary is included). It is
   worded from server-provided truth:
   - persisted selection → *"Showing your saved selection: main dwelling + N
     secondary structure(s). Untick any to remove it from the quote."*
   - NULL/unsaved record → worded as a default (*"Defaulting to … — untick to
     remove"*), never "saved earlier".
5. To support requirement 4, the server feeder
   [`/m/[token]/page.tsx`](../quotemate-automation/app/m/[token]/page.tsx) passes
   two new props to `MeasurementReview`: `selectionWasPersisted`
   (`row.included_indices != null && length > 0`) and `primaryIndices`
   (`primaryStructureIndices(quote)`).

### B. Customer quote page — `/q/roof/[token]` (read-only)
6. The Combined-estimate header
   ([`/q/roof/[token]/page.tsx:233`](../quotemate-automation/app/q/roof/[token]/page.tsx))
   additionally shows the included-structure count (e.g. "· N structures"), for
   parity with the tradie page. **Count only — no $-contribution line on the
   customer page** (see Open questions). The page stays read-only; no interactive
   control is added.

### C. Default correction — NULL/empty selection defaults to primary-only
7. A NULL/empty `included_indices` resolves to **primary/main-dwelling only**
   (`primaryStructureIndices(quote)`) instead of all structures, applied through a
   single shared helper/decision point so every reader agrees
   (`resolveEffectiveIndices`, `denormFromSelection`, `partitionRoofQuote`, and the
   `/m` + customer server feeders that currently expand empty → `allStructureIndices`).
8. Explicitly-saved selections are respected unchanged — including migration-140's
   backfilled explicit "all" arrays (those rows continue to show all structures).
   Only genuinely NULL/empty selections change behaviour.
9. No schema or data migration: the stored `included_indices` data is untouched and
   migration 140's backfill is not re-run. The change is in read-time resolution
   logic only.
10. Update the now-stale "NULL / empty selection means all structures" comments in
    [`selection.ts`](../quotemate-automation/lib/roofing/selection.ts) (header ~line 11)
    and migration 140 to document the new primary-only default convention.
11. Add a short iteration entry to
    [`docs/strategy.md`](../docs/strategy.md) recording this behaviour change (per
    CLAUDE.md's rule that behaviour changes are logged), then run the
    `strategy-reviewer` agent to check for drift across README/CLAUDE/assets.

## Non-goals
- No change to how totals are computed: `combinedTotalsForIndices` /
  `narrowQuoteToStructures` remain the single source of truth; no second summation
  path is introduced anywhere.
- No change to the save-time default (it already persists primary-only) or to
  persistence side-effects (the PATCH route's denorm recompute + `pdf_path` nulling).
- No schema migration, no data backfill, no re-writing of existing stored
  `included_indices` values.
- The customer page is **not** made interactive and gains no include/exclude
  control; its only inclusion levers (`?s=`, SMS confirm) are unchanged.
- No change to the at-least-one-structure guard.
- No rework of the dashboard inline `StructureCard` fallback path beyond what
  requirement C's shared default helper naturally covers.

## Constraints
- Stack: Next.js 16 App Router, React 19 (`quotemate-automation/`). Read
  `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/`
  guide before writing Next code (Next 16 has breaking changes).
- The marginal-$ derivation and all totals must route through
  `combinedTotalsForIndices`; the dashboard↔customer↔PDF parity asserted in
  [`selection.test.ts`](../quotemate-automation/lib/roofing/selection.test.ts)
  must stay byte-identical.
- The at-least-one-structure guard stays enforced at both points: client
  ([`MeasurementReview.tsx:103`](../quotemate-automation/app/m/[token]/MeasurementReview.tsx),
  "Keep at least one structure in the job.") and server (Zod `.min(1)` + 400
  `no_structures`,
  [`measurement/[token]/route.ts:24`](../quotemate-automation/app/api/roofing/measurement/[token]/route.ts)).
- Do not auto-reset or null a persisted selection on load (that would re-widen to
  the default and destroy saved opt-ins).
- The default decision (requirement C) must live in one place — not be re-implemented
  per reader.

## Edge cases to handle
- Single-structure job (count === 1) → only the primary exists; the secondary
  contribution line and the non-default notice are both suppressed (no
  "0 secondaries adding $0"). Checkbox stays effectively locked by the guard.
- Included secondary that routes to `inspection_required` → still listed with its
  existing warning callout, counts as included, but contributes $0 to the headline
  and to the marginal-$ figure (count and priced amount must stay internally
  consistent; copy must not imply it adds dollars).
- Primary unticked while a secondary is kept → `included ∩ primaryIndices` is
  empty, baseline = 0, so the whole included total is attributed to secondaries;
  copy must still read sensibly.
- NULL/unsaved record (post-change) → resolves to primary-only; the non-default
  notice is suppressed (it *is* the default), and the combined total shows the
  main dwelling only.
- Legacy migration-140 row with an explicit all-structures array → unchanged; shows
  all structures, and (because it differs from primary-only) the "saved selection"
  notice is shown worded as persisted.
- Empty PATCH body (selection sanitizes to empty) → still rejected 400
  `no_structures`; no UI path can bypass it.
- `?s=` link or SMS pick on a now-primary-only NULL record → intersection with the
  primary-only default may be empty and is ignored (set never empties); customer
  sees the primary structure rather than all.

## Definition of done
- [ ] `/m/[token]` card shows an explicit `In job` / `Not in job` text state on
      every structure; an excluded card is identifiable from text alone.
- [ ] When ≥1 secondary is included, the `/m` Combined-total header shows the
      secondary count and per-tier marginal $; it is absent for primary-only and
      single-structure jobs.
- [ ] The marginal-$ value equals
      `combinedTotalsForIndices(quote, included) −
      combinedTotalsForIndices(quote, included ∩ primaryIndices)` per tier, proven
      by a new unit test; the test also asserts it is 0 when no secondaries are
      included and when the only included secondaries are inspection-routed.
- [ ] The non-default notice renders **iff** the selection differs from
      primary-only; it reads as "saved" when `selectionWasPersisted` is true and as
      a default otherwise; it does not render for primary-only or single-structure jobs.
- [ ] The customer `/q/roof/[token]` Combined-estimate header shows the
      included-structure count; the page remains read-only with no behavioural or
      numeric change to its totals.
- [ ] A NULL/empty `included_indices` resolves to primary-only across all readers
      (a new unit test covers `resolveEffectiveIndices`/`denormFromSelection`/
      `partitionRoofQuote` and the `/m` + customer feeders); explicitly-saved
      selections (including backfilled "all") are unchanged.
- [ ] Existing `selection.test.ts` "one canonical total" / parity suite passes with
      no numeric output change anywhere (dashboard = customer = PDF).
- [ ] The PATCH route still recomputes denorm columns and nulls `pdf_path`; the
      at-least-one guard still returns 400 `no_structures` on an empty selection.
- [ ] Stale "NULL = all" comments in `selection.ts` and migration 140 are updated;
      a `docs/strategy.md` iteration entry is added and `strategy-reviewer` has been run.
- [ ] Typecheck passes; no new `any`/free-form tier summation introduced.
- [ ] A coverage map ties each requirement (A1–A5, B6, C7–C11) to the file/lines
      and test that satisfy it.

## Open questions
- Customer page $-contribution: spec'd as **count only** for simplicity. Flip to
  also show the secondary marginal $ on `/q/roof` if a customer-facing breakdown is
  wanted (would widen the test matrix and the customer copy).
- Notice copy wording (exact phrasing of the "saved selection" vs "default" notice)
  is left to implementation within the stated semantics.
