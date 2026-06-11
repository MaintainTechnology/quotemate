'use client'

// Shared presentational primitives for the Signage Compliance surface.
//
// One visual language across the five HQ dashboard pages and the two
// franchisee-facing token pages: the Maintain command-centre system —
// deep-ink canvas, orange accent, teal topographic edge, monospace tags,
// square corners, staggered fade-up reveals. Brand-agnostic by design:
// Anytime Fitness and F45 flow through the same premium chrome.

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { withBrand } from './BrandTabs'

/* ── Motion ──────────────────────────────────────────────────────────
   Static animate class + inline animation-delay. (A template-literal
   delay class would be invisible to Tailwind's static scan.) */

export const REVEAL = 'motion-safe:animate-[fade-up_260ms_ease-out_both]'
export const REVEAL_SOFT = 'motion-safe:animate-[fade-in_320ms_ease-out_both]'

export function delay(ms: number): React.CSSProperties {
  return { animationDelay: `${ms}ms` }
}

/* ── Topographic backdrop — the signature Maintain motif ───────────── */

export function TopoBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.10]"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <path d="M0,820 Q240,640 480,730 T960,680 T1440,740 T1920,640" stroke="var(--teal-glow)" strokeWidth="1" fill="none" />
      <path d="M0,880 Q260,700 520,790 T1000,740 T1480,800 T1920,700" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.7" />
      <path d="M0,940 Q280,770 560,850 T1040,800 T1520,860 T1920,770" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.45" />
      <path d="M0,180 Q320,300 640,220 T1280,260 T1920,190" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.35" />
      <path d="M0,110 Q300,230 600,150 T1240,190 T1920,120" stroke="var(--teal-glow)" strokeWidth="1" fill="none" opacity="0.2" />
    </svg>
  )
}

/* ── Navigation ─────────────────────────────────────────────────────── */

export type SignageSection = 'overview' | 'queue' | 'audit' | 'studios' | 'shots'

const NAV_ITEMS: Array<{ key: SignageSection; href: string; label: string }> = [
  { key: 'overview', href: '/dashboard/signage', label: 'Overview' },
  { key: 'queue', href: '/dashboard/signage/queue', label: 'Review queue' },
  { key: 'audit', href: '/dashboard/signage/audit', label: 'Instant audit' },
  { key: 'studios', href: '/dashboard/signage/studios', label: 'Studios' },
  { key: 'shots', href: '/dashboard/signage/shots', label: 'Shots' },
]

