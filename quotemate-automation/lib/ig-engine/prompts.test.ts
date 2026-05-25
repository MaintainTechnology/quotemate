// Item 1 — the pruned V2 preview prompt. The whole point of the prune
// is a short, high-signal instruction set: this suite locks in the
// word-count ceiling, the absence of text-LLM cargo-culting, and that
// the high-signal facts (count, anchor product) survived. Item 3's
// removal prompt and the replacement detector are covered here too.

import { describe, expect, it } from 'vitest'
import {
  buildPreviewPrompt,
  buildPreviewPromptV2,
  buildRemovalPrompt,
  buildSamplePrompts,
  defaultRoomForJobType,
  displayJobNoun,
  effectiveItemCount,
  isReplacementJob,
  ordinalPositions,
  type PromptContext,
} from './prompts'

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

// Cargo-culted text-LLM phrases an image model cannot act on — these
// must NOT survive into the pruned V2 prompt.
const CARGO_CULT = [
  'out loud',
  'redraft',
  'self-verify',
  'mentally',
  'verify_before_emit',
]

function ctx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    intake: {
      job_type: 'downlights',
      scope: {
        item_count: 6,
        is_new_install: false,
        description: 'replace the old downlights in the lounge room',
        specs: { color_temp: 'warm_white' },
      },
      access: { ceiling_type: 'flat' },
      caller: { name: 'Sarah' },
    },
    quote: { selected_tier: 'better', needs_inspection: false },
    lineItems: [
      {
        tier: 'better',
        description: '6 × Dimmable LED downlight (Brilliant)',
        quantity: 6,
        source: 'material',
      },
    ],
    corrections: [],
    ...overrides,
  }
}

describe('buildPreviewPromptV2 — pruned prompt', () => {
  it('stays within the 600-word ceiling', () => {
    const p = buildPreviewPromptV2(ctx())
    const total = wordCount(p.system) + wordCount(p.user)
    expect(total).toBeLessThanOrEqual(600)
    expect(total).toBeGreaterThan(120) // still substantive
  })

  it('is dramatically shorter than the legacy V1 prompt', () => {
    const v1 = buildPreviewPrompt(ctx())
    const v2 = buildPreviewPromptV2(ctx())
    const v1Words = wordCount(v1.system) + wordCount(v1.user)
    const v2Words = wordCount(v2.system) + wordCount(v2.user)
    expect(v2Words).toBeLessThan(v1Words)
  })

  it('keeps the high-signal facts: exact count and the anchor product', () => {
    const p = buildPreviewPromptV2(ctx())
    expect(p.system).toContain('6') // the count
    expect(p.system).toContain('downlights')
    expect(p.system).toContain('Brilliant') // the anchor product name
  })

  it('drops text-LLM cargo-culting phrases', () => {
    const p = buildPreviewPromptV2(ctx())
    const blob = `${p.system}\n${p.user}`.toLowerCase()
    for (const phrase of CARGO_CULT) {
      expect(blob).not.toContain(phrase)
    }
  })

  it('flags a replacement job so the old fitting gets removed', () => {
    const p = buildPreviewPromptV2(ctx())
    expect(p.system.toLowerCase()).toContain('replacement')
  })

  it('still produces a prompt when there is no anchor or count', () => {
    const bare = buildPreviewPromptV2(
      ctx({
        intake: { job_type: 'power_points', caller: { name: 'Joe' } },
        lineItems: [],
      }),
    )
    expect(bare.system.length).toBeGreaterThan(0)
    expect(bare.user.length).toBeGreaterThan(0)
  })
})

describe('buildRemovalPrompt — two-pass pass 1', () => {
  it('instructs removal of the existing fittings only', () => {
    const p = buildRemovalPrompt(ctx())
    expect(p.system.toLowerCase()).toContain('remove')
    expect(p.system).toContain('downlights')
    expect(p.user.toLowerCase()).toContain('removal only')
  })

  it('explicitly forbids installing anything new in pass 1', () => {
    const p = buildRemovalPrompt(ctx())
    expect(p.system.toLowerCase()).toContain('only removes')
  })

  it('is short and single-purpose', () => {
    const p = buildRemovalPrompt(ctx())
    expect(wordCount(p.system)).toBeLessThan(180)
  })
})

