// Shared pricing data — consumed by the homepage pricing section
// (PricingTiers) and the dedicated /pricing page (cards + comparison
// table + FAQ). Single source of truth so the two surfaces never drift.
//
// Prices are AUD, ex-GST. Annual billing = ~2 months free (~17% off the
// monthly rate). Ladder vetted by the pricing council on 2026-06-19:
// Starter $49 / Pro $129 / Crew $299. Voice is the cost-driver, so it is
// the line between Starter (SMS-only) and Pro (adds the voice
// receptionist); quotes/images stay generous fair-use.

export type PlanId = "starter" | "pro" | "crew"

export type Plan = {
  id: PlanId
  name: string
  tagline: string
  /** AUD per month on the monthly plan. */
  monthly: number
  /** AUD per year on the annual plan (billed once). */
  annual: number
  featured?: boolean
  /** "Everything in X, plus:" lead-in shown above the highlights. */
  inheritsFrom?: string
  highlights: string[]
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Sole trader · SMS receptionist",
    monthly: 49,
    annual: 490,
    highlights: [
      "SMS & WhatsApp receptionist",
      "~40 quotes a month",
      "Clean quotes + deposits collected",
      "1 trade · 1 dedicated AU number",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Busy sole trader / small crew",
    monthly: 129,
    annual: 1290,
    featured: true,
    inheritsFrom: "Starter",
    highlights: [
      "Voice receptionist — 300 mins / mo",
      "~150 quotes a month",
      "Up to 2 trades · 2 dashboard seats",
      "Your branding + 1 specialised estimator",
    ],
  },
  {
    id: "crew",
    name: "Crew",
    tagline: "Multi-trade teams",
    monthly: 299,
    annual: 2990,
    inheritsFrom: "Pro",
    highlights: [
      "Voice receptionist — 1,000 mins / mo",
      "~400 quotes a month",
      "Up to 4 trades · 5 seats · 3 numbers",
      "All estimators, custom domain & priority support",
    ],
  },
]

/** Effective per-month price when billed annually, rounded to whole dollars. */
export function annualPerMonth(plan: Plan): number {
  return Math.round(plan.annual / 12)
}

/** Dollars saved per year by paying annually instead of monthly. */
export function annualSaving(plan: Plan): number {
  return plan.monthly * 12 - plan.annual
}

/** AUD formatting with thousands separators, no decimals. */
export function aud(n: number): string {
  return `$${n.toLocaleString("en-AU")}`
}

/** Length of the free trial, in days. */
export const TRIAL_DAYS = 14

/**
 * The free trial is offered on **Starter Monthly only**. Every other
 * plan/interval — Starter Annual, Pro (monthly + annual), Crew (monthly +
 * annual) — bills immediately at checkout. Single source of truth for both
 * the Stripe Checkout trial logic and the CTA copy, so the offer can never
 * drift between what the page promises and what Stripe applies.
 */
export function hasFreeTrial(plan: string, interval: string): boolean {
  return plan === "starter" && interval === "month"
}

export type CompRow = { label: string; values: [string, string, string] }

// Order of `values` matches PLANS: [Starter, Pro, Crew].
export const COMPARISON: CompRow[] = [
  { label: "Channels", values: ["SMS / WhatsApp", "SMS + Voice", "SMS + Voice"] },
  {
    label: "Quotes / month",
    values: ["~40 (fair use)", "~150 (fair use)", "~400 (fair use)"],
  },
  { label: "Voice minutes / month", values: ["Add-on", "300", "1,000"] },
  { label: "Dedicated AU number", values: ["1", "1", "Up to 3"] },
  { label: "Trades", values: ["1", "Up to 2", "Up to 4"] },
  { label: "Dashboard seats", values: ["1", "2", "5"] },
  { label: "Clean quotes drafted for you", values: ["✓", "✓", "✓"] },
  { label: "Preview & sample images", values: ["✓", "✓", "✓"] },
  { label: "Deposit collection", values: ["✓", "✓", "✓"] },
  {
    label: "Specialised estimators (solar / roof / paint)",
    values: ["—", "1 module", "All"],
  },
  {
    label: "Quote-page branding",
    values: ["Logo", "Full brand", "Full + custom domain"],
  },
  { label: "Support", values: ["Email", "Priority", "Priority + onboarding call"] },
  { label: "Extra voice minutes", values: ["—", "$0.50 / min", "$0.40 / min"] },
]

export type PricingFaqItem = { q: string; a: string }

export const PRICING_FAQ: PricingFaqItem[] = [
  {
    q: "What counts as a “quote”?",
    a: "Every quote QuoteMax sends a customer is one quote. Texted quotes are generous fair-use — quote as much as you like; we only ever flag genuine abuse, never normal busy weeks.",
  },
  {
    q: "What if I go over my voice minutes?",
    a: "Nothing breaks mid-job. Extra minutes are billed at $0.50/min on Pro (or $0.40 on Crew), and we warn you well before you hit the limit so there are no surprises.",
  },
  {
    q: "Do you take a cut of my jobs?",
    a: "No. You keep 100% of every job you win. The only fixed price is the $99 site visit, and that’s credited straight back to the customer’s job.",
  },
  {
    q: "Is the $99 site visit an extra charge?",
    a: "It only applies to complex jobs that can’t be auto-quoted. The customer pays it to lock a slot, and it’s credited to their final invoice. It’s the safety net that keeps the auto-quotes honest.",
  },
  {
    q: "Can I change plans or cancel?",
    a: "Anytime, from your dashboard. Monthly plans are month-to-month; annual saves you two months. Upgrade the moment a busy season starts and drop back down after.",
  },
  {
    q: "Is my number really mine?",
    a: "Yes. Each tradie gets a dedicated Australian number. If you ever leave, your quote history and customer data are yours to export.",
  },
  {
    q: "I’m on the free test plan — what changes?",
    a: "Nothing sudden. Pilot tradies get a Founding-Tradie deal: a locked discount and your number kept, with plenty of notice before anything is billed.",
  },
  {
    q: "Which trades can use this?",
    a: "Electrical (NSW) and plumbing (QLD) are live now, with solar, roofing and painting rolling out. Tell us your trade at signup and we’ll line you up.",
  },
]
