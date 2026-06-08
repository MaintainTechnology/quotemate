// Tests for Step 2 (brand file-store cross-check). PURE builders/parser
// tested directly; the thin IO uses injected fetch + vision so no real
// network / model calls happen.

import { describe, expect, it, vi } from 'vitest'
import {
  assessShotAgainstStores,
  buildKbVisionPrompt,
  buildRetrievalQuery,
  parseKbAssessment,
  retrievePassages,
  runKbStage,
  type KbVisionFn,
} from './kb-assess'
import type { KbConfig, KbFetch } from '../admin-loader/mt-filestore-kb'
import type { BrandConfig, SignageRule } from './types'

const config: KbConfig = { url: 'https://kb.example.com', apiKey: 'test-key' }

const AF: BrandConfig = {
  slug: 'anytime-fitness',
  name: 'Anytime Fitness',
  location_noun: 'club',
  location_noun_plural: 'clubs',
  hq_name: 'Anytime Fitness HQ',
  vision_persona: 'Anytime Fitness 24/7 gyms',
  shots: [{ slot: 'storefront', label: 'Storefront', instruction: 'Shoot the front' }],
}

function rule(partial: Partial<SignageRule> & { rule_key: string }): SignageRule {
  return {
    rule_key: partial.rule_key,
    rule_text: partial.rule_text ?? 'Some rule',
    rule_group: partial.rule_group ?? 'storefront',
    modality: partial.modality ?? 'must',
    applicability: partial.applicability ?? 'auto_vision',
    confidence: partial.confidence ?? 'high',
    mvp_tier: partial.mvp_tier ?? 'mvp_core',
    verdict_mode: partial.verdict_mode ?? 'pass_fail',
    required_shots: partial.required_shots ?? ['storefront'],
    check_hint: partial.check_hint ?? null,
    source_citation: partial.source_citation ?? null,
  }
}

function mockSearch(answer: string, passages: unknown[] = []): KbFetch {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ answer, passages }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as KbFetch
}

const PHOTO = { base64: 'AAAA', mime: 'image/jpeg' }

// ── Pure builders ───────────────────────────────────────────────────

describe('buildRetrievalQuery', () => {
  it('names the brand + shot and lists the rule topics', () => {
    const q = buildRetrievalQuery({ brand: AF, shotLabel: 'Storefront', rules: [rule({ rule_key: 'r', rule_text: 'Logo must be the 2025 wordmark' })] })
    expect(q).toContain('Anytime Fitness')
    expect(q).toContain('Storefront')
    expect(q).toContain('2025 wordmark')
    expect(q.toLowerCase()).toContain('cite')
  })

  it('falls back to generic topics with no rules', () => {
    const q = buildRetrievalQuery({ brand: AF, shotLabel: 'Storefront', rules: [] })
    expect(q.toLowerCase()).toContain('colour family')
  })
})

describe('buildKbVisionPrompt', () => {
  it('embeds the passages, rules and strict-JSON contract', () => {
    const p = buildKbVisionPrompt({
      brand: AF,
      shotLabel: 'Storefront',
      passages: 'The storefront must use the purple V.',
      rules: [rule({ rule_key: 'v-design', rule_text: 'V graphic present' })],
    })
    expect(p).toContain('purple V')
    expect(p).toContain('[v-design]')
    expect(p).toContain('STRICT JSON')
    expect(p).toContain('new_findings')
    expect(p).toContain('colour by FAMILY')
  })

  it('handles empty passages gracefully', () => {
    const p = buildKbVisionPrompt({ brand: AF, shotLabel: 'Storefront', passages: '', rules: [] })
    expect(p).toContain('no passages were retrieved')
  })
})

// ── Parser ──────────────────────────────────────────────────────────

describe('parseKbAssessment', () => {
  const allow = ['a', 'b']

  it('parses verdicts + new findings, dropping unknown keys', () => {
    const text = `Here you go:
\`\`\`json
{ "verdicts": [
   { "rule_key": "a", "status": "non_compliant", "confidence": "high", "evidence": "old logo", "citation": "p.12" },
   { "rule_key": "zzz", "status": "compliant", "confidence": "high", "evidence": "x", "citation": null }
  ],
  "new_findings": [ { "description": "Decals missing", "citation": "p.4" } ] }
\`\`\``
    const out = parseKbAssessment(text, allow)
    expect(out.verdicts).toHaveLength(1)
    expect(out.verdicts[0]).toMatchObject({ rule_key: 'a', status: 'non_compliant', citation: 'p.12' })
    expect(out.advisory).toEqual([{ description: 'Decals missing', citation: 'p.4' }])
  })

  it('coerces unknown status/confidence to the safe values', () => {
    const out = parseKbAssessment('{"verdicts":[{"rule_key":"a","status":"maybe","confidence":"???","evidence":""}]}', allow)
    expect(out.verdicts[0].status).toBe('cannot_determine')
    expect(out.verdicts[0].confidence).toBe('low')
  })

  it('treats "null"/"none" citation strings as null', () => {
    const out = parseKbAssessment('{"verdicts":[{"rule_key":"a","status":"compliant","citation":"none"}]}', allow)
    expect(out.verdicts[0].citation).toBeNull()
  })

  it('returns empty for unreadable input', () => {
    expect(parseKbAssessment('not json', allow)).toEqual({ verdicts: [], advisory: [] })
    expect(parseKbAssessment('', allow)).toEqual({ verdicts: [], advisory: [] })
  })
})

// ── retrievePassages (injected fetch) ───────────────────────────────

