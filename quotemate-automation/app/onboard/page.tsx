// /onboard — Maintain design system. 3-step wizard after sign up.
//
// Step 1: Trade + state + mobile + optional licence
// Step 2: Pricing essentials + collapsible advanced
// Step 3: Review + Activate

'use client'

import { Suspense, useState, useEffect, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LICENCE_BODIES } from '@/lib/onboard/schema'
import { DEFAULT_PAINTING_RATE_CARD } from '@/lib/painting/pricing'
import {
  defaultAvailability,
  tzForState,
  type WeeklyAvailability,
} from '@/lib/quote/availability'
import { AvailabilityEditor } from '@/app/_components/AvailabilityEditor'
import { AddressAutocomplete } from '@/app/_components/AddressAutocomplete'
import { Field, INPUT, ErrorBanner, Arrow, RequiredLegend } from '../signup/page'
import { FunnelShell } from '@/app/_components/funnel-shell'

type Trade = 'electrical' | 'plumbing' | 'painting'

type FormState = {
  business_name: string
  owner_first_name: string
  owner_email: string
  owner_user_id: string
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
  gst_registered: boolean
  // Default schedule availability (migration 147). Pre-filled with the
  // Mon–Fri default; the tradie can edit or skip it. Optional in the wizard.
  default_availability: WeeklyAvailability
}

const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const

const STEP_META = [
  { num: '02', label: 'Trade & licence', subtitle: 'What you do, where, optional regulatory bits.' },
  { num: '03', label: 'Your pricing',    subtitle: 'Three required fields. Advanced settings have defaults.' },
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
  // Either case → mobile field is read-only in the wizard.
  const intentToken = params.get('intent') ?? ''
  const mobileFromUpstream = params.get('owner_mobile') ?? ''
  const mobileLocked = !!mobileFromUpstream

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
    gst_registered: true,
    default_availability: defaultAvailability(),
  })

  // Hydrate identity fields. Source priority:
  //   1. URL params (carried over from /signup or /auth/callback)
  //   2. Supabase session user + user_metadata (set by /api/auth/signup)
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
      const urlMobile = params.get('owner_mobile') ?? ''

      if (!cancelled) {
        setForm((prev) => ({
          ...prev,
          business_name: urlBn || prev.business_name,
          owner_first_name: urlFn || prev.owner_first_name,
          owner_email: urlEmail || prev.owner_email,
          owner_user_id: urlUserId || prev.owner_user_id,
          owner_mobile: urlMobile || prev.owner_mobile,
        }))
      }

      // Pass 2 — Supabase session backfill for anything still empty
      if (urlBn && urlFn && urlEmail && urlUserId) {
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

  const canContinueStep1 = !!(form.owner_mobile && form.trades.length > 0 && form.state && form.logo_url)
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
        state: form.state as 'NSW',
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
          const identityFields = ['business_name', 'owner_first_name', 'owner_email', 'owner_mobile', 'owner_user_id']
          const missingIdentity = fields.filter((f) => identityFields.includes(f))
          if (missingIdentity.length > 0) {
            throw new Error(
              `Your account details didn't carry over from signup (${missingIdentity.join(', ')}). ` +
                `Try refreshing this page — we now pull them from your active session as a fallback.`,
            )
          }
          const summary = fields
            .map((f) => `${f}: ${data.fieldErrors[f]?.[0] ?? 'invalid'}`)
            .join(' · ')
          throw new Error(`Please fix: ${summary}`)
        }
        throw new Error(data.error ?? 'Activation failed')
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
          ownerUserId={form.owner_user_id}
          logoUrl={form.logo_url}
          onUploaded={(url, path) => {
            update('logo_url', url)
            update('logo_path', path)
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
          <Field
            label="Mobile"
            hint={mobileLocked ? 'Verified via SMS · locked' : 'For your welcome text'}
            error={fieldErrors.owner_mobile?.[0]}
            required
          >
            <input
              type="tel"
              value={form.owner_mobile}
              onChange={(e) => update('owner_mobile', e.target.value)}
              className={`${INPUT} ${mobileLocked ? 'opacity-70 cursor-not-allowed' : ''}`}
              autoComplete="tel"
              required
              readOnly={mobileLocked}
            />
          </Field>

          <Field
            label="Trade"
            hint="Pick any that apply"
            error={fieldErrors.trades?.[0]}
            required
          >
            <div className="grid grid-cols-3 gap-2">
              {tradeAvailable('electrical') && (
                <TradePill
                  value="electrical"
                  label="Electrical"
                  selected={form.trades.includes('electrical')}
                  onToggle={toggleTrade}
                />
              )}
              {tradeAvailable('plumbing') && (
                <TradePill
                  value="plumbing"
                  label="Plumbing"
                  selected={form.trades.includes('plumbing')}
                  onToggle={toggleTrade}
                />
              )}
              {tradeAvailable('painting') && (
                <TradePill
                  value="painting"
                  label="Painting"
                  selected={form.trades.includes('painting')}
                  onToggle={toggleTrade}
                />
              )}
            </div>
          </Field>

          <Field label="State" required>
            <select
              value={form.state}
              onChange={(e) => update('state', e.target.value as FormState['state'])}
              className={INPUT}
              required
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
  // Painting prices from a $/m² rate card; electrical/plumbing price by the
  // hour. Show each pricing block only for the trades the tenant picked, so
  // a painter never sees labour fields and a sparky never sees paint rates.
  const hasLabour = form.trades.some((t) => t === 'electrical' || t === 'plumbing')
  const hasPainting = form.trades.includes('painting')
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
  return (
    <div className="space-y-8">
      <ReviewBlock label="Account">
        <ReviewRow k="Business" v={form.business_name} />
        <ReviewRow k="Owner" v={form.owner_first_name} />
        <ReviewRow k="Email" v={form.owner_email} />
        <ReviewRow k="Mobile" v={form.owner_mobile} />
      </ReviewBlock>

      <ReviewBlock label="Brand">
        {form.logo_url ? (
          <div className="flex items-center justify-between gap-4 border-b border-ink-line/60 py-2">
            <dt className="text-sm text-text-dim">Logo</dt>
            <dd className="text-right">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.logo_url} alt="Your logo" className="inline-block h-10 w-auto" />
            </dd>
          </div>
        ) : null}
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
      className={`px-4 py-3.5 text-sm font-semibold uppercase tracking-wider transition-colors border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
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

// Logo upload — required brand field. Validates type/size client-side for a
// fast error, then POSTs the file to /api/onboard/logo (which re-validates +
// sanitises SVGs server-side) and stores the returned public URL + path on the
// form. The object is keyed by the owner's auth user_id since the tenant row
// doesn't exist yet at this point in the wizard.
const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml'
const LOGO_ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const LOGO_MAX_BYTES = 2 * 1024 * 1024

function LogoUpload({
  ownerUserId,
  logoUrl,
  onUploaded,
}: {
  ownerUserId: string
  logoUrl: string
  onUploaded: (url: string, path: string) => void
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

  return (
    <Field label="Business logo" hint="Shows on every quote" error={err ?? undefined} required>
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden border border-ink-line bg-ink-deep">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Your logo" className="h-full w-full object-contain" />
          ) : (
            <span className="font-mono text-[0.55rem] uppercase tracking-[0.12em] text-text-dim">
              Logo
            </span>
          )}
        </div>
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
          <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">
            PNG, JPG, WEBP or SVG · max 2 MB
          </p>
        </div>
      </div>
    </Field>
  )
}
