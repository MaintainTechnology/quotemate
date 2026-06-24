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

      {/* ── Inspection note OR tiers ── */}
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
                {/* Deposit (R12): no paint deposit flow wired yet — clear,
                    non-dead state per the spec's missing-link edge case. */}
                <div className="mt-6 border border-ink-line px-4 py-3 text-center font-mono text-[0.72rem] uppercase tracking-[0.14em] text-text-dim">
                  Contact us to book
                </div>
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
