import { z } from 'zod'

/**
 * The customer's requested EV-charger service, kept separate from who owns
 * the charger unit. `supplied_by` is derived from this value for legacy
 * estimator consumers; it is not an independent source of truth.
 */
export const EV_SERVICE_MODES = [
  'supply_only',
  'install_only',
  'supply_and_install',
] as const

export const EvServiceModeSchema = z.enum(EV_SERVICE_MODES)

export type EvServiceMode = z.infer<typeof EvServiceModeSchema>
export type EvChargerServiceMode = EvServiceMode

const LEGACY_EV_SERVICE_MODES: Readonly<Record<string, EvServiceMode>> = {
  'supply only': 'supply_only',
  'charger supply only': 'supply_only',
  'unit supply only': 'supply_only',

  'install only': 'install_only',
  'installation only': 'install_only',
  'customer already has the charger': 'install_only',
  'customer has the charger': 'install_only',
  'customer supplied': 'install_only',
  'customer supplies': 'install_only',

  'supply and install': 'supply_and_install',
  'supply and installation': 'supply_and_install',
  'we supply the charger': 'supply_and_install',
  'tradie supplies the charger': 'supply_and_install',
}

/**
 * Accept the canonical values plus the exact human-readable values emitted by
 * older dashboard/SMS flows. Ambiguous answers such as "not sure" deliberately
 * remain unresolved so callers can ask rather than infer a binding scope.
 */
export function normaliseEvServiceMode(value: unknown): EvServiceMode | undefined {
  if (typeof value !== 'string') return undefined

  const canonical = value.trim().toLowerCase()
  const parsed = EvServiceModeSchema.safeParse(canonical)
  if (parsed.success) return parsed.data

  const legacyKey = canonical
    .replace(/[_-]+/g, ' ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()

  return LEGACY_EV_SERVICE_MODES[legacyKey]
}

/** Resolve canonical or legacy fields in precedence order. */
export function resolveEvChargerServiceMode(
  input:
    | { service_mode?: unknown; charger_supply?: unknown; supplied_by?: unknown }
    | null
    | undefined,
): EvServiceMode | undefined {
  if (typeof input?.service_mode === 'string' && input.service_mode.trim() !== '') {
    // Once the canonical field is present it is authoritative. An invalid new
    // value must not fall through to stale legacy supplier metadata.
    return normaliseEvServiceMode(input.service_mode)
  }

  const legacy = normaliseEvServiceMode(input?.charger_supply)
  if (legacy) return legacy

  // A customer-owned unit proves installation-only in the legacy model. A
  // tradie-owned unit does NOT prove installation was requested: it may be a
  // supply-only sale, which is the ambiguity this canonical field removes.
  return input?.supplied_by === 'customer' ? 'install_only' : undefined
}

/** Read only an explicit canonical mode. Use this for release/readiness gates. */
export function strictEvChargerServiceModeFromIntake(
  intake:
    | { scope?: unknown }
    | null
    | undefined,
): EvServiceMode | undefined {
  const scope = asRecord(intake?.scope)
  const specs = asRecord(scope?.specs)
  const parsed = EvServiceModeSchema.safeParse(specs?.service_mode)
  return parsed.success ? parsed.data : undefined
}

/**
 * Read canonical mode with the one safe legacy inference: customer-owned unit
 * means installation-only. Tradie-owned alone deliberately remains unknown.
 */
export function evChargerServiceModeFromIntake(
  intake:
    | { scope?: unknown }
    | null
    | undefined,
): EvServiceMode | undefined {
  const scope = asRecord(intake?.scope)
  return resolveEvChargerServiceMode(asRecord(scope?.specs))
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function suppliedByForEvServiceMode(
  mode: EvServiceMode,
): 'tradie' | 'customer' {
  return mode === 'install_only' ? 'customer' : 'tradie'
}

export function isEvSupplyMode(
  mode: EvServiceMode | null | undefined,
): boolean {
  return mode === 'supply_only' || mode === 'supply_and_install'
}

export function isEvInstallationMode(
  mode: EvServiceMode | null | undefined,
): boolean {
  return mode === 'install_only' || mode === 'supply_and_install'
}

export function evServiceModeLabel(mode: EvServiceMode): string {
  switch (mode) {
    case 'supply_only':
      return 'Supply only'
    case 'install_only':
      return 'Installation only'
    case 'supply_and_install':
      return 'Supply and installation'
  }
}
