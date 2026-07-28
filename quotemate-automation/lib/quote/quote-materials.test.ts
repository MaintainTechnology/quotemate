import { describe, it, expect } from 'vitest'
import {
  parseRowRef,
  classifyLine,
  isSuppliedItem,
  materialLines,
  collectRefs,
  buildQuoteMaterials,
  labourHours,
  type QuoteLineLike,
} from './quote-materials'

const UUID_A = '11111111-2222-3333-4444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('parseRowRef — must match validate.ts extractRowRef exactly', () => {
  it('parses typed material and assembly refs', () => {
    expect(parseRowRef(`material:${UUID_A}`)).toEqual({ type: 'material', id: UUID_A })
    expect(parseRowRef(`assembly:${UUID_B}`)).toEqual({ type: 'assembly', id: UUID_B })
  })

  it('rejects everything the validator rejects', () => {
    for (const s of [
      'material', 'labour', 'callout', 'call_out', 'after_hours', 'tradie_edit',
      'material:', 'material:abc', 'material:uuid', 'material:UUID',
      'other:1234', `material:${UUID_A} `.replace(UUID_A, `${UUID_A}!`),
      null, undefined, 42, {}, [],
    ]) {
      expect(parseRowRef(s as unknown), String(s)).toBeNull()
    }
  })

  it('tolerates surrounding whitespace like the validator does', () => {
    expect(parseRowRef(`  material:${UUID_A}  `)).toEqual({ type: 'material', id: UUID_A })
  })
})

describe('classifyLine', () => {
  it('calls an untyped hourly line labour', () => {
    expect(classifyLine({ unit: 'hr', source: 'labour' })).toBe('labour')
    expect(classifyLine({ unit: 'HR' })).toBe('labour')
    expect(classifyLine({ unit: ' Hr ' })).toBe('labour')
    expect(classifyLine({ source: 'after_hours' })).toBe('labour')
    expect(classifyLine({ source: 'risk_buffer' })).toBe('labour')
  })

  it('REGRESSION: an hourly ASSEMBLY line is a supplied item, not labour', () => {
    // Verbatim shape of a live production line (quote SB3yFnwW…): the
    // electrical estimator prices supply-and-install assemblies at an hourly
    // rate. Classifying on `unit` before `source` emptied the materials list on
    // every such quote. The typed ref is definitive; the unit only says how the
    // line was measured.
    expect(
      classifyLine({
        unit: 'hr',
        quantity: 2,
        source: `assembly:${UUID_B}`,
        description: 'Disconnect, remove old, fit new, test (Replace double GPO assembly)',
      }),
    ).toBe('assembly')
    expect(classifyLine({ unit: 'hr', source: `material:${UUID_A}` })).toBe('material')
  })

  it('still counts that hourly assembly line toward the labour-hours sum', () => {
    // classifyLine and labourHours answer DIFFERENT questions and must diverge:
    // the hours sum has to keep matching lib/estimate/validate.ts.
    expect(labourHours([{ unit: 'hr', quantity: 2, source: `assembly:${UUID_B}` }])).toBe(2)
  })

  it('separates call-out from labour', () => {
    expect(classifyLine({ source: 'callout' })).toBe('callout')
    expect(classifyLine({ source: 'call_out' })).toBe('callout')
  })

  it('classifies typed refs', () => {
    expect(classifyLine({ source: `material:${UUID_A}`, unit: 'each' })).toBe('material')
    expect(classifyLine({ source: `assembly:${UUID_B}`, unit: 'each' })).toBe('assembly')
  })

  it('still shows a loosely-grounded material line as a material', () => {
    // No typed ref (the loose price+category grounding path) — the customer
    // must still see the item they are paying for.
    expect(classifyLine({ source: 'material', unit: 'each' })).toBe('material')
    expect(classifyLine({ source: 'material_lookup', unit: 'each' })).toBe('material')
  })

  it('falls back to other for an unrecognised source', () => {
    expect(classifyLine({ source: 'tradie_edit', unit: 'each' })).toBe('other')
    expect(classifyLine({})).toBe('other')
  })

  it('isSuppliedItem is material|assembly only', () => {
    expect(isSuppliedItem({ source: `material:${UUID_A}` })).toBe(true)
    expect(isSuppliedItem({ source: `assembly:${UUID_B}` })).toBe(true)
    expect(isSuppliedItem({ unit: 'hr' })).toBe(false)
    expect(isSuppliedItem({ source: 'callout' })).toBe(false)
  })
})

