'use client'

// The take-off ledger — every counted symbol, fully editable. The tradie owns
// the final numbers: correct counts, fix a mislabel, delete a false positive,
// add what the AI missed. Low-confidence rows are visually flagged as the
// first place to look.

import { blankRow, type EditableRow } from './types'
import { ConfidenceBadge } from './badges'

type Props = {
  rows: EditableRow[]
  onRowsChange: (rows: EditableRow[]) => void
  /** Index of the row highlighted on the plan overlay, or null. */
  selectedIdx: number | null
  onSelect: (idx: number | null) => void
  disabled?: boolean
}

const CELL_INPUT =
  'w-full border border-transparent bg-transparent px-2 py-1.5 text-sm text-text-pri transition-colors hover:border-ink-line focus:border-accent focus:bg-ink-deep focus:outline-none disabled:opacity-50'

export function TakeoffTable({ rows, onRowsChange, selectedIdx, onSelect, disabled }: Props) {
  const patch = (uid: number, change: Partial<EditableRow>) =>
    onRowsChange(rows.map((r) => (r.uid === uid ? { ...r, ...change } : r)))

  const remove = (uid: number) => {
    onSelect(null)
    onRowsChange(rows.filter((r) => r.uid !== uid))
  }

  const add = () => onRowsChange([...rows, blankRow()])

  const totalDevices = rows.reduce((s, r) => s + (Number(r.count) || 0), 0)
  const lowCount = rows.filter((r) => r.confidence === 'low').length

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-ink-line font-mono text-[0.64rem] uppercase tracking-[0.14em] text-text-dim">
              <th scope="col" className="w-10 py-2.5 pr-2 font-semibold">
                #
              </th>
              <th scope="col" className="py-2.5 pr-3 font-semibold">
                Item
              </th>
              <th scope="col" className="w-28 py-2.5 px-2 font-semibold">
                Symbol
              </th>
              <th scope="col" className="w-24 py-2.5 px-2 text-right font-semibold">
                Count
              </th>
              <th scope="col" className="w-28 py-2.5 px-2 font-semibold">
                Confidence
              </th>
              <th scope="col" className="w-24 py-2.5 pl-2 text-right font-semibold">
                <span className="sr-only">Row actions</span>
                Plan
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const selected = selectedIdx === idx
              const low = r.confidence === 'low'
              return (
                <tr
                  key={r.uid}
                  className={`border-b border-ink-line/60 align-top transition-colors ${
                    selected ? 'bg-ink-deep' : low ? 'bg-warning/5' : ''
                  }`}
                >
                  <td className={`py-2 pr-2 font-mono text-xs tabular-nums ${low ? 'border-l-2 border-l-warning pl-2 text-warning' : 'pl-0.5 text-text-dim'}`}>
                    {String(idx + 1).padStart(2, '0')}
                  </td>
                  <td className="py-1 pr-3">
                    <input
                      type="text"
                      value={r.type}
                      onChange={(e) => patch(r.uid, { type: e.target.value })}
                      disabled={disabled}
                      aria-label={`Item ${idx + 1} name`}
                      placeholder={r.manual ? 'e.g. Double GPO' : undefined}
                      className={CELL_INPUT}
                    />
                    {r.note && <p className="mt-0.5 max-w-md px-2 text-xs leading-snug text-text-dim">{r.note}</p>}
                  </td>
                  <td className="py-1 px-2">
                    <input
                      type="text"
                      value={r.symbol}
                      onChange={(e) => patch(r.uid, { symbol: e.target.value })}
                      disabled={disabled}
                      aria-label={`Item ${idx + 1} legend symbol`}
                      className={`${CELL_INPUT} font-mono`}
                    />
                  </td>
                  <td className="py-1 px-2">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={r.count}
                      onChange={(e) => patch(r.uid, { count: e.target.value })}
                      disabled={disabled}
                      aria-label={`${r.type || `item ${idx + 1}`} count`}
                      className={`${CELL_INPUT} text-right font-mono tabular-nums`}
                    />
                  </td>
                  <td className="py-2.5 px-2">
                    <ConfidenceBadge confidence={r.confidence} />
                  </td>
                  <td className="py-1.5 pl-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      {r.locations?.length ? (
                        <button
                          type="button"
                          onClick={() => onSelect(selected ? null : idx)}
                          disabled={disabled}
                          aria-pressed={selected ? 'true' : 'false'}
                          title={`Highlight ${r.locations.length} pin${r.locations.length === 1 ? '' : 's'} on the plan`}
                          className={`border px-2 py-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${
                            selected
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-ink-line text-text-dim hover:border-accent hover:text-accent'
                          }`}
                        >
                          {r.locations.length} pins
                        </button>
                      ) : (
                        <span className="px-2 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim/60">—</span>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(r.uid)}
                        disabled={disabled}
                        aria-label={`Remove ${r.type || `item ${idx + 1}`}`}
                        title="Remove this line (false positive)"
                        className="border border-transparent px-1.5 py-1 font-mono text-sm leading-none text-text-dim transition-colors hover:border-danger/60 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="font-mono text-sm">
              <td className="py-3 pr-2" />
              <td className="py-3 pr-3 font-semibold uppercase tracking-[0.12em] text-text-dim">
                Total devices
                {lowCount > 0 && (
                  <span className="ml-3 font-normal normal-case tracking-normal text-warning">
                    {lowCount} low-confidence line{lowCount === 1 ? '' : 's'} to verify
                  </span>
                )}
              </td>
              <td />
              <td className="py-3 px-2 text-right font-bold tabular-nums text-text-pri">{totalDevices}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="mt-3 inline-flex items-center gap-2 border border-dashed border-ink-line px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-sec transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
      >
        + Add missed item
      </button>
    </div>
  )
}
