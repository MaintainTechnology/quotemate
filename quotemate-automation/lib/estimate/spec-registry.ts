// Spec registry — the single place that knows (a) how to normalise a spec
// value to a canonical token, and (b) which spec keys actually matter for a
// given (trade, job category). Pure + dependency-free (same discipline as
// price-bands.ts) so the spec-reconcile matcher can be proven in isolation
// before it ever touches the live quote pipeline.
//
// This is the canonicaliser BOTH sides of a spec comparison flow through —
// the customer's REQUESTED spec ("15 amp") and the catalogue product's
// stored spec ("15A") — so capture-side and catalogue-side normalisation can
// never silently diverge: one implementation, one test suite.
//
// Phase 0: code-seeded only, and NOT wired into the live pipeline. A later
// phase may load additional SpecDefs from a trades-as-data table, but the
// code seed always wins on canonical grammar.

export type SpecDef = {
  /** The spec key, matched against requested_specs[key] and properties[key]. */
  key: string
  /** Reserved for a later phase (hard = must-match-or-inspection). Unused now. */
  hard?: boolean
}

/**
 * Normalise a spec value to a canonical token, or null when it can't be
 * confidently parsed. A null result is treated as UNKNOWN by callers — never
 * as a mismatch (a parser miss must never trigger a false inspection).
 */
export function canonicalise(
  key: string,
  value: string | number | boolean | null | undefined,
): string | null {
  if (value === null || value === undefined) return null
  const raw = String(value).trim().toLowerCase()
  if (raw === '') return null
  const k = (key ?? '').trim().toLowerCase()

  switch (k) {
    case 'amperage': {
      // A number before a / amp / amps, allowing a space or hyphen separator
      // ("15 amp", "15amp", "20-amp", "15a") → "<n>A".
      const m = raw.match(/(\d{1,3})[\s-]*(?:a\b|amp)/)
      if (m) return `${parseInt(m[1], 10)}A`
      // A bare integer (e.g. properties.amperage stored as 15 or "15").
      if (/^\d{1,3}$/.test(raw)) return `${parseInt(raw, 10)}A`
      return null
    }
    case 'phase': {
      if (raw === 'single') return 'single-phase'
      if (/\b(single|1)\b/.test(raw) && raw.includes('phase')) return 'single-phase'
      if (/\b(three|3)\b/.test(raw) || raw.includes('3φ') || raw.includes('three-phase'))
        return 'three-phase'
      return null
    }
    case 'ip_rating': {
      const m = raw.match(/ip\s?(\d{2})/)
      return m ? `IP${m[1]}` : null
    }
    case 'energy_source': {
      if (raw.includes('gas')) return 'gas'
      if ((raw.includes('heat') && raw.includes('pump')) || raw.includes('heatpump'))
        return 'heat-pump'
      if (raw.includes('solar')) return 'solar'
      if (raw.includes('electric')) return 'electric'
      return null
    }
    case 'litres': {
      // Prefer a number directly before L / litre(s) ("250L", "260 litre") so
      // an unrelated number in the name ("5-star") isn't mistaken for volume.
      const m = raw.match(/(\d{1,4})\s*(?:l\b|lt\b|litre|liter)/)
      if (m) return `${parseInt(m[1], 10)}`
      // A bare integer (e.g. properties.litres stored as 250 or "250").
      if (/^\d{1,4}$/.test(raw)) return `${parseInt(raw, 10)}`
      return null
    }
    case 'poles': {
      if (raw === '1' || raw.includes('single')) return 'single'
      if (raw === '2' || raw.includes('double')) return 'double'
      return null
    }
    default:
      // Unknown key: deterministic lowercase/trim passthrough so it still
      // compares stably (never throws), but carries no domain meaning.
      return raw
  }
}

// Code-seeded: which spec keys matter per (trade, WP9 category). The category
// vocabulary matches lib/sms/product-options.ts JOB_TYPE_CATEGORY (gpo, fan,
// downlight, hot_water, drain, tap, toilet, outdoor_light, smoke_alarm).
const SPEC_DEFS: Record<string, Record<string, SpecDef[]>> = {
  electrical: {
    gpo: [{ key: 'amperage' }],
    outdoor_light: [{ key: 'ip_rating' }],
  },
  plumbing: {
    hot_water: [{ key: 'energy_source' }, { key: 'litres' }],
  },
}

/** A trades-as-data row from the `trade_spec_defs` table (migration 083),
 *  injected so this module stays pure/DB-free. */
export interface SpecDefOverride {
  trade: string
  category: string
  spec_key: string
  hard?: boolean | null
}

/**
 * Which spec keys matter for a (trade, category). Returns [] for any combo we
 * haven't seeded — callers treat an empty list as "no registry opinion" and
 * degrade safely (raw-compare fallback in reconcileSpecs).
 *
 * `overrides` (the trade_spec_defs rows) let a v9 trade/category register its
 * own keys WITHOUT a code change. The CODE SEED always wins — canonicalise
 * grammar is code-only, so the table can only ADD keys the seed doesn't have,
 * never redefine an existing one. Pure (rows injected, never fetched here).
 */
export function getSpecDefs(
  trade: string | null | undefined,
  category: string | null | undefined,
  overrides?: SpecDefOverride[] | null,
): SpecDef[] {
  const t = (trade ?? '').trim().toLowerCase()
  const c = (category ?? '').trim().toLowerCase()
  const seed = SPEC_DEFS[t]?.[c] ?? []
  if (!overrides || overrides.length === 0) return seed

  const have = new Set(seed.map((d) => d.key.toLowerCase()))
  const extra: SpecDef[] = []
  for (const o of overrides) {
    if ((o?.trade ?? '').trim().toLowerCase() !== t) continue
    if ((o?.category ?? '').trim().toLowerCase() !== c) continue
    const key = (o?.spec_key ?? '').trim()
    if (!key || have.has(key.toLowerCase())) continue
    have.add(key.toLowerCase())
    extra.push({ key, hard: o.hard ?? false })
  }
  return extra.length > 0 ? [...seed, ...extra] : seed
}

/**
 * Canonicalise a raw `properties` bag for a (trade, category) on WRITE, so the
 * catalogue side and the customer-capture side normalise through the SAME
 * grammar ("15 amp" and "15A" land identically — the brittleness both the
 * spec-as-data and failsafe designs flagged). Only the registry's keys are
 * canonicalised; unknown keys pass through untouched; an unparseable value is
 * KEPT raw (we never drop a tradie's data). Pure — call it from any catalogue
 * write path (create/edit/import) before persisting.
 */
export function canonicaliseProperties(
  properties: Record<string, unknown> | null | undefined,
  trade: string | null | undefined,
  category: string | null | undefined,
): Record<string, unknown> {
  if (!properties || typeof properties !== 'object') return {}
  const defKeys = new Set(getSpecDefs(trade, category).map((d) => d.key.toLowerCase()))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(properties)) {
    if (defKeys.has(k.toLowerCase()) && v !== null && v !== undefined && String(v).trim() !== '') {
      const canon = canonicalise(k, v as string | number)
      out[k] = canon !== null ? canon : v
    } else {
      out[k] = v
    }
  }
  return out
}
