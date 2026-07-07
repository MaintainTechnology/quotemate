'use client'

// Customer "Accept quote & confirm site visit" block (Gap #1 / #3).
//
// Rendered on every customer surface (electrical/plumbing /q/[token], solar,
// roofing, commercial painting, residential painting). The owning page resolves
// the gate state into an AcceptView (lib/quote/accept.resolveAcceptView) and
// hands it here; this component only renders it and drives the two-step
// "record acceptance → go to payment" interaction.
//
// On "Accept": POST /api/q/[token]/accept (records customer_accepted_at — the
// legal record that the customer accepted this exact price/scope), then
// navigate to view.payHref (the deposit or the $99 site-visit short-link,
// both of which mint a fresh Stripe Session server-side). Acceptance recording
// is best-effort — a transient failure still lets the customer proceed to pay.

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { AcceptView } from '@/lib/quote/accept'

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)' }
const SANS: CSSProperties = { fontFamily: 'var(--font-sans)' }

export function AcceptBlock({
  token,
  view,
  alreadyAccepted = false,
}: {
  token: string
  view: AcceptView
  /** Server-known: the customer already tapped accept on a prior visit. */
  alreadyAccepted?: boolean
}) {
  const [busy, setBusy] = useState(false)

  async function accept() {
    if (busy || !view.payHref) return
    setBusy(true)
    try {
      // Best-effort record — never block payment on it.
      await fetch(`/api/q/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: view.acceptTier }),
      }).catch(() => {})
    } finally {
      // Navigate regardless — the payment short-link is the point.
      window.location.assign(view.payHref)
    }
  }

  const accent = view.mode === 'deposit' || view.mode === 'inspection'
  const toneBorder =
    view.mode === 'paid'
      ? 'var(--success-bright)'
      : view.mode === 'expired'
        ? 'var(--warning-bright)'
        : 'var(--accent)'

  return (
    <section
      style={{
        padding: '24px',
        borderTop: '1px solid var(--ink-line)',
        background: 'var(--ink-deep)',
      }}
    >
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          border: `1px solid color-mix(in srgb, ${toneBorder} 55%, var(--ink-line))`,
          background: 'var(--ink-card)',
          padding: '22px 22px 24px',
        }}
      >
        <span
          aria-hidden="true"
          style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: toneBorder }}
        />
        <div style={{ ...MONO, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: toneBorder }}>
          {view.heading}
        </div>

        {alreadyAccepted && view.actionable ? (
          <div style={{ marginTop: 8, ...MONO, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)' }}>
            Accepted · continue to secure it
          </div>
        ) : null}

        {/* Confirmation lines — Jon's "by accepting you confirm…". */}
        <ul style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 9 }}>
          {view.confirmations.map((c, i) => (
            <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.45, color: 'var(--text-sec)' }}>
              <span aria-hidden="true" style={{ ...MONO, fontWeight: 700, color: accent ? 'var(--accent)' : toneBorder, flexShrink: 0 }}>
                {view.mode === 'deposit' || view.mode === 'inspection' ? '✓' : '·'}
              </span>
              <span>{c}</span>
            </li>
          ))}
        </ul>

        {/* Primary action (or a terminal-state notice). */}
        <div style={{ marginTop: 18 }}>
          {view.actionable && view.payHref ? (
            <button
              type="button"
              onClick={accept}
              disabled={busy}
              style={{
                display: 'block',
                width: '100%',
                cursor: busy ? 'default' : 'pointer',
                border: '1px solid transparent',
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                padding: '15px 16px',
                ...SANS,
                fontWeight: 800,
                fontSize: 14,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Confirming…' : view.ctaLabel}
            </button>
          ) : (
            <div
              style={{
                textAlign: 'center',
                border: '1px solid var(--ink-line)',
                color: view.mode === 'paid' ? 'var(--success-bright)' : 'var(--text-dim)',
                padding: '14px 16px',
                ...MONO,
                fontWeight: 700,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              {view.mode === 'paid' ? '✓ ' : ''}{view.ctaLabel}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
