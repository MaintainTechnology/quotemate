export interface QuoteCoreScopeSnapshot {
  trade: string
  job_type: string | null
  scope: Record<string, unknown> | null
  property: Record<string, unknown> | null
  confidence: string | null
  inspection_required: boolean | null
  address: string | null
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  return value ?? null
}

/** Copy pricing, job-location and safety inputs; omit caller phone/email. */
export function captureQuoteCoreScope(intake: unknown): QuoteCoreScopeSnapshot | null {
  if (!intake || typeof intake !== 'object' || Array.isArray(intake)) return null
  const input = intake as Record<string, unknown>
  if (typeof input.trade !== 'string' || !input.trade.trim() ||
      (input.job_type != null && typeof input.job_type !== 'string') ||
      (input.scope != null && (typeof input.scope !== 'object' || Array.isArray(input.scope))) ||
      (input.property != null && (typeof input.property !== 'object' || Array.isArray(input.property))) ||
      (input.confidence != null && typeof input.confidence !== 'string') ||
      (input.inspection_required != null && typeof input.inspection_required !== 'boolean') ||
      (input.address != null && typeof input.address !== 'string')) return null
  try {
    return JSON.parse(JSON.stringify(canonical({
      trade: input.trade, job_type: input.job_type ?? null, scope: input.scope ?? null,
      property: input.property ?? null, confidence: input.confidence ?? null,
      inspection_required: input.inspection_required ?? null, address: input.address ?? null,
    }))) as QuoteCoreScopeSnapshot
  } catch { return null }
}

export function quoteCoreScopeMatches(left: unknown, right: unknown): boolean {
  if (!left || !right) return false
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}
