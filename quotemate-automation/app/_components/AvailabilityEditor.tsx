'use client'

// Shared weekly-availability editor — used by the onboarding wizard and the
// dashboard Account tab so both edit the SAME tenants.default_availability
// shape (migration 147). Controlled component: the parent owns the value and
// persists it (onboarding → activate payload; dashboard → PATCH /api/tenant/me).

import { DAY_KEYS, toMinutes, type WeeklyAvailability, type DayKey } from '@/lib/quote/availability'

const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

/** True when an enabled day has a start strictly before its end. */
function dayValid(enabled: boolean, start: string | null, end: string | null): boolean {
  if (!enabled) return true
  const s = toMinutes(start)
  const e = toMinutes(end)
  return s !== null && e !== null && s < e
}

export function AvailabilityEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: WeeklyAvailability
  onChange: (next: WeeklyAvailability) => void
  disabled?: boolean
}) {
  function setDay(day: DayKey, patch: Partial<WeeklyAvailability['days'][DayKey]>) {
    onChange({
      ...value,
      days: { ...value.days, [day]: { ...value.days[day], ...patch } },
    })
  }

  return (
    <div className="space-y-1.5">
      {DAY_KEYS.map((day) => {
        const d = value.days[day]
        const invalid = !dayValid(d.enabled, d.start, d.end)
        return (
          <div
            key={day}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border border-ink-line bg-ink-card px-3 py-2.5"
          >
            <label className="flex w-32 cursor-pointer items-center gap-2 text-sm font-semibold text-text-pri">
              <input
                type="checkbox"
                checked={d.enabled}
                disabled={disabled}
                onChange={(e) =>
                  setDay(day, {
                    enabled: e.target.checked,
                    start: e.target.checked ? d.start ?? '07:00' : null,
                    end: e.target.checked ? d.end ?? '15:00' : null,
                  })
                }
                className="h-4 w-4 accent-accent"
              />
              {DAY_LABELS[day]}
            </label>

            {d.enabled ? (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={d.start ?? '07:00'}
                  disabled={disabled}
                  onChange={(e) => setDay(day, { start: e.target.value })}
                  aria-label={`${DAY_LABELS[day]} start time`}
                  className="border border-ink-line bg-ink-deep px-2 py-1 font-mono text-sm text-text-pri outline-none focus-visible:border-accent"
                />
                <span className="font-mono text-xs uppercase tracking-wider text-text-dim">to</span>
                <input
                  type="time"
                  value={d.end ?? '15:00'}
                  disabled={disabled}
                  onChange={(e) => setDay(day, { end: e.target.value })}
                  aria-label={`${DAY_LABELS[day]} end time`}
                  className="border border-ink-line bg-ink-deep px-2 py-1 font-mono text-sm text-text-pri outline-none focus-visible:border-accent"
                />
                {invalid ? (
                  <span className="font-mono text-[0.65rem] uppercase tracking-wider text-red-400">
                    start must be before end
                  </span>
                ) : null}
              </div>
            ) : (
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-dim">
                Closed
              </span>
            )}
          </div>
        )
      })}
      <p className="pt-1 text-xs leading-relaxed text-text-sec">
        Customers pick a <strong>morning</strong> or <strong>afternoon</strong> slot on the days
        you work — hours that span midday offer both.
      </p>
    </div>
  )
}
