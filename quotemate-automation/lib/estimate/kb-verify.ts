// ════════════════════════════════════════════════════════════════════
// MT-QM-PRICING-KB estimate verification (kb-verify).
//
// After Opus drafts a quote and BEFORE the deterministic grounding
// validator runs, this module cross-checks every priced line item against
// the authoritative MT-QM-PRICING-KB file store (which mirrors the full
// Supabase pricing/materials tables). It produces a per-line verdict —
// confirmed / mismatch / uncovered — and, in `apply` mode, overwrites a
// mismatched unit price with the KB's authoritative figure.
//
// SAFETY MODEL (matches the deterministic-BOM envelope in run.ts):
//   • The KB layer FEEDS the grounding validator; it never replaces it.
//     Because verification runs BEFORE validateQuoteGrounding, any price
//     the KB rewrites must still ground against pricing_book + shared_*.
//     A KB "correction" that isn't itself grounded simply downgrades the
//     whole quote to the $99 inspection route — the same safe failure
//     mode every other money-path step uses.
//   • Money is never free-formed. The reconciler only ever copies a price
//     the KB cited; it never invents one.
//   • Degrades safely: KB disabled, unreachable, low-confidence, or no
//     parseable price → returns null and the draft is bit-identical to
//     the KB-off path.
//
// MODES (env KB_VERIFY_ESTIMATES):
//   • off (unset / '0' / 'false') — feature dormant, zero behaviour change.
//   • shadow ('1' / 'true' / 'shadow') — verify + attach risk_flags for
//     tradie review, but DO NOT change any customer-facing price.
//   • apply ('apply') — additionally overwrite mismatched unit prices with
//     the KB figure, then let grounding govern.
//
// The PURE core (mode/query/parse/reconcile/apply) has no I/O and is fully
// unit-testable; runKbEstimateVerification is the thin best-effort wrapper
// that performs the KB search and feeds the pure core.
// ════════════════════════════════════════════════════════════════════

import {
  kbSearch,
  loadKbConfigFromEnv,
  type KbConfig,
  type KbFetch,
  type KbSearchInput,
  type KbSearchResult,
} from '@/lib/admin-loader/mt-filestore-kb'

/** The pricing store this verifier targets by default (MT-QM-PRICING-KB). */
export const KB_PRICING_STORE_DEFAULT = 'fileSearchStores/mtqmpricingkb-o95jk3es162t'

/** Allowed relative drift between the draft price and the KB price before a
 *  line is treated as a mismatch (10%). Markups round and the KB answer can
 *  paraphrase, so a tight-but-forgiving band avoids false corrections. */
export const KB_MISMATCH_TOLERANCE_PCT = 0.1

/** Minimum fraction of a KB finding's label tokens that must appear in a
 *  line description for the two to be considered the same item. */
export const KB_LABEL_MATCH_THRESHOLD = 0.5

export type KbVerifyMode = 'off' | 'shadow' | 'apply'

/** One (label, price) pair the KB cited in its prose answer. */
export type KbPriceFinding = {
  /** Lower-cased material/line label preceding the cited price. */
  label: string
  /** The cited price in dollars (ex-GST assumed — the store is ex-GST). */
  price: number
}

export type KbLineVerdict = {
  tier: 'good' | 'better' | 'best'
  lineIndex: number
  description: string
  draftPrice: number
  /** The KB's authoritative price for the matched label; null when uncovered. */
  kbPrice: number | null
  matchedLabel: string | null
  verdict: 'confirmed' | 'mismatch' | 'uncovered'
  /** (kbPrice − draftPrice) / draftPrice when matched; null when uncovered. */
  deltaPct: number | null
}

export type KbCorrection = {
  tier: 'good' | 'better' | 'best'
  lineIndex: number
  from: number
  to: number
}

export type KbReconciliation = {
  verdicts: KbLineVerdict[]
  corrections: KbCorrection[]
  /** Human-readable risk_flag strings for tradie review. */
  flags: string[]
  summary: { confirmed: number; mismatch: number; uncovered: number }
}

// ─────────────────────────────────────────────────────────────────────
// Mode gate — pure
// ─────────────────────────────────────────────────────────────────────

