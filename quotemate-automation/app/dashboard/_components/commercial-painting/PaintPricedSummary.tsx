'use client'

// Priced tender summary (spec §5.3): labour (hours/crew/days/$),
// per-product materials, equipment lines, the optional separate-price
// section, assumptions + exclusions, and ex-GST → GST → inc-GST totals.
// Every line opens a "how?" trace with the exact formulas — the same
// audit affordance as the electrical estimator.
//
// Premium pass (2026-06-16): the tender total is the hero result, KPIs and
// tables share the Maintain hairline/DataPanel language with the electrical
// sibling, sub-sections are announced by SectionLabel, and Separate-prices
// finally has a header. Pure visual/hierarchy change — every figure, line,
// material, equipment row, separate price, trace, assumption and exclusion
// is preserved verbatim.

import { useState } from 'react'
import type { PricedPaintBom, PricedPaintLine } from '@/lib/commercial-painting/types'
import {
  HeroTotal,
  LedgerRow,
  SectionLabel,
  StatGrid,
  StatusPill,
  DataPanel,
  TROW,
  REVEAL,
} from '../quote-ui'

function aud(n: number): string {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
}

const NUM_TH =
  'px-4 py-2.5 text-right font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-text-dim'
const NUM_TD = 'px-4 py-3 text-right font-mono text-sm tabular-nums text-text-sec'

