'use client'

// Priced tender summary (spec §5.3): labour (hours/crew/days/$),
// per-product materials, equipment lines, the optional separate-price
// section, assumptions + exclusions, and ex-GST → GST → inc-GST totals.
// Every line opens a "how?" trace with the exact formulas — the same
// audit affordance as the electrical estimator.

import { useState } from 'react'
import type { PricedPaintBom, PricedPaintLine } from '@/lib/commercial-painting/types'

function aud(n: number): string {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-deep p-4">
      <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-text-dim">{label}</div>
      <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}

function LineRows({ lines, traceKey }: { lines: PricedPaintLine[]; traceKey: string }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <tbody>
      {lines.map((l, i) => (
        <LineRow key={i} line={l} idx={i} traceKey={traceKey} open={open === i} toggle={() => setOpen(open === i ? null : i)} />
      ))}
    </tbody>
  )
}

function LineRow({
  line,
  idx,
  traceKey,
  open,
  toggle,
}: {
  line: PricedPaintLine
  idx: number
  traceKey: string
  open: boolean
  toggle: () => void
}) {
  const traceId = `${traceKey}-trace-${idx}`
  return (
    <>
      <tr className="border-t border-ink-line">
        <td className="py-2 pr-3">
          <span className="text-text-pri">{line.surface}</span>
          <span className="ml-2 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim">{line.room}</span>
        </td>
        <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-text-sec">
          {line.quantity}{line.unit === 'm2' ? ' m²' : ''} × {line.coats}c
        </td>
        <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-text-sec">{line.labourHours}h</td>
        <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-text-sec">{aud(line.materialExGst)}</td>
        <td className="py-2 pr-3 text-right font-mono text-sm font-semibold tabular-nums text-text-pri">{aud(line.lineExGst)}</td>
        <td className="py-2 text-right">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={traceId}
            className="cursor-pointer font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-accent transition-colors hover:text-accent-press"
          >
            how?
          </button>
        </td>
      </tr>
      {open && (
        <tr id={traceId} className="border-t border-ink-line bg-ink-deep">
          <td colSpan={6} className="px-3 py-3">
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-mono uppercase tracking-[0.1em] text-text-dim">Labour</dt>
                <dd className="mt-0.5 font-mono tabular-nums text-text-sec">{line.trace.labourFormula}</dd>
              </div>
              <div>
                <dt className="font-mono uppercase tracking-[0.1em] text-text-dim">Material · {line.product}</dt>
                <dd className="mt-0.5 font-mono tabular-nums text-text-sec">{line.trace.materialFormula}</dd>
              </div>
            </dl>
            <p className="mt-2 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim">
              {line.trace.method} · rate {line.trace.rateCode} · height ×{line.trace.heightMultiplier}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

export function PaintPricedSummary({ bom }: { bom: PricedPaintBom }) {
  return (
    <div className="mt-5 space-y-6">
      {/* Headline stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Labour" value={`${bom.labour.hours}h`} hint={`${aud(bom.labour.costExGst)} ex GST at ${aud(bom.labour.ratePerHr)}/h`} />
        <Stat label="Crew" value={`${bom.labour.crewSize} painters`} hint={`≈ ${bom.labour.estimatedDays} day${bom.labour.estimatedDays === 1 ? '' : 's'} on site`} />
        <Stat label="Materials" value={aud(bom.materialsExGst)} hint={`${bom.materials.reduce((s, m) => s + m.litres, 0)} L across ${bom.materials.length} products`} />
        <Stat label="Tender total" value={aud(bom.totalIncGst)} hint={`${aud(bom.subtotalExGst)} + ${aud(bom.gst)} GST`} />
      </div>

      {/* Priced lines */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="text-left font-mono text-[0.6rem] uppercase tracking-[0.12em] text-text-dim">
              <th className="py-1.5 pr-3 font-semibold">Surface</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Qty</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Hours</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Material</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Line ex GST</th>
              <th className="py-1.5 font-semibold" aria-hidden />
            </tr>
          </thead>
          <LineRows lines={bom.lines} traceKey="main" />
        </table>
      </div>

      {/* Unmatched — never guessed */}
      {bom.unmatched.length > 0 && (
        <div className="border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3">
          <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-warning">
            {bom.unmatched.length} line{bom.unmatched.length === 1 ? '' : 's'} returned unpriced
          </p>
          <ul className="mt-1.5 text-sm text-text-sec">
            {bom.unmatched.map((u, i) => (
              <li key={i}>{u.room} · {u.surface} ({u.quantity}) — no matching rate; price manually or fix the system.</li>
            ))}
          </ul>
        </div>
      )}

      {/* Materials per product */}
      <div>
        <h4 className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.16em] text-accent">Materials</h4>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="text-left font-mono text-[0.6rem] uppercase tracking-[0.12em] text-text-dim">
                <th className="py-1.5 pr-3 font-semibold">Product</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Litres</th>
                <th className="py-1.5 pr-3 text-right font-semibold">$/L ex GST</th>
                <th className="py-1.5 text-right font-semibold">Cost ex GST</th>
              </tr>
            </thead>
            <tbody>
              {bom.materials.map((mat, i) => (
                <tr key={i} className="border-t border-ink-line">
                  <td className="py-2 pr-3 text-text-pri">{mat.product}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-text-sec">
                    {mat.litres} L <span className="text-text-dim">({mat.litresRaw} raw)</span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-text-sec">{aud(mat.pricePerL)}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-text-pri">{aud(mat.costExGst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-text-dim">Litres rounded up per product; sundries included in cost.</p>
      </div>

      {/* Equipment */}
      {bom.equipment.length > 0 && (
        <div>
          <h4 className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.16em] text-accent">Equipment & access</h4>
          <ul className="mt-2 divide-y divide-ink-line border border-ink-line">
            {bom.equipment.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-ink-deep px-4 py-3">
                <span className="text-sm text-text-pri">{e.label}</span>
                <span className="font-mono text-sm tabular-nums text-text-sec">{e.days} day{e.days === 1 ? '' : 's'} × {aud(e.dayRate)}</span>
                <span className="ml-auto font-mono text-sm font-semibold tabular-nums text-text-pri">{aud(e.costExGst)}</span>
                <span className="w-full text-xs text-text-dim">{e.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Separate-price section */}
      {bom.separate.lines.length > 0 && (
        <div>
          <h4 className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.16em] text-accent">
            Separate prices (not in the tender total)
          </h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <LineRows lines={bom.separate.lines} traceKey="sep" />
            </table>
          </div>
          <p className="mt-1.5 font-mono text-sm tabular-nums text-text-sec">
            Separate-price subtotal · {aud(bom.separate.exGst)} ex GST
          </p>
        </div>
      )}

      {/* Totals */}
      <div className="max-w-sm space-y-1.5 border-t border-ink-line pt-4 font-mono text-sm tabular-nums">
        <div className="flex justify-between text-text-sec"><span>Labour</span><span>{aud(bom.labour.costExGst)}</span></div>
        <div className="flex justify-between text-text-sec"><span>Materials</span><span>{aud(bom.materialsExGst)}</span></div>
        <div className="flex justify-between text-text-sec"><span>Equipment</span><span>{aud(bom.equipmentExGst)}</span></div>
        <div className="flex justify-between border-t border-ink-line pt-1.5 text-text-sec"><span>Subtotal ex GST</span><span>{aud(bom.subtotalExGst)}</span></div>
        <div className="flex justify-between text-text-sec"><span>GST</span><span>{aud(bom.gst)}</span></div>
        <div className="flex justify-between border-t border-ink-line pt-1.5 text-base font-bold text-accent"><span>Tender inc GST</span><span>{aud(bom.totalIncGst)}</span></div>
      </div>

      {/* Assumptions + exclusions */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-ink-line bg-ink-deep p-4">
          <h4 className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-text-dim">Assumptions</h4>
          <ul className="mt-2 list-inside space-y-1 text-sm text-text-sec">
            {bom.assumptions.map((a, i) => <li key={i}>· {a}</li>)}
          </ul>
        </div>
        <div className="border border-ink-line bg-ink-deep p-4">
          <h4 className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-text-dim">Exclusions</h4>
          <ul className="mt-2 list-inside space-y-1 text-sm text-text-sec">
            {bom.exclusions.map((e, i) => <li key={i}>· {e}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}
