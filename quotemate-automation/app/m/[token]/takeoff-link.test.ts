import { describe, expect, it } from 'vitest'
import { takeoffRunOf } from './takeoff-link'

const RUN = '7c674598-0950-8664-9cec-24e0cc15c1a1'

describe('takeoffRunOf (TKO-18)', () => {
  it("finds the run a plan measurement was saved from", () => {
    expect(takeoffRunOf('plans', `takeoff:${RUN}`)).toBe(RUN)
    expect(takeoffRunOf('hybrid', `takeoff:${RUN.toUpperCase()}`)).toBe(RUN.toUpperCase())
  })

  it('finds none for an aerial measurement, another key, or no key', () => {
    expect(takeoffRunOf('geoscape', `takeoff:${RUN}`)).toBeNull()
    expect(takeoffRunOf('plans', 'roofing-unmeasured:inbound-work-1')).toBeNull()
    expect(takeoffRunOf('plans', `takeoff:${RUN}/../../admin`)).toBeNull()
    expect(takeoffRunOf('plans', null)).toBeNull()
    expect(takeoffRunOf(null, `takeoff:${RUN}`)).toBeNull()
  })
})
