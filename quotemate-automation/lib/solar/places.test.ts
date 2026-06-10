import { describe, it, expect } from 'vitest'
import {
  parseAutocompleteResponse,
  parsePlaceDetailsResponse,
  fetchAddressSuggestions,
  fetchPlaceDetails,
} from './places'

// Trimmed Places (New) autocomplete body.
const AUTOCOMPLETE_BODY = {
  suggestions: [
    {
      placePrediction: {
        placeId: 'place-1',
        text: { text: '670 London Road, Chandler QLD, Australia' },
        structuredFormat: {
          mainText: { text: '670 London Road' },
          secondaryText: { text: 'Chandler QLD, Australia' },
        },
      },
    },
    { placePrediction: { placeId: 'place-2', text: { text: '670 London Court, Chandler' } } },
    { queryPrediction: { text: { text: 'ignored — not a place' } } },
  ],
}

// Trimmed Places (New) details body.
const DETAILS_BODY = {
  formattedAddress: '670 London Rd, Chandler QLD 4155, Australia',
  location: { latitude: -27.5104, longitude: 153.1601 },
  addressComponents: [
    { longText: '670', shortText: '670', types: ['street_number'] },
    { longText: 'London Road', shortText: 'London Rd', types: ['route'] },
    { longText: 'Chandler', shortText: 'Chandler', types: ['locality', 'political'] },
    { longText: 'Queensland', shortText: 'QLD', types: ['administrative_area_level_1', 'political'] },
    { longText: '4155', shortText: '4155', types: ['postal_code'] },
    { longText: 'Australia', shortText: 'AU', types: ['country', 'political'] },
  ],
}

describe('parseAutocompleteResponse', () => {
  it('maps placePredictions onto suggestions, skipping non-places', () => {
    const s = parseAutocompleteResponse(AUTOCOMPLETE_BODY)
    expect(s).toHaveLength(2)
    expect(s[0]).toEqual({
      place_id: 'place-1',
      main_text: '670 London Road',
      secondary_text: 'Chandler QLD, Australia',
      full_text: '670 London Road, Chandler QLD, Australia',
    })
    // Second has no structuredFormat — falls back to the full text.
    expect(s[1].place_id).toBe('place-2')
    expect(s[1].main_text).toBe('670 London Court, Chandler')
  })

  it('returns [] on empty / malformed bodies', () => {
    expect(parseAutocompleteResponse({})).toEqual([])
    expect(parseAutocompleteResponse(null)).toEqual([])
    expect(parseAutocompleteResponse({ suggestions: [{}] })).toEqual([])
  })
})

describe('parsePlaceDetailsResponse', () => {
  it('extracts street line, postcode, state and location', () => {
    const d = parsePlaceDetailsResponse(DETAILS_BODY)
    expect(d).not.toBeNull()
    expect(d?.street_address).toBe('670 London Road, Chandler')
    expect(d?.postcode).toBe('4155')
    expect(d?.state).toBe('QLD')
    expect(d?.location).toEqual({ lat: -27.5104, lng: 153.1601 })
  })

  it('nulls the state when it is not a known AU state code', () => {
    const d = parsePlaceDetailsResponse({
      formattedAddress: 'Somewhere',
      addressComponents: [
        { shortText: 'CA', longText: 'California', types: ['administrative_area_level_1'] },
      ],
    })
    expect(d?.state).toBeNull()
  })

  it('falls back to formattedAddress when no street components exist', () => {
    const d = parsePlaceDetailsResponse({ formattedAddress: '1 X St, Y' })
    expect(d?.street_address).toBe('1 X St, Y')
  })

  it('returns null on an unusable body', () => {
    expect(parsePlaceDetailsResponse(null)).toBeNull()
    expect(parsePlaceDetailsResponse({})).toBeNull()
  })
})

describe('fetchAddressSuggestions', () => {
  it('fails closed without an apiKey, without calling fetch', async () => {
    let called = false
    const fetchImpl = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const r = await fetchAddressSuggestions('670 Lon', { apiKey: undefined, fetchImpl })
    expect(called).toBe(false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no_key')
  })

  it('POSTs the input AU-restricted and parses suggestions', async () => {
    let sentBody = ''
    let keyHeader = ''
    const fetchImpl = async (_u: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body ?? '')
      keyHeader = (init?.headers as Record<string, string>)?.['X-Goog-Api-Key'] ?? ''
      return new Response(JSON.stringify(AUTOCOMPLETE_BODY), { status: 200 })
    }
    const r = await fetchAddressSuggestions('670 London', { apiKey: 'KEY', fetchImpl })
    expect(keyHeader).toBe('KEY')
    expect(sentBody).toContain('"input":"670 London"')
    expect(sentBody).toContain('"au"')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.suggestions).toHaveLength(2)
  })

  it('surfaces HTTP and network errors as not-ok (never throws)', async () => {
    const r1 = await fetchAddressSuggestions('x', {
      apiKey: 'KEY',
      fetchImpl: async () => new Response('nope', { status: 403 }),
    })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.code).toBe('http_error')

    const r2 = await fetchAddressSuggestions('x', {
      apiKey: 'KEY',
      fetchImpl: async () => {
        throw new Error('boom')
      },
    })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.code).toBe('network_error')
  })
})

describe('fetchPlaceDetails', () => {
  it('GETs the place with a field mask and parses the details', async () => {
    let calledUrl = ''
    let mask = ''
    const fetchImpl = async (u: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(u)
      mask = (init?.headers as Record<string, string>)?.['X-Goog-FieldMask'] ?? ''
      return new Response(JSON.stringify(DETAILS_BODY), { status: 200 })
    }
    const r = await fetchPlaceDetails('place-1', { apiKey: 'KEY', fetchImpl })
    expect(calledUrl).toContain('/places/place-1')
    expect(mask).toContain('addressComponents')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.details.postcode).toBe('4155')
      expect(r.details.state).toBe('QLD')
    }
  })

  it('fails closed without an apiKey', async () => {
    const r = await fetchPlaceDetails('place-1', { apiKey: '', fetchImpl: async () => new Response('{}') })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no_key')
  })

  it('returns invalid_response when the body has no usable address', async () => {
    const r = await fetchPlaceDetails('place-1', {
      apiKey: 'KEY',
      fetchImpl: async () => new Response('{}', { status: 200 }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_response')
  })
})
