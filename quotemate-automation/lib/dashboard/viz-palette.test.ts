// Guards the one duplication in the viz palette: the hex values live in
// viz-palette.ts (for canvas/WebGL consumers, which cannot read CSS vars) and
// are mirrored as --viz-* in app/globals.css (for everything the DOM paints).
// Two sources of truth is a deliberate trade, so it gets a test rather than a
// promise — this fails the moment the two drift.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VIZ, vizAt } from './viz-palette'

function cssRamp(): string[] {
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
  return VIZ.map((_, i) => {
    const m = new RegExp(`--viz-${i + 1}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)
    if (!m) throw new Error(`--viz-${i + 1} is not declared in app/globals.css`)
    return m[1].toUpperCase()
  })
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const parts = hex.replace('#', '').match(/../g)
  if (!parts) throw new Error(`bad hex: ${hex}`)
  const [r, g, b] = parts.map((h) => {
    const v = parseInt(h, 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('viz palette', () => {
  it('matches the --viz-* ramp declared in globals.css', () => {
    expect(cssRamp()).toEqual(VIZ.map((v) => v.toUpperCase()))
  })

  // WCAG 1.4.11: non-text graphical objects need 3:1 against their backdrop.
  // These are drawn on --ink-card, so that is the backdrop being checked.
  it('clears 3:1 against the card surface', () => {
    for (const hue of VIZ) {
      expect(contrast(hue, '#2B2422'), `${hue} on --ink-card`).toBeGreaterThanOrEqual(3)
    }
  })

  it('has no duplicate hues', () => {
    expect(new Set(VIZ).size).toBe(VIZ.length)
  })

  it('cycles by index and handles negatives', () => {
    expect(vizAt(0)).toBe(VIZ[0])
    expect(vizAt(VIZ.length)).toBe(VIZ[0])
    expect(vizAt(VIZ.length + 3)).toBe(VIZ[3])
    expect(vizAt(-1)).toBe(VIZ[VIZ.length - 1])
  })
})
