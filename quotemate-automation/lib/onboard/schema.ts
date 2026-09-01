// Onboarding payload schema — shared between the wizard client and the
// /api/onboard/activate endpoint. Zod gives us field-level validation,
// type inference, and a single source of truth for what the form sends.

import { z } from 'zod'
import { AvailabilitySchema } from '@/lib/quote/availability'
import { MAX_RATE_PER_M2 } from '@/lib/roofing/rate-card-overlay'

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

const positiveMoney = z.coerce.number().positive('Enter an amount above $0')
// `.min(0)` carried no message, so a negative percentage fell through to Zod's
// default ("Number must be greater than or equal to 0") — a validator string,
// not something a tradie can act on. Both bounds now read as form guidance.
const positivePct = z.coerce
  .number()
  .min(0, 'Enter a percentage between 0 and 100')
  .max(100, 'Enter a percentage between 0 and 100')

// Treat empty strings (from blank wizard inputs) as "not provided" so
// z.coerce.number() doesn't silently turn '' into 0 and trip floors like
// `.min(1)` on after_hours_multiplier. Applied to every *optional* number
// field below via `optionalNumber(...)`.
const emptyToUndef = (val: unknown) =>
  val === null || (typeof val === 'string' && val.trim() === '') ? undefined : val
const optionalNumber = (schema: z.ZodTypeAny) =>
  z.preprocess(emptyToUndef, schema.optional())

