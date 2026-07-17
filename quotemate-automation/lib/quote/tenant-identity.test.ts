// loadTenantIdentity — the two-select graceful-degradation loader behind the
// quote letterhead and (mig 175) the trust-video slots. The second select is
// BEST-EFFORT by design: a deploy that lands before a migration applies must
// degrade those columns to null, never 500 the public quote page.

import { describe, expect, it } from 'vitest'
import { loadTenantIdentity, contactDisplayName, safeWebsiteUrl } from './tenant-identity'

type Row = Record<string, unknown> | null

/** Chainable fake supabase client: returns `base` for the first tenants
 *  select and `extended` for the second (the best-effort one). */
function fakeDb(base: Row, extended: Row) {
  let call = 0
  return {
    from() {
      const n = ++call
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: n === 1 ? base : extended, error: null }),
      }
      return builder
    },
  } as never
}

const BASE = {
  business_name: 'Ricardos Roofing Pty Ltd',
  owner_first_name: 'Ricardo',
  owner_last_name: 'Reyes',
  owner_mobile: '0400 000 000',
  owner_email: 'ric@example.com',
  state: 'QLD',
}

describe('loadTenantIdentity', () => {
  it('carries the mig-175 video columns when present', async () => {
    const id = await loadTenantIdentity(
      fakeDb(BASE, {
        contact_name: 'Ric',
        website_url: 'https://ricardosroofing.example',
        business_address: null,
        logo_url: null,
        twilio_sms_number: null,
        intro_video_url: 'https://cdn.example/intro.mp4',
        thankyou_video_url: 'https://cdn.example/thanks.mp4',
      }),
      't-1',
    )
    expect(id?.intro_video_url).toBe('https://cdn.example/intro.mp4')
    expect(id?.thankyou_video_url).toBe('https://cdn.example/thanks.mp4')
    expect(id?.website_url).toBe('https://ricardosroofing.example')
  })

  it('pre-175 schema (second select yields null) degrades the videos to null, never throws', async () => {
    const id = await loadTenantIdentity(fakeDb(BASE, null), 't-1')
    expect(id).not.toBeNull()
    expect(id?.business_name).toBe('Ricardos Roofing Pty Ltd')
    expect(id?.intro_video_url).toBeNull()
    expect(id?.thankyou_video_url).toBeNull()
    expect(id?.logo_url).toBeNull()
  })

  it('missing tenant → null (page hides the letterhead)', async () => {
    expect(await loadTenantIdentity(fakeDb(null, null), 't-x')).toBeNull()
    expect(await loadTenantIdentity(fakeDb(BASE, null), null)).toBeNull()
  })
})

describe('safeWebsiteUrl — the trust section link guard', () => {
  it('accepts absolute https URLs only', () => {
    expect(safeWebsiteUrl('https://ricardosroofing.example')).toBe(
      'https://ricardosroofing.example/',
    )
    expect(safeWebsiteUrl('  https://x.example/a  ')).toBe('https://x.example/a')
  })

  it('rejects http, protocol-less, javascript:, blank and null values', () => {
    expect(safeWebsiteUrl('http://x.example')).toBeNull()
    expect(safeWebsiteUrl('ricardosroofing.example')).toBeNull()
    expect(safeWebsiteUrl('javascript:alert(1)')).toBeNull()
    expect(safeWebsiteUrl('')).toBeNull()
    expect(safeWebsiteUrl(null)).toBeNull()
    expect(safeWebsiteUrl(undefined)).toBeNull()
  })
})

describe('contactDisplayName', () => {
  it('contact_name wins, then owner full name', () => {
    expect(
      contactDisplayName({
        ...BASE,
        contact_name: 'Ric',
        website_url: null,
        business_address: null,
        logo_url: null,
        twilio_sms_number: null,
        intro_video_url: null,
        thankyou_video_url: null,
      }),
    ).toBe('Ric')
  })
})
