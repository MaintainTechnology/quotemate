// "What's booked" card for the thank-you pages (spec 2026-07-22 booking
// three-page split, R4.2). Server component — no state, no client JS.
//
// Row treatment is lifted from CredentialFooter in ./parts.tsx (118px mono
// label column, hairline grid) so the confirmation card reads as the same
// document as the quote it followed. A null value omits its row entirely:
// blank money/address fields on a confirmation are worse than a shorter card.

import type { CSSProperties } from 'react'

// parts.tsx can write a bare var(--font-mono) because everything it renders
// lives inside the `.qm-quote` scope that re-declares it. This card is also
// used on the Tailwind-shelled /q/[token]/thanks page, where --font-mono only
// exists as a Tailwind @theme inline value (never emitted on :root) — hence
// the explicit fallback chain, or the label column renders in the sans face.
const MONO: CSSProperties = {
  fontFamily: 'var(--font-mono, var(--font-jetbrains-mono), ui-monospace, monospace)',
}

const LABEL: CSSProperties = {
  ...MONO,
  fontSize: 9.5,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--text-dim)',
}
const VALUE: CSSProperties = { fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.4 }
const ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '118px 1fr',
  gap: 12,
  padding: '11px 14px',
  background: 'var(--ink-card)',
}

export function BookedSummary({
  tradieName,
  jobLabel,
  visitLabel,
  place,
  quoteRef,
  paidLabel,
}: {
  tradieName: string | null
  jobLabel: string | null
  visitLabel: string | null
  place: string | null
  /** bookingRef(token) — how the customer quotes the job back to the tradie.
   *  Deliberately NOT named `ref`: React reserves that prop name, and a data
   *  prop called `ref` both trips react-hooks/refs and risks React itself
   *  intercepting it. */
  quoteRef: string
  /** formatPaidAmount(...) — null when the real charge isn't knowable. */
  paidLabel: string | null
}) {
  const rows: Array<{ k: string; v: string }> = []
  if (tradieName) rows.push({ k: 'Tradie', v: tradieName })
  if (jobLabel) rows.push({ k: 'Job', v: jobLabel })
  if (visitLabel) rows.push({ k: 'Visit', v: visitLabel })
  if (place) rows.push({ k: 'Address', v: place })
  if (quoteRef) rows.push({ k: 'Quote ref', v: quoteRef })
  if (paidLabel) rows.push({ k: 'Paid (inc GST)', v: paidLabel })
  rows.push({ k: 'Booked', v: `Online · self-serve${quoteRef ? ` · ref ${quoteRef}` : ''}` })

  return (
    <div>
      <div
        style={{
          ...MONO,
          fontSize: 9.5,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: 'var(--text-dim)',
          marginBottom: 8,
        }}
      >
        What&apos;s booked
      </div>
      <div
        style={{
          display: 'grid',
          gap: 1,
          border: '1px solid var(--ink-line)',
          background: 'var(--ink-line)',
          borderRadius: 'var(--qm-r-sm, 0)',
          overflow: 'hidden',
        }}
      >
        {rows.map((r) => (
          <div key={r.k} style={ROW}>
            <span style={LABEL}>{r.k}</span>
            <span style={VALUE}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
