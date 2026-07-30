// Maps an activate-route validation key back to what the tradie saw in the
// wizard. Pure — extracted from app/onboard/page.tsx so it unit-tests without
// pulling in Clerk / next/navigation (same reason preflight-logic.ts exists).
//
// Why: /api/onboard/activate rejects by SCHEMA KEY, and the wizard printed that
// key straight into the banner — "Please fix: default_markup_pct: Must be 0–100"
// reads as a crash, not a form error. Worse, the reject lands on the review step
// where the offending input isn't rendered, so the inline <Field error=…> the
// wizard already supports never appeared and there was nothing to click.

/** Fields the wizard renders, with the on-screen label and owning step.
 *  Only keys whose humanised form would read wrong need an entry — everything
 *  else falls through to humaniseFieldKey, so a NEW schema field can never leak
 *  a raw column name into the banner. */
const FIELD_UI: Record<string, { label: string; step: 1 | 2 }> = {
  // Step 1 — trade, licence, brand
  trades: { label: 'Trade', step: 1 },
  state: { label: 'State', step: 1 },
  abn: { label: 'ABN', step: 1 },
  owner_mobile: { label: 'Mobile', step: 1 },
  website_url: { label: 'Website', step: 1 },
  logo_url: { label: 'Logo', step: 1 },
  contact_name: { label: 'Contact name', step: 1 },
  business_address: { label: 'Business address', step: 1 },
  licence_type: { label: 'Licence type', step: 1 },
  licence_number: { label: 'Licence number', step: 1 },
  licence_expiry: { label: 'Licence expiry', step: 1 },
  // Step 2 — pricing
  hourly_rate: { label: 'Hourly rate', step: 2 },
  call_out_minimum: { label: 'Call-out minimum', step: 2 },
  default_markup_pct: { label: 'Materials markup', step: 2 },
  apprentice_rate: { label: 'Apprentice rate', step: 2 },
  senior_rate: { label: 'Senior rate', step: 2 },
  after_hours_multiplier: { label: 'After-hours multiplier', step: 2 },
  min_labour_hours: { label: 'Minimum charge (hr)', step: 2 },
  risk_buffer_pct: { label: 'Risk buffer', step: 2 },
  painting_call_out_minimum: { label: 'Painting call-out minimum', step: 2 },
  painting_hourly_rate: { label: 'Painting hourly rate', step: 2 },
}

/** Fallback label for an unmapped key: drop the `_rate`/`_pct` suffix that only
 *  means something to the database, then sentence-case. `painting_walls_rate`
 *  → "Painting walls". Never returns a bare snake_case key. */
export function humaniseFieldKey(key: string): string {
  const words = key.replace(/_(rate|pct)$/, '').replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The label the tradie saw, for use in an error message. */
export function fieldLabel(key: string): string {
  return FIELD_UI[key]?.label ?? humaniseFieldKey(key)
}

/**
 * The line to show a tradie for a failed activation.
 *
 * /api/onboard/activate answers with a machine `error` code and, for the cases
 * it can explain, a human `message`. The wizard threw only `error`, so the 422
 * put the literal string "owner_user_id_unresolved" in the banner — the same
 * raw-identifier problem as the field-label mapping above, one layer up.
 */
export function activateErrorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Activation failed'
  const d = data as { error?: unknown; message?: unknown }
  if (typeof d.message === 'string' && d.message.trim()) return d.message
  if (typeof d.error === 'string' && d.error.trim()) return humaniseFieldKey(d.error)
  return 'Activation failed'
}

/** The earliest wizard step holding any of these rejected fields, or null when
 *  none of them are rendered by the wizard (nothing useful to jump to). */
export function stepForFields(keys: string[]): 1 | 2 | null {
  const steps = keys.map((k) => FIELD_UI[k]?.step).filter((s): s is 1 | 2 => !!s)
  return steps.length ? (Math.min(...steps) as 1 | 2) : null
}
