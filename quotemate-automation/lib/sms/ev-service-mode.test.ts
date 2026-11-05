import { describe, expect, it } from 'vitest'
import {
  deterministicEvServiceModeUpdates,
  EMPTY_STATE,
  mergeSlotUpdates,
  SlotsSchema,
  type ConversationState,
} from './extract-slots'
import {
  evaluateQuoteReadiness,
  EV_CHARGER_FALLBACK_QUESTIONS,
  EV_INSTALL_ONLY_CHARGER_QUESTION,
  EV_PHOTO_QUESTION,
  EV_SERVICE_MODE_QUESTION,
} from './quote-readiness'
import { SYSTEM_PROMPT, type ConversationTurn } from './dialog'

function evState(
  serviceMode?: 'supply_only' | 'install_only' | 'supply_and_install',
): ConversationState {
  return {
    ...EMPTY_STATE,
    slots: {
      first_name: 'Steve',
      suburb: 'Harboard',
      job_type: 'ev_charger',
      ...(serviceMode ? { service_mode: serviceMode } : {}),
    },
  }
}

function installAnswers(
  serviceMode: 'install_only' | 'supply_and_install',
): ConversationTurn[] {
  return [
    { direction: 'outbound', body: EV_CHARGER_FALLBACK_QUESTIONS[0] },
    { direction: 'inbound', body: 'Tesla' },
    ...(serviceMode === 'install_only' ? [
      { direction: 'outbound' as const, body: EV_INSTALL_ONLY_CHARGER_QUESTION },
      { direction: 'inbound' as const, body: 'Tesla Wall Connector Gen 3' },
    ] : []),
    { direction: 'outbound', body: EV_CHARGER_FALLBACK_QUESTIONS[2] },
    { direction: 'inbound', body: 'Garage' },
    { direction: 'outbound', body: EV_CHARGER_FALLBACK_QUESTIONS[3] },
    { direction: 'inbound', body: '7m' },
    { direction: 'outbound', body: EV_CHARGER_FALLBACK_QUESTIONS[4] },
    { direction: 'inbound', body: 'Single phase, likely spare capacity' },
  ]
}

