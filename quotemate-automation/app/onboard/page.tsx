// /onboard — Maintain design system. 3-step wizard after sign up.
//
// Step 1: Trade + state + mobile + optional licence
// Step 2: Pricing essentials + collapsible advanced
// Step 3: Review + Activate

'use client'

import { Suspense, useState, useEffect, useRef, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth, useUser } from '@clerk/nextjs'
import { LICENCE_BODIES, normaliseAuMobile } from '@/lib/onboard/schema'
import { fieldLabel, stepForFields, activateErrorMessage } from '@/lib/onboard/field-labels'
import { identityFromClerkUser } from '@/lib/onboard/clerk-identity'
import { businessInitials } from '@/lib/brand/monogram'
import { DEFAULT_PAINTING_RATE_CARD } from '@/lib/painting/pricing'
import { DEFAULT_ROOFING_RATE_CARD } from '@/lib/roofing/pricing'
import {
  defaultAvailability,
  tzForState,
  type WeeklyAvailability,
} from '@/lib/quote/availability'
import { AvailabilityEditor } from '@/app/_components/AvailabilityEditor'
import { AddressAutocomplete } from '@/app/_components/AddressAutocomplete'
import { Field, INPUT, ErrorBanner, Arrow, RequiredLegend } from '../signup/page'
import { FunnelShell } from '@/app/_components/funnel-shell'

type Trade = 'electrical' | 'plumbing' | 'painting' | 'roofing'

type FormState = {
  business_name: string
  owner_first_name: string
  owner_email: string
  owner_user_id: string
  /** Clerk user id (user_…) for Clerk-created signups. The activate route
   *  stamps it onto tenants.clerk_user_id so the dual-auth resolver finds the
   *  tenant. Empty for legacy Supabase signups (which use owner_user_id). */
  clerk_user_id: string
  owner_mobile: string
  /** Multi-select. At least one trade is required. A tradie who holds
   *  both an electrical and a plumbing licence can pick both — the
   *  catalogue, pricing book, and Vapi prompt expand accordingly. */
  trades: Trade[]
  state: 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT' | ''
  abn: string
  licence_type: string
  licence_number: string
  licence_expiry: string
  // Brand / identity — shown on the customer quote letterhead. Logo is
  // required; the rest are optional. business_name/owner_email/owner_mobile
  // (collected at /signup + Step 1) cover the quote's name/email/phone.
  contact_name: string
  website_url: string
  business_address: string
  logo_url: string
  logo_path: string
  hourly_rate: string
  call_out_minimum: string
  default_markup_pct: string
  apprentice_rate: string
  senior_rate: string
  after_hours_multiplier: string
  min_labour_hours: string
  risk_buffer_pct: string
  // Painting rate card ($/unit, ex-GST). Only meaningful when the
  // 'painting' trade is selected; pre-filled with the AU defaults so a
  // painter can accept or adjust. Sent to the activate route which writes
  // them into pricing_book.overlays.painting_rate_card.
  painting_walls_rate: string
  painting_ceilings_rate: string
  painting_trim_rate: string
  painting_exterior_rate: string
  painting_call_out_minimum: string
  // Painting pricing model: 'sqm' = the per-m² rate card above; 'hourly' =
  // charge by labour time at painting_hourly_rate. Drives which fields Step 2
  // shows and what the activate route writes into the rate-card overlay.
  painting_pricing_model: 'sqm' | 'hourly'
  painting_hourly_rate: string
  // Roofing rate card ($/m² per material, ex-GST). Only meaningful when the
  // 'roofing' trade is selected; pre-filled with the AU defaults (cement
  // sheet stays blank — its 0 default means "never auto-quoted" and 0 is not
  // an accepted override). Sent to the activate route which writes them into
  // pricing_book.overlays.roofing_rate_card — the same overlay the dashboard
  // Roof-rates tab edits.
  roofing_corrugated_rate: string
  roofing_trimdek_rate: string
  roofing_spandek_rate: string
  roofing_kliplok_rate: string
  roofing_concrete_tile_rate: string
  roofing_terracotta_tile_rate: string
  roofing_cement_sheet_rate: string
  gst_registered: boolean
  // Default schedule availability (migration 147). Pre-filled with the
  // Mon–Fri default; the tradie can edit or skip it. Optional in the wizard.
  default_availability: WeeklyAvailability
}

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const

