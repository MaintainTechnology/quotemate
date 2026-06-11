'use client'

// The grounded BOM — every line traces to the tenant's catalogue + pricing
// book, and the per-line "how?" expands the full calculation chain. Nothing
// here is model-generated: unmatched items are flagged, never guessed.

import { Fragment, useState } from 'react'
import { money, type PricedBom } from './types'

type Props = {
  bom: PricedBom
  info: { catalogueSize: number; source: string } | null
  pricedAt?: string | null
}

export function PricedSummary({ bom, info, pricedAt }: Props) {
  const [openTrace, setOpenTrace] = useState<number | null>(null)

  return (
    <section aria-label="Indicative estimate" className="motion-safe:animate-[fade-up_220ms_ease-out_both]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Indicative estimate
          </div>
          <h3 className="mt-1.5 font-extrabold uppercase tracking-tight text-xl text-text-pri sm:text-2xl">
            Bill of materials &amp; labour
          </h3>
        </div>
        {pricedAt && (
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-text-dim">
            Priced {new Date(pricedAt).toLocaleString('en-AU')}
          </span>
        )}
      </div>

      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-text-sec">
        Priced from your electrical catalogue at {money(bom.assumptions.hourlyRate)}/hr labour and{' '}
        {bom.assumptions.markupPct}% material markup — deterministic maths, no AI in any dollar figure.
        Items not in your catalogue are flagged below and not priced. Open a line’s{' '}
        <span className="font-mono text-xs uppercase">how?</span> for the full calculation chain.
      </p>

      {bom.lines.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-line font-mono text-[0.62rem] uppercase tracking-[0.12em] text-text-dim">
                <th scope="col" className="py-2.5 pr-3 font-semibold">
                  Item → assembly
                </th>
                <th scope="col" className="py-2.5 px-3 text-right font-semibold">
                  Qty
                </th>
                <th scope="col" className="py-2.5 px-3 text-right font-semibold">
                  Unit
                </th>
                <th scope="col" className="py-2.5 px-3 text-right font-semibold">
                  Material
                </th>
                <th scope="col" className="py-2.5 px-3 text-right font-semibold">
                  Labour
                </th>
                <th scope="col" className="py-2.5 pl-3 text-right font-semibold">
                  Line
                </th>
              </tr>
            </thead>
            <tbody>
              {bom.lines.map((l, i) => (
                <Fragment key={i}>
                  <tr className="border-b border-ink-line/60">
                    <td className="py-2.5 pr-3 text-sm text-text-pri">
                      {l.type}
                      <span className="block font-mono text-xs text-text-dim">
                        → {l.matched}
                        <button
                          type="button"
                          onClick={() => setOpenTrace((s) => (s === i ? null : i))}
                          aria-expanded={openTrace === i ? 'true' : 'false'}
                          className={`ml-2 font-semibold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                            openTrace === i ? 'text-accent' : 'text-text-dim hover:text-accent'
                          }`}
                        >
                          how?
                        </button>
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-sm tabular-nums text-text-sec">{l.count}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-sm tabular-nums text-text-sec">
                      {money(l.unitPriceExGst)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-sm tabular-nums text-text-sec">
                      {money(l.materialExGst)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-sm tabular-nums text-text-sec">
                      {money(l.labourExGst)}
                      <span className="block text-xs text-text-dim">{l.labourHours}h</span>
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono text-sm font-semibold tabular-nums text-text-pri">
                      {money(l.lineExGst)}
                    </td>
                  </tr>
                  {openTrace === i && (
                    <tr className="border-b border-ink-line/60 bg-ink-deep">
                      <td colSpan={6} className="px-4 py-4">
                        <TraceGrid line={l} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bom.unmatched.length > 0 && (
        <div className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3">
          <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-warning">
            Not priced — not in your catalogue ({bom.unmatched.length})
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {bom.unmatched.map((u, i) => (
              <li key={i} className="border border-warning/50 px-2 py-1 font-mono text-xs text-text-sec">
                {u.count}× {u.type}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-dim">
            Add these under Services / Catalogue and re-price — unmatched items are never guessed.
          </p>
        </div>
      )}

      <div className="mt-6 flex justify-end border-t border-ink-line pt-5">
        <dl className="w-full max-w-sm space-y-2 font-mono text-sm">
          <SumRow label="Materials" value={money(bom.materialExGst)} />
          <SumRow label="Labour" value={money(bom.labourExGst)} />
          {bom.labourFloorAddedExGst > 0 && (
            <SumRow label={`Min-labour top-up (${bom.assumptions.minLabourHours}h floor)`} value={money(bom.labourFloorAddedExGst)} />
          )}
          <SumRow label="Subtotal (ex GST)" value={money(bom.subtotalExGst)} />
          {bom.gstRegistered && <SumRow label="GST 10%" value={money(bom.gstExGst)} />}
          <div className="flex items-baseline justify-between gap-6 border-t border-ink-line pt-3 text-text-pri">
            <dt className="font-semibold uppercase tracking-[0.12em]">Total inc GST</dt>
            <dd className="text-2xl font-bold tabular-nums text-accent">{money(bom.totalIncGst)}</dd>
          </div>
        </dl>
      </div>

      {info && (
        <p className="mt-3 text-right font-mono text-[0.66rem] text-text-dim">
          catalogue: {info.catalogueSize} assemblies · pricing book: {info.source}
        </p>
      )}
    </section>
  )
}

function TraceGrid({ line }: { line: PricedBom['lines'][number] }) {
  return (
    <div className="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <TraceStep n="1" title="Count from drawing">
        {line.trace.countSource.tally ?? 'No zone tally recorded for this line.'}
        {line.trace.countSource.confidence && (
          <span className="ml-1.5 font-mono uppercase text-text-dim">[{line.trace.countSource.confidence} confidence]</span>
        )}
      </TraceStep>
      <TraceStep n="2" title="Catalogue match">
        “{line.type}” → <span className="text-text-pri">{line.matched}</span>
        {line.trace.matchedSignals.length > 0 && (
          <span className="block font-mono text-text-dim">matched on: {line.trace.matchedSignals.join(', ')}</span>
        )}
      </TraceStep>
      <TraceStep n="3" title="Material">
        <span className="font-mono">{line.trace.materialFormula}</span>
        <span className="block font-mono text-text-dim">
          base {money(line.trace.baseUnitPriceExGst)}/unit ex GST + {line.trace.markupPct}% markup
        </span>
      </TraceStep>
      <TraceStep n="4" title="Labour">
        <span className="font-mono">{line.trace.labourFormula}</span>
        <span className="block font-mono text-text-dim">
          {line.trace.unitLabourHours}h/unit at {money(line.trace.hourlyRate)}/h — labour is not marked up
        </span>
      </TraceStep>
    </div>
  )
}

function TraceStep({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-l-ink-line pl-3">
      <div className="font-mono font-semibold uppercase tracking-[0.12em] text-text-dim">
        <span className="text-accent">{n}</span> · {title}
      </div>
      <p className="mt-1 leading-relaxed text-text-sec">{children}</p>
    </div>
  )
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 text-text-sec">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
