import { describe, it, expect } from 'vitest'
import { JOB_FIELDS, fieldsForJobType } from './job-fields'
import { IntakeSchema } from '@/lib/intake/schema'
import { normaliseSystemType } from '@/lib/intake/structure'

const JOB_TYPES = IntakeSchema.shape.job_type.options as readonly string[]

describe('JOB_FIELDS', () => {
  it('covers every job_type in the canonical intake taxonomy', () => {
    // The dropdown renders from IntakeSchema's enum. A job type with no entry
    // would render an empty form, so the registry must be exhaustive — this
    // is what fails when someone adds a job type to lib/intake/schema.ts.
    const missing = JOB_TYPES.filter((jt) => !(jt in JOB_FIELDS))
    expect(missing).toEqual([])
  })

  it('has no keys that are not real job types', () => {
    const orphans = Object.keys(JOB_FIELDS).filter((k) => !JOB_TYPES.includes(k))
    expect(orphans).toEqual([])
  })

  it('gives every job type at least one field to fill in', () => {
    for (const [jobType, spec] of Object.entries(JOB_FIELDS)) {
      expect(spec.fields.length, `${jobType} has no fields`).toBeGreaterThan(0)
    }
  })

  it('uses unique, non-empty field codes within each job type', () => {
    for (const [jobType, spec] of Object.entries(JOB_FIELDS)) {
      const codes = spec.fields.map((f) => f.code)
      expect(codes.every((c) => c.trim().length > 0), `${jobType} has a blank code`).toBe(true)
      expect(new Set(codes).size, `${jobType} has duplicate codes`).toBe(codes.length)
    }
  })

  it('gives every field a question label', () => {
    for (const [jobType, spec] of Object.entries(JOB_FIELDS)) {
      for (const f of spec.fields) {
        expect(f.label.trim().length, `${jobType}.${f.code} has no label`).toBeGreaterThan(0)
      }
    }
  })

  it('gives every select at least two distinct options, and no non-select any', () => {
    for (const [jobType, spec] of Object.entries(JOB_FIELDS)) {
      for (const f of spec.fields) {
        if (f.type === 'select') {
          const opts = f.options ?? []
          expect(opts.length, `${jobType}.${f.code} select needs options`).toBeGreaterThanOrEqual(2)
          expect(new Set(opts).size, `${jobType}.${f.code} has duplicate options`).toBe(opts.length)
          expect(opts.every((o) => o.trim().length > 0)).toBe(true)
        } else {
          expect(f.options, `${jobType}.${f.code} is ${f.type} but carries options`).toBeUndefined()
        }
      }
    }
  })

  // The hot-water form option strings are read by normaliseSystemType, which
  // maps ONLY electric/gas/heat_pump. Anything it can't map makes the E8
  // backstop force an inspection (lib/intake/structure.ts:153). So the option
  // labels are load-bearing: an option that fails to map must SAY it routes to
  // an inspection, and an option that maps must map to the right fuel.
  it('hot_water options map to the fuel their label promises', () => {
    const opts = fieldsForJobType('hot_water').fields.find((f) => f.code === 'energy_source')?.options
    expect(opts).toBeDefined()
    const mapped = Object.fromEntries((opts ?? []).map((o) => [o, normaliseSystemType(o)]))

    expect(mapped['electric']).toBe('electric')
    expect(mapped['gas']).toBe('gas')
    expect(mapped['heat pump']).toBe('heat_pump')

    // Every option that does NOT map must warn the tradie in its own label,
    // otherwise it is a silent $99 inspection dressed up as a normal choice.
    for (const [option, fuel] of Object.entries(mapped)) {
      if (fuel === undefined) {
        expect(option.toLowerCase(), `"${option}" routes to inspection but does not say so`)
          .toContain('inspection')
      }
    }
  })

  // lib/intake/structure.ts:405-407 forces inspection_required for any
  // oven_cooktop / power_points / outdoor_lighting job mentioning a new circuit,
  // mains or switchboard work, and :397 for three-phase. An option that triggers
  // that is a guaranteed $99 inspection, so it must say so on the label — the
  // tradie is choosing it without knowing it discards the price.
  //
  // Sharper on power_points: the 20A band's own risk_flag is "switchboard spare
  // way required", so a tradie wanting a dedicated circuit naturally picks BOTH
  // 20A and the switchboard run — and the second choice throws away the
  // recipe's assembly swap along with the tiers.
  it('labels every option that forces an on-site inspection', () => {
    const mustWarn: Array<[string, string, string]> = [
      ['power_points', 'replace_or_new', 'switchboard'],
      ['oven_cooktop', 'replace_or_new', 'new circuit'],
      ['ev_charger', 'phase', 'three phase'],
    ]
    for (const [jobType, code, needle] of mustWarn) {
      const field = JOB_FIELDS[jobType].fields.find((f) => f.code === code)
      expect(field, `${jobType}.${code} missing`).toBeDefined()
      const option = (field!.options ?? []).find((o) => o.toLowerCase().includes(needle))
      expect(option, `${jobType}.${code} has no option matching "${needle}"`).toBeDefined()
      expect(
        option!.toLowerCase(),
        `"${option}" forces a $99 inspection but does not say so`,
      ).toContain('inspection')
    }
  })

  it('falls back to a usable generic spec for an unknown job type', () => {
    const spec = fieldsForJobType('not_a_real_job')
    expect(spec.fields.length).toBeGreaterThan(0)
    expect(spec.usuallyInspection).toBe(true)
  })

  it('resolves a known job type to its real spec', () => {
    expect(fieldsForJobType('downlights').catalogueCategory).toBe('downlight')
    expect(fieldsForJobType('downlights').fields.map((f) => f.code)).toContain('ceiling_type')
  })

  // Guards the heads-up shown in the form. These four have no shared_assemblies
  // row (verified against prod 2026-07-28), so the grounding validator
  // downgrades them to the $99 inspection route absent a tenant custom
  // assembly. If an assembly is later seeded for one, drop the flag.
  it('flags exactly the job types with no backing shared assembly', () => {
    const flagged = Object.entries(JOB_FIELDS)
      .filter(([, s]) => s.usuallyInspection)
      .map(([k]) => k)
      .sort()
    expect(flagged).toEqual(
      ['bathroom_renovation', 'burst_pipe', 'other', 'renovation', 'switchboard'].sort(),
    )
  })
})
