// Customer-facing public PYLON proposal page. Token-gated against
// pylon_proposals.public_token (unguessable); service-role client because
// this is a public sharing surface.
//
// Mirrors the Pylon web proposal's section order with QuoteMate's
// conversion layer on top:
//   cover → proposed panel layout (the engineer-authored design snapshot)
//   → strings & component markings (single-line diagram) → system details
//   → utility costs → 20-yr financial summary → financial analysis →
//   environmental → quote table + deposit payment → assumed values →
//   disclaimers.
//
// CONFIRM GATE: every section carrying a dollar figure (utility costs,
// financial summary/analysis, the quote table and the deposit CTA) is
// hidden until the tradie confirms (confirmed_at set). Geometry,
// components, production and environmental sections may render before.
//
// MONEY: the quote table renders the tradie's own Pylon line items
// verbatim. Modelled sections are QuoteMate-computed from design facts
// and are labelled "modelled". The ?session_id success redirect verifies
// the Stripe session server-side before stamping paid_at.
//
// Maintain Technology brand: dark navy, vibrant orange, all-caps display.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import { verifyPylonDepositSession } from '@/lib/pylon/checkout'
import { buildPylonModelled, type PylonModelled } from '@/lib/pylon/modelled'
import {
  buildPylonQuoteTable,
  type PylonProposalCustomer,
  type PylonProposalDesign,
  type PylonProposalSite,
} from '@/lib/pylon/proposal'
import { loadSolarConfig } from '@/lib/solar/config'
import type { SolarChart } from '@/lib/solar/charts'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Row = {
  id: string
  tenant_id: string | null
  title: string | null
  address_text: string | null
  customer: PylonProposalCustomer | null
  site: PylonProposalSite | null
  design: PylonProposalDesign | null
  assets: Record<string, string | null> | null
  confirmed_at: string | null
  paid_at: string | null
  stripe_checkout_url: string | null
}

/** Staggered fade-up entrance, gated behind prefers-reduced-motion. */
function reveal(delayMs: number): string {
  return `motion-safe:animate-[fade-up_260ms_ease-out_both] [animation-delay:${delayMs}ms]`
}

const KIND_LABEL: Record<string, string> = {
  module: 'Solar panels',
  inverter: 'Inverter',
  battery: 'Battery storage',
  material: 'Materials',
  heat_pump: 'Heat pump',
  ev_charger: 'EV charger',
  mounting: 'Mounting system',
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-14 font-extrabold uppercase leading-[1.05] tracking-[-0.03em] text-[clamp(1.4rem,3vw,2rem)]">
      {children}
    </h2>
  )
}

function ChartFigure({ chart }: { chart: SolarChart }) {
  return (
    <figure className="mt-5 border border-ink-line bg-ink-card">
      {/* Engine-built print-safe SVG — trusted, generated in-process. */}
      <div className="p-3 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: chart.svg }} />
      <figcaption className="border-t border-ink-line px-4 py-2.5 text-xs leading-relaxed text-text-dim">
        {chart.caption}
      </figcaption>
    </figure>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-ink-deep px-4 py-3.5">
      <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-text-dim">{hint}</div> : null}
    </div>
  )
}

