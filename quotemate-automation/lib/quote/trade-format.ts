// Single source of truth that maps a quote/estimate's trade to the renderer it
// should use — on both the customer-facing `/q/*` surface and the dashboard
// Quotes tab. Spec: specs/per-trade-quote-formats.md (R1–R3).
//
// The rule the whole feature hangs on: the generic Good/Better/Best card is the
// shared baseline for ELECTRICAL and PLUMBING only. Every other trade gets a
// bespoke format. An unknown/unmapped trade falls back to the generic baseline
// AND emits a warning, so a newly-added trade can never silently inherit the
// electrical card without someone noticing (R3).
//
// This module is pure and has no I/O so it can be unit-tested and imported from
// both server components and client components.

/** Canonical trade keys the renderer registry understands. */
export type TradeKey =
  | 'electrical'
  | 'plumbing'
  | 'roofing'
  | 'solar'
  | 'painting'
  | 'commercial-painting'
  | 'aircon'
  | 'electrical-estimation'

/** Which inline renderer the dashboard Quotes tab uses for a row (R4–R8). */
export type DashboardRenderer =
  | 'generic'
  | 'roofing'
  | 'solar'
  | 'painting'
  | 'commercial-painting'
  | 'aircon'
  | 'estimation'

export type QuoteFormat = {
  /** Normalised trade key. */
  key: TradeKey
  /** Human label for badges/headings. */
  label: string
  /**
   * True ONLY for electrical + plumbing. When true the surface renders the
   * existing generic Good/Better/Best card; when false it must render the
   * trade's bespoke format instead of the electrical card (R2).
   */
  usesGenericCard: boolean
  /** Inline renderer the dashboard Quotes tab should use for this trade. */
  dashboardRenderer: DashboardRenderer
  /**
   * Base path of the trade's dedicated customer page (token appended by the
   * caller), or null when the trade renders inline on the generic `/q/[token]`
   * page. e.g. '/q/roof', '/q/solar', '/q/paint'.
   */
  customerRouteBase: string | null
  /** True when the trade resolution fell through to the logged baseline (R3). */
  isFallback: boolean
}

/** The two trades that keep the generic baseline card. */
const GENERIC_TRADES: ReadonlySet<TradeKey> = new Set<TradeKey>(['electrical', 'plumbing'])

/**
 * Normalise the many spellings a trade value arrives as (DB columns, intake
 * payloads, tab slugs) into a canonical TradeKey. Returns null for anything
 * unrecognised so the caller can apply the logged fallback.
 */
function normaliseTrade(raw: string | null | undefined): TradeKey | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase().replace(/[\s_]+/g, '-')
  switch (t) {
    case 'electrical':
    case 'electric':
    case 'electrician':
      return 'electrical'
    case 'plumbing':
    case 'plumber':
      return 'plumbing'
    case 'roofing':
    case 'roof':
      return 'roofing'
    case 'solar':
    case 'solar-pv':
    case 'pv':
      return 'solar'
    case 'painting':
    case 'paint':
    case 'residential-painting':
      return 'painting'
    case 'commercial-painting':
    case 'commercial-paint':
    case 'commercial-painter':
      return 'commercial-painting'
    case 'aircon':
    case 'air-con':
    case 'air-conditioning':
    case 'airconditioning':
    case 'hvac':
      return 'aircon'
    case 'electrical-estimation':
    case 'electrical-estimate':
    case 'estimation':
    case 'estimator':
    case 'plan-estimator':
      return 'electrical-estimation'
    default:
      return null
  }
}

const FORMATS: Record<TradeKey, Omit<QuoteFormat, 'isFallback'>> = {
  electrical: {
    key: 'electrical',
    label: 'Electrical',
    usesGenericCard: true,
    dashboardRenderer: 'generic',
    customerRouteBase: null,
  },
  plumbing: {
    key: 'plumbing',
    label: 'Plumbing',
    usesGenericCard: true,
    dashboardRenderer: 'generic',
    customerRouteBase: null,
  },
  roofing: {
    key: 'roofing',
    label: 'Roofing',
    usesGenericCard: false,
    dashboardRenderer: 'roofing',
    customerRouteBase: '/q/roof',
  },
  solar: {
    key: 'solar',
    label: 'Solar',
    usesGenericCard: false,
    dashboardRenderer: 'solar',
    customerRouteBase: '/q/solar',
  },
  painting: {
    key: 'painting',
    label: 'Painting',
    usesGenericCard: false,
    dashboardRenderer: 'painting',
    customerRouteBase: '/q/paint',
  },
  'commercial-painting': {
    key: 'commercial-painting',
    label: 'Commercial painting',
    usesGenericCard: false,
    dashboardRenderer: 'commercial-painting',
    customerRouteBase: '/q/commercial-paint',
  },
  aircon: {
    key: 'aircon',
    label: 'Air conditioning',
    usesGenericCard: false,
    dashboardRenderer: 'aircon',
    customerRouteBase: '/q/aircon',
  },
  'electrical-estimation': {
    key: 'electrical-estimation',
    label: 'Electrical estimate',
    usesGenericCard: false,
    dashboardRenderer: 'estimation',
    customerRouteBase: '/q/plan',
  },
}

/**
 * Optional sink for the unknown-trade warning so tests (and callers that route
 * logs elsewhere) can observe it without scraping stdout. Defaults to
 * console.warn.
 */
export type TradeWarnFn = (message: string, context: { trade: string | null | undefined }) => void

const defaultWarn: TradeWarnFn = (message, context) => {
  // eslint-disable-next-line no-console
  console.warn(message, context)
}

/**
 * Resolve the rendering format for a trade. Electrical/plumbing → generic card;
 * every other known trade → its bespoke renderer; unknown → generic baseline
 * with a logged warning and `isFallback: true` (R1–R3).
 */
export function resolveTradeFormat(
  trade: string | null | undefined,
  warn: TradeWarnFn = defaultWarn,
): QuoteFormat {
  const key = normaliseTrade(trade)
  if (key === null) {
    warn(
      `[trade-format] Unknown trade "${trade ?? '(none)'}" — falling back to the generic electrical/plumbing card. Add it to lib/quote/trade-format.ts to give it a bespoke format.`,
      { trade },
    )
    return { ...FORMATS.electrical, isFallback: true }
  }
  return { ...FORMATS[key], isFallback: false }
}

/** Convenience: does this trade keep the generic Good/Better/Best card? */
export function usesGenericCard(trade: string | null | undefined): boolean {
  return GENERIC_TRADES.has(normaliseTrade(trade) ?? 'electrical')
}

/** Trade-appropriate labels for the three price tiers (good/better/best). */
export type TierLabels = { good: string; better: string; best: string }

const GENERIC_TIER_LABELS: TierLabels = { good: 'Good', better: 'Better', best: 'Best' }

const TIER_LABELS_BY_TRADE: Partial<Record<TradeKey, TierLabels>> = {
  // Roofing uses the same framing as the customer-facing /q/roof + RoofingTiers
  // so the tradie and customer see one shared vocabulary.
  roofing: { good: 'Patch / repair', better: 'Re-roof', best: 'Upgrade' },
}

/**
 * Tier labels for a trade. Roofing gets roofing-specific framing; every other
 * trade keeps the generic Good/Better/Best (their tier semantics are unchanged).
 */
export function tierLabelsForTrade(trade: string | null | undefined): TierLabels {
  const key = normaliseTrade(trade)
  return (key && TIER_LABELS_BY_TRADE[key]) || GENERIC_TIER_LABELS
}
