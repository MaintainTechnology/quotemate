# Full-Quote Editing — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the dormant Phase 0 document model into the live, de-modaled quote editor — starting with a flag-gated server render path (`report_doc` → live HTML/PDF), then the TipTap block editor, the locked pricing node, per-quote branding, and the single Save & Apply flow.

**Architecture:** Task A is a backend-only, flag-gated integration (`FULL_QUOTE_DOC`, default off): the existing `renderQuoteReportHtml` / `ensureQuotePdf` render the document body from `report_doc` (via the Phase 0 serializer) inside the SAME `renderReportDocument` chrome, falling back to today's template when the flag is off or no `report_doc` exists. Tasks B–F build the React editor on top; they're outlined here and each expands into detailed TDD steps at build time (they depend on the editor-lib choice and Next 16 App Router specifics — read `AGENTS.md` + `node_modules/next/dist/docs/` first).

**Tech Stack:** TypeScript, Next.js 16 App Router, Vitest, Postgres/Supabase, Gotenberg; TipTap v2 + a sanitizer (added in Task B).

**Spec:** [`docs/superpowers/specs/2026-07-06-full-quote-editing-v2-design.md`](../specs/2026-07-06-full-quote-editing-v2-design.md) §5–§8, §10, §11 (Phase 1). Depends on Phase 0 (merged): `report_doc`/`report_style` columns (mig 161, applied to prod), `serializeReportDoc`, `hashReportContent`, `renderQuoteTiersHtml`, `buildDefaultReportDoc`.

---

## Task A: Flag-gated `report_doc` render path (backend, safe)

Makes the document model actually render — behind `FULL_QUOTE_DOC` (default off), so prod is unchanged until we flip it. This de-risks the serializer against the real chrome + Gotenberg before any UI exists.

### Task A1: Extract a body-substitutable renderer in `report-html.ts`

**Files:**
- Modify: `lib/quote/report-html.ts:124-180` (`buildQuoteReportHtml`)
- Test: `lib/quote/report-html.test.ts` (add one case)

- [ ] **Step 1: Write the failing test**

Add to `lib/quote/report-html.test.ts`:

```ts
import { buildQuoteReportHtmlFromBody } from './report-html'

describe('buildQuoteReportHtmlFromBody', () => {
  const base = {
    businessName: 'Acme Electrical',
    jobType: 'downlights',
    good: { label: 'Good', subtotal_ex_gst: 1000, line_items: [] },
    better: null,
    best: null,
    selectedTier: null,
  }

  it('renders the supplied body verbatim inside the report chrome', () => {
    const html = buildQuoteReportHtmlFromBody(base, '<h2>Custom body</h2><p>Hello</p>')
    expect(html).toContain('<h2>Custom body</h2><p>Hello</p>')
    expect(html).toContain('Acme Electrical') // chrome (branding) still present
  })

  it('buildQuoteReportHtml equals from-body with the default body', () => {
    // Same chrome either way — a smoke check that the refactor preserved output.
    const full = buildQuoteReportHtml(base)
    expect(full).toContain('Acme Electrical')
    expect(full).toContain('GOOD')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/quote/report-html.test.ts`
Expected: FAIL — `buildQuoteReportHtmlFromBody` is not exported.

- [ ] **Step 3: Refactor `buildQuoteReportHtml` to delegate to a body-substitutable function**

In `lib/quote/report-html.ts`, split `buildQuoteReportHtml` so the chrome-wrapping is reusable. Replace the current function body: compute `body` (scope + tiers + assumptions) exactly as today, then delegate. Extract everything from the `renderReportDocument(...)` call into a new exported function that takes `bodyHtml` as a parameter, and have `buildQuoteReportHtml` compute the default body and call it. The default-body computation (lines 145-156) and the chrome fields (docTitle/eyebrow/intro/closingLine) move as-is; only the seam changes:

