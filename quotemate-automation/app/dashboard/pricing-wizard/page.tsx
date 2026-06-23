'use client'

// /dashboard/pricing-wizard — 3-step guided onboarding for tradies who
// don't have a trade book PDF to upload. The wizard collects the same
// data the dashboard's pricing/services/brand-prefs sections accept,
// then PATCHes /api/tenant/me with everything in one call at the end.
//
// Three steps, single page (no router navigation — state is local):
//   1. Rate card    — hourly / call-out / markup / after-hours multiplier
//   2. Services     — toggle the shared_assemblies you offer
//   3. Brands       — preferred brand per category
//
// On finish: PATCH /api/tenant/me with the full payload, then redirect
// to /dashboard with ?welcome=1 so the dashboard knows to show a banner.
//
// Maintain Technology design system — dark navy + orange + numbered
// step rail, same patterns the /admin/loader page already established.

import { useCallback, useEffect, useState } from 'react'
import { BrandMark } from '@/app/_components/BrandMark'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  buildPatchPayload,
  categoriesForTrades,
  commonBrandsForTrades,
  STEP_LABELS,
  type BrandPreferences,
  type RateCard,
  type ServiceToggles,
  type StepIndex,
  type WizardCategory,
} from '@/lib/dashboard/pricing-wizard'

// ─── Maintain design-system button styles ─────────────────────────────
const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 bg-accent px-6 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-40'
const BTN_GHOST =
  'inline-flex items-center justify-center gap-2 border border-ink-line bg-transparent px-6 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-text-sec transition-colors hover:border-text-dim hover:text-text-pri disabled:cursor-not-allowed disabled:opacity-40'

type AssemblySummary = {
  id: string
  name: string
  trade: string
  category: string | null
  enabled: boolean
}

type Tenant = {
  id: string
  business_name: string | null
  trade: string | null
  trades: string[] | null
}

type LoadedState = {
  tenant: Tenant
  assemblies: AssemblySummary[]
  pricing: {
    hourly_rate?: number | null
    call_out_minimum?: number | null
    default_markup_pct?: number | null
    after_hours_multiplier?: number | null
  }
  brands: Record<string, string | null>
}

