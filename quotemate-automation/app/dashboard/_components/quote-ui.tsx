// Shared premium primitives for the quote surfaces — one command-centre
// visual language across the Quotes tab, the Commercial Painting tender,
// and the Electrical Estimator bill-of-materials.
//
// Maintain Technology system: deep-ink canvas, disciplined orange accent,
// JetBrains-Mono numerals, hairline `gap-px` stat grids, borders not
// shadows, square corners, staggered fade-up. Presentational only — these
// carry NO data/business logic, so a redesign never risks a number or an
// action. Importable from both server and client components.

import type { CSSProperties, ReactNode } from 'react'

/* ── Motion ──────────────────────────────────────────────────────────
   Static animate class + inline animation-delay (a template-literal delay
   class would be invisible to Tailwind's static scan). Collapses to 0 via
   the global prefers-reduced-motion block. */
export const REVEAL = 'motion-safe:animate-[fade-up_260ms_ease-out_both]'
export function delay(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` }
}

/* ── Status language — ONE tone vocabulary, no more drift ───────────── */
export type Tone = 'good' | 'warn' | 'accent' | 'dim' | 'default'

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-teal-glow',
  warn: 'text-warning-bright',
  accent: 'text-accent',
  dim: 'text-text-dim',
  default: 'text-text-pri',
}
const TONE_CHIP: Record<Tone, string> = {
  good: 'border-teal-glow/60 text-teal-glow',
  warn: 'border-warning-bright/70 text-warning-bright',
  accent: 'border-accent/70 bg-accent/10 text-accent',
  dim: 'border-ink-line text-text-dim',
  default: 'border-ink-line text-text-sec',
}
const TONE_FILL: Record<Tone, string> = {
  good: 'bg-teal-glow',
  warn: 'bg-warning-bright',
  accent: 'bg-accent',
  dim: 'bg-ink-line',
  default: 'bg-ink-line',
}
/** Left status rail (3px) — at-a-glance triage colour for a list row. */
export const TONE_LEFT_RAIL: Record<Tone, string> = {
  good: 'border-l-teal-glow',
  warn: 'border-l-warning-bright',
  accent: 'border-l-accent',
  dim: 'border-l-ink-line',
  default: 'border-l-ink-line',
}

/** Bordered mono status pill. `dot` adds a tone-coloured indicator so the
 *  signal survives even at the most compact size (e.g. mobile rows). */
export function StatusPill({
  label,
  tone = 'default',
  dot = false,
  compact = false,
}: {
  label: string
  tone?: Tone
  dot?: boolean
  compact?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border font-mono font-semibold uppercase tracking-[0.12em] ${
        compact ? 'px-2 py-0.5 text-[0.58rem]' : 'px-2.5 py-1 text-[0.64rem]'
      } ${TONE_CHIP[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${TONE_FILL[tone]}`} aria-hidden="true" />}
      {label}
    </span>
  )
}

/* ── Section heading — orange mono eyebrow + full-width hairline rule ─
   The solar quote page's signature divider; keeps long, dense surfaces
   skimmable. */
export function SectionLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="whitespace-nowrap font-mono text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent">
        {children}
      </span>
      <span className="h-px flex-1 bg-ink-line" aria-hidden="true" />
      {hint != null && (
        <span className="whitespace-nowrap font-mono text-[0.66rem] uppercase tracking-[0.1em] text-text-dim">
          {hint}
        </span>
      )}
    </div>
  )
}

/* ── Hairline stat cluster — gap-px on bg-ink-line, bg-ink-card cells ─
   The single biggest premium "tell": sibling tiles share 1px seams and
   read as one instrument cluster instead of separate flat cards. Mark one
   cell `hero` to give the dominant metric size + accent dominance. */
export type StatCell = {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
  hero?: boolean
}
export function StatGrid({ stats, cols = 4 }: { stats: StatCell[]; cols?: 2 | 3 | 4 }) {
  const colCls = cols === 2 ? 'sm:grid-cols-2' : cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'
  return (
    <dl className={`grid grid-cols-2 gap-px border border-ink-line bg-ink-line ${colCls}`}>
      {stats.map((s, i) => (
        <div key={i} className={`px-5 py-4 ${s.hero ? 'bg-ink' : 'bg-ink-card'}`}>
          <dt className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
            {s.label}
          </dt>
          <dd
            className={`mt-1.5 font-mono font-bold leading-none tabular-nums ${
              s.hero ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
            } ${TONE_TEXT[s.tone ?? (s.hero ? 'accent' : 'default')]}`}
          >
            {s.value}
          </dd>
          {s.hint != null && <p className="mt-1.5 font-mono text-[0.66rem] text-text-dim">{s.hint}</p>}
        </div>
      ))}
    </dl>
  )
}

/* ── Hero total — the celebrated grand total (the brand's "result") ──
   Accent top-border + subtly lifted bg-ink panel; the headline figure is
   the largest mono number on the surface. `ledger` holds the supporting
   ex-GST/GST/subtotal rows so nothing is lost. */
export function HeroTotal({
  eyebrow,
  amount,
  caption,
  badge,
  ledger,
  style,
}: {
  eyebrow: string
  amount: ReactNode
  caption?: ReactNode
  badge?: ReactNode
  ledger?: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      className={`border border-ink-line border-t-2 border-t-accent bg-ink p-6 sm:p-7 ${REVEAL}`}
      style={style}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
            {eyebrow}
          </div>
          <div className="mt-2 font-mono text-4xl font-bold leading-none tabular-nums text-accent sm:text-5xl">
            {amount}
          </div>
          {caption != null && (
            <p className="mt-2.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-text-dim">
              {caption}
            </p>
          )}
        </div>
        {badge != null && <div className="shrink-0">{badge}</div>}
      </div>
      {ledger != null && <div className="mt-5 border-t border-ink-line pt-4">{ledger}</div>}
    </div>
  )
}

/** A right-aligned mono ledger row (Materials / Labour / Subtotal / GST). */
export function LedgerRow({
  label,
  value,
  strong,
}: {
  label: ReactNode
  value: ReactNode
  strong?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 py-1 font-mono tabular-nums ${
        strong ? 'text-text-pri' : 'text-text-sec'
      }`}
    >
      <span className="text-[0.78rem] uppercase tracking-[0.08em] text-text-dim">{label}</span>
      <span className={strong ? 'text-sm font-semibold' : 'text-sm'}>{value}</span>
    </div>
  )
}

/* ── Premium table shell — bordered card, consistent header, hover rows ─
   Replaces the bare border-collapse spreadsheet tables. Wrap a <table> in
   DataPanel and use the THEAD/TROW/TCELL classes for column rhythm. */
export function DataPanel({
  children,
  scroll = true,
}: {
  children: ReactNode
  scroll?: boolean
}) {
  return (
    <div className="overflow-hidden border border-ink-line bg-ink-card">
      <div className={scroll ? 'overflow-x-auto' : ''}>{children}</div>
    </div>
  )
}
export const THEAD_CELL =
  'border-b border-ink-line bg-ink-deep/40 px-4 py-2.5 text-left font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-text-dim'
export const TROW = 'border-t border-ink-line/70 transition-colors hover:bg-ink-deep/50'
export const TCELL = 'px-4 py-3 align-top text-sm'
