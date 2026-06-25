'use client'

// Self-serve booking form (client). Posts to /api/book/<tenantId>. On
// success it swaps to a confirmation state showing the booked time. Slot
// options are passed from the server page (resolved with the same logic the
// API validates against). See specs/dashboard-calendar-tab.md.

import { useMemo, useState, type FormEvent } from 'react'

function slotLabel(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  const date = d.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Australia/Sydney',
  })
  const time = d.toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Australia/Sydney',
  })
  return `${date} · ${time}`
}

const INPUT_CLS =
  'w-full border border-ink-line bg-ink-card px-3 py-2.5 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'
const LABEL_CLS =
  'block font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-text-dim'

export function BookingForm({
  tenantId,
  businessName,
  slots,
}: {
  tenantId: string
  businessName: string
  slots: string[]
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [suburb, setSuburb] = useState('')
  const [address, setAddress] = useState('')
  const [description, setDescription] = useState('')
  const [slot, setSlot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [booked, setBooked] = useState<{ scheduledAt: string } | null>(null)

  const slotOptions = useMemo(
    () => slots.map((s) => ({ value: s, label: slotLabel(s) })),
    [slots],
  )

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !phone.trim() || !slot) {
      setError('Please enter your name, mobile, and pick a time.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/book/${tenantId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone, email, suburb, address, description, slot }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        error?: string
        message?: string
        scheduledAt?: string
      }
      if (!res.ok || !json.ok) {
        setError(json.message ?? 'Something went wrong — please try again.')
        return
      }
      setBooked({ scheduledAt: json.scheduledAt ?? slot })
    } catch {
      setError('Couldn’t reach the server — please try again shortly.')
    } finally {
      setSubmitting(false)
    }
  }

  if (booked) {
    return (
      <div className="border border-ink-line border-t-2 border-t-accent bg-ink-card p-7">
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-text-dim">
          Request sent
        </div>
        <h2 className="mt-2 text-xl font-extrabold uppercase tracking-tight text-text-pri">
          You’re on the calendar
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-text-sec">
          Thanks {name.trim().split(' ')[0]} — we’ve sent your booking request to{' '}
          {businessName} for{' '}
          <span className="font-semibold text-text-pri">{slotLabel(booked.scheduledAt)}</span>.
          They’ll confirm shortly and you’ll get a text.
        </p>
      </div>
    )
  }

  if (slotOptions.length === 0) {
    return (
      <div className="border border-ink-line bg-ink-card p-6 text-sm text-text-sec">
        There are no open times right now. Please check back soon or contact{' '}
        {businessName} directly.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="bk-name" className={LABEL_CLS}>Your name *</label>
        <input id="bk-name" className={`mt-1.5 ${INPUT_CLS}`} value={name}
          onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </div>

      <div>
        <label htmlFor="bk-phone" className={LABEL_CLS}>Mobile *</label>
        <input id="bk-phone" className={`mt-1.5 ${INPUT_CLS}`} value={phone}
          onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel"
          placeholder="04xx xxx xxx" required />
      </div>

      <div>
        <label htmlFor="bk-email" className={LABEL_CLS}>Email (optional)</label>
        <input id="bk-email" type="email" className={`mt-1.5 ${INPUT_CLS}`} value={email}
          onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="bk-suburb" className={LABEL_CLS}>Suburb (optional)</label>
          <input id="bk-suburb" className={`mt-1.5 ${INPUT_CLS}`} value={suburb}
            onChange={(e) => setSuburb(e.target.value)} />
        </div>
        <div>
          <label htmlFor="bk-address" className={LABEL_CLS}>Address (optional)</label>
          <input id="bk-address" className={`mt-1.5 ${INPUT_CLS}`} value={address}
            onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />
        </div>
      </div>

      <div>
        <label htmlFor="bk-desc" className={LABEL_CLS}>What do you need? (optional)</label>
        <textarea id="bk-desc" rows={3} className={`mt-1.5 ${INPUT_CLS}`} value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. 4 downlights in the kitchen" />
      </div>

      <div>
        <label htmlFor="bk-slot" className={LABEL_CLS}>Pick a time *</label>
        <select id="bk-slot" className={`mt-1.5 ${INPUT_CLS}`} value={slot}
          onChange={(e) => setSlot(e.target.value)} required>
          <option value="" disabled>Choose an appointment time…</option>
          {slotOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-text-pri">
          {error}
        </div>
      )}

      <button type="submit" disabled={submitting}
        className="inline-flex w-full items-center justify-center bg-accent px-5 py-3 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press disabled:opacity-50">
        {submitting ? 'Sending…' : 'Request this time'}
      </button>
    </form>
  )
}
