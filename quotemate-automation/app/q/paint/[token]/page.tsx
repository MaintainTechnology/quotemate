// Public, read-only residential painting quote (spec R11/R21).
// Token = painting_measurements.public_token — unguessable, same trust model
// as /q/[token]. Service-role read because this is a public sharing surface.
//
// Renders the deterministic PaintingEstimate (lib/painting/types.ts) in a
// painting-appropriate format — scopes, derived paintable area, and the three
// price tiers as inc-GST RANGES (the estimate is a band, not a point) — instead
// of the electrical Good/Better/Best line-item card.
//
// Deposit (R12): painting has no Stripe deposit flow wired yet (no stripe_links
// column / no /r/paint route). The Pay Deposit CTA therefore renders in the
// spec's "no deposit link → clear disabled state" mode until that flow exists.

import { createClient } from '@supabase/supabase-js'
import type { PaintingEstimate, PaintScope, PaintingPriceTier } from '@/lib/painting/types'
import { asQuoteTierMode, resolveVisibleTiers, type QuoteTierMode } from '@/lib/quote/tier-visibility'
import { canShowPaintingPrices } from '@/lib/painting/publish-gate'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const aud = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const SCOPE_LABEL: Record<PaintScope, string> = {
  walls: 'Walls',
  ceilings: 'Ceilings',
  trim: 'Trim & doors',
  exterior: 'Exterior',
}

