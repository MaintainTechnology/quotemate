// ════════════════════════════════════════════════════════════════════
// Customer memory — keyed by phone number across voice + SMS.
//
// Two functions:
//   findOrCreateCustomer(phone, channel)
//     Looked up at every inbound. Creates a stub if no row exists yet.
//     Returns the full customer profile.
//
//   updateCustomerFromIntake(customerId, intake, channel)
//     Called after Opus structures the intake. Writes-back name, suburb,
//     address, email if present. Bumps last_contacted_at + total_quotes.
//     If a field is already set on the customer row, it's only overwritten
//     when the new value is materially different (so a tradie's edit isn't
//     wiped by a stale Opus extraction).
//
// Both are idempotent. Both fail-soft — log + return null/no-op rather
// than throw, so a customer-memory write hiccup never breaks the quote
// pipeline.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type CustomerProfile = {
  id: string
  phone_number: string
  first_name: string | null
  full_name: string | null
  email: string | null
  address: string | null
  suburb: string | null
  notes: string | null
  preferred_channel: 'voice' | 'sms' | null
  total_quotes: number
  total_bookings: number
  first_contacted_at: string
  last_contacted_at: string
}

/**
 * Look up the customer for this phone number. Create a stub if missing.
 * Returns null only on database error (rare; fail-soft so callers keep working).
 */
