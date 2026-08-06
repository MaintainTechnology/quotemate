'use client'

// SendQuotePanel — the "Send to Customer" toolbar action on the dashboard
// quote viewer. Toggles a dropdown with an SMS row (number on file, or a
// manual input when none) and an email row (prefilled, editable, PDF
// attached). Both rows POST to /api/quote/[id]/send with the tradie's bearer
// token; the server owns auth, recipient fallback, dispatch and lifecycle.

import { useState } from 'react'
import { getAuthToken } from '@/lib/auth/client-token'

type RowState = { pending: boolean; ok: string | null; err: string | null }
const idle: RowState = { pending: false, ok: null, err: null }

export default function SendQuotePanel(props: {
  quoteId: string
  customerPhone: string | null
  customerEmail: string | null
  paid: boolean
  /** Button text — the Quotes-tab action bar labels it "Confirm & Send" for
   *  quotes still awaiting the tradie's review (lib/quote/send-customer
   *  confirmSendCta). Defaults to the viewer's "Send to Customer". */
  label?: string
  /** Open the dropdown above the button — needed inside the Quotes-tab
   *  sticky bottom action bar, where downward would clip off-viewport. */
  dropUp?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState(props.customerEmail ?? '')
  const [sms, setSms] = useState<RowState>(idle)
  const [mail, setMail] = useState<RowState>(idle)

  async function send(channel: 'sms' | 'email') {
    const setRow = channel === 'sms' ? setSms : setMail
    setRow({ pending: true, ok: null, err: null })
    try {
      const token = await getAuthToken()
      if (!token) {
        setRow({ pending: false, ok: null, err: 'Sign in as the quote owner to send.' })
        return
      }
      // Only pass an override when the tradie typed one; otherwise the server
      // resolves the on-file contact through the full fallback chain.
      const to =
        channel === 'sms'
          ? props.customerPhone
            ? undefined
            : phone.trim() || undefined
          : email.trim() && email.trim() !== (props.customerEmail ?? '')
            ? email.trim()
            : undefined
      const res = await fetch(`/api/quote/${props.quoteId}/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel, ...(to ? { to } : {}) }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        message?: string
        error?: string
      }
      if (res.status === 401 || res.status === 403) {
        setRow({ pending: false, ok: null, err: 'Sign in as the quote owner to send.' })
        return
      }
      if (!res.ok) {
        setRow({
          pending: false,
          ok: null,
          err: body.message ?? body.error ?? 'Send failed — try again.',
        })
        return
      }
      setRow({
        pending: false,
        ok: channel === 'sms' ? 'SMS sent to the customer.' : 'Email sent to the customer.',
        err: null,
      })
    } catch {
      setRow({ pending: false, ok: null, err: 'Send failed — check your connection and try again.' })
    }
  }

  const smsReady = !sms.pending && (props.customerPhone !== null || phone.trim().length > 0)
  const mailReady = !mail.pending && email.trim().length > 0

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={props.paid}
        title={props.paid ? 'This quote is paid — nothing further to send.' : undefined}
        className="rounded-ctl inline-flex min-h-[40px] items-center gap-2 bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wider text-accent-ink transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
      >
        {props.label ?? 'Send to Customer'}
      </button>

      {open && !props.paid && (
        <div
          className={`absolute z-40 w-[22rem] max-w-[calc(100vw-2rem)] border border-ink-line bg-ink-deep p-4 shadow-lg ${
            // Quotes-tab mount sits leftmost in the pinned bottom bar, so the
            // panel opens up + left-aligned; the viewer button hugs the right
            // screen edge, so it keeps the original down + right-aligned drop.
            props.dropUp ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2'
          }`}
        >
          {/* ─── SMS row ─── */}
          <div className="mb-4">
            <div className="mb-1 text-[0.6rem] uppercase tracking-[0.08em] text-text-dim">
              Text message
            </div>
            {props.customerPhone ? (
              <div className="mb-2 text-sm text-text-sec">{props.customerPhone}</div>
            ) : (
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Customer mobile, e.g. +61 4xx xxx xxx"
                className="mb-2 w-full border border-ink-line bg-transparent px-3 py-2 text-sm text-text-pri placeholder:text-text-dim"
              />
            )}
            <button
              type="button"
              onClick={() => send('sms')}
              disabled={!smsReady}
              className="rounded-ctl inline-flex min-h-[36px] items-center border border-ink-line px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sms.pending ? 'Sending…' : 'Send SMS'}
            </button>
            {sms.ok && <p className="mt-1 text-xs text-text-sec">{sms.ok}</p>}
            {sms.err && <p className="mt-1 text-xs text-accent">{sms.err}</p>}
          </div>

          {/* ─── Email row ─── */}
          <div>
            <div className="mb-1 text-[0.6rem] uppercase tracking-[0.08em] text-text-dim">
              Email (PDF attached)
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="mb-2 w-full border border-ink-line bg-transparent px-3 py-2 text-sm text-text-pri placeholder:text-text-dim"
            />
            <button
              type="button"
              onClick={() => send('email')}
              disabled={!mailReady}
              className="rounded-ctl inline-flex min-h-[36px] items-center border border-ink-line px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mail.pending ? 'Sending…' : 'Send Email'}
            </button>
            {mail.ok && <p className="mt-1 text-xs text-text-sec">{mail.ok}</p>}
            {mail.err && <p className="mt-1 text-xs text-accent">{mail.err}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
