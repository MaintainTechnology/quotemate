import { describe, it, expect } from 'vitest'
import {
  propertyVisualsImagePath,
  hasPropertyVisuals,
  staticMapQuery,
} from './visuals-image-path'

describe('propertyVisualsImagePath', () => {
  // The bug: a roofing quote linked to a saved measurement was rendering the
  // aerial from the geocoded (street-only) address, landing on the wrong
  // building. It must centre on the MEASURED polygon instead.
  it('roofing linked to a measurement centres on the measured polygon (?b=1)', () => {
    expect(
      propertyVisualsImagePath({
        trade: 'roofing',
        shareToken: 'share123',
        address: '27 Smith Street',
        linkedRoofPublicToken: 'pub_abc',
      }),
    ).toBe('/api/roofing/q/pub_abc/static-map?b=1')
  })

  it('roofing WITHOUT a linked measurement falls back to the address geocode', () => {
    expect(
      propertyVisualsImagePath({
        trade: 'roofing',
        shareToken: 'share123',
        address: '27 Smith Street',
        linkedRoofPublicToken: null,
      }),
    ).toBe(`/api/q/share123/static-map?${staticMapQuery('27 Smith Street')}`)
  })

  it('commercial painting always uses the address geocode (never a roof polygon)', () => {
    expect(
      propertyVisualsImagePath({
        trade: 'commercial_painting',
        shareToken: 's',
        address: '1 Warehouse Rd',
        // a stray token must be ignored for non-roofing trades
        linkedRoofPublicToken: 'pub_xyz',
      }),
    ).toBe(`/api/q/s/static-map?${staticMapQuery('1 Warehouse Rd')}`)
  })

  it('returns null for roofing with neither a linked token nor an address', () => {
    expect(
      propertyVisualsImagePath({
        trade: 'roofing',
        shareToken: 's',
        address: null,
        linkedRoofPublicToken: null,
      }),
    ).toBeNull()
  })

  it('returns null for trades without property visuals', () => {
    for (const trade of ['electrical', 'plumbing', '']) {
      expect(
        propertyVisualsImagePath({
          trade,
          shareToken: 's',
          address: 'x',
          linkedRoofPublicToken: 'pub',
        }),
      ).toBeNull()
    }
  })
})

describe('hasPropertyVisuals', () => {
  it('is true only for roofing + commercial painting', () => {
    expect(hasPropertyVisuals('roofing')).toBe(true)
    expect(hasPropertyVisuals('commercial_painting')).toBe(true)
    expect(hasPropertyVisuals('electrical')).toBe(false)
    expect(hasPropertyVisuals('')).toBe(false)
  })
})
