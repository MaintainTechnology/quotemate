// Dashboard-safe projection for the roof-topology evidence preview.
//
// This module deliberately accepts unknown persisted measurement JSON and
// returns only the small structure projection the authenticated dashboard
// needs to select a main dwelling. It never exposes a quote, price, public
// capability token, provider asset, or source-approval record.

import type { RoofForm } from './types'

const ROOF_FORMS: readonly RoofForm[] = [
  'gable',
  'hip',
  'skillion',
  'gable_hip',
  'complex',
  'unknown',
]

const MAX_PREVIEW_STRUCTURES = 50
const SAFE_OPAQUE_BUILDING_ID = /^[A-Za-z0-9][A-Za-z0-9._:#-]{0,127}$/
// Intentionally excludes URL-bearing characters such as `:`, `/`, `.`, `?`,
// and `@`. A malformed label is replaced with a generated local label rather
// than partially cleaned and echoed.
const SAFE_DISPLAY_LABEL = /^[A-Za-z0-9][A-Za-z0-9 &'(),#-]{0,79}$/
const SAFE_ADDRESS = /^[A-Za-z0-9][A-Za-z0-9 &'(),#/-]{0,159}$/
const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const AU_POSTCODE = /^\d{4}$/
const AU_STATES = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'])

/**
 * The allowlists below are the primary boundary. These guards make common
 * credential formats explicit as defense in depth, so a secret-shaped value
 * can neither enable selection nor become a display label.
 */
const SENSITIVE_VALUE = /^(?:AIza|sk_(?:live|test)_|rk_|pk_|ghp_|github_pat_|xox[baprs]-|AKIA|ASIA|ya29\.|eyJ[A-Za-z0-9_-]{10,}\.)|(?:^|[-_])(api[-_]?key|secret|token|password|credential|bearer)(?:[-_]|$)/i

export type TopologyPreviewStructure = {
  structureIndex: number
  /**
   * The preview deliberately does not return a persisted/provider building ID.
   * A future source-acquisition flow must resolve the selected structure on the
   * server, rather than treating this dashboard response as an identifier.
   */
  hasBuildingId: boolean
  label: string
  role: 'primary' | 'secondary'
  form: RoofForm
  footprintM2: number | null
  captureDate: string | null
}

export type TopologyPreviewGate =
  | 'feature_disabled'
  | 'source_setup_required'
  | 'source_approval_required'
  | 'source_approval_expired'
  | 'source_approval_recorded'

export type RoofTopologyPreviewResponse = {
  ok: true
  measurement: {
    id: string
    address: string | null
    postcode: string | null
    state: string | null
    createdAt: string | null
    structures: TopologyPreviewStructure[]
  }
  topology: {
    gate: TopologyPreviewGate
    fixturePreview: true
    disclaimer: string
  }
}

export type TopologyPreviewLocation = {
  address: string | null
  postcode: string | null
  state: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function finiteNonNegativeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function roofFormOrUnknown(value: unknown): RoofForm {
  return typeof value === 'string' && (ROOF_FORMS as readonly string[]).includes(value)
    ? (value as RoofForm)
    : 'unknown'
}

function isSafeOpaqueBuildingId(value: unknown): boolean {
  const candidate = nonEmptyString(value)
  return candidate !== null &&
    SAFE_OPAQUE_BUILDING_ID.test(candidate) &&
    !SENSITIVE_VALUE.test(candidate)
}

function safeDisplayLabel(value: unknown): string | null {
  const candidate = nonEmptyString(value)
  return candidate !== null &&
    SAFE_DISPLAY_LABEL.test(candidate) &&
    !SENSITIVE_VALUE.test(candidate)
    ? candidate
    : null
}

function safeAddress(value: unknown): string | null {
  const candidate = nonEmptyString(value)?.trim() ?? null
  return candidate !== null &&
    SAFE_ADDRESS.test(candidate) &&
    !candidate.startsWith('//') &&
    !SENSITIVE_VALUE.test(candidate)
    ? candidate
    : null
}

/**
 * Project persisted location text into the same no-URL/no-secret browser
 * boundary as the structure preview. Invalid values are omitted rather than
 * partially cleaned and echoed.
 */
export function topologyPreviewLocation(input: {
  address: unknown
  postcode: unknown
  state: unknown
}): TopologyPreviewLocation {
  const postcode = nonEmptyString(input.postcode)?.trim()
  const state = nonEmptyString(input.state)?.trim().toUpperCase()
  return {
    address: safeAddress(input.address),
    postcode: postcode !== undefined && postcode !== null && AU_POSTCODE.test(postcode)
      ? postcode
      : null,
    state: state !== undefined && state !== null && AU_STATES.has(state)
      ? state
      : null,
  }
}

function isoCalendarDateOrNull(value: unknown): string | null {
  const candidate = nonEmptyString(value)
  const match = candidate?.match(CALENDAR_DATE)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || year > 2100) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? candidate
    : null
}

/**
 * Project a saved MultiRoofQuote-like value into tenant-safe structure choices.
 * Legacy or malformed rows return an empty list rather than guessing a dwelling.
 */
export function topologyPreviewStructures(quote: unknown): TopologyPreviewStructure[] {
  const quoteRecord = asRecord(quote)
  const rawStructures = quoteRecord?.structures
  if (!Array.isArray(rawStructures)) return []

  const structures: TopologyPreviewStructure[] = []

  for (let index = 0; index < Math.min(rawStructures.length, MAX_PREVIEW_STRUCTURES); index += 1) {
    const raw = rawStructures[index]
    const structure = asRecord(raw)
    const metrics = asRecord(structure?.metrics)
    if (!structure || !metrics) continue

    const role = structure.role === 'primary' ? 'primary' : 'secondary'
    const hasBuildingId = isSafeOpaqueBuildingId(structure.buildingId) ||
      isSafeOpaqueBuildingId(metrics.buildingId)
    const label = safeDisplayLabel(structure.label) ??
      (role === 'primary' ? 'Main dwelling' : `Secondary structure ${index + 1}`)

    structures.push({
      structureIndex: index + 1,
      hasBuildingId,
      label,
      role,
      form: roofFormOrUnknown(metrics.form),
      footprintM2: finiteNonNegativeOrNull(metrics.footprint_m2),
      captureDate: isoCalendarDateOrNull(metrics.capture_date),
    })
  }

  return structures
}

/** A synthetic evidence preview is never a property analysis or a price input. */
export const TOPOLOGY_PREVIEW_DISCLAIMER =
  'Candidate evidence preview only — not survey-grade and never used in pricing, customer pages, or PDFs.'
