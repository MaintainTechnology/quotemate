// Deterministic quote-integrity backstops — pure, DB-free, unit-tested.
//
// These run on the auto-quote SUCCESS path (lib/estimate/run.ts), AFTER the
// grounding validator has proved every UNIT price derives from a real catalogue
// row. They never fabricate a price; they only:
//   1. make the BILL consistent with those proven unit prices (arithmetic),
//   2. collapse fake-identical Good/Better/Best tiers,
//   3. FLAG a headline quantity that disagrees with the job's item_count.
//
// Policy (user-confirmed): auto-correct the safe things (arithmetic, duplicate
// tiers); FLAG the risky thing (quantity ≠ item_count) for tradie review rather
// than silently changing what's billed. Never downgrade an already-grounded
// quote — these are best-effort polish, not a safety gate.
//
// Helpers mirror the per-module convention in catalogue.ts / min-labour.ts
// (each keeps its own tiny money()/num()).

import { findHeadlineMaterialIndex } from './catalogue'

type Line = Record<string, any>
type Tier =
  | { line_items?: Line[]; subtotal_ex_gst?: number | string; label?: string }
  | null
  | undefined
type Draft = Record<string, any>

const TIERS = ['good', 'better', 'best'] as const
type TierKey = (typeof TIERS)[number]

/** Parse string|number → float, NaN otherwise. Matches catalogue.ts/min-labour.ts. */
function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN
  return typeof v === 'string' ? parseFloat(v) : (v as number)
}
/** Round to 2dp exactly like money()/applyMarkup()/buildCandidatePrices(). */
function money(x: number): number {
  return +x.toFixed(2)
}

export interface ReconcileCorrection {
  tier: TierKey
  field: 'line_total' | 'subtotal'
  index?: number
  from: number
  to: number
}

/**
 * Auto-correct each priced tier's arithmetic so the bill ALWAYS adds up:
 *   line.total_ex_gst   = round(quantity × unit_price_ex_gst)
 *   tier.subtotal_ex_gst = round(sum of line totals)
 * Only touches a line whose quantity AND unit_price are finite (degrade-never-
 * break: a malformed line keeps whatever usable total it has, and is never given
 * a fabricated price). Idempotent — a no-op for the deterministic-BOM /
 * min-labour / recipe paths that already keep subtotals consistent. Mutates the
 * draft in place; returns the corrections it made (for logging).
 */
export function reconcileTierMath(draft: Draft): {
  draft: Draft
  corrections: ReconcileCorrection[]
} {
  const corrections: ReconcileCorrection[] = []
  if (!draft) return { draft, corrections }
  for (const key of TIERS) {
    const tier = draft[key] as Tier
    if (!tier || !Array.isArray(tier.line_items)) continue
    let sum = 0
    let sawTotal = false
    for (let i = 0; i < tier.line_items.length; i++) {
      const li = tier.line_items[i]
      if (!li) continue
      const qty = num(li.quantity)
      const unit = num(li.unit_price_ex_gst)
      if (Number.isFinite(qty) && Number.isFinite(unit)) {
        const want = money(qty * unit)
        const have = num(li.total_ex_gst)
        if (!Number.isFinite(have) || Math.abs(have - want) > 0.001) {
          corrections.push({
            tier: key,
            field: 'line_total',
            index: i,
            from: Number.isFinite(have) ? have : NaN,
            to: want,
          })
        }
        li.total_ex_gst = want
        sum += want
        sawTotal = true
      } else {
        // Non-finite qty/price: don't fabricate a price. Keep a usable total in
        // the sum if one exists, otherwise leave the line entirely alone.
        const have = num(li.total_ex_gst)
        if (Number.isFinite(have)) {
          sum += have
          sawTotal = true
        }
      }
    }
    if (sawTotal) {
      const wantSub = money(sum)
      const haveSub = num(tier.subtotal_ex_gst)
      if (!Number.isFinite(haveSub) || Math.abs(haveSub - wantSub) > 0.001) {
        corrections.push({
          tier: key,
          field: 'subtotal',
          from: Number.isFinite(haveSub) ? haveSub : NaN,
          to: wantSub,
        })
      }
      tier.subtotal_ex_gst = wantSub
    }
  }
  return { draft, corrections }
}

