// Onboarding payload schema — shared between the wizard client and the
// /api/onboard/activate endpoint. Zod gives us field-level validation,
// type inference, and a single source of truth for what the form sends.

import { z } from 'zod'

// AU mobile in E.164 (+614xxxxxxxx) or local 04xx format
const auMobile = z
  .string()
  .trim()
  .regex(/^(\+?61\s?4\d{2}\s?\d{3}\s?\d{3}|0?4\d{2}\s?\d{3}\s?\d{3})$/, 'Enter a valid Australian mobile (04xx xxx xxx)')

/**
 * Normalise an AU mobile to E.164 (`+614xxxxxxxx`) — the format Supabase
 * Auth + Twilio both require. Accepts any of:
 *   "+61 412 345 678"  →  "+61412345678"
 *   "0412 345 678"     →  "+61412345678"
 *   "0412345678"       →  "+61412345678"
 *   "61412345678"      →  "+61412345678"
 *   "+61412345678"     →  "+61412345678" (no-op)
 * Throws if the input doesn't match the AU mobile shape.
 */
export function normaliseAuMobile(input: string): string {
  const digits = input.replace(/\s+/g, '').replace(/^\+/, '')
  // 04xxxxxxxx (10 digits starting with 0)
  if (/^04\d{8}$/.test(digits)) return `+61${digits.slice(1)}`
  // 614xxxxxxxx (11 digits starting with 61) — already E.164 minus the +
  if (/^614\d{8}$/.test(digits)) return `+${digits}`
  // 4xxxxxxxx (9 digits starting with 4) — missing country & leading 0
  if (/^4\d{8}$/.test(digits)) return `+61${digits}`
  throw new Error('Invalid AU mobile: must be 04xx xxx xxx or +61 4xx xxx xxx')
}

const positiveMoney = z.coerce.number().positive('Must be greater than 0')
const positivePct = z.coerce.number().min(0).max(100, 'Must be 0–100')

// Treat empty strings (from blank wizard inputs) as "not provided" so
// z.coerce.number() doesn't silently turn '' into 0 and trip floors like
// `.min(1)` on after_hours_multiplier. Applied to every *optional* number
// field below via `optionalNumber(...)`.
const emptyToUndef = (val: unknown) =>
  val === '' || val === null ? undefined : val
const optionalNumber = (schema: z.ZodTypeAny) =>
  z.preprocess(emptyToUndef, schema.optional())

export const OnboardActivateSchema = z.object({
  // ── Page 1: Account basics ──────────────────────────────────
  business_name: z.string().trim().min(2, 'Business name required').max(80),
  owner_first_name: z.string().trim().min(1, 'First name required').max(40),
  owner_last_name: z.string().trim().max(40).optional().or(z.literal('')),
  owner_email: z.string().trim().email('Enter a valid email').max(120),
  owner_mobile: auMobile,
  // owner_user_id passed by the wizard after Supabase Auth sign up
  owner_user_id: z.string().uuid().optional().or(z.literal('')),

  // ── Page 2: Trade & licence ────────────────────────────────
  trade: z.enum(['electrical', 'plumbing']),
  state: z.enum(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']),
  abn: z.string().trim().max(20).optional().or(z.literal('')),
  licence_type: z.string().trim().max(20).optional().or(z.literal('')),
  licence_number: z.string().trim().max(40).optional().or(z.literal('')),
  licence_expiry: z.string().optional().or(z.literal('')),  // ISO date

  // ── Page 3: Pricing (required) ─────────────────────────────
  hourly_rate: positiveMoney,
  call_out_minimum: positiveMoney,
  default_markup_pct: positivePct,

  // ── Page 3: Pricing (advanced — all optional) ──────────────
  apprentice_rate: optionalNumber(z.coerce.number().nonnegative()),
  senior_rate: optionalNumber(z.coerce.number().nonnegative()),
  after_hours_multiplier: optionalNumber(z.coerce.number().min(1).max(3)),
  min_labour_hours: optionalNumber(z.coerce.number().min(0).max(8)),
  risk_buffer_pct: optionalNumber(positivePct),
  gst_registered: z.boolean().optional(),

  // ── SMS-initiated onboarding (optional) ────────────────────
  // Present when the tradie reached /onboard via the SMS magic-link
  // flow. Activate endpoint passes this to markIntentUsed() to flip
  // the tradie_signup_intents row to consumed and back-link the
  // originating sms_conversations row to the new tenant. Web-only
  // signups omit this field entirely.
  intent_token: z
    .string()
    .trim()
    .min(4)
    .max(16)
    .optional()
    .or(z.literal('')),
})

export type OnboardActivatePayload = z.infer<typeof OnboardActivateSchema>

// Per-state licence body display labels (helpful for the form's licence_type dropdown)
export const LICENCE_BODIES: Record<string, { electrical: string; plumbing: string }> = {
  NSW: { electrical: 'NECA NSW',    plumbing: 'NSW Fair Trading' },
  VIC: { electrical: 'ESV',         plumbing: 'VBA' },
  QLD: { electrical: 'ESO QLD',     plumbing: 'QBCC' },
  WA:  { electrical: 'EnergySafety',plumbing: 'PLC WA' },
  SA:  { electrical: 'OTR SA',      plumbing: 'OTR SA' },
  TAS: { electrical: 'CBOS',        plumbing: 'CBOS' },
  ACT: { electrical: 'ACT ESA',     plumbing: 'Access Canberra' },
  NT:  { electrical: 'NT Electrical Workers Licensing', plumbing: 'NT Plumbers and Drainers Licensing' },
}

// Service-defaults helper — gives sensible per-trade defaults that the
// activate endpoint applies when the tradie left advanced fields blank.
export function defaultsForTrade(trade: 'electrical' | 'plumbing') {
  if (trade === 'plumbing') {
    return {
      apprentice_rate: 65,
      senior_rate: 160,
      after_hours_multiplier: 1.5,
      min_labour_hours: 1.5,
      risk_buffer_pct: 15,
    }
  }
  // electrical defaults
  return {
    apprentice_rate: 65,
    senior_rate: 160,
    after_hours_multiplier: 1.5,
    min_labour_hours: 2,
    risk_buffer_pct: 15,
  }
}
