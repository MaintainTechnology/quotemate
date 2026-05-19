import { describe, expect, it } from 'vitest'
import { buildGpoInspectionOverride } from './gpo-guard'

describe('buildGpoInspectionOverride', () => {
  it('keeps ensuite GPOs in the quote path and asks the wet-area safety question', () => {
    const override = buildGpoInspectionOverride({
      decision: {
        action: 'escalate_inspection',
        job_type_guess: 'power_points',
        reason_for_escalation: 'bathroom power points have extra safety requirements',
      },
      turns: [
        { direction: 'inbound', body: 'Can I get two Powerpoints' },
        { direction: 'outbound', body: 'Welcome back Jon - two GPOs, easy. Which room are they going in?' },
        { direction: 'inbound', body: 'Ensuite' },
      ],
    })

    expect(override?.reason).toBe('gpo wet-room false-positive inspection override')
    expect(override?.reply).toMatch(/600mm/i)
    expect(override?.reply).toMatch(/ensuite/i)
  })

  it('does not treat broad "new GPO" wording as proof of a new circuit', () => {
    const override = buildGpoInspectionOverride({
      decision: {
        action: 'escalate_inspection',
        job_type_guess: 'power_points',
        reason_for_escalation: 'new circuit required',
      },
      turns: [
        { direction: 'inbound', body: 'New gpo' },
        { direction: 'outbound', body: 'Got it James - how many new GPOs did you need?' },
        { direction: 'inbound', body: '2' },
        { direction: 'outbound', body: 'Which room are the 2 new GPOs going in?' },
        { direction: 'inbound', body: 'Bedroom' },
      ],
    })

    expect(override?.reason).toBe('new-gpo false-positive circuit override')
    expect(override?.reply).toMatch(/existing power point nearby/i)
  })

  it('allows real new-circuit wording to stay on the inspection path', () => {
    const override = buildGpoInspectionOverride({
      decision: {
        action: 'escalate_inspection',
        job_type_guess: 'power_points',
        reason_for_escalation: 'new dedicated circuit',
      },
      turns: [
        { direction: 'inbound', body: 'Need two GPOs on a brand-new run from the switchboard' },
      ],
    })

    expect(override).toBeNull()
  })

  it('does not interfere with non-GPO inspection work', () => {
    const override = buildGpoInspectionOverride({
      decision: {
        action: 'escalate_inspection',
        job_type_guess: 'unknown',
        reason_for_escalation: 'switchboard',
      },
      turns: [
        { direction: 'inbound', body: 'Switchboard upgrade please' },
      ],
    })

    expect(override).toBeNull()
  })
})
