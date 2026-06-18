// R30/R34 — service-toggle freshness mechanism (mechanism-level unit tests).
//
// Proves the fix for the staleness bug: the per-tenant service list is
// rendered OUTSIDE the dialog's cached prefix and carries a deterministic
// version stamp, so a dashboard toggle is reflected on the NEXT build —
// not 1–3 turns later when an Anthropic cache breakpoint rolls.
//
// These are pure-function tests (no Anthropic call): serviceListVersion()
// is the cache-key/version mechanism and buildDialogServiceBlock() is the
// rendered block the model actually reads each turn. Full live E2E (a real
// inbound after a toggle) is Phase 7.

import { describe, expect, it } from 'vitest'
import {
  serviceListVersion,
  buildDialogServiceBlock,
  type CustomServiceScope,
} from './dialog'

const dishwasher: CustomServiceScope = {
  name: 'Install dishwasher',
  description: 'Plumb + power a new dishwasher',
  always_inspection: false,
  clarifying_questions: null,
}
const evCharger: CustomServiceScope = {
  name: 'Install EV charger',
  description: 'Wall-mounted home charger',
  always_inspection: false,
  clarifying_questions: ['Single or three phase supply?', 'Distance from the board?'],
}

describe('serviceListVersion — deterministic cache key for the live offerings', () => {
  it('is stable for identical offerings (no spurious cache busts)', () => {
    const a = serviceListVersion({ customAssemblies: [dishwasher, evCharger] })
    const b = serviceListVersion({ customAssemblies: [dishwasher, evCharger] })
    expect(a).toBe(b)
  })

  it('is order-independent for the enabled list (a pure reorder is NOT a change)', () => {
    const a = serviceListVersion({ customAssemblies: [dishwasher, evCharger] })
    const b = serviceListVersion({ customAssemblies: [evCharger, dishwasher] })
    expect(a).toBe(b)
  })

  it('CHANGES when a service is turned OFF (removed from the enabled list)', () => {
    const both = serviceListVersion({ customAssemblies: [dishwasher, evCharger] })
    const dishwasherOff = serviceListVersion({ customAssemblies: [evCharger] })
    expect(dishwasherOff).not.toBe(both)
  })

  it('CHANGES when a service is turned ON (added to the enabled list)', () => {
    const before = serviceListVersion({ customAssemblies: [dishwasher] })
    const after = serviceListVersion({ customAssemblies: [dishwasher, evCharger] })
    expect(after).not.toBe(before)
  })

  it('CHANGES when a service flips to always_inspection', () => {
    const quoteable = serviceListVersion({ customAssemblies: [dishwasher] })
    const inspection = serviceListVersion({
      customAssemblies: [{ ...dishwasher, always_inspection: true }],
    })
    expect(inspection).not.toBe(quoteable)
  })

  it('CHANGES when mandated MUST-ASK questions are edited', () => {
    const v1 = serviceListVersion({ customAssemblies: [evCharger] })
    const v2 = serviceListVersion({
      customAssemblies: [{ ...evCharger, clarifying_questions: ['Single or three phase supply?'] }],
    })
    expect(v2).not.toBe(v1)
  })

  it('CHANGES when a service moves between enabled and declined', () => {
    const enabled = serviceListVersion({ customAssemblies: [dishwasher] })
    const declined = serviceListVersion({ declinedServices: ['Install dishwasher'] })
    expect(declined).not.toBe(enabled)
  })

  it('empty offerings → stable sentinel', () => {
    expect(serviceListVersion({})).toBe('none')
    expect(serviceListVersion({ customAssemblies: [], declinedServices: [] })).toBe('none')
  })
})

describe('buildDialogServiceBlock — the uncached, version-stamped block the model reads', () => {
  it('a service turned ON is OFFERED to the model on the next build', () => {
    const block = buildDialogServiceBlock({ customAssemblies: [dishwasher] })
    expect(block).toContain('Install dishwasher')
    // The enabled block is the authoritative in-scope directive.
    expect(block).toContain('TENANT SERVICES THIS TRADIE OFFERS')
  })

  it('a service turned OFF is NO LONGER offered, but IS listed as declined', () => {
    // Toggle a custom service OFF: the route stops passing it in
    // customAssemblies and instead lists it under declinedServices. Use a
    // distinctive name that does NOT appear in any directive's static example
    // text, so the index assertions are unambiguous.
    const offName = 'Install pool pump'
    const block = buildDialogServiceBlock({
      customAssemblies: [evCharger],
      declinedServices: [offName],
    })
    // The still-ON service appears under the OFFERED block.
    expect(block).toContain('Install EV charger')
    expect(block).toContain('DECLINED SERVICES')
    // The OFF service appears EXACTLY ONCE, and it's in the DECLINED region —
    // never in the offered/auto-quote region.
    const offeredIdx = block.indexOf('TENANT SERVICES THIS TRADIE OFFERS')
    const declinedIdx = block.indexOf('DECLINED SERVICES')
    const offNameIdx = block.indexOf(offName)
    expect(offeredIdx).toBeGreaterThanOrEqual(0)
    expect(declinedIdx).toBeGreaterThan(offeredIdx)
    expect(offNameIdx).toBeGreaterThan(declinedIdx)
    expect(block.indexOf(offName, offNameIdx + 1)).toBe(-1) // listed once
  })

  it('an ON service is rendered as a `- ` bullet in the offered list', () => {
    const block = buildDialogServiceBlock({ customAssemblies: [evCharger] })
    // The offered block renders each enabled service as a "- <name>" line.
    expect(block).toMatch(/-\s+Install EV charger/)
  })

  it('the rendered block carries the current version stamp (freshness is observable)', () => {
    const input = { customAssemblies: [dishwasher, evCharger] }
    const block = buildDialogServiceBlock(input)
    expect(block).toContain(`SERVICE LIST VERSION: ${serviceListVersion(input)}`)
    expect(block).toMatch(/always read fresh, never cached/i)
  })

  it('toggling the list changes the version stamp embedded in the next block', () => {
    const before = buildDialogServiceBlock({ customAssemblies: [dishwasher, evCharger] })
    const after = buildDialogServiceBlock({ customAssemblies: [dishwasher] }) // EV charger OFF
    const ver = (s: string) => s.match(/SERVICE LIST VERSION: (\S+)/)?.[1]
    expect(ver(before)).toBeTruthy()
    expect(ver(after)).toBeTruthy()
    expect(ver(after)).not.toBe(ver(before))
  })

  it('empty input → empty block (no version line when nothing dynamic to say)', () => {
    expect(buildDialogServiceBlock({})).toBe('')
    expect(buildDialogServiceBlock({ customAssemblies: [], declinedServices: [] })).toBe('')
  })
})
