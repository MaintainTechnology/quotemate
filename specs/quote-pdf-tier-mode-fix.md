# Quote PDF — honour the Pricing-settings tier mode — Spec

## Objective
The customer-facing quote **PDF** must present exactly the tiers the tradie chose
on the dashboard **Pricing settings** — Single price, Good / Better / Best, or a
single forced tier (Good only / Better only / Best only). Today the PDF ignores
that setting and prints the "Good / Better / Best" framing on every quote, even
when the tenant is in single-pricing mode. Jon hit this on a real Oak Crest
Electrical downlights quote ($614, one tier priced) whose PDF still read
"Good / Better / Best." This fixes the PDF layer so it is driven entirely by the
tradie's per-trade tier-mode setting, and stops already-cached PDFs from serving
the stale layout forever.

This is for **tradies** (their quote PDF must match the pricing presentation they
configured) and the **customers** who receive the PDF.

## Context / background
- The dashboard already exposes the control. The **Pricing** tab `TierModeCard`
  ([app/dashboard/page.tsx](../quotemate-automation/app/dashboard/page.tsx), card
  ~`:3119-3426`; `QuoteTierMode` type `:151-156`) lets the tradie pick, **per
  trade/feature**: Single price (default), Good / Better / Best, or Good/Better/Best
  only. Saving PATCHes `quote_tier_mode_by_trade`, which writes
  `pricing_book.quote_tier_mode` per trade at
  [app/api/tenant/me/route.ts:699-708](../quotemate-automation/app/api/tenant/me/route.ts).
- The setting is the column `pricing_book.quote_tier_mode` (migration 142;
  values `good_better_best | single | good | better | best`; NOT NULL, default
  `'single'`, backfilled to `'single'` for all existing rows). Per-row = per
  tenant, per trade — never fanned out across trades.
- The **single source of truth** for "which tiers show" is the pure resolver
  [lib/quote/tier-visibility.ts](../quotemate-automation/lib/quote/tier-visibility.ts)
  (`resolveVisibleTiers` + `asQuoteTierMode`, default `'single'`). The customer
  **web page** ([app/q/[token]/page.tsx:451-462](../quotemate-automation/app/q/[token]/page.tsx))
  and all four live **SMS** callers already consume it correctly. The **PDF does
  not** — that is the gap.
- Tier *generation* is intentionally always three tiers (estimator,
  [lib/estimate/electrical-prompt.ts:128-155](../quotemate-automation/lib/estimate/electrical-prompt.ts));
  per [specs/quote-tier-modes.md](quote-tier-modes.md) the tier mode is a
  presentation gate applied *after* estimation/validation. Good/Better/Best are
  persisted on every quote so the tradie can audit/edit and flip a customer back
  to three tiers. The meeting-floor theory that the fix is "remove good/better/best
  from the estimate codes" is **wrong** and is an explicit non-goal below — for
  Jon's quote the estimator already produced only Good (`better`/`best` null).

The bug is two defects, both in the PDF/HTML layer:

- **Defect A — hardcoded wording.**
  [lib/quote/report-html.ts](../quotemate-automation/lib/quote/report-html.ts)
  filters which tier *sections* render (null tiers are skipped) but hardcodes the
  surrounding copy: eyebrow `"Customer quote · Good / Better / Best"` (`:143`),
  intro `"Your Good / Better / Best options are set out below."` (`:147-149`),
  heading `"Your options"` (`:130`). So even a single-tier PDF reads as G/B/B.
- **Defect B — stale cache.**
  [lib/quote/pdf.ts:205](../quotemate-automation/lib/quote/pdf.ts) returns the
  cached `quotes.pdf_path` whenever it is non-null and no caller passes
  `{ regenerate: true }`. All 128 cached PDFs predate migration 142; 66 have more
  than one priced tier and serve a stale multi-tier layout. Nothing regenerates a
  PDF when the tradie changes the tier mode.

Reproduction quote: `b8b203dd-ca34-…`, share token `PP1tOjkM5qpi1QqmURIwSg`, tenant
`463dee0c` (Oak Crest Electrical); `good = $614 / 4 downlights`, `better = null`,
`best = null`; `pricing_book.quote_tier_mode = 'single'`; PDF cached
`2026-06-24T07:53:45Z`, before mig142 shipped (`e8a71bb`, `2026-06-24T14:28Z`).

## Requirements

**A. PDF content is driven by the Pricing-settings tier mode**
1. The PDF must render exactly the tiers returned by `resolveVisibleTiers` for the
   quote's tenant + trade `quote_tier_mode`, reusing
   [lib/quote/tier-visibility.ts](../quotemate-automation/lib/quote/tier-visibility.ts).
   No tier logic may be re-implemented in the PDF path. The mode is read from
   `pricing_book` scoped by `tenant_id` + `trade`.
