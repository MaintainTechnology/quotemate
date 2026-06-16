import { describe, it, expect } from 'vitest'
import { buildSolarFormPayload } from './form-payload'

describe('buildSolarFormPayload', () => {
  it('builds an address-only payload when manual is off', () => {
    const p = buildSolarFormPayload({
      address: '1 Test St, Sydney',
      postcode: '2000',
      state: 'NSW',
      manualOpen: false,
      orientation: 'north',
      roofSize: 'medium',
      storeys: 1,
      panelType: 'standard_panels',
    })
    expect(p.address).toEqual({ address: '1 Test St, Sydney', postcode: '2000', state: 'NSW' })
    expect('manual' in p).toBe(false)
    expect(p.panel_type).toBe('standard_panels')
  })

  it('includes the manual block when manual is open', () => {
    const p = buildSolarFormPayload({
      address: '1 Test St',
      postcode: '4000',
      state: 'QLD',
      manualOpen: true,
      orientation: 'west',
      roofSize: 'large',
      storeys: 2,
      panelType: 'premium_panels',
    })
    expect(p.manual).toEqual({ orientation: 'west', roof_size: 'large', storeys: 2 })
  })

  it('omits panel_type when set to unknown', () => {
    const p = buildSolarFormPayload({
      address: '1 Test St',
      postcode: '2000',
      state: 'NSW',
      manualOpen: false,
      orientation: 'north',
      roofSize: 'small',
      storeys: 1,
      panelType: 'unknown',
    })
    expect('panel_type' in p).toBe(false)
  })

  it('trims the address', () => {
    const p = buildSolarFormPayload({
      address: '  1 Test St  ',
      postcode: '2000',
      state: 'NSW',
      manualOpen: false,
      orientation: 'north',
      roofSize: 'small',
      storeys: 1,
      panelType: 'standard_panels',
    })
    expect(p.address.address).toBe('1 Test St')
  })
})

describe('buildSolarFormPayload — phase + preferred size', () => {
  const base = {
    address: '1 Test St',
    postcode: '2000',
    state: 'NSW',
    manualOpen: false,
    orientation: 'north',
    roofSize: 'medium' as const,
    storeys: 1 as const,
    panelType: 'standard_panels' as const,
  }

  it('includes phase when single or three', () => {
    expect(buildSolarFormPayload({ ...base, phase: 'three' }).phase).toBe('three')
    expect(buildSolarFormPayload({ ...base, phase: 'single' }).phase).toBe('single')
  })

  it('omits phase when unset', () => {
    expect('phase' in buildSolarFormPayload({ ...base })).toBe(false)
  })

  it('includes a positive desired size and omits a missing one', () => {
    expect(buildSolarFormPayload({ ...base, desiredKw: 10 }).desired_kw).toBe(10)
    expect('desired_kw' in buildSolarFormPayload({ ...base })).toBe(false)
  })
})
