# Tradie Manual Line Items — Spec

> Status: ready to build. Authored from a grounded codebase exploration of the
> quote edit/grounding/send surface (2026-06-25). No DB migration required.

## Objective

Let a tradie add **custom/manual line items** to a quote — things the AI never
catalogued, such as *"Remove existing hot water system"* or *"Supply & install
2× skylights"* — and have them **save successfully**. Today the
add-line-item UI already exists, but a hand-typed line is rejected by the
money-grounding validator (`422 grounding_failed`) and the editor dead-ends on a
raw error with no recovery. This change carves out a **human-entered** exemption
so legitimate custom lines save cleanly, while keeping the catalogue-grounding
backstop intact for AI-drafted and catalogue-edited prices. Two adjacent defects
found in the same surface are fixed alongside it.

## Context / background

The capability to add a line item **already exists** — do not rebuild it:

- `app/q/[token]/TradieEditor.tsx` — tradie-only overlay on the public quote
  page. Has a working **"+ Add line item"** button (`addLine`, ~line 279),
  editable description/qty/unit/price, remove-line, per-tier subtotal, and a
  save-with-notify confirmation modal. Opens via the **Edit** link in the tradie
  notification SMS (`/q/<token>?edit=1`) or the floating "Edit pricing" button.
- `app/api/quote/[id]/edit/route.ts` — tradie-only edit endpoint. Auth = Bearer
  Supabase token matched to `tenants.owner_user_id`. Recomputes each tier's
  `total_ex_gst = quantity × unit_price_ex_gst` server-side, recomputes the
  headline `total_inc_gst` from `selected_tier` (×1.1 when `gst_registered`),
  re-issues Stripe deposit Checkout Sessions for changed tiers (preserving
  `applied_discount_pct`), persists tier JSONBs, and optionally re-sends the
  customer "quote updated" SMS in `after()`. Already supports a `force: true`
  flag that persists a grounding-failing edit and stamps a
  `tradie_edit_ungrounded:*` risk flag.
- `lib/estimate/validate.ts` — `validateQuoteGrounding(draft, pricingBook,
  candidates)`. Walks every line item; a line is valid only if its
  `unit_price_ex_gst` derives from the tenant's catalogue: labour at
  `hourly_rate`/`apprentice_rate`/`senior_rate`, a call-out at
  `call_out_minimum`, or a `shared_materials`/`shared_assemblies`/
  `tenant_custom_assemblies` row at raw or ±5pp-of-markup price **and** a
  matching product category. It also enforces a per-tier minimum-labour-hours
  floor and within-tier (D-1) + cross-tier (R6) duplicate detection via
  `resolveLineAnchor`. Any failure on the draft path downgrades the whole quote
  to the $99 inspection route; on the edit path it returns `422` unless
  `force: true`.

**The bug:** a manual line matches no catalogue row, so `validateQuoteGrounding`
fails it → the edit route returns `422 grounding_failed`. `TradieEditor`'s
`handleSave` (~line 215) never sends `force` and does not carry each line's
`source`, so the save is a dead-end.

**Decision (chosen 2026-06-25): "Exempt + audit-flag".** A line the tradie
explicitly adds as custom (`source: 'tradie_manual'`) skips catalogue grounding
entirely — the human is the pricing authority — and is stamped a
`tradie_manual_line` risk flag for traceability. Editing an **existing
catalogue** line into an ungrounded price still returns `422`, recoverable via a
"Save anyway" → `force:true` confirm.

**Data model:** line items live inside `quotes.good/better/best` JSONB; each line
is `{ description, quantity, unit, unit_price_ex_gst, total_ex_gst, source }`
(plus optional `supplied_by`/`safety_note`). `quote_line_items` is unused.
`LineItemSchema.source` already permits ≤120 chars — **no DB migration needed.**

**Send timing (Path B):** by default a quote auto-sends to the customer at draft
time. When the tenant's `review_policy` holds it (or a safety risk flag is
present) the quote is `awaiting_tradie_approval`: the customer SMS is withheld
and the tradie gets **Edit** + **Approve** links. That hold is the only genuine
"edit before the customer sees it" window; `/api/quote/[id]/approve` is what
first contacts the customer.

