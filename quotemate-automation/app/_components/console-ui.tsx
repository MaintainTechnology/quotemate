// Shared console UI primitives for the Maintain design system (dark
// command-centre, orange accent, numbered cards, monospace metadata,
// square corners, borders not shadows).
//
// Used by both the tradie Marketing page (/dashboard/invites) and the
// admin Invites & recruitment page (/admin/invites). Lifted from the
// former so the two surfaces share one source of truth.
'use client'

import type { ReactNode } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'

/* ─── Maintain design tokens (class shorthands) ───────────────── */
export const INPUT =
  'w-full bg-ink-deep border border-ink-line px-3.5 py-2.5 text-sm text-text-pri placeholder:text-text-dim/60 focus:border-accent focus:outline-none transition-colors'
export const EYEBROW = 'font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim'
export const PRIMARY =
  'inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-3 text-xs uppercase tracking-[0.12em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
export const GHOST =
  'inline-flex items-center gap-2 border border-ink-line hover:border-accent text-text-pri px-4 py-2.5 text-xs uppercase tracking-[0.12em] transition-colors disabled:opacity-40'
export const TH = 'px-4 py-3 text-left font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim font-semibold'

/* ─── Auth ────────────────────────────────────────────────────── */
export async function authHeader(): Promise<Record<string, string>> {
  const supabase = getBrowserSupabase()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/* ─── Primitives ──────────────────────────────────────────────── */

export function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="font-mono text-3xl font-bold leading-none text-text-pri">{n}</div>
      <div className="mt-1.5 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">{label}</div>
    </div>
  )
}

export function Section({ num, title, blurb, delay, children }: { num: string; title: string; blurb: string; delay: number; children: ReactNode }) {
  return (
    <section className="mt-up mt-14" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start gap-5 md:gap-7">
        <span className="shrink-0 font-mono text-5xl font-bold leading-none text-accent md:text-6xl">{num}</span>
        <div className="pt-1">
          <h2 className="font-extrabold uppercase leading-none tracking-[-0.02em] text-2xl md:text-[1.7rem]">{title}</h2>
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-text-sec">{blurb}</p>
        </div>
      </div>
      <div className="mt-6 space-y-4">{children}</div>
    </section>
  )
}

export function Panel({ children }: { children: ReactNode }) {
  return <div className="border border-ink-line bg-ink-card p-6">{children}</div>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

export function TableShell({ loading, empty, emptyText, head, children }: { loading: boolean; empty: boolean; emptyText: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="border border-ink-line bg-ink-card">
      {loading ? <p className="p-6 font-mono text-xs uppercase tracking-[0.14em] text-text-dim">Loading…</p>
        : empty ? <p className="p-6 text-sm text-text-dim">{emptyText}</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-line">{head}</thead>
              <tbody>{children}</tbody>
            </table>
          </div>
        )}
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'active' ? 'text-success border-success/40'
      : status === 'paused' ? 'text-warning border-warning/40'
      : 'text-text-dim border-ink-line'
  return <span className={`inline-flex border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] ${tone}`}>{status}</span>
}

export function ActionBtn({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`uppercase tracking-[0.08em] transition-colors ${danger ? 'text-danger hover:text-red-400' : 'text-text-sec hover:text-text-pri'}`}>
      {children}
    </button>
  )
}
