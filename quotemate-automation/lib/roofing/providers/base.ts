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
  RoofingMultiMeasurementResult,
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
  /**
   * Optional — measure EVERY structure at the address (primary dwelling
   * + detached sheds/garages). Providers that can't enumerate buildings
   * omit this; the orchestrator falls back to wrapping measure() into a
   * single-building result. Same throw/no-throw contract as measure().
   */
  measureAll?(input: RoofAddressInput): Promise<RoofingMultiMeasurementResult>
}
