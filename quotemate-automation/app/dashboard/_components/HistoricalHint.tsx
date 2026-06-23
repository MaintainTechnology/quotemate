'use client'

// In-quote historical-pricing hint (spec R11/R12). Renders an INFORMATIONAL
// badge — "your historical avg for X was $Y across N jobs" — beside a drafted
// quote when the tradie has confirmed history for that job_type. It never
// mutates the drafted customer price (the grounding validator owns pricing); it
// just shows the tradie their own past numbers. Renders nothing when there's no
// history, so it's safe to drop into any quote row.

import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'

type HintData =
  | { count: 0 }
  | {
      job_type: string
      trade: string | null
      count: number
      avg_price_inc_gst: number
      avg_price_ex_gst: number
      min_price_inc_gst: number
      max_price_inc_gst: number
      most_recent_quoted_at: string | null
    }

function money(n: number): string {
  return n.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  })
}

function jobLabel(jt: string): string {
  return jt.charAt(0).toUpperCase() + jt.slice(1).replace(/_/g, ' ')
}

function fmtMonth(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

export function HistoricalHint({
  jobType,
  trade,
  accessToken,
}: {
  jobType: string | null | undefined
  trade?: string | null
  accessToken: string | null
}) {
  const [data, setData] = useState<HintData | null>(null)

  useEffect(() => {
    if (!jobType || !accessToken) return
    let cancelled = false
    void (async () => {
      try {
        const params = new URLSearchParams({ job_type: jobType })
        if (trade) params.set('trade', trade)
        const res = await fetch(`/api/tenant/historical-quotes/hint?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        })
        if (!res.ok) return
        const json = (await res.json()) as HintData
        if (!cancelled) setData(json)
      } catch {
        // best-effort — a hint failure is silent, never blocks the quote view.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [jobType, trade, accessToken])

  if (!data || data.count === 0 || !('avg_price_inc_gst' in data)) return null

  return (
    <div className="mx-5 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-text-sec">
      <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-accent">
        <TrendingUp size={13} aria-hidden="true" />
        Your history
      </span>
      <span className="text-text-pri">
        Avg for {jobLabel(data.job_type)}: <strong>{money(data.avg_price_inc_gst)}</strong> inc GST
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {data.count} {data.count === 1 ? 'job' : 'jobs'}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {money(data.min_price_inc_gst)}–{money(data.max_price_inc_gst)}
      </span>
      {data.most_recent_quoted_at && (
        <>
          <span aria-hidden="true">·</span>
          <span>last {fmtMonth(data.most_recent_quoted_at)}</span>
        </>
      )}
    </div>
  )
}