2. Mode → PDF behaviour (driven by the dashboard setting):
   - `single` → one tier: the recommended/selected tier (`quotes.selected_tier`,
     falling back to the single priced tier, e.g. Good for Jon's quote).
   - `good_better_best` → every tier that is actually priced (1–3).
   - `good` / `better` / `best` → only that forced tier.
3. The PDF's heading/eyebrow/intro **copy** must derive from the number of tiers
   actually visible, not from hardcoded strings:
   - 1 visible tier → singular, no "Good / Better / Best" wording. Use eyebrow
     `"Customer quote"`, intro `"Your quote is set out below."`, heading
     `"Your quote"`.
   - ≥2 visible tiers → keep today's Good / Better / Best wording.
   This rule is count-driven so it is correct for all five modes automatically
   (including `good_better_best` where only one tier ended up priced → singular
   copy, not a misleading three-tier header).
4. No price, tier, or line item may be invented or dropped from storage — hiding a
   tier is presentation only; `quotes.good/better/best` are untouched.

**B. Already-cached PDFs self-heal (chosen remediation: on download + on send)**
5. Each generated PDF is stamped with a cache signature capturing what determined
   its content: a `REPORT_TEMPLATE_VERSION` constant (bumped whenever
   `report-html.ts` output changes) + the resolved tier mode + the selected tier.
   Store it on the quote (new column, e.g. `quotes.pdf_signature text`, via a
   numbered migration). Bump `REPORT_TEMPLATE_VERSION` as part of this change so
   every existing cached PDF is treated as stale.
6. `ensureQuotePdf` ([lib/quote/pdf.ts](../quotemate-automation/lib/quote/pdf.ts))
   regenerates when **any** of: `pdf_path` is null, the stored `pdf_signature`
   differs from the freshly-computed signature, or `opts.regenerate === true`.
   Otherwise it serves the cache. Regeneration is **lazy** — triggered by an
   actual download — so dead/test quotes never re-render.
7. The customer download route
   ([app/api/q/[token]/pdf/route.ts:40-43](../quotemate-automation/app/api/q/[token]/pdf/route.ts))
   goes through this staleness check (no longer blindly serves `pdf_path`).
8. The send paths force a fresh PDF: approve
   ([app/api/quote/[id]/approve/route.ts:177](../quotemate-automation/app/api/quote/[id]/approve/route.ts)),
   edit ([app/api/quote/[id]/edit/route.ts](../quotemate-automation/app/api/quote/[id]/edit/route.ts)),
   and estimate-draft auto-send
   ([app/api/estimate/draft/route.ts:788](../quotemate-automation/app/api/estimate/draft/route.ts))
   call `ensureQuotePdf` such that the served PDF reflects the current signature
   (pass `{ regenerate: true }` or rely on the signature mismatch).
9. Changing the tier mode on the dashboard and re-opening a quote's PDF download
   link must produce a PDF in the new mode without any manual/bulk job — the
   signature mismatch alone triggers regeneration.

**C. Defense-in-depth: SMS fallback**
10. Flip the internal `asQuoteTierMode` fallback from `'good_better_best'` to
    `'single'` in
    [lib/sms/templates.ts](../quotemate-automation/lib/sms/templates.ts) (`:109`,
    `:948`) and
    [lib/sms/roofing-compose.ts:111](../quotemate-automation/lib/sms/roofing-compose.ts),
    matching the PDF and web page. Update the corresponding assertion in
    [lib/sms/templates-tier-mode.test.ts:33](../quotemate-automation/lib/sms/templates-tier-mode.test.ts).
    (Live callers already thread the resolved mode; this only hardens the default.)

**D. Docs**
11. Update the stale "PDF — None — customer quote is an HTML page … no react-pdf"
    line in [CLAUDE.md](../CLAUDE.md) to reflect the Gotenberg HTML→PDF path and
    the tier-mode-aware PDF.

## Non-goals
- Changing estimator tier *generation*
  ([lib/estimate/electrical-prompt.ts:128-155](../quotemate-automation/lib/estimate/electrical-prompt.ts)).
  Three tiers are still generated and persisted for the tradie audit/edit path.
- Deleting `better`/`best` from `quotes` storage. The mode is a customer-view gate;
  deleting tiers would break the tradie's ability to flip back to Good/Better/Best
  and break the edit path.
- Any change to pricing, the grounding validator
  ([lib/estimate/validate.ts](../quotemate-automation/lib/estimate/validate.ts)),
  or inspection-fallback routing.
- The customer **web page** and **SMS** content rendering (already correct;
  requirement C only hardens a latent default).
- The dashboard Pricing UI itself — the control already exists; this spec consumes
  it, it does not rebuild it.
- A synchronous bulk re-render of all 128 cached PDFs (rejected — see Constraints;
  self-healing is lazy/on-demand).

## Constraints
- Stack: Next.js 16 App Router, React 19, Supabase (service-role in API routes),
  Gotenberg HTML→PDF ([lib/pdf/gotenberg.ts](../quotemate-automation/lib/pdf/gotenberg.ts)),
  optional `sharp`. Read
  [quotemate-automation/AGENTS.md](../quotemate-automation/AGENTS.md) before
  writing Next.js code.
- Tier mode is **per-row** (`pricing_book` per tenant + trade). Every read and any
  backfill must keep the `tenant_id` + `trade` scoping — a scoping slip leaks one
  tenant's mode onto another tenant's quote (same compliance class as licence
  scoping). Never hardcode a mode where a per-row value should be read.
- DB change follows repo convention: a new `sql/migrations/NNN_*.sql` (add the
  `quotes.pdf_signature` column) **plus** a `scripts/run-migration-NNN.mjs`, applied
  to prod Supabase; keep `sql/init.sql` representative. Down-migration included.
- Remediation must be **lazy** (regenerate on the next real download/send), never a
  synchronous mass re-render — 128 PDFs through Gotenberg at once risks a stampede /
  Vercel timeout.
- Reuse `resolveVisibleTiers` / `asQuoteTierMode`; do not duplicate tier logic.

## Edge cases to handle
- Mode `single`, only Good priced (`better`/`best` null) → one Good tier, singular
  copy, no G/B/B wording. (Jon's exact quote.)
- Mode `good_better_best`, only one tier priced → singular copy (count-driven), not
  a three-tier header with one price.
- Mode `best` (forced) but `best` is null/unpriced → resolver falls back per its
  existing rules; PDF renders whatever the resolver returns and the copy matches
  that count. No empty/blank tier section is emitted.
- Tradie changes mode after the PDF was generated → next download regenerates via
  signature mismatch (no manual step).
- `REPORT_TEMPLATE_VERSION` bumped (future template edit) → all PDFs regenerate
  lazily on next view.
- Inspection-routed quote (`needs_inspection`) → tier mode does not apply; the PDF
  path for those is unchanged.
- Dead/historical test quote never downloaded → never regenerates (lazy); no wasted
  Gotenberg load.
- Gotenberg unavailable at download time → serve the existing cached PDF / fail
  gracefully as the current download route does; do not 500 the customer link.
- Multi-trade tenant with different modes per trade → each quote uses its own
  trade's mode; no cross-trade bleed.

## Definition of done
- [ ] Downloading the PDF for `PP1tOjkM5qpi1QqmURIwSg` (Jon's quote) shows a single
      Good tier with the $614 / 4-downlight lines and **no** "Good / Better / Best"
      wording anywhere (eyebrow, intro, heading).
- [ ] Setting a trade's Pricing setting to **Good / Better / Best** and downloading
      a quote with ≥2 priced tiers produces a three-tier PDF with G/B/B wording.
- [ ] Setting it to **Good only** produces a single Good-tier PDF with singular
      copy; **Single** produces the recommended/selected single tier.
- [ ] Changing the mode on the dashboard then re-downloading the same quote's PDF
      yields the new mode with no manual/bulk action (signature self-heal verified).
- [ ] The PDF tier set always equals `resolveVisibleTiers(...)` for the quote's
      tenant/trade — verified by a unit test over modes
      `single | good_better_best | good | better | best` against the report builder.
- [ ] `report-html.ts` copy is count-driven: a unit test asserts 1 visible tier →
      singular strings, ≥2 → G/B/B strings.
- [ ] `ensureQuotePdf` regenerates on `pdf_path` null OR signature mismatch OR
      `regenerate:true`, and serves cache otherwise — covered by a test.
- [ ] Migration adds `quotes.pdf_signature`, has a down-migration, is applied to
      prod via `scripts/run-migration-NNN.mjs`, and `sql/init.sql` reflects it.
- [ ] `REPORT_TEMPLATE_VERSION` bumped so pre-existing cached PDFs are stale.
- [ ] SMS/roofing fallback now defaults to `'single'`; `templates-tier-mode.test.ts`
      updated and the suite passes.
- [ ] A regenerated PDF never shows a tier hidden by the mode, and never invents a
      tier the estimator did not price.
- [ ] Per-row `tenant_id` + `trade` scoping preserved on every mode read (no
      cross-tenant/cross-trade leak) — spot-checked on the multi-trade tenant.
- [ ] `CLAUDE.md` "PDF: None" line corrected.
- [ ] Type-check, lint, and the unit suite pass.

## Open questions
- Cache signature shape: single `quotes.pdf_signature text` (template version +
  resolved mode + selected tier) vs. discrete columns
  (`pdf_template_version`, `pdf_tier_mode`). Spec assumes the single-column
  signature; confirm during build if a discrete shape is preferred for future
  debugging.
- Exact singular copy strings ("Your quote" / "Customer quote" / "Your quote is set
  out below.") — proposed defaults above; adjust to brand voice if the
  Maintain design system specifies different wording.
