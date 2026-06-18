// Shared/custom service name-collision LABELLING for the Services tab (R40).
//
// A tradie can disable a SHARED catalogue service and then create a CUSTOM
// service with the SAME name (the DB unique index only guards same-table
// dupes). The flat Services list then shows two rows with identical names and
// no way to tell which is which — ambiguous and dangerous (the tradie might
// toggle the wrong one).
//
// The cross-table collision DETECTION already lives in ./service-delta.ts
// (annotateNameCollisions), which the /api/tenant/me GET runs so every service
// row carries a `name_collision` boolean. This module is the DISPLAY layer:
// given a (already-annotated) service row, it produces an unambiguous source
// label + a stable disambiguation suffix the UI appends so the two colliding
// rows read differently. It also re-exports the resolver so a client that
// holds un-annotated rows (optimistic create before re-fetch) can annotate
// locally and stay consistent with the server.
//
// Pure: no fetch/React/DB. Unit-tested in name-collision.test.ts.

export {
  annotateNameCollisions,
  normalizeServiceName,
  type CollisionService,
} from '@/lib/dashboard/service-delta'

/** A service row after collision annotation (the GET shape, narrowed). */
export type AnnotatedService = {
  assembly_id: string
  name: string
  trade: string
  is_custom: boolean
  name_collision: boolean
}

/** Which source a row comes from, for the disambiguation badge. */
export type ServiceSource = 'custom' | 'catalogue'

export function serviceSource(svc: { is_custom: boolean }): ServiceSource {
  return svc.is_custom ? 'custom' : 'catalogue'
}

/** Short uppercase tag the UI shows on EVERY row that has a collision, so the
 *  two same-named rows are visually distinct. Returns null when there is no
 *  collision (no badge needed). Custom → "YOUR CUSTOM"; shared → "CATALOGUE". */
export function collisionTag(svc: AnnotatedService): string | null {
  if (!svc.name_collision) return null
  return svc.is_custom ? 'YOUR CUSTOM' : 'CATALOGUE'
}

/** A precise tooltip explaining the collision so the tradie understands why
 *  two rows share a name and what to do. Null when there's no collision. */
export function collisionHint(svc: AnnotatedService): string | null {
  if (!svc.name_collision) return null
  return svc.is_custom
    ? 'A standard catalogue service has this same name. This is YOUR custom version — the AI prices it from your custom recipe. Rename it to avoid confusion.'
    : 'You also created a custom service with this name. This is the STANDARD catalogue version. Your custom one is listed separately.'
}

/**
 * Build a render-ready view-model for a row: its display name (unchanged), the
 * disambiguation tag, the source, and the hint. Keeps the JSX dumb — it just
 * reads these fields. Returns the same fields for non-colliding rows with
 * tag/hint = null so the caller has one code path.
 */
export type CollisionView = {
  source: ServiceSource
  collides: boolean
  tag: string | null
  hint: string | null
}

export function collisionView(svc: AnnotatedService): CollisionView {
  return {
    source: serviceSource(svc),
    collides: !!svc.name_collision,
    tag: collisionTag(svc),
    hint: collisionHint(svc),
  }
}
