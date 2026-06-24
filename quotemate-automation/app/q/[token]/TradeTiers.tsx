// /q/[token] — non-electrical tier options, rendered INSTEAD of the generic
// electrical TierCard grid for any non-generic trade (spec R2/R9/R18: a roofing
// — or solar/paint/etc. — quote must never show the electrical line-item card).
//
// Defaults to roofing framing (patch/repair · re-roof · upgrade) since roofing
// is the trade that actually lands here as a quotes-table row; callers can pass
// generic labels for any other non-generic trade that reaches /q/[token] so it
// still avoids the electrical card. Pairs with RoofHeroStrip above it.
//
// Server component (links only). Maintain design system.

import Link from 'next/link'

type Tier = {
  label: string
  subtotal_ex_gst: number | string
  line_items?: unknown[]
} | null

type TierKey = 'good' | 'better' | 'best'

type Props = {
  tiers: Record<TierKey, Tier>
  token: string
  /** Per-tier Stripe deposit links — present ⇒ Pay Deposit CTA renders (R12). */
  stripeLinks: Partial<Record<TierKey, string>>
  /** Deposit percentage from the tenant's pricing book, if any. */
  depositPct: number | null | undefined
  /** The tier the tradie flagged as recommended (quotes.selected_tier). */
  selectedTier: string | null
  /** Applied early-bird discount %, already resolved by the page. */
  appliedDiscountPct: number
  isPaid: boolean
  paidTier: string | null
  /** Section heading. Defaults to a roofing-appropriate heading. */
  heading?: string
  /** Per-tier labels. Defaults to roofing framing. */
  labels?: Record<TierKey, string>
  /** Per-tier descriptive blurbs. Defaults to roofing copy. */
  blurbs?: Record<TierKey, string>
  /** Footnote under the cards. Defaults to the roofing inspection note. */
  footnote?: string
}

const ROOF_TIER_LABEL: Record<TierKey, string> = {
  good: 'Patch / repair',
  better: 'Re-roof',
  best: 'Upgrade',
}
const ROOF_TIER_BLURB: Record<TierKey, string> = {
  good: 'Targeted repairs to the worst-affected sections — the budget-conscious fix to buy time.',
  better: 'A full replacement of the roof covering — the recommended long-term solution.',
  best: 'Premium materials and upgrades for maximum lifespan and street appeal.',
}
const ROOF_FOOTNOTE =
  'Final price is confirmed after our on-site inspection. Pricing is calculated from satellite measurements and your declared roof material and pitch.'

function asNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'string' ? parseFloat(v) : v
}
function fmt(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function incGst(exGst: number): number {
  return Math.round(exGst * 1.1)
}
function deposit(price: number, pct: number | null | undefined): number | null {
  if (!pct || pct <= 0) return null
  return Math.round((price * pct) / 100)
}

export function TradeTiers({
  tiers,
  token,
  stripeLinks,
  depositPct,
  selectedTier,
  appliedDiscountPct,
  isPaid,
  paidTier,
  heading,
  labels = ROOF_TIER_LABEL,
  blurbs = ROOF_TIER_BLURB,
  footnote = ROOF_FOOTNOTE,
}: Props) {
  const keys = (['good', 'better', 'best'] as const).filter((k) => tiers[k])
  const resolvedHeading =
    heading ?? (keys.length === 1 ? 'Your roofing option' : 'Your roofing options')
  return (
    <section className="mt-12">
      <h2 className="mb-6 font-mono text-xs uppercase tracking-[0.15em] text-text-dim">
        {resolvedHeading}
      </h2>
      <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
        {keys.map((key) => {
          const tier = tiers[key]!
          const exGst = asNumber(tier.subtotal_ex_gst) * (1 - appliedDiscountPct / 100)
          const priceInc = incGst(exGst)
          const dep = deposit(priceInc, depositPct)
          const href = stripeLinks[key] ? `/r/${token}/${key}` : null
          const recommended = selectedTier === key
          const paid = isPaid && paidTier === key
          const dimmed = isPaid && paidTier !== key
          return (
            <article
              key={key}
              className={`relative flex flex-col border bg-ink-card p-6 sm:p-7 ${
                recommended ? 'border-accent' : 'border-ink-line'
              } ${dimmed ? 'opacity-50' : ''}`}
            >
              {recommended ? (
                <span className="absolute -top-px left-0 bg-accent px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-ink-deep">
                  Recommended
                </span>
              ) : null}
              <div className="mt-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-accent">
                {labels[key]}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-text-sec">{blurbs[key]}</p>

              <div className="mt-5 border-t border-ink-line pt-5">
                <div className="font-mono text-3xl font-bold tabular-nums text-text-pri">
                  ${fmt(priceInc)}
                </div>
                <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                  inc GST
                  {appliedDiscountPct > 0 ? ` · ${appliedDiscountPct}% off applied` : ''}
                </div>
                {dep !== null ? (
                  <div className="mt-1 text-sm text-text-sec">
                    Deposit to book: <span className="font-semibold text-text-pri">${fmt(dep)}</span>
                  </div>
                ) : null}
              </div>

              <div className="mt-6">
                {paid ? (
                  <div className="border border-success/40 bg-success/10 px-4 py-3 text-center font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-success">
                    Deposit paid
                  </div>
                ) : href ? (
                  <Link
                    href={href}
                    className="block bg-accent px-4 py-3 text-center font-mono text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-ink-deep transition-colors hover:bg-accent-press"
                  >
                    Pay deposit
                  </Link>
                ) : (
                  <div className="border border-ink-line px-4 py-3 text-center font-mono text-[0.72rem] uppercase tracking-[0.14em] text-text-dim">
                    Confirm to unlock
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>
      <p className="mt-5 text-sm leading-relaxed text-text-dim">{footnote}</p>
    </section>
  )
}