## Requirements

1. **Manual-line sentinel.** A line item is "manual" iff
   `String(source).trim().toLowerCase() === 'tradie_manual'`. Add an
   `isManualLine(li)` helper in `lib/estimate/validate.ts`, alongside the
   existing `isAfterHours`.
2. **Grounding exemption.** In `validateQuoteGrounding`'s per-line loop, a manual
   line skips the price/unit/category grounding check entirely (treated as valid;
   no failure recorded). All other lines validate exactly as today.
3. **No false duplicates.** In `resolveLineAnchor` (`lib/estimate/validate.ts`),
   add `'tradie_manual'` to the `NON_CATALOGUE_SOURCES` set so a manual line can
   never anchor to a catalogue row on a coincidental price match — it must never
   trip the within-tier (D-1) or cross-tier (R6) duplicate guards.
4. **Labour floor unaffected.** Manual lines are not exempt from the per-tier
   minimum-labour-hours check (that check is about labour sufficiency and is
   unaffected by a manual material/scope line). To avoid muddying the labour
   rollup, manual lines default to a non-`hr` unit (see R7).
5. **Source round-trip in the editor.** `EditableLine` gains a `source?: string`
   field. `materialise()` reads `li.source` and `handleSave`'s payload includes
   `source` for every line, so an edit that touches one line preserves the
   `source` (and therefore the `material:<id>`/`assembly:<id>` anchor) of every
   untouched line. (Today both drop `source`, so every edit re-stamps
   `tradie_edit` and strips anchors.)
6. **Custom-line tagging.** The editor's add-line action stamps newly-added lines
   with `source: 'tradie_manual'`, and the UI makes clear these are
   tradie-entered custom lines (distinct from edited catalogue lines).
7. **Manual-line input rules.** A manual line may have `unit_price_ex_gst` of `0`
   (removals / inclusions), defaults `unit` to `'item'`, and requires a non-empty
   `description`. It still flows into the tier subtotal and headline total like
   any other line.
8. **Audit flag.** When a persisted tier contains ≥1 manual line, the edit route
   appends a non-destructive `risk_flags` entry `tradie_manual_line:<tier>#<idx>`
   per manual line (append + dedupe, mirroring the existing
   `tradie_edit_ungrounded` handling — never overwrite existing flags).
