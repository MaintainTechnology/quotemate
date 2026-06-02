// AI "after re-roof" preview prompt — pure builder.

import { describe, expect, it } from 'vitest'
import { buildRoofAfterPrompt } from './roof-after-prompt'

describe('buildRoofAfterPrompt', () => {
  it('names the chosen material in the brief', () => {
    expect(buildRoofAfterPrompt('colorbond_trimdek').user).toMatch(/Colorbond Trimdek/i)
    expect(buildRoofAfterPrompt('terracotta_tile').user).toMatch(/terracotta/i)
  })

  it('hard-grounds the edit to the roof only (footprint + surroundings unchanged)', () => {
    const { user } = buildRoofAfterPrompt('colorbond_trimdek')
    expect(user).toMatch(/same building footprint/i)
    expect(user).toMatch(/do not add or remove buildings/i)
    expect(user).toMatch(/angle \/ zoom completely unchanged/i)
  })

  it('falls back to a generic phrasing for unknown material', () => {
    const { user } = buildRoofAfterPrompt('unknown')
    expect(user).toMatch(/brand-new, cleanly installed roof/i)
  })

  it('the system prompt frames it as a single roof-surface edit of a real aerial', () => {
    const { system } = buildRoofAfterPrompt('concrete_tile')
    expect(system).toMatch(/ONE change only/i)
    expect(system).toMatch(/satellite/i)
  })

  it('no em dashes in the brief (house style)', () => {
    const { system, user } = buildRoofAfterPrompt('colorbond_kliplok')
    expect(system.includes('—')).toBe(false)
    expect(user.includes('—')).toBe(false)
  })
})