/**
 * FLAG (never change) a headline material line whose quantity disagrees with the
 * job's item_count. Changing the quantity changes what's billed — that's a
 * tradie decision — so we only surface it as a risk flag for review. No-op when
 * item_count is absent / ≤ 0, or the headline line isn't a per-unit ('each')
 * line. Returns risk-flag strings for the caller to append to draft.risk_flags.
 */
export function checkQuantityVsItemCount(draft: Draft, itemCount: unknown): string[] {
  const flags: string[] = []
  const target = num(itemCount)
  if (!draft || !Number.isFinite(target) || target <= 0) return flags
  for (const key of TIERS) {
    const tier = draft[key] as Tier
    if (!tier || !Array.isArray(tier.line_items)) continue
    const idx = findHeadlineMaterialIndex(tier.line_items)
    if (idx < 0) continue
    const li = tier.line_items[idx]
    const unit = String(li?.unit ?? '').trim().toLowerCase()
    const qty = num(li?.quantity)
    if (unit === 'each' && Number.isFinite(qty) && qty !== target) {
      flags.push(
        `[reconcile] ${key}: headline quantity ${qty} ≠ item_count ${target} — confirm before sending`,
      )
    }
  }
  return flags
}

/**
 * Undo the product-picker labour OVER-BILLING bug.
 *
 * On the chosen-product (deterministic-BOM) path the model sometimes renders the
 * install-labour line with `quantity = item_count` treated as HOURS (≈1 hr/unit),
 * dropping the `× assembly.default_labour_hours` multiplier from the estimator's
 * CALCULATION ORDER (step 1.c). It bites multi-unit jobs whose per-unit labour is
 * under 1 hr — e.g. 6 downlights (0.4 hr each) billed as 6 hr instead of 2.4 hr.
 * Neither the grounding validator (the rate is valid) nor the min-labour floor
 * (the inflated hours already clear the floor) catches it, so 6 downlights via
 * the picker could out-cost 8 downlights via the standard path.
 *
 * The tell the model leaves behind: it ALSO emits a "minimum job allowance" /
 * "site visit + setup" top-up line, which it only adds to bring a SUB-floor job
 * UP TO the floor — so the intended TOTAL labour was exactly
 * pricing_book.min_labour_hours. When that allowance line is present yet the
 * tier's total labour EXCEEDS the floor, the excess is the over-billed install
 * line. We restore it deterministically: `install_hours = min_labour_hours −
 * allowance_hours`, which puts the tier's total labour back on the floor.
 *
 * Pure arithmetic from the draft itself — needs no per-assembly hours, never
 * fabricates a price, and can ONLY REDUCE a charge (the safe direction; an
 * under-billed labour line is left for the min-floor + always_review to handle).
 * Guards are deliberately tight (exactly two hr-lines at the hourly rate — the
 * allowance + the install line whose quantity equals item_count) so it is a
 * no-op on the correct standard path and on any tier it can't unambiguously
 * read. Mutates the draft in place; returns the corrections (for logging).
 */
