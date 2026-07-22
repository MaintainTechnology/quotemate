'use client'

// "Show someone" control for the 3D showcase.
//
// MECHANISM: navigator.share() — the OS share sheet already contains Messages,
// iMessage, WhatsApp, Facebook and Instagram, so the page needs no platform
// icons at all and stays tidy. That is the whole reason not to hand-roll five
// social buttons.
//
// Fallback chain, in order: Web Share -> sms: deep-link (the pattern
// /s/[shortCode] and /start/[tenantId] already use) -> copy to clipboard.
//
// Deliberately NO server-side send. A public endpoint that accepts a phone
// number and texts it is a spam and toll-fraud vector, and the SMS path has no
// rate limiting or E.164 validation today. The customer's own messaging app
// does the sending, so it costs nothing and cannot be abused.
//
// What gets shared is /share/<token> — a page with the house and the chosen
// colours and NOTHING else. Never the thank-you URL, which carries the price,
// the address and the booked time.

import { useState } from 'react'
import { SHARE_RECIPIENTS, buildShareMessage, type ShareRecipientId } from '@/lib/roofing/showcase'

type Props = {
  /** Fully-built /share/<token>?… URL carrying the current colour choice. */
  shareUrl: string
}

const CONTROL: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--ink-line)',
  background: 'var(--ink-card)',
  color: 'var(--text-pri)',
  padding: '11px 14px',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 600,
  minHeight: 44,
}

export function ShareHouse({ shareUrl }: Props) {
  const [recipient, setRecipient] = useState<ShareRecipientId>('partner')
  const [note, setNote] = useState<string | null>(null)

  async function onShare() {
    const text = buildShareMessage(recipient, shareUrl)
    setNote(null)

    // 1. The OS sheet — covers every platform the brief asked for.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Our new roof', text, url: shareUrl })
        return
      } catch (err: unknown) {
        // The user dismissing the sheet is not an error — don't fall through
        // to a second attempt they didn't ask for.
        if (err instanceof Error && err.name === 'AbortError') return
      }
    }

    // 2. sms: deep-link — opens their own messaging app with the text ready.
    if (recipient !== 'copy') {
      window.location.href = `sms:?&body=${encodeURIComponent(text)}`
      return
    }

    // 3. Clipboard.
    try {
      await navigator.clipboard.writeText(shareUrl)
      setNote('Link copied')
    } catch {
      setNote('Copy this link: ' + shareUrl)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
      <label
        htmlFor="share-recipient"
        style={{
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: 9.5,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: 'var(--text-dim)',
        }}
      >
        Show someone
      </label>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select
          id="share-recipient"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value as ShareRecipientId)}
          style={{ ...CONTROL, flex: '1 1 170px' }}
        >
          {SHARE_RECIPIENTS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onShare}
          className="qm-cta"
          style={{
            ...CONTROL,
            border: '1px solid transparent',
            background: 'var(--accent)',
            // Dark ink on the accent — white on yellow is ~1.4:1.
            color: 'var(--accent-ink)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            cursor: 'pointer',
            flex: '0 0 auto',
          }}
        >
          Share it →
        </button>
      </div>

      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-dim)' }}>
        {note ?? 'Opens your phone’s share sheet — Messages, WhatsApp, Instagram, wherever you like.'}
      </p>
    </div>
  )
}
