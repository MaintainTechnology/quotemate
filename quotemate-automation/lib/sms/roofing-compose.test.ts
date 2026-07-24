// SMS roofing receptionist — reply composer tests. Fixtures come from the
// real priceMultiRoof so the SMS body is cross-checked against the
// deterministic pricer's output.

import { describe, expect, it } from 'vitest'
import { priceMultiRoof, type RoofStructureInput } from '@/lib/roofing/pricing'
import type { RoofMetrics, RoofUserInputs, RoofingPriceTier } from '@/lib/roofing/types'
import type { SolarAllowance, SolarQuoteAddon } from '@/lib/roofing/solar'
import {
  applySolarToTiers,
  buildRoofingReplyMessage,
  buildRoofPhotoMedia,
  composeBookingMessage,
  composeCancelMessage,
  composeConfirmMessage,
  composeEstimateMessage,
  composeInspectionMessage,
  composeMeasureUnavailableMessage,
  composeInspectionReasonMessage,
  fmtAud,
  isInspectionOnlyQuote,
  shouldSendRoofInspectionMessage,
  narrowQuoteToStructure,
  narrowQuoteToStructures,
} from './roofing-compose'

function metrics(o: Partial<RoofMetrics> = {}): RoofMetrics {
  return {
    footprint_m2: 200, sloped_area_m2: 220, storeys: 1, form: 'hip',
    hips: 4, valleys: 0, ridge_lm: null, polygon_geojson: null, capture_date: null,
    buildingId: 'b1', ...o,
  }
}
function inputs(o: Partial<RoofUserInputs> = {}): RoofUserInputs {
  return { material: 'colorbond_trimdek', pitch: 'standard', building_year_built: 2005, intent: 'full_reroof', ...o }
}

const house: RoofStructureInput = { buildingId: 'house', role: 'primary', metrics: metrics({ buildingId: 'house' }), inputs: inputs() }
const shed: RoofStructureInput = {
  buildingId: 'shed', role: 'secondary',
  metrics: metrics({ buildingId: 'shed', footprint_m2: 45, sloped_area_m2: 50, form: 'gable' }),
  inputs: inputs({ material: 'colorbond_trimdek' }),
}

const CTX = { address: '670 London Rd, Chandler QLD 4155', quoteUrl: 'https://www.quotemax.com.au/q/roof/abc123', firstName: 'James' }

const allowance = (o: Partial<SolarAllowance> = {}): SolarAllowance => ({
  applies: true, arrays: 2, ex_gst: 2400, inc_gst: 2640, detail: '', electrician_note: '', low_confidence: false, ...o,
})

describe('applySolarToTiers', () => {
  const tiers: RoofingPriceTier[] = [
    { tier: 'good', label: 'a', ex_gst: 1000, inc_gst: 1100, scope: '' },
    { tier: 'better', label: 'b', ex_gst: 5000, inc_gst: 5500, scope: '' },
    { tier: 'best', label: 'c', ex_gst: 6000, inc_gst: 6600, scope: '' },
  ]
  it('adds the allowance to better + best only, never good', () => {
    const out = applySolarToTiers(tiers, { allowance: allowance() })
    expect([out[0].ex_gst, out[0].inc_gst]).toEqual([1000, 1100]) // good untouched
    expect([out[1].ex_gst, out[1].inc_gst]).toEqual([7400, 8140]) // +2400 / +2640
    expect([out[2].ex_gst, out[2].inc_gst]).toEqual([8400, 9240])
  })
  it('no-ops when the allowance does not apply or is absent', () => {
    expect(applySolarToTiers(tiers, { allowance: allowance({ applies: false }) })).toEqual(tiers)
    expect(applySolarToTiers(tiers, null)).toEqual(tiers)
  })
  it('leaves a $0 (unpriced) tier untouched — never a fabricated solar-only price', () => {
    const zeroTiers: RoofingPriceTier[] = [
      { tier: 'good', label: 'a', ex_gst: 0, inc_gst: 0, scope: '' },
      { tier: 'better', label: 'b', ex_gst: 0, inc_gst: 0, scope: '' },
      { tier: 'best', label: 'c', ex_gst: 6000, inc_gst: 6600, scope: '' },
    ]
    const out = applySolarToTiers(zeroTiers, { allowance: allowance() })
    expect([out[1].ex_gst, out[1].inc_gst]).toEqual([0, 0]) // unpriced stays $0
    expect([out[2].ex_gst, out[2].inc_gst]).toEqual([8400, 9240]) // priced tier still gets it
  })
  it('appends a solar each-line-item keeping Σ line_items === ex_gst when a tier carries line_items', () => {
    const withLines: RoofingPriceTier[] = [
      { tier: 'better', label: 'b', ex_gst: 5000, inc_gst: 5500, scope: '', line_items: [
        { unit: 'sqm', quantity: 1, description: 're-roof', unit_price_ex_gst: 5000, total_ex_gst: 5000, source: 'labour' },
      ] },
    ]
    const out = applySolarToTiers(withLines, { allowance: allowance() })
    const li = out[0].line_items!
    expect(li.some((x) => /solar/i.test(x.description))).toBe(true)
    expect(li.reduce((a, x) => a + x.total_ex_gst, 0)).toBeCloseTo(out[0].ex_gst, 2)
  })
})