export function kbVerifyMode(env: NodeJS.ProcessEnv = process.env): KbVerifyMode {
  const v = (env.KB_VERIFY_ESTIMATES ?? '').trim().toLowerCase()
  if (v === 'apply') return 'apply'
  if (v === '1' || v === 'true' || v === 'shadow') return 'shadow'
  return 'off'
}

// ─────────────────────────────────────────────────────────────────────
// Defensive line-item readers — the draft is loose jsonb, so tolerate the
// small field-name variations the estimator has used over time.
// ─────────────────────────────────────────────────────────────────────

const TIERS = ['good', 'better', 'best'] as const

function readDesc(li: unknown): string {
  const o = li as Record<string, unknown> | null
  const d = o?.description ?? o?.name ?? o?.item ?? ''
  return typeof d === 'string' ? d.trim() : ''
}

function readUnitPrice(li: unknown): number | null {
  const o = li as Record<string, unknown> | null
  const raw = o?.unit_price_ex_gst ?? o?.unit_price ?? o?.price_ex_gst ?? null
  const n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(n) ? n : null
}

function readQuantity(li: unknown): number | null {
  const o = li as Record<string, unknown> | null
  const raw = o?.quantity ?? o?.qty ?? o?.count ?? null
  const n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(n) ? n : null
}

/** Set the unit price and keep any line-total field consistent. The tier
 *  subtotal is re-derived downstream by reconcileTierMath in run.ts, so we
 *  only need the line itself to be internally consistent here. */