function LinesTable({ lines, traceKey }: { lines: PricedPaintLine[]; traceKey: string }) {
  return (
    <DataPanel>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="bg-ink-deep/40">
            <th scope="col" className="px-4 py-2.5 text-left font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
              Surface
            </th>
            <th scope="col" className={NUM_TH}>Qty</th>
            <th scope="col" className={NUM_TH}>Hours</th>
            <th scope="col" className={NUM_TH}>Material</th>
            <th scope="col" className={NUM_TH}>Line ex GST</th>
            <th scope="col" className="px-4 py-2.5 text-right font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
              <span className="sr-only">Show working</span>
            </th>
          </tr>
        </thead>
        <LineRows lines={lines} traceKey={traceKey} />
      </table>
    </DataPanel>
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
      <tr className={TROW}>
        <td className="px-4 py-3">
          <span className="text-sm text-text-pri">{line.surface}</span>
          <span className="ml-2 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim">{line.room}</span>
        </td>
        <td className={NUM_TD}>
          {line.quantity}{line.unit === 'm2' ? ' m²' : ''} × {line.coats}c
        </td>
        <td className={NUM_TD}>{line.labourHours}h</td>
        <td className={NUM_TD}>{aud(line.materialExGst)}</td>
        <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-text-pri">{aud(line.lineExGst)}</td>
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={traceId}
            className={`inline-flex cursor-pointer items-center gap-1 border px-1.5 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              open
                ? 'border-accent/70 bg-accent/10 text-accent'
                : 'border-ink-line text-text-dim hover:border-accent hover:text-accent'
            }`}
          >
            how?
            <svg viewBox="0 0 12 12" className={`h-2.5 w-2.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
              <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </td>
      </tr>
      {open && (
        <tr id={traceId} className="bg-ink-deep">
          <td colSpan={6} className="border-t border-ink-line/60 px-4 py-4">
            <div className="mb-3 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-accent">
              How this line was priced
            </div>
            <dl className="grid gap-4 text-xs sm:grid-cols-2">
              <div className="border-l-2 border-l-accent/40 pl-3">
                <dt className="font-mono font-semibold uppercase tracking-[0.1em] text-text-dim">Labour</dt>
                <dd className="mt-1 font-mono leading-relaxed tabular-nums text-text-sec">{line.trace.labourFormula}</dd>
              </div>
              <div className="border-l-2 border-l-accent/40 pl-3">
                <dt className="font-mono font-semibold uppercase tracking-[0.1em] text-text-dim">Material · {line.product}</dt>
                <dd className="mt-1 font-mono leading-relaxed tabular-nums text-text-sec">{line.trace.materialFormula}</dd>
              </div>
            </dl>
            <p className="mt-3 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim">
              {line.trace.method} · rate {line.trace.rateCode} · height ×{line.trace.heightMultiplier}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

export function PaintPricedSummary({ bom }: { bom: PricedPaintBom }) {
  const totalLitres = bom.materials.reduce((s, m) => s + m.litres, 0)
  return (
    <div className={`mt-5 space-y-7 ${REVEAL}`}>
      {/* ── Hero result: the tender the tradie sends, celebrated up front
          with the full Labour → GST ledger preserved beside it. ── */}
      <HeroTotal
        eyebrow="Tender inc GST"
        amount={aud(bom.totalIncGst)}
        caption={`${aud(bom.labour.ratePerHr)}/hr labour · ${bom.labour.crewSize}-painter crew · ${bom.materials.length} products`}
        badge={
          <div className="flex flex-col items-end gap-2">
            <StatusPill label="Deterministic pricing" tone="good" />
            {bom.unmatched.length > 0 && (
              <StatusPill label={`${bom.unmatched.length} unpriced`} tone="warn" dot />
            )}
          </div>
        }
        ledger={
          <div className="ml-auto w-full max-w-sm">
            <LedgerRow label="Labour" value={aud(bom.labour.costExGst)} />
            <LedgerRow label="Materials" value={aud(bom.materialsExGst)} />
            <LedgerRow label="Equipment" value={aud(bom.equipmentExGst)} />
            <LedgerRow label="Subtotal (ex GST)" value={aud(bom.subtotalExGst)} strong />
            <LedgerRow label="GST" value={aud(bom.gst)} />
          </div>
        }
      />

      {/* ── Operational metrics (the total lives in the hero above). ── */}
      <StatGrid
        cols={4}
        stats={[
          { label: 'Labour', value: `${bom.labour.hours}h`, hint: `${aud(bom.labour.costExGst)} at ${aud(bom.labour.ratePerHr)}/h` },
          { label: 'Crew', value: `${bom.labour.crewSize} painters`, hint: `≈ ${bom.labour.estimatedDays} day${bom.labour.estimatedDays === 1 ? '' : 's'} on site` },
          { label: 'Materials', value: aud(bom.materialsExGst), hint: `${totalLitres} L · ${bom.materials.length} product${bom.materials.length === 1 ? '' : 's'}` },
          { label: 'Equipment', value: aud(bom.equipmentExGst), hint: bom.equipment.length > 0 ? `${bom.equipment.length} item${bom.equipment.length === 1 ? '' : 's'}` : 'None required' },
        ]}
      />

      {/* ── Priced lines ── */}
      <div>
        <SectionLabel hint={`${bom.lines.length} ${bom.lines.length === 1 ? 'line' : 'lines'}`}>Priced lines</SectionLabel>
        <div className="mt-4">
          <LinesTable lines={bom.lines} traceKey="main" />
        </div>
      </div>

      {/* Unmatched — never guessed */}
      {bom.unmatched.length > 0 && (
        <div className="border border-ink-line border-l-4 border-l-warning-bright bg-ink-deep px-4 py-3.5">
          <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-warning-bright">
            {bom.unmatched.length} line{bom.unmatched.length === 1 ? '' : 's'} returned unpriced
          </p>
          <ul className="mt-2 space-y-1 text-sm text-text-sec">
            {bom.unmatched.map((u, i) => (
              <li key={i}>{u.room} · {u.surface} ({u.quantity}) — no matching rate; price manually or fix the system.</li>
            ))}
          </ul>
        </div>
      )}

      {/* Materials per product */}
      <div>
        <SectionLabel hint={`${totalLitres} L`}>Materials</SectionLabel>
        <div className="mt-4">
          <DataPanel>
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="bg-ink-deep/40">
                  <th scope="col" className="px-4 py-2.5 text-left font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-text-dim">Product</th>
                  <th scope="col" className={NUM_TH}>Litres</th>
                  <th scope="col" className={NUM_TH}>$/L ex GST</th>
                  <th scope="col" className={NUM_TH}>Cost ex GST</th>
                </tr>
              </thead>
              <tbody>
                {bom.materials.map((mat, i) => (
                  <tr key={i} className={TROW}>
                    <td className="px-4 py-3 text-text-pri">{mat.product}</td>
                    <td className={NUM_TD}>
                      {mat.litres} L <span className="text-text-dim">({mat.litresRaw} raw)</span>
                    </td>
                    <td className={NUM_TD}>{aud(mat.pricePerL)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-text-pri">{aud(mat.costExGst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        </div>
        <p className="mt-2 text-xs text-text-dim">Litres rounded up per product; sundries included in cost.</p>
      </div>

      {/* Equipment */}
      {bom.equipment.length > 0 && (
        <div>
          <SectionLabel>Equipment &amp; access</SectionLabel>
          <ul className="mt-4 divide-y divide-ink-line border border-ink-line bg-ink-card">
            {bom.equipment.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-ink-deep/50">
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
          <SectionLabel hint="not in the tender total">Separate prices</SectionLabel>
          <div className="mt-4">
            <LinesTable lines={bom.separate.lines} traceKey="sep" />
          </div>
          <p className="mt-2 font-mono text-sm tabular-nums text-text-sec">
            Separate-price subtotal · <span className="text-text-pri">{aud(bom.separate.exGst)}</span> ex GST
          </p>
        </div>
      )}

      {/* Assumptions + exclusions — differentiated so exclusions read as a guard */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-ink-line bg-ink-deep p-5">
          <h4 className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-text-dim">Assumptions</h4>
          <ul className="mt-3 space-y-1.5 text-sm text-text-sec">
            {bom.assumptions.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="select-none text-teal-glow" aria-hidden="true">·</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="border border-ink-line border-l-4 border-l-warning-bright/60 bg-ink-deep p-5">
          <h4 className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-warning-bright">Exclusions</h4>
          <ul className="mt-3 space-y-1.5 text-sm text-text-sec">
            {bom.exclusions.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="select-none text-warning-bright" aria-hidden="true">·</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