// ── Fix #2 — sensible single-item defaults ──────────────────────────
describe('effectiveItemCount — Fix #2', () => {
  it('returns the customer-stated count when present (always wins)', () => {
    expect(effectiveItemCount(ctx())).toBe(6) // ctx default sets item_count=6
  })

  it('falls back to 1 for inherently single-item plumbing jobs', () => {
    const make = (job_type: string) => ctx({
      intake: { job_type, scope: { description: 'x' }, caller: { name: 'A' } },
    })
    expect(effectiveItemCount(make('hot_water'))).toBe(1)
    expect(effectiveItemCount(make('blocked_drain'))).toBe(1)
    expect(effectiveItemCount(make('tap_repair'))).toBe(1)
    expect(effectiveItemCount(make('tap_replace'))).toBe(1)
    expect(effectiveItemCount(make('toilet_repair'))).toBe(1)
    expect(effectiveItemCount(make('toilet_replace'))).toBe(1)
    expect(effectiveItemCount(make('burst_pipe'))).toBe(1)
    expect(effectiveItemCount(make('prv_install'))).toBe(1)
    expect(effectiveItemCount(make('ev_charger'))).toBe(1)
  })

  it('returns null for job types with no sensible single-item default', () => {
    const make = (job_type: string) => ctx({
      intake: { job_type, scope: { description: 'x' }, caller: { name: 'A' } },
    })
    expect(effectiveItemCount(make('other'))).toBeNull()
    expect(effectiveItemCount(make('switchboard'))).toBeNull()
    expect(effectiveItemCount(make('downlights'))).toBeNull() // count-bearing type, no default
  })

  it('treats item_count of 0 as missing (default applies)', () => {
    const c = ctx({
      intake: {
        job_type: 'hot_water',
        scope: { item_count: 0, description: 'x' },
        caller: { name: 'A' },
      },
    })
    expect(effectiveItemCount(c)).toBe(1)
  })

  it('customer-stated count wins over the per-job-type default', () => {
    const c = ctx({
      intake: {
        job_type: 'hot_water',
        scope: { item_count: 2, description: 'two HWS units' },
        caller: { name: 'A' },
      },
    })
    expect(effectiveItemCount(c)).toBe(2)
  })
})

// ── Fix #3 — generic placement fallback ─────────────────────────────
describe('ordinalPositions — Fix #3', () => {
  it('keeps the specialised ceiling grid for downlights ≥3 (unchanged)', () => {
    const out = ordinalPositions('downlights', 6)
    expect(out).not.toBeNull()
    expect(out!.length).toBe(6)
    expect(out!.join(' ').toLowerCase()).toContain('ceiling')
    expect(out!.join(' ')).toContain('FIRST')
  })

  it('NEW: now provides generic placement for small counts (1–2) on known types', () => {
    const one = ordinalPositions('downlights', 1)
    expect(one).not.toBeNull()
    expect(one!.length).toBe(1)
    expect(one![0].toLowerCase()).toContain('downlight')

    const two = ordinalPositions('downlights', 2)
    expect(two).not.toBeNull()
    expect(two!.length).toBe(2)
  })

  it('NEW: provides generic placement for previously-unlisted job types', () => {
    expect(ordinalPositions('hot_water', 1)).not.toBeNull()
    expect(ordinalPositions('blocked_drain', 1)).not.toBeNull()
    expect(ordinalPositions('tap_replace', 1)).not.toBeNull()
    expect(ordinalPositions('other', 1)).not.toBeNull()
  })

  it('single-item placement names the existing-connection / mounting point', () => {
    const out = ordinalPositions('hot_water', 1)
    expect(out![0]).toMatch(/existing|mounting/i)
  })

  it('multi-item generic placement uses ordinals and a per-N position', () => {
    const out = ordinalPositions('hot_water', 3)
    expect(out!.length).toBe(3)
    expect(out![0]).toMatch(/FIRST/)
    expect(out![2]).toMatch(/position 3 of 3/i)
  })

  it('returns null for missing or non-positive counts', () => {
    expect(ordinalPositions('downlights', null)).toBeNull()
    expect(ordinalPositions('hot_water', 0)).toBeNull()
    expect(ordinalPositions('hot_water', -1)).toBeNull()
  })

  it('caps the count at 12 to avoid bloated placement lists', () => {
    const out = ordinalPositions('hot_water', 50)
    expect(out!.length).toBe(12)
  })
})

