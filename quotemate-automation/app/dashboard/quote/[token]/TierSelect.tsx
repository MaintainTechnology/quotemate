'use client'

// TierSelect — the Good/Better/Best picker on the dashboard quote viewer
// toolbar. Sets which single tier the quote sends as (PATCH /api/quote/[id]/tier)
// BEFORE the tradie hits Send. Only priced tiers appear; picking one refreshes
// the live preview to that tier. Server owns auth (owner-only), so — like
// SendQuotePanel — this renders for any viewer and surfaces a 403 inline.
//
// Hidden when fewer than two tiers are priced (nothing to choose). The parent
// hides it entirely for inspection quotes (no committable tiers).

import { useState } from 'react'
import { getAuthToken } from '@/lib/auth/client-token'

const KEYS = ['good', 'better', 'best'] as const
type TierKey = (typeof KEYS)[number]

type Tier = { label?: string; subtotal_ex_gst?: number } | null

export default function TierSelect(props: {
  quoteId: string
  tiers: { good: Tier; better: Tier; best: Tier }
  initialSelected: TierKey | null
  /** Disable interaction (e.g. the quote is paid). */
  disabled?: boolean
  /** Bump the preview so it re-reads the live quote after a successful change. */
  onChanged?: (tier: TierKey) => void
}) {
  const priced = KEYS.filter((k) => (props.tiers[k]?.subtotal_ex_gst ?? 0) > 0)
  const [selected, setSelected] = useState<TierKey | null>(
    props.initialSelected && priced.includes(props.initialSelected)
      ? props.initialSelected
      : (priced[0] ?? null),
  )
  const [pending, setPending] = useState<TierKey | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Nothing to choose between — a single-option quote is already "the offer".
  if (priced.length < 2) return null

  async function pick(tier: TierKey) {
    if (tier === selected || pending) return
    const prev = selected
    setSelected(tier) // optimistic
    setPending(tier)
    setErr(null)
    try {
      const token = await getAuthToken()
      if (!token) {
        setErr('Sign in as the quote owner to change the option.')
        setSelected(prev)
        return
      }
      const res = await fetch(`/api/quote/${props.quoteId}/tier`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; hint?: string }
        setErr(
          res.status === 401 || res.status === 403
            ? 'Sign in as the quote owner to change the option.'
            : b.hint ?? b.error ?? 'Could not change the option — try again.',
        )
        setSelected(prev)
        return
      }
      props.onChanged?.(tier)
    } catch {
      setErr('Could not change the option — check your connection and try again.')
      setSelected(prev)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className=" text-[0.6rem] uppercase tracking-[0.08em] text-text-dim">
        Option
      </span>
      <div
        role="group"
        aria-label="Which option to send"
        className="rounded-ctl inline-flex overflow-hidden border border-ink-line"
      >
        {priced.map((k) => {
          const on = k === selected
          return (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              disabled={props.disabled || pending !== null}
              aria-pressed={on}
              title={props.tiers[k]?.label ?? k}
              className={`min-h-[40px] px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                on
                  ? 'bg-accent text-accent-ink'
                  : 'bg-transparent text-text-pri hover:text-accent'
              }`}
            >
              {k}
            </button>
          )
        })}
      </div>
      {err && <span className="max-w-[14rem] text-xs text-accent">{err}</span>}
    </div>
  )
}
