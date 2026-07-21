// Thank-you page 3D showcase â€” pure logic coverage.
//
// Guards the two things a customer can put in a URL (colour + material) and
// the message their friend receives. Everything here is pure: no DB, no
// Supabase, no three.js.

import { describe, expect, it } from 'vitest'
import {
  ROOF_COLOUR_SWATCHES,
  WALL_COLOUR_SWATCHES,
  resolveRoofColour,
  resolveWallColour,
  resolveShowcaseMaterial,
  SHOWCASE_MATERIALS,
  buildShareMessage,
  SHARE_RECIPIENTS,
  buildShareUrl,
  resolveShowcasePayload,
} from './showcase'

describe('ROOF_COLOUR_SWATCHES', () => {
  it('offers real Colorbond names, not raw hex', () => {
    for (const s of ROOF_COLOUR_SWATCHES) {
      expect(s.name).toMatch(/^[A-Z]/)
      expect(s.hex).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('has stable, url-safe slugs with no duplicates', () => {
    const slugs = ROOF_COLOUR_SWATCHES.map((s) => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('includes the charcoal every existing render was hardcoded to', () => {
    // roof-after-prompt.ts baked "clean charcoal finish" into every render, so
    // Monument must exist or the default state has no swatch to sit on.
    expect(ROOF_COLOUR_SWATCHES.map((s) => s.slug)).toContain('monument')
  })
})

describe('resolveRoofColour', () => {
  it('resolves a known slug to its swatch', () => {
    const s = resolveRoofColour('monument')
    expect(s.slug).toBe('monument')
    expect(s.hex).toMatch(/^#/)
  })

  it('falls back to the default swatch for junk, never throwing', () => {
    // This value comes straight off a query string a friend may have edited.
    expect(resolveRoofColour('#ff00ff').slug).toBe(ROOF_COLOUR_SWATCHES[0].slug)
    expect(resolveRoofColour('<script>').slug).toBe(ROOF_COLOUR_SWATCHES[0].slug)
    expect(resolveRoofColour(null).slug).toBe(ROOF_COLOUR_SWATCHES[0].slug)
    expect(resolveRoofColour(undefined).slug).toBe(ROOF_COLOUR_SWATCHES[0].slug)
    expect(resolveRoofColour('').slug).toBe(ROOF_COLOUR_SWATCHES[0].slug)
  })

  it('is case-insensitive on the slug', () => {
    expect(resolveRoofColour('MONUMENT').slug).toBe('monument')
  })
})

describe('resolveWallColour', () => {
  it('resolves and falls back within the WALL palette', () => {
    expect(resolveWallColour(WALL_COLOUR_SWATCHES[1].slug).slug).toBe(
      WALL_COLOUR_SWATCHES[1].slug,
    )
    expect(resolveWallColour('nonsense').slug).toBe(WALL_COLOUR_SWATCHES[0].slug)
  })
})

describe('SHOWCASE_MATERIALS / resolveShowcaseMaterial', () => {
  it('offers the seven selectable roof materials and never "unknown"', () => {
    expect(SHOWCASE_MATERIALS).toHaveLength(7)
    expect(SHOWCASE_MATERIALS).not.toContain('unknown')
    expect(SHOWCASE_MATERIALS).toContain('colorbond_trimdek')
    expect(SHOWCASE_MATERIALS).toContain('colorbond_corrugated')
    expect(SHOWCASE_MATERIALS).toContain('colorbond_spandek')
    expect(SHOWCASE_MATERIALS).toContain('colorbond_kliplok')
    expect(SHOWCASE_MATERIALS).toContain('concrete_tile')
    expect(SHOWCASE_MATERIALS).toContain('terracotta_tile')
    expect(SHOWCASE_MATERIALS).toContain('cement_sheet')
  })

  it('passes a valid material through', () => {
    expect(resolveShowcaseMaterial('colorbond_trimdek', 'concrete_tile')).toBe(
      'colorbond_trimdek',
    )
  })

  it('falls back to the quoted material when the request is junk', () => {
    expect(resolveShowcaseMaterial('slate', 'concrete_tile')).toBe('concrete_tile')
    expect(resolveShowcaseMaterial(null, 'concrete_tile')).toBe('concrete_tile')
  })

  it('never returns "unknown" â€” falls to the first real material instead', () => {
    // A quote whose material was never confirmed must still render something
    // selectable, and 'unknown' has no render and no label a customer can read.
    expect(resolveShowcaseMaterial(null, 'unknown')).toBe(SHOWCASE_MATERIALS[0])
    expect(resolveShowcaseMaterial('unknown', 'unknown')).toBe(SHOWCASE_MATERIALS[0])
  })
})

describe('buildShareMessage', () => {
  it('personalises by recipient', () => {
    const partner = buildShareMessage('partner', 'https://x.test/share/ABC')
    const mate = buildShareMessage('mate', 'https://x.test/share/ABC')
    expect(partner).not.toBe(mate)
    expect(partner).toContain('https://x.test/share/ABC')
    expect(mate).toContain('https://x.test/share/ABC')
  })

  it('copy-link recipient sends the bare url with no preamble', () => {
    expect(buildShareMessage('copy', 'https://x.test/share/ABC')).toBe(
      'https://x.test/share/ABC',
    )
  })

  it('falls back to a neutral message for an unknown recipient', () => {
    const msg = buildShareMessage('nonsense' as never, 'https://x.test/s/A')
    expect(msg).toContain('https://x.test/s/A')
  })

  it('stays ASCII-only so it is GSM-7 safe for SMS', () => {
    for (const r of SHARE_RECIPIENTS) {
      const msg = buildShareMessage(r.id, 'https://x.test/share/ABC')
      expect(msg).toMatch(/^[\x20-\x7E\n]*$/)
    }
  })

  it('never leaks price or address â€” it only carries the url', () => {
    const msg = buildShareMessage('partner', 'https://x.test/share/ABC')
    expect(msg).not.toMatch(/\$/)
    expect(msg.split('https://')).toHaveLength(2)
  })
})

describe('buildShareUrl', () => {
  it('carries the chosen colours and material as validated slugs', () => {
    const url = buildShareUrl('https://x.test', 'TOKEN123', {
      roof: 'monument',
      wall: WALL_COLOUR_SWATCHES[0].slug,
      material: 'colorbond_trimdek',
    })
    expect(url).toContain('/share/TOKEN123')
    expect(url).toContain('roof=monument')
    expect(url).toContain(`wall=${WALL_COLOUR_SWATCHES[0].slug}`)
    expect(url).toContain('mat=colorbond_trimdek')
  })

  it('trims a trailing slash on the app url rather than doubling it', () => {
    const url = buildShareUrl('https://x.test/', 'TOKEN123', {
      roof: 'monument',
      wall: WALL_COLOUR_SWATCHES[0].slug,
      material: 'colorbond_trimdek',
    })
    expect(url).not.toContain('//share/')
  })
})

// ── Customer payload ────────────────────────────────────────────────
//
// The showcase route is PUBLIC (token-as-capability, like the rest of /q).
// These tests are the contract for what a customer may see: the model and the
// two renders, and nothing that belongs to the tradie.

describe('resolveShowcasePayload', () => {
  const ready = {
    model3d_status: 'ready',
    model3d_glb_path: 'roofing/abc/model3d-1.glb',
    paid_at: '2026-07-20T00:00:00Z',
    scheduled_at: '2026-07-27T00:00:00Z',
    quote: { structures: [{ role: 'primary', inputs: { material: 'colorbond_trimdek' } }] },
  }

  it('is available for a paid, scheduled job with a ready model', () => {
    const p = resolveShowcasePayload(ready)
    expect(p.status).toBe('ready')
    expect(p.glbPath).toBe('roofing/abc/model3d-1.glb')
    expect(p.material).toBe('colorbond_trimdek')
  })

  it('is unavailable when the model was never generated', () => {
    expect(resolveShowcasePayload({ ...ready, model3d_status: null, model3d_glb_path: null }).status)
      .toBe('unavailable')
  })

  it('is unavailable while the model is still generating', () => {
    expect(resolveShowcasePayload({ ...ready, model3d_status: 'generating' }).status)
      .toBe('unavailable')
  })

  it('is unavailable when generation failed', () => {
    expect(resolveShowcasePayload({ ...ready, model3d_status: 'failed' }).status)
      .toBe('unavailable')
  })

  it('is unavailable when status says ready but the GLB path is missing', () => {
    expect(resolveShowcasePayload({ ...ready, model3d_glb_path: null }).status)
      .toBe('unavailable')
  })

  it('is FORBIDDEN for an unpaid job — no model before payment', () => {
    expect(resolveShowcasePayload({ ...ready, paid_at: null }).status).toBe('forbidden')
  })

  it('is forbidden for a paid job with no booked time', () => {
    // Mirrors thanksPageTarget: the thank-you surface is paid AND scheduled.
    expect(resolveShowcasePayload({ ...ready, scheduled_at: null }).status).toBe('forbidden')
  })

  it('checks payment BEFORE model readiness, so an unpaid probe learns nothing', () => {
    const p = resolveShowcasePayload({ ...ready, paid_at: null, model3d_status: 'ready' })
    expect(p.status).toBe('forbidden')
    expect(p.glbPath).toBeNull()
  })

  it('never returns a glb path unless the status is ready', () => {
    for (const s of [null, 'generating', 'failed']) {
      expect(resolveShowcasePayload({ ...ready, model3d_status: s }).glbPath).toBeNull()
    }
  })

  it('falls back to a real material when the quote never confirmed one', () => {
    const p = resolveShowcasePayload({ ...ready, quote: null })
    expect(p.status).toBe('ready')
    expect(SHOWCASE_MATERIALS).toContain(p.material)
    expect(p.material).not.toBe('unknown')
  })
})