export const OnboardActivateSchema = z.object({
  // ── Page 1: Account basics ──────────────────────────────────
  business_name: z.string().trim().min(2, 'Business name required').max(80),
  owner_first_name: z.string().trim().min(1, 'First name required').max(40),
  owner_last_name: z.string().trim().max(40).optional().or(z.literal('')),
  owner_email: z.string().trim().email('Enter a valid email').max(120),
  // Optional (user clarification 2026-07-17): normally carried verified from
  // /signup, but a mobile-less activation must succeed — the welcome SMS is
  // skipped and tenants.owner_mobile stores null (migration 176 dropped the
  // NOT NULL). A non-empty value must still be a valid AU mobile.
  owner_mobile: auMobile.optional().or(z.literal('')),
  // Backward-compatible client assertions only. The activate route verifies
  // them against the bearer and derives the ownership values server-side.
  // New clients omit both ids.
  owner_user_id: z.string().uuid().optional().or(z.literal('')),
  // Clerk ids are `user_…` strings, not UUIDs. A matching value is tolerated
  // for already-shipped clients; it is never trusted as the insert owner.
  clerk_user_id: z.string().optional().or(z.literal('')),

  // ── Page 2: Trade & licence ────────────────────────────────
  // Multi-trade onboarding: a tradie can pick any combination of the
  // supported trades (e.g. electrical + plumbing + painting + roofing).
  // min(1) so every tenant has at least one trade; max(4) so we don't
  // accidentally accept stale / duplicated strings from a buggy wizard build.
  trades: z
    .array(z.enum(['electrical', 'plumbing', 'painting', 'roofing']))
    .min(1, 'Pick at least one trade')
    .max(4, 'Pick from electrical, plumbing, painting and roofing'),
  // Optional (user clarification 2026-07-17): when absent the tenant stores
  // null and the booking timezone falls back to Australia/Sydney
  // (tzForState already handles null). A non-empty value must be a real state.
  state: z.enum(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']).optional().or(z.literal('')),
  abn: z.string().trim().max(20).optional().or(z.literal('')),
  licence_type: z.string().trim().max(20).optional().or(z.literal('')),
  licence_number: z.string().trim().max(40).optional().or(z.literal('')),
  licence_expiry: z.string().optional().or(z.literal('')),  // ISO date

  // ── Brand / identity (shown on the customer quote letterhead) ──
  // business_name / owner_email / owner_mobile above already cover the
  // quote's name + email + phone. These add the remaining sample-quote
  // fields: a contact-person name, website, address, and the uploaded
  // logo's public URL + storage path. Logo is optional on every channel — a
  // tenant without one gets the business-initials monogram (lib/brand/monogram)
  // on the quote letterhead + PDF until they upload one from the dashboard.
  contact_name: z.string().trim().max(80).optional().or(z.literal('')),
  website_url: z
    .string()
    .trim()
    .max(200)
    .refine(
      (v) => v === '' || /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i.test(v),
      'Enter a valid website (e.g. rooroofing.com.au)',
    )
    .optional()
    .or(z.literal('')),
  business_address: z.string().trim().max(200).optional().or(z.literal('')),
  logo_url: z.string().trim().max(500).optional().or(z.literal('')),
  logo_path: z.string().trim().max(300).optional().or(z.literal('')),

  // ── Page 3: Pricing — labour (electrical / plumbing) ───────
  // Required only when a labour trade is selected — enforced by the
  // superRefine below, not here, so a painting-only tenant (who prices
  // from a $/m² rate card) can leave them blank. positive bounds still
  // apply whenever a value IS supplied.
  hourly_rate: optionalNumber(positiveMoney),
  call_out_minimum: optionalNumber(positiveMoney),
  default_markup_pct: optionalNumber(positivePct),

  // ── Page 3: Pricing — painting rate card ($/unit, ex-GST) ──
  // The per-m² (per-lm for trim) rates a painting tenant quotes from.
  // All optional: a blank field falls back to DEFAULT_PAINTING_RATE_CARD
  // (lib/painting/pricing.ts). The wizard pre-fills them with the AU
  // defaults so a painter lands ready and can adjust. Persisted to
  // pricing_book.overlays.painting_rate_card by the activate route.
  painting_walls_rate: optionalNumber(z.coerce.number().positive().max(200)),
  painting_ceilings_rate: optionalNumber(z.coerce.number().positive().max(200)),
  painting_trim_rate: optionalNumber(z.coerce.number().positive().max(200)),
  painting_exterior_rate: optionalNumber(z.coerce.number().positive().max(200)),
  painting_call_out_minimum: optionalNumber(z.coerce.number().min(0).max(5000)),
  // Painting pricing model. 'sqm' (default) prices from the per-m² rate card
  // above; 'hourly' charges painting_hourly_rate × labour hours (derived from
  // area). Both persist to pricing_book.overlays.painting_rate_card.
  painting_pricing_model: z.enum(['sqm', 'hourly']).optional(),
  painting_hourly_rate: optionalNumber(z.coerce.number().positive().max(2000)),

  // ── Page 3: Pricing — roofing rate card ($/m² per material) ──
  // The per-material re-roof rates a roofing tenant quotes from. All
  // optional: a blank field falls back to DEFAULT_ROOFING_RATE_CARD
  // (lib/roofing/pricing.ts). Bounds mirror the dashboard overlay
  // validator (lib/roofing/rate-card-overlay.ts): strictly positive,
  // ≤ $500/m² — so a 0 "never auto-quoted" cement-sheet default can only
  // be expressed by leaving the field blank. Persisted to
  // pricing_book.overlays.roofing_rate_card by the activate route.
  roofing_corrugated_rate: optionalNumber(z.coerce.number().positive().max(MAX_RATE_PER_M2)),
  roofing_trimdek_rate: optionalNumber(z.coerce.number().positive().max(MAX_RATE_PER_M2)),
  roofing_spandek_rate: optionalNumber(z.coerce.number().positive().max(MAX_RATE_PER_M2)),
  roofing_kliplok_rate: optionalNumber(z.coerce.number().positive().max(MAX_RATE_PER_M2)),
  roofing_concrete_tile_rate: optionalNumber(z.coerce.number().positive().max(MAX_RATE_PER_M2)),
  roofing_terracotta_tile_rate: optionalNumber(z.coerce.number().positive().max(MAX_RATE_PER_M2)),
  roofing_cement_sheet_rate: optionalNumber(z.coerce.number().positive().max(MAX_RATE_PER_M2)),

  // ── Page 3: Pricing (advanced — all optional) ──────────────
  apprentice_rate: optionalNumber(z.coerce.number().nonnegative()),
  senior_rate: optionalNumber(z.coerce.number().nonnegative()),
  after_hours_multiplier: optionalNumber(z.coerce.number().min(1).max(3)),
  min_labour_hours: optionalNumber(z.coerce.number().min(0).max(8)),
  risk_buffer_pct: optionalNumber(positivePct),
  gst_registered: z.boolean().optional(),

  // ── Default schedule availability (optional — pre-filled in the wizard) ──
  // The tradie's recurring weekly working hours. Optional: when omitted the
  // activate route stamps a state-derived default (Mon–Fri 07:00–15:00) so
  // every new tenant lands bookable. Migration 147.
  default_availability: AvailabilitySchema.optional(),

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

  // ── Invitation code (required by the Step-0 gate) ──────────────
  // Carried from the /onboard Step-0 gate (web) or the SMS JOIN flow.
  // Consumed once at activate via consumeInvitationCode().
  invitation_code: z.string().trim().min(1, 'Invitation code required').max(60),
})
  .superRefine((data, ctx) => {
    // Labour trades (electrical / plumbing) price by the hour, so a tenant
    // that selects either must supply the three core labour rates — they
    // drive that trade's estimator. Painting and roofing price from a rate
    // card instead, so a painting/roofing-only tenant is exempt (the labour
    // fields stay blank and the rate cards fall back to sensible defaults).
    const hasLabourTrade = data.trades.some(
      (t) => t === 'electrical' || t === 'plumbing',
    )
    if (hasLabourTrade) {
      for (const field of ['hourly_rate', 'call_out_minimum', 'default_markup_pct'] as const) {
        if (data[field] === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: 'Required for electrical / plumbing pricing.',
          })
        }
      }
    }
  })