export default async function PaintingQuotePage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params

  const { data: row } = await supabase
    .from('painting_measurements')
    .select(
      'address, postcode, state, scopes, confidence, routing, estimate, public_token, customer_name, created_at, tenant_id, tenants:tenant_id(business_name)',
    )
    .eq('public_token', token)
    .maybeSingle()

  if (!row || !row.estimate) {
    return (
      <Shell>
        <section className="border-2 border-warning/50 bg-ink-card p-8 sm:p-10">
          <div className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.15em] text-warning">
            Invalid link
          </div>
          <h1 className="text-3xl font-extrabold uppercase tracking-tight text-text-pri sm:text-4xl">
            Quote not found
          </h1>
          <p className="mt-4 text-base leading-relaxed text-text-sec sm:text-lg">
            This quote link is invalid or has expired. Text us if you need it re-sent.
          </p>
        </section>
      </Shell>
    )
  }

  const business =
    (row.tenants as { business_name?: string } | null)?.business_name ?? 'Your painter'
  const estimate = row.estimate as PaintingEstimate
  const tiers: PaintingPriceTier[] = estimate.price?.tiers ?? []
  const measurement = estimate.measurement
  const scopes = (row.scopes as PaintScope[] | null) ?? estimate.measurement?.surfaces?.map((s) => s.scope) ?? []
  const inspection = estimate.price?.routing?.decision === 'inspection_required'

  // Mig 142 — per-feature tier presentation mode. Residential painting has no
  // quotes.selected_tier, so 'single' resolves to the Better (2-coat) baseline.
  let paintTierMode: QuoteTierMode = 'single'
  if (row.tenant_id) {
    const { data: pb } = await supabase
      .from('pricing_book')
      .select('quote_tier_mode')
      .eq('tenant_id', row.tenant_id as string)
      .eq('trade', 'painting')
      .maybeSingle()
    paintTierMode = asQuoteTierMode(
      (pb as { quote_tier_mode?: string | null } | null)?.quote_tier_mode,
    )
  }
  const visibleTierKeys = resolveVisibleTiers({
    mode: paintTierMode,
    present: {
      good: tiers.some((t) => t.tier === 'good'),
      better: tiers.some((t) => t.tier === 'better'),
      best: tiers.some((t) => t.tier === 'best'),
    },
    selectedTier: 'better',
  })
  const visibleTiers = tiers.filter((t) => visibleTierKeys.includes(t.tier))

  // Per-tier Stripe deposit links (migration 156). Read in a SEPARATE,
  // best-effort query so this LIVE page never breaks if the code deploys
  // before the migration applies (the columns simply aren't selected then →
  // payErr set → the placeholder shows). Each tier with a stored Checkout
  // session gets a "Pay deposit" button via the /r/paint short-link; a paid
  // quote shows a confirmed state instead of re-charging.
  let stripeLinks: Record<string, string> = {}
  let paid = false
  let paidTier: string | null = null
  // `released` defaults TRUE so a pre-migration deploy and every dashboard-saved
  // quote (released at save) keep showing prices; only a HELD SMS/self-serve
  // draft (released_at null) gates them until the tradie clicks Send.
  let released = true
  const { data: payRow, error: payErr } = await supabase
    .from('painting_measurements')
    .select('stripe_links, paid_at, paid_tier, released_at')
    .eq('public_token', token)
    .maybeSingle()
  if (!payErr && payRow) {
    stripeLinks = (payRow.stripe_links as Record<string, string> | null) ?? {}
    paid = !!(payRow.paid_at as string | null)
    paidTier = (payRow.paid_tier as string | null) ?? null
    released = (payRow.released_at as string | null) != null
  }
  const priceGate = canShowPaintingPrices({ releasedAt: released ? 'released' : null })

  const date = new Date(row.created_at as string).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <Shell>
      {/* ── Hero ── */}
      <section className="border border-ink-line bg-ink-card p-7 sm:p-9">
        <div className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-accent">
          Painting quote · {business}
        </div>
        <h1 className="mt-3 text-3xl font-extrabold uppercase tracking-tight text-text-pri sm:text-4xl">
          {String(row.address ?? 'Your property')}
        </h1>
        <div className="mt-2 font-mono text-sm text-text-dim">
          {[row.postcode, row.state].filter(Boolean).join(' ')} · {date}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {scopes.map((s) => (
            <span
              key={s}
              className="inline-flex items-center bg-accent/15 px-2.5 py-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-accent"
            >
              {SCOPE_LABEL[s] ?? s}
            </span>
          ))}
        </div>
      </section>

      {/* ── Measurement summary ── */}
      {measurement ? (
        <section className="mt-6 border border-ink-line bg-ink-card p-6 sm:p-7">
          <div className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
            Measured from {estimate.facts?.source ?? 'property data'}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Floor area" value={`${Math.round(measurement.floor_area_m2)} m²`} />
            <Stat label="Paintable area" value={`${Math.round(estimate.price?.total_area_m2 ?? 0)} m²`} />
            <Stat label="Storeys" value={String(measurement.storeys ?? '—')} />
            <Stat label="Confidence" value={titleCase(String(row.confidence ?? measurement.confidence ?? '—'))} />
          </div>
          {Array.isArray(measurement.surfaces) && measurement.surfaces.length > 0 ? (
            <ul className="mt-5 grid gap-2 border-t border-ink-line pt-5 sm:grid-cols-2">
              {measurement.surfaces.map((s) => (
                <li key={s.scope} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-text-sec">{SCOPE_LABEL[s.scope] ?? s.scope}</span>
                  <span className="font-mono tabular-nums text-text-pri">
                    {Math.round(s.quantity)} {s.unit === 'lm' ? 'lm' : 'm²'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* ── About your home (Geoscape / PropRadar enrichment) ── */}
      <AboutHome facts={estimate.facts} />

      {/* ── Inspection note · held-for-review note · OR tiers ── */}
      {inspection ? (
        <section className="mt-6 border border-l-4 border-ink-line border-l-accent bg-ink-card p-6 sm:p-7">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-accent">
            On-site measure needed
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-sec">
            {estimate.price?.routing?.reason ??
              'This job needs a quick on-site measure before we can lock a price. We’ll be in touch to book a time.'}
          </p>
        </section>
      ) : !priceGate.showPrices ? (
        <section className="mt-6 border border-l-4 border-ink-line border-l-accent bg-ink-card p-6 sm:p-7">
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-accent">
            Quote being finalised
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-sec">{priceGate.reason}</p>
        </section>
      ) : (
        <section className="mt-8">
          <h2 className="mb-6 font-mono text-xs uppercase tracking-[0.15em] text-text-dim">
            {visibleTiers.length === 1 ? 'Your painting option' : 'Your painting options'}
          </h2>
          <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
            {visibleTiers.map((tier) => (
              <article
                key={tier.tier}
                className="relative flex flex-col border border-ink-line bg-ink-card p-6 sm:p-7"
              >
                <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-accent">
                  {tier.label}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-text-sec">{tier.scope}</p>
                <div className="mt-5 border-t border-ink-line pt-5">
                  <div className="font-mono text-3xl font-bold tabular-nums text-text-pri">
                    {aud(tier.inc_gst)}
                  </div>
                  <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                    inc GST · range {aud(tier.inc_gst_low)}–{aud(tier.inc_gst_high)}
                  </div>
                </div>
                {/* Deposit (mig 156): a "Pay deposit" link when a Stripe
                    session exists for this tier; a confirmed state once paid;
                    otherwise the clear non-dead placeholder. */}
                {paid ? (
                  <div className="mt-6 border border-accent bg-accent/10 px-4 py-3 text-center font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-accent">
                    Deposit paid{paidTier === tier.tier ? ' ✓' : ''}
                  </div>
                ) : stripeLinks[tier.tier] ? (
                  <a
                    href={`/r/paint/${token}/${tier.tier}`}
                    className="mt-6 block border border-accent bg-accent px-4 py-3 text-center font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press"
                  >
                    Pay deposit
                  </a>
                ) : (
                  <div className="mt-6 border border-ink-line px-4 py-3 text-center font-mono text-[0.72rem] uppercase tracking-[0.14em] text-text-dim">
                    Contact us to book
                  </div>
                )}
              </article>
            ))}
          </div>
          <p className="mt-5 text-sm leading-relaxed text-text-dim">
            Prices are inc-GST estimates derived from {estimate.facts?.source ?? 'property data'} and
            your declared scope. The final price is confirmed after a quick on-site check.
          </p>
        </section>
      )}
    </Shell>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
    </div>
  )
}

// Human-meaningful building facts from the property-data enrichment
// (PropRadar attributes / Geoscape use). Renders only fields that are
// present — off-market homes with no enrichment show nothing.
function AboutHome({ facts }: { facts?: PaintingEstimate['facts'] }) {
  if (!facts) return null
  const items: Array<{ label: string; value: string }> = []
  if (facts.property_type) items.push({ label: 'Type', value: facts.property_type })
  if (facts.bedrooms != null) items.push({ label: 'Bedrooms', value: String(facts.bedrooms) })
  if (facts.bathrooms != null) items.push({ label: 'Bathrooms', value: String(facts.bathrooms) })
  if (facts.car_spaces != null) items.push({ label: 'Car spaces', value: String(facts.car_spaces) })
  if (facts.land_size_m2 != null) items.push({ label: 'Land size', value: `${Math.round(facts.land_size_m2)} m²` })
  if (items.length === 0) return null
  return (
    <section className="mt-6 border border-ink-line bg-ink-card p-6 sm:p-7">
      <div className="mb-4 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
        About your home
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {items.map((it) => (
          <Stat key={it.label} label={it.label} value={it.value} />
        ))}
      </div>
    </section>
  )
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ink-deep px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  )
}
