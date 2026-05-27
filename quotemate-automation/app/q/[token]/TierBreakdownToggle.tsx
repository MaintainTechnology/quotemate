'use client'

// Phase C — customer-side expand/collapse for the tier breakdown.
//
// Only mounted when the tier is in summary mode (Phase A tenant preference
// or Phase B per-quote override). The summary block above is always
// visible (scope paragraph + hours/items hint); this component adds a
// disclosure button that lets the customer reveal the full line-items
// table if they want the detail — without forcing it on every quote.
//
// Default state is COLLAPSED — the whole point of summary mode is that
// the tradie wants the lump-sum read by default. Expanding is the
// customer's opt-in; the tradie isn't surprised by the detail showing.

import { useState } from 'react'

type LineItem = {
  description?: string | null
  unit?: string | null
  quantity?: number | string | null
  unit_price_ex_gst?: number | string | null
  total_ex_gst?: number | string | null
  supplied_by?: 'tradie' | 'customer' | null
  safety_note?: string | null
}

function asNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'string' ? parseFloat(v) : v
}

function fmt(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function TierBreakdownToggle({ lineItems }: { lineItems: LineItem[] }) {
  const [open, setOpen] = useState(false)

  // No items → no toggle. Keeps the summary card clean for inspection
  // quotes or empty-tier edge cases.
  if (!Array.isArray(lineItems) || lineItems.length === 0) return null

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls="tier-breakdown-list"
        className="font-mono text-[0.62rem] uppercase tracking-[0.15em] text-text-dim hover:text-accent transition-colors cursor-pointer"
      >
        {open ? '▾ Hide breakdown' : '▸ See breakdown'}
      </button>

      {open && (
        <ul
          id="tier-breakdown-list"
          className="mt-3 divide-y divide-ink-line border-t border-ink-line text-sm"
        >
          {lineItems.map((li, i) => {
            const youSupply = li.supplied_by === 'customer'
            const safetyNote = (li.safety_note ?? '').trim()
            return (
              <li key={i} className="flex items-start justify-between gap-4 py-3.5">
                <div className="flex-1 min-w-0">
                  <div className="text-text-pri flex flex-wrap items-center gap-2">
                    <span>{li.description}</span>
                    {youSupply && (
                      <span
                        className="font-mono text-[0.6rem] uppercase tracking-[0.15em] font-bold px-1.5 py-0.5 border border-accent/60 text-accent shrink-0"
                        title="You're supplying this item yourself — we install only."
                      >
                        You supply
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[0.7rem] text-text-dim">
                    {li.quantity} × {li.unit} @ ${fmt(asNumber(li.unit_price_ex_gst))} ex GST
                    {youSupply ? ' · install only' : ''}
                  </div>
                  {youSupply && safetyNote && (
                    <p className="mt-1 text-[0.75rem] leading-snug text-text-dim normal-case">
                      {safetyNote}
                    </p>
                  )}
                </div>
                <div className="font-mono text-sm text-text-sec shrink-0">
                  ${fmt(asNumber(li.total_ex_gst))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
