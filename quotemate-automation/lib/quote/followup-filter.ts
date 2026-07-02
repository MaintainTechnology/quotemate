// ════════════════════════════════════════════════════════════════════
// Follow-ups tab — category filter + free-text search (pure).
//
// The follow-up queue grows into a long vertical stack. These helpers let
// a VA narrow it two ways:
//   • by category — the job type (e.g. "Downlights", "Hot Water"), so a
//     multi-trade tenant can focus one kind of job at a time; and
//   • by search — a free-text lookup across the customer's name, phone,
//     suburb, email and the follow-up's CODE (the quote's share token, the
//     value in the /q/<token> link — plus the quote id), so a specific
//     follow-up can be found directly.
//
// PURE and DB/UI-free so the filter logic is unit tested (followup-filter
// .test.ts) without a browser. The dashboard feeds its FollowupItem rows
// straight through — the generic on filterFollowups preserves their type.
// ════════════════════════════════════════════════════════════════════

/** The subset of a follow-up row the filter reads. FollowupItem in the
 *  dashboard is a structural superset, so it flows through unchanged. */
export type FollowupFilterItem = {
  job_type: string | null
  share_token: string | null
  quote_id: string | null
  customer: {
    first_name: string | null
    full_name: string | null
    phone: string | null
    suburb: string | null
    email: string | null
  }
}

/** Sentinel category value meaning "no filter". */
export const ALL_CATEGORY = 'all'
/** Bucket for rows with no job_type (SMS leads that never got a quote). */
export const UNCATEGORISED = 'uncategorised'

export type CategoryOption = { value: string; label: string; count: number }

/** Canonical category key for a row — its job_type, lower-cased, or the
 *  uncategorised bucket when absent. */
export function followupCategoryValue(jobType: string | null): string {
  const j = (jobType ?? '').trim()
  return j === '' ? UNCATEGORISED : j.toLowerCase()
}

/** Human label for a category value (for the dropdown). */
export function followupCategoryLabel(value: string): string {
  if (value === ALL_CATEGORY) return 'All categories'
  if (value === UNCATEGORISED) return 'Uncategorised'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** The category options present in the queue: each distinct job type with
 *  its count, most-common first, always led by an "All categories" entry. */
export function followupCategoryOptions(
  items: readonly FollowupFilterItem[],
): CategoryOption[] {
  const counts = new Map<string, number>()
  for (const it of items) {
    const v = followupCategoryValue(it.job_type)
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const derived = [...counts.entries()]
    .map(([value, count]) => ({ value, label: followupCategoryLabel(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return [
    { value: ALL_CATEGORY, label: followupCategoryLabel(ALL_CATEGORY), count: items.length },
    ...derived,
  ]
}

export function followupMatchesCategory(item: FollowupFilterItem, category: string): boolean {
  if (!category || category === ALL_CATEGORY) return true
  return followupCategoryValue(item.job_type) === category
}

/** Lower-cased blob of every field a VA might search a follow-up by,
 *  including the code (share token / quote id) and the phone in digit form.
 *  Phones are stored E.164 (`+61 4xx …`); we also index the AU local form
 *  (`04xx …`) so a search typed the way an Australian writes a mobile still
 *  matches. */
function haystack(item: FollowupFilterItem): string {
  const phone = item.customer.phone ?? ''
  const digits = phone.replace(/\D/g, '')
  // +61XXXXXXXXX → 0XXXXXXXXX (AU national significant number is 9 digits).
  const localDigits = digits.replace(/^61(?=\d{9}$)/, '0')
  return [
    item.customer.full_name,
    item.customer.first_name,
    item.customer.suburb,
    item.customer.email,
    phone,
    digits,
    localDigits,
    followupCategoryLabel(followupCategoryValue(item.job_type)),
    item.job_type,
    item.share_token,
    item.quote_id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function followupMatchesQuery(item: FollowupFilterItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return haystack(item).includes(q)
}

/** Apply category + search together (AND), preserving input order. */
export function filterFollowups<T extends FollowupFilterItem>(
  items: readonly T[],
  opts: { category?: string; query?: string },
): T[] {
  const category = opts.category ?? ALL_CATEGORY
  const query = opts.query ?? ''
  return items.filter(
    (it) => followupMatchesCategory(it, category) && followupMatchesQuery(it, query),
  )
}
