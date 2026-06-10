// Customer-facing public solar estimate page (spec §6). Token-gated
// against solar_estimates.public_token (unguessable); service-role client
// because this is a public sharing surface.
//
// CONFIRM GATE: prices + deposit CTA are hidden until the tradie confirms
// (solar_estimates.confirmed_at set). Before that the page shows the real
// satellite roof photo + stats overlay framed "indicative — your installer
// confirms". After confirmation it shows the full priced tier breakdown
// (kW, panels, yearly kWh, gross → STC subtraction → net, annual savings,
// banded payback), the always-visible assumptions panel, the confidence
// chip, the mandatory SAA/CEC compliance copy, and the per-tier deposit
// CTA (reusing /r/[token]/[tier]).
//
// Maintain Technology brand: dark navy, vibrant orange, all-caps display.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type { SolarEstimate } from '@/lib/solar/types'
import { resolveSolarQuoteView } from '@/lib/solar/quote-page-row'
import { buildSolarTierCards } from '@/lib/solar/tier-cards'
import { buildHeroOverlay } from '@/lib/solar/hero-overlay'
import { confidenceChip } from '@/lib/solar/confidence-chip'
import { resolveSolarDepositCta } from '@/lib/solar/deposit-cta'
import {
  SOLAR_COMPLIANCE_COPY,
  SOLAR_PRE_CONFIRM_COPY,
} from '@/lib/solar/compliance-copy'
import { money, kwh, kw, paybackBand, pct, perKwh } from '@/lib/solar/quote-page-format'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Row = {
  address: string | null
  state: string | null
  estimate: SolarEstimate | null
  confirmed_at: string | null
}

const TIER_NAME: Record<'good' | 'better' | 'best', string> = {
  good: 'Starter',
  better: 'Full-size',
  best: 'Premium',
}

