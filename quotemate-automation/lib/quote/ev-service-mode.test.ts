import { describe, expect, it } from 'vitest'
import {
  EV_SERVICE_MODES,
  EvServiceModeSchema,
  evChargerServiceModeFromIntake,
  isEvInstallationMode,
  isEvSupplyMode,
  normaliseEvServiceMode,
  resolveEvChargerServiceMode,
  strictEvChargerServiceModeFromIntake,
  suppliedByForEvServiceMode,
} from './ev-service-mode'

describe('EV service mode', () => {
  it('keeps exactly the three actionable canonical values', () => {
    expect(EV_SERVICE_MODES).toEqual([
      'supply_only',
      'install_only',
      'supply_and_install',
    ])
    expect(EvServiceModeSchema.safeParse('unknown').success).toBe(false)
  })

  it.each([
    ['supply_only', 'supply_only'],
    ['Supply only', 'supply_only'],
    ['installation only', 'install_only'],
    ['customer already has the charger', 'install_only'],
    ['supply & install', 'supply_and_install'],
    ['we supply the charger', 'supply_and_install'],
  ] as const)('normalises %s to %s', (input, expected) => {
    expect(normaliseEvServiceMode(input)).toBe(expected)
  })

  it.each(['', 'not sure', 'tradie', 'customer', null, undefined])(
    'does not invent a mode from %s',
    (input) => {
      expect(normaliseEvServiceMode(input)).toBeUndefined()
    },
  )

  it('derives supplier and work predicates from the mode', () => {
    expect(suppliedByForEvServiceMode('supply_only')).toBe('tradie')
    expect(suppliedByForEvServiceMode('install_only')).toBe('customer')
    expect(suppliedByForEvServiceMode('supply_and_install')).toBe('tradie')
    expect(isEvSupplyMode('supply_only')).toBe(true)
    expect(isEvSupplyMode('install_only')).toBe(false)
    expect(isEvInstallationMode('supply_only')).toBe(false)
    expect(isEvInstallationMode('supply_and_install')).toBe(true)
  })

  it('never turns tradie-owned legacy supply into an installation request', () => {
    expect(resolveEvChargerServiceMode({ supplied_by: 'tradie' })).toBeUndefined()
    expect(
      evChargerServiceModeFromIntake({ scope: { specs: { supplied_by: 'tradie' } } }),
    ).toBeUndefined()
  })

  it('does not let legacy fields override a present but invalid canonical mode', () => {
    expect(
      resolveEvChargerServiceMode({
        service_mode: 'unknown',
        charger_supply: 'we supply the charger',
        supplied_by: 'customer',
      }),
    ).toBeUndefined()
  })

  it('keeps customer-owned legacy installs readable without authorising them as explicit', () => {
    const intake = { scope: { specs: { supplied_by: 'customer' } } }
    expect(evChargerServiceModeFromIntake(intake)).toBe('install_only')
    expect(strictEvChargerServiceModeFromIntake(intake)).toBeUndefined()
  })

  it('lets an explicit canonical mode override legacy supplier metadata', () => {
    const intake = {
      scope: {
        specs: { service_mode: 'supply_only', supplied_by: 'customer' },
      },
    }
    expect(strictEvChargerServiceModeFromIntake(intake)).toBe('supply_only')
    expect(evChargerServiceModeFromIntake(intake)).toBe('supply_only')
  })

  it('strict intake resolution rejects human-readable legacy text in the canonical field', () => {
    expect(
      strictEvChargerServiceModeFromIntake({
        scope: { specs: { service_mode: 'supply only' } },
      }),
    ).toBeUndefined()
  })
})
