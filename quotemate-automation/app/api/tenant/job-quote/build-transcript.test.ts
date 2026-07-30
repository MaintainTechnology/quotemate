import { describe, it, expect, vi } from 'vitest'

// The route calls createClient() at module scope and vitest injects no env, so
// Supabase is stubbed purely to make the module importable. buildTranscript
// itself is pure and touches nothing here.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const { buildTranscript } = await import('./route')

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
  it("keeps ev_charger's phase answer, which the code collision used to drop", () => {
    const t = buildTranscript(
      body({
        job_type: 'ev_charger',
        answers: { room: 'garage', phase: 'three phase (on-site inspection)' },
      }),
      'electrical',
    )
    expect(t).toContain('garage')
    expect(t).toContain('three phase')
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

  it('appends the free-text notes last so they read as context, not an answer', () => {
    const t = buildTranscript(body({ notes: 'Tight ceiling space.' }), 'electrical')
    expect(t.trimEnd().endsWith('Tight ceiling space.')).toBe(true)
  })
})
