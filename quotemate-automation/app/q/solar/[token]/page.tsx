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
// TRANSPARENCY LAYER: each hero stat carries a native-<details>
// "why this number?" explainer (buildSolarStatExplainers) and the
// assumptions panel shows value / source / meaning / sensitivity per
// assumption (buildSolarAssumptionsView). Both are pure view models over
// persisted estimate fields — the page stays a server component with no
// client JS.
//
// Maintain Technology brand: dark navy, vibrant orange, all-caps display.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type { SolarEstimate } from '@/lib/solar/types'
import { resolveSolarQuoteView } from '@/lib/solar/quote-page-row'
import { buildSolarTierCards } from '@/lib/solar/tier-cards'
import { buildHeroOverlay } from '@/lib/solar/hero-overlay'
import { buildSolarStatExplainers, type SolarStatExplainer } from '@/lib/solar/explainers'
import { buildSolarAssumptionsView, type SolarAssumptionRow } from '@/lib/solar/assumptions-view'
import { confidenceChip } from '@/lib/solar/confidence-chip'
import { resolveSolarDepositCta } from '@/lib/solar/deposit-cta'
import {
  SOLAR_COMPLIANCE_COPY,
  SOLAR_PRE_CONFIRM_COPY,
} from '@/lib/solar/compliance-copy'
import { money, kwh, kw, paybackBand } from '@/lib/solar/quote-page-format'

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