describe('retrievePassages', () => {
  it('concatenates answers + passages across stores, never throws on error', async () => {
    const f = mockSearch('Storefront must use the purple V.', [{ text: 'V graphic required', page: 8, documentTitle: 'Design Manual' }])
    const out = await retrievePassages(config, { stores: ['fileSearchStores/a', 'fileSearchStores/b'], query: 'q', fetchImpl: f })
    expect(out.passages).toContain('purple V')
    expect(out.passages).toContain('V graphic required')
    expect(out.cited.length).toBeGreaterThan(0)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('a failing store contributes nothing but does not throw', async () => {
    const f = vi.fn().mockResolvedValue(new Response('boom', { status: 500 })) as unknown as KbFetch
    const out = await retrievePassages(config, { stores: ['fileSearchStores/a'], query: 'q', fetchImpl: f })
    expect(out.passages).toBe('')
    expect(out.cited).toEqual([])
  })
})

// ── assessShotAgainstStores (injected fetch + vision) ───────────────

describe('assessShotAgainstStores', () => {
  it('retrieves then judges, attaching a fallback citation from passages', async () => {
    const f = mockSearch('Logo must be 2025 wordmark.', [{ text: 'wordmark', page: 12, documentTitle: 'AF Design Manual' }])
    const vision: KbVisionFn = vi.fn().mockResolvedValue(
      '{"verdicts":[{"rule_key":"logo","status":"non_compliant","confidence":"high","evidence":"old wordmark"}],"new_findings":[{"description":"Door decals faded"}]}',
    )
    const out = await assessShotAgainstStores(config, {
      brand: AF,
      slot: 'storefront',
      shotLabel: 'Storefront',
      photo: PHOTO,
      rules: [rule({ rule_key: 'logo' })],
      stores: ['fileSearchStores/a'],
      fetchImpl: f,
      vision,
    })
    expect(out.ok).toBe(true)
    expect(out.verdicts[0].status).toBe('non_compliant')
    expect(out.verdicts[0].citation).toBe('AF Design Manual p.12') // fallback from passages
    expect(out.advisory[0]).toMatchObject({ shot: 'storefront', description: 'Door decals faded', store: 'fileSearchStores/a' })
  })

  it('no stores or no rules → ok with empty results (not a failure)', async () => {
    const vision: KbVisionFn = vi.fn()
    const out = await assessShotAgainstStores(config, {
      brand: AF,
      slot: 'storefront',
      shotLabel: 'Storefront',
      photo: PHOTO,
      rules: [],
      stores: ['fileSearchStores/a'],
      vision,
    })
    expect(out).toEqual({ verdicts: [], advisory: [], ok: true })
    expect(vision).not.toHaveBeenCalled()
  })

  it('a thrown vision call degrades to ok:false / empty', async () => {
    const f = mockSearch('passages')
    const vision: KbVisionFn = vi.fn().mockRejectedValue(new Error('model down'))
    const out = await assessShotAgainstStores(config, {
      brand: AF,
      slot: 'storefront',
      shotLabel: 'Storefront',
      photo: PHOTO,
      rules: [rule({ rule_key: 'logo' })],
      stores: ['fileSearchStores/a'],
      fetchImpl: f,
      vision,
    })
    expect(out.ok).toBe(false)
    expect(out.verdicts).toEqual([])
  })
})

// ── runKbStage ──────────────────────────────────────────────────────

describe('runKbStage', () => {
  it('returns empty (not degraded) for a brand with no stores', async () => {
    const out = await runKbStage(config, {
      brand: { ...AF, slug: 'mystery', kb_store_ids: [] },
      shots: [{ slot: 'storefront', label: 'Storefront', photo: PHOTO }],
      scopedRules: [rule({ rule_key: 'r' })],
      vision: vi.fn(),
    })
    expect(out).toEqual({ kbVerdicts: [], advisory: [], stores: [], degraded: false })
  })

  it('judges each shot against its in-scope auto rules and aggregates', async () => {
    const f = mockSearch('standards')
    const vision: KbVisionFn = vi.fn().mockResolvedValue(
      '{"verdicts":[{"rule_key":"sf","status":"compliant","confidence":"high","evidence":"ok"}]}',
    )
    const out = await runKbStage(config, {
      brand: AF, // anytime-fitness → 2 default stores
      shots: [{ slot: 'storefront', label: 'Storefront', photo: PHOTO }],
      scopedRules: [
        rule({ rule_key: 'sf', required_shots: ['storefront'] }),
        rule({ rule_key: 'other', required_shots: ['logo_wall'] }),
        rule({ rule_key: 'legal', required_shots: ['storefront'], verdict_mode: 'review' }), // not an auto rule
      ],
      fetchImpl: f,
      vision,
    })
    expect(out.stores).toHaveLength(2)
    expect(out.kbVerdicts.map((v) => v.rule_key)).toEqual(['sf']) // only the in-scope auto rule
    expect(out.degraded).toBe(false)
  })

  it('flags degraded when a shot assessment fails', async () => {
    const f = mockSearch('standards')
    const vision: KbVisionFn = vi.fn().mockRejectedValue(new Error('down'))
    const out = await runKbStage(config, {
      brand: AF,
      shots: [{ slot: 'storefront', label: 'Storefront', photo: PHOTO }],
      scopedRules: [rule({ rule_key: 'sf', required_shots: ['storefront'] })],
      fetchImpl: f,
      vision,
    })
    expect(out.degraded).toBe(true)
  })
})
