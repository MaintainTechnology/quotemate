'use client'

// The grounded BOM — every line traces to the tenant's catalogue + pricing
// book, and the per-line "how?" expands the full calculation chain. Nothing
// here is model-generated: unmatched items are flagged, never guessed.
//
// Premium pass (2026-06-16): the total is celebrated as a hero result band,
// the BOM is a bordered DataPanel table with row breathing room, and the
// "how?" provenance — the product's trust differentiator — is showcased
// rather than buried. Pure visual/hierarchy change; every number, line,
// trace, unmatched add-form, and total is preserved verbatim.

import { Fragment, useId, useState } from 'react'
import { CATEGORIES } from '@/lib/estimate/categories'
import { money, type AddToCatalogueFn, type PricedBom } from './types'
import {
  HeroTotal,
  LedgerRow,
  SectionLabel,
  StatusPill,
  DataPanel,
  TROW,
} from '../quote-ui'

type Props = {
  bom: PricedBom
  info: { catalogueSize: number; source: string } | null
  pricedAt?: string | null
  /** When supplied, each "not priced" item becomes an inline add-to-catalogue
   *  form (price + labour) that saves to the tenant's assemblies and re-prices.
   *  Absent → the items render as static chips (read-only contexts). */
  onAddToCatalogue?: AddToCatalogueFn
}

// Electrical + shared grounding categories for the optional add-form dropdown,
// derived from the single CATEGORIES source so labels never drift. Plumbing
// categories are omitted — the plan estimator is electrical-only.
const ELECTRICAL_CATEGORY_VALUES = new Set<string>([
  'downlight', 'gpo', 'smoke_alarm', 'fan', 'outdoor_light', 'rcbo', 'oven_cooktop',
  'ev_charger', 'switchboard', 'fault_find', 'strip_light', 'security_camera',
  'doorbell_intercom', 'sundry', 'general',
])
const CATEGORY_OPTIONS = CATEGORIES.filter((c) => ELECTRICAL_CATEGORY_VALUES.has(c.value))

const NUM_TH =
  'px-4 py-2.5 text-right font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-text-dim'
const NUM_TD = 'px-4 py-3.5 text-right font-mono text-sm tabular-nums text-text-sec'