export async function findOrCreateCustomer(
  phoneNumber: string,
  channel: 'voice' | 'sms',
): Promise<CustomerProfile | null> {
  if (!phoneNumber) return null

  // Try to find existing.
  const { data: existing, error: lookupErr } = await supabase
    .from('customers')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle()

  if (lookupErr) {
    console.error('[customers] lookup failed', { phoneNumber, err: lookupErr.message })
    return null
  }

  if (existing) {
    // Bump last_contacted_at + preferred_channel (latest channel used wins).
    const { error: bumpErr } = await supabase
      .from('customers')
      .update({
        last_contacted_at: new Date().toISOString(),
        preferred_channel: channel,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (bumpErr) {
      console.error('[customers] bump last_contacted_at failed', { id: existing.id, err: bumpErr.message })
    }
    return existing as CustomerProfile
  }

  // Create stub.
  const { data: created, error: createErr } = await supabase
    .from('customers')
    .insert({
      phone_number: phoneNumber,
      preferred_channel: channel,
    })
    .select()
    .single()

  if (createErr || !created) {
    // Race-condition fallback: another inbound may have created the row in
    // parallel (unique constraint on phone_number triggers 23505). Re-fetch.
    if (createErr?.code === '23505') {
      const { data: raced } = await supabase
        .from('customers')
        .select('*')
        .eq('phone_number', phoneNumber)
        .maybeSingle()
      return (raced as CustomerProfile) ?? null
    }
    console.error('[customers] create failed', { phoneNumber, err: createErr?.message })
    return null
  }

  return created as CustomerProfile
}

/**
 * Write extracted intake fields back onto the customer row.
 * Called after /api/intake/structure has Opus-extracted name + suburb + etc.
 * Only fills in fields that are blank on the customer OR materially changed.
 *
 * Preserves tradie-set values: if the customer row has a non-null value for
 * a field, we only overwrite when the new value is non-null AND different.
 * (Empty / placeholder Opus extractions are ignored.)
 */
export async function updateCustomerFromIntake(opts: {
  customerId: string | null
  intake: {
    caller?: { name?: string | null; email?: string | null } | null
    address?: string | null
    suburb?: string | null
  }
}): Promise<void> {
  if (!opts.customerId) return

  const { data: cust, error: fetchErr } = await supabase
    .from('customers')
    .select('*')
    .eq('id', opts.customerId)
    .maybeSingle()

  if (fetchErr || !cust) {
    console.error('[customers] fetch for update failed', { customerId: opts.customerId, err: fetchErr?.message })
    return
  }

  const newFullName = (opts.intake.caller?.name ?? '').trim() || null
  const newFirstName = newFullName ? newFullName.split(/\s+/)[0] : null
  const newEmail = (opts.intake.caller?.email ?? '').trim() || null
  const newAddress = (opts.intake.address ?? '').trim() || null
  const newSuburb = (opts.intake.suburb ?? '').trim() || null

  const update: Record<string, unknown> = {
    last_contacted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    total_quotes: (cust.total_quotes ?? 0) + 1,
  }

  // Only overwrite when a meaningful new value differs from the stored one.
  // Empty / null new values never overwrite a stored value.
  if (newFullName && newFullName !== cust.full_name) update.full_name = newFullName
  if (newFirstName && newFirstName !== cust.first_name) update.first_name = newFirstName
  if (newEmail && newEmail !== cust.email) update.email = newEmail
  if (newAddress && newAddress !== cust.address) update.address = newAddress
  if (newSuburb && newSuburb !== cust.suburb) update.suburb = newSuburb

  const { error: updErr } = await supabase
    .from('customers')
    .update(update)
    .eq('id', opts.customerId)

  if (updErr) {
    console.error('[customers] update from intake failed', { customerId: opts.customerId, err: updErr.message })
  }
}

/**
 * Render a compact "KNOWN CUSTOMER" block for the dialog system prompt.
 * Returns null if there's nothing useful to inject (stub customer with no
 * fields populated).
 *
 * Personalised re-engagement design:
 *   - Greeting USES the stored first_name when known ("Welcome back Jeph,
 *     what can I help you with this time?"). Falls back to neutral wording
 *     only when first_name is not on file.
 *   - If first_name is known, skip the "what's your first name?" question
 *     silently — we already have it.
 *   - If suburb is known, REPLACE the standard "what suburb?" question with
 *     an address-confirmation handshake ("still at the Bondi place, right?").
 *   - On correction ("Coogee now"), the new value flows through to the
 *     post-intake updateCustomerFromIntake() and overwrites the row.
 *
 * NOTE on phone sharing: this design assumes the phone number maps to a
 * single household member. If a flatmate/partner uses the same number,
 * the welcome-back will address them by the wrong name. That's an
 * accepted tradeoff for the personalisation per product direction.
 */
export function formatCustomerContext(c: CustomerProfile | null): string | null {
  if (!c) return null

  // CRITICAL: only inject the KNOWN CUSTOMER MEMORY block when we have
  // ACTUAL contact details to skip questions for (name / suburb / address
  // / email). total_quotes alone is metadata — including it on its own
  // misleads Haiku into hallucinating "we know this customer's address"
  // and producing phantom address-confirmation handshakes ("still at the
  // same place you've quoted with us before?") when no address is on file.
  const contactKnown: string[] = []
  if (c.first_name) contactKnown.push(`first_name: ${c.first_name}`)
  if (c.full_name && c.full_name !== c.first_name) contactKnown.push(`full_name: ${c.full_name}`)
  if (c.suburb) contactKnown.push(`suburb: ${c.suburb}`)
  if (c.address) contactKnown.push(`address: ${c.address}`)
  if (c.email) contactKnown.push(`email: ${c.email}`)

  if (contactKnown.length === 0) return null

  // Now safe to also note total_quotes for context — but ONLY because
  // we already have at least one contact field above.
  const known = [...contactKnown]
  if (c.total_quotes > 0) known.push(`total_quotes_with_us: ${c.total_quotes}`)

  const suburbExample = c.suburb ?? 'Bondi'
  const nameExample = c.first_name ?? 'Sam'

  // Build the GREETING section conditionally — when first_name is on
  // file, instruct Haiku to use it in the welcome-back; otherwise keep
  // the neutral "Welcome back" wording.
  const greetingSection = c.first_name
    ? [
        `GREETING: use the customer's first name in the welcome-back line.`,
        `  ✓ "Welcome back ${nameExample}, what can I help you with this time?"`,
        `  ✓ "G'day again ${nameExample}, what electrical work did you need this time?"`,
        `  ✓ "Hey ${nameExample}, good to hear from you again. What's the new job?"`,
        `Avoid the formal first-time intro ("thanks for messaging QuoteMate, I'm`,
        `the AI quoting assistant...") — they already know us. Stay warm and brief.`,
      ]
    : [
        'GREETING: keep it neutral (we have no first_name on file yet).',
        '  ✓ "Welcome back, what can I help you with this time?"',
        '  ✓ "G\'day again, what electrical work did you need this time?"',
        'Do NOT do the full first-time intro.',
      ]

  return [
    'KNOWN CUSTOMER MEMORY — apply re-engagement using stored details.',
    '',
    ...greetingSection,
    '',
    'NAME: if first_name is in the KNOWN FIELDS list below, treat it as',
    'already captured. DO NOT ask "what\'s your first name?" again. Use it',
    `naturally in acknowledgements (e.g. "Cheers ${nameExample}, ...").`,
    '',
    'SUBURB: if suburb is in the KNOWN FIELDS list below, REPLACE the',
    'standard "and what suburb is the job in?" question with an address-',
    'confirmation handshake using the EXACT stored suburb value:',
    `  ✓ "Cheers ${nameExample}, still at the ${suburbExample} place, right?"`,
    `  ✓ "Got it. Still at the same ${suburbExample} spot?"`,
    'If the customer affirms ("yep", "still there"), use the stored',
    'suburb and move to the next missing field — do NOT ask again.',
    'If they correct ("Coogee now" / "this job\'s at my mum\'s in Penrith"),',
    'use the new suburb for this conversation. The post-intake write-back',
    'will reconcile the customers row.',
    '',
    'KNOWN FIELDS (do NOT re-ask):',
    ...known.map(k => `  - ${k}`),
  ].join('\n')
}