const LINES: QuoteLineLike[] = [
  {
    description: 'Clipsal Iconic double GPO',
    unit: 'each', quantity: 4, unit_price_ex_gst: 25, total_ex_gst: 100,
    source: `material:${UUID_A}`,
  },
  { description: 'Labour', unit: 'hr', quantity: 3, unit_price_ex_gst: 110, total_ex_gst: 330, source: 'labour' },
  { description: 'Call-out', unit: 'each', quantity: 1, unit_price_ex_gst: 80, total_ex_gst: 80, source: 'callout' },
  {
    description: 'Supply & install downlight',
    unit: 'each', quantity: 6, unit_price_ex_gst: 62, total_ex_gst: 372,
    source: `assembly:${UUID_B}`,
  },
]

describe('materialLines / collectRefs / labourHours', () => {
  it('keeps only supplied items, in order', () => {
    const out = materialLines(LINES)
    expect(out.map((l) => l.description)).toEqual([
      'Clipsal Iconic double GPO',
      'Supply & install downlight',
    ])
  })

  it('collects distinct ids by kind', () => {
    const r = collectRefs(LINES)
    expect(r.materialIds).toEqual([UUID_A])
    expect(r.assemblyIds).toEqual([UUID_B])
    expect(r.catalogueIds).toEqual([])
  })

  it('dedupes repeated refs', () => {
    const r = collectRefs([
      { source: `material:${UUID_A}` },
      { source: `material:${UUID_A}` },
      { catalogue_id: 'cat-1' },
      { catalogue_id: 'cat-1' },
    ])
    expect(r.materialIds).toEqual([UUID_A])
    expect(r.catalogueIds).toEqual(['cat-1'])
  })

  it('sums labour hours the validator way', () => {
    expect(labourHours(LINES)).toBe(3)
    expect(labourHours([{ unit: 'hr', quantity: '2.5' }, { unit: 'each', quantity: 9 }])).toBe(2.5)
  })
})

