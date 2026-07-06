# Full-Quote Editing — Phase 0 (foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the backend foundations for the living-document quote editor — new nullable `report_doc`/`report_style` columns, an allow-listed style validator, a deterministic `report_doc → HTML` serializer that reuses the existing tier renderer, a content-aware PDF signature, and a default-doc seeder — all additive, unit-tested, and invisible to customers (no live render path changes until Phase 1).

**Architecture:** Everything is new pure modules under `lib/quote/report-doc/` plus one small DRY refactor to export the tier renderer from `lib/quote/report-html.ts`. Nothing is wired into the live `/q/[token]` render or the Gotenberg path in this phase; the new code exists and is tested but dormant. The Stripe/grounding/PDF money path is untouched. The migration is written + verifiable but applied to production Supabase ONLY on explicit go-ahead.

**Tech Stack:** TypeScript, Next.js 16 (App Router — this phase is server-lib only, no React), Zod, Vitest, Postgres (Supabase), `pg` migration scripts. No new npm dependencies in Phase 0.

**Spec:** [`docs/superpowers/specs/2026-07-06-full-quote-editing-v2-design.md`](../specs/2026-07-06-full-quote-editing-v2-design.md) §3, §4.1, §7, §10.2, §11 (Phase 0).

---

## File Structure

- `sql/migrations/161_full_quote_document.sql` — add `quotes.report_doc jsonb`, `quotes.report_style jsonb` (additive, idempotent).
- `sql/migrations/161_down.sql` — drop the two columns (rollback).
- `scripts/run-migration-161.mjs` — pre-flight / apply / post-verify (mirrors `run-migration-160.mjs`). NOT run against prod until authorized.
- `lib/quote/report-doc/types.ts` — the `ReportDoc` document shape (blocks + inline marks). Pure types.
- `lib/quote/report-doc/style.ts` + `style.test.ts` — `ReportStyle` type + `validateReportStyle()` allow-list guard.
- `lib/quote/report-doc/serialize.ts` + `serialize.test.ts` — deterministic `serializeReportDoc()` → HTML (esc on every text node; pricing block delegates to the shared tier renderer).
- `lib/quote/report-doc/seed.ts` + `seed.test.ts` — `buildDefaultReportDoc()` from a quote's existing fields.
- `lib/quote/report-html.ts` — MODIFY: extract + export `renderQuoteTiersHtml()` (DRY; consumed by both `buildQuoteReportHtml` and the new serializer).
- `lib/quote/pdf-signature.ts` + `pdf-signature.test.ts` — MODIFY: add `hashReportContent()` and an optional `docHash` segment to `quotePdfSignature()`.

---

## Task 1: Migration 161 — `report_doc` / `report_style` columns

**Files:**
- Create: `sql/migrations/161_full_quote_document.sql`
- Create: `sql/migrations/161_down.sql`
- Create: `scripts/run-migration-161.mjs`

- [ ] **Step 1: Write the migration SQL**

Create `sql/migrations/161_full_quote_document.sql`:

```sql
-- 161_full_quote_document.sql
--
-- Living-document quote editor (spec 2026-07-06-full-quote-editing-v2-design.md).
--
--   report_doc    the tradie-authored quote DOCUMENT as block JSON (title,
--                 prose, headings, lists, a locked pricing node). Content +
--                 structure only — NEVER prices. The pricing node renders from
--                 good/better/best, which stays the single source of truth.
--   report_style  per-quote branding override (allow-listed): logo path,
--                 accent colour, font family, heading style. NULL falls back to
--                 the tenant's global brand and never affects other quotes.
--
-- Both nullable, additive + idempotent — no data change, safe to re-run. Dormant
-- until Phase 1 wires them into the editor + render path.

alter table quotes add column if not exists report_doc   jsonb;
alter table quotes add column if not exists report_style jsonb;

comment on column quotes.report_doc is
  'Quote document block JSON (content + structure, no prices). Pricing node renders from good/better/best.';
comment on column quotes.report_style is
  'Per-quote branding override (allow-listed). NULL = tenant global brand. Never affects other quotes.';
```

