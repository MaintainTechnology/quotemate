// The roof rates editor's dollar fields each show what they're per. Every one
// used to show "/m²": a gutter's per-lm rate, a downpipe's each, and a flat
// call-out minimum too.
//
// createElement rather than JSX so the file stays .test.ts, as the node-only
// vitest glob wants; a static render runs no effect, so nothing is fetched.

import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/auth/client-token', () => ({ getAuthToken: async () => null }))
import { RoofRatesEditor } from './RoofRatesEditor'

describe('RoofRatesEditor units', () => {
  it("shows each dollar field's own unit, and none on a flat amount", () => {
    const html = renderToStaticMarkup(createElement(RoofRatesEditor, { accessToken: null }))
    const units = [...html.matchAll(/<span class="pointer-events-none absolute right-4[^"]*">([^<]*)<\/span>/g)].map((m) => m[1])
    const count = (unit: string) => units.filter((u) => u === unit).length
    expect(count('/m²')).toBe(13) // seven re-roof materials and six new-work rates
    expect(count('/lm')).toBe(6) // gutter, fascia and soffit; ridge, valley and box gutter
    expect(count('each')).toBe(1) // downpipes
    // The call-out minimum and the two solar allowances are flat amounts.
    // The whole metacharacter class, backslash included, as lib/estimation/
    // supplement.ts escapes: escaping only ( ) leaves a backslash unescaped.
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const label of ['Call-out minimum (ex GST)', 'Solar detach &amp; reinstate — base']) {
      expect(html).toMatch(new RegExp(`aria-label="${escapeRegExp(label)}"[^>]*/></div>`))
    }
  })
})
