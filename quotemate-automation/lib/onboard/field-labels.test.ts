import { describe, it, expect } from 'vitest'
import {
  fieldLabel,
  humaniseFieldKey,
  stepForFields,
  activateErrorMessage,
} from './field-labels'

describe('activateErrorMessage', () => {
  // /api/onboard/activate returns a machine `error` code plus, for the cases it
  // can explain, a human `message`. The wizard threw only `error`, so a tradie
  // hitting the 422 saw the literal string "owner_user_id_unresolved".
  it('prefers the human message the route supplies', () => {
    expect(
      activateErrorMessage({
        error: 'owner_user_id_unresolved',
        message: 'Reload this page so we can read your signed-in session.',
      }),
    ).toBe('Reload this page so we can read your signed-in session.')
  })

  it('humanises a bare machine code rather than showing it raw', () => {
    expect(activateErrorMessage({ error: 'owner_user_id_unresolved' })).not.toMatch(/_/)
  })

  it('falls back to a generic line when the response says nothing useful', () => {
    expect(activateErrorMessage({})).toBe('Activation failed')
    expect(activateErrorMessage(null)).toBe('Activation failed')
  })

  it('ignores a blank or non-string message', () => {
    expect(activateErrorMessage({ error: 'boom', message: '   ' })).toBe('Boom')
    expect(activateErrorMessage({ error: 'boom', message: 42 as unknown as string })).toBe('Boom')
  })
})
import { OnboardActivateSchema } from './schema'

describe('fieldLabel', () => {
  it('maps the reported key to the label the tradie saw', () => {
    // The bug in the wild: "Please fix: default_markup_pct: Must be 0–100".
    expect(fieldLabel('default_markup_pct')).toBe('Materials markup')
  })

  it('humanises an unmapped key instead of leaking snake_case', () => {
    expect(fieldLabel('painting_walls_rate')).toBe('Painting walls')
    expect(fieldLabel('roofing_corrugated_rate')).toBe('Roofing corrugated')
  })

  it('never returns a raw snake_case key for ANY schema field', () => {
    // The guarantee that matters: add a field to the schema and forget the map,
    // and the banner still cannot print a database column name.
    for (const key of Object.keys(OnboardActivateSchema.shape)) {
      expect(fieldLabel(key)).not.toMatch(/_/)
    }
  })
})

describe('humaniseFieldKey', () => {
  it('drops the db-only rate/pct suffix', () => {
    expect(humaniseFieldKey('risk_buffer_pct')).toBe('Risk buffer')
    expect(humaniseFieldKey('senior_rate')).toBe('Senior')
  })
})

describe('stepForFields', () => {
  it('returns the step that renders the field so the wizard can jump there', () => {
    expect(stepForFields(['default_markup_pct'])).toBe(2)
    expect(stepForFields(['trades'])).toBe(1)
  })

  it('picks the EARLIEST step when several steps broke', () => {
    expect(stepForFields(['default_markup_pct', 'state'])).toBe(1)
  })

  it('returns null when nothing rejected is on a wizard step', () => {
    // e.g. invitation_code / intent_token — no input to jump to, so stay put.
    expect(stepForFields(['invitation_code'])).toBeNull()
    expect(stepForFields([])).toBeNull()
  })
})

describe('positivePct message (the one the tradie hit)', () => {
  const base = {
    business_name: 'Test Sparky',
    owner_first_name: 'Jo',
    owner_email: 'jo@test.com',
    trades: ['electrical'],
    hourly_rate: '120',
    call_out_minimum: '90',
    invitation_code: 'MATE2026',
  }

  it('reads as form guidance, not a validator string, above 100', () => {
    const r = OnboardActivateSchema.safeParse({ ...base, default_markup_pct: '150' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.default_markup_pct?.[0]).toBe(
        'Enter a percentage between 0 and 100',
      )
    }
  })

  it('gives the same guidance below 0 (previously a raw Zod default)', () => {
    const r = OnboardActivateSchema.safeParse({ ...base, default_markup_pct: '-5' })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.default_markup_pct?.[0]).toBe(
        'Enter a percentage between 0 and 100',
      )
    }
  })

  it('still accepts the boundaries 0 and 100', () => {
    expect(OnboardActivateSchema.safeParse({ ...base, default_markup_pct: '0' }).success).toBe(true)
    expect(OnboardActivateSchema.safeParse({ ...base, default_markup_pct: '100' }).success).toBe(true)
  })
})
