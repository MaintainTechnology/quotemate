import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Intake } from '@/lib/intake/schema'
import { evaluateIntakeQuality } from '@/lib/intake/quality'

// The route creates its Supabase client at module load. These tests exercise
// only the pure handoff helpers, so no database surface is needed.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const {
  evServiceModeChangedSinceIntake,
  invalidateEvIntakeAfterModeChange,
  reconcileSmsEvServiceModeIntake,
  smsEvServiceModeFromConversationState,
  unresolvedEvServiceModeBlocksHandoff,
} = await import('@/app/api/intake/structure/route')

function evIntake(overrides: Partial<Intake> = {}): Intake {
  return {
    trade: 'electrical',
    job_type: 'ev_charger',
    address: '7 Harbour St',
    suburb: 'Harbord',
    scope: {
      description: 'Supply an EV charger requested by the customer.',
      is_new_install: true,
      existing_wiring: false,
      indoor_outdoor: 'indoor',
      specs: {
        supplied_by: 'tradie',
        photo_declined: true,
      },
      chosen_product: { materialId: 'charger-1', name: '7 kW EV charger' },
    } as unknown as Intake['scope'],
    access: { wall_type: 'brick' },
    property: { phase: 'single', has_solar: true },
    risks: [],
    inspection_required: true,
    caller: { name: 'Steve', phone: '+61400000000' },
    confidence: 'HIGH',
    confidence_reason: 'Explicit customer answers.',
    ...overrides,
  }
}

describe('SMS EV service-mode extraction', () => {
  it('canonicalises only the explicit service_mode slot', () => {
    expect(smsEvServiceModeFromConversationState({
      slots: { service_mode: 'Supply only', supplied_by: 'tradie' },
    })).toBe('supply_only')
    expect(smsEvServiceModeFromConversationState({
      slots: { service_mode: 'supply_and_install' },
    })).toBe('supply_and_install')
  })

  it('does not turn supplier interest into a service decision', () => {
    expect(smsEvServiceModeFromConversationState({
      slots: { supplied_by: 'tradie' },
    })).toBeUndefined()
    expect(smsEvServiceModeFromConversationState({
      slots: { service_mode: 'can you supply?' },
    })).toBeUndefined()
  })

  it('blocks an EV handoff until a canonical mode exists', () => {
    expect(unresolvedEvServiceModeBlocksHandoff('ev_charger', null, undefined)).toBe(true)
    expect(unresolvedEvServiceModeBlocksHandoff(null, 'ev_charger', undefined)).toBe(true)
    expect(unresolvedEvServiceModeBlocksHandoff('ev_charger', null, 'supply_only')).toBe(false)
    expect(unresolvedEvServiceModeBlocksHandoff('ev_charger', null, 'install_only')).toBe(false)
    expect(unresolvedEvServiceModeBlocksHandoff('ev_charger', null, 'supply_and_install')).toBe(false)
    expect(unresolvedEvServiceModeBlocksHandoff('downlights', null, undefined)).toBe(false)
  })

  it('detects a mode correction that requires a full transcript rebuild', () => {
    const intake = evIntake({
      scope: {
        description: 'Supply an EV charger only.',
        specs: { service_mode: 'supply_only', supplied_by: 'tradie' },
      } as unknown as Intake['scope'],
    })

    expect(evServiceModeChangedSinceIntake(intake, 'supply_only')).toBe(false)
    expect(evServiceModeChangedSinceIntake(intake, 'install_only')).toBe(true)
    expect(evServiceModeChangedSinceIntake(intake, 'supply_and_install')).toBe(true)
    expect(evServiceModeChangedSinceIntake(intake, undefined)).toBe(false)
    expect(evServiceModeChangedSinceIntake(
      evIntake({ scope: { description: 'Legacy EV request.' } }),
      'supply_only',
    )).toBe(true)

    const reconciled = reconcileSmsEvServiceModeIntake(intake, 'install_only', 'ev_charger')
    const invalidated = invalidateEvIntakeAfterModeChange(
      reconciled.intake,
      'supply_only',
      'install_only',
    )
    expect((invalidated.scope as unknown as Record<string, unknown>).description).toBe('')
    expect(evaluateIntakeQuality(invalidated)).toBe('empty')
    expect(reconciled.retainInstallationPhotos).toBe(true)

    const staleInstallProduct = evIntake({
      scope: {
        description: 'Install the customer charger.',
        specs: { service_mode: 'install_only', supplied_by: 'customer' },
        chosen_product: { catalogue_id: 'stale-unit' },
      } as unknown as Intake['scope'],
    })
    const combined = reconcileSmsEvServiceModeIntake(
      staleInstallProduct,
      'supply_and_install',
      'ev_charger',
    )
    const invalidatedCombined = invalidateEvIntakeAfterModeChange(
      combined.intake,
      'install_only',
      'supply_and_install',
    )
    expect(invalidatedCombined.scope).not.toHaveProperty('chosen_product')
  })
})