/** Staggered fade-up entrance, gated behind prefers-reduced-motion. */
function reveal(delayMs: number): string {
  return `motion-safe:animate-[fade-up_260ms_ease-out_both] [animation-delay:${delayMs}ms]`
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
  const explainers = buildSolarStatExplainers(estimate)
  const assumptions = buildSolarAssumptionsView(estimate)

  const chipBorder = chip.tone === 'warning' ? 'border-l-warning' : 'border-l-accent'
  const chipText = chip.tone === 'warning' ? 'text-warning' : 'text-accent'

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      {/* Topographic background — signature Maintain motif. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.10]"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <path d="M0,820 Q240,640 480,730 T960,680 T1440,740 T1920,640" stroke="var(--teal-glow)" strokeWidth="1" fill="none" />
        <path d="M0,880 Q260,700 520,790 T1000,740 T1480,800 T1920,700" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.7" />
        <path d="M0,940 Q280,770 560,850 T1040,800 T1520,860 T1920,770" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.45" />
        <path d="M0,180 Q320,300 640,220 T1280,260 T1920,190" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.35" />
        <path d="M0,110 Q300,230 600,150 T1240,190 T1920,120" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.2" />
      </svg>

      <section className="relative z-10 mx-auto max-w-4xl px-6 pt-14 pb-10 sm:px-10">
        <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent ${reveal(0)}`}>
          QuoteMate · Solar
        </div>
        <h1 className={`mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,5vw,3.5rem)] ${reveal(60)}`}>
          Your solar <span className="text-accent">estimate</span>
        </h1>
        {row.address && (
          <p className={`mt-4 text-lg text-text-sec ${reveal(120)}`}>{row.address}</p>
        )}

        {/* Confidence chip */}
        <div className={reveal(180)}>
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
        </div>

        {/* Hero: real satellite roof photo + stats overlay */}
        <div className={`mt-8 overflow-hidden border border-ink-line bg-ink-card ${reveal(240)}`}>
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

        {/* The numbers, explained — expandable "why?" per hero stat. */}
        <div className={`mt-10 ${reveal(300)}`}>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
              The numbers, explained
            </span>
            <span className="h-px flex-1 bg-ink-line" aria-hidden />
          </div>
          <p className="mt-2 max-w-2xl text-sm text-text-sec">
            Every figure above traces back to a measurement or a published
            rate. Open any number to see exactly how it was worked out —
            the same trail your installer reviews.
          </p>
          <div className="mt-5 grid gap-px bg-ink-line sm:grid-cols-2">
            {explainers.map((e) => (
              <ExplainerCard key={e.key} explainer={e} />
            ))}
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
            <div className="flex items-center gap-4">
              <span className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
                System options · {cards.length} size{cards.length === 1 ? '' : 's'}
              </span>
              <span className="h-px flex-1 bg-ink-line" aria-hidden />
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((c, i) => {
                const cta = resolveSolarDepositCta({
                  confirmed: view.confirmed,
                  token,
                  tier: c.tier,
                  inspectionRequired: view.inspectionRequired,
                })
                return (
                  <article key={c.tier} className="flex flex-col border border-ink-line bg-ink-card p-6">
                    <div className="flex items-baseline gap-4">
                      <span className="font-mono text-4xl font-bold leading-none text-accent">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                        {TIER_NAME[c.tier]} · {c.label}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
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
                          className="block bg-accent px-5 py-3 text-center font-mono text-sm font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-accent-press"
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

        {/* Always-visible assumptions panel — value, source, meaning, direction. */}
        <div className="mt-10 border border-ink-line bg-ink-card p-6 sm:p-7">
          <div className="flex items-center gap-4">
            <span className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              Assumptions — shown, not hidden
            </span>
            <span className="h-px flex-1 bg-ink-line" aria-hidden />
          </div>
          <p className="mt-2 max-w-2xl text-sm text-text-sec">
            These are the levers behind the savings and payback figures.
            Each one shows the value we used, where it comes from, and
            which way your numbers move if your household differs.
          </p>
          <div className="mt-5 grid gap-px bg-ink-line">
            {assumptions.rows.map((r) => (
              <AssumptionRow key={r.key} row={r} />
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-text-dim">{assumptions.footnote}</p>
        </div>

        {/* Mandatory SAA/CEC compliance copy */}
        <p className="mt-8 text-sm text-text-dim">{SOLAR_COMPLIANCE_COPY}</p>
      </section>

      <div className="relative z-10 bg-accent px-6 py-5 text-center text-white">
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

/**
 * One expandable "why this number?" card. Native <details> keeps the
 * page a pure server component — no client JS, works without hydration.
 */
function ExplainerCard({ explainer }: { explainer: SolarStatExplainer }) {
  return (
    <details className="group bg-ink-card">
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 transition-colors hover:bg-ink [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
            {explainer.statLabel}
          </div>
          <div className="mt-1 font-mono text-xl font-bold tabular-nums text-accent">
            {explainer.statValue}
          </div>
        </div>
        <span className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors group-open:text-accent group-hover:text-text-sec">
          {explainer.question}
        </span>
        <span
          className="font-mono text-xl leading-none text-accent transition-transform duration-200 group-open:rotate-45"
          aria-hidden
        >
          +
        </span>
      </summary>

      <div className="border-t border-ink-line px-5 py-5">
        <p className="text-sm leading-relaxed text-text-sec">{explainer.answer}</p>

        {explainer.steps.length > 0 && (
          <ol className="mt-4 space-y-2.5">
            {explainer.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-sm font-bold leading-5 text-accent">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-sm leading-relaxed text-text-sec">{step}</span>
              </li>
            ))}
          </ol>
        )}

        {explainer.facts.length > 0 && (
          <dl className="mt-4 grid gap-px overflow-hidden border border-ink-line bg-ink-line sm:grid-cols-2">
            {explainer.facts.map((f) => (
              <div key={f.label} className="bg-ink-deep px-3.5 py-2.5">
                <dt className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                  {f.label}
                </dt>
                <dd className="mt-1 font-mono text-sm font-bold tabular-nums text-text-pri">
                  {f.value}
                </dd>
                {f.note && <dd className="mt-0.5 text-xs leading-snug text-text-dim">{f.note}</dd>}
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  )
}

/** One transparent assumption: value, source, meaning, direction of effect. */
function AssumptionRow({ row }: { row: SolarAssumptionRow }) {
  return (
    <div className="grid gap-3 bg-ink-deep px-5 py-4 md:grid-cols-[14rem_1fr]">
      <div>
        <div className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
          {row.label}
        </div>
        <div className="mt-1.5 font-mono text-base font-bold tabular-nums text-accent">
          {row.value}
        </div>
        <div className="mt-1.5 font-mono text-[0.62rem] uppercase leading-relaxed tracking-[0.14em] text-text-dim">
          Source · {row.source}
        </div>
      </div>
      <div className="text-sm leading-relaxed">
        <p className="text-text-sec">{row.meaning}</p>
        <p className="mt-1.5 text-text-dim">
          <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-teal-glow">
            If it moves ·{' '}
          </span>
          {row.sensitivity}
        </p>
      </div>
    </div>
  )
}
