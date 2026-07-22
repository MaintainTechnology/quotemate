// loadTenantIdentity — the two-select graceful-degradation loader behind the
// quote letterhead and (mig 175) the trust-video slots. The second select is
// BEST-EFFORT by design: a deploy that lands before a migration applies must
// degrade those columns to null, never 500 the public quote page.

import { describe, expect, it } from 'vitest'
import {
  loadTenantIdentity,
  contactDisplayName,
  safeWebsiteUrl,
  trustVideoUrls,
  tradeVideoUrls,
  trustVideoTrack,
} from './tenant-identity'

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
  it('accepts absolute https URLs', () => {
    expect(safeWebsiteUrl('https://ricardosroofing.example')).toBe(
      'https://ricardosroofing.example/',
    )
    expect(safeWebsiteUrl('  https://x.example/a  ')).toBe('https://x.example/a')
  })

  it('normalises scheme-less domains to https (how tradies actually type them)', () => {
    // Every live tenant website_url looks like this — dropping them rendered
    // the trust-section link on ZERO quotes (found verifying the rollout).
    expect(safeWebsiteUrl('www.quotemax.com.au')).toBe('https://www.quotemax.com.au/')
    expect(safeWebsiteUrl('bobsroofing.com.au/about')).toBe(
      'https://bobsroofing.com.au/about',
    )
  })

  it('rejects http, javascript:, dotless typos, blank and null values', () => {
    expect(safeWebsiteUrl('http://x.example')).toBeNull()
    expect(safeWebsiteUrl('javascript:alert(1)')).toBeNull()
    expect(safeWebsiteUrl('justaword')).toBeNull()
    expect(safeWebsiteUrl('')).toBeNull()
    expect(safeWebsiteUrl(null)).toBeNull()
    expect(safeWebsiteUrl(undefined)).toBeNull()
  })
})

describe('trustVideoUrls — tenant video, else the QuoteMax default (mig 177)', () => {
  const SB = 'https://proj.supabase.co'

  it('falls back to the two QuoteMax default videos when the tenant has none', () => {
    const v = trustVideoUrls({ intro_video_url: null, thankyou_video_url: null }, SB)
    expect(v.intro).toBe(`${SB}/storage/v1/object/public/tenant-videos/defaults/welcome.mp4`)
    expect(v.thankyou).toBe(`${SB}/storage/v1/object/public/tenant-videos/defaults/thank-you.mp4`)
  })

  it("a tenant's own video replaces its default independently", () => {
    const v = trustVideoUrls(
      { intro_video_url: 'https://cdn.example/ric-intro.mp4', thankyou_video_url: null },
      SB,
    )
    expect(v.intro).toBe('https://cdn.example/ric-intro.mp4')
    expect(v.thankyou).toBe(`${SB}/storage/v1/object/public/tenant-videos/defaults/thank-you.mp4`)
  })

  it('no supabase URL configured → nulls (the pages fall back to the face-holder)', () => {
    const v = trustVideoUrls({ intro_video_url: null, thankyou_video_url: null }, null)
    expect(v.intro).toBeNull()
    expect(v.thankyou).toBeNull()
  })

  it('null identity still yields the defaults', () => {
    expect(trustVideoUrls(null, SB).intro).toContain('defaults/welcome.mp4')
  })
})