describe('narrowQuoteToStructures preserves solar', () => {
  it('carries the job-level solar addon through promotion', () => {
    const base = priceMultiRoof({ structures: [house, shed] })
    const solar = { detection: null, allowance: allowance({ arrays: 1, ex_gst: 1700, inc_gst: 1870 }) } as unknown as SolarQuoteAddon
    const withSolar = { ...base, solar }
    expect(narrowQuoteToStructures(withSolar, [1]).solar).toBe(solar)
  })
})

describe('fmtAud', () => {
  it('formats whole-dollar AUD with no cents', () => {
    expect(fmtAud(20900)).toBe('$20,900')
    expect(fmtAud(1140.4)).toBe('$1,140')
    expect(fmtAud(Number.NaN)).toBe('$0')
  })
})

describe('composeEstimateMessage', () => {
  const quote = priceMultiRoof({ structures: [house, shed] })
  // Opt into all tiers (mig 146 flipped the no-mode fallback to 'single'); this
  // block asserts the verbatim multi-tier price passthrough.
  const msg = composeEstimateMessage({ ...CTX, quote, tierMode: 'good_better_best' })

  it('uses the deterministic combined tier prices verbatim (inc GST)', () => {
    expect(msg).toContain(fmtAud(quote.combined.tiers[0].inc_gst))
    expect(msg).toContain(fmtAud(quote.combined.tiers[1].inc_gst))
    expect(msg).toContain(fmtAud(quote.combined.tiers[2].inc_gst))
  })
  it('notes structure count + total area and includes the link', () => {
    expect(msg).toMatch(/2 structures/)
    expect(msg).toContain('270 m²') // 220 + 50
    expect(msg).toContain(CTX.quoteUrl)
    expect(msg).toMatch(/inc GST/i)
  })
  it('greets by first name', () => {
    expect(msg.startsWith('Hi James, ')).toBe(true)
  })
  it('greets generically with no name', () => {
    const m2 = composeEstimateMessage({ ...CTX, firstName: null, quote })
    expect(m2.startsWith('Hi, ')).toBe(true)
  })
  it('says "1 structure" / "of roof" for a single building', () => {
    const single = priceMultiRoof({ structures: [house] })
    const m = composeEstimateMessage({ ...CTX, quote: single })
    expect(m).toMatch(/of roof/)
    expect(m).not.toMatch(/structures/)
  })
})

