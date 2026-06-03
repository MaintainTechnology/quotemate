import { describe, expect, it } from 'vitest'
import { buildRepaintPrompt, normaliseColour } from './repaint-prompt'

describe('normaliseColour', () => {
  it('falls back to a default when empty', () => {
    expect(normaliseColour('')).toMatch(/off-white/i)
    expect(normaliseColour(null)).toMatch(/off-white/i)
  })
  it('trims and caps length', () => {
    expect(normaliseColour('  charcoal  ')).toBe('charcoal')
    expect(normaliseColour('x'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('buildRepaintPrompt', () => {
  it('puts the colour into the user brief', () => {
    const p = buildRepaintPrompt({ colour: 'sage green', scopes: ['exterior'] })
    expect(p.user).toContain('sage green')
    expect(p.user.toLowerCase()).toContain('exterior walls')
  })

  it('includes trim when trim is in scope', () => {
    const p = buildRepaintPrompt({ colour: 'white', scopes: ['exterior', 'trim'] })
    expect(p.user.toLowerCase()).toContain('trim')
  })

  it('omits trim when not in scope', () => {
    const p = buildRepaintPrompt({ colour: 'white', scopes: ['exterior'] })
    expect(p.user.toLowerCase()).not.toContain('window frames')
  })

  it('hard-grounds the edit to keep the structure unchanged', () => {
    const p = buildRepaintPrompt({ colour: 'white', scopes: ['exterior'] })
    expect(p.system.toLowerCase()).toContain('pixel-faithful')
    expect(p.user.toLowerCase()).toContain('do not change the roof')
  })
})
