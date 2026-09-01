import { describe, it, expect, vi } from 'vitest'

// The route calls createClient() at module scope and vitest injects no env, so
// Supabase is stubbed purely to make the module importable. buildTranscript
// itself is pure and touches nothing here.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const {
  buildTranscript,
  canonicaliseEvChargerSupply,
  enforceThreePhaseInspection,
  filterPinnedProductRequest,
} = await import('./route')

/** Minimal valid body; BodySchema defaults are applied by the route, not here. */
function body(over: Record<string, unknown> = {}) {
  return {
    job_type: 'downlights',
    address: '12 Smith St',
    suburb: 'Penrith',
    answers: {},
    notes: '',
    customer_name: '',
    customer_mobile: '',
    customer_email: '',
    ...over,
  } as Parameters<typeof buildTranscript>[0]
}

describe('buildTranscript', () => {
  it('renders each answered field as its own question', () => {
    const t = buildTranscript(
      body({ answers: { count: '6', room: 'lounge', ceiling_type: 'flat plaster' } }),
      'electrical',
    )
    expect(t).toContain('How many downlights are we doing? 6')
    expect(t).toContain('lounge')
    expect(t).toContain('flat plaster')
  })

  it('omits fields the tradie left blank', () => {
    const t = buildTranscript(body({ answers: { count: '6', room: '   ' } }), 'electrical')
    expect(t).toContain('6')
    expect(t).not.toMatch(/Which room or area are the downlights for\?\s*$/m)
  })

  // ── The F1 class ────────────────────────────────────────────────────
  // Recipe answers are withheld from the prose ON PURPOSE: they reach
  // applyPriceBands via intake.scope, and restating them pulls the estimator
  // into pricing the cable itself (prompt Rule 18), whose line then collides
  // with the recipe's own and dumps the quote to the $99 inspection.
  it('withholds recipe slot answers from power_points prose', () => {
    const t = buildTranscript(
      body({
        job_type: 'power_points',
        answers: { count: '2', distance_to_existing_power: '6', circuit_required: '20A' },
      }),
      'electrical',
    )
    expect(t).toContain('2')
    expect(t).not.toContain('how far from the nearest existing power point')
    expect(t).not.toContain('20A')
  })

  // ...but a NON-recipe job type's answers must survive. ev_charger's phase
  // question was coded `circuit_required` and so was filtered out for every job
  // type, losing the fact that forces an inspection on three-phase work.
  it('keeps all five EV charger answers in registry order', () => {
    const t = buildTranscript(
      body({
        job_type: 'ev_charger',
        answers: {
          vehicle: 'Tesla',
          charger_supply: 'we supply the charger',
          room: 'external wall',
          switchboard_distance: '5–10 m',
          phase: 'three phase (on-site inspection)',
        },
      }),
      'electrical',
    )
    const orderedLines = [
      'What car is the charger for? Tesla',
      'Who supplies the charger unit? we supply the charger',
      'Where is the charger going (garage, carport, external wall)? external wall',
      'Roughly how far is the switchboard from the charger spot? 5–10 m',
      'Single phase or three phase? three phase (on-site inspection)',
    ]
    let previousIndex = -1
    for (const line of orderedLines) {
      const index = t.indexOf(line)
      expect(index, `missing transcript line: ${line}`).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
  })

  it('carries an answer whose code is not in the spec through the extras fallback', () => {
    // Guards against a stale client silently dropping detail the tradie typed.
    const t = buildTranscript(
      body({ answers: { count: '6', something_new: 'important detail' } }),
      'electrical',
    )
    expect(t).toContain('important detail')
  })

  it('states the trade and job type, and never claims a customer wrote it', () => {
    const t = buildTranscript(body({ job_type: 'blocked_drain' }), 'plumbing')
    expect(t).toContain('plumbing')
    expect(t).toContain('blocked drain')
    expect(t).toMatch(/not a customer enquiry/i)
  })

  it('includes contact details only when given', () => {
    expect(buildTranscript(body(), 'electrical')).not.toContain('Contact mobile')
    const t = buildTranscript(
      body({ customer_name: 'Jane', customer_mobile: '+61400123456' }),
      'electrical',
    )
    expect(t).toContain('Jane')
    expect(t).toContain('+61400123456')
  })

  it('turns a pinned product into an explicit directive', () => {
    const t = buildTranscript(body({ product_name: 'Clipsal Iconic' }), 'electrical')
    expect(t).toContain('Clipsal Iconic')
    expect(t).toMatch(/quote THIS product/i)
  })

  it('ignores a stale EV product name when the customer supplies the charger', () => {
    const t = buildTranscript(
      body({
        job_type: 'ev_charger',
        answers: { charger_supply: 'customer already has the charger' },
        product_name: 'Tesla Wall Connector',
      }),
      'electrical',
    )
    expect(t).toContain('customer already has the charger')
    expect(t).not.toContain('Tesla Wall Connector')
    expect(t).not.toMatch(/quote THIS product/i)
  })

  it('retains an EV product directive for the exact tradie-supplied answer', () => {
    const t = buildTranscript(
      body({
        job_type: 'ev_charger',
        answers: { charger_supply: 'we supply the charger' },
        product_name: 'Tesla Wall Connector',
      }),
      'electrical',
    )
    expect(t).toContain('Tesla Wall Connector')
    expect(t).toMatch(/quote THIS product/i)
  })

  it('appends the free-text notes last so they read as context, not an answer', () => {
    const t = buildTranscript(body({ notes: 'Tight ceiling space.' }), 'electrical')
    expect(t.trimEnd().endsWith('Tight ceiling space.')).toBe(true)
  })
})

describe('enforceThreePhaseInspection', () => {
  it('forces an exact three-phase selection to inspection even when the model said false', () => {
    const intake = { inspection_required: false, confidence: 'HIGH' }
    expect(
      enforceThreePhaseInspection(intake, {
        phase: 'three phase (on-site inspection)',
      }),
    ).toEqual({ inspection_required: true, confidence: 'HIGH' })
  })

  it.each(['single phase', 'not sure'])(
    'leaves the model decision unchanged for %s',
    (phase) => {
      const intake = { inspection_required: false, confidence: 'MEDIUM' }
      expect(enforceThreePhaseInspection(intake, { phase })).toBe(intake)
      expect(intake.inspection_required).toBe(false)
    },
  )

  it('does not undo an inspection decision for a non-three-phase answer', () => {
    const intake = { inspection_required: true }
    expect(enforceThreePhaseInspection(intake, { phase: 'not sure' })).toBe(intake)
    expect(intake.inspection_required).toBe(true)
  })
})

describe('filterPinnedProductRequest', () => {
  const request = {
    product_id: '11111111-1111-4111-8111-111111111111',
    product_name: 'Tesla Wall Connector',
  }

  it('drops both EV pin fields for a customer-supplied charger', () => {
    expect(
      filterPinnedProductRequest(
        'ev_charger',
        { charger_supply: 'customer already has the charger' },
        request,
      ),
    ).toEqual({})
  })

  it('retains both EV pin fields only for the exact tradie-supplied answer', () => {
    expect(
      filterPinnedProductRequest(
        'ev_charger',
        { charger_supply: 'we supply the charger' },
        request,
      ),
    ).toEqual(request)
  })

  it('preserves the existing pin behaviour for non-EV jobs', () => {
    expect(filterPinnedProductRequest('downlights', {}, request)).toEqual(request)
  })
})

describe('canonicaliseEvChargerSupply', () => {
  const intake = (suppliedBy?: string) => ({
    scope: {
      description: 'Install an EV charger',
      specs: suppliedBy ? { supplied_by: suppliedBy, smart: true } : { smart: true },
    },
  })

  it.each([
    ['customer already has the charger', 'customer'],
    ['we supply the charger', 'tradie'],
  ])('maps the exact portal answer %s to %s', (answer, expected) => {
    expect(
      canonicaliseEvChargerSupply(intake('wrong'), 'ev_charger', {
        charger_supply: answer,
      }).scope.specs,
    ).toEqual({ supplied_by: expected, smart: true })
  })

  it.each(['not sure', ''])('unsets model-inferred supply for %s', (answer) => {
    expect(
      canonicaliseEvChargerSupply(intake('customer'), 'ev_charger', {
        charger_supply: answer,
      }).scope.specs,
    ).toEqual({ smart: true })
  })

  it('leaves non-EV intake untouched', () => {
    const original = intake('customer')
    expect(canonicaliseEvChargerSupply(original, 'ceiling_fans', {})).toBe(original)
  })
})