```ts
export function buildQuoteReportHtml(input: QuoteReportInput): string {
  const body = buildDefaultQuoteBody(input) // scope + tiers + assumptions (today's logic)
  return buildQuoteReportHtmlFromBody(input, body)
}

/** Wrap an arbitrary report body in the shared white-label chrome. The document
 *  serializer (report-doc/serialize) uses this to render report_doc inside the
 *  exact same chrome the PDF uses. */
export function buildQuoteReportHtmlFromBody(input: QuoteReportInput, bodyHtml: string): string {
  const date = (input.generatedAt ?? new Date()).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const branding = input.branding ?? brandingFromName(input.businessName)
  const job = prettyJobType(input.jobType)
  const visibleTierCount = (['good', 'better', 'best'] as const).filter((k) => input[k]).length
  const multiTier = visibleTierCount >= 2
  const closingLine = input.quoteViewUrl
    ? `Pay links and the live version of this quote: ${input.quoteViewUrl}`
    : null
  return renderReportDocument(branding, {
    docTitle: `Quote — ${branding.businessName}`,
    eyebrow: multiTier ? 'Customer quote · Good / Better / Best' : 'Customer quote',
    dateLabel: date,
    customerName: input.customerName ?? null,
    customerContact: input.estimatedTimeframe ? `Est. timeframe: ${input.estimatedTimeframe}` : null,
    introHtml: `Thank you for the opportunity to quote for <strong>${esc(job)}</strong>. ${
      multiTier ? 'Your Good / Better / Best options are' : 'Your quote is'
    } set out below.`,
    bodyHtml,
    pleaseNote: QUOTE_PLEASE_NOTE,
    closingLine,
  })
}

function buildDefaultQuoteBody(input: QuoteReportInput): string {
  const multiTier = (['good', 'better', 'best'] as const).filter((k) => input[k]).length >= 2
  const assumptions = (input.assumptions ?? []).filter((a) => a && a.trim()) as string[]
  let body = ''
  if (input.scopeOfWorks) body += `<h2>Scope of works</h2><div class="scope">${esc(input.scopeOfWorks)}</div>`
  body += `<h2>${multiTier ? 'Your options' : 'Your quote'}</h2>${renderQuoteTiersHtml(input)}`
  if (assumptions.length > 0) {
    body += `<h2>Assumptions</h2><ul class="bullets">${assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
  }
  return body
}
```

(Preserve the exact original strings/markup — this must be output-identical for the existing snapshot-style assertions.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/quote/report-html.test.ts`
Expected: PASS — original 13 assertions + the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add lib/quote/report-html.ts lib/quote/report-html.test.ts
git commit -m "refactor(quotes): body-substitutable buildQuoteReportHtmlFromBody"
```

### Task A2: Load `report_doc`/`report_style` into the report context

**Files:**
- Modify: `lib/quote/pdf.ts:210-217` (select) and the `QuotePdfRow` type (top of file).

- [ ] **Step 1: Add the columns to the `quotes` select**

In `loadQuoteReportContext` (pdf.ts:213-214), append `report_doc, report_style` to the select string:

```ts
.select(
  'id, tenant_id, intake_id, share_token, good, better, best, selected_tier, scope_of_works, assumptions, estimated_timeframe, needs_inspection, pdf_path, pdf_signature, report_doc, report_style',
)
```

- [ ] **Step 2: Add the fields to `QuotePdfRow`**

Find the `QuotePdfRow` type (grep `type QuotePdfRow` in pdf.ts) and add:

```ts
  report_doc: unknown | null
  report_style: unknown | null
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/quote/pdf.ts
git commit -m "feat(quotes): load report_doc/report_style into report context"
```

### Task A3: Render from `report_doc` behind `FULL_QUOTE_DOC`

**Files:**
- Modify: `lib/quote/pdf.ts` (`renderQuoteReportHtml` ~284, `ensureQuotePdf` ~332-338)

- [ ] **Step 1: Add a helper that chooses the body**

Near `buildQuoteReportInput` in pdf.ts, add:

```ts
import { serializeReportDoc } from './report-doc/serialize'
import { buildQuoteReportHtml, buildQuoteReportHtmlFromBody } from './report-html'
import { hashReportContent } from './pdf-signature'
import type { ReportDoc } from './report-doc/types'

/** Flag-gated: render the customer document from report_doc when present, else
 *  today's template. The pricing node in the doc renders from the SAME
 *  tier-visibility-filtered good/better/best, so prices stay grounded + gated. */
function renderQuoteDocumentHtml(input: QuoteReportInput, reportDoc: unknown | null): string {
  if (process.env.FULL_QUOTE_DOC === 'true' && reportDoc && typeof reportDoc === 'object') {
    const body = serializeReportDoc(reportDoc as ReportDoc, {
      good: input.good, better: input.better, best: input.best, selectedTier: input.selectedTier,
    })
    return buildQuoteReportHtmlFromBody(input, body)
  }
  return buildQuoteReportHtml(input)
}
```

- [ ] **Step 2: Use it in `renderQuoteReportHtml`**

Replace pdf.ts:288 (`return buildQuoteReportHtml(buildQuoteReportInput(ctx, branding))`) with:

```ts
  return renderQuoteDocumentHtml(buildQuoteReportInput(ctx, branding), ctx.quote.report_doc)
