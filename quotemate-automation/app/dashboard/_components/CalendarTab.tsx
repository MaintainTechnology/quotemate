'use client'

// Dashboard → Calendar tab (specs/dashboard-calendar-tab.md).
//
// Reads the tenant's bookings from GET /api/tenant/calendar, which returns two
// lists: `events` (quotes with a scheduled_at) render as a day-grouped agenda,
// upcoming first, with a "Past" group at the end; `toSchedule` (PAID quotes
// with no time chosen yet — chiefly the pay-first $99 site inspection) render
// in a "Paid · needs a time" block above the agenda so a money-in-hand job the
// tradie still has to arrange is never hidden. Booking state is shown with a
// tone-coded StatusPill; a 'requested' self-serve booking can be confirmed
// inline (POST /api/tenant/calendar/<quoteId>/confirm). Tenant-scoped via the
// bearer token, same contract as the other dashboard tabs.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Loader2, Check, ExternalLink } from 'lucide-react'
import { StatusPill, StatGrid, type Tone } from './quote-ui'
import { getAuthToken } from '@/lib/auth/client-token'

type CalendarEvent = {
  quoteId: string
  shareToken: string | null
  scheduledAt: string | null
  bookingState: string | null
  status: string | null
  paid: boolean
  paidTier: string | null
  paidAt: string | null
  needsInspection: boolean
  customerName: string | null
  customerPhone: string | null
  jobType: string | null
  address: string | null
  suburb: string | null
  source: string | null
}

// A scheduled event is a CalendarEvent that definitely has a time — used for
// the day-grouped agenda so the grouping helpers never see a null scheduledAt.
type ScheduledEvent = CalendarEvent & { scheduledAt: string }

const TZ = 'Australia/Sydney'

function dayKey(iso: string): string {
  const d = new Date(iso)
  // YYYY-MM-DD in Sydney time — stable sort + group key.
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}
function dayLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: TZ,
  })
}
function timeLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TZ,
  })
}
function shortDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: TZ })
}

function jobLabel(jt: string | null): string {
  if (!jt) return 'Job'
  return jt.charAt(0).toUpperCase() + jt.slice(1).replace(/_/g, ' ')
}

function statePill(ev: CalendarEvent): { label: string; tone: Tone } {
  if (ev.bookingState === 'booked' || ev.paid) return { label: 'Booked', tone: 'good' }
  if (ev.bookingState === 'confirmed') return { label: 'Confirmed', tone: 'accent' }
  if (ev.bookingState === 'reserved') return { label: 'Pending payment', tone: 'warn' }
  if (ev.bookingState === 'requested') return { label: 'Requested', tone: 'warn' }
  return { label: 'Scheduled', tone: 'dim' }
}

type DayGroup = { key: string; label: string; events: ScheduledEvent[] }

