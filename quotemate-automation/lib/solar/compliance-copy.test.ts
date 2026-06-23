// c:/Users/dalig/Downloads/QuoteMax/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/compliance-copy.test.ts
import { describe, expect, it } from 'vitest'
import {
  SOLAR_COMPLIANCE_COPY,
  SOLAR_PRE_CONFIRM_COPY,
} from './compliance-copy'

describe('SOLAR_COMPLIANCE_COPY', () => {
  it('names a Solar Accreditation Australia (SAA)-accredited installer', () => {
    expect(SOLAR_COMPLIANCE_COPY).toContain(
      'Solar Accreditation Australia (SAA)-accredited installer',
    )
  })
  it('requires Clean Energy Council–approved components', () => {
    expect(SOLAR_COMPLIANCE_COPY).toContain(
      'Clean Energy Council–approved components',
    )
  })
  it('states the STC rebate is subject to eligibility and install date', () => {
    expect(SOLAR_COMPLIANCE_COPY).toContain(
      'STC rebate subject to eligibility & install date',
    )
  })
  it('makes clear this is an estimate, not a contract', () => {
    expect(SOLAR_COMPLIANCE_COPY).toContain('Estimate, not a contract.')
  })
})

describe('SOLAR_PRE_CONFIRM_COPY', () => {
  it('tells the customer the estimate exists and pricing is under review', () => {
    expect(SOLAR_PRE_CONFIRM_COPY).toBe(
      'We have estimated the system size and output. Your installer will review the price before it is released.',
    )
  })
})