describe('SMS EV service-mode structured-intake handoff', () => {
  it('turns supply_only into a product order with no installation site state', () => {
    const result = reconcileSmsEvServiceModeIntake(evIntake(), 'supply_only', 'ev_charger')
    const scope = result.intake.scope as unknown as Record<string, unknown>
    const specs = scope.specs as Record<string, unknown>

    expect(specs).toMatchObject({
      service_mode: 'supply_only',
      supplied_by: 'tradie',
    })
    expect(specs).not.toHaveProperty('photo_declined')
    expect(scope).not.toHaveProperty('is_new_install')
    expect(scope).not.toHaveProperty('existing_wiring')
    expect(scope).not.toHaveProperty('indoor_outdoor')
    expect(scope).toHaveProperty('chosen_product')
    expect(scope.description).toBe(
      'Supply an EV charger unit only. Installation, electrical work and site attendance are excluded.',
    )
    expect(result.intake.access).toBeUndefined()
    expect(result.intake.property).toBeUndefined()
    expect(result.intake.inspection_required).toBe(false)
    expect(result.allowChosenProduct).toBe(true)
    expect(result.retainInstallationPhotos).toBe(false)
  })

  it('forces install_only supplier ownership and removes a stale charger choice', () => {
    const result = reconcileSmsEvServiceModeIntake(evIntake(), 'install_only', 'ev_charger')
    const scope = result.intake.scope as unknown as Record<string, unknown>

    expect(scope.specs).toMatchObject({
      service_mode: 'install_only',
      supplied_by: 'customer',
    })
    expect(scope).not.toHaveProperty('chosen_product')
    expect(scope).toHaveProperty('is_new_install', true)
    expect(result.intake.property).toEqual({ phase: 'single', has_solar: true })
    expect(result.intake.inspection_required).toBe(true)
    expect(result.allowChosenProduct).toBe(false)
    expect(result.retainInstallationPhotos).toBe(true)
  })

  it('keeps a charger choice for supply_and_install and derives tradie supply', () => {
    const result = reconcileSmsEvServiceModeIntake(
      evIntake(),
      'supply_and_install',
      'ev_charger',
    )
    const scope = result.intake.scope as unknown as Record<string, unknown>

    expect(scope.specs).toMatchObject({
      service_mode: 'supply_and_install',
      supplied_by: 'tradie',
    })
    expect(scope).toHaveProperty('chosen_product')
    expect(result.allowChosenProduct).toBe(true)
    expect(result.retainInstallationPhotos).toBe(true)
  })

  it('makes an ambiguous EV intake non-usable and removes product/site state', () => {
    const result = reconcileSmsEvServiceModeIntake(evIntake(), undefined, 'ev_charger')
    const scope = result.intake.scope as unknown as Record<string, unknown>
    const specs = scope.specs as Record<string, unknown>

    expect(specs.service_mode).toBeUndefined()
    expect(specs.supplied_by).toBeUndefined()
    expect(specs.photo_declined).toBeUndefined()
    expect(scope).not.toHaveProperty('chosen_product')
    expect(scope).not.toHaveProperty('is_new_install')
    expect(scope).not.toHaveProperty('existing_wiring')
    expect(scope).not.toHaveProperty('indoor_outdoor')
    expect(scope.description).toBe('')
    expect(result.intake.access).toBeUndefined()
    expect(result.intake.property).toBeUndefined()
    expect(result.intake.inspection_required).toBe(false)
    expect(result.intake.confidence).toBe('LOW')
    expect(result.allowChosenProduct).toBe(false)
    expect(result.retainInstallationPhotos).toBe(false)
    expect(evaluateIntakeQuality(result.intake)).toBe('empty')
  })

  it('does not alter a non-EV legacy intake', () => {
    const intake = evIntake({ job_type: 'downlights' })
    const result = reconcileSmsEvServiceModeIntake(intake, undefined, 'downlights')

    expect(result.intake).toBe(intake)
    expect(result.allowChosenProduct).toBe(true)
    expect(result.retainInstallationPhotos).toBe(true)
  })
})