/** Persistent section nav — every signage page is one click from any other. */
export function SignageNav({ active, brandSlug }: { active: SignageSection; brandSlug: string | null }) {
  return (
    <nav aria-label="Signage sections" className="border-b border-ink-line">
      <div className="-mb-px flex gap-1 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const current = item.key === active
          return (
            <Link
              key={item.key}
              href={withBrand(item.href, brandSlug)}
              aria-current={current ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-4 py-3 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] transition-colors ${
                current
                  ? 'border-accent text-text-pri'
                  : 'border-transparent text-text-dim hover:border-ink-line hover:text-text-sec'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export function Crumbs({ trail }: { trail: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      {trail.map((c, i) => (
        <span key={c.label} className="flex items-center gap-3">
          {i > 0 && <span className="text-ink-line" aria-hidden="true">/</span>}
          {c.href ? (
            <Link href={c.href} className="transition-colors hover:text-text-pri">{c.label}</Link>
          ) : (
            <span aria-current="page" className="text-text-pri">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

/* ── Headings + form chrome ─────────────────────────────────────────── */

export function SectionHeading({ eyebrow, title, hint }: { eyebrow: string; title: string; hint?: string }) {
  return (
    <div>
      <div className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</div>
      <h2 className="mt-3 font-extrabold uppercase leading-[1.1] tracking-[-0.025em] text-[clamp(1.5rem,2.6vw,2.25rem)]">{title}</h2>
      {hint && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-sec">{hint}</p>}
    </div>
  )
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  const cls = 'mb-2 block font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim'
  if (htmlFor) {
    return <label htmlFor={htmlFor} className={cls}>{children}</label>
  }
  return <div className={cls}>{children}</div>
}

export const INPUT =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim transition-colors focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40'

export const INPUT_SM =
  'w-full border border-ink-line bg-ink-deep px-3 py-2.5 font-mono text-sm text-text-pri placeholder:text-text-dim transition-colors focus:border-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40'

export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-2 bg-accent px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50'

export const BTN_GHOST =
  'inline-flex items-center justify-center gap-2 border border-ink-line px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50'

export const BTN_GHOST_SM =
  'inline-flex items-center justify-center gap-1.5 border border-ink-line px-3 py-1.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-text-sec transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50'

export const BTN_DANGER_SM =
  'inline-flex items-center justify-center gap-1.5 border border-ink-line px-3 py-1.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-text-dim transition-colors hover:border-warning-bright hover:text-warning-bright disabled:cursor-not-allowed disabled:opacity-50'

/* ── Status language — one vocabulary across every signage surface ──── */

export type Tone = 'good' | 'warn' | 'accent' | 'dim'

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-teal-glow',
  warn: 'text-warning-bright',
  accent: 'text-accent',
  dim: 'text-text-dim',
}
const TONE_CHIP: Record<Tone, string> = {
  good: 'border-teal-glow text-teal-glow',
  warn: 'border-warning-bright text-warning-bright',
  accent: 'border-accent text-accent',
  dim: 'border-ink-line text-text-dim',
}

export function Chip({ label, tone, compact }: { label: string; tone: Tone; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center border px-2.5 py-1 font-mono ${compact ? 'text-[0.62rem]' : 'text-[0.68rem]'} font-semibold uppercase tracking-[0.12em] ${TONE_CHIP[tone]}`}>
      {label}
    </span>
  )
}

export function overallTone(overall: string | null): { label: string; tone: Tone } {
  if (overall === 'pass') return { label: 'Compliant', tone: 'good' }
  if (overall === 'fix_needed') return { label: 'To fix', tone: 'warn' }
  if (overall === 'needs_review') return { label: 'Needs review', tone: 'accent' }
  return { label: 'Not assessed', tone: 'dim' }
}

export function OverallChip({ overall, compact }: { overall: string | null; compact?: boolean }) {
  const { label, tone } = overallTone(overall)
  return <Chip label={label} tone={tone} compact={compact} />
}

/** ✓ / ✕ / ◑ — the per-rule verdict glyph. */
export function StateGlyph({ state }: { state: 'compliant' | 'fix' | 'review' }) {
  if (state === 'compliant') return <span className="text-teal-glow" role="img" aria-label="Compliant">✓</span>
  if (state === 'fix') return <span className="text-warning-bright" role="img" aria-label="Fix needed">✕</span>
  return <span className="text-accent" role="img" aria-label="Needs review">◑</span>
}

/** Left severity rail for verdict cards. */
export function railFor(state: 'compliant' | 'fix' | 'review'): string {
  if (state === 'fix') return 'border-l-2 border-l-warning-bright'
  if (state === 'review') return 'border-l-2 border-l-accent'
  return 'border-l-2 border-l-teal-glow/50'
}

/* ── Data display ───────────────────────────────────────────────────── */

export function Stat({ label, value, tone, style }: { label: string; value: number; tone?: Tone; style?: React.CSSProperties }) {
  return (
    <div className={`border border-ink-line bg-ink-card p-5 ${REVEAL}`} style={style}>
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className={`mt-2 font-mono text-3xl font-bold tabular-nums ${tone ? TONE_TEXT[tone] : 'text-text-pri'}`}>{value}</div>
    </div>
  )
}

export function Tally({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <div className="border border-ink-line bg-ink-card p-4 text-center">
      <div className={`font-mono text-3xl font-bold tabular-nums ${TONE_TEXT[tone]}`}>{value}</div>
      <div className="mt-1 font-mono text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-text-dim">{label}</div>
    </div>
  )
}

/** Segmented fleet-health bar: compliant / to fix / needs review / awaiting. */
export function ComplianceBar({
  pass,
  fix,
  review,
  awaiting = 0,
  size = 'md',
  legend = true,
}: {
  pass: number
  fix: number
  review: number
  awaiting?: number
  size?: 'sm' | 'md'
  legend?: boolean
}) {
  const total = pass + fix + review + awaiting
  if (total === 0) return null
  const segments: Array<{ key: string; label: string; count: number; cls: string }> = [
    { key: 'pass', label: 'Compliant', count: pass, cls: 'bg-teal-glow' },
    { key: 'fix', label: 'To fix', count: fix, cls: 'bg-warning-bright' },
    { key: 'review', label: 'Needs review', count: review, cls: 'bg-accent' },
    { key: 'awaiting', label: 'Awaiting', count: awaiting, cls: 'bg-ink-line' },
  ]
  const visible = segments.filter((s) => s.count > 0)
  const summary = visible.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ')
  return (
    <div>
      <div
        role="img"
        aria-label={`Fleet health: ${summary}`}
        className={`flex w-full gap-px overflow-hidden bg-ink-deep ${size === 'sm' ? 'h-1' : 'h-2'}`}
      >
        {visible.map((s) => (
          <div key={s.key} className={s.cls} style={{ flexGrow: s.count }} />
        ))}
      </div>
      {legend && (
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5" aria-hidden="true">
          {visible.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-2 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-text-dim">
              <span className={`h-2 w-2 ${s.cls}`} />
              {s.label} <span className="tabular-nums text-text-sec">{s.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** The six-stat fleet snapshot + health bar — one rendering shared by the
 *  hub and the review queue. */
export function FleetSnapshot({
  rollup,
}: {
  rollup: { studios: number; assessed: number; pass: number; fix_needed: number; needs_review: number; awaiting: number }
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Studios" value={rollup.studios} style={delay(0)} />
        <Stat label="Assessed" value={rollup.assessed} style={delay(50)} />
        <Stat label="Compliant" value={rollup.pass} tone="good" style={delay(100)} />
        <Stat label="To fix" value={rollup.fix_needed} tone="warn" style={delay(150)} />
        <Stat label="Needs review" value={rollup.needs_review} tone="accent" style={delay(200)} />
        <Stat label="Awaiting" value={rollup.awaiting} style={delay(250)} />
      </div>
      <div className={`mt-5 border border-ink-line bg-ink-card p-5 ${REVEAL}`} style={delay(300)}>
        <div className="mb-3 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">Fleet health</div>
        <ComplianceBar pass={rollup.pass} fix={rollup.fix_needed} review={rollup.needs_review} awaiting={rollup.awaiting} />
      </div>
    </div>
  )
}

/** Big mono number + tracked eyebrow — the numbered-step marker. */
export function NumberedEyebrow({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-4xl font-bold leading-none text-accent">{n}</span>
      <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-text-dim">{children}</span>
    </div>
  )
}

/* ── States ─────────────────────────────────────────────────────────── */

export function EmptyState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="border border-dashed border-ink-line bg-ink-card/50 px-7 py-10 text-center">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-text-dim">{title}</div>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-sec">{body}</p>
      {children && <div className="mt-5 flex justify-center">{children}</div>}
    </div>
  )
}

export function Notice({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const rail = tone === 'good' ? 'border-l-teal-glow' : tone === 'warn' ? 'border-l-warning-bright' : tone === 'accent' ? 'border-l-accent' : 'border-l-ink-line'
  return (
    <div className={`border border-ink-line border-l-4 ${rail} bg-ink-card p-6`}>
      <div className="text-sm leading-relaxed text-text-sec">{children}</div>
    </div>
  )
}

/* ── Lightbox ───────────────────────────────────────────────────────── */

export function Lightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Move focus into the dialog, lock body scroll, close on Escape, and
    // restore both on unmount.
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [onClose])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? 'Image preview'}
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm ${REVEAL_SOFT}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt ?? 'Preview'} className="max-h-[88vh] max-w-[92vw] border border-ink-line object-contain" />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="absolute right-6 top-6 border border-ink-line bg-ink-card px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent"
      >
        Close ✕
      </button>
    </div>
  )
}
