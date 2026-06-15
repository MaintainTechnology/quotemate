// Unit tests for the MT-QM-PRICING-KB estimate verifier (kb-verify).
// All pure functions plus the best-effort I/O wrapper with an injected
// search dep — no real network.

import { describe, it, expect } from 'vitest'
import {
  kbVerifyMode,
  buildKbVerifyQuery,
  parseKbPrices,
  reconcileDraftAgainstKb,
  applyKbReconciliation,
  runKbEstimateVerification,
  KB_PRICING_STORE_DEFAULT,
  type KbPriceFinding,
} from './kb-verify'

// ── kbVerifyMode ─────────────────────────────────────────────────────
describe('kbVerifyMode', () => {
  it('defaults to off when unset or falsey', () => {
    expect(kbVerifyMode({} as NodeJS.ProcessEnv)).toBe('off')
    expect(kbVerifyMode({ KB_VERIFY_ESTIMATES: '0' } as never)).toBe('off')
    expect(kbVerifyMode({ KB_VERIFY_ESTIMATES: 'false' } as never)).toBe('off')
  })
  it('maps 1/true/shadow to shadow', () => {
    expect(kbVerifyMode({ KB_VERIFY_ESTIMATES: '1' } as never)).toBe('shadow')
    expect(kbVerifyMode({ KB_VERIFY_ESTIMATES: 'true' } as never)).toBe('shadow')
    expect(kbVerifyMode({ KB_VERIFY_ESTIMATES: 'shadow' } as never)).toBe('shadow')
  })
  it('maps apply to apply', () => {
    expect(kbVerifyMode({ KB_VERIFY_ESTIMATES: 'apply' } as never)).toBe('apply')
    expect(kbVerifyMode({ KB_VERIFY_ESTIMATES: 'APPLY' } as never)).toBe('apply')
  })
})

// ── buildKbVerifyQuery ───────────────────────────────────────────────
describe('buildKbVerifyQuery', () => {
  it('includes trade, job type, and every distinct line description', () => {
    const intake = { trade: 'electrical', job_type: 'downlights' }
    const draft = {
      good: { line_items: [{ description: 'Tri-colour LED downlight' }, { description: 'Labour' }] },
      better: { line_items: [{ description: 'Tri-colour LED downlight' }] },
    }
    const q = buildKbVerifyQuery(intake, draft)
    expect(q).toContain('electrical')
    expect(q).toContain('downlights')
    expect(q).toContain('- Tri-colour LED downlight')
    expect(q).toContain('- Labour')
    // De-duplicated — the downlight appears once in the Items list.
    expect(q.match(/- Tri-colour LED downlight/g)).toHaveLength(1)
  })
})

// ── parseKbPrices ────────────────────────────────────────────────────
describe('parseKbPrices', () => {
  it('extracts label/price pairs from prose with various phrasings', () => {
    const answer =
      'The tri-colour LED downlight is priced at $38.50 ex GST.\n' +
      'Double GPO power point: $45.00.\n' +
      '- Smoke alarm (240V interconnected) — $89\n' +
      'Labour is charged at $110/hr.'
    const f = parseKbPrices(answer)
    const byPrice = Object.fromEntries(f.map((x) => [x.price, x.label]))
    expect(byPrice[38.5]).toContain('downlight')
    expect(byPrice[45]).toContain('gpo')
    expect(byPrice[89]).toContain('smoke alarm')
    expect(byPrice[110]).toContain('labour')
  })
  it('handles thousands separators and ignores $0 / no-price lines', () => {
    const f = parseKbPrices('Switchboard upgrade is $1,250.00. This item is not in the KB.')
    expect(f).toHaveLength(1)
    expect(f[0].price).toBe(1250)
  })
  it('returns [] for empty / non-string input', () => {
    expect(parseKbPrices('')).toEqual([])
    expect(parseKbPrices(undefined as never)).toEqual([])
  })
})

// ── reconcileDraftAgainstKb ──────────────────────────────────────────
describe('reconcileDraftAgainstKb', () => {
  const findings: KbPriceFinding[] = [
    { label: 'tri colour led downlight', price: 38.5 },
    { label: 'double gpo power point', price: 45 },
  ]

  it('confirms a line within tolerance, flags a mismatch, marks unknown lines uncovered', () => {
    const draft = {
      good: {
        line_items: [
          { description: 'Tri-colour LED downlight', unit_price_ex_gst: 39 }, // ~1% → confirmed
          { description: 'Double GPO power point', unit_price_ex_gst: 60 }, // +33% → mismatch
          { description: 'Custom widget nobody knows', unit_price_ex_gst: 12 }, // uncovered
        ],
      },
    }
    const r = reconcileDraftAgainstKb({ draft, findings })
    expect(r.summary).toEqual({ confirmed: 1, mismatch: 1, uncovered: 1 })
    expect(r.corrections).toEqual([{ tier: 'good', lineIndex: 1, from: 60, to: 45 }])
    expect(r.flags).toHaveLength(1)
    expect(r.flags[0]).toContain('Double GPO power point')
    expect(r.flags[0]).toContain('$45.00')
  })

  it('skips lines without a price or description and tolerates missing tiers', () => {
    const draft = {
      good: { line_items: [{ description: 'Tri-colour LED downlight' /* no price */ }] },
      better: null,
    }
    const r = reconcileDraftAgainstKb({ draft, findings })
    expect(r.verdicts).toHaveLength(0)
  })
})

