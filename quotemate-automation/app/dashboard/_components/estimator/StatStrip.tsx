// KPI strip across the top of a run — big mono numerals, command-centre style.

export type Stat = {
  label: string
  value: string
  /** Optional secondary line under the value (e.g. "12 low confidence"). */
  detail?: string
  tone?: 'default' | 'accent' | 'warning' | 'good'
}

const TONE: Record<NonNullable<Stat['tone']>, string> = {
  default: 'text-text-pri',
  accent: 'text-accent',
  warning: 'text-warning',
  good: 'text-teal-glow',
}

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px border border-ink-line bg-ink-line sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-ink-card px-5 py-4">
          <dt className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
            {s.label}
          </dt>
          <dd className={`mt-1.5 font-mono text-2xl font-bold tabular-nums leading-none sm:text-3xl ${TONE[s.tone ?? 'default']}`}>
            {s.value}
          </dd>
          {s.detail && <p className="mt-1.5 font-mono text-[0.66rem] text-text-dim">{s.detail}</p>}
        </div>
      ))}
    </dl>
  )
}