export interface InflatedLabourCorrection {
  tier: TierKey
  index: number
  fromHours: number
  toHours: number
}
export function reconcileInflatedLabour(
  draft: Draft,
  opts: { itemCount: unknown; minLabourHours: unknown; hourlyRate: unknown },
): { draft: Draft; corrections: InflatedLabourCorrection[] } {
  const corrections: InflatedLabourCorrection[] = []
  const itemCount = num(opts.itemCount)
  const minLabour = num(opts.minLabourHours)
  const hourly = num(opts.hourlyRate)
  if (!draft) return { draft, corrections }
  // item_count must be a real multi-unit job (count==1 jobs are never inflated),
  // and we need a finite floor + a rate to recognise a labour line.
  if (!Number.isFinite(itemCount) || itemCount <= 1) return { draft, corrections }
  if (!Number.isFinite(minLabour) || minLabour <= 0) return { draft, corrections }
  if (!Number.isFinite(hourly) || hourly <= 0) return { draft, corrections }

  const EPS = 0.05
  const isHr = (li: Line) => String(li?.unit ?? '').trim().toLowerCase() === 'hr'
  const atHourly = (li: Line) => Math.abs(num(li?.unit_price_ex_gst) - hourly) <= 0.5
  const isAllowance = (li: Line) => {
    const d = String(li?.description ?? '').toLowerCase()
    return /site visit/.test(d) || (/\bminimum\b/.test(d) && /(allowance|site|setup|job|charge)/.test(d))
  }

  for (const key of TIERS) {
    const tier = draft[key] as Tier
    if (!tier || !Array.isArray(tier.line_items)) continue
    const items = tier.line_items
    // Only the clean two-line shape (allowance + install at the hourly rate) is
    // safe to read; anything else (risk lines, extra labour) → no-op.
    const hrLines = items.map((li, i) => ({ li, i })).filter(({ li }) => isHr(li) && atHourly(li))
    if (hrLines.length !== 2) continue
    const allowance = hrLines.find(({ li }) => isAllowance(li))
    const install = hrLines.find(({ li }) => !isAllowance(li))
    if (!allowance || !install) continue
    const allowanceHrs = num(allowance.li.quantity)
    const installHrs = num(install.li.quantity)
    if (!Number.isFinite(allowanceHrs) || !Number.isFinite(installHrs)) continue
    // Bug tell: the install line billed the item count as hours.
    if (Math.abs(installHrs - itemCount) > EPS) continue
    const totalLabour = allowanceHrs + installHrs
    if (totalLabour <= minLabour + EPS) continue // nothing inflated above the floor
    // The model topped the job to the floor → intended total = min_labour_hours.
    const toHours = +(minLabour - allowanceHrs).toFixed(2)
    if (!(toHours > 0) || toHours >= installHrs - EPS) continue // reduce-only, stay positive
    const unitPrice = num(install.li.unit_price_ex_gst)
    install.li.quantity = toHours
    install.li.total_ex_gst = money(toHours * unitPrice)
    tier.subtotal_ex_gst = money(
      items.reduce((s, x) => s + (Number(num(x?.total_ex_gst)) || 0), 0),
    )
    corrections.push({ tier: key, index: install.i, fromHours: installHrs, toHours })
  }
  return { draft, corrections }
}

/**
 * Collapse fake-identical tiers. Two priced tiers are "the same" when their line
 * items match by signature: the sorted multiset of
 * (normalised description, unit, quantity, unit_price_ex_gst). Keep the FIRST
 * tier per signature in good→better→best order and null the later duplicates, so
 * a customer never sees three "different" options that are byte-identical. If
 * draft.selected_tier was nulled, re-point it to a survivor (mirroring the
 * route's better→good→best fallback). Strict equality only — genuinely-different
 * tiers are never merged. Mutates the draft in place.
 */
export function collapseDuplicateTiers(draft: Draft): {
  draft: Draft
  collapsed: TierKey[]
} {
  const collapsed: TierKey[] = []
  if (!draft) return { draft, collapsed }
  const seen = new Map<string, TierKey>()
  for (const key of TIERS) {
    const tier = draft[key] as Tier
    if (!tier || !Array.isArray(tier.line_items) || tier.line_items.length === 0) continue
    const sig = tierSignature(tier.line_items)
    if (seen.has(sig)) {
      draft[key] = null
      collapsed.push(key)
    } else {
      seen.set(sig, key)
    }
  }
  if (collapsed.length > 0) {
    const sel = draft.selected_tier as string | null | undefined
    if (!sel || !draft[sel]) {
      draft.selected_tier = draft.better
        ? 'better'
        : draft.good
          ? 'good'
          : draft.best
            ? 'best'
            : null
    }
  }
  return { draft, collapsed }
}

function tierSignature(items: Line[]): string {
  return items
    .map((li) => {
      const desc = String(li?.description ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
      const unit = String(li?.unit ?? '').trim().toLowerCase()
      const qty = num(li?.quantity)
      const price = num(li?.unit_price_ex_gst)
      return `${desc}|${unit}|${Number.isFinite(qty) ? qty : ''}|${
        Number.isFinite(price) ? price : ''
      }`
    })
    .sort()
    .join('||')
}
