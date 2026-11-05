import { describe, expect, it } from 'vitest'
import { isPlanMeasurement } from './types'

describe('isPlanMeasurement', () => {
  it('is a measurement from the plans, wholly or with existing roofs from aerial data (TKO-21)', () => {
    expect(['plans', 'hybrid'].map(isPlanMeasurement)).toEqual([true, true])
    expect(['geoscape', 'mock', 'manual', null, undefined].map(isPlanMeasurement)).toEqual([false, false, false, false, false])
  })
})
