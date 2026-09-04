// The EV document's cache key must change when the AI render arrives.
// Spec specs/ev-charger-location-photo.md R14 / R20.

import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
})

import { evTemplateCacheKey } from './pdf'
import { EV_ESTIMATE_TEMPLATE_KEY } from './report-html-ev-charger'

const ctx = (preview_status: string | null, preview_image_paths: string[] | null) =>
  ({ quote: { preview_status, preview_image_paths } })

describe('evTemplateCacheKey', () => {
  it('is the bare template key when no render exists', () => {
    expect(evTemplateCacheKey(ctx(null, null))).toBe(EV_ESTIMATE_TEMPLATE_KEY)
    expect(evTemplateCacheKey(ctx('idle', []))).toBe(EV_ESTIMATE_TEMPLATE_KEY)
    expect(evTemplateCacheKey(ctx('no_photos', null))).toBe(EV_ESTIMATE_TEMPLATE_KEY)
  })

  it('does NOT change while the render is still being generated', () => {
    // A 'generating' render contributes nothing to the document, so it must not
    // invalidate a perfectly good cached PDF either.
    expect(evTemplateCacheKey(ctx('generating', []))).toBe(EV_ESTIMATE_TEMPLATE_KEY)
    expect(evTemplateCacheKey(ctx('failed', ['a/b.png']))).toBe(EV_ESTIMATE_TEMPLATE_KEY)
  })

  it('changes once a ready render lands, so the cached PDF regenerates', () => {
    // This is the whole point: the send-time PDF is usually cached BEFORE the
    // render finishes. Nothing else in quotePdfSignature moves when an image
    // appears, so without this the customer downloads the render-less document
    // forever.
    const withRender = evTemplateCacheKey(ctx('ready', ['previews/q1-0.png']))
    expect(withRender).not.toBe(EV_ESTIMATE_TEMPLATE_KEY)
    expect(withRender.startsWith(`${EV_ESTIMATE_TEMPLATE_KEY}+img`)).toBe(true)
  })

  it('accepts a partial render', () => {
    expect(evTemplateCacheKey(ctx('partial', ['previews/q1-0.png']))).not.toBe(
      EV_ESTIMATE_TEMPLATE_KEY,
    )
  })

  it('changes again when the render set changes', () => {
    const one = evTemplateCacheKey(ctx('ready', ['previews/q1-0.png']))
    const two = evTemplateCacheKey(ctx('ready', ['previews/q1-0.png', 'previews/q1-1.png']))
    const other = evTemplateCacheKey(ctx('ready', ['previews/q1-9.png']))
    expect(one).not.toBe(two)
    expect(one).not.toBe(other)
  })

  it('is deterministic for the same render set', () => {
    expect(evTemplateCacheKey(ctx('ready', ['p/a.png']))).toBe(
      evTemplateCacheKey(ctx('ready', ['p/a.png'])),
    )
  })
})
