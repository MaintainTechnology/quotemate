// Unit tests for the SMS plan-estimation pure logic: intent detection +
// the three SMS bodies (upload link / results / failure).

import { describe, it, expect } from 'vitest'
import {
  wantsPlanEstimation,
  buildPlanUploadSms,
  buildPlanResultsSms,
  buildPlanFailureSms,
} from './plan-request'

describe('wantsPlanEstimation', () => {
  it.each([
    "I'd like an electrical estimation",
    'Can you quote my electrical plan?',
    'can you price these house plans',
    'got floor plans for a new build, what would the electrical cost?',
    'Need a take-off on my drawings',
    'need a takeoff for a renovation',
    'can I upload my plans for a quote',
    'Could you analyse the blueprints for the electrical work?',
    'attached are the schematics, can you estimate?',
    'electrical estimate from a plan PDF?',
  ])('matches: %s', (msg) => {
    expect(wantsPlanEstimation(msg)).toBe(true)
  })

  it.each([
    'quote for 6 downlights in the kitchen',
    'my drain is blocked',
    'I plan to add a GPO in the garage',
    'I plan on renovating next year',
    'that plan works for me',
    'sounds good, go ahead',
    'planning a trip next week',
    'yes',
    '',
    'how much for a ceiling fan?',
  ])('does NOT match: %s', (msg) => {
    expect(wantsPlanEstimation(msg)).toBe(false)
  })
})

describe('buildPlanUploadSms', () => {
  it('greets by name and carries the upload URL', () => {
    const sms = buildPlanUploadSms({
      firstName: 'Sam',
      businessName: 'Pilot Sparky',
      uploadUrl: 'https://example.com/upload/plan/abc123',
    })
    expect(sms).toContain('Hi Sam!')
    expect(sms).toContain('Pilot Sparky')
    expect(sms).toContain('https://example.com/upload/plan/abc123')
  })

  it('falls back to a plain greeting without a name', () => {
    const sms = buildPlanUploadSms({
      businessName: 'Pilot Sparky',
      uploadUrl: 'https://example.com/u',
    })
    expect(sms.startsWith('Hi!')).toBe(true)
  })
})

describe('buildPlanResultsSms', () => {
  const base = {
    firstName: 'Sam',
    businessName: 'Pilot Sparky',
    resultsUrl: 'https://example.com/q/plan/tok',
    pdfUrl: 'https://example.com/api/q/plan/tok/pdf',
    lineCount: 12,
    deviceCount: 87,
  }

  it('includes counts, both links, and the AU-formatted indicative total', () => {
    const sms = buildPlanResultsSms({ ...base, totalIncGst: 12345.5 })
    expect(sms).toContain('12 item types')
    expect(sms).toContain('87 devices')
    expect(sms).toContain('$12,345.50 inc GST')
    expect(sms).toContain(base.resultsUrl)
    expect(sms).toContain(base.pdfUrl)
    expect(sms).toContain('Pilot Sparky will confirm')
  })

  it('omits the price sentence when no total is supplied', () => {
    const sms = buildPlanResultsSms({ ...base, totalIncGst: null })
    expect(sms).not.toContain('inc GST')
    expect(sms).toContain(base.resultsUrl)
  })
})

describe('buildPlanFailureSms', () => {
  it('keeps the same upload link live for a retry', () => {
    const sms = buildPlanFailureSms({ firstName: null, uploadUrl: 'https://example.com/u' })
    expect(sms).toContain('https://example.com/u')
    expect(sms.toLowerCase()).toContain("couldn't read")
  })
})
