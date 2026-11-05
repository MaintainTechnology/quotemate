// The plan takeoff pages' shared parts (TKO-19): chips, notices, tables and
// the two button styles, in the Command Centre's tokens (Design Brief §2-§4).

import type { ChipSpec, Tone } from '../takeoff-api'

/** The one yellow action on a screen, in dark text (the Dark-on-Yellow Rule). */
export const PRIMARY =
  'rounded-ctl inline-flex min-h-11 items-center gap-2 bg-accent px-6 text-sm font-semibold uppercase tracking-[0.08em] text-accent-ink transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50'
/** Every other action: a hairline outline. */
export const SECONDARY =
  'rounded-ctl inline-flex min-h-11 items-center gap-2 border border-ink-line px-5 text-sm font-semibold uppercase tracking-[0.08em] text-text-sec transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50'

const TONES: Record<Tone, string> = {
  neutral: 'border border-ink-line text-text-sec',
  active: 'border border-accent text-accent',
  success: 'border border-success text-success-bright',
  warning: 'border border-warning text-warning-bright',
  danger: 'border border-danger text-danger-bright',
  filled: 'border border-ink-line bg-ink-line text-text-pri',
}

/** A status or result chip: its icon and word, never the colour alone. */
export function Chip({ chip }: { chip: ChipSpec }) {
  return (
    <span className={`rounded-ctl inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] ${TONES[chip.tone]}`}>
      <span aria-hidden="true" className={chip.tone === 'active' ? 'motion-safe:animate-pulse' : undefined}>
        {chip.icon}
      </span>
      {chip.words}
    </span>
  )
}

const NOTICE_EDGES = { neutral: 'border-l-ink-line', warning: 'border-l-warning', danger: 'border-l-danger' }

/** A one-line notice; a danger notice is announced as an alert. */
export function Notice({ tone, children }: { tone: keyof typeof NOTICE_EDGES; children: React.ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`border border-l-4 border-ink-line ${NOTICE_EDGES[tone]} bg-ink-card px-4 py-3 text-sm text-text-pri`}>
      {children}
    </div>
  )
}

/** A table with real header cells, scrolling sideways on a phone. */
export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="rounded-card overflow-x-auto border border-ink-line bg-ink-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-ink-line font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** Shown where the takeoff service isn't switched on. */
export function TakeoffsOff() {
  return <p className="mx-auto max-w-3xl px-5 py-16 text-text-sec">Plan takeoffs aren&rsquo;t switched on for this site yet.</p>
}
