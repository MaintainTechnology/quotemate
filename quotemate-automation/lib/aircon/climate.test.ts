import { describe, expect, it } from 'vitest'
import { climateZoneForPostcode } from './climate'

describe('climateZoneForPostcode', () => {
  it('maps Darwin (NT) to tropical', () => {
    expect(climateZoneForPostcode('0800', 'NT').zone).toBe('tropical')
  })
  it('maps Cairns (far north QLD) to tropical', () => {
    expect(climateZoneForPostcode('4870', 'QLD').zone).toBe('tropical')
  })
  it('maps Brisbane (QLD) to subtropical', () => {
    expect(climateZoneForPostcode('4000', 'QLD').zone).toBe('subtropical')
  })
  it('maps Sydney (NSW) to temperate', () => {
    expect(climateZoneForPostcode('2000', 'NSW').zone).toBe('temperate')
  })
  it('maps Hobart (TAS) to cool', () => {
    expect(climateZoneForPostcode('7000', 'TAS').zone).toBe('cool')
  })
  it('maps Perth (WA) to temperate', () => {
    expect(climateZoneForPostcode('6000', 'WA').zone).toBe('temperate')
  })
  it('returns a non-empty provenance note', () => {
    expect(climateZoneForPostcode('2000', 'NSW').note.length).toBeGreaterThan(0)
  })
})
