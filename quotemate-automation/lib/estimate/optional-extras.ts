/** Customer optional extras must be compared with the option being shown.
 * A quote-wide union of tier inclusions would hide a real upgrade from Good
 * merely because that upgrade is already part of Best. */
type OptionalUpsell = { name?: unknown; description?: unknown }
type SelectedTier = { line_items?: readonly unknown[] }
export type OptionalExtrasAssembly = {
  id: string
  name?: unknown
  description?: unknown
  inclusions?: unknown
  default_inclusions?: unknown
}

type UpsellKind = 'rcbo' | 'switchboard_health' | 'compliance_certificate'

function normalise(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim() : ''
}

/** Only the generic extras offered by the electrical estimator. A separate
 * location/circuit or a named product is not silently collapsed into these. */
export function optionalUpsellKind(value: unknown): UpsellKind | null {
  const text = normalise(value)
  if (/^(?:add\s+)?(?:rcbo safety switch|rcbo)(?:\s+upgrade)?[.!]?$/.test(text)) return 'rcbo'
  if (/^switchboard health check(?:\s*(?:and|&|\/)\s*load assessment)?[.!]?$/.test(text)) return 'switchboard_health'
  if (/^(?:per-property\s+)?(?:electrical\s+)?compliance certificate[.!]?$/.test(text)) return 'compliance_certificate'
  return null
}

function texts(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[\n;]+/).map(normalise).filter(Boolean)
  if (Array.isArray(value)) return value.flatMap(texts)
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return texts(row.description ?? row.name ?? row.label ?? row.text)
  }
  return []
}

function includedKinds(value: unknown): UpsellKind[] {
  const found = new Set<UpsellKind>()
  for (const text of texts(value)) {
    // Descriptive catalogue text can mention an excluded, optional or
    // unverified item. Such a mention is not evidence that it is included.
    if (/\b(?:exclud\w*|not included|optional|if required|if needed|subject to|pending|without)\b/.test(text)) continue
    if (/\brcbo\b/.test(text)) found.add('rcbo')
    if (/\bswitchboard health check\b/.test(text)) found.add('switchboard_health')
    if (/\b(?:compliance certificate|certificate of (?:electrical )?compliance)\b/.test(text)) found.add('compliance_certificate')
  }
  return [...found]
}

export function filterIncludedOptionalUpsells<T extends OptionalUpsell>(
  upsells: readonly T[] | null | undefined,
  selectedTier: SelectedTier | null | undefined,
  assemblies: readonly OptionalExtrasAssembly[] = [],
): T[] {
  if (!Array.isArray(upsells)) return []
  const included = new Set<UpsellKind>()
  const descriptions = new Set<string>()
  const byId = new Map(assemblies.map((assembly) => [assembly.id, assembly]))
  for (const item of selectedTier?.line_items ?? []) {
    if (!item || typeof item !== 'object') continue
    const line = item as Record<string, unknown>
    if (!(Number(line.quantity) > 0)) continue
    descriptions.add(normalise(line.description))
    for (const kind of includedKinds(line.description)) included.add(kind)
    const ref = String(line.source ?? '').match(/^assembly:([^\s:]+)$/)
    const assembly = ref ? byId.get(ref[1]) : undefined
    if (assembly) {
      for (const kind of includedKinds([
        assembly.name, assembly.description, assembly.default_inclusions, assembly.inclusions,
      ])) included.add(kind)
    }
  }
  return upsells.filter((upsell) => {
    const name = normalise(upsell?.name ?? upsell?.description)
    if (!name) return false
    if (descriptions.has(name)) return false
    const kind = optionalUpsellKind(name)
    return !kind || !included.has(kind)
  })
}

/** Keep pipeline diagnostics available internally, but never print them in
 * a customer risk section. Bracket prefixes are the estimator's diagnostic
 * convention; machine-readable snake_case reasons are also internal. */
export function customerVisibleRiskFlags(flags: unknown): string[] {
  if (!Array.isArray(flags)) return []
  return flags.flatMap((flag) => {
    const value = typeof flag === 'string'
      ? flag
      : flag && typeof flag === 'object' ? (flag as { description?: unknown }).description : null
    if (typeof value !== 'string') return []
    const text = value.trim()
    if (!text || /^\[[^\]]+\]/.test(text) || /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?:[:=]|$)/i.test(text)) return []
    return [text]
  })
}
