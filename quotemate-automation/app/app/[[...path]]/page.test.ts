import { describe, expect, it } from 'vitest'

import { mobileFallbackPath } from './page'

describe('/app browser fallback', () => {
  it('maps only published native return destinations', () => {
    expect(mobileFallbackPath(undefined)).toBe('/dashboard')
    expect(mobileFallbackPath(['sections', 'billing'])).toBe('/dashboard?tab=billing')
    expect(mobileFallbackPath(['sections', 'payouts'])).toBe('/dashboard?tab=payouts')
  })

  it('does not turn arbitrary app-link paths into dashboard access', () => {
    expect(mobileFallbackPath(['sections', 'admin'])).toBeNull()
    expect(mobileFallbackPath(['..', 'dashboard'])).toBeNull()
  })
})
