'use client'

// Dashboard → Calendar tab (specs/dashboard-calendar-tab.md).
//
// Presentation is a 1:1 port of the standalone reference design
// (redesign/QuoteMax Dashboard (standalone).html → the `calendar` page): a
// header with eyebrow / title / blurb + Sync + New booking, a 4-up metric
// strip, a Mon–Sun week strip, and a day-grouped agenda whose rows carry a
// left status bar (visit → accent, job → success, callback → grey). The
// reference is square-cornered with lit edges and mono numerals; its inline
// styles reference the same CSS-variable tokens this app already defines
// (--ink-card / --accent / --text-* / --success-bright / --lift …), so the
// port is faithful in both the dark and warm-paper (light) themes.
//
// All data is REAL and tenant-scoped: GET /api/tenant/calendar returns
// `events` (quotes with a scheduled_at) and `toSchedule` (PAID quotes with no
// time chosen yet — chiefly the pay-first $99 site inspection). Sync reloads;
// New booking opens this tenant's public /book/<tenantId> page; a self-serve
// request confirms inline; clicking a row opens its quote.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
type ScheduledEvent = CalendarEvent & { scheduledAt: string }

const TZ = 'Australia/Sydney'

/* ── Date helpers ─────────────────────────────────────────────────────
   Bookings group by Sydney calendar day. dayKey() keys an instant to a Sydney
   YYYY-MM-DD; the week strip + agenda labels work off those bare date keys via
   a local Date (labels/arithmetic only, never an instant), so both sides
   compare as identical strings. */
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}
function todayKeySydney(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: TZ,
  })
}
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: TZ })
}
function localDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function keyFromLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addDays(key: string, n: number): string {
  const d = localDate(key)
  d.setDate(d.getDate() + n)
  return keyFromLocal(d)
}
// The Mon–Sun week containing `key` (setDate carries across month/year ends).
function weekOf(key: string): string[] {
  const d = localDate(key)
  const dow = d.getDay() // 0=Sun … 6=Sat
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)) // back to Monday
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(d)
    dd.setDate(d.getDate() + i)
    return keyFromLocal(dd)
  })
}
function weekdayAbbrev(key: string): string {
  return localDate(key).toLocaleDateString('en-AU', { weekday: 'short' })
}
function monthAbbrev(key: string): string {
  return localDate(key).toLocaleDateString('en-AU', { month: 'short' })
}
function dayNum(key: string): number {
  return localDate(key).getDate()
}
// "Today · Tue 1 Jul" / "Tomorrow · Wed 2 Jul" / "Fri 4 Jul" (CSS uppercases).
function agendaLabel(key: string, today: string): string {
  const base = `${weekdayAbbrev(key)} ${dayNum(key)} ${monthAbbrev(key)}`
  if (key === today) return `Today · ${base}`
  if (key === addDays(today, 1)) return `Tomorrow · ${base}`
  return base
}

function jobLabel(jt: string | null): string {
  if (!jt) return 'Job'
  return jt.charAt(0).toUpperCase() + jt.slice(1).replace(/_/g, ' ')
}

// Row triage → the reference's three bar kinds. A paid $99 inspection is a
// "visit" (accent bar); an unconfirmed self-serve request / reserved hold is a
// "call" (grey bar); everything else scheduled is a "job" (success bar).
type Kind = 'visit' | 'job' | 'call'
function kindOf(ev: CalendarEvent): Kind {
  if (ev.needsInspection || ev.paidTier === 'inspection') return 'visit'
  if (ev.bookingState === 'requested' || ev.bookingState === 'reserved') return 'call'
  return 'job'
}
function barColor(kind: Kind): string {
  return kind === 'visit' ? 'var(--accent)' : kind === 'job' ? 'var(--success-bright)' : 'var(--text-sec)'
}
function eventTitle(ev: CalendarEvent): string {
  const job = jobLabel(ev.jobType)
  if (ev.needsInspection || ev.paidTier === 'inspection') return `Site visit — ${job}`
  return job
}
function who(ev: CalendarEvent): string {
  const name = ev.customerName ?? 'Customer'
  return ev.suburb ? `${name} · ${ev.suburb}` : name
}

