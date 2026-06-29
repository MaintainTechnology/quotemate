'use client'

// Shared onboarding-funnel chrome — the premium two-column shell used by every
// step of sign-up → activation so the whole 01→04 journey looks identical:
//   • /signup            → step 01 (account)
//   • /onboard (wizard)  → steps 02 / 03 / 04
//
// Left rail (desktop, sticky): brand framing + a vertical progress stepper.
// Right column: a compact stepper on mobile, the step's heading + subtitle,
// then the page's own form/card (passed as children). One source of truth so
// the rail + stepper can never drift between the two surfaces.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { BrandMark } from '@/app/_components/BrandMark'

/** The full funnel, in order. `num` doubles as the stable step id. */
export const STEPS = [
  { num: '01', label: 'Account' },
  { num: '02', label: 'Trade & licence' },
  { num: '03', label: 'Your pricing' },
  { num: '04', label: 'Review & activate' },
] as const

const EYEBROW = 'font-mono text-[0.7rem] uppercase tracking-[0.18em] text-text-dim'

export function FunnelShell({
  currentNum,
  heading,
  subtitle,
  children,
  railNote = 'No card needed · About 3 minutes',
}: {
  /** The active step's `num`, e.g. '01'. Drives the stepper highlight. */
  currentNum: string
  /** Right-column page heading (rendered as the visible h2). */
  heading: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  railNote?: string
}) {
  return (
    <main className="min-h-screen">
      <style>{`
        @keyframes mtUp { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        .mt-up { animation: mtUp .5s cubic-bezier(.22,1,.36,1) both }
        @media (prefers-reduced-motion: reduce) { .mt-up { animation: none } }
      `}</style>

      {/* Single page-level heading — always present (the visible rail headline
          is hidden on mobile, so this keeps the h1 → h2 → h3 order intact for
          screen readers regardless of viewport). */}
      <h1 className="sr-only">Set up your QuoteMax</h1>

      {/* nav */}
      <nav className="border-b border-ink-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9" />
            <span className="font-extrabold uppercase tracking-tight text-text-pri">QuoteMax</span>
          </Link>
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
            Step {currentNum} <span className="text-ink-line">/</span> 04
          </span>
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-6 py-12 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[18rem_1fr] lg:gap-16">
          {/* ── Left rail: brand + progress (desktop) ─────────── */}
          <aside className="hidden lg:block lg:sticky lg:top-24 lg:self-start">
            <span className={EYEBROW}>Set up</span>
            <p className="mt-4 font-extrabold uppercase leading-[0.95] tracking-[-0.03em] text-[clamp(1.9rem,2.6vw,2.5rem)]">
              Set up your<br />
              <span className="text-accent">QuoteMax</span>.
            </p>
            <p className="mt-4 max-w-[17rem] leading-relaxed text-text-sec">
              A few details and your AI quoting line goes live. Everything here can be
              changed later from your dashboard.
            </p>
            <Stepper current={currentNum} className="mt-10" />
            <p className="mt-10 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">
              {railNote}
            </p>
          </aside>

          {/* ── Right column ─────────────────────────────────── */}
          <div className="min-w-0">
            <div className="mb-9 lg:hidden">
              <MobileStepper current={currentNum} />
            </div>
            <header className="mb-7">
              <h2 className="font-extrabold uppercase leading-[1.05] tracking-[-0.025em] text-[clamp(1.6rem,3vw,2.1rem)]">
                {heading}
              </h2>
              {subtitle && <p className="mt-2.5 max-w-md leading-relaxed text-text-sec">{subtitle}</p>}
            </header>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}

// Vertical progress rail (desktop left column). Shows the whole funnel with
// done / active / upcoming states and a connecting spine.
export function Stepper({ current, className = '' }: { current: string; className?: string }) {
  const currentIdx = STEPS.findIndex((s) => s.num === current)
  return (
    <ol className={`relative ${className}`} aria-label="Onboarding progress">
      {STEPS.map((s, i) => {
        const status = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'upcoming'
        const last = i === STEPS.length - 1
        return (
          <li key={s.num} className={`relative flex gap-4 ${last ? '' : 'pb-7'}`}>
            {!last && (
              <span
                aria-hidden
                className={`absolute left-[1.125rem] top-9 bottom-1 w-px ${status === 'done' ? 'bg-accent/40' : 'bg-ink-line'}`}
              />
            )}
            <span
              aria-hidden
              className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center border font-mono text-xs font-bold ${
                status === 'active'
                  ? 'border-accent bg-accent text-white'
                  : status === 'done'
                    ? 'border-accent/50 text-accent'
                    : 'border-ink-line text-text-dim'
              }`}
            >
              {status === 'done' ? <Check className="h-4 w-4" strokeWidth={2.5} /> : s.num}
            </span>
            <div className="pt-1" aria-current={status === 'active' ? 'step' : undefined}>
              <div className={`text-sm font-semibold leading-tight ${status === 'upcoming' ? 'text-text-dim' : 'text-text-pri'}`}>
                {s.label}
              </div>
              <div
                className={`mt-1 font-mono text-[0.58rem] uppercase tracking-[0.14em] ${
                  status === 'active' ? 'text-accent' : 'text-text-dim'
                }`}
              >
                {status === 'active' ? 'In progress' : status === 'done' ? 'Done' : 'Up next'}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// Compact horizontal progress (mobile). A labelled segmented bar.
export function MobileStepper({ current }: { current: string }) {
  const currentIdx = STEPS.findIndex((s) => s.num === current)
  return (
    <div aria-label="Onboarding progress">
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <span
            key={s.num}
            aria-hidden
            className={`h-1 flex-1 transition-colors ${i <= currentIdx ? 'bg-accent' : 'bg-ink-line'}`}
          />
        ))}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">
          Step {current} / 04
        </span>
        <span className="text-sm font-semibold text-text-pri">{STEPS[currentIdx]?.label}</span>
      </div>
    </div>
  )
}
