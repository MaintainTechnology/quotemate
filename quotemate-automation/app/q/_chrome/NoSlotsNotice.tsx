// Shown when a pay CTA was REFUSED because the tenant has published no
// bookable windows (canTakePayment → /q/<token>?slots=0).
//
// Pay-first means the customer commits money before seeing any times, so the
// short-links refuse to mint a Session in that state. Without this notice the
// refusal is silent: the customer taps Pay, lands back on the same quote page,
// and taps Pay again. The whole point of the guard is that they understand
// nothing was charged and what happens next.
//
// Server component — no state, no client JS. Rendered by all three
// customer-view pages.

import type { CSSProperties } from 'react'

const MONO: CSSProperties = {
  fontFamily: 'var(--font-mono, var(--font-jetbrains-mono), ui-monospace, monospace)',
}

export function NoSlotsNotice({ tradieName }: { tradieName: string | null }) {
  const who = tradieName ?? 'Your tradie'
  return (
    <div
      role="status"
      style={{
        border: '1px solid var(--accent)',
        background: 'var(--ink-card)',
        padding: '16px 18px',
      }}
    >
      <div
        style={{
          ...MONO,
          fontSize: 9.5,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color: 'var(--accent)',
        }}
      >
        No payment taken
      </div>
      <p
        style={{
          margin: '9px 0 0',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'var(--text-sec)',
          maxWidth: '58ch',
        }}
      >
        We&apos;ll arrange your time by text. {who} hasn&apos;t published bookable
        times yet, so we haven&apos;t taken any payment — they&apos;ll text you
        within one business day to lock one in.
      </p>
    </div>
  )
}