type DayGroup = { key: string; label: string; events: ScheduledEvent[] }

/* ── Fonts — the SAME families the reference declares (Manrope + JetBrains
   Mono), referenced through the app's next/font CSS variables so the exact
   loaded faces render (literal 'Manrope'/'JetBrains Mono' names aren't
   registered under those names by next/font). Fallback stacks mirror the
   reference's --font-sans / --font-mono. Applied inline so the fonts match
   the HTML with zero reliance on utility-class resolution. */
const SANS = "var(--font-manrope), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
const MONO = "var(--font-jetbrains-mono), ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"

/* ── Reference styles (verbatim from the standalone template) ─────────── */
const EYEBROW: CSSProperties = {
  fontFamily: MONO,
  fontSize: '10.5px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  color: 'var(--text-dim)',
}
const H1: CSSProperties = {
  fontFamily: SANS,
  margin: '8px 0 0',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '-0.03em',
  fontSize: 'clamp(1.8rem,2.6vw,2.7rem)',
  lineHeight: 1,
  color: 'var(--text-pri)',
}
const BLURB: CSSProperties = {
  fontFamily: SANS,
  margin: '9px 0 0',
  maxWidth: '64ch',
  fontSize: '13.5px',
  lineHeight: 1.5,
  color: 'var(--text-dim)',
}
const GHOST_BTN: CSSProperties = {
  fontFamily: MONO,
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid var(--ink-line)',
  background: 'transparent',
  color: 'var(--text-sec)',
  padding: '9px 14px',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.13em',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
}
const PRIMARY_BTN: CSSProperties = {
  fontFamily: SANS,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  border: '1px solid transparent',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  padding: '10px 16px',
  fontWeight: 700,
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  cursor: 'pointer',
}
// .qm-edge-lit — the reference rounds these cards to 14px and clips overflow
// so the inner rows / gap seams follow the rounded corner.
const CARD: CSSProperties = {
  background: 'var(--ink-card)',
  border: '1px solid var(--ink-line)',
  boxShadow: 'var(--lift)',
  borderRadius: '14px',
  overflow: 'hidden',
}
const DAY_LABEL: CSSProperties = {
  fontFamily: MONO,
  margin: '0 0 9px 2px',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
  color: 'var(--text-dim)',
}