export function PricedSummary({ bom, info, pricedAt, onAddToCatalogue }: Props) {
  const [openTrace, setOpenTrace] = useState<number | null>(null)
  const traceId = useId()

  return (
    <section aria-label="Indicative estimate" className="motion-safe:animate-[fade-up_220ms_ease-out_both]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Indicative estimate
          </div>
          <h3 className="mt-1.5 text-xl font-extrabold uppercase tracking-tight text-text-pri sm:text-2xl">
            Bill of materials &amp; labour
          </h3>
        </div>
        {pricedAt && (
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.12em] text-text-dim">
            Priced {new Date(pricedAt).toLocaleString('en-AU')}
          </span>
        )}
      </div>

      {/* ── Hero result band: the total the tradie came for, celebrated up
          front with the full ex-GST → GST ledger preserved beside it. ── */}
      <div className="mt-5">
        <HeroTotal
          eyebrow="Total inc GST"
          amount={money(bom.totalIncGst)}
          caption={`${money(bom.assumptions.hourlyRate)}/hr labour · ${bom.assumptions.markupPct}% material markup`}
          badge={
            <div className="flex flex-col items-end gap-2">
              <StatusPill label="Grounded · no AI in $" tone="good" />
              {bom.unmatched.length > 0 && (
                <StatusPill label={`${bom.unmatched.length} not priced`} tone="warn" dot />
              )}
            </div>
          }
          ledger={
            <div className="ml-auto w-full max-w-sm">
              <LedgerRow label="Materials" value={money(bom.materialExGst)} />
              <LedgerRow label="Labour" value={money(bom.labourExGst)} />
              {bom.labourFloorAddedExGst > 0 && (
                <LedgerRow
                  label={`Min-labour top-up (${bom.assumptions.minLabourHours}h floor)`}
                  value={money(bom.labourFloorAddedExGst)}
                />
              )}
              <LedgerRow label="Subtotal (ex GST)" value={money(bom.subtotalExGst)} strong />
              {bom.gstRegistered && <LedgerRow label="GST 10%" value={money(bom.gstExGst)} />}
            </div>
          }
        />
      </div>

      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-text-sec">
        Priced from your electrical catalogue — deterministic maths, no AI in any dollar figure.
        Items not in your catalogue are flagged below and not priced. Open a line’s{' '}
        <span className="font-mono text-xs uppercase text-text-pri">how?</span> for the full calculation chain.
      </p>

      {bom.lines.length > 0 && (
        <div className="mt-6">
          <SectionLabel hint={`${bom.lines.length} ${bom.lines.length === 1 ? 'line' : 'lines'}`}>
            Priced lines
          </SectionLabel>
          <div className="mt-4">
            <DataPanel>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-ink-deep/40">
                    <th scope="col" className="px-4 py-2.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
                      Item → assembly
                    </th>
                    <th scope="col" className={NUM_TH}>Qty</th>
                    <th scope="col" className={NUM_TH}>Unit</th>
                    <th scope="col" className={NUM_TH}>Material</th>
                    <th scope="col" className={NUM_TH}>Labour</th>
                    <th scope="col" className={NUM_TH}>Line</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.lines.map((l, i) => (
                    <Fragment key={i}>
                      <tr className={TROW}>
                        <td className="px-4 py-3.5 text-sm text-text-pri">
                          {l.type}
                          <span className="mt-0.5 block font-mono text-xs text-text-dim">
                            → {l.matched}
                            <button
                              type="button"
                              onClick={() => setOpenTrace((s) => (s === i ? null : i))}
                              aria-expanded={openTrace === i}
                              aria-controls={`${traceId}-trace-${i}`}
                              className={`ml-2 inline-flex cursor-pointer items-center gap-1 border px-1.5 py-0.5 font-semibold uppercase tracking-widest transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                                openTrace === i
                                  ? 'border-accent/70 bg-accent/10 text-accent'
                                  : 'border-ink-line text-text-dim hover:border-accent hover:text-accent'
                              }`}
                            >
                              how?
                              <svg
                                viewBox="0 0 12 12"
                                className={`h-2.5 w-2.5 transition-transform ${openTrace === i ? 'rotate-180' : ''}`}
                                aria-hidden="true"
                              >
                                <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                              </svg>
                            </button>
                          </span>
                        </td>
                        <td className={NUM_TD}>{l.count}</td>
                        <td className={NUM_TD}>{money(l.unitPriceExGst)}</td>
                        <td className={NUM_TD}>{money(l.materialExGst)}</td>
                        <td className={NUM_TD}>
                          {money(l.labourExGst)}
                          <span className="block text-xs text-text-dim">{l.labourHours}h</span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-text-pri">
                          {money(l.lineExGst)}
                        </td>
                      </tr>
                      {openTrace === i && (
                        <tr id={`${traceId}-trace-${i}`} className="bg-ink-deep">
                          <td colSpan={6} className="border-t border-ink-line/60 px-4 py-5">
                            <div className="mb-3 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-accent">
                              How this line was priced
                            </div>
                            <TraceGrid line={l} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </DataPanel>
          </div>
        </div>
      )}

      {bom.unmatched.length > 0 && (
        <div className="mt-6 border border-ink-line border-l-4 border-l-warning-bright bg-ink-deep px-4 py-3.5">
          <div className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-warning-bright">
            Not priced — not in your catalogue ({bom.unmatched.length})
          </div>
          {onAddToCatalogue ? (
            <>
              <ul className="mt-3 space-y-2">
                {bom.unmatched.map((u) => (
                  <UnmatchedItem key={u.type} item={u} onAdd={onAddToCatalogue} />
                ))}
              </ul>
              <p className="mt-3 text-xs text-text-dim">
                Add one with its price + labour and we’ll re-price instantly — it’s saved to your
                catalogue so the next plan prices it automatically. Unmatched items are never guessed.
              </p>
            </>
          ) : (
            <>
              <ul className="mt-2 flex flex-wrap gap-2">
                {bom.unmatched.map((u, i) => (
                  <li key={i} className="border border-warning-bright/50 px-2 py-1 font-mono text-xs text-text-sec">
                    {u.count}× {u.type}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-text-dim">
                Add these under Services / Catalogue and re-price — unmatched items are never guessed.
              </p>
            </>
          )}
        </div>
      )}

      {info && (
        <p className="mt-4 text-right font-mono text-[0.66rem] text-text-dim">
          catalogue: {info.catalogueSize} assemblies · pricing book: {info.source}
        </p>
      )}
    </section>
  )
}

// One "not priced" item as an inline add-to-catalogue form. The item name and
// count come from the take-off; the tradie supplies the two columns the plan
// can't infer (unit price + labour/unit). Saving persists a custom assembly
// named exactly like the item — which the deterministic exact-name matcher then
// links on re-price (lib/estimation/price.ts) — and the parent re-prices.
function UnmatchedItem({
  item,
  onAdd,
}: {
  item: { type: string; count: number }
  onAdd: AddToCatalogueFn
}) {
  const [open, setOpen] = useState(false)
  const [price, setPrice] = useState('')
  const [labour, setLabour] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)
  const fid = useId()

  const priceNum = Number(price)
  const labourNum = Number(labour)
  const priceValid = price.trim() !== '' && Number.isFinite(priceNum) && priceNum >= 0
  const labourValid = labour.trim() === '' || (Number.isFinite(labourNum) && labourNum >= 0)
  const canSubmit = priceValid && labourValid && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const res = await onAdd(
      { type: item.type, count: item.count },
      { priceExGst: priceNum, labourHours: labour.trim() === '' ? 0 : labourNum, category: category || undefined },
    )
    setBusy(false)
    if (res.ok) {
      // On success the parent re-prices and this item leaves bom.unmatched, so
      // the row unmounts. The flag only shows if the row lingers (re-price hiccup).
      setAdded(true)
      setOpen(false)
    } else {
      setError(res.error ?? 'Could not add to catalogue.')
    }
  }

  return (
    <li className="border border-warning-bright/40 bg-ink-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="font-mono text-xs text-text-sec">
          {item.count}× {item.type}
        </span>
        {added ? (
          <span className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-teal-glow">
            ✓ added
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setOpen((s) => !s)
              setError(null)
            }}
            aria-expanded={open}
            aria-controls={`${fid}-form`}
            className="font-mono text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-accent transition-colors hover:text-accent-press focus-visible:outline-2 focus-visible:outline-accent"
          >
            {open ? 'Cancel' : '+ Add to catalogue'}
          </button>
        )}
      </div>

      {open && !added && (
        <form id={`${fid}-form`} onSubmit={submit} className="border-t border-ink-line px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block font-mono text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-text-dim">
                Unit price ex GST
              </span>
              <div className="mt-1 flex items-center border border-ink-line bg-ink-deep focus-within:border-accent">
                <span className="pl-2 font-mono text-xs text-text-dim">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  aria-label={`Unit price ex GST for ${item.type}`}
                  className="w-full bg-transparent px-2 py-1.5 font-mono text-sm tabular-nums text-text-pri outline-none"
                />
              </div>
            </label>
            <label className="block">
              <span className="block font-mono text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-text-dim">
                Labour hrs / unit
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.25"
                value={labour}
                onChange={(e) => setLabour(e.target.value)}
                placeholder="0"
                aria-label={`Labour hours per unit for ${item.type}`}
                className="mt-1 w-full border border-ink-line bg-ink-deep px-2 py-1.5 font-mono text-sm tabular-nums text-text-pri outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="block font-mono text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-text-dim">
                Category <span className="normal-case text-text-dim/70">(optional)</span>
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label={`Catalogue category for ${item.type}`}
                className="mt-1 w-full border border-ink-line bg-ink-deep px-2 py-1.5 font-mono text-sm text-text-pri outline-none focus:border-accent"
              >
                <option value="">Auto (from name)</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p role="alert" className="mt-2 font-mono text-xs text-warning-bright">
              {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 bg-accent px-4 py-2 font-mono text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-accent-press focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save to catalogue & re-price'}
            </button>
            <span className="font-mono text-[0.58rem] text-text-dim">
              Re-prices now from your pricing book and remembers it for next time.
            </span>
          </div>
        </form>
      )}
    </li>
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
    <div className="border-l-2 border-l-accent/40 pl-3">
      <div className="flex items-center gap-2 font-mono font-semibold uppercase tracking-[0.12em] text-text-dim">
        <span className="font-mono text-base font-bold leading-none text-accent">{n}</span>
        {title}
      </div>
      <p className="mt-1.5 leading-relaxed text-text-sec">{children}</p>
    </div>
  )
}