// The trades the wizard can offer. Each is still gated at render time by
// tradeAvailable() (/api/onboard/trades readiness), so a trade only appears
// once its whole quote pipeline is wired.
const TRADE_OPTIONS: ReadonlyArray<{ value: Trade; label: string }> = [
  { value: 'electrical', label: 'Electrical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'painting', label: 'Painting' },
  { value: 'roofing', label: 'Roofing' },
]

// The seven $/m² roofing material rates the pricing step exposes — the same
// subset the dashboard Roof-rates editor edits (labels mirror
// app/dashboard/_components/RoofRatesEditor.tsx). Defaults come from
// DEFAULT_ROOFING_RATE_CARD so the hints can never drift from the engine.
const ROOFING_RATE_FIELDS = [
  ['roofing_corrugated_rate', 'Colorbond Corrugated', DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_corrugated],
  ['roofing_trimdek_rate', 'Colorbond Trimdek', DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_trimdek],
  ['roofing_spandek_rate', 'Colorbond Spandek', DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_spandek],
  ['roofing_kliplok_rate', 'Colorbond Klip-Lok 700', DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_kliplok],
  ['roofing_concrete_tile_rate', 'Concrete tile', DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.concrete_tile],
  ['roofing_terracotta_tile_rate', 'Terracotta tile', DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.terracotta_tile],
  ['roofing_cement_sheet_rate', 'Cement sheet (asbestos-suspect)', DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.cement_sheet],
] as const

// True when the tradie moved any roofing rate off its shipped default —
// a blank field falls back to the default, so blank never counts as custom.
function roofingRatesCustomised(form: FormState): boolean {
  return ROOFING_RATE_FIELDS.some(([key, , def]) => {
    const v = form[key].trim()
    if (v === '') return false
    return Number(v) !== def
  })
}

const STEP_META = [
  { num: '02', label: 'Trade & licence', subtitle: 'What you do, where, optional regulatory bits.' },
  { num: '03', label: 'Your pricing',    subtitle: 'Rates for the trades you picked. Anything optional has a sensible default.' },
  { num: '04', label: 'Review & activate', subtitle: 'One last look, then we provision your AI line.' },
] as const


// Next.js 16 disallows prerendering pages whose default export reads
// useSearchParams() without a Suspense boundary. The wizard reads
// ?intent, ?owner_mobile, ?tenant, plus the carry-over identity fields
// from /auth/callback — all request-time only. Inner component owns
// that logic; this wrapper provides the boundary.
export default function OnboardWizard() {
  return (
    <Suspense fallback={null}>
      <OnboardWizardInner />
    </Suspense>
  )
}

function OnboardWizardInner() {
  const router = useRouter()
  const params = useSearchParams()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Licence details collapse — defaults to hidden so tradies see a clean
  // Step 1 with only the truly required fields (mobile + trade + state).
  // Anyone with a licence number can click to expand and fill it in.
  const [showLicence, setShowLicence] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  // Mobile lock — set when the tradie's mobile has already been
  // verified before reaching the wizard. Two upstream sources:
  //
  //   1. SMS-initiated path: tradie texted the shared QuoteMax
  //      number, mobile proven by physical possession. intent token
  //      is present; flipped on activate via markIntentUsed.
  //
  //   2. Web-initiated path: tradie entered mobile on /signup, got a
  //      6-digit OTP via Twilio, typed it into /signup/verify. No
  //      intent token, but owner_mobile is in the URL — Supabase has
  //      phone_confirmed_at set, so we know it's real.
  //
  // Either case → the trade step doesn't re-ask for the mobile.
  //
  // "Carried over" only counts when the param actually parses as an AU
  // mobile — a mangled URL (unencoded '+', truncation) must NOT hide the
  // field, or the tradie is left with an invisible dead-end: activation
  // 400s on owner_mobile with the input (and its inline error) unmounted.
  const intentToken = params.get('intent') ?? ''
  const mobileFromUpstream = params.get('owner_mobile') ?? ''
  const mobileLocked = (() => {
    if (!mobileFromUpstream) return false
    try {
      normaliseAuMobile(mobileFromUpstream)
      return true
    } catch {
      return false
    }
  })()

  // Invitation code. Web tradies type it here at the gate; SMS tradies
  // arrive with ?code=<code> pre-filled + locked (validated upstream).
  const codeFromUpstream = params.get('code') ?? ''
  const codeLocked = !!codeFromUpstream
  const [invitationCode, setInvitationCode] = useState(codeFromUpstream)
  const [codeAccepted, setCodeAccepted] = useState(false)
  const [codeChecking, setCodeChecking] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [codeNote, setCodeNote] = useState<string | null>(null)

  // Trade-readiness gate (spec A4): which trades the quote pipeline actually
  // supports. null = not loaded yet (show the pilot defaults).
  const [onboardableTrades, setOnboardableTrades] = useState<string[] | null>(null)

  const [form, setForm] = useState<FormState>({
    business_name: '',
    owner_first_name: '',
    owner_email: '',
    owner_user_id: '',
    clerk_user_id: '',
    owner_mobile: '',
    trades: [],
    state: '',
    abn: '',
    licence_type: '',
    licence_number: '',
    licence_expiry: '',
    contact_name: '',
    website_url: '',
    business_address: '',
    logo_url: '',
    logo_path: '',
    hourly_rate: '',
    call_out_minimum: '',
    default_markup_pct: '',
    apprentice_rate: '',
    senior_rate: '',
    after_hours_multiplier: '',
    min_labour_hours: '',
    risk_buffer_pct: '',
    // Pre-fill painting rates with the AU defaults so a painter lands ready.
    painting_walls_rate: String(DEFAULT_PAINTING_RATE_CARD.rate_per_unit.walls),
    painting_ceilings_rate: String(DEFAULT_PAINTING_RATE_CARD.rate_per_unit.ceilings),
    painting_trim_rate: String(DEFAULT_PAINTING_RATE_CARD.rate_per_unit.trim),
    painting_exterior_rate: String(DEFAULT_PAINTING_RATE_CARD.rate_per_unit.exterior),
    painting_call_out_minimum: String(DEFAULT_PAINTING_RATE_CARD.call_out_minimum_ex_gst ?? 450),
    painting_pricing_model: 'sqm',
    painting_hourly_rate: String(DEFAULT_PAINTING_RATE_CARD.hourly_rate ?? 85),
    // Pre-fill roofing rates with the AU defaults so a roofer lands ready.
    // Cement sheet stays blank: its default is $0 ("never auto-quoted").
    roofing_corrugated_rate: String(DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_corrugated),
    roofing_trimdek_rate: String(DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_trimdek),
    roofing_spandek_rate: String(DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_spandek),
    roofing_kliplok_rate: String(DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.colorbond_kliplok),
    roofing_concrete_tile_rate: String(DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.concrete_tile),
    roofing_terracotta_tile_rate: String(DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2.terracotta_tile),
    roofing_cement_sheet_rate: '',
    gst_registered: true,
    default_availability: defaultAvailability(),
  })

  // Clerk session id — the fallback for a Clerk signup that reached /onboard
  // without the clerk_user_id URL param (e.g. a returning Clerk user with no
  // tenant yet). Stamped into the form once Clerk hydrates, unless already set.
  const { userId: clerkSessionUserId } = useAuth()
  useEffect(() => {
    if (!clerkSessionUserId) return
    setForm((prev) => (prev.clerk_user_id ? prev : { ...prev, clerk_user_id: clerkSessionUserId }))
  }, [clerkSessionUserId])

  // Clerk identity backfill — the Clerk half of the Supabase session backfill
  // below (which reads user_metadata and is a no-op for a Clerk-only signup,
  // since supabase.auth.getUser() returns null there).
  //
  // Without this, a Clerk tradie who reached the wizard WITHOUT the URL params
  // — bookmark, a refresh that dropped the query, or the dashboard's
  // authed-but-no-tenant bounce (app/dashboard/page.tsx:715) — had to retype
  // business name, first name, email and mobile that /sign-up already stored on
  // their Clerk user. Fills blanks only, so a URL param applied above wins.
  //
  // ONE-SHOT on purpose. The Supabase pass below lives in a `[]` effect, so it
  // hydrates exactly once; this must match. Clerk re-creates its `user` object on
  // session-token refresh, and unlike the `clerk_user_id` effect above this one
  // writes fields the tradie can EDIT — so a re-fire minutes into the wizard
  // would refill a field they had deliberately cleared.
  const { user: clerkUser } = useUser()
  const clerkBackfilled = useRef(false)
  useEffect(() => {
    if (!clerkUser || clerkBackfilled.current) return
    clerkBackfilled.current = true
    const patch = identityFromClerkUser(clerkUser)
    setForm((prev) => {
      const next = {
        ...prev,
        business_name: prev.business_name || patch.business_name || '',
        owner_first_name: prev.owner_first_name || patch.owner_first_name || '',
        owner_email: prev.owner_email || patch.owner_email || '',
        owner_mobile: prev.owner_mobile || patch.owner_mobile || '',
      }
      // Return the SAME object when nothing changed — matches the useAuth effect
      // above and keeps a new `clerkUser` reference from re-rendering the whole
      // wizard (and, if Clerk ever hands back an unstable ref, from looping).
      const changed = (
        ['business_name', 'owner_first_name', 'owner_email', 'owner_mobile'] as const
      ).some((k) => next[k] !== prev[k])
      return changed ? next : prev
    })
  }, [clerkUser])

  // Hydrate identity fields. Source priority, highest first:
  //   1. URL params (carried over from /signup, /sign-up, or /auth/callback)
  //   2. Clerk session user — the one-shot useUser effect ABOVE
  //   3. Supabase session user + user_metadata (set by /api/auth/signup)
  //
  // 2 and 3 are mutually exclusive in practice (a tradie has one provider or the
  // other) and both only ever fill blanks, so their relative order can't matter.
  //
  // The session fallback is critical — without it, returning users
  // arriving from /signin (which only passes owner_user_id) would
  // submit blank business_name/first_name/email and hit a Zod 400.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Pass 1 — URL params (fast, no network)
      const urlBn = params.get('business_name') ?? ''
      const urlFn = params.get('owner_first_name') ?? ''
      const urlEmail = params.get('owner_email') ?? ''
      const urlUserId = params.get('owner_user_id') ?? ''
      const urlClerkId = params.get('clerk_user_id') ?? ''
      // Store the carried mobile NORMALISED (E.164) whenever it parses: the
      // lock check above is whitespace-insensitive but the activate schema's
      // regex is stricter, so posting the raw param (e.g. '04 1234 5678')
      // would 400 with the field hidden. Unparseable values stay raw — the
      // visible editable field lets the tradie fix them.
      let urlMobile = params.get('owner_mobile') ?? ''
      try {
        urlMobile = normaliseAuMobile(urlMobile)
      } catch {
        // keep the raw value
      }

      if (!cancelled) {
        setForm((prev) => ({
          ...prev,
          business_name: urlBn || prev.business_name,
          owner_first_name: urlFn || prev.owner_first_name,
          owner_email: urlEmail || prev.owner_email,
          owner_user_id: urlUserId || prev.owner_user_id,
          clerk_user_id: urlClerkId || prev.clerk_user_id,
          owner_mobile: urlMobile || prev.owner_mobile,
        }))
      }

      // Pass 2 — Supabase session backfill for anything still empty. A Clerk
      // signup carries clerk_user_id (not owner_user_id), so treat EITHER id as
      // "identity resolved" before deciding to hit Supabase. (The separate
      // useAuth effect below backfills clerk_user_id from the live Clerk session
      // for returning Clerk users who reach /onboard without the URL param.)
      if (urlBn && urlFn && urlEmail && (urlUserId || urlClerkId)) {
        return // everything came through the URL, no need to fetch
      }
      try {
        const { getBrowserSupabase } = await import('@/lib/supabase/client')
        const supabase = getBrowserSupabase()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (cancelled || !user) return

        const meta = (user.user_metadata ?? {}) as {
          business_name?: string
          first_name?: string
          owner_mobile?: string
        }
        setForm((prev) => ({
          ...prev,
          business_name: prev.business_name || meta.business_name || '',
          owner_first_name: prev.owner_first_name || meta.first_name || '',
          owner_email: prev.owner_email || user.email || '',
          owner_user_id: prev.owner_user_id || user.id,
          owner_mobile: prev.owner_mobile || meta.owner_mobile || '',
        }))
      } catch (e) {
        // Non-fatal — wizard will show validation errors on submit if
        // the user still has empty required identity fields.
        console.warn('[onboard] session backfill failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Trade-readiness gate (spec A4): only offer trades the whole quote
  // pipeline supports. Falls back to the two pilot trades if the readiness
  // endpoint is unreachable, so onboarding is never blocked by it.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/onboard/trades', { cache: 'no-store' })
        const json = await res.json()
        if (!cancelled && json?.ok && Array.isArray(json.onboardable)) {
          setOnboardableTrades(json.onboardable as string[])
        }
      } catch {
        // Non-fatal — keep the default pilot trades visible.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // A trade pill is shown only when readiness hasn't loaded yet (null) or the
  // gate marks it onboardable.
  const tradeAvailable = (t: Trade) =>
    onboardableTrades === null || onboardableTrades.includes(t)

  // Trade is the only required choice on this step (everything the quote
  // pipeline does is keyed on it). Mobile and state are optional — mobile is
  // normally carried verified from signup, and a missing state just defaults
  // the booking timezone to Australia/Sydney.
  const canContinueStep1 = form.trades.length > 0
  // Labour trades need the three labour rates; a painting-only tenant prices
  // from a (pre-filled) rate card, so the labour fields aren't required there.
  const hasLabourTrade = form.trades.some((t) => t === 'electrical' || t === 'plumbing')
  const canContinueStep2 =
    !hasLabourTrade || !!(form.hourly_rate && form.call_out_minimum && form.default_markup_pct)

  // Helper: toggle a trade in/out of form.trades. Two-button design
  // mirrors the original single-trade pills, but selection is now
  // additive — tap both to register a multi-trade tenant.
  function toggleTrade(value: Trade) {
    setForm((f) => {
      const has = f.trades.includes(value)
      const next: Trade[] = has
        ? f.trades.filter((t) => t !== value)
        : [...f.trades, value]
      return { ...f, trades: next }
    })
  }

  async function handleActivate(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setFieldErrors({})
    try {
      const payload = {
        ...form,
        trades: form.trades,
        state: form.state,
        // Stamp the availability timezone from the chosen state so the
        // stored template's zone matches where the tradie works, regardless
        // of when they edited the hours.
        default_availability: {
          ...form.default_availability,
          timezone: tzForState(form.state),
        },
        // Pass through the SMS intent token so the API marks it used
        // and back-links the originating SMS conversation.
        intent_token: intentToken || undefined,
        invitation_code: invitationCode.trim(),
      }
      const res = await fetch('/api/onboard/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors)
        // Build a human-readable message for validation_failed so the
        // user sees WHICH fields broke without opening DevTools. For
        // identity fields (business_name, first_name, email, mobile)
        // we also suggest signing in again — the most common cause is
        // missing URL carry-through.
        if (data.error === 'validation_failed' && data.fieldErrors) {
          const fields = Object.keys(data.fieldErrors)
          // clerk_user_id belongs here too: on the Clerk funnel it is the only
          // id carried, so an identity failure there must offer the same
          // "refresh to pull from your session" hint.
          const identityFields = [
            'business_name',
            'owner_first_name',
            'owner_email',
            'owner_mobile',
            'owner_user_id',
            'clerk_user_id',
          ]
          const missingIdentity = fields.filter((f) => identityFields.includes(f))
          if (missingIdentity.length > 0) {
            throw new Error(
              `Your account details didn't carry over from signup (${missingIdentity.join(', ')}). ` +
                `Try refreshing this page — we now pull them from your active session as a fallback.`,
            )
          }
          // Send the tradie back to the step that owns the first broken field,
          // so the inline <Field error=…> under the real input is on screen.
          // Without this the banner names a field the review step never renders.
          const jumpTo = stepForFields(fields)
          if (jumpTo) setStep(jumpTo)
          const summary = fields
            .map((f) => `${fieldLabel(f)}: ${data.fieldErrors[f]?.[0] ?? 'Please check this'}`)
            .join(' · ')
          throw new Error(`Please fix: ${summary}`)
        }
        // Prefer the route's human `message` over its machine `error` code —
        // without this the 422 put the literal "owner_user_id_unresolved" in the
        // banner, and every other coded error read the same way.
        throw new Error(activateErrorMessage(data))
      }
      const sp = new URLSearchParams({
        tenant: data.tenantId,
        phone: data.phoneNumber ?? '',
        name: form.owner_first_name,
      })
      // Pass through the underlying provisioning failure reason so the
      // success page can surface it next to the retry button. The API
      // returns warning when ok:true,phoneNumber:null (Twilio/Vapi half
      // didn't run) so the wizard doesn't show a generic confusing state.
      if (data.warning) sp.set('warning', String(data.warning))
      router.push(`/onboard/success?${sp.toString()}`)
    } catch (err: any) {
      setError(err?.message ?? 'Activation failed')
      setSubmitting(false)
    }
  }

  async function checkCode() {
    const code = invitationCode.trim()
    if (!code) {
      setCodeError('Enter your invitation code to continue.')
      return
    }
    setCodeChecking(true)
    setCodeError(null)
    setCodeNote(null)
    try {
      const res = await fetch('/api/onboard/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, channel: codeLocked ? 'sms' : 'web' }),
      })
      const data = await res.json()
      if (!data.ok) {
        setCodeError(data.message ?? 'That code was not accepted.')
        return
      }
      if (data.last_slot) setCodeNote('Heads up — this is the last sign-up slot for this code.')
      setCodeAccepted(true)
    } catch {
      setCodeError('Could not check the code just now. Try again.')
    } finally {
      setCodeChecking(false)
    }
  }

  // SMS tradies arrive pre-validated — auto-accept the locked code.
  useEffect(() => {
    if (codeLocked && !codeAccepted) setCodeAccepted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeLocked])

  const meta = STEP_META[step - 1]

  return (
    <FunnelShell
      currentNum={meta.num}
      heading={codeAccepted ? meta.label : 'One code to start'}
      subtitle={
        codeAccepted
          ? meta.subtitle
          : 'Enter the invitation code whoever invited you sent. It unlocks tradie sign-up.'
      }
    >
      {!codeAccepted ? (
        <div className="mt-up border border-ink-line bg-ink-card p-7 md:p-10">
          <Field
            label="Invitation code"
            hint={codeLocked ? 'From your text · locked' : 'The code whoever invited you gave you'}
            error={codeError ?? undefined}
          >
            <input
              type="text"
              value={invitationCode}
              onChange={(e) => setInvitationCode(e.target.value.toUpperCase())}
              placeholder="e.g. JON-JUNE-FLYERS-7K2P"
              className={`${INPUT} ${codeLocked ? 'opacity-70 cursor-not-allowed' : ''}`}
              readOnly={codeLocked}
              autoCapitalize="characters"
            />
          </Field>
          {codeNote && <p className="mt-3 text-sm font-medium text-amber-500">{codeNote}</p>}
          <div className="mt-7 flex justify-end">
            <PrimaryButton disabled={codeChecking} onClick={checkCode}>
              {codeChecking ? 'Checking…' : 'Continue'}
            </PrimaryButton>
          </div>
        </div>
      ) : (
        <>
          {/* Step content */}
          <div key={step} className="mt-up border border-ink-line bg-ink-card p-7 md:p-10 lg:p-12">
            {step === 1 && (
              <Step1
                form={form}
                update={update}
                toggleTrade={toggleTrade}
                tradeAvailable={tradeAvailable}
                fieldErrors={fieldErrors}
                mobileLocked={mobileLocked}
                showLicence={showLicence}
                setShowLicence={setShowLicence}
              />
            )}
            {step === 2 && (
              <Step2
                form={form}
                update={update}
                fieldErrors={fieldErrors}
                showAdvanced={showAdvanced}
                setShowAdvanced={setShowAdvanced}
              />
            )}
            {step === 3 && <Step3 form={form} />}
          </div>

          {/* Inline error */}
          {error && (
            <div className="mt-6">
              <ErrorBanner>{error}</ErrorBanner>
            </div>
          )}

          {/* Footer nav */}
          <div className="mt-8 flex items-center justify-between gap-3">
            {step > 1 ? (
              <SecondaryButton onClick={() => setStep((s) => (s - 1) as 1 | 2)}>Back</SecondaryButton>
            ) : (
              <span />
            )}
            {step === 1 && (
              <PrimaryButton disabled={!canContinueStep1} onClick={() => setStep(2)}>
                Continue
              </PrimaryButton>
            )}
            {step === 2 && (
              <PrimaryButton disabled={!canContinueStep2} onClick={() => setStep(3)}>
                Continue
              </PrimaryButton>
            )}
            {step === 3 && (
              <form onSubmit={handleActivate}>
                <button
                  type="submit"
                  disabled={submitting}
                  aria-busy={submitting}
                  className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-7 py-3.5 text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
                >
                  {submitting ? 'Activating…' : 'Activate my QuoteMax'}
                  {!submitting && <Arrow />}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </FunnelShell>
  )
}

/* ─── Step content ──────────────────────────────────────────── */

function Step1({
  form,
  update,
  toggleTrade,
  tradeAvailable,
  fieldErrors,
  mobileLocked,
  showLicence,
  setShowLicence,
}: {
  form: FormState
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  toggleTrade: (v: Trade) => void
  tradeAvailable: (t: Trade) => boolean
  fieldErrors: Record<string, string[]>
  mobileLocked: boolean
  showLicence: boolean
  setShowLicence: (v: boolean) => void
}) {
  // Pick the first selected trade as the "primary" — drives the
  // licence-body suggestion when the wizard has only enough room to
  // show one regulator label. Multi-trade tradies can edit the value
  // freely; nothing here forces a single regulator.
  const primaryTrade: Trade | '' = form.trades[0] ?? ''
  return (
    <>
      <div className="mb-7">
        <RequiredLegend />
      </div>

      {/* ─── Your brand — shown on every customer quote ───────────── */}
      <SectionHeading hint="Shows on the quotes your customers receive.">Your brand</SectionHeading>
      <div className="space-y-7">
        <LogoUpload
          ownerUserId={form.owner_user_id || form.clerk_user_id}
          logoUrl={form.logo_url}
          businessName={form.business_name}
          onUploaded={(url, path) => {
            update('logo_url', url)
            update('logo_path', path)
          }}
          onCleared={() => {
            update('logo_url', '')
            update('logo_path', '')
          }}
        />
        <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
          <Field label="Contact name" hint="Optional · who customers ask for">
            <input
              type="text"
              value={form.contact_name}
              onChange={(e) => update('contact_name', e.target.value)}
              className={INPUT}
              maxLength={80}
              autoComplete="name"
            />
          </Field>
          <Field label="Website" hint="Optional" error={fieldErrors.website_url?.[0]}>
            <input
              type="text"
              value={form.website_url}
              onChange={(e) => update('website_url', e.target.value)}
              className={INPUT}
              maxLength={200}
              inputMode="url"
            />
          </Field>
        </div>
        <Field label="Business address" hint="Optional · start typing to search">
          <AddressAutocomplete
            value={form.business_address}
            onChange={(v) => update('business_address', v)}
            className={INPUT}
            maxLength={200}
            aria-label="Business address"
          />
        </Field>
      </div>

      {/* ─── Your trade — required core fields ─────────────────────── */}
      <div className="mt-12 border-t border-ink-line pt-12">
        <SectionHeading hint="What you do and where. Pick every trade you're licensed for.">
          Your trade
        </SectionHeading>
        <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
          {/* Trade takes the full row: four pills do not fit in a half-width
              column. The old half-width `grid grid-cols-3` sized each pill to a
              minmax(0,1fr) track narrower than its own single-word label, so
              "ELECTRICAL" painted straight through the button's border. Pills
              now size to their content and wrap, and a full-width row keeps all
              four (and any the readiness gate adds) on one line. */}
          <div className="md:col-span-2">
            <Field
              label="Trade"
              hint="Pick any that apply"
              error={fieldErrors.trades?.[0]}
              required
            >
              <div className="flex flex-wrap gap-2">
                {TRADE_OPTIONS.filter(({ value }) => tradeAvailable(value)).map(
                  ({ value, label }) => (
                    <TradePill
                      key={value}
                      value={value}
                      label={label}
                      selected={form.trades.includes(value)}
                      onToggle={toggleTrade}
                    />
                  ),
                )}
              </div>
            </Field>
          </div>

          {/* Optional. Usually carried verified from signup (then locked);
              editable on the degraded path where carry-over failed. A blank
              mobile still activates — the welcome SMS is simply skipped. */}
          <Field
            label="Mobile"
            hint={mobileLocked ? 'Verified via SMS · locked' : 'Optional · for your welcome text'}
            error={fieldErrors.owner_mobile?.[0]}
          >
            <input
              type="tel"
              value={form.owner_mobile}
              onChange={(e) => update('owner_mobile', e.target.value)}
              className={`${INPUT} ${mobileLocked ? 'opacity-70 cursor-not-allowed' : ''}`}
              autoComplete="tel"
              readOnly={mobileLocked}
            />
          </Field>

          <Field label="State" hint="Optional · sets your booking timezone">
            <select
              value={form.state}
              onChange={(e) => update('state', e.target.value as FormState['state'])}
              className={INPUT}
            >
              <option value="" className="bg-ink-deep">Choose state</option>
              {STATES.map((s) => <option key={s} value={s} className="bg-ink-deep">{s}</option>)}
            </select>
          </Field>

          <Field label="ABN" hint="Optional · add later">
            <input
              type="text"
              value={form.abn}
              onChange={(e) => update('abn', e.target.value)}
              className={INPUT}
              maxLength={20}
            />
          </Field>
        </div>
      </div>

      {/* ─── Licence details — collapsed by default ───────────────── */}
      {/* Licence is optional in the database AND in Australian Consumer
          Law for the test phase. Most tradies have one but typing it
          mid-onboarding is friction — let them skip cleanly and add it
          later from the dashboard's Account tab. */}
      <div className="mt-12 pt-12 border-t border-ink-line">
        {!showLicence ? (
          <button
            type="button"
            onClick={() => setShowLicence(true)}
            className="inline-flex items-center gap-2 text-sm font-mono uppercase tracking-[0.14em] text-text-sec hover:text-text-pri transition-colors"
          >
            <span className="text-accent text-base leading-none">+</span>
            Add licence details
            <span className="text-text-dim normal-case font-sans tracking-normal text-xs">(optional, can add later)</span>
          </button>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-pri font-bold">
                Licence details
                <span className="ml-2 text-text-dim font-normal normal-case tracking-normal text-xs">
                  (optional)
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setShowLicence(false)}
                className="text-xs font-mono uppercase tracking-[0.14em] text-text-dim hover:text-text-pri"
              >
                Skip
              </button>
            </div>
            <div className="mt-5 grid gap-x-8 gap-y-7 md:grid-cols-2">
              {form.state && primaryTrade && (
                <Field
                  label="Licence body"
                  hint={
                    form.trades.length > 1
                      ? `Optional · defaults to ${primaryTrade} regulator`
                      : 'Optional'
                  }
                >
                  <input
                    type="text"
                    value={form.licence_type || LICENCE_BODIES[form.state]?.[primaryTrade] || ''}
                    onChange={(e) => update('licence_type', e.target.value)}
                    className={INPUT}
                  />
                </Field>
              )}

              <Field label="Licence number" hint="Optional">
                <input
                  type="text"
                  value={form.licence_number}
                  onChange={(e) => update('licence_number', e.target.value)}
                  className={INPUT}
                />
              </Field>

              <Field label="Licence expiry" hint="Optional">
                <input
                  type="date"
                  value={form.licence_expiry}
                  onChange={(e) => update('licence_expiry', e.target.value)}
                  className={`${INPUT} [color-scheme:dark]`}
                />
              </Field>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Step2({
  form,
  update,
  fieldErrors,
  showAdvanced,
  setShowAdvanced,
}: {
  form: FormState
  update: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  fieldErrors: Record<string, string[]>
  showAdvanced: boolean
  setShowAdvanced: (v: boolean) => void
}) {
  // Painting and roofing price from a $/m² rate card; electrical/plumbing
  // price by the hour. Show each pricing block only for the trades the tenant
  // picked, so a painter never sees labour fields and a sparky never sees
  // paint rates.
  const hasLabour = form.trades.some((t) => t === 'electrical' || t === 'plumbing')
  const hasPainting = form.trades.includes('painting')
  const hasRoofing = form.trades.includes('roofing')
  // Hint defaults bias to plumbing rates when plumbing is the ONLY trade
  // picked, else fall back to the electrical-shaped defaults.
  const isPlumbing = form.trades.length === 1 && form.trades[0] === 'plumbing'
  return (
    <div className="space-y-10">
      {hasLabour && (
        <>
          <div>
            <div className="mb-3">
              <RequiredLegend />
            </div>
            <SectionHeading hint="Your standard charge-out. The advanced settings below all have sensible defaults.">
              Labour rates
            </SectionHeading>
          </div>
          <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
            <Field label="Hourly rate" hint="Ex-GST" error={fieldErrors.hourly_rate?.[0]} required>
              <PrefixedInput
                prefix="$"
                type="number"
                step="1"
                min="1"
                value={form.hourly_rate}
                onChange={(v) => update('hourly_rate', v)}
              />
            </Field>

            <Field label="Call-out minimum" hint="Absorbed into jobs > $800" error={fieldErrors.call_out_minimum?.[0]} required>
              <PrefixedInput
                prefix="$"
                type="number"
                step="1"
                min="1"
                value={form.call_out_minimum}
                onChange={(v) => update('call_out_minimum', v)}
              />
            </Field>

            <Field label="Materials markup" hint="20-35% typical AU" error={fieldErrors.default_markup_pct?.[0]} required>
              <SuffixedInput
                suffix="%"
                type="number"
                step="1"
                min="0"
                max="100"
                value={form.default_markup_pct}
                onChange={(v) => update('default_markup_pct', v)}
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-accent hover:text-accent-press transition-colors"
          >
            {showAdvanced ? 'Hide advanced pricing' : '+ Show advanced pricing (5 optional)'}
          </button>

          {showAdvanced && (
            <div className="grid gap-x-8 gap-y-7 md:grid-cols-2 pt-6 border-t border-ink-line">
              <Field label="Apprentice rate" hint="Default $65/hr">
                <PrefixedInput prefix="$" type="number" step="1" value={form.apprentice_rate} onChange={(v) => update('apprentice_rate', v)} />
              </Field>
              <Field label="Senior rate" hint="Default $160/hr">
                <PrefixedInput prefix="$" type="number" step="1" value={form.senior_rate} onChange={(v) => update('senior_rate', v)} />
              </Field>
              <Field label="After-hours multiplier" hint="Default 1.5×">
                <input
                  type="number" step="0.1"
                  value={form.after_hours_multiplier}
                  onChange={(e) => update('after_hours_multiplier', e.target.value)}
                  className={INPUT}
                />
              </Field>
              <Field label="Minimum charge (hr)" hint={`Default ${isPlumbing ? '1.5' : '2'}hr`}>
                <input
                  type="number" step="0.5"
                  value={form.min_labour_hours}
                  onChange={(e) => update('min_labour_hours', e.target.value)}
                  className={INPUT}
                />
              </Field>
              <Field label="Risk buffer %" hint="Default 15%">
                <SuffixedInput suffix="%" type="number" step="1" value={form.risk_buffer_pct} onChange={(v) => update('risk_buffer_pct', v)} />
              </Field>
            </div>
          )}
        </>
      )}

      {hasPainting && (
        <div className={hasLabour ? 'pt-10 border-t border-ink-line' : ''}>
          <div className="mb-5">
            <h3 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-accent">
              Painting pricing
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-text-sec">
              Choose how you price painting jobs. <strong className="text-text-pri">Per m²</strong> uses
              an all-in rate card; <strong className="text-text-pri">Hourly</strong> charges by labour
              time. You can fine-tune this anytime from your dashboard.
            </p>
          </div>

          {/* Pricing-model toggle */}
          <div className="mb-5">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
              Pricing model
            </span>
            <div className="mt-1.5 grid max-w-sm grid-cols-2 gap-2">
              <PricingModelButton
                label="Per m²"
                sublabel="Rate card"
                active={form.painting_pricing_model === 'sqm'}
                onClick={() => update('painting_pricing_model', 'sqm')}
              />
              <PricingModelButton
                label="Hourly"
                sublabel="By labour time"
                active={form.painting_pricing_model === 'hourly'}
                onClick={() => update('painting_pricing_model', 'hourly')}
              />
            </div>
          </div>

          {form.painting_pricing_model === 'sqm' ? (
            <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
              <Field label="Walls" hint="$/m²">
                <PrefixedInput prefix="$" type="number" step="1" min="1" value={form.painting_walls_rate} onChange={(v) => update('painting_walls_rate', v)} />
              </Field>
              <Field label="Ceilings" hint="$/m²">
                <PrefixedInput prefix="$" type="number" step="1" min="1" value={form.painting_ceilings_rate} onChange={(v) => update('painting_ceilings_rate', v)} />
              </Field>
              <Field label="Trim / doors" hint="$/lm">
                <PrefixedInput prefix="$" type="number" step="1" min="1" value={form.painting_trim_rate} onChange={(v) => update('painting_trim_rate', v)} />
              </Field>
              <Field label="Exterior" hint="$/m²">
                <PrefixedInput prefix="$" type="number" step="1" min="1" value={form.painting_exterior_rate} onChange={(v) => update('painting_exterior_rate', v)} />
              </Field>
              <Field label="Call-out minimum" hint="Ex-GST floor per job">
                <PrefixedInput prefix="$" type="number" step="10" min="0" value={form.painting_call_out_minimum} onChange={(v) => update('painting_call_out_minimum', v)} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
              <Field label="Hourly rate" hint="$/hr ex-GST">
                <PrefixedInput prefix="$" type="number" step="1" min="1" value={form.painting_hourly_rate} onChange={(v) => update('painting_hourly_rate', v)} />
              </Field>
              <Field label="Call-out minimum" hint="Ex-GST floor per job">
                <PrefixedInput prefix="$" type="number" step="10" min="0" value={form.painting_call_out_minimum} onChange={(v) => update('painting_call_out_minimum', v)} />
              </Field>
              <p className="text-xs leading-relaxed text-text-dim md:col-span-2">
                We estimate labour hours from the measured job area and charge your hourly
                rate. Coats, prep and access still scale the quote, same as the rate-card model.
              </p>
            </div>
          )}
        </div>
      )}

      {hasRoofing && (
        <div className={hasLabour || hasPainting ? 'pt-10 border-t border-ink-line' : ''}>
          <div className="mb-5">
            <h3 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-accent">
              Roofing pricing
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-text-sec">
              The base $/m² rate (ex GST) we multiply the measured sloped roof
              area by, per material. Blank fields fall back to the Australian
              default, and loadings, accessories and every other lever stay
              editable from your dashboard under{' '}
              <strong className="text-text-pri">Roofing rates</strong>. Every
              roofing quote comes to you for sign-off before the customer sees it.
            </p>
          </div>
          <div className="grid gap-x-8 gap-y-7 md:grid-cols-2">
            {ROOFING_RATE_FIELDS.map(([key, label, def]) => (
              <Field
                key={key}
                label={label}
                hint={
                  def === 0
                    ? `Default $0/m² · never auto-quoted`
                    : `Default $${def}/m²`
                }
                error={fieldErrors[key]?.[0]}
              >
                <PrefixedInput
                  prefix="$"
                  type="number"
                  step="1"
                  min="1"
                  value={form[key]}
                  onChange={(v) => update(key, v)}
                />
              </Field>
            ))}
          </div>
        </div>
      )}

      {/* GST registration — applies to every trade, so it's always shown. */}
      <label className="flex items-center gap-3 text-sm text-text-pri cursor-pointer">
        <input
          type="checkbox"
          checked={form.gst_registered}
          onChange={(e) => update('gst_registered', e.target.checked)}
          className="h-5 w-5 rounded-none border-ink-line bg-ink-deep text-accent focus:ring-2 focus:ring-accent-soft"
        />
        <span>GST registered</span>
      </label>

      {/* Booking availability — optional. Pre-filled with the Mon–Fri default
          so the tradie is bookable immediately; fully editable here or later
          from the dashboard Account tab. */}
      <div className="pt-10 border-t border-ink-line">
        <div className="mb-5">
          <h3 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-accent">
            Booking availability (optional)
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-text-sec">
            The hours you work each week. Customers pick a morning or afternoon
            slot on these days. You can change this anytime from your dashboard.
          </p>
        </div>
        <AvailabilityEditor
          value={form.default_availability}
          onChange={(next) => update('default_availability', next)}
        />
      </div>
    </div>
  )
}

function Step3({ form }: { form: FormState }) {
  const hasLabour = form.trades.some((t) => t === 'electrical' || t === 'plumbing')
  const hasPainting = form.trades.includes('painting')
  const hasRoofing = form.trades.includes('roofing')
  return (
    <div className="space-y-8">
      <ReviewBlock label="Account">
        <ReviewRow k="Business" v={form.business_name} />
        <ReviewRow k="Owner" v={form.owner_first_name} />
        <ReviewRow k="Email" v={form.owner_email} />
        <ReviewRow k="Mobile" v={form.owner_mobile} />
      </ReviewBlock>

      <ReviewBlock label="Brand">
        <div className="flex items-center justify-between gap-4 border-b border-ink-line/60 py-2">
          <dt className="text-sm text-text-dim">Logo</dt>
          <dd className="text-right">
            {form.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.logo_url} alt="Your logo" className="inline-block h-10 w-auto" />
            ) : businessInitials(form.business_name) ? (
              <span className="inline-grid h-10 w-10 place-items-center bg-accent font-sans text-sm font-extrabold tracking-tight text-accent-ink">
                {businessInitials(form.business_name)}
              </span>
            ) : (
              <span className="text-sm text-text-dim">—</span>
            )}
          </dd>
        </div>
        <ReviewRow k="Contact" v={form.contact_name || form.owner_first_name} />
        {form.website_url ? <ReviewRow k="Website" v={form.website_url} /> : null}
        {form.business_address ? <ReviewRow k="Address" v={form.business_address} /> : null}
      </ReviewBlock>

      <ReviewBlock label="Trade">
        <ReviewRow
          k={form.trades.length > 1 ? 'Trades' : 'Trade'}
          v={form.trades.map(titleCase).join(' + ')}
        />
        <ReviewRow k="State" v={form.state} />
        {form.abn && <ReviewRow k="ABN" v={form.abn} />}
        {form.licence_number && (
          <ReviewRow k="Licence" v={`${form.licence_type ?? ''} ${form.licence_number}`.trim()} />
        )}
      </ReviewBlock>

      <ReviewBlock label="Pricing">
        {hasLabour && (
          <>
            <ReviewRow k="Hourly" v={form.hourly_rate ? `$${form.hourly_rate}/hr` : ''} />
            <ReviewRow k="Callout" v={form.call_out_minimum ? `$${form.call_out_minimum}` : ''} />
            <ReviewRow k="Markup" v={form.default_markup_pct ? `${form.default_markup_pct}%` : ''} />
          </>
        )}
        {hasPainting && form.painting_pricing_model === 'hourly' && (
          <ReviewRow k="Painting" v={form.painting_hourly_rate ? `$${form.painting_hourly_rate}/hr (hourly)` : 'Hourly'} />
        )}
        {hasPainting && form.painting_pricing_model !== 'hourly' && (
          <>
            <ReviewRow k="Walls" v={form.painting_walls_rate ? `$${form.painting_walls_rate}/m²` : ''} />
            <ReviewRow k="Ceilings" v={form.painting_ceilings_rate ? `$${form.painting_ceilings_rate}/m²` : ''} />
            <ReviewRow k="Trim" v={form.painting_trim_rate ? `$${form.painting_trim_rate}/lm` : ''} />
            <ReviewRow k="Exterior" v={form.painting_exterior_rate ? `$${form.painting_exterior_rate}/m²` : ''} />
          </>
        )}
        {hasRoofing && (
          <ReviewRow
            k="Roofing"
            v={
              roofingRatesCustomised(form)
                ? 'Measured per-m² rate card (custom rates)'
                : 'Measured per-m² rate card (AU defaults)'
            }
          />
        )}
        <ReviewRow k="GST" v={form.gst_registered ? 'Registered' : 'Not registered'} />
      </ReviewBlock>

      <div className="border-t border-ink-line pt-6">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
          On activation
        </span>
        <ul className="mt-3 space-y-1.5 text-sm text-text-sec">
          <li className="flex gap-3"><span className="text-accent font-mono text-xs pt-0.5">→</span>Account + pricing saved to database</li>
          <li className="flex gap-3"><span className="text-accent font-mono text-xs pt-0.5">→</span>Auto-quote services enabled for your trade</li>
          <li className="flex gap-3"><span className="text-text-dim font-mono text-xs pt-0.5">○</span>Twilio number provisioned (placeholder in test phase)</li>
          <li className="flex gap-3"><span className="text-text-dim font-mono text-xs pt-0.5">○</span>Vapi AI assistant created (placeholder in test phase)</li>
        </ul>
      </div>
    </div>
  )
}

/* ─── Primitives ────────────────────────────────────────────── */

// Subtle group heading used inside steps to break a long form into calm,
// labelled sections instead of one undifferentiated block.
function SectionHeading({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-6">
      <h3 className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-accent">{children}</h3>
      {hint && <p className="mt-2 text-sm leading-relaxed text-text-sec">{hint}</p>}
    </div>
  )
}

function TradePill({
  value,
  label,
  selected,
  onToggle,
}: {
  value: Trade
  label: string
  selected: boolean
  onToggle: (v: Trade) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(value)}
      aria-pressed={selected}
      className={`whitespace-nowrap px-4 py-3.5 text-sm font-semibold uppercase tracking-wider transition-colors border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
        selected
          ? 'border-accent bg-accent text-white'
          : 'border-ink-line bg-ink-deep text-text-sec hover:border-accent-soft hover:text-text-pri'
      }`}
    >
      {label}
    </button>
  )
}

function PricingModelButton({
  label,
  sublabel,
  active,
  onClick,
}: {
  label: string
  sublabel: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-start gap-0.5 border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
        active
          ? 'border-accent bg-accent text-white'
          : 'border-ink-line bg-ink-deep text-text-sec hover:border-accent-soft hover:text-text-pri'
      }`}
    >
      <span className="text-sm font-semibold uppercase tracking-wider">{label}</span>
      <span className={`font-mono text-[0.6rem] uppercase tracking-[0.12em] ${active ? 'text-white/80' : 'text-text-dim'}`}>
        {sublabel}
      </span>
    </button>
  )
}

type AffixInputProps = {
  value: string
  onChange: (v: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>

function PrefixedInput({
  prefix,
  value,
  onChange,
  ...rest
}: AffixInputProps & { prefix: string }) {
  return (
    <div className="flex">
      <span className="inline-flex items-center justify-center bg-ink-deep border border-r-0 border-ink-line px-3.5 text-text-dim font-mono text-sm">
        {prefix}
      </span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} flex-1`}
      />
    </div>
  )
}

function SuffixedInput({
  suffix,
  value,
  onChange,
  ...rest
}: AffixInputProps & { suffix: string }) {
  return (
    <div className="flex">
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} flex-1`}
      />
      <span className="inline-flex items-center justify-center bg-ink-deep border border-l-0 border-ink-line px-3.5 text-text-dim font-mono text-sm">
        {suffix}
      </span>
    </div>
  )
}

function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-7 py-3.5 text-sm uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
    >
      {children}
      <Arrow />
    </button>
  )
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 border border-ink-line bg-transparent hover:bg-ink-card text-text-pri font-semibold px-7 py-3.5 text-sm uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
    >
      {children}
    </button>
  )
}

function ReviewBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-accent">
        {label}
      </span>
      <dl className="mt-3 space-y-2">{children}</dl>
    </div>
  )
}

function ReviewRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-line/60 py-2">
      <dt className="text-sm text-text-dim">{k}</dt>
      <dd className="text-sm font-medium text-text-pri text-right">{v || '—'}</dd>
    </div>
  )
}

function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Logo upload — optional brand field. Validates type/size client-side for a
// fast error, then POSTs the file to /api/onboard/logo (which re-validates +
// sanitises SVGs server-side) and stores the returned public URL + path on the
// form. The object is keyed by the owner's auth user_id since the tenant row
// doesn't exist yet at this point in the wizard.
//
// Skipping is a first-class path: the preview shows the business-initials
// monogram the quote letterhead will actually draw, so a tradie with no logo
// file sees their real default rather than a dead placeholder.
const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'
const LOGO_ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const LOGO_MAX_BYTES = 2 * 1024 * 1024

function LogoUpload({
  ownerUserId,
  logoUrl,
  businessName,
  onUploaded,
  onCleared,
}: {
  ownerUserId: string
  logoUrl: string
  businessName: string
  onUploaded: (url: string, path: string) => void
  onCleared: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleFile(file: File | null) {
    if (!file) return
    setErr(null)
    const mime = (file.type || '').split(';')[0].trim().toLowerCase()
    if (!LOGO_ALLOWED.includes(mime)) {
      setErr('Logo must be a PNG, JPG, WEBP, or SVG image.')
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setErr('Logo must be 2 MB or smaller.')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('owner_user_id', ownerUserId)
      const res = await fetch('/api/onboard/logo', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Logo upload failed')
      onUploaded(data.publicUrl as string, data.path as string)
    } catch (e: any) {
      setErr(e?.message ?? 'Logo upload failed')
    } finally {
      setUploading(false)
    }
  }

  const initials = businessInitials(businessName)

  return (
    <Field label="Business logo" hint="Optional · shows on every quote" error={err ?? undefined}>
      <div className="flex items-center gap-4">
        {logoUrl ? (
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden border border-ink-line bg-ink-deep">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Your logo" className="h-full w-full object-contain" />
          </div>
        ) : initials ? (
          <div
            aria-hidden
            className="grid h-16 w-16 shrink-0 place-items-center bg-accent font-sans text-xl font-extrabold tracking-tight text-accent-ink"
          >
            {initials}
          </div>
        ) : (
          // business_name can still be blank here on some hydration paths — an
          // empty accent square would read as a rendering fault, so keep the
          // inert placeholder until there's a name to make initials from.
          <div className="grid h-16 w-16 shrink-0 place-items-center border border-ink-line bg-ink-deep">
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.12em] text-text-dim">
              Logo
            </span>
          </div>
        )}
        <div className="flex-1">
          <label className="inline-flex cursor-pointer items-center gap-2 border border-ink-line bg-ink-deep px-4 py-2.5 text-sm font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent-soft">
            <input
              type="file"
              accept={LOGO_ACCEPT}
              className="sr-only"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
            {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
          </label>
          {logoUrl ? (
            <button
              type="button"
              onClick={onCleared}
              className="ml-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim underline underline-offset-4 transition-colors hover:text-text-pri"
            >
              Remove
            </button>
          ) : null}
          <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">
            {logoUrl
              ? 'PNG, JPG, WEBP or SVG · max 2 MB'
              : initials
                ? `No logo? We'll use your ${initials} mark · PNG, JPG, WEBP or SVG · max 2 MB`
                : 'PNG, JPG, WEBP or SVG · max 2 MB'}
          </p>
        </div>
      </div>
    </Field>
  )
}
