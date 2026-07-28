// Canonical job-type taxonomy for Historical Quotes.
//
// SINGLE SOURCE OF TRUTH: reuse the intake taxonomy (lib/intake/schema.ts) so a
// categorised historical quote always lines up with what intakes, shared
// assemblies and the estimator already use. Re-export the Zod enum so the
// categoriser can validate model output against the exact same value set.

import { IntakeSchema } from '@/lib/intake/schema'

export const JobTypeEnum = IntakeSchema.shape.job_type
export const TradeEnum = IntakeSchema.shape.trade

export const JOB_TYPES = JobTypeEnum.options
export const TRADES = TradeEnum.options

export type JobType = (typeof JOB_TYPES)[number]
export type Trade = (typeof TRADES)[number]

export function isJobType(v: unknown): v is JobType {
  return typeof v === 'string' && (JOB_TYPES as readonly string[]).includes(v)
}

const ELECTRICAL_JOB_TYPES = new Set<string>([
  'downlights',
  'power_points',
  'ceiling_fans',
  'smoke_alarms',
  'outdoor_lighting',
  'switchboard',
  'oven_cooktop',
  'ev_charger',
  'fault_finding',
  'renovation',
])
const PLUMBING_JOB_TYPES = new Set<string>([
  'blocked_drain',
  'hot_water',
  'tap_repair',
  'tap_replace',
  'toilet_repair',
  'toilet_replace',
  'gas_fitting',
  'burst_pipe',
  'bathroom_renovation',
  'cctv_inspection',
  'prv_install',
])

/** Map a job_type to its trade, or null for 'other' / unknown. */
export function tradeForJobType(jobType: string | null | undefined): Trade | null {
  if (!jobType) return null
  if (ELECTRICAL_JOB_TYPES.has(jobType)) return 'electrical'
  if (PLUMBING_JOB_TYPES.has(jobType)) return 'plumbing'
  return null
}

/** Trade acronyms that must not be sentence-cased — without these,
 *  'ev_charger' renders as "Ev charger" in every job-type dropdown. */
const ACRONYMS: Record<string, string> = {
  ev: 'EV',
  cctv: 'CCTV',
  prv: 'PRV',
  gpo: 'GPO',
  rcd: 'RCD',
}

/** Render a snake_case job_type as a human label ("blocked_drain" → "Blocked drain",
 *  "ev_charger" → "EV charger"). */
export function formatJobType(jobType: string | null | undefined): string {
  if (!jobType) return 'Unclassified'
  return jobType
    .split('_')
    .map((word, i) => {
      const acronym = ACRONYMS[word.toLowerCase()]
      if (acronym) return acronym
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
    })
    .join(' ')
}

/** job_type → a recognisable tenant_custom_assemblies.name for calibration.
 *  'other' is intentionally absent — it has no single assembly. */
export const JOB_TYPE_ASSEMBLY_NAME: Record<string, string> = {
  downlights: 'LED downlight — supply & install',
  power_points: 'Power point (GPO) — supply & install',
  ceiling_fans: 'Ceiling fan — supply & install',
  smoke_alarms: 'Smoke alarm — supply & install',
  outdoor_lighting: 'Outdoor light — supply & install',
  switchboard: 'Switchboard upgrade',
  oven_cooktop: 'Oven / cooktop connection',
  ev_charger: 'EV charger installation',
  fault_finding: 'Electrical fault finding',
  renovation: 'Electrical renovation works',
  blocked_drain: 'Blocked drain clearing',
  hot_water: 'Hot water system — supply & install',
  tap_repair: 'Tap repair',
  tap_replace: 'Tap replacement — supply & install',
  toilet_repair: 'Toilet repair',
  toilet_replace: 'Toilet replacement — supply & install',
  gas_fitting: 'Gas fitting works',
  burst_pipe: 'Burst pipe repair',
  bathroom_renovation: 'Bathroom renovation plumbing',
  cctv_inspection: 'CCTV drain inspection',
  prv_install: 'Pressure-reducing valve install',
}

export function assemblyNameForJobType(jobType: string): string | null {
  return JOB_TYPE_ASSEMBLY_NAME[jobType] ?? null
}