describe('SMS EV service-mode route wiring', () => {
  it('applies the reconciliation before the intake row is persisted', () => {
    const source = readFileSync(path.join(__dirname, 'route.ts'), 'utf8')
    const structuring = source.indexOf("let intake = await smsWorkCheckpoint('structured_intake'")
    const reconciliation = source.indexOf(
      'const evServiceReconciliation = reconcileSmsEvServiceModeIntake(',
    )
    const persistence = source.indexOf("supabase.from('intakes').upsert")

    expect(source).toContain(
      'dialogEvServiceMode = smsEvServiceModeFromConversationState(convo.conversation_state)',
    )
    expect(reconciliation).toBeGreaterThan(structuring)
    expect(persistence).toBeGreaterThan(reconciliation)
    expect(source).toContain('if (!evServiceReconciliation.retainInstallationPhotos)')
    expect(source).toContain('photo_paths: photoPaths')
  })

  it('fails closed before stale or fresh unresolved EV intake can reach estimation', () => {
    const source = readFileSync(path.join(__dirname, 'route.ts'), 'utf8')
    const canonicalModeRead = source.indexOf(
      'dialogEvServiceMode = smsEvServiceModeFromConversationState(convo.conversation_state)',
    )
    const existingLookup = source.indexOf("const existingIntakeQuery = supabase.from('intakes')")
    const existingReconciliation = source.indexOf(
      'const modeReconciliation = reconcileSmsEvServiceModeIntake(',
      existingLookup,
    )
    const existingModeGate = source.indexOf(
      'if (unresolvedEvServiceModeBlocksHandoff(',
      existingReconciliation,
    )
    const existingEstimateEnqueue = source.indexOf(
      'await enqueueEstimateWork(existingIntake.id',
      existingModeGate,
    )
    const freshModeGate = source.indexOf(
      'if (unresolvedEvServiceModeBlocksHandoff(null, dialogJobType, dialogEvServiceMode))',
      existingEstimateEnqueue,
    )
    const messageLoad = source.indexOf("const { data: messages } = await supabase")
    const postStructureGate = source.lastIndexOf('if (unresolvedEvServiceModeBlocksHandoff(')
    const persistence = source.indexOf("supabase.from('intakes').upsert")

    expect(canonicalModeRead).toBeGreaterThan(-1)
    expect(canonicalModeRead).toBeLessThan(existingLookup)
    expect(existingReconciliation).toBeGreaterThan(existingLookup)
    expect(source.indexOf('const modeChanged = evServiceModeChangedSinceIntake(', existingLookup))
      .toBeLessThan(existingReconciliation)
    expect(source).toContain('intake: invalidateEvIntakeAfterModeChange(')
    expect(existingModeGate).toBeGreaterThan(existingReconciliation)
    expect(existingEstimateEnqueue).toBeGreaterThan(existingModeGate)
    expect(freshModeGate).toBeGreaterThan(existingEstimateEnqueue)
    expect(freshModeGate).toBeLessThan(messageLoad)
    expect(postStructureGate).toBeGreaterThan(messageLoad)
    expect(postStructureGate).toBeLessThan(persistence)
    expect(source).toContain("gated: 'ev_service_mode'")
    expect(source).toContain('product_choice: null')
    expect(source).toContain('photo_paths: []')
  })
})