// ── applyKbReconciliation ────────────────────────────────────────────
describe('applyKbReconciliation', () => {
  function draftWithMismatch() {
    return {
      good: {
        line_items: [
          { description: 'Double GPO power point', unit_price_ex_gst: 60, quantity: 2, line_total_ex_gst: 120 },
        ],
      },
      risk_flags: ['existing flag'],
    }
  }

  it('shadow mode: appends flags but never changes a price', () => {
    const draft = draftWithMismatch()
    const recon = reconcileDraftAgainstKb({
      draft,
      findings: [{ label: 'double gpo power point', price: 45 }],
    })
    const res = applyKbReconciliation(draft, recon, 'shadow')
    expect(res.corrected).toBe(0)
    expect(draft.good.line_items[0].unit_price_ex_gst).toBe(60) // unchanged
    expect(draft.risk_flags).toContain('existing flag')
    expect(draft.risk_flags.some((f) => f.includes('[kb-verify]'))).toBe(true)
  })

  it('apply mode: overwrites the unit price and keeps the line total consistent', () => {
    const draft = draftWithMismatch()
    const recon = reconcileDraftAgainstKb({
      draft,
      findings: [{ label: 'double gpo power point', price: 45 }],
    })
    const res = applyKbReconciliation(draft, recon, 'apply')
    expect(res.corrected).toBe(1)
    expect(draft.good.line_items[0].unit_price_ex_gst).toBe(45)
    expect(draft.good.line_items[0].line_total_ex_gst).toBe(90) // 45 × 2
  })

  it('off mode: no-op', () => {
    const draft = draftWithMismatch()
    const recon = reconcileDraftAgainstKb({
      draft,
      findings: [{ label: 'double gpo power point', price: 45 }],
    })
    const res = applyKbReconciliation(draft, recon, 'off')
    expect(res).toEqual({ flagged: 0, corrected: 0 })
    expect(draft.good.line_items[0].unit_price_ex_gst).toBe(60)
    expect(draft.risk_flags).toEqual(['existing flag'])
  })
})

// ── runKbEstimateVerification (I/O wrapper, injected search) ──────────
describe('runKbEstimateVerification', () => {
  const intake = { trade: 'electrical', job_type: 'gpo' }
  const pricedDraft = () => ({
    good: { line_items: [{ description: 'Double GPO power point', unit_price_ex_gst: 60 }] },
  })

  it('returns null when the feature is off', async () => {
    const out = await runKbEstimateVerification(
      { intake, draft: pricedDraft(), env: {} as NodeJS.ProcessEnv },
      { search: async () => ({ answer: 'Double GPO power point $45', passages: [], raw: {} }) },
    )
    expect(out).toBeNull()
  })

  it('returns null for an inspection draft (nothing to verify)', async () => {
    const out = await runKbEstimateVerification(
      {
        intake,
        draft: { needs_inspection: true },
        env: { KB_VERIFY_ESTIMATES: 'apply' } as never,
      },
      { search: async () => ({ answer: '$45', passages: [], raw: {} }) },
    )
    expect(out).toBeNull()
  })

  it('shadow: flags a mismatch without changing the price; targets the default store', async () => {
    const draft = pricedDraft()
    let usedStore = ''
    const out = await runKbEstimateVerification(
      { intake, draft, env: { KB_VERIFY_ESTIMATES: '1' } as never },
      {
        search: async (input) => {
          usedStore = input.store
          return { answer: 'The double GPO power point is $45.00.', passages: [], raw: {} }
        },
      },
    )
    expect(usedStore).toBe(KB_PRICING_STORE_DEFAULT)
    expect(out?.mode).toBe('shadow')
    expect(out?.reconciliation.summary.mismatch).toBe(1)
    expect(out?.corrected).toBe(0)
    expect(draft.good.line_items[0].unit_price_ex_gst).toBe(60) // unchanged in shadow
    expect((draft as { risk_flags?: string[] }).risk_flags?.[0]).toContain('[kb-verify]')
  })

  it('apply: rewrites the mismatched price to the KB figure', async () => {
    const draft = pricedDraft()
    const out = await runKbEstimateVerification(
      { intake, draft, env: { KB_VERIFY_ESTIMATES: 'apply' } as never },
      { search: async () => ({ answer: 'Double GPO power point: $45.00', passages: [], raw: {} }) },
    )
    expect(out?.mode).toBe('apply')
    expect(out?.corrected).toBe(1)
    expect(draft.good.line_items[0].unit_price_ex_gst).toBe(45)
  })

  it('degrades safely to null when the KB search throws', async () => {
    const draft = pricedDraft()
    const out = await runKbEstimateVerification(
      { intake, draft, env: { KB_VERIFY_ESTIMATES: 'apply' } as never },
      {
        search: async () => {
          throw new Error('KB 503')
        },
      },
    )
    expect(out).toBeNull()
    expect(draft.good.line_items[0].unit_price_ex_gst).toBe(60) // untouched
  })

  it('returns null when the KB answer has no parseable price', async () => {
    const draft = pricedDraft()
    const out = await runKbEstimateVerification(
      { intake, draft, env: { KB_VERIFY_ESTIMATES: 'apply' } as never },
      { search: async () => ({ answer: 'No pricing information available.', passages: [], raw: {} }) },
    )
    expect(out).toBeNull()
  })
})
