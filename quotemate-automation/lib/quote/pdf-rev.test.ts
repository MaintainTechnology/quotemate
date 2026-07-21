// RC-5 — the solar PDF cache marker. ensureSolarQuotePdf froze on the static
// SOLAR_PDF_REV path marker, so any section produced AFTER the auto-release
// render (panels-after image, sun & shade heatmap, felt map, AI brief) was
// permanently absent from the downloaded/emailed PDF while the live /q/solar
// page showed it. solarPdfRev folds that volatile state into the rev — mirroring
// how ensurePaintingPdf folds the after-image timestamp — so the first
// download/email after each asset lands regenerates once and every channel
// then serves the SAME enriched document.

import { describe, it, expect } from 'vitest'
import { SOLAR_PDF_REV, solarPdfRev } from './pdf-rev'

const bare = {
  panels_image_status: 'idle' as string | null,
  panels_image_path: null as string | null,
  quote_variant: 'instant' as string | null,
  felt: null as { thumbnail_url?: string | null } | null,
  ai_brief: null as unknown,
  estimate: { context: {} } as { context?: { sun?: { flux_image_path?: string | null } | null } | null } | null,
}

describe('solarPdfRev (RC-5 — async-produced solar sections self-heal the cache)', () => {
  it('an estimate with no enrichments keeps the base rev (no spurious regeneration)', () => {
    expect(solarPdfRev(bare, false)).toBe(SOLAR_PDF_REV)
  })

  it('changes once the roof-with-panels render is ready (previously frozen out of every PDF)', () => {
    expect(
      solarPdfRev({ ...bare, panels_image_status: 'ready', panels_image_path: 'solar/x/after-1.png' }, false),
    ).not.toBe(solarPdfRev(bare, false))
  })

  it('changes once the sun & shade heatmap lands', () => {
    expect(
      solarPdfRev({ ...bare, estimate: { context: { sun: { flux_image_path: 'flux.png' } } } }, false),
    ).not.toBe(solarPdfRev(bare, false))
  })

  it('felt variant: changes when the roof-map thumbnail lands', () => {
    const felt = { ...bare, quote_variant: 'felt' }
    expect(solarPdfRev({ ...felt, felt: { thumbnail_url: 'map.png' } }, false)).not.toBe(
      solarPdfRev(felt, false),
    )
  })

  it('felt variant: changes when the AI brief lands', () => {
    const felt = { ...bare, quote_variant: 'felt' }
    expect(solarPdfRev({ ...felt, ai_brief: { summary: 'x' } }, false)).not.toBe(
      solarPdfRev(felt, false),
    )
  })

  it('an INSTANT (non-felt) estimate ignores felt/brief columns — no spurious rev', () => {
    // A felt thumbnail on an instant row is never rendered, so it must not shift
    // the cache key (only the felt variant embeds it).
    expect(solarPdfRev({ ...bare, felt: { thumbnail_url: 'map.png' }, ai_brief: { s: 1 } }, false)).toBe(
      SOLAR_PDF_REV,
    )
  })

  it('changes when the SOLAR_PREMIUM_QUOTE flag flips (assumed-values / STC sections)', () => {
    expect(solarPdfRev(bare, true)).not.toBe(solarPdfRev(bare, false))
  })

  it('is deterministic — same state always yields the same rev (stable suffix order)', () => {
    const full = {
      panels_image_status: 'ready',
      panels_image_path: 'p',
      quote_variant: 'felt',
      felt: { thumbnail_url: 't' },
      ai_brief: { s: 1 },
      estimate: { context: { sun: { flux_image_path: 'f' } } },
    }
    expect(solarPdfRev(full, true)).toBe(solarPdfRev(full, true))
  })
})
