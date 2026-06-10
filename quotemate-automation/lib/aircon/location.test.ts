import { describe, expect, it } from 'vitest'
import { parseAcGeocode, parseAcWeather, resolveAcLocationEvidence } from './location'

const GEOCODE_OK = {
  status: 'OK',
  results: [
    {
      formatted_address: '1 Test St, Brisbane QLD 4000, Australia',
      place_id: 'place-1',
      geometry: { location: { lat: -27.4698, lng: 153.0251 } },
    },
  ],
}

const WEATHER_OK = {
  weatherCondition: { description: { text: 'Humid' } },
  temperature: { degrees: 31.4 },
  feelsLikeTemperature: { degrees: 34.1 },
  heatIndex: { degrees: 33.2 },
  relativeHumidity: 68,
}

describe('parseAcGeocode', () => {
  it('returns Google coordinates and display address', () => {
    const r = parseAcGeocode(GEOCODE_OK)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lat).toBeCloseTo(-27.4698)
      expect(r.lng).toBeCloseTo(153.0251)
      expect(r.formatted_address).toContain('Brisbane')
      expect(r.place_id).toBe('place-1')
    }
  })

  it('surfaces zero results as not_found', () => {
    const r = parseAcGeocode({ status: 'ZERO_RESULTS', results: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('not_found')
  })
})

describe('parseAcWeather', () => {
  it('extracts current weather context', () => {
    const r = parseAcWeather(WEATHER_OK)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.condition).toBe('Humid')
      expect(r.temperature_c).toBe(31.4)
      expect(r.humidity_pct).toBe(68)
    }
  })
})

describe('resolveAcLocationEvidence', () => {
  it('calls geocode then weather with resolved coordinates', async () => {
    const urls: string[] = []
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('geocode')) {
        return new Response(JSON.stringify(GEOCODE_OK), { status: 200 })
      }
      return new Response(JSON.stringify(WEATHER_OK), { status: 200 })
    }

    const r = await resolveAcLocationEvidence(
      { address: '1 Test St', postcode: '4000', state: 'QLD' },
      {
        geocodeApiKey: 'geo-key',
        weatherApiKey: 'weather-key',
        geocodeBaseUrl: 'https://example.test/geocode',
        weatherBaseUrl: 'https://example.test/weather',
        fetchImpl,
      },
    )

    expect(r.geocode.ok).toBe(true)
    expect(r.weather.ok).toBe(true)
    expect(urls[0]).toContain('key=geo-key')
    expect(urls[1]).toContain('key=weather-key')
    expect(urls[1]).toContain('location.latitude=-27.4698')
  })

  it('derives a floor-area estimate from the Google Solar roof footprint', async () => {
    const SOLAR_OK = {
      imageryDate: { year: 2024, month: 7 },
      solarPotential: { wholeRoofStats: { groundAreaMeters2: 141.2 } },
    }
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('geocode')) return new Response(JSON.stringify(GEOCODE_OK), { status: 200 })
      if (url.includes('solar')) return new Response(JSON.stringify(SOLAR_OK), { status: 200 })
      return new Response(JSON.stringify(WEATHER_OK), { status: 200 })
    }

    const r = await resolveAcLocationEvidence(
      { address: '1 Test St', postcode: '4000', state: 'QLD' },
      {
        geocodeApiKey: 'geo-key',
        weatherApiKey: 'weather-key',
        solarApiKey: 'solar-key',
        geocodeBaseUrl: 'https://example.test/geocode',
        weatherBaseUrl: 'https://example.test/weather',
        solarBaseUrl: 'https://example.test/solar',
        storeys: 2,
        fetchImpl,
      },
    )

    expect(r.building.ok).toBe(true)
    if (r.building.ok) {
      expect(r.building.footprint_m2).toBe(141)
      expect(r.building.imagery_date).toBe('2024-07')
      // 141.2 × 2 storeys × 0.85 wall correction
      expect(r.building.estimated_floor_area_m2).toBeCloseTo(240, 0)
    }
  })

  it('marks the building lookup skipped/config_missing without a solar key', async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('geocode')) return new Response(JSON.stringify(GEOCODE_OK), { status: 200 })
      return new Response(JSON.stringify(WEATHER_OK), { status: 200 })
    }
    const r = await resolveAcLocationEvidence(
      { address: '1 Test St', postcode: '4000', state: 'QLD' },
      {
        geocodeApiKey: 'geo-key',
        weatherApiKey: 'weather-key',
        geocodeBaseUrl: 'https://example.test/geocode',
        weatherBaseUrl: 'https://example.test/weather',
        fetchImpl,
      },
    )
    expect(r.building.ok).toBe(false)
  })
})