export default async function SolarQuotePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()

  const { data, error } = await supabase
    .from('solar_estimates')
    .select('address, state, estimate, confirmed_at')
    .eq('public_token', token)
    .maybeSingle()

  if (error || !data) notFound()
  const row = data as Row
  const estimate = row.estimate
  if (!estimate) notFound()

  const view = resolveSolarQuoteView({ estimate, confirmedAt: row.confirmed_at })
  const chip = confidenceChip({
    band: estimate.confidence_band,
    coverageSource: estimate.coverage_source,
  })
  const cards = buildSolarTierCards({
    price: estimate.price,
    production: estimate.production,
    economics: estimate.economics,
  })
  const headlineProd = estimate.production[estimate.production.length - 1]
  const overlay = buildHeroOverlay({
    headlineTier: view.headlineTier,
    roof: estimate.roof,
    annualKwhAc: headlineProd?.annual_kwh_ac ?? 0,
  })
  const a = estimate.economics.assumptions

  const chipBorder = chip.tone === 'warning' ? 'border-l-warning' : 'border-l-accent'
  const chipText = chip.tone === 'warning' ? 'text-warning' : 'text-accent'

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="mx-auto max-w-4xl px-6 pt-14 pb-10 sm:px-10">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
          QuoteMate · Solar
        </div>
        <h1 className="mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,5vw,3.5rem)]">
          Your solar <span className="text-accent">estimate</span>
        </h1>
        {row.address && <p className="mt-4 text-lg text-text-sec">{row.address}</p>}

        {/* Confidence chip */}
        <div className={`mt-6 inline-flex items-center gap-3 border border-ink-line ${chipBorder} border-l-4 bg-ink-card px-4 py-2`}>
          <span className={`font-mono text-sm font-semibold uppercase tracking-[0.16em] ${chipText}`}>
            {chip.bandLabel}
          </span>
          {chip.indicativeOnly && (
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-warning">
              Indicative only
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-text-dim">{chip.caption}</p>

        {/* Hero: real satellite roof photo + stats overlay */}
        <div className="mt-8 overflow-hidden border border-ink-line bg-ink-card">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/solar/q/${token}/static-map`}
              alt={`Satellite view of the roof at ${row.address ?? 'the property'}`}
              className="h-112 w-full object-cover sm:h-128"
            />
            <div className="absolute inset-x-0 bottom-0 grid grid-cols-2 gap-px bg-ink-line/60 sm:grid-cols-4">
              {overlay.stats.map((s) => (
                <div key={s.label} className="bg-ink-deep/85 px-4 py-3">
                  <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                    {s.label}
                  </div>
                  <div className="mt-1 font-mono text-base font-bold tabular-nums text-accent">
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
            {overlay.caption}
          </div>
        </div>

        {/* Pre-confirmation notice */}
        {!view.showPrices && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-accent bg-ink-card px-6 py-5">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              {view.inspectionRequired ? 'On-site check needed' : 'Estimate drafted'}
            </div>
            <p className="mt-2 text-base text-text-sec">
              {view.inspectionRequired
                ? (estimate.routing.reason ||
                  'This roof needs a quick look on site before we can finalise a price.')
                : SOLAR_PRE_CONFIRM_COPY}
            </p>
          </div>
        )}

        {/* Tier cards — shown only once confirmed */}
        {view.showPrices && (
          <div className="mt-10 space-y-6">
            <div className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
              System options · {cards.length} size{cards.length === 1 ? '' : 's'}
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => {
                const cta = resolveSolarDepositCta({
                  confirmed: view.confirmed,
                  token,
                  tier: c.tier,
                  inspectionRequired: view.inspectionRequired,
                })
                return (
                  <article key={c.tier} className="flex flex-col border border-ink-line bg-ink-card p-6">
                    <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                      {TIER_NAME[c.tier]} · {c.label}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <MiniStat label="System" value={`${kw(c.systemKwDc)} kW`} />
                      <MiniStat label="Panels" value={String(estimate.sizing.tiers.find((t) => t.tier === c.tier)?.panels_count ?? 0)} />
                      <MiniStat label="Yearly output" value={`${kwh(c.annualKwhAc)} kWh`} />
                      <MiniStat label="Annual saving" value={`$${money(c.annualSavingsAud)}`} />
                    </div>

                    {/* Gross → STC subtraction → net */}
                    <div className="mt-5 space-y-1.5 border-t border-ink-line pt-4 font-mono text-sm tabular-nums">
                      <div className="flex justify-between text-text-sec">
                        <span>Gross (inc GST)</span>
                        <span>${money(c.grossIncGst)}</span>
                      </div>
                      <div className="flex justify-between text-text-sec">
                        <span>STC rebate ({c.stcCertificates} certs)</span>
                        <span>−${money(c.stcRebateAud)}</span>
                      </div>
                      <div className="flex justify-between border-t border-ink-line pt-2 text-base font-bold text-accent">
                        <span>Net (inc GST)</span>
                        <span>${money(c.netIncGst)}</span>
                      </div>
                    </div>

                    <div className="mt-4 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                      Payback {paybackBand(c.paybackLow, c.paybackHigh)}
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-text-sec">{c.scope}</p>

                    {/* Gated deposit CTA */}
                    <div className="mt-5 pt-2">
                      {cta.show ? (
                        <a
                          href={cta.href}
                          className="block bg-accent px-5 py-3 text-center font-mono text-sm font-semibold uppercase tracking-[0.16em] text-white hover:bg-accent-press"
                        >
                          Pay deposit
                        </a>
                      ) : (
                        <div className="text-center font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                          {SOLAR_PRE_CONFIRM_COPY}
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}

        {/* Always-visible assumptions panel */}
        <div className="mt-10 border border-ink-line bg-ink-card p-6 sm:p-7">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Assumptions
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat label="Self-consumption" value={pct(a.self_consumption_pct)} />
            <MiniStat label="Retail rate" value={perKwh(a.retail_rate_aud_per_kwh)} />
            <MiniStat label="Feed-in tariff" value={perKwh(a.feed_in_tariff_aud_per_kwh)} hint={a.feed_in_network} />
            <MiniStat
              label="STC params"
              value={`×${headlineProd?.derate_applied ?? 0} derate`}
              hint={`config ${estimate.config_version}`}
            />
          </div>
        </div>

        {/* Mandatory SAA/CEC compliance copy */}
        <p className="mt-8 text-sm text-text-dim">{SOLAR_COMPLIANCE_COPY}</p>
      </section>

      <div className="bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMate · Solar
        </span>
      </div>
    </main>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-deep p-4">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}