export function CalendarTab({
  accessToken,
  onGoToQuotes,
}: {
  accessToken: string | null
  onGoToQuotes?: () => void
}) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [toSchedule, setToSchedule] = useState<CalendarEvent[]>([])
  const [awaitingBooking, setAwaitingBooking] = useState<CalendarEvent[]>([])
  const [reviewCount, setReviewCount] = useState(0)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState<string | null>(null)

  const today = useMemo(() => todayKeySydney(), [])
  const [selectedKey, setSelectedKey] = useState<string>(today)
  const dayRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Mint a FRESH token per request — a Clerk session token expires ~60s after
  // the dashboard captured `accessToken` at mount, so reusing the prop 401s.
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
        awaitingBooking?: CalendarEvent[]
        reviewCount?: number
        tenantId?: string | null
      }
      setEvents(json.events ?? [])
      setToSchedule(json.toSchedule ?? [])
      setAwaitingBooking(json.awaitingBooking ?? [])
      setReviewCount(json.reviewCount ?? 0)
      setTenantId(json.tenantId ?? null)
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
          (prev ?? []).map((e) => (e.quoteId === quoteId ? { ...e, bookingState: 'confirmed' } : e)),
        )
      }
    } finally {
      setConfirming(null)
    }
  }

  function selectDay(key: string) {
    setSelectedKey(key)
    dayRefs.current[key]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const week = useMemo(() => weekOf(selectedKey), [selectedKey])

  const { upcoming, past, eventDays, stats } = useMemo(() => {
    const now = Date.now()
    const scheduled: ScheduledEvent[] = (events ?? []).filter(
      (e): e is ScheduledEvent => typeof e.scheduledAt === 'string',
    )
    const up: ScheduledEvent[] = []
    const pa: ScheduledEvent[] = []
    const days = new Set<string>()
    for (const e of scheduled) {
      days.add(dayKey(e.scheduledAt))
      ;(Date.parse(e.scheduledAt) >= now ? up : pa).push(e)
    }

    const weekSet = new Set(weekOf(selectedKey))
    let inWeek = 0
    let schedInspections = 0
    let jobsOn = 0
    let pendingScheduled = 0
    for (const e of scheduled) {
      if (weekSet.has(dayKey(e.scheduledAt))) inWeek++
      const k = kindOf(e)
      if (k === 'visit') schedInspections++
      else if (k === 'call') pendingScheduled++
      else jobsOn++
    }
    const inspInToSchedule = toSchedule.filter(
      (e) => e.needsInspection || e.paidTier === 'inspection',
    ).length

    const groupBy = (list: ScheduledEvent[], pastFirst = false): DayGroup[] => {
      const map = new Map<string, DayGroup>()
      for (const e of list) {
        const k = dayKey(e.scheduledAt)
        const g = map.get(k) ?? { key: k, label: agendaLabel(k, today), events: [] }
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
      eventDays: days,
      stats: {
        // Bookings scheduled within the selected week.
        thisWeek: inWeek,
        // Every $99 site-visit in play: awaiting-customer leads + any that are
        // paid-unscheduled + any already on a day.
        siteVisits: awaitingBooking.length + inspInToSchedule + schedInspections,
        // Confirmed / reserved dated jobs (non-inspection).
        jobsOn,
        // Needs the tradie to act: paid-but-unscheduled work + pending dated holds.
        callbacks: toSchedule.length + pendingScheduled,
      },
    }
  }, [events, toSchedule, awaitingBooking, selectedKey, today])

  const metrics: [string, number, string, boolean][] = [
    ['This week', stats.thisWeek, 'Bookings', false],
    ['Site visits', stats.siteVisits, '$99 each', true],
    ['Jobs on', stats.jobsOn, 'Booked', false],
    ['Callbacks', stats.callbacks, 'Follow-up', false],
  ]

  const isEmpty =
    (events?.length ?? 0) === 0 && toSchedule.length === 0 && awaitingBooking.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Row hover + interactive-day affordance — the reference's :hover rules,
          scoped so nothing else on the page is touched. */}
      <style>{`
        .qmcal-row.is-click{cursor:pointer}
        .qmcal-row:hover{background:color-mix(in srgb, var(--ink) 55%, transparent)}
        .qmcal-day{transition:border-color .15s ease}
        .qmcal-day:not(.is-selected):hover{border-color:color-mix(in srgb, var(--accent) 40%, var(--ink-line)) !important}
      `}</style>

      {/* ── Header ── */}
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={EYEBROW}>Daily · Calendar</div>
          <h1 style={H1}>Calendar</h1>
          <p style={BLURB}>Site visits, booked jobs and callbacks. Your week at a glance.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh bookings"
            style={{ ...GHOST_BTN, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? 'Syncing…' : 'Sync'}
          </button>
          <a
            href={tenantId ? `/book/${tenantId}` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!tenantId}
            style={{ ...PRIMARY_BTN, ...(tenantId ? null : { opacity: 0.4, pointerEvents: 'none' }) }}
          >
            New booking
          </a>
        </div>
      </header>

      {error && (
        <div
          style={{
            borderLeft: '2px solid var(--danger-bright)',
            background: 'color-mix(in srgb, var(--danger-bright) 12%, transparent)',
            padding: '12px 16px',
            fontSize: '13px',
            color: 'var(--text-pri)',
          }}
        >
          {error}
        </div>
      )}

      {loading && !events ? (
        <div
          style={{
            ...CARD,
            fontFamily: MONO,
            padding: '20px 22px',
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            color: 'var(--text-dim)',
          }}
        >
          Loading calendar…
        </div>
      ) : (
        <>
          {/* ── Metric strip (qm-edge-lit qm-metrics4 → 14px rounded, clipped) ── */}
          <section
            className="grid grid-cols-2 sm:grid-cols-4"
            style={{
              background: 'var(--ink-line)',
              border: '1px solid var(--ink-line)',
              gap: '1px',
              boxShadow: 'var(--lift)',
              borderRadius: '14px',
              overflow: 'hidden',
            }}
          >
            {metrics.map(([k, v, sub, accent]) => (
              <div key={k} style={{ background: 'var(--ink-card)', padding: '18px 22px' }}>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: '9.5px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.13em',
                    color: 'var(--text-dim)',
                  }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    marginTop: '8px',
                    fontWeight: 800,
                    lineHeight: 1,
                    fontSize: 'clamp(1.4rem,1.85vw,2.35rem)',
                    fontVariantNumeric: 'tabular-nums',
                    color: accent ? 'var(--accent)' : 'var(--text-pri)',
                  }}
                >
                  {v}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    marginTop: '7px',
                    fontSize: '8.5px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: 'var(--text-sec)',
                    minHeight: '12px',
                  }}
                >
                  {sub}
                </div>
              </div>
            ))}
          </section>

          {/* ── Calendar body ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Week strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '8px' }}>
              {week.map((k) => {
                const selected = k === selectedKey
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => selectDay(k)}
                    aria-pressed={selected}
                    aria-label={`${weekdayAbbrev(k)} ${dayNum(k)}${eventDays.has(k) ? ' — has bookings' : ''}`}
                    className={`qmcal-day${selected ? ' is-selected' : ''}`}
                    style={{
                      fontFamily: MONO,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '12px 4px',
                      width: '100%',
                      cursor: 'pointer',
                      background: selected ? 'var(--ink-card)' : 'transparent',
                      border:
                        '1px solid ' +
                        (selected ? 'color-mix(in srgb, var(--accent) 40%, var(--ink-line))' : 'var(--ink-line)'),
                    }}
                  >
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.12em',
                        color: selected ? 'var(--accent)' : 'var(--text-dim)',
                      }}
                    >
                      {weekdayAbbrev(k)}
                    </span>
                    <span
                      style={{ fontWeight: 700, fontSize: '18px', color: selected ? 'var(--text-pri)' : 'var(--text-sec)' }}
                    >
                      {dayNum(k)}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '9999px',
                        background: eventDays.has(k) ? 'var(--accent)' : 'transparent',
                      }}
                    />
                  </button>
                )
              })}
            </div>

            {/* Drafts still waiting on the tradie's review — a nudge to the
                Quotes tab, not calendar rows (they have no date). */}
            {reviewCount > 0 && onGoToQuotes && (
              <button
                type="button"
                onClick={onGoToQuotes}
                style={{
                  ...CARD,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  width: '100%',
                  textAlign: 'left',
                  padding: '13px 18px',
                  borderLeft: '2px solid var(--accent)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: '13.5px', color: 'var(--text-pri)' }}>
                  {reviewCount} {reviewCount === 1 ? 'quote' : 'quotes'} awaiting your review
                </span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                    color: 'var(--accent)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Review →
                </span>
              </button>
            )}

            {/* Paid · needs a time — money-in-hand, no slot yet */}
            {toSchedule.length > 0 && (
              <div>
                <div style={{ ...DAY_LABEL, color: 'var(--warning-bright)' }}>Paid · needs a time</div>
                <div style={CARD}>
                  {toSchedule.map((ev) => (
                    <AgendaRow
                      key={ev.quoteId}
                      time="—"
                      title={`${ev.needsInspection || ev.paidTier === 'inspection' ? 'Site visit — ' : ''}${jobLabel(ev.jobType)}`}
                      whoText={[ev.customerName ?? 'Customer', ev.suburb, ev.customerPhone, ev.paidAt ? `paid ${shortDate(ev.paidAt)}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                      bar="var(--warning-bright)"
                      shareToken={ev.shareToken}
                    />
                  ))}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    marginTop: '8px',
                    fontSize: '9px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: 'var(--text-dim)',
                  }}
                >
                  Call the customer to lock in a visit time.
                </div>
              </div>
            )}

            {/* Site visits the customer was quoted but hasn't booked yet —
                inspection-routed quotes with no slot + no payment. */}
            {awaitingBooking.length > 0 && (
              <div>
                <div style={{ ...DAY_LABEL, color: 'var(--accent)' }}>
                  Site visits · awaiting customer booking
                </div>
                <div style={CARD}>
                  {awaitingBooking.map((ev) => (
                    <AgendaRow
                      key={ev.quoteId}
                      time="$99"
                      title={`Site visit — ${jobLabel(ev.jobType)}`}
                      whoText={[ev.customerName ?? 'Customer', ev.suburb].filter(Boolean).join(' · ')}
                      bar="var(--accent)"
                      shareToken={ev.shareToken}
                    />
                  ))}
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    marginTop: '8px',
                    fontSize: '9px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: 'var(--text-dim)',
                  }}
                >
                  Quote sent — the customer books &amp; pays the $99 site visit.
                </div>
              </div>
            )}

            {isEmpty ? (
              <div style={{ ...CARD, padding: '32px', textAlign: 'center' }}>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: '10px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.14em',
                    color: 'var(--text-dim)',
                  }}
                >
                  No bookings scheduled yet
                </div>
              </div>
            ) : (
              <>
                {upcoming.map((g) => (
                  <div
                    key={g.key}
                    ref={(el) => {
                      dayRefs.current[g.key] = el
                    }}
                    style={{ scrollMarginTop: '16px' }}
                  >
                    <div style={{ ...DAY_LABEL, color: g.key === selectedKey ? 'var(--accent)' : 'var(--text-dim)' }}>
                      {g.label}
                    </div>
                    <div style={CARD}>
                      {g.events.map((ev) => (
                        <AgendaRow
                          key={ev.quoteId}
                          time={timeLabel(ev.scheduledAt)}
                          title={eventTitle(ev)}
                          whoText={who(ev)}
                          bar={barColor(kindOf(ev))}
                          shareToken={ev.shareToken}
                          confirm={
                            ev.bookingState === 'requested'
                              ? { pending: confirming === ev.quoteId, onConfirm: () => confirmBooking(ev.quoteId) }
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {past.length > 0 && (
                  <div style={{ opacity: 0.6 }}>
                    <div style={{ ...DAY_LABEL, color: 'var(--text-dim)' }}>Past</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {past.map((g) => (
                        <div key={g.key}>
                          <div style={DAY_LABEL}>{g.label}</div>
                          <div style={CARD}>
                            {g.events.map((ev) => (
                              <AgendaRow
                                key={ev.quoteId}
                                time={timeLabel(ev.scheduledAt)}
                                title={eventTitle(ev)}
                                whoText={who(ev)}
                                bar={barColor(kindOf(ev))}
                                shareToken={ev.shareToken}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Agenda row — the reference qm-row, plus real-data affordances:
   click-to-open the quote and an inline Confirm for self-serve requests. ─── */
function AgendaRow({
  time,
  title,
  whoText,
  bar,
  shareToken,
  confirm,
}: {
  time: string
  title: string
  whoText: string
  bar: string
  shareToken: string | null
  confirm?: { pending: boolean; onConfirm: () => void }
}) {
  const open = shareToken
    ? () => window.open(`/q/${shareToken}`, '_blank', 'noopener,noreferrer')
    : undefined
  return (
    <div
      className={`qmcal-row${open ? ' is-click' : ''}`}
      role={open ? 'link' : undefined}
      tabIndex={open ? 0 : undefined}
      onClick={open}
      onKeyDown={
        open
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                open()
              }
            }
          : undefined
      }
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '13px 18px',
        borderBottom: '1px solid var(--ink-line)',
        borderLeft: `2px solid ${bar}`,
        transition: 'background-color .15s ease',
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: '12px',
          fontWeight: 700,
          color: 'var(--text-sec)',
          minWidth: '74px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {time}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: '14px', color: 'var(--text-pri)' }}>
          {title}
        </div>
        <div
          style={{
            fontFamily: MONO,
            marginTop: '2px',
            fontSize: '9.5px',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--text-dim)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {whoText}
        </div>
      </div>
      {confirm && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            confirm.onConfirm()
          }}
          disabled={confirm.pending}
          style={{
            fontFamily: MONO,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            border: '1px solid var(--ink-line)',
            background: 'transparent',
            color: 'var(--text-sec)',
            padding: '5px 10px',
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            cursor: 'pointer',
            opacity: confirm.pending ? 0.5 : 1,
          }}
        >
          {confirm.pending ? 'Confirming…' : 'Confirm'}
        </button>
      )}
    </div>
  )
}
