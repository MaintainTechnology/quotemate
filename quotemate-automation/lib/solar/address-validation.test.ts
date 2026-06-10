import { describe, it, expect } from 'vitest'
import {
  parseAddressValidationResponse,
  addressValidationLocationUsable,
  validateSolarAddress,
} from './address-validation'
import type { SolarAddressInput } from './types'

const INPUT: SolarAddressInput = {
  address: '1 Test St, Sydney',
  postcode: '2000',
  state: 'NSW',
}

const VALIDATED_BODY = {
  responseId: 'resp-1',
  result: {
    verdict: {
      possibleNextAction: 'ACCEPT',
      validationGranularity: 'PREMISE',
      geocodeGranularity: 'PREMISE',
      addressComplete: true,
    },
    address: { formattedAddress: '1 Test St, Sydney NSW 2000, Australia' },
    geocode: { location: { latitude: -33.8688, longitude: 151.2093 } },
  },
}

describe('parseAddressValidationResponse', () => {
  it('reports validated + a usable premise location', () => {
    const i = parseAddressValidationResponse(VALIDATED_BODY)
    expect(i.status).toBe('validated')
    expect(i.location).toEqual({ lat: -33.8688, lng: 151.2093 })
    expect(addressValidationLocationUsable(i)).toBe(true)
  })

  it('flags needs_fix on a FIX next action', () => {
    const i = parseAddressValidationResponse({
      result: { verdict: { possibleNextAction: 'FIX' }, address: {}, geocode: {} },
    })
    expect(i.status).toBe('needs_fix')
    expect(addressValidationLocationUsable(i)).toBe(false)
  })

  it('returns unavailable on a non-object body', () => {
    const i = parseAddressValidationResponse(null)
    expect(i.status).toBe('unavailable')
  })

  it('treats a coarse geocode granularity as not usable for the money path', () => {
    const i = parseAddressValidationResponse({
      result: {
        verdict: {
          possibleNextAction: 'ACCEPT',
          geocodeGranularity: 'ROUTE',
        },
        address: {},
        geocode: { location: { latitude: -33.8, longitude: 151.2 } },
      },
    })
    expect(addressValidationLocationUsable(i)).toBe(false)
  })
})

describe('validateSolarAddress', () => {
  it('skips (no fetch) when the key is missing', async () => {
    let called = false
    const fetchImpl = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const i = await validateSolarAddress(INPUT, { apiKey: undefined, fetchImpl })
    expect(called).toBe(false)
    expect(i.status).toBe('skipped')
  })

  it('POSTs to the endpoint and returns a parsed insight', async () => {
    let calledUrl = ''
    let method = ''
    const fetchImpl = async (u: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(u)
      method = init?.method ?? ''
      return new Response(JSON.stringify(VALIDATED_BODY), { status: 200 })
    }
    const i = await validateSolarAddress(INPUT, { apiKey: 'KEY', fetchImpl })
    expect(method).toBe('POST')
    expect(calledUrl).toContain('key=KEY')
    expect(i.status).toBe('validated')
  })

  it('returns unavailable on a non-2xx (never throws)', async () => {
    const fetchImpl = async () => new Response('nope', { status: 500 })
    const i = await validateSolarAddress(INPUT, { apiKey: 'KEY', fetchImpl })
    expect(i.status).toBe('unavailable')
  })
})
