import { describe, it, expect } from 'vitest'
import {
  decideRouting,
  decideRoutingDetailed,
  parseAutoSendJobTypes,
  failedDeployGates,
  type DeployGate,
} from './decide'

const PASS_GATE: DeployGate = {
  determinismDiffZero: true,
  evalInBand: true,
  validatorFireZero: true,
  sanityBoundsPass: true,
  pricingConfirmed: true,
}

const HIGH = { confidence: 'HIGH' as const, inspection_required: false, job_type: 'downlights' }
const CLEAN_QUOTE = { needs_inspection: false }

describe('parseAutoSendJobTypes (R2)', () => {
  it('defaults to an empty allowlist (kill switch / off by default)', () => {
    expect(parseAutoSendJobTypes({})).toEqual([])
    expect(parseAutoSendJobTypes({ AUTO_SEND_JOBTYPES: '' })).toEqual([])
  })
  it('parses + normalises a CSV', () => {
    expect(parseAutoSendJobTypes({ AUTO_SEND_JOBTYPES: 'Downlights, hot_water ,' }))
      .toEqual(['downlights', 'hot_water'])
  })
})

describe('failedDeployGates (R23)', () => {
  it('fails closed when the gate is absent', () => {
    expect(failedDeployGates(undefined)).toEqual(['deploy_gate_absent'])
  })
  it('passes only when every condition holds', () => {
    expect(failedDeployGates(PASS_GATE)).toEqual([])
    expect(failedDeployGates({ ...PASS_GATE, pricingConfirmed: false })).toEqual(['pricing_unconfirmed'])
    expect(failedDeployGates({ ...PASS_GATE, evalInBand: false, validatorFireZero: false }))
      .toEqual(['eval_below_band', 'validator_fired'])
  })
})

describe('decideRouting', () => {
  const AUTO_OK = { autoSendJobTypes: ['downlights'], deployGate: PASS_GATE, pricingPath: 'deterministic' as const }

  it('inspection trigger always wins', () => {
    expect(decideRouting({ intake: { ...HIGH, inspection_required: true }, quote: CLEAN_QUOTE, ...AUTO_OK })).toBe('inspection_required')
    expect(decideRouting({ intake: HIGH, quote: { needs_inspection: true }, ...AUTO_OK })).toBe('inspection_required')
  })

  it('auto-send is OFF by default (empty allowlist) — falls to tradie_review', () => {
    expect(decideRouting({ intake: HIGH, quote: CLEAN_QUOTE, deployGate: PASS_GATE, pricingPath: 'deterministic' })).toBe('tradie_review')
  })

  it('allowlisted + deploy-gate-pass + HIGH + clean + deterministic ⇒ auto_send', () => {
    expect(decideRouting({ intake: HIGH, quote: CLEAN_QUOTE, ...AUTO_OK })).toBe('auto_send')
  })

  it('R7 — a non-deterministic (opus_fallback / absent) pricing_path is never auto-sent', () => {
    expect(decideRouting({ intake: HIGH, quote: CLEAN_QUOTE, autoSendJobTypes: ['downlights'], deployGate: PASS_GATE, pricingPath: 'opus_fallback' })).toBe('tradie_review')
    const r = decideRoutingDetailed({ intake: HIGH, quote: CLEAN_QUOTE, autoSendJobTypes: ['downlights'], deployGate: PASS_GATE })
    expect(r.decision).toBe('tradie_review')
    expect(r.reasons).toContain('pricing_path_not_deterministic')
  })

  it('allowlisted but deploy gate absent ⇒ tradie_review (fail-closed)', () => {
    const r = decideRoutingDetailed({ intake: HIGH, quote: CLEAN_QUOTE, autoSendJobTypes: ['downlights'] })
    expect(r.decision).toBe('tradie_review')
    expect(r.reasons).toContain('deploy_gate_absent')
  })

  it('allowlisted + gate pass but a gate condition fails ⇒ tradie_review with reason', () => {
    const r = decideRoutingDetailed({ intake: HIGH, quote: CLEAN_QUOTE, autoSendJobTypes: ['downlights'], deployGate: { ...PASS_GATE, pricingConfirmed: false } })
    expect(r.decision).toBe('tradie_review')
    expect(r.reasons).toContain('pricing_unconfirmed')
  })

  it('not on allowlist ⇒ tradie_review', () => {
    const r = decideRoutingDetailed({ intake: { ...HIGH, job_type: 'switchboard_upgrade' }, quote: CLEAN_QUOTE, autoSendJobTypes: ['downlights'], deployGate: PASS_GATE })
    expect(r.decision).toBe('tradie_review')
    expect(r.reasons).toContain('job_type_not_allowlisted')
  })

  it('non-HIGH confidence ⇒ tradie_review even if allowlisted + gated', () => {
    expect(decideRouting({ intake: { ...HIGH, confidence: 'MEDIUM' }, quote: CLEAN_QUOTE, autoSendJobTypes: ['downlights'], deployGate: PASS_GATE })).toBe('tradie_review')
  })

  it('hard-off override blocks auto_send', () => {
    expect(decideRouting({ intake: HIGH, quote: CLEAN_QUOTE, autoSendJobTypes: ['downlights'], deployGate: PASS_GATE, v3AutoSendEnabled: false })).toBe('tradie_review')
  })

  it('backward-compatible: minimal input (no allowlist/gate) ⇒ never auto_send', () => {
    expect(decideRouting({ intake: { confidence: 'HIGH', inspection_required: false }, quote: CLEAN_QUOTE })).toBe('tradie_review')
  })
})