describe('EV charger service mode — deterministic SMS contract', () => {
  it('keeps the customer-facing three-way clarification copy exact', () => {
    expect(EV_SERVICE_MODE_QUESTION).toBe(
      'Do you need the charger supplied only, installation only for a charger you already have, or both supply and installation?',
    )
  })

  it('stores only canonical resolved modes; absence represents unknown', () => {
    for (const service_mode of ['supply_only', 'install_only', 'supply_and_install'] as const) {
      expect(SlotsSchema.safeParse({ service_mode }).success).toBe(true)
    }
    expect(SlotsSchema.safeParse({ service_mode: 'unknown' }).success).toBe(false)
    expect(SlotsSchema.safeParse({}).success).toBe(true)
  })

  it('keeps Steve unresolved at "can you supply" and clears any stale mode', () => {
    const updates = deterministicEvServiceModeUpdates({
      currentJobType: 'ev_charger',
      currentServiceMode: 'supply_and_install',
      lastAgentMessage: 'Is the charger already on-site, and if so what model is it?',
      customerMessage: 'Not on site... can you supply',
    })

    expect(updates).toEqual({ service_mode: null, supplied_by: 'tradie' })
    const merged = mergeSlotUpdates(evState('supply_and_install'), updates)
    expect(merged.slots.service_mode).toBeUndefined()
    expect(merged.slots.supplied_by).toBe('tradie')
  })

  it('forces the exact three-way question before any installation question', () => {
    const history: ConversationTurn[] = [
      { direction: 'inbound', body: 'Can you do EV chargers' },
      { direction: 'outbound', body: "Welcome back, yep we do EV chargers - what's your first name?" },
      { direction: 'inbound', body: 'Steve' },
      { direction: 'outbound', body: "Cheers Steve - what suburb's the job in?" },
      { direction: 'inbound', body: 'Harboard' },
      { direction: 'outbound', body: 'Is the charger already on-site, and if so what model is it?' },
      { direction: 'inbound', body: 'Not on site... can you supply' },
    ]

    const result = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'ev_charger',
      conversationState: evState(),
      history,
      services: [],
      hasPhoto: false,
    })

    expect(result.ready).toBe(false)
    expect(result.missing[0]?.code).toBe('service_mode')
    expect(result.reply).toBe(EV_SERVICE_MODE_QUESTION)
    expect(result.reply).not.toMatch(/how far|switchboard|phase|photo/i)
  })

  it('classifies Steve as supply-and-install only after he affirms that explicit recap', () => {
    const updates = deterministicEvServiceModeUpdates({
      currentJobType: 'ev_charger',
      lastAgentMessage:
        "To confirm: EV charger install in Harboard, we're supplying the unit, about 7m from the switchboard, single-phase with likely spare capacity. Sound right?",
      customerMessage: 'Sounds right.',
    })

    expect(updates).toEqual({
      service_mode: 'supply_and_install',
      supplied_by: 'tradie',
    })
  })

  it('does not turn a bare yes to the three-way question into a service mode', () => {
    expect(deterministicEvServiceModeUpdates({
      currentJobType: 'ev_charger',
      lastAgentMessage: EV_SERVICE_MODE_QUESTION,
      customerMessage: 'Yes',
    })).toEqual({})
  })

  it.each([
    ['Supply only please', 'supply_only', 'tradie'],
    ['Installation only - I already have the charger', 'install_only', 'customer'],
    ['Both please', 'supply_and_install', 'tradie'],
  ] as const)('maps explicit answer %j to %s', (customerMessage, service_mode, supplied_by) => {
    expect(deterministicEvServiceModeUpdates({
      currentJobType: 'ev_charger',
      lastAgentMessage: EV_SERVICE_MODE_QUESTION,
      customerMessage,
    })).toEqual({ service_mode, supplied_by })
  })

  it('makes supply-only ready without location, distance, phase, photo, or site-visit facts', () => {
    const result = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'ev_charger',
      conversationState: evState('supply_only'),
      history: [{ direction: 'inbound', body: 'Tesla' }],
      services: [],
      hasPhoto: false,
    })

    expect(result).toEqual({ ready: true, missing: [], reply: null })
  })

  it('asks install-only for the customer-owned charger make/model before site details', () => {
    const vehicleOnly: ConversationTurn[] = [
      { direction: 'outbound', body: EV_CHARGER_FALLBACK_QUESTIONS[0] },
      { direction: 'inbound', body: 'Tesla Model Y' },
    ]
    const missingModel = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'ev_charger',
      conversationState: evState('install_only'),
      history: vehicleOnly,
      services: [],
    })
    expect(missingModel.missing[0]?.code).toBe('ev_charger_model')
    expect(missingModel.reply).toBe(EV_INSTALL_ONLY_CHARGER_QUESTION)

    const modelAnswered = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'ev_charger',
      conversationState: evState('install_only'),
      history: [
        ...vehicleOnly,
        { direction: 'outbound', body: EV_INSTALL_ONLY_CHARGER_QUESTION },
        { direction: 'inbound', body: 'Tesla Wall Connector Gen 3' },
      ],
      services: [],
    })
    expect(modelAnswered.missing[0]?.code).toBe('service_question:2')
  })

  it('does not infer live installation intent from legacy customer ownership', () => {
    const legacyState = evState()
    legacyState.slots.supplied_by = 'customer'
    const result = evaluateQuoteReadiness({
      action: 'finish',
      jobTypeGuess: 'ev_charger',
      conversationState: legacyState,
      history: [{ direction: 'inbound', body: 'I already have the charger' }],
      services: [],
      hasPhoto: false,
    })

    expect(result.missing[0]?.code).toBe('service_mode')
    expect(result.reply).toBe(EV_SERVICE_MODE_QUESTION)
  })

  it.each(['install_only', 'supply_and_install'] as const)(
    'retains the EV photo gate for %s',
    (serviceMode) => {
      const result = evaluateQuoteReadiness({
        action: 'finish',
        jobTypeGuess: 'ev_charger',
        conversationState: evState(serviceMode),
        history: installAnswers(serviceMode),
        services: [],
        hasPhoto: false,
      })

      expect(result.ready).toBe(false)
      expect(result.missing.map((item) => item.code)).toEqual(['ev_photo'])
      expect(result.reply).toBe(EV_PHOTO_QUESTION)
    },
  )

  it('teaches the dialog that supply willingness is not installation authority', () => {
    expect(SYSTEM_PROMPT).toContain(EV_SERVICE_MODE_QUESTION)
    expect(SYSTEM_PROMPT).toContain(EV_INSTALL_ONLY_CHARGER_QUESTION)
    expect(SYSTEM_PROMPT).toContain('"Can you supply?" only says the tradie may supply the unit')
    expect(SYSTEM_PROMPT).toContain("service_mode='supply_only'")
  })
})