export type OnboardActivatePayload = z.infer<typeof OnboardActivateSchema>

// Per-state licence body display labels (helpful for the form's licence_type dropdown).
// Painting is largely UNLICENSED across AU — QLD (QBCC, jobs over ~$3,300) is the
// notable exception — so the painting label is empty for most states. The key still
// being PRESENT is what lets hasLicenceSchema('painting') pass: painting is a
// licence-OPTIONAL trade, not a licence-missing one.
//
// Roofing sits with the general BUILDING regulator in each state (a re-roof is
// building work; metal roofing also pulls in the plumbing regulator in some
// states). The label is only a pre-fill suggestion — the wizard's licence field
// is free text, so a roof plumber can type their actual regulator over it.
export const LICENCE_BODIES: Record<
  string,
  { electrical: string; plumbing: string; painting: string; roofing: string }
> = {
  NSW: { electrical: 'NECA NSW',    plumbing: 'NSW Fair Trading',  painting: '',      roofing: 'NSW Fair Trading' },
  VIC: { electrical: 'ESV',         plumbing: 'VBA',               painting: '',      roofing: 'VBA' },
  QLD: { electrical: 'ESO QLD',     plumbing: 'QBCC',              painting: 'QBCC',  roofing: 'QBCC' },
  WA:  { electrical: 'EnergySafety',plumbing: 'PLC WA',            painting: '',      roofing: 'Building Services Board WA' },
  SA:  { electrical: 'OTR SA',      plumbing: 'OTR SA',            painting: '',      roofing: 'CBS SA' },
  TAS: { electrical: 'CBOS',        plumbing: 'CBOS',              painting: '',      roofing: 'CBOS' },
  ACT: { electrical: 'ACT ESA',     plumbing: 'Access Canberra',   painting: '',      roofing: 'Access Canberra' },
  NT:  { electrical: 'NT Electrical Workers Licensing', plumbing: 'NT Plumbers and Drainers Licensing', painting: '', roofing: 'NT Building Practitioners Board' },
}

// Trades the self-serve onboarding pipeline fully supports today. The
// OnboardActivateSchema.trades enum above mirrors this list. Kept as a
// separate exported constant so the trade-readiness gate
// (lib/onboard/trade-readiness.ts) has a single source of truth for
// "does onboarding have pricing defaults + intake support for this trade".
export const ONBOARDING_TRADES = ['electrical', 'plumbing', 'painting', 'roofing'] as const

/** True when defaultsForTrade() + the onboarding schema support this trade. */
export function hasOnboardingPricingDefaults(trade: string): boolean {
  return (ONBOARDING_TRADES as readonly string[]).includes(trade)
}

/** True when a per-state licence body label exists for this trade. */
export function hasLicenceSchema(trade: string): boolean {
  return Object.values(LICENCE_BODIES).some((bodies) => trade in bodies)
}

// Service-defaults helper — gives sensible per-trade defaults that the
// activate endpoint applies when the tradie left advanced fields blank.
export function defaultsForTrade(trade: (typeof ONBOARDING_TRADES)[number]) {
  if (trade === 'roofing') {
    // Roofing prices from a deterministic per-m² rate card driven by the
    // measured roof geometry (lib/roofing/pricing.ts) — hourly labour never
    // enters the money path. These only populate the (unused) labour columns
    // of the roofing pricing_book row so it satisfies the table's shape; the
    // real levers live in pricing_book.overlays.roofing_rate_card, editable
    // from the dashboard's roofing rates tab.
    return {
      apprentice_rate: 65,
      senior_rate: 160,
      after_hours_multiplier: 1.5,
      min_labour_hours: 0,
      risk_buffer_pct: 15,
    }
  }
  if (trade === 'plumbing') {
    return {
      apprentice_rate: 65,
      senior_rate: 160,
      after_hours_multiplier: 1.5,
      min_labour_hours: 1.5,
      risk_buffer_pct: 15,
    }
  }
  if (trade === 'painting') {
    // Painting prices from a $/m² rate card, not labour hours — these
    // labour defaults only populate the (unused) labour columns of the
    // painting pricing_book row so it satisfies the table's shape. The
    // real painting levers live in pricing_book.overlays.painting_rate_card.
    return {
      apprentice_rate: 55,
      senior_rate: 75,
      after_hours_multiplier: 1.5,
      min_labour_hours: 0,
      risk_buffer_pct: 10,
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
