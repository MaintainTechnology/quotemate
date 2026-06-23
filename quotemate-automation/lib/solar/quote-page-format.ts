// c:/Users/dalig/Downloads/QuoteMax/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/quote-page-format.ts
// Pure display formatters for the /q/solar/[token] customer page.
// No I/O, no React — fully unit-testable. Mirrors the roofing page's
// inline `money()` helper but centralised so every solar number rounds
// identically (whole-dollar prices, whole-kWh production, 1-dp kW).

/** Whole-dollar AUD, thousands-separated, no decimals. '0' on bad input. */
export function money(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-AU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/** Whole-kWh annual production, thousands-separated. '0' on bad input. */
export function kwh(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return Math.round(n).toLocaleString('en-AU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/** System size in kW to exactly one decimal place. '0.0' on bad input. */
export function kw(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0.0'
  return n.toFixed(1)
}

/** Banded payback "low–high yrs"; collapses when equal; '—' on bad input. */
export function paybackBand(
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  if (
    typeof low !== 'number' ||
    typeof high !== 'number' ||
    !Number.isFinite(low) ||
    !Number.isFinite(high)
  ) {
    return '—'
  }
  if (low === high) return `${low.toFixed(1)} yrs`
  return `${low.toFixed(1)}–${high.toFixed(1)} yrs`
}

/** A 0–1 fraction as a whole-number percentage, e.g. 0.4 → '40%'. */
export function pct(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%'
  return `${Math.round(fraction * 100)}%`
}

/** A $/kWh rate to two decimals, e.g. 0.32 → '$0.32/kWh'. */
export function perKwh(rate: number): string {
  if (!Number.isFinite(rate)) return '$0.00/kWh'
  return `$${rate.toFixed(2)}/kWh`
}
