import { describe, it, expect } from 'vitest'
import { parsePlacesResults } from './places'
import { buildStaticMapUrl, buildGeocodeUrl, parseGeocode } from './maps'

describe('parsePlacesResults', () => {
  it('maps the Places (New) Text Search shape to PlaceResult[]', () => {
    const json = {
      places: [
        {
          id: 'ChIJ123',
          displayName: { text: 'F45 Training Bondi' },
          formattedAddress: '1 Hall St, Bondi Beach NSW 2026',
          location: { latitude: -33.89, longitude: 151.27 },
        },
        { id: 'ChIJ456', formattedAddress: '5 Crown St', location: { latitude: -33.88, longitude: 151.21 } },
      ],
    }
    const out = parsePlacesResults(json)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ place_id: 'ChIJ123', name: 'F45 Training Bondi', address: '1 Hall St, Bondi Beach NSW 2026', lat: -33.89, lng: 151.27 })
    // falls back to address for name when displayName missing
    expect(out[1].name).toBe('5 Crown St')
  })

  it('drops entries with no id or no name/address; tolerates junk', () => {
    expect(parsePlacesResults({ places: [{ id: '', displayName: { text: 'x' } }, { displayName: { text: 'no id' } }] })).toEqual([])
    expect(parsePlacesResults(null)).toEqual([])
    expect(parsePlacesResults({})).toEqual([])
  })
})

describe('buildStaticMapUrl', () => {
  it('builds a static-map URL with a marker and the key', () => {
    const url = buildStaticMapUrl({ lat: -33.89, lng: 151.27, apiKey: 'KEY' })
    expect(url).toContain('center=-33.89%2C151.27')
    expect(url).toContain('markers=color%3A0xF26B21')
    expect(url).toContain('key=KEY')
    expect(url).toContain('maptype=roadmap')
  })
  it('honours zoom/size/maptype overrides', () => {
    const url = buildStaticMapUrl({ lat: 1, lng: 2, zoom: 19, size: '600x300', maptype: 'hybrid', apiKey: 'K' })
    expect(url).toContain('zoom=19')
    expect(url).toContain('size=600x300')
    expect(url).toContain('maptype=hybrid')
  })
})

describe('buildGeocodeUrl + parseGeocode', () => {
  it('builds a geocode URL', () => {
    expect(buildGeocodeUrl('1 Hall St Bondi', 'K')).toContain('address=1+Hall+St+Bondi')
  })
  it('parses the first OK result', () => {
    const json = {
      status: 'OK',
      results: [{ geometry: { location: { lat: -33.89, lng: 151.27 } }, formatted_address: '1 Hall St', place_id: 'ChIJ' }],
    }
    expect(parseGeocode(json)).toEqual({ lat: -33.89, lng: 151.27, formatted_address: '1 Hall St', place_id: 'ChIJ' })
  })
  it('returns null for non-OK / empty / junk', () => {
    expect(parseGeocode({ status: 'ZERO_RESULTS', results: [] })).toBeNull()
    expect(parseGeocode({ status: 'OK', results: [] })).toBeNull()
    expect(parseGeocode(null)).toBeNull()
  })
})