export default function PricingWizardPage() {
  const [step, setStep] = useState<StepIndex>(0)
  const [loaded, setLoaded] = useState<LoadedState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  // Step-1 state — rate card
  const [hourly, setHourly] = useState('')
  const [callOut, setCallOut] = useState('')
  const [markup, setMarkup] = useState('')
  const [afterHours, setAfterHours] = useState('')

  // Step-2 state — services toggle map (assembly_id → enabled)
  const [services, setServices] = useState<ServiceToggles>({})

  // Step-3 state — brand prefs by category
  const [brands, setBrands] = useState<BrandPreferences>({})

  const token = useCallback(async () => {
    const { data } = await getBrowserSupabase().auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  // Load current state on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const t = await token()
        if (!t) {
          setError('You need to be signed in. Open /signin in a new tab and try again.')
          return
        }
        const res = await fetch('/api/tenant/me', {
          headers: { authorization: `Bearer ${t}` },
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data?.error ?? `Could not load your profile (${res.status})`)
          return
        }
        if (cancelled) return

        // Shape: /api/tenant/me returns tenant, pricing array per trade,
        // services array, material_preferences array. Reduce to what the
        // wizard needs.
        const tenant: Tenant = {
          id: data.tenant?.id ?? '',
          business_name: data.tenant?.business_name ?? null,
          trade: data.tenant?.trade ?? null,
          trades: data.tenant?.trades ?? null,
        }
        const pricingRows = (data.pricing_by_trade ?? data.pricing ?? []) as Array<{
          hourly_rate?: number | string | null
          call_out_minimum?: number | string | null
          default_markup_pct?: number | string | null
          after_hours_multiplier?: number | string | null
        }>
        // Use the first pricing row (legacy /api/tenant/me may return a
        // single object; for cross-trade tenants we show one shared rate
        // card — the dashboard's per-trade editing remains the place to
        // diverge them later).
        const first = Array.isArray(pricingRows) ? pricingRows[0] : pricingRows
        const pricing = {
          hourly_rate: numOrNull(first?.hourly_rate),
          call_out_minimum: numOrNull(first?.call_out_minimum),
          default_markup_pct: numOrNull(first?.default_markup_pct),
          after_hours_multiplier: numOrNull(first?.after_hours_multiplier),
        }

        // /api/tenant/me returns `assembly_id` (uuid) on each service —
        // NOT `id`. Reading `s.id` here produced empty-string keys in the
        // toggles map and tripped the route's `z.string().uuid()` check
        // on PATCH (surfaced as `invalid_payload`). Fall through to `s.id`
        // for forward-compat in case the shape ever changes back.
        const assemblies: AssemblySummary[] = ((data.services ?? []) as any[])
          .map((s) => ({
            id: String(s.assembly_id ?? s.id ?? ''),
            name: String(s.name ?? ''),
            trade: String(s.trade ?? ''),
            category: s.category ?? null,
            enabled: !!s.enabled,
          }))
          .filter((a) => a.id.length > 0)

        // /api/tenant/me returns material_preferences as a Record map
        // (category → brand). Older / hypothetical builds may return an
        // array of {category, brand} rows — handle both shapes
        // defensively so a future shape change doesn't crash the wizard
        // with "object is not iterable".
        const brandsMap: Record<string, string | null> = {}
        const prefs: unknown = data.material_preferences ?? {}
        if (Array.isArray(prefs)) {
          for (const m of prefs as Array<{ category?: string; brand?: string | null }>) {
            if (m.category) brandsMap[m.category] = m.brand ?? null
          }
        } else if (prefs && typeof prefs === 'object') {
          for (const [category, brand] of Object.entries(
            prefs as Record<string, string | null>,
          )) {
            if (category) brandsMap[category] = (brand as string | null) ?? null
          }
        }

        setLoaded({ tenant, assemblies, pricing, brands: brandsMap })

        // Pre-fill the rate-card inputs with whatever is already on the
        // tradie's book.
        if (pricing.hourly_rate != null) setHourly(String(pricing.hourly_rate))
        if (pricing.call_out_minimum != null) setCallOut(String(pricing.call_out_minimum))
        if (pricing.default_markup_pct != null) setMarkup(String(pricing.default_markup_pct))
        if (pricing.after_hours_multiplier != null) setAfterHours(String(pricing.after_hours_multiplier))
        // Pre-fill toggle map with current state.
        const initialToggles: ServiceToggles = {}
        for (const a of assemblies) initialToggles[a.id] = a.enabled
        setServices(initialToggles)
        // Pre-fill brands.
        setBrands(brandsMap)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const tradeList = (loaded?.tenant.trades && loaded.tenant.trades.length > 0
    ? loaded.tenant.trades
    : loaded?.tenant.trade
      ? [loaded.tenant.trade]
      : []) as string[]

  const categories: WizardCategory[] = categoriesForTrades(tradeList)
  const quickFillBrands: string[] = commonBrandsForTrades(tradeList)

  /** Stamp `brand` onto every visible category. Overwrites whatever the
   *  tradie has typed — that's the literal "fill all" semantics. They
   *  can still edit individual fields afterwards. */
  function fillAllBrands(brand: string) {
    setBrands((prev) => {
      const next: BrandPreferences = { ...prev }
      for (const c of categories) next[c.slug] = brand
      return next
    })
  }

  /** Empty every visible category. Mirrors `fillAllBrands` but with the
   *  empty-string sentinel — buildPatchPayload turns those into nulls so
   *  the PATCH route deletes the existing rows on save. */
  function clearAllBrands() {
    setBrands((prev) => {
      const next: BrandPreferences = { ...prev }
      for (const c of categories) next[c.slug] = ''
      return next
    })
  }

  function buildRateCard(): RateCard | null {
    const h = Number(hourly)
    const co = Number(callOut)
    const mu = Number(markup)
    const ah = Number(afterHours)
    if (
      !Number.isFinite(h) || h <= 0 ||
      !Number.isFinite(co) || co < 0 ||
      !Number.isFinite(mu) || mu < 0 || mu > 100 ||
      !Number.isFinite(ah) || ah < 1 || ah > 3
    ) return null
    return {
      hourly_rate: h,
      call_out_minimum: co,
      default_markup_pct: mu,
      after_hours_multiplier: ah,
    }
  }

  async function handleFinish() {
    setError(null)
    setInfo(null)
    const rateCard = buildRateCard()
    if (!rateCard) {
      setError('Please complete the rate card — hourly rate, call-out, markup % (0-100), and after-hours multiplier (1-3).')
      setStep(0)
      return
    }
    setSaving(true)
    try {
      const t = await token()
      if (!t) { setError('Session expired — sign in again.'); return }
      const body = buildPatchPayload({
        rateCard,
        services,
        brands,
      })
      if (!body) {
        setError('Nothing to save — fill in at least the rate card.')
        return
      }
      const res = await fetch('/api/tenant/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || data?.error) {
        setError(data?.error ?? `Save failed (${res.status})`)
        return
      }
      setInfo('Saved. Redirecting to your dashboard…')
      // Brief pause so the success message is visible.
      setTimeout(() => {
        window.location.href = '/dashboard?welcome=1'
      }, 800)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (error && !loaded) {
    return (
      <Layout>
        <Banner tone="danger">{error}</Banner>
      </Layout>
    )
  }

  if (!loaded) {
    return (
      <Layout>
        <p className="mt-10 font-mono text-xs uppercase tracking-[0.14em] text-text-dim">
          Loading your current setup…
        </p>
      </Layout>
    )
  }

  return (
    <Layout>
      <header>
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-text-dim">
          QuoteMax · {loaded.tenant.business_name ?? 'Tradie'}
        </span>
        <h1 className="mt-4 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.25rem,5vw,3.5rem)]">
          Pricing <span className="text-accent">wizard</span>
        </h1>
        <p className="mt-5 max-w-[58ch] leading-relaxed text-text-sec">
          Three short steps to set up your cookbook. We&apos;ll save your
          rate card, the jobs you do, and your preferred brands — and the
          AI will use them straight away when customers text you.
        </p>
      </header>

      <StepRail current={step} />

      {error && <Banner tone="danger">{error}</Banner>}
      {info && <Banner tone="info">{info}</Banner>}

      {step === 0 && (
        <StepCard n="01" title="Your rate card">
          <p className="text-sm text-text-sec leading-relaxed">
            How you charge. These set the maths for every quote — labour
            multiplied by your hourly rate, parts marked up by your
            default %, after-hours jobs inflated by your multiplier.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <NumberInput
              label="Hourly rate ($)"
              hint="ex-GST, in dollars per hour"
              value={hourly}
              onChange={setHourly}
              placeholder="120"
            />
            <NumberInput
              label="Call-out minimum ($)"
              hint="ex-GST, base fee for showing up"
              value={callOut}
              onChange={setCallOut}
              placeholder="150"
            />
            <NumberInput
              label="Default markup on materials (%)"
              hint="e.g. 30 means a $100 part becomes $130 on the quote"
              value={markup}
              onChange={setMarkup}
              placeholder="30"
            />
            <NumberInput
              label="After-hours multiplier"
              hint="e.g. 1.5 = 50% more for emergency / weekend jobs"
              value={afterHours}
              onChange={setAfterHours}
              placeholder="1.5"
            />
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" onClick={() => setStep(1)} className={BTN_PRIMARY}>
              Continue →
            </button>
            <a href="/dashboard" className={BTN_GHOST}>
              Skip the wizard
            </a>
          </div>
        </StepCard>
      )}

      {step === 1 && (
        <StepCard n="02" title="Which jobs do you do?">
          <p className="text-sm text-text-sec leading-relaxed">
            Toggle the services you offer. Any you turn off here will be
            politely declined when a customer asks about them in chat
            — they won&apos;t end up on a quote you can&apos;t deliver.
          </p>

          {loaded.assemblies.length === 0 ? (
            <p className="mt-5 text-sm text-text-dim">
              No services in your trade catalogue yet — talk to QuoteMax support.
            </p>
          ) : (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {loaded.assemblies.map((a) => (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-start gap-3 border border-ink-line bg-ink-deep px-4 py-3 hover:border-text-dim"
                >
                  <input
                    type="checkbox"
                    checked={services[a.id] ?? false}
                    onChange={(e) =>
                      setServices((s) => ({ ...s, [a.id]: e.target.checked }))
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#FFC400]"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-text-pri">
                      {a.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
                      {a.trade}{a.category ? ` · ${a.category}` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" onClick={() => setStep(0)} className={BTN_GHOST}>
              ← Back
            </button>
            <button type="button" onClick={() => setStep(2)} className={BTN_PRIMARY}>
              Continue →
            </button>
          </div>
        </StepCard>
      )}

      {step === 2 && (
        <StepCard n="03" title="Preferred brands">
          <p className="text-sm text-text-sec leading-relaxed">
            Optional. For each kind of part you install, type the brand
            you prefer (Clipsal Iconic, HPM, Rinnai, etc.). When a quote
            includes that kind of part, the AI will lean toward your
            brand. Leave blank to let the AI pick from any matching
            product.
          </p>

          {categories.length === 0 ? (
            <p className="mt-5 text-sm text-text-dim">
              Your trade isn&apos;t set yet — finish without brand prefs
              and update on the dashboard later.
            </p>
          ) : (
            <>
              {quickFillBrands.length > 0 && (
                <div className="mt-5 flex flex-wrap items-center gap-2 border border-ink-line bg-ink-deep px-4 py-3">
                  <span className="mr-2 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
                    Fill all with
                  </span>
                  {quickFillBrands.map((brand) => (
                    <button
                      key={brand}
                      type="button"
                      onClick={() => fillAllBrands(brand)}
                      className="border border-ink-line bg-ink-card px-3 py-1.5 text-xs font-semibold text-text-pri transition-colors hover:border-accent hover:text-accent"
                    >
                      {brand}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearAllBrands}
                    className="border border-ink-line bg-transparent px-3 py-1.5 text-xs font-semibold text-text-dim transition-colors hover:border-text-dim hover:text-text-pri"
                  >
                    Clear
                  </button>
                </div>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {categories.map((c) => (
                  <label key={c.slug} className="block">
                    <span className="text-xs text-text-dim">{c.label}</span>
                    <input
                      type="text"
                      value={brands[c.slug] ?? ''}
                      onChange={(e) =>
                        setBrands((b) => ({ ...b, [c.slug]: e.target.value }))
                      }
                      placeholder="e.g. Clipsal"
                      className="mt-1 block w-full border border-ink-line bg-ink-card px-3 py-2 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" onClick={() => setStep(1)} className={BTN_GHOST}>
              ← Back
            </button>
            <button type="button" onClick={handleFinish} disabled={saving} className={BTN_PRIMARY}>
              {saving ? 'Saving…' : 'Save & finish'}
            </button>
          </div>
        </StepCard>
      )}
    </Layout>
  )
}

// ─── Tiny page-local components (mirror /admin/loader's patterns) ────

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <nav className="relative z-10 border-b border-ink-line bg-ink-deep/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <a href="/dashboard" className="flex min-w-0 items-center gap-2.5">
            <BrandMark className="h-7 w-7" />
            <span className="font-extrabold uppercase tracking-tight">QuoteMax</span>
            <span className="text-text-dim">/</span>
            <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-sec">
              Wizard
            </span>
          </a>
          <a
            href="/dashboard"
            className="shrink-0 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-sec transition-colors hover:text-text-pri"
          >
            ← Dashboard
          </a>
        </div>
      </nav>
      <div className="relative z-10 mx-auto max-w-5xl px-6 py-14 md:py-16">{children}</div>
    </main>
  )
}

function StepRail({ current }: { current: StepIndex }) {
  return (
    <ol className="mt-10 grid grid-cols-3 gap-px border border-ink-line bg-ink-line">
      {STEP_LABELS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming'
        return (
          <li
            key={label}
            className={`border-b-2 bg-ink-card px-4 py-4 ${
              state === 'current' ? 'border-accent' : 'border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`font-mono text-xl font-bold leading-none ${
                  state === 'upcoming' ? 'text-text-dim' : 'text-accent'
                }`}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={`font-mono text-[0.7rem] font-bold uppercase tracking-[0.14em] ${
                  state === 'upcoming' ? 'text-text-dim' : 'text-text-pri'
                }`}
              >
                {label}
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[0.56rem] uppercase tracking-[0.16em] text-text-dim">
              {state === 'done' ? '✓ Done' : state === 'current' ? 'In progress' : 'Upcoming'}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function StepCard({
  n,
  title,
  children,
}: {
  n: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-8 border border-ink-line bg-ink-card">
      <header className="flex items-center gap-5 border-b border-ink-line px-6 py-5 md:px-8">
        <span className="font-mono text-4xl font-bold leading-none text-accent md:text-5xl">
          {n}
        </span>
        <h2 className="font-extrabold uppercase tracking-tight text-lg md:text-xl">
          {title}
        </h2>
      </header>
      <div className="px-6 py-6 md:px-8">{children}</div>
    </section>
  )
}

function Banner({ tone, children }: { tone: 'danger' | 'info'; children: React.ReactNode }) {
  const cls =
    tone === 'danger'
      ? 'border-[#B91C1C]/55 bg-[#B91C1C]/12 text-[#FCA5A5]'
      : 'border-teal-glow/45 bg-teal-glow/10 text-teal-glow'
  return (
    <div className={`mt-6 border px-4 py-3 text-sm leading-relaxed ${cls}`}>
      {children}
    </div>
  )
}

function NumberInput({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-xs text-text-dim">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full border border-ink-line bg-ink-card px-3 py-2 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
      />
      {hint && (
        <span className="mt-1 block font-mono text-[0.65rem] text-text-dim">
          {hint}
        </span>
      )}
    </label>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : null
}
