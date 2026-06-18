// Pure helpers for the /api/tenant/me service-toggle surface.
//
// Why this module exists:
//   • R36 — PATCH /api/tenant/me must accept a PER-SERVICE delta so two
//     concurrent dashboard tabs toggling different rows can't clobber each
//     other. The legacy full-dict path ({ services: {id:bool} }) re-sends a
//     whole snapshot of the tradie's in-memory list; a stale snapshot from
//     tab A can overwrite a row tab B just flipped. A delta names exactly the
//     row(s) that changed, so only those upsert.
//   • R40 — shared vs custom services live in DIFFERENT tables but share one
//     flat namespace in the dashboard. A tradie can create a custom service
//     whose name equals a DISABLED shared service, and nothing today flags
//     that the two collide. We surface a discriminator (NOT a hard reject) so
//     the UI can badge the duplicate — the safer option, because the row
//     already persisted and rejecting after-the-fact would orphan it.
//
// All pure: no DB, no fetch, no Supabase. The route normalises the request
// into these shapes, calls the planners, then issues the upserts. Easy to
// unit-test without mocking anything.

// ─────────────────────────────────────────────────────────────────────
// R36 — per-service delta normalisation + merge
// ─────────────────────────────────────────────────────────────────────

/** A single per-service toggle. `is_custom` selects which table the route
 *  writes to: false → tenant_service_offerings (shared), true →
 *  tenant_custom_assemblies (custom). Defaults to shared when omitted so the
 *  minimal `{ assembly_id, enabled }` form keeps working. */
export type ServiceDeltaEntry = {
  assembly_id: string
  enabled: boolean
  is_custom?: boolean
}

/** The PATCH `service_delta` field accepts a single entry OR an array of
 *  them. Both collapse to ServiceDeltaEntry[] via normalizeServiceDelta. */
export type ServiceDeltaInput = ServiceDeltaEntry | ServiceDeltaEntry[]

/** The two write plans the route executes. `shared` rows upsert into
 *  tenant_service_offerings; `custom` rows update tenant_custom_assemblies.
 *  Each is a map of assembly_id → enabled so a single planner output drops
 *  straight into the SAME upsert helpers the legacy full-dict path uses. */
export type ServiceWritePlan = {
  shared: Record<string, boolean>
  custom: Record<string, boolean>
}

/** Coerce the single-or-array `service_delta` field into a flat array. A
 *  non-array entry becomes a one-element array; an array is returned as-is.
 *  Invalid leaves (null / non-object) are dropped defensively so a partially
 *  malformed payload can't throw — the route has already Zod-validated the
 *  shape, but this stays safe if called directly. */
export function normalizeServiceDelta(input: ServiceDeltaInput): ServiceDeltaEntry[] {
  const arr = Array.isArray(input) ? input : [input]
  return arr.filter(
    (e): e is ServiceDeltaEntry =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as ServiceDeltaEntry).assembly_id === 'string' &&
      typeof (e as ServiceDeltaEntry).enabled === 'boolean',
  )
}

/** Split normalised delta entries into a shared/custom write plan.
 *
 *  Last-write-wins within a single request: if the same assembly_id appears
 *  twice with different `enabled` values, the LAST entry wins (the client
 *  shouldn't send that, but the merge must be deterministic). This is the
 *  per-row "merge" that makes the delta safe — each named row is written
 *  independently, so an unrelated row another tab owns is never touched. */
export function buildServiceWritePlan(entries: ServiceDeltaEntry[]): ServiceWritePlan {
  const plan: ServiceWritePlan = { shared: {}, custom: {} }
  for (const e of entries) {
    if (e.is_custom) plan.custom[e.assembly_id] = e.enabled
    else plan.shared[e.assembly_id] = e.enabled
  }
  return plan
}

/** Merge a delta plan into the legacy full-dict maps so the route has ONE
 *  code path for the actual DB writes. The legacy `{ services }` /
 *  `{ custom_services }` dicts (which may be undefined) are combined with the
 *  delta plan; the delta wins on key collisions because it is the more
 *  targeted, fresher signal. Returns the unified maps the route upserts. */
export function mergeWithLegacyDicts(
  plan: ServiceWritePlan,
  legacyShared: Record<string, boolean> | undefined,
  legacyCustom: Record<string, boolean> | undefined,
): { shared: Record<string, boolean>; custom: Record<string, boolean> } {
  return {
    shared: { ...(legacyShared ?? {}), ...plan.shared },
    custom: { ...(legacyCustom ?? {}), ...plan.custom },
  }
}

// ─────────────────────────────────────────────────────────────────────
// R40 — shared/custom name-collision discriminator
// ─────────────────────────────────────────────────────────────────────

/** Normalise a service name for collision comparison: trimmed, lowercased,
 *  internal whitespace collapsed. "  LED  Downlight " and "led downlight"
 *  collide. Empty / non-string names normalise to '' (never collide). */
export function normalizeServiceName(name: unknown): string {
  if (typeof name !== 'string') return ''
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Minimal service shape the collision pass needs — a subset of the unified
 *  Service[] the GET endpoint builds. */
export type CollisionService = {
  assembly_id: string
  name: string
  trade: string
  is_custom: boolean
}

/** Annotate each service with `name_collision`: TRUE when a CUSTOM service
 *  shares a normalised name with a SHARED service in the SAME trade (and vice
 *  versa). Same-table duplicates are NOT flagged here — the DB unique index on
 *  tenant_custom_assemblies(name) already prevents two customs with one name,
 *  and two shared rows with one name is a catalogue-seeding bug, not a tradie
 *  action. We only flag the cross-table case the UI must disambiguate.
 *
 *  Returns a NEW array of the same objects spread with `name_collision`;
 *  inputs are not mutated. Stable order preserved. */
export function annotateNameCollisions<T extends CollisionService>(
  services: T[],
): Array<T & { name_collision: boolean }> {
  // Build per-trade sets of normalised names, partitioned by table.
  const sharedNames = new Map<string, Set<string>>() // trade → names
  const customNames = new Map<string, Set<string>>()
  for (const s of services) {
    const key = normalizeServiceName(s.name)
    if (!key) continue
    const bucket = s.is_custom ? customNames : sharedNames
    const set = bucket.get(s.trade) ?? new Set<string>()
    set.add(key)
    bucket.set(s.trade, set)
  }
  return services.map((s) => {
    const key = normalizeServiceName(s.name)
    let collision = false
    if (key) {
      const other = s.is_custom ? sharedNames : customNames
      collision = other.get(s.trade)?.has(key) ?? false
    }
    return { ...s, name_collision: collision }
  })
}
