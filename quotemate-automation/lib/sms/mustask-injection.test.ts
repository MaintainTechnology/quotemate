// R24 + R27 — per-job MUST-ASK injection + inspection-trigger escalation
// rendering in the SMS dialog prompt.
//
// Background / confirmed drift (2026-06-18): shared_assemblies.clarifying_
// questions is NOT "mostly NULL" — the easy-set rows already carry their
// questions. The real gap was that the dialog system prompt never injected
// the easy-5 per-job MUST-ASK questions: migration 065 dropped them from
// rulesAsText() on the assumption every easy-set request would arrive as a
// matched custom service, but the easy-5 job types are HARDCODED in the
// dialog and are never passed through customAssemblies. These tests pin the
// re-injection so it can't silently regress again.

import { describe, expect, it } from 'vitest'
import {
  ASSUMPTION_RULES,
  mustAskLines,
  rulesAsText,
  type JobType,
} from './assumptions'
import { SYSTEM_PROMPT } from './dialog'

const EASY_SET: JobType[] = [
  'downlights', 'power_points', 'ceiling_fans', 'smoke_alarms', 'outdoor_lighting',
  'blocked_drain', 'hot_water', 'tap_repair', 'tap_replace', 'toilet_repair', 'toilet_replace',
]

describe('R24 — mustAskLines is the canonical per-job mandatory-question set', () => {
  it('returns the trimmed, non-empty mustAsk array for every easy-set job', () => {
    for (const jt of EASY_SET) {
      const lines = mustAskLines(jt)
      expect(lines.length).toBeGreaterThan(0)
      // No blank / whitespace-only entries leak through.
      for (const q of lines) {
        expect(q.trim().length).toBeGreaterThan(0)
        expect(q).toBe(q.trim())
      }
      // Matches the source array (minus blanks) — one source of truth.
      const expected = ASSUMPTION_RULES[jt].mustAsk
        .filter((q) => q.trim().length > 0)
        .map((q) => q.trim())
      expect(lines).toEqual(expected)
    }
  })
})

describe('R24 — rulesAsText injects a MUST-ASK block as a hard gate', () => {
  it.each(EASY_SET)('rulesAsText(%s) emits an ordered MUST-ASK block before finish', (jt) => {
    const t = rulesAsText(jt)
    expect(t).toContain('MUST ASK before any finish')
    // Every mandatory question is present and numbered in order.
    const lines = mustAskLines(jt)
    lines.forEach((q, i) => {
      expect(t).toContain(`${i + 1}. ${q}`)
    })
    // The block forbids finishing while a question is unanswered.
    expect(t).toMatch(/do NOT finish/i)
  })

  it('downlights MUST-ASK preserves the full colour option list verbatim', () => {
    const t = rulesAsText('downlights')
    expect(t).toContain('warm white, cool white, tri-colour, dimmable, smart Wi-Fi')
  })
})

describe('R27 — rulesAsText renders inspectionTriggers as escalation rules', () => {
  it.each(EASY_SET)('rulesAsText(%s) lists its own triggers as in-addition-to-universal escalation', (jt) => {
    const t = rulesAsText(jt)
    expect(t).toContain('INSPECTION TRIGGERS')
    expect(t).toMatch(/escalate_inspection/)
    expect(t).toMatch(/in\s+addition to the universal trigger list/i)
    // Every job-type trigger is rendered.
    for (const trig of ASSUMPTION_RULES[jt].inspectionTriggers) {
      expect(t).toContain(trig)
    }
  })

  it('downlights raked/cathedral/asbestos triggers are present (mig 069 set)', () => {
    const t = rulesAsText('downlights')
    expect(t).toContain('raked ceiling')
    expect(t).toContain('cathedral ceiling')
    expect(t).toContain('asbestos')
  })
})

describe('R24/R27 — the dialog SYSTEM_PROMPT carries the injected blocks', () => {
  it('frames the per-job MUST-ASK list as a hard gate before finish', () => {
    expect(SYSTEM_PROMPT).toMatch(/MUST-ASK questions are HARD per-job gates/i)
    expect(SYSTEM_PROMPT).toMatch(/BEFORE action='finish'/)
  })

  it('injects each easy-set job type’s MUST-ASK questions into the prompt', () => {
    // Spot-check one representative question per trade so the easy-set is
    // genuinely surfaced (not just the framing text).
    expect(SYSTEM_PROMPT).toContain('how many downlights')
    expect(SYSTEM_PROMPT).toContain('how many GPOs')
    expect(SYSTEM_PROMPT).toContain('current system type')
    expect(SYSTEM_PROMPT).toContain('like-for-like swap of existing alarms')
  })

  it('injects each easy-set job type’s inspection triggers as escalation rules', () => {
    expect(SYSTEM_PROMPT).toContain('cathedral ceiling')      // downlights
    expect(SYSTEM_PROMPT).toContain('sewage backing up')      // blocked_drain
    expect(SYSTEM_PROMPT).toContain('roof-mounted')           // hot_water
  })

  it('carries the safe-default guard (R29) — no silent default over a MUST-ASK', () => {
    expect(SYSTEM_PROMPT).toMatch(/SAFE-DEFAULT GUARD/i)
    expect(SYSTEM_PROMPT).toMatch(/never silently apply a\s+safe default/i)
  })
})
