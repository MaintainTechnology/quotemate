// R5 + R6(c) (2026-09-02) — two deterministic gates on the SMS intake path,
// and the seeded EV service row they both depend on.
//
// Incident 2026-09-01 (quote 7zNJCjsaxBOL_N3cATDNvQ):
//   • "652 London Rd, Chandler" was printed as the EV charger site. Jon never
//     typed it — it came from the customers row, captured six weeks earlier in
//     a ROOFING conversation.
//   • Three-phase routing depended entirely on Opus honouring a prompt rule;
//     the dashboard had a deterministic gate, SMS had nothing.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The route builds a Supabase client at module scope and vitest injects no
// env, so it is stubbed purely to make the module importable. The gate under
// test is pure and touches nothing here.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const { enforceSmsThreePhaseInspection } = await import('@/app/api/intake/structure/route')

const REPO = path.resolve(__dirname, '..', '..')

describe('SMS three-phase gate (R6c)', () => {
  it('routes an explicit three-phase answer to inspection, whatever the model said', () => {
    for (const answer of ['three-phase', 'three phase', '3 phase', '3-phase', 'Three-Phase', '  three phase  ']) {
      expect(enforceSmsThreePhaseInspection({ inspection_required: false }, answer)).toEqual({
        inspection_required: true,
      })
    }
  })

  it('leaves a single-phase job priceable — no inference, ever', () => {
    const intake = { inspection_required: false }
    // The slot extractor used to stamp 'three-phase' on any EV/Tesla mention.
    // That inference is gone; these must all be no-ops.
    for (const answer of ['single-phase', 'single phase', 'not sure', '', null, undefined]) {
      expect(enforceSmsThreePhaseInspection(intake, answer)).toBe(intake)
    }
  })

  it('never CLEARS an inspection decision already made', () => {
    const intake = { inspection_required: true }
    expect(enforceSmsThreePhaseInspection(intake, 'single phase')).toBe(intake)
    expect(enforceSmsThreePhaseInspection(intake, 'three-phase')).toBe(intake)
  })

  it('does not fire on three-phase mentioned loosely in prose', () => {
    const intake = { inspection_required: false }
    expect(
      enforceSmsThreePhaseInspection(intake, 'not sure, maybe three phase but probably single'),
    ).toBe(intake)
  })
})

describe('remembered-address rules (R5)', () => {
  const routeSrc = readFileSync(
    path.join(REPO, 'app', 'api', 'intake', 'structure', 'route.ts'),
    'utf8',
  )

  it('no longer backfills intake.address from the customer record', () => {
    // The exact line that put a six-week-old roofing address on an EV quote.
    expect(routeSrc).not.toContain('intake.address = customer.address')
  })

  it('still backfills the SUBURB — that is a stable fact about a customer', () => {
    expect(routeSrc).toContain('intake.suburb = customer.suburb')
  })

  it('stamps where the address came from, and carries the remembered one separately', () => {
    expect(routeSrc).toContain('address_source')
    expect(routeSrc).toContain('remembered_address')
  })
})

describe('EV service row the SMS path depends on (R6b)', () => {
  const migration = readFileSync(
    path.join(REPO, 'sql', 'migrations', '021_services_catalogue_extras.sql'),
    'utf8',
  )
  const categories = readFileSync(
    path.join(REPO, 'sql', 'migrations', '037_remaining_assembly_categories.sql'),
    'utf8',
  )

  it('seeds "Install EV charger" as a quotable service, not an always-inspection one', () => {
    expect(migration).toContain('Install EV charger')
    // always_inspection would make it unquotable no matter what else we fix.
    expect(migration).not.toMatch(/Install EV charger[\s\S]{0,400}always_inspection\s*=?\s*true/i)
  })

  it("carries category 'ev_charger' — quote-readiness and the WP9 offer both key on it", () => {
    expect(categories).toContain("'ev_charger'")
  })
})

const { resolveAddressProvenance } = await import('@/app/api/intake/structure/route')

describe('address provenance (R5a, DoD: behaviour not source)', () => {
  it('memory address + thread with suburb only -> address_source none, remembered carried', () => {
    expect(resolveAddressProvenance(null, '652 London Rd')).toEqual({
      address_source: 'none',
      remembered_address: '652 London Rd',
    })
    // The remembered value must NEVER be promoted to the job address.
    expect(resolveAddressProvenance('', '652 London Rd').address_source).toBe('none')
  })

  it('a street address from THIS thread wins and is marked as such', () => {
    expect(resolveAddressProvenance('12 Smith St', '652 London Rd')).toEqual({
      address_source: 'thread',
    })
    // Memory is not carried once the thread supplied one — nothing to confirm.
    expect(resolveAddressProvenance('12 Smith St', '652 London Rd').remembered_address)
      .toBeUndefined()
  })

  it('nothing anywhere -> an explicit none, never undefined', () => {
    expect(resolveAddressProvenance(null, null)).toEqual({ address_source: 'none' })
    expect(resolveAddressProvenance(undefined, '   ')).toEqual({ address_source: 'none' })
  })
})