- [ ] **Step 2: Write the rollback SQL**

Create `sql/migrations/161_down.sql`:

```sql
-- Rollback for 161_full_quote_document.sql
alter table quotes drop column if exists report_style;
alter table quotes drop column if exists report_doc;
```

- [ ] **Step 3: Write the migration runner**

Create `scripts/run-migration-161.mjs` (mirrors `run-migration-160.mjs`):

```js
// Apply migration 161 — report_doc / report_style columns on quotes.
// Run: node --env-file=.env.local scripts/run-migration-161.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '161_full_quote_document.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set')
  process.exit(1)
}

const COLUMNS = ['report_doc', 'report_style']
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function hasColumn(table, column) {
  const r = await c.query(
    `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, column],
  )
  return r.rowCount > 0
}

try {
  await c.connect()
  for (const col of COLUMNS) {
    console.log(`pre-flight: quotes.${col} exists =`, await hasColumn('quotes', col))
  }
  await c.query(readFileSync(sqlPath, 'utf8'))
  console.log('migration 161 applied')
  let ok = true
  for (const col of COLUMNS) {
    const present = await hasColumn('quotes', col)
    console.log(`post-verify: quotes.${col} exists =`, present)
    if (!present) ok = false
  }
  if (!ok) {
    console.error('post-verify FAILED — a column is missing')
    process.exit(2)
  }
} catch (e) {
  console.error('migration 161 failed:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
```

- [ ] **Step 4: Verify the SQL parses (dry check, no prod apply)**

Run: `node --check scripts/run-migration-161.mjs`
Expected: no output, exit 0 (syntax OK). **Do NOT run the migration against production Supabase in this task** — application is a separate, explicitly-authorized step (see "Production apply" at the end).

- [ ] **Step 5: Commit**

```bash
git add sql/migrations/161_full_quote_document.sql sql/migrations/161_down.sql scripts/run-migration-161.mjs
git commit -m "feat(quotes): migration 161 — report_doc/report_style columns (dormant)"
```

---

## Task 2: `ReportDoc` document types

**Files:**
- Create: `lib/quote/report-doc/types.ts`

- [ ] **Step 1: Write the types**

Create `lib/quote/report-doc/types.ts`:

```ts
// The quote DOCUMENT model (spec 2026-07-06 §3). A minimal, serialisable block
// list — a deliberate subset of ProseMirror so the server serializer stays pure
// and dependency-free. Prices are NOT represented here: the `pricing` block is a
// locked marker that renders from good/better/best at serialize time.

export type ReportDocMark = 'bold' | 'italic' | 'underline' | 'highlight'

/** A run of inline text with optional allow-listed marks. */
export type ReportDocText = { text: string; marks?: ReportDocMark[] }

export type ReportDocBlock =
  | { type: 'title'; content: ReportDocText[] }
  | { type: 'heading'; content: ReportDocText[] }
  | { type: 'paragraph'; content: ReportDocText[] }
  | { type: 'bulletList'; items: ReportDocText[][] } // each item = one line of inline content
  | { type: 'pricing' } // locked node — renders good/better/best; carries no data

export type ReportDoc = { version: 1; blocks: ReportDocBlock[] }

export const REPORT_DOC_VERSION = 1 as const
export const ALLOWED_MARKS: readonly ReportDocMark[] = ['bold', 'italic', 'underline', 'highlight']
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors introduced).

- [ ] **Step 3: Commit**

```bash
git add lib/quote/report-doc/types.ts
git commit -m "feat(quotes): ReportDoc document types"
```

---

## Task 3: `report_style` allow-list validator

**Files:**
- Create: `lib/quote/report-doc/style.ts`
- Test: `lib/quote/report-doc/style.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/quote/report-doc/style.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateReportStyle, ALLOWED_ACCENTS } from './style'

describe('validateReportStyle', () => {
  it('accepts a fully valid style', () => {
    const s = { fontFamily: 'serif', accentColor: ALLOWED_ACCENTS[0], headingStyle: 'bar' }
    expect(validateReportStyle(s)).toEqual(s)
  })

  it('returns null for a non-object', () => {
    expect(validateReportStyle(null)).toBeNull()
    expect(validateReportStyle('nope')).toBeNull()
  })

  it('strips unknown keys rather than failing', () => {
    expect(validateReportStyle({ fontFamily: 'mono', evil: '<script>' })).toEqual({
      fontFamily: 'mono',
    })
  })

  it('rejects an off-list font family (whole style invalid → null)', () => {
    expect(validateReportStyle({ fontFamily: 'Comic Sans' })).toBeNull()
  })

  it('rejects an accent colour outside the palette allow-list', () => {
    expect(validateReportStyle({ accentColor: '#123456' })).toBeNull()
  })

  it('rejects a non-hex accent colour', () => {
    expect(validateReportStyle({ accentColor: 'red' })).toBeNull()
  })

  it('rejects a logoPath outside a tenant storage prefix', () => {
    expect(validateReportStyle({ logoPath: 'http://evil/x.png' })).toBeNull()
    expect(validateReportStyle({ logoPath: '../secrets' })).toBeNull()
  })

  it('accepts a logoPath inside the tenant branding prefix', () => {
    expect(validateReportStyle({ logoPath: 'branding/tenant-abc/logo.png' })).toEqual({
      logoPath: 'branding/tenant-abc/logo.png',
    })
  })

  it('returns an empty object for {} (valid, no overrides)', () => {
    expect(validateReportStyle({})).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/quote/report-doc/style.test.ts`
Expected: FAIL — `Cannot find module './style'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/quote/report-doc/style.ts`:

```ts
// Per-quote branding override, allow-listed (spec 2026-07-06 §3.1, §9). A tradie
// may restyle THIS quote's look, but only within a bounded token set — never
// arbitrary CSS, never a remote logo URL (Gotenberg's Chromium would fetch it →
// SSRF). validateReportStyle returns the sanitised subset, or null if any
// provided value is off-list (caller then falls back to the tenant global brand).

import { z } from 'zod'

/** Bounded accent palette (Maintain-compatible). Extend deliberately, not freely. */
export const ALLOWED_ACCENTS = ['#FF5F00', '#0F1722', '#2563EB', '#16A34A', '#9333EA'] as const

const StyleSchema = z
  .object({
    fontFamily: z.enum(['system', 'serif', 'sans', 'mono']).optional(),
    accentColor: z.enum(ALLOWED_ACCENTS).optional(),
    headingStyle: z.enum(['plain', 'underline', 'bar']).optional(),
    // Storage object path inside the tenant branding prefix — no URLs, no traversal.
    logoPath: z
      .string()
      .regex(/^branding\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/)
      .optional(),
  })
  .strip() // drop unknown keys instead of erroring

export type ReportStyle = z.infer<typeof StyleSchema>

export function validateReportStyle(input: unknown): ReportStyle | null {
  const parsed = StyleSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/quote/report-doc/style.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/quote/report-doc/style.ts lib/quote/report-doc/style.test.ts
git commit -m "feat(quotes): report_style allow-list validator"
```

---

## Task 4: Export a shared tier renderer from `report-html.ts` (DRY refactor)

**Files:**
- Modify: `lib/quote/report-html.ts:124-134`

- [ ] **Step 1: Add the exported helper and reuse it in `buildQuoteReportHtml`**

In `lib/quote/report-html.ts`, add this exported function immediately after `tierSection` (after line 115):

```ts
/** The three Good/Better/Best `<section>`s, in order — shared by the customer
 *  PDF (buildQuoteReportHtml) and the document serializer (report-doc/serialize).
 *  Prices come from good/better/best, so both surfaces render identical tiers. */
export function renderQuoteTiersHtml(
  input: Pick<QuoteReportInput, 'good' | 'better' | 'best' | 'selectedTier'>,
): string {
  return (['good', 'better', 'best'] as const)
    .map((key) => tierSection(key, input[key], input.selectedTier === key))
    .join('')
}
```

Then replace the inline tier map inside `buildQuoteReportHtml` (currently lines 132-134):

```ts
  const tiers = (['good', 'better', 'best'] as const)
    .map((key) => tierSection(key, input[key], input.selectedTier === key))
    .join('')
```

with:

```ts
  const tiers = renderQuoteTiersHtml(input)
```

- [ ] **Step 2: Run the existing report-html tests to verify no output change**

Run: `pnpm vitest run lib/quote/report-html.test.ts`
Expected: PASS — the refactor is output-identical, so every existing assertion still holds.

- [ ] **Step 3: Commit**

```bash
git add lib/quote/report-html.ts
git commit -m "refactor(quotes): export renderQuoteTiersHtml for reuse (DRY)"
```

---

## Task 5: Deterministic `report_doc → HTML` serializer

**Files:**
- Create: `lib/quote/report-doc/serialize.ts`
- Test: `lib/quote/report-doc/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/quote/report-doc/serialize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { serializeReportDoc } from './serialize'
import type { ReportDoc } from './types'

const tiers = {
  good: { label: 'Essentials', subtotal_ex_gst: 1000, line_items: [] },
  better: { label: 'Recommended', subtotal_ex_gst: 2000, line_items: [] },
  best: null,
  selectedTier: 'better' as const,
}

const doc: ReportDoc = {
  version: 1,
  blocks: [
    { type: 'title', content: [{ text: 'Commercial Repaint' }] },
    { type: 'heading', content: [{ text: 'Scope of works' }] },
    { type: 'paragraph', content: [{ text: 'Two coats to walls', marks: ['bold'] }] },
    { type: 'pricing' },
    { type: 'bulletList', items: [[{ text: 'Valid 30 days' }]] },
  ],
}

describe('serializeReportDoc', () => {
  it('renders title, heading, paragraph, bullets in document order', () => {
    const html = serializeReportDoc(doc, tiers)
    expect(html.indexOf('Commercial Repaint')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('Scope of works')).toBeGreaterThan(html.indexOf('Commercial Repaint'))
    expect(html).toContain('<li>Valid 30 days</li>')
  })

  it('applies allow-listed marks (bold → <strong>)', () => {
    expect(serializeReportDoc(doc, tiers)).toContain('<strong>Two coats to walls</strong>')
  })

  it('renders the pricing block from tiers (RECOMMENDED on the selected tier)', () => {
    const html = serializeReportDoc(doc, tiers)
    expect(html).toContain('BETTER · RECOMMENDED')
    expect(html).toContain('Essentials')
  })

  it('escapes HTML in text nodes (XSS / Gotenberg SSRF guard)', () => {
    const evil: ReportDoc = {
      version: 1,
      blocks: [{ type: 'paragraph', content: [{ text: '<img src=x onerror=alert(1)>' }] }],
    }
    const html = serializeReportDoc(evil, tiers)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('ignores unknown marks (only the allow-list is emitted)', () => {
    const d: ReportDoc = {
      version: 1,
      // deliberately cast: a forged/persisted doc could carry an off-list mark
      blocks: [{ type: 'paragraph', content: [{ text: 'hi', marks: ['evil' as never] }] }],
    }
    const html = serializeReportDoc(d, tiers)
    expect(html).toContain('hi')
    expect(html).not.toContain('evil')
  })

  it('is deterministic', () => {
    expect(serializeReportDoc(doc, tiers)).toBe(serializeReportDoc(doc, tiers))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/quote/report-doc/serialize.test.ts`
Expected: FAIL — `Cannot find module './serialize'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/quote/report-doc/serialize.ts`:

```ts
// Pure, deterministic serializer: ReportDoc block JSON → HTML. Mirrors the
// determinism + esc() posture of lib/pdf/report-chrome.ts. Every text node is
// escaped (the same Gotenberg-Chromium XSS/SSRF sink as the existing template —
// spec §9). Only allow-listed marks emit markup. The `pricing` block delegates
// to the shared tier renderer so prices ALWAYS come from good/better/best.

import { esc } from '../../pdf/report-chrome'
import { renderQuoteTiersHtml, type QuoteReportInput } from '../report-html'
import { ALLOWED_MARKS, type ReportDoc, type ReportDocText } from './types'

type TierInput = Pick<QuoteReportInput, 'good' | 'better' | 'best' | 'selectedTier'>

const MARK_TAG: Record<string, [string, string]> = {
  bold: ['<strong>', '</strong>'],
  italic: ['<em>', '</em>'],
  underline: ['<u>', '</u>'],
  highlight: ['<mark>', '</mark>'],
}

function renderInline(content: ReportDocText[]): string {
  return content
    .map((run) => {
      let html = esc(run.text)
      const marks = (run.marks ?? []).filter((m) => ALLOWED_MARKS.includes(m))
      for (const m of marks) {
        const tag = MARK_TAG[m]
        if (tag) html = `${tag[0]}${html}${tag[1]}`
      }
      return html
    })
    .join('')
}

export function serializeReportDoc(doc: ReportDoc, tiers: TierInput): string {
  return doc.blocks
    .map((block) => {
      switch (block.type) {
        case 'title':
          return `<h1 class="doc-title">${renderInline(block.content)}</h1>`
        case 'heading':
          return `<h2>${renderInline(block.content)}</h2>`
        case 'paragraph':
          return `<p>${renderInline(block.content)}</p>`
        case 'bulletList':
          return `<ul class="bullets">${block.items
            .map((item) => `<li>${renderInline(item)}</li>`)
            .join('')}</ul>`
        case 'pricing':
          return renderQuoteTiersHtml(tiers)
        default:
          return ''
      }
    })
    .join('')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/quote/report-doc/serialize.test.ts`
Expected: PASS (6 tests). (Note: `tierSection` emits `${key.toUpperCase()}${selected ? ' · RECOMMENDED' : ''}`, so the selected `better` tier renders `BETTER · RECOMMENDED`.)

- [ ] **Step 5: Commit**

```bash
git add lib/quote/report-doc/serialize.ts lib/quote/report-doc/serialize.test.ts
git commit -m "feat(quotes): deterministic report_doc -> HTML serializer (esc + shared tiers)"
```

---

## Task 6: Content-aware PDF signature

**Files:**
- Modify: `lib/quote/pdf-signature.ts`
- Test: `lib/quote/pdf-signature.test.ts` (add cases; keep existing)

- [ ] **Step 1: Write the failing tests (append to the existing file)**

Append to `lib/quote/pdf-signature.test.ts` (inside the file, after the existing `describe` blocks):

```ts
import { hashReportContent } from './pdf-signature'

describe('hashReportContent', () => {
  it('is deterministic', () => {
    const doc = { version: 1, blocks: [{ type: 'title', content: [{ text: 'A' }] }] }
    expect(hashReportContent(doc, null)).toBe(hashReportContent(doc, null))
  })

  it('changes when the document changes', () => {
    const a = { version: 1, blocks: [{ type: 'title', content: [{ text: 'A' }] }] }
    const b = { version: 1, blocks: [{ type: 'title', content: [{ text: 'B' }] }] }
    expect(hashReportContent(a, null)).not.toBe(hashReportContent(b, null))
  })

  it('changes when the style changes', () => {
    const doc = { version: 1, blocks: [] }
    expect(hashReportContent(doc, { accentColor: '#FF5F00' })).not.toBe(
      hashReportContent(doc, { accentColor: '#2563EB' }),
    )
  })

  it('is empty string when there is no document (legacy quotes)', () => {
    expect(hashReportContent(null, null)).toBe('')
  })
})

describe('quotePdfSignature with docHash', () => {
  const base = {
    templateVersion: 2,
    tierMode: 'single' as const,
    visibleTierKeys: ['better'] as const,
    recommendedTier: null,
  }

  it('is UNCHANGED for a legacy quote (no docHash) — no forced regen', () => {
    expect(quotePdfSignature(base)).toBe('v2|single|t=better|r=')
  })

  it('appends a doc segment when a docHash is present', () => {
    const sig = quotePdfSignature({ ...base, docHash: 'abc123' })
    expect(sig).toBe('v2|single|t=better|r=|d=abc123')
  })

  it('differs when the docHash differs', () => {
    expect(quotePdfSignature({ ...base, docHash: 'aaa' })).not.toBe(
      quotePdfSignature({ ...base, docHash: 'bbb' }),
    )
  })
})
```

(The `quotePdfSignature`/`quotePdfIsStale` import already exists at the top of the file; add only the `hashReportContent` import shown above.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run lib/quote/pdf-signature.test.ts`
Expected: FAIL — `hashReportContent` is not exported / `docHash` not accepted.

- [ ] **Step 3: Extend the implementation**

In `lib/quote/pdf-signature.ts`, add `docHash` to the `quotePdfSignature` argument type and append the segment only when present. Replace the function body (lines 20-29) with:

```ts
export function quotePdfSignature(args: {
  templateVersion: number
  tierMode: QuoteTierMode
  visibleTierKeys: readonly TierKey[]
  recommendedTier: string | null
  /** Content hash of report_doc + report_style (hashReportContent). Omitted /
   *  empty for legacy quotes with no document → signature is byte-identical to
   *  the pre-Phase-0 format, so those cached PDFs are NOT force-regenerated. */
  docHash?: string | null
}): string {
  const base = `v${args.templateVersion}|${args.tierMode}|t=${args.visibleTierKeys.join('+')}|r=${
    args.recommendedTier ?? ''
  }`
  return args.docHash ? `${base}|d=${args.docHash}` : base
}
```

Then append the hash helper at the end of the file:

```ts
/**
 * Stable content hash of a quote's document + style override, for the PDF cache
 * signature (§10.2). A tiny dependency-free FNV-1a over a key-sorted JSON string
 * so it stays edge-safe and pure (no node:crypto). Null document → '' (legacy
 * quotes keep their pre-Phase-0 signature — see quotePdfSignature.docHash).
 */
export function hashReportContent(
  reportDoc: unknown | null,
  reportStyle: unknown | null,
): string {
  if (reportDoc == null && reportStyle == null) return ''
  const json = stableStringify({ d: reportDoc ?? null, s: reportStyle ?? null })
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/quote/pdf-signature.test.ts`
Expected: PASS — the original 11 cases plus the 7 new ones. Critically, "is UNCHANGED for a legacy quote" confirms no existing cached PDF is invalidated.

- [ ] **Step 5: Commit**

```bash
git add lib/quote/pdf-signature.ts lib/quote/pdf-signature.test.ts
git commit -m "feat(quotes): content-aware PDF signature (hashReportContent + docHash)"
```

---

## Task 7: Default-document seeder

**Files:**
- Create: `lib/quote/report-doc/seed.ts`
- Test: `lib/quote/report-doc/seed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/quote/report-doc/seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDefaultReportDoc } from './seed'

describe('buildDefaultReportDoc', () => {
  it('builds title + scope + pricing + assumptions in order', () => {
    const doc = buildDefaultReportDoc({
      title: 'Repaint — 12 Smith St',
      scopeOfWorks: 'Two coats to walls.',
      assumptions: ['Access provided', 'Power on site'],
    })
    expect(doc.version).toBe(1)
    const types = doc.blocks.map((b) => b.type)
    expect(types).toEqual(['title', 'heading', 'paragraph', 'pricing', 'heading', 'bulletList'])
  })

  it('always includes exactly one pricing block', () => {
    const doc = buildDefaultReportDoc({ title: 'X' })
    expect(doc.blocks.filter((b) => b.type === 'pricing')).toHaveLength(1)
  })

  it('omits the scope section when there is no scope', () => {
    const doc = buildDefaultReportDoc({ title: 'X' })
    expect(doc.blocks.some((b) => b.type === 'paragraph')).toBe(false)
  })

  it('omits the assumptions section when there are none', () => {
    const doc = buildDefaultReportDoc({ title: 'X', scopeOfWorks: 'Y' })
    expect(doc.blocks.filter((b) => b.type === 'bulletList')).toHaveLength(0)
  })

  it('falls back to a default title when none is given', () => {
    const doc = buildDefaultReportDoc({})
    expect(doc.blocks[0]).toEqual({ type: 'title', content: [{ text: 'Quotation' }] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/quote/report-doc/seed.test.ts`
Expected: FAIL — `Cannot find module './seed'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/quote/report-doc/seed.ts`:

```ts
// Build a default ReportDoc from a quote's existing structured fields, so a
// quote with no document opens as an editable document that matches today's
// rendered output (title + scope + Good/Better/Best + assumptions). Called
// lazily on first editor open in Phase 1; no bulk backfill (spec §3).

import type { ReportDoc, ReportDocBlock } from './types'

export function buildDefaultReportDoc(args: {
  title?: string | null
  scopeOfWorks?: string | null
  assumptions?: string[] | null
}): ReportDoc {
  const blocks: ReportDocBlock[] = [
    { type: 'title', content: [{ text: args.title?.trim() || 'Quotation' }] },
  ]

  if (args.scopeOfWorks && args.scopeOfWorks.trim()) {
    blocks.push({ type: 'heading', content: [{ text: 'Scope of works' }] })
    blocks.push({ type: 'paragraph', content: [{ text: args.scopeOfWorks.trim() }] })
  }

  blocks.push({ type: 'pricing' })

  const assumptions = (args.assumptions ?? []).filter((a) => a && a.trim())
  if (assumptions.length > 0) {
    blocks.push({ type: 'heading', content: [{ text: 'Assumptions' }] })
    blocks.push({ type: 'bulletList', items: assumptions.map((a) => [{ text: a.trim() }]) })
  }

  return { version: 1, blocks }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/quote/report-doc/seed.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/quote/report-doc/seed.ts lib/quote/report-doc/seed.test.ts
git commit -m "feat(quotes): default report_doc seeder from existing quote fields"
```

---

## Task 8: Phase-0 gate — full typecheck + test run

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole app**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Run the full quote-lib test suite**

Run: `pnpm vitest run lib/quote/`
Expected: PASS — new suites (`style`, `serialize`, `seed`, extended `pdf-signature`) green; existing suites (`report-html`, `pdf-signature` originals) unchanged.

- [ ] **Step 3: Confirm no live path changed**

Run: `git diff main --stat`
Expected: only new files under `lib/quote/report-doc/`, `sql/migrations/161*`, `scripts/run-migration-161.mjs`, and the two small edits to `report-html.ts` + `pdf-signature.ts`. No route, no `pdf.ts`, no `gotenberg.ts`, no React changes — Phase 0 is dormant.

---

## Production apply (separate, authorized step — NOT part of task execution)

The migration is written and post-verifiable but must be applied to production Supabase deliberately. When authorized:

```bash
node --env-file=.env.local scripts/run-migration-161.mjs
```

Expected: `pre-flight … exists = false` for both columns, `migration 161 applied`, `post-verify … exists = true` for both. Additive + idempotent — safe to re-run. Rollback: apply `sql/migrations/161_down.sql`.

---

## Self-Review

- **Spec coverage (Phase 0 rows of §11):** columns → Task 1; `report_style` allow-list (§3.1) → Task 3; deterministic serializer + esc XSS (§7, §9) → Tasks 4-5; `pdf_signature` extension (§10.2) → Task 6; default-doc seed (§3) → Task 7; "no new deps, invisible" → Task 8 verifies dormancy. Phase 1/2 items intentionally excluded.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `ReportDoc`/`ReportDocText`/`ReportDocMark` (Task 2) are used identically in Tasks 5 & 7; `renderQuoteTiersHtml` signature (Task 4) matches its consumer in Task 5; `quotePdfSignature.docHash` (Task 6) is optional so all existing callers compile unchanged.
- **Money-safety:** no task touches `/api/quote/[id]/edit`, `pdf.ts`, Stripe, or grounding. The serializer reads prices only via `renderQuoteTiersHtml` (from `good/better/best`).
