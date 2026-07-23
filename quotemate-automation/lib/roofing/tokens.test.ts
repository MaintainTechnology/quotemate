// Roofing measurement capability tokens — the pairing invariant.
//
// A roofing_measurements row needs TWO unguessable tokens, always together:
//   public_token  → /q/roof/[public_token]  (customer's priced quote)
//   measure_token → /m/[measure_token]      (tradie's Measurement Results)
//
// The SMS receptionist minted only public_token, so 16 SMS-origin jobs had
// measure_token NULL and /api/tenant/trade-jobs rendered tradieHref null —
// no Measurement Results page for any SMS job, while every web save had one.
// Minting the pair together makes "one without the other" unrepresentable.

import { describe, expect, it } from 'vitest'
import { newMeasurementTokens } from './tokens'

describe('newMeasurementTokens', () => {
  it('mints BOTH capability tokens together', () => {
    const t = newMeasurementTokens()
    expect(t.public_token).toBeTruthy()
    expect(t.measure_token).toBeTruthy()
  })

  it('mints them distinct — one must never double as the other', () => {
    const t = newMeasurementTokens()
    expect(t.measure_token).not.toBe(t.public_token)
  })

  it('mints 32-char hex, matching the existing web-save token format', () => {
    const t = newMeasurementTokens()
    expect(t.public_token).toMatch(/^[0-9a-f]{32}$/)
    expect(t.measure_token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('mints fresh tokens per call — no reuse across measurements', () => {
    const a = newMeasurementTokens()
    const b = newMeasurementTokens()
    expect(a.public_token).not.toBe(b.public_token)
    expect(a.measure_token).not.toBe(b.measure_token)
  })
})
