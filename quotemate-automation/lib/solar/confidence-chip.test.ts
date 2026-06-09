// c:/Users/dalig/Downloads/QuoteMate/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/confidence-chip.test.ts
import { describe, expect, it } from 'vitest'
import { confidenceChip } from './confidence-chip'

describe('confidenceChip', () => {
  it('tight band on a covered Google estimate → ±20%, no indicative-only chip', () => {
    const chip = confidenceChip({ band: 'tight', coverageSource: 'google' })
    expect(chip).toEqual({
      bandLabel: '±20%',
      tone: 'accent',
      indicativeOnly: false,
      caption: 'Estimate accuracy ±20% based on aerial imagery.',
    })
  })

  it('wide band → ±30% and shows the indicative-only chip', () => {
    const chip = confidenceChip({ band: 'wide', coverageSource: 'google' })
    expect(chip).toEqual({
      bandLabel: '±30%',
      tone: 'warning',
      indicativeOnly: true,
      caption: 'Wider ±30% range — your installer will refine this on site.',
    })
  })

  it('manual coverage forces the wide band and indicative-only chip even if band says tight', () => {
    const chip = confidenceChip({ band: 'tight', coverageSource: 'manual' })
    expect(chip.bandLabel).toBe('±30%')
    expect(chip.indicativeOnly).toBe(true)
    expect(chip.tone).toBe('warning')
    expect(chip.caption).toBe(
      'Based on the details you provided — your installer will confirm from a site visit.',
    )
  })
})