// ── Fix #6 — samples pruned to V2 ───────────────────────────────────
describe('buildSamplePrompts — Fix #6 (V2 prune)', () => {
  it('returns wide / detail / lit shots, each shorter than the legacy V1 ceiling', () => {
    const p = buildSamplePrompts(ctx(), { usePhotoReference: true })
    expect(p).not.toBeNull()
    expect(p!.wide).toBeDefined()
    expect(p!.detail).toBeDefined()
    expect(p!.lit).toBeDefined()
    // Each V2 system instruction should be well under 800 words —
    // legacy V1 was ~3000+ for the same content.
    for (const shot of [p!.wide, p!.detail, p!.lit]) {
      expect(wordCount(shot.system)).toBeLessThan(800)
      expect(wordCount(shot.system)).toBeGreaterThan(80)
    }
  })

  it('drops the V1 cargo-cult markers from sample prompts', () => {
    const p = buildSamplePrompts(ctx(), { usePhotoReference: true })!
    const blob = `${p.wide.system}\n${p.detail.system}\n${p.lit.system}\n${p.wide.user}`.toLowerCase()
    for (const phrase of ['final checklist', 'master rules', 'out loud', 'redraft until']) {
      expect(blob).not.toContain(phrase)
    }
  })

  it('every shot mentions the anchor product (cross-shot consistency)', () => {
    const p = buildSamplePrompts(ctx(), { usePhotoReference: true })!
    for (const shot of [p.wide, p.detail, p.lit]) {
      expect(shot.system).toContain('Brilliant') // anchor brand from ctx()
    }
  })

  it('text-to-image mode produces a valid prompt set when no photo is attached', () => {
    const p = buildSamplePrompts(ctx(), { usePhotoReference: false })!
    expect(p.wide.system).toBeTruthy()
    expect(p.wide.system).toContain('Australian') // generic-room language fires
  })
})

// ── Grammar polish — singular/plural agreement ─────────────────────
describe('displayJobNoun — singular/plural', () => {
  it('returns the singular noun when count is 1', () => {
    expect(displayJobNoun('smoke_alarms', 1)).toBe('smoke alarm')
    expect(displayJobNoun('downlights', 1)).toBe('downlight')
    expect(displayJobNoun('power_points', 1)).toBe('power point')
    expect(displayJobNoun('hot_water', 1)).toBe('hot water system')
    expect(displayJobNoun('tap_repair', 1)).toBe('tap')
    expect(displayJobNoun('toilet_replace', 1)).toBe('toilet')
    expect(displayJobNoun('ev_charger', 1)).toBe('EV charger')
  })

  it('returns the plural noun when count is > 1', () => {
    expect(displayJobNoun('smoke_alarms', 6)).toBe('smoke alarms')
    expect(displayJobNoun('hot_water', 2)).toBe('hot water systems')
    expect(displayJobNoun('tap_replace', 3)).toBe('taps')
  })

  it('falls back gracefully for unknown job types', () => {
    expect(displayJobNoun('weird_unknown_job', 1)).toBeTruthy()
    expect(displayJobNoun('weird_unknown_job', 2)).toBeTruthy()
  })
})

// ── Per-job-type room fallback ─────────────────────────────────────
describe('defaultRoomForJobType', () => {
  it('returns a sensible location for jobs with implicit rooms', () => {
    expect(defaultRoomForJobType('hot_water')).toMatch(/utility|laundry|garage/i)
    expect(defaultRoomForJobType('ev_charger')).toMatch(/garage|driveway/i)
    expect(defaultRoomForJobType('switchboard')).toMatch(/switchboard/i)
    expect(defaultRoomForJobType('burst_pipe')).toMatch(/leak/i)
  })

  it('falls back to "space" for unmapped job types', () => {
    expect(defaultRoomForJobType('downlights')).toBe('space')
    expect(defaultRoomForJobType('made_up_job')).toBe('space')
  })
})

