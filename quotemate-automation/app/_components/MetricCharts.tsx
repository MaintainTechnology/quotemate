'use client'

// Lightweight, dependency-free charts shared by the company (/admin/metrics)
// and tradie (/dashboard Overview) analytics. Flexbox bars over an SVG lib —
// crisp at any width, themed with the Maintain tokens (accent / teal / ink).
// Exact values live in the `title` tooltip; a text caption carries totals so
// the chart never relies on colour alone.

type Tone = 'accent' | 'teal'

const BAR_TONE: Record<Tone, string> = {
  accent: 'bg-accent/70',
  teal: 'bg-teal-glow/70',
}

export type BarPoint = { label: string; value: number }
export type SplitDatum = { label: string; count: number }

/** A single-series bar chart (e.g. quotes per week). */
export function TrendBars({
  title,
  points,
  tone = 'accent',
  caption,
  className = '',
}: {
  title: string
  points: BarPoint[]
  tone?: Tone
  caption?: string
  /** Extra surface classes (e.g. `rounded-card edge-lit` on the dashboard).
   *  Defaults to none so /admin/metrics keeps its square plates. */
  className?: string
}) {
  const values = points.map((p) => p.value)
  const max = Math.max(1, ...values)
  const peak = Math.max(0, ...values)
  const total = values.reduce((a, b) => a + b, 0)

  return (
    <div className={`bg-ink-card border border-ink-line p-5 ${className}`}>
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-text-dim">
          {title}
        </div>
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-sec">
          {caption ?? `${total} total · peak ${peak}`}
        </div>
      </div>

      <div className="mt-4 flex h-28 items-end gap-1.5">
        {points.map((p, i) => {
          const h = Math.round((p.value / max) * 100)
          return (
            <div
              key={`${p.label}-${i}`}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${p.label}: ${p.value}`}
            >
              <div
                className={`w-full ${BAR_TONE[tone]} transition-[height]`}
                style={{ height: `${h}%`, minHeight: p.value > 0 ? 3 : 0 }}
              />
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex gap-1.5">
        {points.map((p, i) => (
          <div
            key={`${p.label}-${i}`}
            className="flex-1 truncate text-center font-mono text-[0.5rem] uppercase tracking-[0.08em] text-text-dim"
          >
            {/* Thin the axis labels when crowded; always keep first + last. */}
            {points.length <= 8 || i % 2 === 0 || i === points.length - 1 ? p.label : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Horizontal split bars for channel / trade / job-type breakdowns. */
export function SplitBars({
  title,
  slices,
  tone = 'accent',
  emptyLabel = 'No data yet',
  className = '',
}: {
  title: string
  slices: SplitDatum[]
  tone?: Tone
  emptyLabel?: string
  /** Extra surface classes (e.g. `rounded-card edge-lit` on the dashboard).
   *  Defaults to none so /admin/metrics keeps its square plates. */
  className?: string
}) {
  const max = Math.max(1, ...slices.map((s) => s.count))
  const total = slices.reduce((a, s) => a + s.count, 0)

  return (
    <div className={`bg-ink-card border border-ink-line p-5 ${className}`}>
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-text-dim">
          {title}
        </div>
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-sec">
          {total} total
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {slices.length === 0 && (
          <div className="font-mono text-xs text-text-dim">{emptyLabel}</div>
        )}
        {slices.map((s, i) => (
          <div key={`${s.label}-${i}`} className="flex items-center gap-3">
            <div className="w-24 shrink-0 truncate font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim">
              {s.label}
            </div>
            <div className="h-3 flex-1 bg-ink-line/40">
              <div
                className={`h-full ${BAR_TONE[tone]}`}
                style={{ width: `${Math.round((s.count / max) * 100)}%` }}
                title={`${s.label}: ${s.count}`}
              />
            </div>
            <div className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-text-sec">
              {s.count}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
