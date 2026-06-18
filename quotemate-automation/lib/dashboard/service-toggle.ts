// CLIENT-side pure helpers for the Services-tab toggle (R36).
//
// The route-side delta planner lives in ./service-delta.ts (owned by the
// /api/tenant/me route). THIS module is the dashboard CLIENT counterpart:
//   • build the PER-SERVICE PATCH payload (never the whole services dict), and
//   • reconcile the optimistic-pending map against the server outcome WITHOUT
//     clobbering toggles for OTHER rows that may be in flight concurrently.
//
// Why a delta + per-row reconcile fixes the bug:
//   The legacy toggle sent `{ services: { [id]: val } }` and then did a FULL
//   dashboard re-fetch that replaced ALL state. Two quick toggles on different
//   rows (or two tabs) could race: tab A's in-flight optimistic value for row X
//   was dropped when tab B's re-fetch landed with a stale row-X value, or a
//   global `busy` guard silently swallowed the second click. Sending a delta
//   that names exactly ONE row, and clearing ONLY that row's pending entry on
//   success, means an unrelated in-flight toggle is never touched.
//
// All pure: no fetch, no React, no DB. Unit-tested in service-toggle.test.ts.

/** The minimal service fields the toggle path reads. Mirrors the unified
 *  Service[] the dashboard renders — `is_custom` selects which table the
 *  route writes to (shared → tenant_service_offerings, custom →
 *  tenant_custom_assemblies). */
export type ToggleableService = {
  assembly_id: string
  enabled: boolean
  is_custom: boolean
}

/** The PATCH body for a single-row toggle. `service_delta` is the R36
 *  contract the /api/tenant/me route accepts (single entry or array). We
 *  always send the single-entry form from the client so each toggle is an
 *  independent, minimal write. */
export type ServiceTogglePayload = {
  service_delta: { assembly_id: string; enabled: boolean; is_custom: boolean }
}

/** Optimistic per-row override map: assembly_id → the value the user just
 *  flipped to, pending server confirmation. Absent key = "use the row's
 *  server `enabled`". */
export type PendingMap = Record<string, boolean>

/**
 * The value to SHOW for a row right now: the optimistic override when one is
 * pending, otherwise the row's server value. Centralises the "pending wins"
 * rule so the live value, the toggle target, and the badge all agree.
 */
export function liveEnabled(pending: PendingMap, assemblyId: string, serverEnabled: boolean): boolean {
  return Object.prototype.hasOwnProperty.call(pending, assemblyId)
    ? pending[assemblyId]
    : serverEnabled
}

/**
 * Compute the next enabled value for a row given the CURRENT live value
 * (which already accounts for any pending optimistic override). Pure flip —
 * extracted so the click handler never re-derives the live value inline and
 * accidentally toggles off the stale server value.
 */
export function nextEnabledFor(pending: PendingMap, svc: ToggleableService): boolean {
  return !liveEnabled(pending, svc.assembly_id, svc.enabled)
}

/**
 * Build the minimal per-service PATCH payload. We send the delta — NOT a
 * `{ services: {...} }` dict — so the route only ever upserts this one row and
 * a concurrent tab's unrelated rows are never clobbered.
 */
export function buildServiceTogglePayload(
  svc: ToggleableService,
  nextEnabled: boolean,
): ServiceTogglePayload {
  return {
    service_delta: {
      assembly_id: svc.assembly_id,
      enabled: nextEnabled,
      is_custom: !!svc.is_custom,
    },
  }
}

/**
 * Apply an optimistic flip for ONE row, returning a NEW pending map. Other
 * rows' pending entries are preserved untouched (the anti-clobber guarantee).
 */
export function applyOptimistic(
  pending: PendingMap,
  assemblyId: string,
  nextEnabled: boolean,
): PendingMap {
  return { ...pending, [assemblyId]: nextEnabled }
}

/**
 * Reconcile ONE row's pending entry after the PATCH settled.
 *
 *  • On SUCCESS we drop the row's pending key. The dashboard then reads the
 *    row's server `enabled`, which the caller's subsequent re-fetch refreshes.
 *    The route does NOT echo the applied value, so "success ⇒ the value we
 *    sent is authoritative until the re-fetch lands" — dropping the key (rather
 *    than asserting the optimistic value forever) keeps a single source of
 *    truth once fresh server data arrives.
 *  • On FAILURE we ALSO drop the row's pending key, which reverts the row to
 *    its last server value — the user sees the flip undo.
 *
 *  In BOTH cases we only ever delete THIS row's key; any other row's in-flight
 *  optimistic value is left intact. That is the core R36 fix: a settled toggle
 *  for row X can never erase an unsettled toggle for row Y.
 */
export function reconcilePending(pending: PendingMap, assemblyId: string): PendingMap {
  if (!Object.prototype.hasOwnProperty.call(pending, assemblyId)) return pending
  const next = { ...pending }
  delete next[assemblyId]
  return next
}

/**
 * Optional echo reconcile — if a future route revision DOES echo the applied
 * value (`{ ok, service_delta: { assembly_id, enabled } }`), prefer that exact
 * value over the optimistic one before the re-fetch lands. Degrades to
 * reconcilePending when no echo is present. Forward-compatible; the current
 * route returns `{ ok: true }` only, so this is a no-op today.
 */
export function reconcileFromServer(
  pending: PendingMap,
  assemblyId: string,
  echoed: { assembly_id?: string; enabled?: boolean } | null | undefined,
): PendingMap {
  if (echoed && echoed.assembly_id === assemblyId && typeof echoed.enabled === 'boolean') {
    // Keep the row's pending entry pinned to the server-confirmed value so the
    // switch shows the truth even if the caller defers its full re-fetch.
    return { ...pending, [assemblyId]: echoed.enabled }
  }
  return reconcilePending(pending, assemblyId)
}