describe('composeInspectionMessage + routing', () => {
  // A cement_sheet (asbestos) roof zeroes the patch/re-roof tiers but prices the
  // Upgrade tier as a Colorbond strip-and-replace, so it DOES carry an indicative
  // figure; it always routes to inspection. (A roof with no measurable area is the
  // genuinely-unpriceable case below — all-zero tiers, price-free.)
  const asbestosHouse: RoofStructureInput = { ...house, inputs: inputs({ material: 'cement_sheet' }) }
  // A complex-form Colorbond roof routes to inspection too, but HAS real tiers.
  const complexHouse: RoofStructureInput = {
    ...house,
    metrics: metrics({ buildingId: 'house', form: 'complex' }),
  }

  it('routes to inspection when the PRIMARY needs it', () => {
    const quote = priceMultiRoof({ structures: [asbestosHouse, shed] })
    expect(quote.routing.decision).toBe('inspection_required')
  })

  it('inspection message states the next step + reason + link', () => {
    const quote = priceMultiRoof({ structures: [asbestosHouse] })
    const msg = composeInspectionMessage({ ...CTX, quote })
    expect(msg).toMatch(/inspection on site/i)
    expect(msg).toContain(quote.routing.reason)
    expect(msg).toContain(CTX.quoteUrl)
    expect(msg).toMatch(/reply yes/i)
  })

  it('a roof with no measurable area (all-zero tiers) carries NO dollar figure', () => {
    // sloped_area null + zero footprint → every tier is $0 → genuinely
    // unpriceable → the message stays price-free (page falls back to the
    // $99 inspection-only state, never a $0 quote).
    const noAreaHouse: RoofStructureInput = {
      ...house,
      metrics: metrics({ buildingId: 'house', sloped_area_m2: null, footprint_m2: 0 }),
    }
    const quote = priceMultiRoof({ structures: [noAreaHouse] })
    const msg = composeInspectionMessage({ ...CTX, quote })
    expect(msg).not.toMatch(/\$\d/)
  })

  it('an asbestos roof still shows its upgrade tier as an indicative number', () => {
    // cement_sheet zeroes the patch/re-roof tiers but the UPGRADE tier prices
    // a Colorbond replacement (a real rate), so there IS an indicative figure.
    const quote = priceMultiRoof({ structures: [asbestosHouse] })
    const best = quote.structures[0].price.tiers[2].inc_gst
    expect(best).toBeGreaterThan(0)
    const msg = composeInspectionMessage({ ...CTX, quote })
    expect(msg).toMatch(/indicative/i)
    expect(msg).toContain(fmtAud(best))
  })

  it('a complex (real-material) roof shows an INDICATIVE range, not a blank quote', () => {
    const quote = priceMultiRoof({ structures: [complexHouse] })
    expect(quote.routing.decision).toBe('inspection_required')
    const better = quote.structures[0].price.tiers[1].inc_gst
    expect(better).toBeGreaterThan(0)
    const msg = composeInspectionMessage({ ...CTX, quote })
    expect(msg).toMatch(/indicative/i)
    expect(msg).toContain(fmtAud(better))
  })

  it('buildRoofingReplyMessage leads firm for a quotable PRIMARY, inspection framing when the JOB is inspection-routed (U3)', () => {
    const clean = priceMultiRoof({ structures: [house, shed] })
    expect(buildRoofingReplyMessage({ ...CTX, quote: clean })).toMatch(/here's your roofing estimate/)
    // U3 (was: firm shed price) — when the PRIMARY dwelling itself needs an
    // on-site look the whole job is inspection_required, so we show inspection
    // framing (indicative + "confirmed on site"), never a firm headline for just
    // the shed. That firm headline mismatched the measurement structure count
    // (live S7: "2 structures, $159,885" on a structs:3 / inspection_required roof).
    const mixed = priceMultiRoof({ structures: [asbestosHouse, shed] })
    expect(mixed.routing.decision).toBe('inspection_required')
    expect(buildRoofingReplyMessage({ ...CTX, quote: mixed })).toMatch(/inspection on site/i)
    expect(buildRoofingReplyMessage({ ...CTX, quote: mixed })).not.toMatch(/here's your roofing estimate/)
    // Nothing quotable → the inspection message.
    const allOnSite = priceMultiRoof({ structures: [asbestosHouse] })
    expect(buildRoofingReplyMessage({ ...CTX, quote: allOnSite })).toMatch(/inspection on site/i)
  })
})

describe('estimate flags an inspection-needed secondary (quote the rest)', () => {
  it('a cement_sheet SECONDARY does not block the quote — primary is quoted, secondary flagged', () => {
    const asbestosShed: RoofStructureInput = { ...shed, inputs: inputs({ material: 'cement_sheet' }) }
    const quote = priceMultiRoof({ structures: [house, asbestosShed] })
    expect(quote.routing.decision).toBe('tradie_review') // not blocked
    const msg = buildRoofingReplyMessage({ ...CTX, quote })
    expect(msg).toMatch(/here's your roofing estimate/) // estimate, not inspection
    expect(msg).toMatch(/note:/i) // flags the secondary
    expect(msg).toMatch(/look on site/i)
  })
})

describe('composeConfirmMessage', () => {
  it('single building → simple yes/no + link, no price', () => {
    const quote = priceMultiRoof({ structures: [house] })
    const msg = composeConfirmMessage({ ...CTX, quote })
    expect(msg).toMatch(/is this your roof/i)
    expect(msg).toMatch(/reply yes/i)
    expect(msg).toContain(CTX.quoteUrl)
    // No dollar amounts in the confirm step.
    expect(msg).not.toMatch(/\$\d/)
  })

  it('multiple buildings → numbered list + pick instructions', () => {
    const quote = priceMultiRoof({ structures: [house, shed] })
    const msg = composeConfirmMessage({ ...CTX, quote })
    expect(msg).toMatch(/2 buildings/)
    expect(msg).toMatch(/1\)/)
    expect(msg).toMatch(/2\)/)
    expect(msg).toMatch(/number for just one/i)
    expect(msg).not.toMatch(/\$\d/)
  })
})

describe('buildRoofPhotoMedia (best-effort MMS attachments)', () => {
  const B = 'https://www.quotemax.com.au'

  it('single building → one image, no ?b=, generic caption', () => {
    const quote = priceMultiRoof({ structures: [house] })
    const media = buildRoofPhotoMedia({ baseUrl: B, token: 'tok123', quote })
    expect(media).toHaveLength(1)
    expect(media[0].mediaUrl).toBe(`${B}/api/roofing/q/tok123/static-map`)
    expect(media[0].caption).toBe('Your roof')
  })

  it('multiple buildings → one per building, ?b= per structure, label captions', () => {
    const quote = priceMultiRoof({ structures: [house, shed] })
    const media = buildRoofPhotoMedia({ baseUrl: B, token: 'tok123', quote })
    expect(media).toHaveLength(2)
    expect(media[0].mediaUrl).toBe(`${B}/api/roofing/q/tok123/static-map?b=1`)
    expect(media[1].mediaUrl).toBe(`${B}/api/roofing/q/tok123/static-map?b=2`)
    expect(media[0].caption).toBe(quote.structures[0].label)
    expect(media[1].caption).toBe(quote.structures[1].label)
  })

  it('caps the number of images sent', () => {
    const quote = priceMultiRoof({ structures: [house, shed, { ...shed, buildingId: 's3' }, { ...shed, buildingId: 's4' }] })
    const media = buildRoofPhotoMedia({ baseUrl: B, token: 'tok123', quote, max: 3 })
    expect(media).toHaveLength(3)
  })

  it('captions never contain a price', () => {
    const quote = priceMultiRoof({ structures: [house, shed] })
    for (const m of buildRoofPhotoMedia({ baseUrl: B, token: 'tok123', quote })) {
      expect(m.caption).not.toMatch(/\$\d/)
    }
  })
})

describe('composeMeasureUnavailableMessage (measurement-failed fallback)', () => {
  it('offers an on-site inspection and asks for YES, naming the address', () => {
    const m = composeMeasureUnavailableMessage('James', '670 London Rd, Chandler QLD 4155')
    expect(m).toMatch(/inspection/i)
    expect(m).toContain('670 London Rd, Chandler QLD 4155')
    expect(m).toMatch(/\bYES\b/)
    // Must NOT reuse the old dead-end copy that black-holed the customer.
    expect(m.toLowerCase()).not.toContain('confirm your quote shortly')
  })
  it('handles a missing first name gracefully', () => {
    const m = composeMeasureUnavailableMessage(null, '1 Test St')
    expect(m.startsWith('Thanks.')).toBe(true)
  })
})

// Live 2026-07-22: a customer whose profile answer we failed to map was
// told "I couldn't pull an automatic measurement for <address>" — but no
// measurement had been attempted at all. nextRoofingStep had already
// routed to inspection on the brief, leaving the slots incomplete, so
// toRoofingRequest() returned null and the measure call never ran. The
// message was untrue and threw away the real reason.
describe('composeInspectionReasonMessage', () => {
  it('states the real reason and never claims a measurement was attempted', () => {
    const m = composeInspectionReasonMessage('Mark', '1434 Numinbah Road', 'we couldn\'t confirm the roof material')
    expect(m).toContain('we couldn\'t confirm the roof material')
    expect(m).toContain('1434 Numinbah Road')
    expect(m).not.toMatch(/couldn't pull an automatic measurement/i)
    expect(m).toMatch(/Reply YES/)
  })

  it('carries the asbestos reason through verbatim', () => {
    const m = composeInspectionReasonMessage('Mark', '12 Smith St', 'cement sheet or fibro roofs may contain asbestos')
    expect(m).toContain('cement sheet or fibro roofs may contain asbestos')
  })

  it('reads correctly with no name and no reason', () => {
    const m = composeInspectionReasonMessage(null, 'your property', '')
    expect(m).toContain('your property')
    expect(m).not.toContain('Because ,')
    expect(m).not.toContain('undefined')
  })
})

describe('no em dashes in any customer-facing message', () => {
  const quote = priceMultiRoof({ structures: [house, shed] })
  const inspectionQuote = priceMultiRoof({ structures: [{ ...house, inputs: inputs({ material: 'cement_sheet' }) }, shed] })
  const messages = [
    composeEstimateMessage({ ...CTX, quote }),
    composeInspectionMessage({ ...CTX, quote: inspectionQuote }),
    composeConfirmMessage({ ...CTX, quote }),
    composeConfirmMessage({ ...CTX, quote: priceMultiRoof({ structures: [house] }) }),
    composeCancelMessage('James'),
    composeCancelMessage(null),
    composeBookingMessage('James', true),
    composeBookingMessage(null, false),
    composeMeasureUnavailableMessage('James', CTX.address),
    composeMeasureUnavailableMessage(null, CTX.address),
    composeInspectionReasonMessage('James', CTX.address, 'we couldn\'t confirm the roof material'),
    composeInspectionReasonMessage(null, CTX.address, ''),
    buildRoofingReplyMessage({ ...CTX, quote }),
  ]
  it('contains no em dash (—) or en dash (–)', () => {
    for (const m of messages) {
      expect(m.includes('—')).toBe(false)
      expect(m.includes('–')).toBe(false)
    }
  })
})

describe('narrowQuoteToStructure', () => {
  it('narrows to the picked structure and recomputes combined', () => {
    const quote = priceMultiRoof({ structures: [house, shed] })
    const narrowed = narrowQuoteToStructure(quote, 2) // the shed
    expect(narrowed.structures).toHaveLength(1)
    expect(narrowed.structures[0].buildingId).toBe('shed')
    expect(narrowed.combined.tiers[1].ex_gst).toBe(quote.structures[1].price.tiers[1].ex_gst)
  })
  it('returns the original quote for an out-of-range index', () => {
    const quote = priceMultiRoof({ structures: [house, shed] })
    expect(narrowQuoteToStructure(quote, 9).structures).toHaveLength(2)
  })
})

describe('narrowQuoteToStructures (multi-pick follow-ups)', () => {
  it('null → the quote unchanged (all structures)', () => {
    const quote = priceMultiRoof({ structures: [house, shed] })
    expect(narrowQuoteToStructures(quote, null)).toBe(quote)
  })
  it('a subset sums the combined tiers over the picked structures', () => {
    const quote = priceMultiRoof({ structures: [house, shed] })
    const n = narrowQuoteToStructures(quote, [1, 2])
    expect(n.structures).toHaveLength(2)
    expect(n.combined.tiers[1].inc_gst).toBeCloseTo(
      quote.structures[0].price.tiers[1].inc_gst + quote.structures[1].price.tiers[1].inc_gst,
      1,
    )
  })
  it('quotes the quotable picks and flags an inspection-needed secondary (does not block)', () => {
    const asbestosShed: RoofStructureInput = { ...shed, inputs: inputs({ material: 'cement_sheet' }) }
    const quote = priceMultiRoof({ structures: [house, asbestosShed] })
    const n = narrowQuoteToStructures(quote, [1, 2])
    expect(n.routing.decision).toBe('tradie_review') // primary house is quotable
    expect(n.inspection_structures).toHaveLength(1)
    // combined sums quotable-only — just the house.
    expect(n.combined.tiers[1].inc_gst).toBeCloseTo(quote.structures[0].price.tiers[1].inc_gst, 1)
    const msg = buildRoofingReplyMessage({ ...CTX, quote: n })
    expect(msg).toMatch(/here's your roofing estimate/)
    expect(msg).toMatch(/note:/i)
  })
  it('a subset where every pick needs inspection → inspection_required', () => {
    const asbestosShed: RoofStructureInput = { ...shed, inputs: inputs({ material: 'cement_sheet' }) }
    const quote = priceMultiRoof({ structures: [house, asbestosShed] })
    const n = narrowQuoteToStructures(quote, [2]) // only the asbestos shed
    expect(n.routing.decision).toBe('inspection_required')
  })
  it('out-of-range / empty selection → unchanged', () => {
    const quote = priceMultiRoof({ structures: [house, shed] })
    expect(narrowQuoteToStructures(quote, [9]).structures).toHaveLength(2)
  })
})

// The route parks an inspection-only send at await_booking keyed on this
// predicate (live 2026-07-23: state said 'quoted' while the message said
// "Reply YES and we'll book a time" — the YES fell through to the
// electrical LLM). It must agree with buildRoofingReplyMessage forever.
describe('isInspectionOnlyQuote', () => {
  it('is true only when NOTHING is firm-priced, matching the message sent', () => {
    const inspectionOnly = priceMultiRoof({
      structures: [{ ...house, inputs: inputs({ material: 'cement_sheet' }) }],
    })
    expect(isInspectionOnlyQuote(inspectionOnly)).toBe(true)
    expect(
      buildRoofingReplyMessage({ ...CTX, quote: inspectionOnly }),
    ).toContain("Reply YES and we'll book a time")

    const mixed = priceMultiRoof({
      structures: [house, { ...shed, inputs: inputs({ material: 'cement_sheet' }) }],
    })
    expect(isInspectionOnlyQuote(mixed)).toBe(false)
    expect(
      buildRoofingReplyMessage({ ...CTX, quote: mixed }),
    ).not.toContain("Reply YES and we'll book a time")
  })
})

// U3 (2026-07-24) — a job routed inspection_required at the JOB level (the
// PRIMARY needs an on-site look, e.g. unknown intent / asbestos-suspect primary)
// must show inspection framing, never a firm headline with a mismatched
// structure count. A quotable SECONDARY does not make it a firm quote. Genuine
// mixed jobs with a quotable PRIMARY stay tradie_review and keep their firm lead.
describe('shouldSendRoofInspectionMessage — job-level routing wins (U3)', () => {
  // Primary is asbestos-suspect (inspection) but the shed is quotable: the
  // job routes inspection_required while a structure is still firm-priced.
  const primaryInspection = priceMultiRoof({
    structures: [{ ...house, inputs: inputs({ material: 'cement_sheet' }) }, shed],
  })

  it('the target case: job inspection_required with a quotable secondary', () => {
    expect(primaryInspection.routing.decision).toBe('inspection_required')
    expect(isInspectionOnlyQuote(primaryInspection)).toBe(false) // shed is firm-priced
    expect(shouldSendRoofInspectionMessage(primaryInspection)).toBe(true)
  })

  it('buildRoofingReplyMessage shows inspection framing, not a firm headline', () => {
    const msg = buildRoofingReplyMessage({ ...CTX, quote: primaryInspection })
    expect(msg).toContain("Reply YES and we'll book a time")
    expect(msg).not.toMatch(/here's your roofing estimate/)
    // No "N structures, $X" firm scope headline for an inspection-routed job.
    expect(msg).not.toMatch(/\d+ structures, ~\d+ m² total/)
  })

  it('a firm mixed job (quotable primary) is unaffected — still the estimate', () => {
    const firmMixed = priceMultiRoof({ structures: [house, { ...shed, inputs: inputs({ material: 'cement_sheet' }) }] })
    expect(firmMixed.routing.decision).toBe('tradie_review')
    expect(shouldSendRoofInspectionMessage(firmMixed)).toBe(false)
    expect(buildRoofingReplyMessage({ ...CTX, quote: firmMixed })).toMatch(/here's your roofing estimate/)
  })

  it('an all-firm quote stays firm', () => {
    const clean = priceMultiRoof({ structures: [house, shed] })
    expect(shouldSendRoofInspectionMessage(clean)).toBe(false)
  })
})
