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
): SharedAssemblyScopeRow[] {
  const offeringMap = new Map<string, boolean>(
    offerings
      .filter((o): o is { assembly_id: string; enabled: boolean | null } => !!o.assembly_id)
      .map((o) => [o.assembly_id, o.enabled ?? false]),
  )

  return rows.filter((row) => {
    const enabled = offeringMap.has(row.id)
      ? (offeringMap.get(row.id) as boolean)
      : row.default_enabled ?? true

    return enabled && !isHardcodedEasyAssembly(row)
  })
}
