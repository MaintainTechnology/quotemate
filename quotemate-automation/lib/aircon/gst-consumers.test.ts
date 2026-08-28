import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const dashboard = readFileSync(resolve(process.cwd(), 'app', 'dashboard', 'aircon', 'page.tsx'), 'utf8')
const publicPage = readFileSync(resolve(process.cwd(), 'app', 'q', 'aircon', '[token]', 'page.tsx'), 'utf8')

describe('aircon website GST consumers', () => {
  it('derives dashboard range, point-estimate and breakdown copy from each option GST state', () => {
    expect(dashboard).toContain('airconPriceBasis(p.gst_registered)')
    expect(dashboard).toContain("p.gst_registered ? '+ 10% GST' : 'NO GST CHARGED'")
    expect(dashboard).not.toContain("inc GST · indicative · point estimate")
  })

  it('derives public tier notes, intro and footer copy from the priced recommendation GST state', () => {
    expect(publicPage).toContain('airconPriceBasis(opt.pricing.gst_registered)')
    expect(publicPage).toContain('airconPriceBasis(gstRegistered)')
    expect(publicPage).not.toContain("priceNote: 'inc GST · indicative'")
    expect(publicPage).not.toContain('Indicative inc-GST bands · confirmed on site')
  })
})
