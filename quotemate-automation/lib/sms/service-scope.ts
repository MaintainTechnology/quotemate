export type SharedAssemblyScopeRow = {
  id: string
  name: string
  description?: string | null
  default_enabled?: boolean | null
  category?: string | null
  clarifying_questions?: unknown
}

export type ServiceOfferingScopeRow = {
  assembly_id: string | null
  enabled: boolean | null
}

const CORE_EASY_CATEGORIES = new Set([
  'downlight',
  'gpo',
  'fan',
  'smoke_alarm',
  'outdoor_light',
  'drain',
  'hot_water',
  'tap',
  'toilet',
])

function hasClarifyingQuestions(value: unknown): boolean {
  return Array.isArray(value)
    && value.some((q) => typeof q === 'string' && q.trim().length > 0)
}

export function isHardcodedEasyAssembly(row: SharedAssemblyScopeRow): boolean {
  return (
    row.default_enabled === true
    && !hasClarifyingQuestions(row.clarifying_questions)
    && CORE_EASY_CATEGORIES.has(String(row.category ?? '').trim())
  )
}

export function resolveEnabledSharedAssembliesForDialog(
  rows: ReadonlyArray<SharedAssemblyScopeRow>,
  offerings: ReadonlyArray<ServiceOfferingScopeRow>,
  options: { assumeAllEnabled?: boolean } = {},
): SharedAssemblyScopeRow[] {
  const offeringMap = new Map<string, boolean>(
    offerings
      .filter((o): o is { assembly_id: string; enabled: boolean | null } => !!o.assembly_id)
      .map((o) => [o.assembly_id, o.enabled ?? false]),
  )

  return rows.filter((row) => {
    // No-tenant fallback path (assumeAllEnabled=true): treat every row as
    // enabled regardless of default_enabled. This is the dev shared SMS
    // number or any traffic where the destination number doesn't map to a
    // tenant. Without it, the dialog declines every migration-021 extra
    // (LED strip, security camera, doorbell, garbage disposal, rainwater
    // tank, water filter) as out_of_scope because it never sees them in
    // its in-scope list. Real tenants still gate via tenant_service_offerings.
    const enabled = options.assumeAllEnabled
      ? true
      : offeringMap.has(row.id)
        ? (offeringMap.get(row.id) as boolean)
        : row.default_enabled ?? true

    return enabled && !isHardcodedEasyAssembly(row)
  })
}
