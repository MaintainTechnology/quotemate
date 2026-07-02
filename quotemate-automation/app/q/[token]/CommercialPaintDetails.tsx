// /q/[token] — commercial painting measured-takeoff section.
//
// Renders the tender's real measurement evidence for the customer: the
// takeoff summary the save-quote route stamps onto intake.scope (surfaces,
// total m², labour hours, crew, duration) plus the full per-surface line
// items wrapped into the tender tier — the detail that previously only the
// tradie's dashboard ever showed. Sits between Scope of works and the tender
// price card, mirroring RoofHeroStrip's role for roofing.
//
// Server component (pure render). Maintain design system — ink card, mono
// labels, orange accent, square corners, tabular figures.

import type { CommercialPaintScope, TenderLineItem } from '@/lib/quote/trade-scope'

type Props = {
  scope: CommercialPaintScope | null
  lineItems: TenderLineItem[]
  /** Link to the rich /q/commercial-paint/[token] tender page, when the
   *  saved_quote backlink resolves one. */
  tenderUrl: string | null
}

function fmtQty(quantity: number, unit: string): string {
  const n = quantity.toLocaleString('en-AU', { maximumFractionDigits: 1 })
  if (unit === 'sqm') return `${n} m²`
  if (unit === 'days') return `${n} ${quantity === 1 ? 'day' : 'days'}`
  if (unit === 'item' || unit === '') return n
  return `${n} ${unit}`
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function CommercialPaintDetails({ scope, lineItems, tenderUrl }: Props) {
  if (!scope && lineItems.length === 0) return null

  const stats: Array<{ label: string; value: string }> = []
  if (scope) {
    if (scope.surfaces !== null) stats.push({ label: 'Surfaces', value: String(scope.surfaces) })
    if (scope.total_m2 !== null)
      stats.push({
        label: 'Measured area',
        value: `${scope.total_m2.toLocaleString('en-AU', { maximumFractionDigits: 0 })} m²`,
      })
    if (scope.labour_hours !== null)
      stats.push({
        label: 'Labour',
        value: `${scope.labour_hours.toLocaleString('en-AU', { maximumFractionDigits: 0 })} h`,
      })
    if (scope.crew_size !== null) stats.push({ label: 'Crew', value: String(scope.crew_size) })
    if (scope.estimated_days !== null)
      stats.push({
        label: 'Duration',
        value: `≈${scope.estimated_days} ${scope.estimated_days === 1 ? 'day' : 'days'}`,
      })
  }

  return (
    <section className="mt-12 border border-ink-line bg-ink-card">
      <div className="p-6 sm:p-7">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
          Measured takeoff
        </div>
        {scope?.job_name ? (
          <div className="mt-1 font-mono text-sm text-text-sec">{scope.job_name}</div>
        ) : null}

        {stats.length > 0 ? (
          <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {stats.map((s) => (
              <li key={s.label}>
                <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                  {s.label}
                </div>
                <div className="mt-1 font-mono text-xl font-bold tabular-nums text-text-pri">
                  {s.value}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {lineItems.length > 0 ? (
        <div className="border-t border-ink-line">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-line text-left">
                  <th className="px-6 py-3 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim sm:px-7">
                    Surface
                  </th>
                  <th className="px-4 py-3 text-right font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                    Quantity
                  </th>
                  <th className="px-6 py-3 text-right font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim sm:px-7">
                    Price ex GST
                  </th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, i) => (
                  <tr key={i} className={i > 0 ? 'border-t border-ink-line/60' : undefined}>
                    <td className="px-6 py-2.5 leading-relaxed text-text-sec sm:px-7">
                      {li.description}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums text-text-sec">
                      {fmtQty(li.quantity, li.unit)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-2.5 text-right font-mono tabular-nums text-text-pri sm:px-7">
                      ${fmtMoney(li.total_ex_gst)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="border-t border-ink-line px-6 py-4 sm:px-7">
        <p className="text-sm leading-relaxed text-text-dim">
          Measured from your plans and site documents — every surface above is
          included in the tender price below.
        </p>
        {tenderUrl ? (
          <a
            href={tenderUrl}
            className="mt-3 inline-flex items-center gap-2 border border-ink-line px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent"
          >
            View the full measured takeoff →
          </a>
        ) : null}
      </div>
    </section>
  )
}
