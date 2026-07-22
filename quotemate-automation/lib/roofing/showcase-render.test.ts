// Per-material studio renders — pure logic coverage.
//
// These renders are what makes the thank-you page's material selector do
// something: one pre-generated pair (front/back) per roof material, swapped
// instantly on tap. Generation is tradie-side and cached; a customer never
// waits on it and never triggers it.

import { describe, expect, it } from 'vitest'
import {
  showcaseRenderPath,
  buildShowcaseRenderPrompt,
  SHOWCASE_RENDER_VERSION,
} from './showcase-render'
import { SHOWCASE_MATERIALS } from './showcase'

describe('showcaseRenderPath', () => {
  it('keys by address, material and view', () => {
    const p = showcaseRenderPath('670 London Rd, Chandler QLD 4155', 'colorbond_trimdek', 'front')
    expect(p).toBe(`showcase/${SHOWCASE_RENDER_VERSION}/670-london-rd-chandler-qld-4155/colorbond_trimdek-front`)
  })

  it('shares a key across address spellings, like the capture cache does', () => {
    // The synth renders these are derived from are cached per normalised
    // address and reused across tenants; these must collide the same way or
    // the same property re-renders per tenant at full cost.
    expect(showcaseRenderPath('670 LONDON RD, CHANDLER QLD 4155', 'concrete_tile', 'back')).toBe(
      showcaseRenderPath('670 london rd chandler qld 4155', 'concrete_tile', 'back'),
    )
  })

  it('separates the two views and every material', () => {
    const paths = new Set<string>()
    for (const m of SHOWCASE_MATERIALS) {
      for (const v of ['front', 'back'] as const) {
        paths.add(showcaseRenderPath('1 Test St', m, v))
      }
    }
    expect(paths.size).toBe(SHOWCASE_MATERIALS.length * 2)
  })

  it('is versioned so a prompt change cannot serve stale renders', () => {
    expect(showcaseRenderPath('1 Test St', 'concrete_tile', 'front')).toContain(
      `/${SHOWCASE_RENDER_VERSION}/`,
    )
  })
})

describe('buildShowcaseRenderPrompt', () => {
  it('names the requested material in the brief', () => {
    const { user } = buildShowcaseRenderPrompt('colorbond_kliplok')
    expect(user).toMatch(/klip-?lok/i)
  })

  it('produces a distinct brief per material', () => {
    const briefs = SHOWCASE_MATERIALS.map((m) => buildShowcaseRenderPrompt(m).user)
    expect(new Set(briefs).size).toBe(SHOWCASE_MATERIALS.length)
  })

  it('constrains the edit to the roof only', () => {
    // This is a real photo-derived render of someone's actual house. The model
    // reinventing the walls, windows or garden would make it a different house.
    const { user, system } = buildShowcaseRenderPrompt('terracotta_tile')
    const both = `${system} ${user}`.toLowerCase()
    expect(both).toContain('roof')
    expect(both).toMatch(/only|unchanged|same/)
  })

  it('forbids re-framing, since the pair must stay a matched front/back set', () => {
    const { user } = buildShowcaseRenderPrompt('colorbond_spandek')
    expect(user.toLowerCase()).toMatch(/angle|frame|zoom|crop/)
  })

  it('does NOT describe a top-down aerial — the source is a ground-level render', () => {
    // buildRoofAfterPrompt edits a satellite aerial and says so. Reusing that
    // wording here would fight the actual source image.
    const { system, user } = buildShowcaseRenderPrompt('colorbond_corrugated')
    const both = `${system} ${user}`.toLowerCase()
    expect(both).not.toContain('aerial')
    expect(both).not.toContain('satellite')
    expect(both).not.toContain('top-down')
  })

  it('forbids text, watermarks and people in the output', () => {
    const { user } = buildShowcaseRenderPrompt('cement_sheet')
    expect(user.toLowerCase()).toMatch(/watermark|text|label/)
  })
})
