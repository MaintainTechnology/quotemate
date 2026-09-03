import type { DraftLineItem, DraftTier, DraftWithTiers } from './merge-recipes'
import type { GroundingFailure } from './validate'

/**
 * R2 (2026-09-02) — OPTIONAL-UPSELL GUARD.
 *
 * The electrical estimator prompt offers a short list of optional extras
 * ("Add RCBO safety switch", "Switchboard health check", "Per-property
 * compliance certificate") and used to hand Opus a hard-coded price for each.
 * Those belong in `optional_upsells[]`, but nothing stopped Opus folding one
 * into a priced tier — and a hard-coded price with no catalogue row behind it
 * cannot ground by construction.
 *
 * Live 2026-09-01 (quote 7zNJCjsaxBOL_N3cATDNvQ): a "Switchboard health check"
 * at $150 — a figure that matches no row in shared_materials or
 * shared_assemblies — was the third ungrounded line that turned a fully priced
 * EV charger quote into a $99 inspection.
 *
 * This guard removes ONLY lines that are both (a) recognisably one of those
 * upsells and (b) already reported ungrounded by the validator. A tenant who
 * genuinely stocks an RCBO keeps their priced line: a grounded line never
 * appears in `failures`, so it is never touched. The upsell survives as an
 * unpriced entry in `optional_upsells[]` ("quoted on site") rather than
 * vanishing silently.
 */

const TIERS = ['good', 'better', 'best'] as const
type TierName = (typeof TIERS)[number]

/** The OPTIONAL UPSELLS of `electrical-prompt.ts`, matched as WHOLE PHRASES.
 *
 *  These must never match the job's own work. Bare fragments (/rcbo/,
 *  /safety switch/, /health check/) are far too broad: "Replace faulty RCBO
 *  safety switch in switchboard" is a real job, and "HPM 2-pole RCBO 32A" is a
 *  product three live tenants stock and sell. Stripping either would delete
 *  the very work the customer asked for and quietly send a cheaper quote —
 *  strictly worse than the $99 inspection this guard exists to avoid. So the
 *  guard only recognises an upsell worded the way the prompt words it. */
const UPSELL_PATTERNS: readonly RegExp[] = [
  /^\s*(?:add\s+)?rcbo safety switch\b/i,
  /\bswitchboard health check\b/i,
  /\b(?:per-property\s+)?compliance certificate\b/i,
]

export type StrippedUpsell = {
  tier: TierName
  lineIndex: number
  description: string
  unit_price_ex_gst: number | string | undefined
}

export type UpsellGuardResult<T extends DraftWithTiers = DraftWithTiers> = {
  /** True when at least one line was moved out of a tier. */
  changed: boolean
  /** A NEW draft when changed; the exact input object when not. */
  draft: T
  removed: StrippedUpsell[]
  /** Ungrounded failures that were NOT upsell-class, i.e. the ones that still
   *  need a decision from the caller. */
  remainingFailures: GroundingFailure[]
}

export function isUpsellDescription(description: unknown): boolean {
  const text = String(description ?? '').trim()
  if (!text) return false
  return UPSELL_PATTERNS.some((re) => re.test(text))
}

function positiveFinite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function recomputeSubtotal(lines: readonly DraftLineItem[]): number | null {
  let subtotal = 0
  for (const line of lines) {
    const quantity = positiveFinite(line.quantity)
    const unitPrice = positiveFinite(line.unit_price_ex_gst)
    if (quantity === null || unitPrice === null) return null
    subtotal += quantity * unitPrice
  }
  return Math.round(subtotal * 100) / 100
}

/** Append the upsell to `optional_upsells[]` WITHOUT a price. The price it
 *  carried is exactly the number that failed to ground, so republishing it
 *  would smuggle an ungrounded figure back into the quote. */
function appendUnpricedUpsells(
  existing: unknown,
  removed: readonly StrippedUpsell[],
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = Array.isArray(existing)
    ? existing.map((u) => (u && typeof u === 'object' ? { ...(u as Record<string, unknown>) } : { name: String(u) }))
    : []
  for (const r of removed) {
    const name = r.description.trim()
    if (!name) continue
    if (out.some((u) => String(u.name ?? '').trim().toLowerCase() === name.toLowerCase())) continue
    out.push({ name, price_ex_gst: null, note: 'quoted on site' })
  }
  return out
}

/**
 * Move every ungrounded upsell-class line out of its tier.
 *
 * Fails closed on arithmetic it cannot redo: if a surviving line has no
 * usable quantity/price the tier is left EXACTLY as it was and its failures
 * stay in `remainingFailures`, so the caller still sees an invalid quote
 * rather than a tier with a subtotal that no longer matches its lines.
 */
export function stripUngroundedUpsellLines<T extends DraftWithTiers>(
  draft: T,
  failures: readonly GroundingFailure[],
): UpsellGuardResult<T> {
  const byTier = new Map<TierName, Set<number>>()
  const removed: StrippedUpsell[] = []
  const handled = new Set<GroundingFailure>()

  for (const f of failures) {
    if (!TIERS.includes(f.tier as TierName)) continue
    if (!isUpsellDescription(f.description)) continue
    const tierName = f.tier as TierName
    const tier = draft[tierName] as DraftTier | null | undefined
    if (!tier || !Array.isArray(tier.line_items)) continue
    const line = tier.line_items[f.lineIndex]
    if (!line) continue
    // Guard against a stale index: the failure must still describe this line.
    if (String(line.description ?? '').trim() !== String(f.description ?? '').trim()) continue
    const set = byTier.get(tierName) ?? new Set<number>()
    set.add(f.lineIndex)
    byTier.set(tierName, set)
    handled.add(f)
    removed.push({
      tier: tierName,
      lineIndex: f.lineIndex,
      description: String(line.description ?? ''),
      unit_price_ex_gst: line.unit_price_ex_gst,
    })
  }

  if (removed.length === 0) {
    return { changed: false, draft, removed: [], remainingFailures: [...failures] }
  }

  const next: DraftWithTiers = { ...draft }
  const abandoned = new Set<TierName>()
  for (const [tierName, indexes] of byTier) {
    const tier = draft[tierName] as DraftTier
    const survivors = (tier.line_items ?? []).filter((_l, i) => !indexes.has(i))
    // Never empty a tier. A tier with no lines recomputes to $0 and then
    // PASSES validation (the labour floor only checks non-empty tiers), so the
    // customer would be quoted zero dollars for real work. If stripping would
    // take everything, leave the tier as it was and let its failures stand —
    // an honest hold beats a $0 quote.
    if (survivors.length === 0) {
      abandoned.add(tierName)
      continue
    }
    const subtotal = recomputeSubtotal(survivors)
    if (subtotal === null) {
      abandoned.add(tierName)
      continue
    }
    next[tierName] = { ...tier, line_items: survivors, subtotal_ex_gst: subtotal }
  }

  const applied = removed.filter((r) => !abandoned.has(r.tier))
  if (applied.length === 0) {
    return { changed: false, draft, removed: [], remainingFailures: [...failures] }
  }

  next.optional_upsells = appendUnpricedUpsells(
    (draft as Record<string, unknown>).optional_upsells,
    applied,
  )

  const appliedKeys = new Set(applied.map((r) => `${r.tier}:${r.lineIndex}`))
  const remainingFailures = failures.filter(
    (f) => !handled.has(f) || !appliedKeys.has(`${f.tier}:${f.lineIndex}`),
  )

  return {
    changed: true,
    draft: next as T,
    removed: applied,
    remainingFailures,
  }
}