describe('buildQuoteMaterials', () => {
  it('renders every material from the LINE alone when nothing enriches', () => {
    const out = buildQuoteMaterials(LINES)
    expect(out).toHaveLength(2)
    expect(out[0].name).toBe('Clipsal Iconic double GPO')
    expect(out[0].quantity).toBe(4)
    expect(out[0].unit).toBe('each')
    expect(out[0].unitPriceExGst).toBe(25)
    expect(out[0].enriched).toBe(false)
    expect(out[0].brand).toBeNull()
    expect(out[0].imageSrc).toBeNull()
    expect(out[0].specs).toEqual([])
  })

  it('enriches from the tenant catalogue via the source ref', () => {
    const out = buildQuoteMaterials(LINES, {
      catalogue: new Map([[UUID_A, {
        id: UUID_A, name: 'Clipsal Iconic double GPO', brand: 'Clipsal',
        range_series: 'Iconic', supplier: 'Reece',
        description: 'Our standard GPO — 10 year warranty.',
        image_path: 'https://cdn.example.com/gpo.jpg',
        properties: { watts: 10, dimmable: true, warranty_years: 10, internal_flag: 'x' },
      }]]),
    })
    expect(out[0].brand).toBe('Clipsal')
    expect(out[0].range).toBe('Iconic')
    expect(out[0].supplier).toBe('Reece')
    expect(out[0].blurb).toBe('Our standard GPO — 10 year warranty.')
    expect(out[0].imageSrc).toBe('https://cdn.example.com/gpo.jpg')
    expect(out[0].enriched).toBe(true)
    // Allowlisted specs only — the internal flag must not reach the customer.
    expect(out[0].specs).toEqual([['Wattage', '10'], ['Dimmable', 'Yes'], ['Warranty', '10 years']])
  })

  it('prefers catalogue_id over the source ref', () => {
    const out = buildQuoteMaterials(
      [{ description: 'GPO', source: `material:${UUID_A}`, catalogue_id: 'cat-9' }],
      {
        catalogue: new Map([
          ['cat-9', { id: 'cat-9', brand: 'RIGHT' }],
          [UUID_A, { id: UUID_A, brand: 'WRONG' }],
        ]),
      },
    )
    expect(out[0].brand).toBe('RIGHT')
  })

  it('falls back to shared_materials (brand + specs, no supplier or photo)', () => {
    const out = buildQuoteMaterials([{ description: 'Generic GPO', source: `material:${UUID_A}` }], {
      shared: new Map([[UUID_A, { id: UUID_A, name: 'Generic GPO', brand: 'HPM', properties: { amps: '10A' } }]]),
    })
    expect(out[0].brand).toBe('HPM')
    expect(out[0].supplier).toBeNull()
    expect(out[0].range).toBeNull()
    expect(out[0].imageSrc).toBeNull()
    expect(out[0].specs).toEqual([['Rating', '10A']])
    expect(out[0].enriched).toBe(true)
  })

  it('uses the assembly description for a bundled supply+install line', () => {
    const out = buildQuoteMaterials([{ description: 'Downlight installed', source: `assembly:${UUID_B}` }], {
      assemblies: new Map([[UUID_B, { id: UUID_B, name: 'Downlight', description: 'Supply and install one LED downlight.' }]]),
    })
    expect(out[0].blurb).toBe('Supply and install one LED downlight.')
    expect(out[0].enriched).toBe(true)
  })

  it('prefers the line blurb over the catalogue blurb', () => {
    const out = buildQuoteMaterials(
      [{ description: 'GPO', source: `material:${UUID_A}`, product_description: 'On-quote blurb' }],
      { catalogue: new Map([[UUID_A, { id: UUID_A, description: 'Catalogue blurb' }]]) },
    )
    expect(out[0].blurb).toBe('On-quote blurb')
  })

  it('REFUSES a non-https image src rather than rendering a broken image', () => {
    for (const bad of [
      'tenant-a/photo.jpg',           // bare storage path (legacy value)
      'http://cdn.example.com/x.jpg', // plain http
      'javascript:alert(1)',
      '   ',
    ]) {
      const out = buildQuoteMaterials([{ description: 'x', source: `material:${UUID_A}`, image_path: bad }])
      expect(out[0].imageSrc, bad).toBeNull()
    }
  })

  it('accepts an embedded data: image (the PDF path)', () => {
    const out = buildQuoteMaterials([
      { description: 'x', source: `material:${UUID_A}`, image_path: 'data:image/png;base64,iVBORw0K' },
    ])
    expect(out[0].imageSrc).toBe('data:image/png;base64,iVBORw0K')
  })

  it('normalises a scheme-less catalogue URL to https', () => {
    const out = buildQuoteMaterials([
      { description: 'x', source: `material:${UUID_A}`, image_path: 'cdn.example.com/x.jpg' },
    ])
    expect(out[0].imageSrc).toBe('https://cdn.example.com/x.jpg')
  })

  it('flags a customer-supplied item and carries its safety note', () => {
    const out = buildQuoteMaterials([
      { description: 'Your own fitting', source: `material:${UUID_A}`, supplied_by: 'customer', safety_note: 'Must be AU-certified.' },
    ])
    expect(out[0].customerSupplied).toBe(true)
    expect(out[0].safetyNote).toBe('Must be AU-certified.')
  })

  it('never renders a nameless row', () => {
    const out = buildQuoteMaterials([{ source: `material:${UUID_A}` }])
    expect(out[0].name).toBe('Supplied item')
    expect(out[0].unit).toBe('each')
  })

  it('survives a garbage properties value', () => {
    for (const p of [null, 'nope', 42, [], [1, 2]]) {
      const out = buildQuoteMaterials([{ description: 'x', source: `material:${UUID_A}` }], {
        catalogue: new Map([[UUID_A, { id: UUID_A, properties: p }]]),
      })
      expect(out[0].specs).toEqual([])
    }
  })

  it('drops empty, false and blank spec values', () => {
    const out = buildQuoteMaterials([{ description: 'x', source: `material:${UUID_A}` }], {
      catalogue: new Map([[UUID_A, {
        id: UUID_A,
        properties: { watts: '', dimmable: false, smart: null, ip_rating: '  ', color_options: [] },
      }]]),
    })
    expect(out[0].specs).toEqual([])
  })

  it('joins an array spec into one readable value', () => {
    const out = buildQuoteMaterials([{ description: 'x', source: `material:${UUID_A}` }], {
      catalogue: new Map([[UUID_A, { id: UUID_A, properties: { color_options: ['warm', 'cool', ' '] } }]]),
    })
    expect(out[0].specs).toEqual([['Colour', 'warm, cool']])
  })

  it('handles string quantities and prices like money.ts does', () => {
    const out = buildQuoteMaterials([
      { description: 'x', source: `material:${UUID_A}`, quantity: '4', unit_price_ex_gst: '25.50' },
    ])
    expect(out[0].quantity).toBe(4)
    expect(out[0].unitPriceExGst).toBe(25.5)
  })

  it('returns [] for a tier with no supplied items (labour-only job)', () => {
    expect(buildQuoteMaterials([{ unit: 'hr', quantity: 2, source: 'labour' }])).toEqual([])
    expect(buildQuoteMaterials([])).toEqual([])
  })
})