9. **Force fallback for catalogue edits.** When the edit endpoint returns
   `422 grounding_failed`, `TradieEditor` surfaces the failing lines (from
   `body.failures`) in a confirmation ("These lines don't match your catalogue
   pricing — save anyway?") and, on confirm, re-POSTs the same payload with
   `{ force: true }`. The route already persists forced edits and stamps
   `tradie_edit_ungrounded:*`.
10. **No leak on held quotes.** When `quote.status === 'awaiting_tradie_approval'`,
    an edit must not send the customer "quote updated" SMS (suppress
    `shouldNotify`). Only `/api/quote/[id]/approve` first-contacts the customer.
11. **Tests.** Unit tests cover: (a) a `tradie_manual` line passes
    `validateQuoteGrounding` at an arbitrary price; (b) `resolveLineAnchor`
    returns `null` for a `tradie_manual` line whose price equals a catalogue row
    (no false duplicate); (c) a non-manual catalogue line at an ungrounded price
    still fails; (d) the held-quote edit path does not notify the customer.

## Non-goals

- **Skylight → solar-panel misclassification.** The example quote misread
  "supply & install skylights" as solar panels — an intake/trade-classification
  bug at *draft* time, not part of this editor work. Out of scope; record as a
  follow-up.
- **Any automation of suggested extra lines.** Manual entry only — no AI
  suggestion of removals/extras.
- **Changing global auto-send / building a new pre-send gate.** The existing
  `review_policy` hold remains the pre-send window; we do not re-architect
  routing.
- **DB schema changes**, the normalized `quote_line_items` table, and Stripe
  Connect / funds-split.
- **A "no-charge inclusion" line presentation** (rendering a `$0` line without a
  price) — acceptable to show `$0`; richer presentation is a later nice-to-have.

## Constraints

- Stack: Next.js 16 App Router (`quotemate-automation/`). **Read
  `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/`
  guide before writing Next code** — Next 16 has breaking changes vs older
  knowledge.
- **Money safety:** the grounding exemption is scoped *strictly* to
  `source === 'tradie_manual'`. Catalogue, labour, callout, and after-hours lines
  keep validating exactly as today. The exemption is a human-entry carve-out and
  must never relax grounding for LLM-drafted quotes (the draft path in
  `lib/estimate/run.ts` is unchanged).
- `total_ex_gst` is always recomputed server-side as
  `quantity × unit_price_ex_gst`; never trust client-supplied totals.
- Preserve early-bird `applied_discount_pct` on Stripe Session re-issue.
- Keep the existing immutability guards: paid quotes (`paid_at`) and
  inspection-required quotes (`needs_inspection`) remain non-editable.
- Keep ≥1 line item per tier (existing `removeLine`/schema invariant).
- Follow repo conventions: currency stored ex-GST and displayed inc-GST;
  AU/NZ formatting.

## Edge cases to handle

- Manual line at `$0` (removal / inclusion) → saves; counts as `$0` in the tier
  subtotal; renders on `/q/[token]` (showing `$0` is acceptable).
- Manual line whose price coincidentally equals a real catalogue row's price →
  saves; **not** flagged as a within-tier or cross-tier duplicate.
- Manual line added to a tier that already grounds cleanly → only the edited
  tier is re-validated; manual line passes; the tier's Stripe deposit link
  re-issues because its subtotal changed.
- Tradie edits an **existing catalogue** line to a price outside the ±5pp markup
  band → `422 grounding_failed` → "Save anyway" confirm → re-POST `force:true`
  → persists with a `tradie_edit_ungrounded:*` flag.
- Single-line edit in one tier → untouched lines (and their `source` anchors) in
  that tier and other tiers are unchanged.
- Edit to a quote in `awaiting_tradie_approval` with a price change → tiers +
  total + Stripe links update, **no customer SMS** is sent; the quote stays held
  until Approve.
- Edit to a `paid` or `needs_inspection` quote → rejected as today (409), no
  change.
- Manual line with empty description → rejected by `LineItemSchema`
  (`description` min 1).
- Grounding revalidation throws (DB unreachable mid-edit) → existing
  fail-open-on-infra behaviour is preserved (edit proceeds, warn logged); the
  manual-line exemption does not change this.

## Definition of done

- [ ] Adding "Remove existing hot water system" (`unit: item`, `$0` or a chosen
      value) saves `200` — no `422`.
- [ ] Adding "Supply & install 2× skylights" at a tradie-chosen price saves
      `200`; that tier's subtotal, the headline `total_inc_gst`, and that tier's
      Stripe deposit link all update.
- [ ] A `tradie_manual` line passes `validateQuoteGrounding` regardless of price
      (covered by a unit test).
- [ ] A `tradie_manual` line whose price equals a catalogue row does **not**
      produce a within-tier or cross-tier duplicate failure (unit test).
- [ ] A non-manual catalogue line at an ungrounded price still returns
      `422 grounding_failed` (unit test) and is recoverable via the editor's
      "Save anyway" → `force:true` path, persisting with `tradie_edit_ungrounded`.
- [ ] Editing any line preserves the `source` of every untouched line
      (catalogue anchors not stripped) — verifiable by inspecting the persisted
      tier JSON after a single-line edit.
- [ ] Persisting a tier with a manual line stamps a `tradie_manual_line:<tier>#<idx>`
      risk flag (append + dedupe; existing flags retained).
- [ ] Editing a quote in `awaiting_tradie_approval` sends the customer nothing;
      Approve remains the only first-contact (unit test for the no-notify path).
- [ ] `unit: 'item'` and a `$0` manual line round-trip through the editor → edit
      route → persisted JSON → `/q/[token]` render without error.
- [ ] The full existing unit-test suite still passes; new tests for the four
      paths in R11 pass.
- [ ] No DB migration was added; `lib/estimate/run.ts` (draft path) is unchanged.

## Open questions

- None blocking. The skylight→solar misclassification is acknowledged as a
  separate follow-up (see Non-goals).
