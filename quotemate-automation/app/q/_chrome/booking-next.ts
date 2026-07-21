// Where the customer goes after a successful booking POST.
//
// Extracted from the picker so the navigation decision is unit-testable. The
// two pickers used to disagree: SlotPicker honoured the API's `next` field
// while BookingCalendar discarded it and reloaded window.location.pathname —
// so the SAME endpoint landed customers on two different pages depending on
// which surface they started from. One helper, one answer.
//
// Only same-origin relative paths are accepted. The value is server-issued
// today, but it is fed straight to window.location.href, so treating it as a
// navigation target without a check would turn any future injection into that
// field into an open redirect. A leading "//" is off-site too (protocol-
// relative), which is why the check is not just `startsWith('/')`.

/** The parsed booking response. Only `next` is read; the routes also return
 *  `ok` and `scheduled_at`, so the shape stays open. */
type BookingResponse = { next?: unknown; [key: string]: unknown }

export function resolveBookingNext(
  json: BookingResponse,
  fallbackPath: string,
): string {
  const next = json?.next
  if (typeof next !== 'string' || next === '') return fallbackPath
  if (!next.startsWith('/') || next.startsWith('//')) return fallbackPath
  return next
}
