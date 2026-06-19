// Phase 3 (spec 2026-06-19) — per-tenant AI grounding helpers wired into
// lib/estimate/run.ts. These tests cover the PURE, no-I/O helpers that shape
// the advisory grounding block + retrieval query:
//
//   buildTenantGroundingBlock — renders a clearly-labelled "advisory only —
//     do not use as a price source" block from a KbSearchResult, or null when
//     there is nothing useful (so the prompt stays byte-identical when the KB
//     returns empty). Length-capped so a huge passage can't bloat the prompt.
//   buildTenantGroundingQuery — derives the retrieval query from the
//     structured intake (job type + scope summary), or null when there's
//     nothing to query on.
//
// The grounding feature is flag-gated on TENANT_FILESTORE_ENABLED in
// runEstimation; when the flag is off the helper is never invoked and the
// userPrompt is assembled exactly as before. The two safety guarantees this
// file proves directly:
//   • An empty / KB-unavailable result (searchTenantStore returns
//     {answer:'', passages:[]} when the KB is unavailable, and NEVER throws)
//     → buildTenantGroundingBlock returns null → no block appended → the
//     prompt is unchanged. This is the "a thrown/failed KB call does not
//     break the pipeline" contract at the formatter boundary.
//   • The block, when present, is advisory-labelled and capped — it is only
//     ever appended to the user-prompt background, never fed to tools / the
//     candidate loader / the grounding validator, so it cannot price.

import { describe, expect, it, vi } from 'vitest'

// run.ts instantiates a module-level Supabase client at import time
// (createClient throws if the URL env is absent). The helpers under test are
// pure and touch no DB, but importing the module still evaluates that line.
// vi.hoisted runs BEFORE the hoisted imports below, so stubbing the env here
// lets the module load without a live Supabase instance. No network/DB call
// is made by any test in this file.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
})

import { buildTenantGroundingBlock, buildTenantGroundingQuery } from './run'

describe('buildTenantGroundingBlock', () => {
  it('returns null for an empty KB result (KB unavailable / no matches → prompt unchanged)', () => {
    // searchTenantStore returns this exact shape when the KB is unavailable,
    // and is documented to never throw. A null block means runEstimation
    // appends nothing → the user prompt is byte-identical to the no-grounding
    // path.
    expect(buildTenantGroundingBlock({ answer: '', passages: [], raw: null })).toBeNull()
  })

  it('returns null for null/undefined input (defensive — best-effort path)', () => {
    expect(buildTenantGroundingBlock(null)).toBeNull()
    expect(buildTenantGroundingBlock(undefined)).toBeNull()
  })

  it('renders an advisory-labelled block from passages and NEVER frames it as a price source', () => {
    const block = buildTenantGroundingBlock({
      answer: 'You typically install 6 downlights with a dimmer for around 2 hours labour.',
      passages: [
        { text: 'Job: downlights x6, dimmer, 2.0h labour.', documentTitle: 'quote-2026-01-aaa' },
        { text: 'Invoice: downlight replacement, 4 units.', documentTitle: 'invoice-2026-02-bbb' },
      ],
      raw: null,
    })
    expect(block).not.toBeNull()
    const b = block as string
    // Clearly labelled advisory + explicit "do not use as a price source".
    expect(b).toContain('advisory only — do not use as a price source')
    expect(b.toLowerCase()).toContain('not a price source')
    // Carries the retrieved context + cites the source documents.
    expect(b).toContain('downlights')
    expect(b).toContain('quote-2026-01-aaa')
    expect(b).toContain('invoice-2026-02-bbb')
  })

  it('de-duplicates identical passages', () => {
    const block = buildTenantGroundingBlock({
      answer: '',
      passages: [
        { text: 'Blocked drain clear, 1.5h.', documentTitle: 'q1' },
        { text: 'Blocked drain clear, 1.5h.', documentTitle: 'q2' },
      ],
      raw: null,
    }) as string
    expect(block).not.toBeNull()
    // The duplicated snippet text appears exactly once.
    const occurrences = block.split('Blocked drain clear, 1.5h.').length - 1
    expect(occurrences).toBe(1)
  })

  it('caps the block length so a huge KB answer cannot bloat the prompt', () => {
    const huge = 'x'.repeat(50_000)
    const block = buildTenantGroundingBlock({
      answer: huge,
      passages: [{ text: huge, documentTitle: 'big' }],
      raw: null,
    }) as string
    expect(block).not.toBeNull()
    // Comfortably bounded (helper cap is 1800 + ellipsis).
    expect(block.length).toBeLessThan(2000)
  })
})

describe('buildTenantGroundingQuery', () => {
  it('builds a query from job_type + scope summary + item_count', () => {
    const q = buildTenantGroundingQuery({
      job_type: 'downlights',
      scope: { summary: 'replace kitchen downlights', item_count: 6 },
    })
    expect(q).not.toBeNull()
    const s = q as string
    expect(s).toContain('downlights')
    expect(s).toContain('replace kitchen downlights')
    expect(s).toContain('quantity 6')
  })

  it('returns null when the intake has nothing meaningful to query on', () => {
    expect(buildTenantGroundingQuery({})).toBeNull()
    expect(buildTenantGroundingQuery({ scope: {} })).toBeNull()
    expect(buildTenantGroundingQuery(null)).toBeNull()
  })

  it('caps the query length defensively', () => {
    const q = buildTenantGroundingQuery({
      job_type: 'x',
      scope: { summary: 'y'.repeat(2000), item_count: 1 },
    }) as string
    expect(q).not.toBeNull()
    expect(q.length).toBeLessThanOrEqual(500)
  })
})