export function CalendarTab({ accessToken }: { accessToken: string | null }) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [toSchedule, setToSchedule] = useState<CalendarEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState<string | null>(null)

  // Mint a FRESH token per request — a Clerk session token expires ~60s after
  // the dashboard captured `accessToken` at mount, so reusing the prop 401s.
  // getAuthToken() refreshes (Clerk) or reuses the legacy Supabase session;
  // fall back to the prop only if it yields nothing. Callers await it.
  const authHeaders = useCallback(
    async (): Promise<Record<string, string>> => {
      const token = (await getAuthToken()) ?? accessToken
      return token ? { Authorization: `Bearer ${token}` } : {}
    },
    [accessToken],
  )

  const load = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tenant/calendar', { headers: await authHeaders(), cache: 'no-store' })
      if (!res.ok) {
        setError('Couldn’t load your calendar. Please try again.')
        return
      }
      const json = (await res.json()) as {
        events: CalendarEvent[]
        toSchedule?: CalendarEvent[]
      }
      setEvents(json.events ?? [])
      setToSchedule(json.toSchedule ?? [])
    } catch {
      setError('Couldn’t reach the server. Please try again shortly.')
    } finally {
      setLoading(false)
    }
  }, [accessToken, authHeaders])

  useEffect(() => {
    void load()
  }, [load])

  async function confirmBooking(quoteId: string) {
    if (!accessToken) return
    setConfirming(quoteId)
    try {
      const res = await fetch(`/api/tenant/calendar/${quoteId}/confirm`, {
        method: 'POST',
        headers: await authHeaders(),
      })
      if (res.ok) {
        setEvents((prev) =>
          (prev ?? []).map((e) =>
            e.quoteId === quoteId ? { ...e, bookingState: 'confirmed' } : e,
          ),
        )
      }
    } finally {
      setConfirming(null)
    }
  }

  // Split into upcoming vs past, then group each by Sydney day. Only events
  // that actually carry a time land here; the paid-but-unscheduled set is
  // rendered separately (it has no day to group on).
  const { upcoming, past, pendingCount, upcomingCount } = useMemo(() => {
    const now = Date.now()
    const all: ScheduledEvent[] = (events ?? []).filter(
      (e): e is ScheduledEvent => typeof e.scheduledAt === 'string',
    )
    const up: ScheduledEvent[] = []
    const pa: ScheduledEvent[] = []
    for (const e of all) {
      if (Date.parse(e.scheduledAt) >= now) up.push(e)
      else pa.push(e)
    }
    const groupBy = (list: ScheduledEvent[], pastFirst = false): DayGroup[] => {
      const map = new Map<string, DayGroup>()
      for (const e of list) {
        const k = dayKey(e.scheduledAt)
        const g = map.get(k) ?? { key: k, label: dayLabel(e.scheduledAt), events: [] }
        g.events.push(e)
        map.set(k, g)
      }
      const groups = Array.from(map.values())
      groups.sort((a, b) => (pastFirst ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)))
      return groups
    }
    return {
      upcoming: groupBy(up),
      past: groupBy(pa, true),
      pendingCount: all.filter((e) => e.bookingState === 'requested').length,
      upcomingCount: up.length,
    }
  }, [events])

  if (loading && !events) {
    return (
      <div className="rounded-card border border-ink-line bg-ink-card px-5 py-6 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
        <Loader2 size={14} className="mr-2 inline animate-spin text-accent" />
        Loading calendar…
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-text-pri">
        {error}
      </div>
    )
  }

  const isEmpty = (events?.length ?? 0) === 0 && toSchedule.length === 0

  return (
    <div className="max-w-4xl space-y-8">
      <StatGrid
        cols={3}
        stats={[
          { label: 'Upcoming jobs', value: upcomingCount, hero: true },
          { label: 'To schedule', value: toSchedule.length, tone: toSchedule.length > 0 ? 'warn' : 'dim' },
          { label: 'Pending requests', value: pendingCount, tone: pendingCount > 0 ? 'warn' : 'dim' },
        ]}
      />

      {toSchedule.length > 0 && <ToScheduleBlock events={toSchedule} />}

      {isEmpty ? (
        <div className="rounded-card border border-ink-line bg-ink-card p-8 text-center">
          <CalendarDays size={22} className="mx-auto text-text-dim" />
          <p className="mt-3 text-sm text-text-sec">No bookings scheduled yet.</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-6">
              {upcoming.map((g) => (
                <DayBlock
                  key={g.key}
                  group={g}
                  confirming={confirming}
                  onConfirm={confirmBooking}
                />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section className="space-y-6">
              <h3 className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                Past
              </h3>
              {past.map((g) => (
                <DayBlock
                  key={g.key}
                  group={g}
                  confirming={confirming}
                  onConfirm={confirmBooking}
                  muted
                />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function DayBlock({
  group,
  confirming,
  onConfirm,
  muted = false,
}: {
  group: DayGroup
  confirming: string | null
  onConfirm: (quoteId: string) => void
  muted?: boolean
}) {
  return (
    <div className={muted ? 'opacity-70' : ''}>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-accent">
          {group.label}
        </span>
        <span className="h-px flex-1 bg-ink-line" aria-hidden="true" />
      </div>
      <ul className="rounded-card mt-3 divide-y divide-ink-line border border-ink-line bg-ink-card">
        {group.events.map((ev) => {
          const pill = statePill(ev)
          const canConfirm = ev.bookingState === 'requested'
          return (
            <li key={ev.quoteId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="w-16 shrink-0 font-mono text-sm font-semibold tabular-nums text-text-pri">
                {timeLabel(ev.scheduledAt)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text-pri">
                  {ev.customerName ?? 'Customer'}
                  {ev.jobType ? <span className="text-text-sec"> · {jobLabel(ev.jobType)}</span> : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">
                  {ev.suburb ? <span>{ev.suburb}</span> : null}
                  {ev.customerPhone ? <span>· {ev.customerPhone}</span> : null}
                  {ev.source === 'web_booking' ? <span className="text-accent">· self-serve</span> : null}
                </div>
              </div>
              <StatusPill label={pill.label} tone={pill.tone} compact dot />
              {canConfirm && (
                <button
                  type="button"
                  onClick={() => onConfirm(ev.quoteId)}
                  disabled={confirming === ev.quoteId}
                  className="rounded-ctl inline-flex items-center gap-1.5 border border-ink-line px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-text-pri hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {confirming === ev.quoteId ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Check size={11} />
                  )}
                  Confirm
                </button>
              )}
              {ev.shareToken && (
                <a
                  href={`/q/${ev.shareToken}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open quote"
                  className="inline-flex h-7 w-7 items-center justify-center border border-ink-line text-text-dim hover:border-accent hover:text-accent"
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Paid, but no time chosen yet — the $99 site inspection (pay-first, no slot)
// or a deposit paid against an old link. Money-in-hand jobs the tradie still
// has to arrange, so they get a prominent block above the dated agenda with
// the customer's number to call. No day/time row — they have none.
function ToScheduleBlock({ events }: { events: CalendarEvent[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-warning-bright">
          Paid · needs a time
        </span>
        <span className="h-px flex-1 bg-ink-line" aria-hidden="true" />
      </div>
      <ul className="rounded-card divide-y divide-ink-line border border-ink-line bg-ink-card">
        {events.map((ev) => {
          const isInspection = ev.needsInspection || ev.paidTier === 'inspection'
          return (
            <li
              key={ev.quoteId}
              className="flex flex-wrap items-center gap-3 border-l-2 border-l-warning-bright px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text-pri">
                  {ev.customerName ?? 'Customer'}
                  {ev.jobType ? <span className="text-text-sec"> · {jobLabel(ev.jobType)}</span> : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">
                  {ev.suburb ? <span>{ev.suburb}</span> : null}
                  {ev.customerPhone ? <span>· {ev.customerPhone}</span> : null}
                  {ev.paidAt ? <span>· paid {shortDate(ev.paidAt)}</span> : null}
                </div>
              </div>
              <StatusPill
                label={isInspection ? 'Inspection · paid' : 'Deposit paid'}
                tone="warn"
                compact
                dot
              />
              {ev.shareToken && (
                <a
                  href={`/q/${ev.shareToken}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open quote"
                  className="inline-flex h-7 w-7 items-center justify-center border border-ink-line text-text-dim hover:border-accent hover:text-accent"
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </li>
          )
        })}
      </ul>
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-text-dim">
        Call the customer to lock in a visit time.
      </p>
    </section>
  )
}