export default async function PylonProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ session_id?: string }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()

  const { data, error } = await supabase
    .from('pylon_proposals')
    .select(
      'id, tenant_id, title, address_text, customer, site, design, assets, confirmed_at, paid_at, stripe_checkout_url',
    )
    .eq('public_token', token)
    .maybeSingle()
  if (error || !data) notFound()
  const row = data as Row
  const design = row.design
  if (!design) notFound()

  // Stripe success redirect: verify the session server-side, then stamp
  // paid_at. Idempotent — a replayed URL on a paid row is a no-op.
  let paidAt = row.paid_at
  const { session_id } = await searchParams
  if (session_id && !paidAt && row.confirmed_at) {
    const paid = await verifyPylonDepositSession(session_id, token)
    if (paid) {
      paidAt = new Date().toISOString()
      await supabase
        .from('pylon_proposals')
        .update({ paid_at: paidAt, status: 'paid', updated_at: paidAt })
        .eq('id', row.id)
    }
  }

  const confirmed = !!row.confirmed_at
  const table = buildPylonQuoteTable(design)

  // QuoteMate-modelled enrichment (production/savings/environment) —
  // labelled modelled; null when the design carries no DC kW.
  let modelled: PylonModelled | null = null
  try {
    const config = await loadSolarConfig(supabase)
    modelled = buildPylonModelled({
      design,
      state: row.site?.address?.state ?? null,
      config,
      theme: 'dark',
    })
  } catch {
    modelled = null
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('business_name')
    .eq('id', row.tenant_id)
    .maybeSingle()
  const businessName = (tenant?.business_name as string | null) ?? 'Your installer'

  const assets = row.assets ?? {}
  const snapshotUrl = assets.snapshot_path ? `/api/pylon/q/${token}/asset/snapshot` : null
  const sldUrl = assets.sld_path ? `/api/pylon/q/${token}/asset/sld` : null
  const siteInfoUrl = assets.site_info_path ? `/api/pylon/q/${token}/asset/site-info` : null

  const title = row.title ?? design.title ?? 'Your solar system'
  const dc = design.summary.dc_output_kw
  const storage = design.summary.storage_kwh

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
      </svg>

      <section className="relative z-10 mx-auto max-w-4xl px-6 pt-14 pb-16 sm:px-10">
        {/* ── 1. Cover ────────────────────────────────────────────── */}
        <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent ${reveal(0)}`}>
          {businessName} · Solar proposal
        </div>
        <h1 className={`mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,5vw,3.5rem)] ${reveal(60)}`}>
          {title.split(' ').slice(0, -1).join(' ')}{' '}
          <span className="text-accent">{title.split(' ').slice(-1)}</span>
        </h1>
        {row.customer?.name && (
          <p className={`mt-4 text-lg text-text-sec ${reveal(120)}`}>
            Prepared for {row.customer.name}
          </p>
        )}
        {row.address_text && (
          <p className={`mt-1 text-base text-text-sec ${reveal(140)}`}>{row.address_text}</p>
        )}
        <p className={`mt-3 font-mono text-xs uppercase tracking-[0.14em] text-text-dim ${reveal(160)}`}>
          Designed in Pylon studio · delivered by QuoteMate
        </p>

        {paidAt ? (
          <div className={`mt-6 border border-emerald-400/40 border-l-4 border-l-emerald-400 bg-ink-card px-4 py-3 ${reveal(180)}`}>
            <p className="text-sm font-semibold text-emerald-300">
              Deposit received — {businessName} will be in touch to schedule your installation.
            </p>
          </div>
        ) : null}
        {!confirmed ? (
          <div className={`mt-6 border border-ink-line border-l-4 border-l-accent bg-ink-card px-4 py-3 ${reveal(180)}`}>
            <p className="text-sm leading-relaxed text-text-sec">
              {businessName} is finalising this proposal. Pricing unlocks here
              the moment it&rsquo;s released — the system design below is ready
              to explore now.
            </p>
          </div>
        ) : null}

        {/* Headline stats — geometry only, safe pre-confirm. */}
        <div className={`mt-8 grid grid-cols-2 gap-px border border-ink-line bg-ink-line/60 sm:grid-cols-3 ${reveal(220)}`}>
          {dc != null ? <StatCard label="DC array power" value={`${dc.toFixed(2)} kW`} /> : null}
          {storage != null && storage > 0 ? (
            <StatCard label="Battery storage" value={`${storage.toFixed(1)} kWh`} />
          ) : null}
          {modelled ? (
            <StatCard
              label="Production (modelled)"
              value={`${modelled.annual_kwh_ac.toLocaleString('en-AU')} kWh/yr`}
              hint="QuoteMate model — CEC benchmark yield"
            />
          ) : null}
        </div>

        {/* ── 2. Proposed panel layout ───────────────────────────── */}
        {snapshotUrl ? (
          <>
            <SectionHeading>
              Proposed panel <span className="text-accent">layout</span>
            </SectionHeading>
            <figure className="mt-5 border border-ink-line bg-ink-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={snapshotUrl}
                alt="Engineer-designed panel layout on your roof"
                className="block w-full"
              />
              <figcaption className="border-t border-ink-line px-4 py-2.5 text-xs leading-relaxed text-text-dim">
                The panels exactly as your installer placed them in Pylon
                studio — this is the engineering layout, not an illustration.
              </figcaption>
            </figure>
          </>
        ) : null}

        {/* ── 3. Panel strings & component markings ──────────────── */}
        {sldUrl ? (
          <>
            <SectionHeading>
              Strings &amp; component <span className="text-accent">markings</span>
            </SectionHeading>
            <div className="mt-5 border border-ink-line bg-ink-card p-6">
              <p className="text-base leading-relaxed text-text-sec">
                The electrical single-line diagram for this design — panels,
                strings, inverter and protection devices, drawn by your
                installer.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={sldUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-accent px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press"
                >
                  Single-line diagram (PDF)
                </a>
                {siteInfoUrl ? (
                  <a
                    href={siteInfoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 border border-ink-line px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent"
                  >
                    PV site information (AS/NZS&nbsp;5033)
                  </a>
                ) : null}
              </div>
            </div>
          </>
        ) : null}

        {/* ── 4. System details ──────────────────────────────────── */}
        {design.components.length > 0 ? (
          <>
            <SectionHeading>
              System <span className="text-accent">details</span>
            </SectionHeading>
            <ul className="mt-5 space-y-3">
              {design.components.map((c, i) => (
                <li key={i} className="border border-ink-line bg-ink-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-accent">
                        {KIND_LABEL[c.kind] ?? c.kind}
                      </div>
                      <div className="mt-1.5 text-base font-semibold text-text-pri">
                        {c.datasheet?.name ?? c.description}
                      </div>
                      {c.datasheet && (c.datasheet.brand || c.datasheet.model_number) ? (
                        <div className="mt-0.5 text-sm text-text-sec">
                          {[c.datasheet.brand, c.datasheet.series, c.datasheet.model_number]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      ) : null}
                      {c.datasheet?.datasheet_url ? (
                        <a
                          href={c.datasheet.datasheet_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block font-mono text-xs font-semibold uppercase tracking-[0.12em] text-text-dim underline decoration-1 underline-offset-2 transition-colors hover:text-accent"
                        >
                          Manufacturer datasheet
                        </a>
                      ) : null}
                    </div>
                    {c.quantity != null ? (
                      <span className="shrink-0 font-mono text-2xl font-bold text-accent">
                        &times;{c.quantity}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {modelled?.charts.monthly_production ? (
          <ChartFigure chart={modelled.charts.monthly_production} />
        ) : null}

        {/* ── 5–7. Money sections — confirm-gated ─────────────────── */}
        {confirmed && modelled?.charts.utility_costs ? (
          <>
            <SectionHeading>
              Utility <span className="text-accent">costs</span>
            </SectionHeading>
            <ChartFigure chart={modelled.charts.utility_costs} />
          </>
        ) : null}

        {confirmed && modelled?.financial ? (
          <>
            <SectionHeading>
              20-year financial <span className="text-accent">summary</span>
            </SectionHeading>
            <div className="mt-5 grid grid-cols-2 gap-px border border-ink-line bg-ink-line/60 sm:grid-cols-4">
              <StatCard
                label="Net present value"
                value={`$${Math.round(modelled.financial.npv_aud).toLocaleString('en-AU')}`}
                hint={`Discounted at ${(modelled.financial.assumptions.discount_rate_pct * 100).toFixed(1)}%`}
              />
              <StatCard
                label="Payback"
                value={
                  modelled.financial.payback_years_low != null &&
                  modelled.financial.payback_years_high != null
                    ? `${Math.round(modelled.financial.payback_years_low)}\u2013${Math.round(modelled.financial.payback_years_high)} yrs`
                    : 'See installer'
                }
              />
              <StatCard
                label="Total ROI (20 yr)"
                value={`${modelled.financial.total_roi_pct.toLocaleString('en-AU')}%`}
                hint={`$${Math.round(modelled.financial.total_savings_20yr_aud).toLocaleString('en-AU')} cumulative`}
              />
              <StatCard
                label="IRR"
                value={
                  modelled.financial.irr_pct != null
                    ? `${modelled.financial.irr_pct.toLocaleString('en-AU')}%`
                    : 'See installer'
                }
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-text-dim">
              Modelled projection by QuoteMate from your designed system size
              and standard tariff assumptions — not financial advice. Actual
              results depend on your usage, tariffs and weather.
            </p>
            {modelled.charts.cumulative_savings ? (
              <ChartFigure chart={modelled.charts.cumulative_savings} />
            ) : null}
            {modelled.charts.monthly_bill ? (
              <ChartFigure chart={modelled.charts.monthly_bill} />
            ) : null}
          </>
        ) : null}

        {/* ── 8. Environmental — no $ figures, renders pre-confirm ── */}
        {modelled?.environmental ? (
          <>
            <SectionHeading>
              Environmental <span className="text-accent">analysis</span>
            </SectionHeading>
            <div className="mt-5 grid grid-cols-2 gap-px border border-ink-line bg-ink-line/60 sm:grid-cols-4">
              <StatCard
                label="CO₂e avoided / yr"
                value={`${modelled.environmental.tonnes_co2_per_year.toLocaleString('en-AU')} t`}
              />
              <StatCard
                label="CO₂e over 20 yrs"
                value={`${modelled.environmental.tonnes_co2_20yr.toLocaleString('en-AU')} t`}
              />
              <StatCard
                label="Like planting"
                value={`${modelled.environmental.trees_equiv_per_year.toLocaleString('en-AU')} trees/yr`}
              />
              <StatCard
                label="Like not driving"
                value={`${modelled.environmental.km_driven_equiv_per_year.toLocaleString('en-AU')} km/yr`}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-text-dim">
              Based on the Australian national grid emission factor —
              indicative, not a certified carbon statement.
            </p>
          </>
        ) : null}

        {/* ── 9. Quote table + payment — confirm-gated ───────────── */}
        {confirmed ? (
          <>
            <SectionHeading>
              Your <span className="text-accent">quote</span>
            </SectionHeading>
            <div className="mt-5 border border-ink-line bg-ink-card">
              <table className="w-full text-sm">
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i} className="border-b border-ink-line last:border-b-0">
                      <td className="px-4 py-3 text-text-sec">{r.description}</td>
                      <td className="px-2 py-3 text-right font-mono tabular-nums text-text-dim">
                        {r.quantity != null ? `\u00d7${r.quantity}` : ''}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums ${
                          r.is_rebate ? 'text-emerald-300' : 'text-text-pri'
                        }`}
                      >
                        {r.amount_formatted ?? 'Included'}
                      </td>
                    </tr>
                  ))}
                  {table.total_tax_formatted ? (
                    <tr className="border-b border-ink-line">
                      <td className="px-4 py-3 text-text-dim" colSpan={2}>
                        Includes GST
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-text-sec">
                        {table.total_tax_formatted}
                      </td>
                    </tr>
                  ) : null}
                  {table.total_formatted ? (
                    <tr className="border-t-2 border-text-pri">
                      <td className="px-4 py-4 font-bold uppercase tracking-wide text-text-pri" colSpan={2}>
                        Total system price (inc GST)
                      </td>
                      <td className="px-4 py-4 text-right font-mono text-lg font-bold tabular-nums text-accent">
                        {table.total_formatted}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-text-dim">
              Prices exactly as designed by {businessName} in Pylon — QuoteMate
              displays them verbatim.
            </p>

            {!paidAt && row.stripe_checkout_url && table.deposit_formatted ? (
              <div className="mt-6 border border-ink-line bg-ink-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                      Secure your installation
                    </div>
                    <div className="mt-1 text-lg font-bold text-text-pri">
                      Deposit: <span className="text-accent">{table.deposit_formatted}</span>
                    </div>
                  </div>
                  <a
                    href={row.stripe_checkout_url}
                    className="inline-flex items-center gap-2 bg-accent px-6 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press"
                  >
                    Pay deposit &rarr;
                  </a>
                </div>
              </div>
            ) : null}

            <p className="mt-4">
              <a
                href={`/api/q/pylon/${token}/pdf`}
                className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim underline decoration-1 underline-offset-2 transition-colors hover:text-accent"
              >
                Download this proposal as a PDF
              </a>
            </p>
          </>
        ) : null}

        {/* ── 10. Assumed values ─────────────────────────────────── */}
        {modelled && modelled.assumptions.length > 0 ? (
          <>
            <SectionHeading>
              Assumed <span className="text-accent">values</span>
            </SectionHeading>
            <div className="mt-5 grid grid-cols-1 gap-px border border-ink-line bg-ink-line/60 sm:grid-cols-2">
              {modelled.assumptions.map((a, i) => (
                <div key={i} className="flex items-baseline justify-between gap-4 bg-ink-deep px-4 py-3">
                  <span className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                    {a.label}
                  </span>
                  <span className="text-right text-sm text-text-sec">{a.value}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* ── 11. Disclaimers ────────────────────────────────────── */}
        <div className="mt-14 border-t border-ink-line pt-6">
          <p className="text-xs leading-relaxed text-text-dim">
            This proposal was designed by {businessName} in Pylon studio.
            Quoted prices are your installer&rsquo;s own figures, shown
            verbatim. Sections marked &ldquo;modelled&rdquo; are indicative
            projections computed by QuoteMate from the designed system size
            and standard assumptions — they are not guarantees and not
            financial advice. STC incentives are subject to eligibility under
            the Small-scale Renewable Energy Scheme and are applied by your
            installer at the point of sale. Installation is carried out by
            CEC-accredited installers in accordance with AS/NZS&nbsp;5033.
          </p>
        </div>
      </section>

      {/* Orange CTA accent bar — the Maintain full-stop. */}
      <div className="relative z-10 bg-accent px-6 py-4 text-center text-white">
        <span className="font-mono text-sm uppercase tracking-[0.15em]">
          {businessName} · powered by QuoteMate
        </span>
      </div>
    </main>
  )
}
