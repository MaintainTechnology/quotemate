// ════════════════════════════════════════════════════════════════════
// Painting — property-data provider interface.
//
// Every adapter (mock + Google Solar today; Geoscape, Domain tomorrow)
// implements this contract so the orchestrator can swap the data backend
// without touching the API route or the UI. The estimate tool resolves an
// address via Google Solar (footprint → floor area), falling back to the
// deterministic mock when no key is set.
//
// PURE types — no I/O. Adapter implementations do their own fetch (fully
// unit-testable via dependency injection).
// ════════════════════════════════════════════════════════════════════

import type { PaintAddressInput, PropertyLookupResult } from '../types'

export interface PropertyDataProvider {
  /** Stable provider name — surfaces in tracing + the result envelope. */
  readonly name:
    | 'domain'
    | 'solar'
    | 'geoscape'
    | 'mock'
    | 'manual'
  /**
   * Look up structural facts for an address. Returns a discriminated
   * union — { ok: true, facts } or { ok: false, code, detail }. MUST NOT
   * throw on operational failure; only programmer errors (missing env,
   * malformed inputs) may throw.
   */
  lookup(input: PaintAddressInput): Promise<PropertyLookupResult>
}