describe('tradeVideoUrls — per-trade video, else the tenant pair, else the default', () => {
  const SB = 'https://proj.supabase.co'
  const legacy = {
    intro_video_url: 'https://cdn.example/tenant-intro.mp4',
    thankyou_video_url: 'https://cdn.example/tenant-thanks.mp4',
  }

  it("the trade's own video wins over the tenant-wide pair", () => {
    const v = tradeVideoUrls(
      {
        ...legacy,
        trade_videos: {
          roofing: { welcome: { url: 'https://cdn.example/roof-w.mp4' } },
        },
      },
      'roofing',
      SB,
    )
    expect(v.intro).toBe('https://cdn.example/roof-w.mp4')
    // No roofing thank-you yet → the tenant-wide one still covers it.
    expect(v.thankyou).toBe('https://cdn.example/tenant-thanks.mp4')
  })

  it('a trade with no videos of its own falls back to the tenant pair', () => {
    const v = tradeVideoUrls(
      { ...legacy, trade_videos: { roofing: { welcome: { url: 'r.mp4' } } } },
      'plumbing',
      SB,
    )
    expect(v.intro).toBe('https://cdn.example/tenant-intro.mp4')
    expect(v.thankyou).toBe('https://cdn.example/tenant-thanks.mp4')
  })

  it('no per-trade and no tenant video → the QuoteMax defaults', () => {
    const v = tradeVideoUrls(
      { intro_video_url: null, thankyou_video_url: null, trade_videos: null },
      'electrical',
      SB,
    )
    expect(v.intro).toBe(`${SB}/storage/v1/object/public/tenant-videos/defaults/welcome.mp4`)
    expect(v.thankyou).toBe(`${SB}/storage/v1/object/public/tenant-videos/defaults/thank-you.mp4`)
  })

  it('accepts the hyphenated customer-surface TradeKey', () => {
    const v = tradeVideoUrls(
      {
        intro_video_url: null,
        thankyou_video_url: null,
        trade_videos: { commercial_painting: { thankyou: { url: 'cp-t.mp4' } } },
      },
      'commercial-painting',
      SB,
    )
    expect(v.thankyou).toBe('cp-t.mp4')
  })

  it('an unknown or null trade behaves exactly like the tenant-wide resolver', () => {
    const withMap = { ...legacy, trade_videos: { roofing: { welcome: { url: 'r.mp4' } } } }
    expect(tradeVideoUrls(withMap, 'carpentry', SB).intro).toBe(legacy.intro_video_url)
    expect(tradeVideoUrls(withMap, null, SB).intro).toBe(legacy.intro_video_url)
  })
})

// Captions are only honest if the script belongs to the video that is actually
// playing. trustVideoTrack resolves BOTH in one branch so the two can never be
// paired from different videos — a tenant's script over the QuoteMax default
// video would caption it with words nobody says.
describe('trustVideoTrack — the video that plays, and the words it speaks', () => {
  const SB = 'https://proj.supabase.co'
  const legacy = {
    intro_video_url: 'https://cdn.example/tenant-intro.mp4',
    thankyou_video_url: 'https://cdn.example/tenant-thanks.mp4',
    trust_video_state: {
      welcome: { status: 'ready' as const, script: 'Welcome, we are Ric Electrical.' },
      thankyou: { status: 'ready' as const, script: 'Thanks for booking.' },
    },
  }

  it("carries the tenant video's own generated script", () => {
    expect(trustVideoTrack(legacy, 'welcome', null, SB)).toEqual({
      url: 'https://cdn.example/tenant-intro.mp4',
      script: 'Welcome, we are Ric Electrical.',
    })
    expect(trustVideoTrack(legacy, 'thankyou', null, SB).script).toBe('Thanks for booking.')
  })

  it('never lends a tenant script to the QuoteMax default video', () => {
    const t = trustVideoTrack(
      { intro_video_url: null, thankyou_video_url: null, trust_video_state: legacy.trust_video_state },
      'welcome',
      null,
      SB,
    )
    expect(t.url).toBe(`${SB}/storage/v1/object/public/tenant-videos/defaults/welcome.mp4`)
    expect(t.script).toBeNull()
  })

  it("takes the trade's video and the trade's script together", () => {
    const t = trustVideoTrack(
      {
        ...legacy,
        trade_videos: {
          roofing: { welcome: { url: 'https://cdn.example/roof-w.mp4', script: 'Roofing line.' } },
        },
      },
      'welcome',
      'roofing',
      SB,
    )
    expect(t).toEqual({ url: 'https://cdn.example/roof-w.mp4', script: 'Roofing line.' })
  })

  it('falls back to the tenant script when that trade has no video of its own', () => {
    const t = trustVideoTrack(
      {
        ...legacy,
        trade_videos: {
          roofing: { welcome: { url: 'https://cdn.example/roof-w.mp4', script: 'Roofing line.' } },
        },
      },
      'welcome',
      'plumbing',
      SB,
    )
    expect(t).toEqual({
      url: 'https://cdn.example/tenant-intro.mp4',
      script: 'Welcome, we are Ric Electrical.',
    })
  })

  it('a video whose script was never stored gets no script at all', () => {
    const t = trustVideoTrack(
      { intro_video_url: 'https://cdn.example/filmed.mp4', thankyou_video_url: null },
      'welcome',
      null,
      SB,
    )
    expect(t).toEqual({ url: 'https://cdn.example/filmed.mp4', script: null })
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