// ── Prompt grammar — count agreement + room fallback + no-photo ────
describe('buildPreviewPromptV2 — grammar polish', () => {
  it('uses singular noun and "fitting" (singular) when count is 1', () => {
    const c = ctx({
      intake: {
        job_type: 'hot_water',
        scope: { is_new_install: false, description: 'hot water died' },
        caller: { name: 'Sarah' },
      },
      lineItems: [{
        tier: 'better',
        description: 'Rheem Stellar 360L HWS',
        quantity: 1,
        source: 'material',
        image_path: 'catalogue/rheem.jpg',
      }],
    })
    const p = buildPreviewPromptV2(c)
    expect(p.system).toContain('Render exactly 1 hot water system')
    expect(p.system).not.toContain('Render exactly 1 hot water —')
    expect(p.system).toContain('More or fewer than 1 fitting.')
    expect(p.system).not.toContain('1 fittings.')
  })

  it('uses plural noun and "fittings" (plural) when count > 1', () => {
    const p = buildPreviewPromptV2(ctx()) // default ctx has count=6 downlights
    expect(p.system).toContain('Render exactly 6 downlights')
    expect(p.system).toContain('More or fewer than 6 fittings.')
  })

  it('fills the room from the per-job-type default when none was detected', () => {
    const c = ctx({
      intake: {
        job_type: 'hot_water',
        scope: { description: 'hot water has died, family of 4' },
        caller: { name: 'Sarah' },
      },
      lineItems: [{
        tier: 'better',
        description: 'Rheem HWS',
        quantity: 1,
        source: 'material',
        image_path: 'x.jpg',
      }],
    })
    const p = buildPreviewPromptV2(c)
    expect(p.system).toMatch(/utility|laundry|garage/i)
    expect(p.system).not.toContain("in Sarah's space")
  })

  it('keeps a detected room from the description when one is present', () => {
    const c = ctx({
      intake: {
        job_type: 'tap_repair',
        scope: { description: 'dripping tap in the kitchen' },
        caller: { name: 'Joe' },
      },
      lineItems: [],
    })
    const p = buildPreviewPromptV2(c)
    expect(p.system).toContain('room=kitchen')
  })
})

describe('buildPreviewPromptV2 — no-reference-photo fallback', () => {
  it('adds the "NO REFERENCE PHOTO" instruction when the catalogue line has no image_path', () => {
    const c = ctx({
      lineItems: [{
        tier: 'better',
        description: 'Generic LED downlight (no photo on file)',
        quantity: 6,
        source: 'material',
        // NO image_path
      }],
    })
    const p = buildPreviewPromptV2(c)
    expect(p.system).toContain('NO REFERENCE PHOTO IS ATTACHED')
    expect(p.system).toContain('product_to_render')
    expect(p.system).toContain('verbatim_customer')
  })

  it('keeps the "if attached" instruction when image_path IS present', () => {
    const c = ctx({
      lineItems: [{
        tier: 'better',
        description: 'Brilliant LED downlight',
        quantity: 6,
        source: 'material',
        image_path: 'catalogue/brilliant.jpg',
      }],
    })
    const p = buildPreviewPromptV2(c)
    expect(p.system).not.toContain('NO REFERENCE PHOTO IS ATTACHED')
    expect(p.system).toContain('PRODUCT REFERENCE photo')
  })
})

describe('isReplacementJob', () => {
  it('is true when is_new_install is explicitly false', () => {
    expect(isReplacementJob(ctx())).toBe(true)
  })

  it('is false for a new install', () => {
    expect(
      isReplacementJob(
        ctx({
          intake: {
            job_type: 'downlights',
            scope: { item_count: 6, is_new_install: true },
            caller: { name: 'Sarah' },
          },
        }),
      ),
    ).toBe(false)
  })

  it('is false when is_new_install is unknown (null/undefined)', () => {
    expect(
      isReplacementJob(
        ctx({
          intake: {
            job_type: 'downlights',
            scope: { item_count: 6 },
            caller: { name: 'Sarah' },
          },
        }),
      ),
    ).toBe(false)
  })
})