```

- [ ] **Step 3: Use it in `ensureQuotePdf` + fold the doc hash into the signature**

In `ensureQuotePdf`, add the content hash to BOTH the fresh signature and the render so a `report_doc` edit regenerates the PDF. Change the `freshSignature` block (pdf.ts:315-320) to include `docHash`:

```ts
    const docHash =
      process.env.FULL_QUOTE_DOC === 'true'
        ? hashReportContent(quote.report_doc, quote.report_style)
        : ''
    const freshSignature = quotePdfSignature({
      templateVersion: REPORT_TEMPLATE_VERSION, tierMode, visibleTierKeys, recommendedTier, docHash,
    })
```

and replace the render line (pdf.ts:333) with:

```ts
    const html = renderQuoteDocumentHtml(buildQuoteReportInput(ctx, branding), quote.report_doc)
```

- [ ] **Step 4: Typecheck + full quote suite**

Run: `pnpm typecheck && pnpm vitest run lib/quote/`
Expected: PASS. With the flag unset (prod default), `renderQuoteDocumentHtml` returns `buildQuoteReportHtml(input)` and `docHash` is `''` → byte-identical to today; no behaviour change.

- [ ] **Step 5: Manual flag smoke (optional, local)**

With a quote that has a seeded `report_doc`, set `FULL_QUOTE_DOC=true` and hit `/api/q/<token>/html`; confirm the document renders with the pricing node. Unset again to restore default.

- [ ] **Step 6: Commit**

```bash
git add lib/quote/pdf.ts
git commit -m "feat(quotes): flag-gated report_doc render path (FULL_QUOTE_DOC)"
```

---

## Tasks B–F (outline — expand into detailed TDD steps at build time)

> These build the React editor. Before starting, read `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guide (Next 16 App Router). Each task below becomes its own detailed plan section (failing test → impl → verify → commit) once the editor lib is installed and the component seams are chosen.

- **Task B — deps + editor scaffold.** Add `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, and a sanitizer (e.g. an allow-list HTML sanitizer) to `package.json`. Build a client-only `QuoteDocumentEditor` (`'use client'`) rendering a `ReportDoc` with a formatting toolbar (font/size/B/I/U/colour/highlight/list). Map TipTap JSON ↔ `ReportDoc` (a pure adapter, unit-tested).
- **Task C — locked pricing NodeView.** A `contenteditable=false` custom node that renders the Good/Better/Best block read-only and, on activation, mounts the existing `TradieEditor` pricing form. The node stores only a marker (no prices).
- **Task D — per-quote branding.** A branding control writing `report_style` (font/colour/logo), validated by the Phase 0 `validateReportStyle`; the serializer + chrome honour it (allow-listed inline styles only).
- **Task E — de-modaled layout + Save & Apply.** Replace the modal viewer (`QuoteReportViewerClient`) with the inline layout: live editor on top; stacked Pricing / Edit-with-AI / Manual sections; one sticky Save & Apply bar. New `POST /api/quote/[id]/edit` handling for `report_doc`/`report_style` (content-only = quiet save, no Stripe/notify); lazy `buildDefaultReportDoc` seed on first open; `sessionStorage` working-draft.
- **Task F — flip the flag + polish.** Turn on `FULL_QUOTE_DOC`, `data-section` change highlights, mobile tabs.

Phase 2 (scope selectors + AI content mode + Tier-3 owner-confirm) is a separate plan.

---

## Self-Review (Task A)

- **Spec coverage:** §7 (deterministic doc→HTML in the real chrome) → A1+A3; §10.2 (content-aware signature wired) → A3 step 3; §5 render-from-structured invariant preserved (pricing node reads filtered tiers) → A3 helper.
- **Placeholder scan:** Task A steps are complete code. Tasks B–F are explicitly outline-only by design (dep + Next-16 dependencies), not placeholders within an executable task.
- **Type consistency:** `buildQuoteReportHtmlFromBody(input, bodyHtml)` (A1) matches its caller in A3; `hashReportContent(doc, style)` + `quotePdfSignature({..., docHash})` (Phase 0) match A3's usage; `serializeReportDoc(doc, {good,better,best,selectedTier})` matches the Phase 0 signature.
- **Safety:** flag default-off ⇒ `renderQuoteDocumentHtml` ≡ `buildQuoteReportHtml` and `docHash===''` ⇒ signature byte-identical ⇒ zero prod change until the flag flips.