function setUnitPrice(li: Record<string, unknown>, price: number): void {
  li.unit_price_ex_gst = price
  const qty = readQuantity(li)
  if (qty != null) {
    if ('line_total_ex_gst' in li) li.line_total_ex_gst = round2(price * qty)
    if ('total_ex_gst' in li) li.total_ex_gst = round2(price * qty)
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─────────────────────────────────────────────────────────────────────
// Query builder — pure. Asks the KB for the authoritative unit price of
// each distinct line description in the draft.
// ─────────────────────────────────────────────────────────────────────

export function buildKbVerifyQuery(intake: unknown, draft: unknown): string {
  const i = intake as Record<string, unknown> | null
  const trade = typeof i?.trade === 'string' ? i.trade : null
  const jobType = typeof i?.job_type === 'string' ? i.job_type : null

  const descriptions = new Set<string>()
  const d = draft as Record<string, unknown> | null
  for (const tier of TIERS) {
    const t = d?.[tier] as { line_items?: unknown[] } | null
    if (!t || !Array.isArray(t.line_items)) continue
    for (const li of t.line_items) {
      const desc = readDesc(li)
      if (desc) descriptions.add(desc)
    }
  }

  const header = [
    'You are the QuoteMate pricing knowledge base (MT-QM-PRICING-KB), which mirrors the',
    'authoritative Supabase pricing and materials tables.',
    trade ? `Trade: ${trade}.` : '',
    jobType ? `Job type: ${jobType}.` : '',
    'For each item below, state its authoritative unit price ex-GST as a dollar figure.',
    'Quote the price for the closest matching catalogue row. If an item is not in the',
    'knowledge base, say so for that item rather than guessing.',
  ]
    .filter(Boolean)
    .join(' ')

  const items = Array.from(descriptions).map((dsc) => `- ${dsc}`)
  return `${header}\n\nItems:\n${items.join('\n')}`
}

// ─────────────────────────────────────────────────────────────────────
// Price parser — pure. Extracts (label, $price) pairs from the KB's prose
// answer. Heuristic but deterministic and unit-tested.
// ─────────────────────────────────────────────────────────────────────

const PRICE_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/

/** Pricing verbs / filler stripped from a label so token-matching keys on
 *  the material noun, not the sentence scaffolding. */
const LABEL_NOISE_RE =
  /\b(is|are|was|costs?|priced|price|pricing|charged|typically|around|approximately|approx|about|roughly|the|a|an|each|per|unit|at|for|of|ex|gst|exclusive)\b/gi

export function parseKbPrices(answer: string): KbPriceFinding[] {
  if (!answer || typeof answer !== 'string') return []
  const findings: KbPriceFinding[] = []
  // Clause-ish segments: newlines, bullets, semicolons, and sentence ends.
  const segments = answer.split(/[\n;]+|(?<=[.!?])\s+/)
  for (const seg of segments) {
    const m = seg.match(PRICE_RE)
    if (!m || m.index == null) continue
    const price = parseFloat(m[1].replace(/,/g, ''))
    if (!Number.isFinite(price) || price <= 0) continue
    let label = seg.slice(0, m.index)
    label = label
      .replace(LABEL_NOISE_RE, ' ')
      .replace(/[•\-*:–—()]+/g, ' ')
      .replace(/[^a-zA-Z0-9 /]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    if (label.length < 3) continue
    findings.push({ label, price })
  }
  return findings
}

// ─────────────────────────────────────────────────────────────────────
// Label matching — pure token overlap.
// ─────────────────────────────────────────────────────────────────────

function tokenSet(s: string): Set<string> {
  const words = (s ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(words.filter((w) => w.length >= 3))
}

/** Best KB finding for a line description, or null when none clears the
 *  match threshold. Score = fraction of the finding label's tokens that
 *  also appear in the line description. */
function bestMatch(
  desc: string,
  findings: KbPriceFinding[],
): { finding: KbPriceFinding; score: number } | null {
  const d = tokenSet(desc)
  if (d.size === 0) return null
  let best: KbPriceFinding | null = null
  let bestScore = 0
  for (const f of findings) {
    const fl = tokenSet(f.label)
    if (fl.size === 0) continue
    let overlap = 0
    for (const t of fl) if (d.has(t)) overlap++
    const score = overlap / fl.size
    if (score > bestScore) {
      bestScore = score
      best = f
    }
  }
  return best && bestScore >= KB_LABEL_MATCH_THRESHOLD
    ? { finding: best, score: bestScore }
    : null
}

// ─────────────────────────────────────────────────────────────────────
// Reconciler — pure. Compares draft lines to KB findings.
// ─────────────────────────────────────────────────────────────────────

export function reconcileDraftAgainstKb(args: {
  draft: unknown
  findings: KbPriceFinding[]
  tolerancePct?: number
}): KbReconciliation {
  const { draft, findings } = args
  const tolerancePct = args.tolerancePct ?? KB_MISMATCH_TOLERANCE_PCT
  const verdicts: KbLineVerdict[] = []
  const corrections: KbCorrection[] = []
  const flags: string[] = []

  const d = draft as Record<string, unknown> | null
  for (const tier of TIERS) {
    const t = d?.[tier] as { line_items?: unknown[] } | null
    if (!t || !Array.isArray(t.line_items)) continue
    t.line_items.forEach((li, lineIndex) => {
      const draftPrice = readUnitPrice(li)
      const description = readDesc(li)
      if (draftPrice == null || !description) return

      const m = bestMatch(description, findings)
      if (!m) {
        verdicts.push({
          tier,
          lineIndex,
          description,
          draftPrice,
          kbPrice: null,
          matchedLabel: null,
          verdict: 'uncovered',
          deltaPct: null,
        })
        return
      }

      const kbPrice = m.finding.price
      const deltaPct =
        draftPrice !== 0 ? (kbPrice - draftPrice) / draftPrice : kbPrice === 0 ? 0 : 1

      if (Math.abs(deltaPct) <= tolerancePct) {
        verdicts.push({
          tier,
          lineIndex,
          description,
          draftPrice,
          kbPrice,
          matchedLabel: m.finding.label,
          verdict: 'confirmed',
          deltaPct,
        })
      } else {
        verdicts.push({
          tier,
          lineIndex,
          description,
          draftPrice,
          kbPrice,
          matchedLabel: m.finding.label,
          verdict: 'mismatch',
          deltaPct,
        })
        corrections.push({ tier, lineIndex, from: draftPrice, to: kbPrice })
        flags.push(
          `[kb-verify] ${tier}: "${description}" drafted at $${draftPrice.toFixed(2)} but ` +
            `MT-QM-PRICING-KB shows $${kbPrice.toFixed(2)} (${(deltaPct * 100).toFixed(0)}% off) — verify before sending.`,
        )
      }
    })
  }

  const summary = {
    confirmed: verdicts.filter((v) => v.verdict === 'confirmed').length,
    mismatch: verdicts.filter((v) => v.verdict === 'mismatch').length,
    uncovered: verdicts.filter((v) => v.verdict === 'uncovered').length,
  }
  return { verdicts, corrections, flags, summary }
}

// ─────────────────────────────────────────────────────────────────────
// Apply — mutates the draft. Always appends the risk_flags (supplement);
// in `apply` mode also overwrites mismatched unit prices (correct). The
// grounding validator in run.ts then governs the corrected prices.
// ─────────────────────────────────────────────────────────────────────

export function applyKbReconciliation(
  draft: unknown,
  recon: KbReconciliation,
  mode: KbVerifyMode,
): { flagged: number; corrected: number } {
  if (mode === 'off') return { flagged: 0, corrected: 0 }
  const d = draft as Record<string, unknown>
  if (recon.flags.length > 0) {
    const existing = Array.isArray(d.risk_flags) ? (d.risk_flags as unknown[]) : []
    d.risk_flags = [...existing, ...recon.flags]
  }
  let corrected = 0
  if (mode === 'apply') {
    for (const c of recon.corrections) {
      const tier = d[c.tier] as { line_items?: unknown[] } | null
      const li = tier?.line_items?.[c.lineIndex]
      if (li && typeof li === 'object') {
        setUnitPrice(li as Record<string, unknown>, c.to)
        corrected++
      }
    }
  }
  return { flagged: recon.flags.length, corrected }
}

// ─────────────────────────────────────────────────────────────────────
// I/O wrapper — best-effort. Never throws; returns null on any safe-degrade
// condition (mode off, no priced draft, KB error, no parseable findings).
// ─────────────────────────────────────────────────────────────────────

export type KbVerifyDeps = {
  /** Injectable search (tests). Falls back to kbSearch over a loaded config. */
  search?: (input: KbSearchInput) => Promise<KbSearchResult>
  loadConfig?: (env: NodeJS.ProcessEnv) => KbConfig
  fetchImpl?: KbFetch
  log?: { ok?: (m: string, x?: unknown) => void; err?: (m: string, x?: unknown) => void }
}

export type KbVerifyOutcome = {
  mode: KbVerifyMode
  reconciliation: KbReconciliation
  flagged: number
  corrected: number
}

export async function runKbEstimateVerification(
  args: { intake: unknown; draft: unknown; env?: NodeJS.ProcessEnv; storeId?: string },
  deps: KbVerifyDeps = {},
): Promise<KbVerifyOutcome | null> {
  const env = args.env ?? process.env
  const mode = kbVerifyMode(env)
  if (mode === 'off') return null

  // Only priced drafts have line items to verify.
  const draft = args.draft as Record<string, unknown> | null
  if (!draft || draft.needs_inspection === true) return null
  const hasLineItems = TIERS.some((t) => {
    const tier = draft[t] as { line_items?: unknown[] } | null
    return tier && Array.isArray(tier.line_items) && tier.line_items.length > 0
  })
  if (!hasLineItems) return null

  const store = args.storeId ?? env.KB_PRICING_STORE_ID ?? KB_PRICING_STORE_DEFAULT

  let result: KbSearchResult
  try {
    const query = buildKbVerifyQuery(args.intake, draft)
    if (deps.search) {
      result = await deps.search({ store, query })
    } else {
      const config = (deps.loadConfig ?? loadKbConfigFromEnv)(env)
      result = await kbSearch(config, { store, query }, deps.fetchImpl)
    }
  } catch (e) {
    // KB unreachable / unconfigured / HTTP error → safe degrade.
    deps.log?.err?.(
      'KB estimate verification skipped (KB unavailable — quote unchanged)',
      e instanceof Error ? e.message : String(e),
    )
    return null
  }

  const findings = parseKbPrices(result.answer)
  if (findings.length === 0) {
    deps.log?.ok?.('KB estimate verification — no parseable prices returned (no-op)')
    return null
  }

  const reconciliation = reconcileDraftAgainstKb({ draft, findings })
  const { flagged, corrected } = applyKbReconciliation(draft, reconciliation, mode)
  deps.log?.ok?.('KB estimate verification applied', {
    mode,
    ...reconciliation.summary,
    flagged,
    corrected,
  })
  return { mode, reconciliation, flagged, corrected }
}
