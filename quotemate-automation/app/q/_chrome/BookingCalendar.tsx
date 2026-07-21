'use client'

// The booking picker for EVERY funnel's /book page — quotes (electrical,
// plumbing, solar), roofing and painting. A Google-Calendar-style month grid:
// available days highlighted, tap a day → its times appear below, tap a time
// → a sticky "Book" bar pops up (mirrors the Pay CTA). Far less scrolling than
// a fortnight of stacked day cards, and familiar to anyone who has used an
// appointment booker.
//
// This is the ONLY slot picker. It replaced the day-strip SlotPicker on
// 2026-07-22: two components serving one job had drifted apart (only one
// honoured the API's `next` field), so the same booking action landed
// customers on different pages. See ./booking-next.ts.
//
// The date model is computed server-side in the tenant's timezone (via
// toCalendarDays below) and passed in, so this component does no timezone
// maths.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveBookingNext } from './booking-next'

export type CalendarTime = { iso: string; chip: string }
export type CalendarDay = {
  /** YYYY-MM-DD in the tenant timezone. */
  key: string
  year: number
  /** 0-indexed month. */
  monthIndex: number
  /** Day of month, 1-31. */
  date: number
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
  /** Server-formatted label, e.g. "Mon, 27 July". */
  label: string
  times: CalendarTime[]
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}
function firstWeekday(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex, 1, 12)).getUTCDay()
}

type Status = 'idle' | 'submitting' | 'done' | 'error'

