// ════════════════════════════════════════════════════════════════════
// Roofing — measurement provider interface.
//
// Every adapter (Geoscape today, real LiDAR tomorrow, manual entry as
// the fallback) implements this contract so the orchestrator can swap
// the backend without touching the API route or the UI.
//
// PURE types — no I/O. Adapter implementations do I/O via their own
// fetch path (which is fully unit-testable via dependency injection).
// ════════════════════════════════════════════════════════════════════

import type {
  RoofAddressInput,
  RoofingMeasurementResult,
} from '../types'

export interface RoofingMeasurementProvider {
  /** Stable provider name — surfaces in tracing + the result envelope. */
  readonly name: 'geoscape' | 'lidar' | 'mock' | 'manual'
  /**
   * Measure the roof at the given address. Returns a discriminated
   * union — { ok: true, metrics } or { ok: false, code, detail }.
   * MUST NOT throw on operational failure; only programmer errors
   * (missing env, malformed inputs) may throw.
   */
  measure(input: RoofAddressInput): Promise<RoofingMeasurementResult>
}
