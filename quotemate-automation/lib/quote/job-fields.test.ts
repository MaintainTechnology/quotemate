import { describe, it, expect } from 'vitest'
import { JOB_FIELDS, fieldsForJobType } from './job-fields'
import { IntakeSchema } from '@/lib/intake/schema'

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