export function BookingCalendar({
  days,
  endpoint,
  tzLabel,
  labels,
}: {
  days: CalendarDay[]
  /** Where to POST { slot } — /api/q/book/roof/<token>. */
  endpoint: string
  /** Short timezone note shown as context, e.g. "AEST". */
  tzLabel?: string | null
  labels?: { idle?: string; submitting?: string; done?: string }
}) {
  const idleLabel = labels?.idle ?? 'Book this time →'
  const submittingLabel = labels?.submitting ?? 'Booking…'
  const doneLabel = labels?.done ?? 'Booked ✓'

  // Ordered unique months that actually have availability — the customer only
  // ever pages through months with open slots.
  const months = useMemo(() => {
    const seen = new Set<string>()
    const out: { year: number; monthIndex: number }[] = []
    for (const d of days) {
      const k = `${d.year}-${d.monthIndex}`
      if (!seen.has(k)) {
        seen.add(k)
        out.push({ year: d.year, monthIndex: d.monthIndex })
      }
    }
    return out
  }, [days])

  const byKey = useMemo(() => {
    const m = new Map<string, CalendarDay>()
    for (const d of days) m.set(d.key, d)
    return m
  }, [days])

  const [viewIdx, setViewIdx] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(days[0]?.key ?? null)
  const [picked, setPicked] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // The sticky bar is portaled out so its fixed positioning clears the quote
  // chrome instead of getting trapped under an animated ancestor.
  const rootRef = useRef<HTMLDivElement>(null)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setPortalHost((rootRef.current?.closest('.qm-quote') as HTMLElement | null) ?? document.body)
  }, [])

  const view = months[viewIdx] ?? months[0] ?? null
  const selectedDay = selectedKey ? (byKey.get(selectedKey) ?? null) : null
  const pickedTime = picked
    ? days.flatMap((d) => d.times).find((t) => t.iso === picked) ?? null
    : null
  const pickedDay = picked ? days.find((d) => d.times.some((t) => t.iso === picked)) ?? null : null

  const locked = status === 'submitting' || status === 'done'
  const bookLabel = status === 'submitting' ? submittingLabel : status === 'done' ? doneLabel : idleLabel

  async function onConfirm() {
    if (!picked) return
    setStatus('submitting')
    setErrorMessage(null)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: picked }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? `Couldn't book that time (HTTP ${res.status}).`)
      }
      setStatus('done')
      // The endpoint says where to go next — the thank-you page, now that the
      // booking is complete. Falls back to reloading this page without its
      // query string, which re-renders whatever state the server decides.
      const dest = resolveBookingNext(json, window.location.pathname)
      setTimeout(() => {
        window.location.href = dest
      }, 500)
    } catch (err: unknown) {
      setStatus('error')
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : 'Booking failed. Try another time or reply to your SMS.',
      )
    }
  }

  if (days.length === 0 || !view) {
    return (
      <p className="border border-ink-line bg-ink-card p-5 font-mono text-[0.8rem] uppercase tracking-[0.12em] text-text-dim">
        No upcoming times are open. Your tradie will SMS you to arrange a visit.
      </p>
    )
  }

  const leading = firstWeekday(view.year, view.monthIndex)
  const total = daysInMonth(view.year, view.monthIndex)
  const cells: (CalendarDay | number | null)[] = []
  for (let i = 0; i < leading; i++) cells.push(null)
  for (let d = 1; d <= total; d++) {
    const key = `${view.year}-${String(view.monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push(byKey.get(key) ?? d)
  }

  return (
    <div ref={rootRef}>
      {/* Month header + prev/next */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-base font-extrabold tracking-tight text-text-pri">
          {MONTHS[view.monthIndex]} {view.year}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setViewIdx((i) => Math.max(0, i - 1))}
            disabled={viewIdx === 0 || locked}
            aria-label="Previous month"
            className="grid h-9 w-9 place-items-center border border-ink-line bg-ink-card text-text-sec transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setViewIdx((i) => Math.min(months.length - 1, i + 1))}
            disabled={viewIdx >= months.length - 1 || locked}
            aria-label="Next month"
            className="grid h-9 w-9 place-items-center border border-ink-line bg-ink-card text-text-sec transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            ›
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="mt-4 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className="text-center font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-text-dim"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div
        className="mt-1.5 grid gap-1.5"
        style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}
        role="grid"
        aria-label="Choose a date"
      >
        {cells.map((cell, i) => {
          if (cell === null) return <div key={`b-${i}`} aria-hidden="true" />
          if (typeof cell === 'number') {
            // A date with no open slots.
            return (
              <div
                key={`d-${i}`}
                className="grid aspect-square place-items-center text-sm text-text-dim/40"
                aria-disabled="true"
              >
                {cell}
              </div>
            )
          }
          const isSelected = cell.key === selectedKey
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => {
                setSelectedKey(cell.key)
                setPicked(null)
              }}
              disabled={locked}
              aria-pressed={isSelected}
              aria-label={cell.label}
              className={`grid aspect-square place-items-center rounded-[var(--qm-r-sm)] border text-sm font-bold tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                isSelected
                  ? 'border-accent bg-accent text-ink-deep'
                  : 'border-accent/40 bg-ink-card text-text-pri hover:border-accent'
              } ${locked ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              {cell.date}
            </button>
          )
        })}
      </div>

      {/* Times for the selected day */}
      {selectedDay ? (
        <div className="mt-6">
          <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
            {selectedDay.label}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="group" aria-label={`Times on ${selectedDay.label}`}>
            {selectedDay.times.map(({ iso, chip }) => {
              const isPicked = picked === iso
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setPicked(iso)}
                  disabled={locked}
                  aria-pressed={isPicked}
                  className={`border px-4 py-3.5 text-base font-bold tracking-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isPicked
                      ? 'border-accent bg-accent text-ink-deep'
                      : 'border-ink-line bg-ink-card text-text-pri hover:border-accent/60'
                  } ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {chip}
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="mt-6 text-sm text-text-dim">Pick a highlighted date to see its times.</p>
      )}

      {tzLabel ? (
        <p className="mt-4 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-text-dim">
          Times shown in {tzLabel}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="mt-4 font-mono text-[0.75rem] uppercase tracking-widest text-red-400">
          {errorMessage}
        </p>
      ) : null}

      {/* Sticky confirm bar — pops up once a time is picked (like Pay $99). */}
      {portalHost && picked && pickedTime
        ? createPortal(
            <div
              className="qm-print-hide motion-safe:animate-[fade-up_180ms_ease-out_both]"
              style={{
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 30,
                borderTop: '1px solid var(--ink-line)',
                background: 'var(--ink-card)',
                padding: '12px 20px',
                boxShadow: '0 -8px 24px -12px rgba(0,0,0,0.4)',
              }}
            >
              <div
                style={{
                  maxWidth: 'var(--qm-sheet-w, 560px)',
                  margin: '0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9.5,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.12em',
                      color: 'var(--text-dim)',
                    }}
                  >
                    Your visit time
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontWeight: 800,
                      fontSize: 15,
                      color: 'var(--text-pri)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {pickedDay?.label ?? ''} · {pickedTime.chip}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={locked}
                  aria-busy={status === 'submitting'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 9,
                    border: '1px solid transparent',
                    background: 'var(--accent)',
                    color: 'var(--accent-ink)',
                    padding: '13px 22px',
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 700,
                    fontSize: 13,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                    cursor: locked ? 'default' : 'pointer',
                    opacity: locked ? 0.75 : 1,
                  }}
                >
                  {bookLabel}
                </button>
              </div>
            </div>,
            portalHost,
          )
        : null}
    </div>
  )
}
