// Phase 1 headline gate — every electrical job_type must resolve to exactly
// one assembly, and to the one whose recipe we can actually use.
//
// Today only 2 of 10 resolve at all (`ev_charger`, `fault_finding`), because
// run.ts matches `job_type.replace(/_/g,' ')` as a substring against assembly
// NAMES and every other job type is plural or worded differently. Seven seeded
// recipes are therefore unreachable.
//
// Resolution is an explicit map, NOT an inferred score. Verified against every
// seeded row: a name/category heuristic cannot pick correctly here. `downlights`
// matches both `Install LED downlight` (no BOM) and its new-install variant
// (has the BOM), while `smoke_alarms` has that asymmetry reversed — so any
// "prefer the base row" rule silently loses the recipe on the headline job.
//
// Pure — no DB, no mocks. Fixture is the 26 electrical rows seeded across
// sql/init.sql + migrations 005/021/069/074, with categories as they stand
// after the 029/036/037 updates.

import { describe, it, expect } from 'vitest'
import { pickBestAssembly, JOB_TYPE_ASSEMBLY } from './assembly-search'

type Row = { id: string; name: string; category: string | null; hasBom?: boolean }

// Byte-exact names. `Supply + install AC ceiling fan` has a literal '+';
// `Diagnostic call-out (fault finding)` has category 'fault_find', not
// 'fault_finding'.
const SEEDED: Row[] = [
  { id: 'a01', name: 'Install LED downlight', category: 'downlight' },
  { id: 'a02', name: 'Replace double GPO', category: 'gpo', hasBom: true },
  { id: 'a03', name: 'Install customer-supplied ceiling fan', category: 'fan' },
  { id: 'a04', name: 'Hardwire 240V smoke alarm', category: 'smoke_alarm', hasBom: true },
  { id: 'a05', name: 'Install outdoor IP-rated LED light', category: 'outdoor_light', hasBom: true },
  { id: 'a06', name: 'Install oven (existing wiring)', category: 'oven_cooktop', hasBom: true },
  { id: 'a07', name: 'Install cooktop (existing wiring)', category: 'oven_cooktop', hasBom: true },
  { id: 'a08', name: 'Diagnostic call-out (fault finding)', category: 'fault_find', hasBom: true },
  { id: 'a09', name: 'Supply + install AC ceiling fan', category: 'fan', hasBom: true },
  { id: 'a10', name: 'Install premium DC fan with wall control', category: 'fan', hasBom: true },
  { id: 'a11', name: 'Install aircon power point', category: 'gpo' },
  { id: 'a12', name: 'Install EV charger', category: 'ev_charger' },
  { id: 'a13', name: 'Hardwire oven', category: 'oven_cooktop' },
  { id: 'a14', name: 'Hardwire induction cooktop', category: 'oven_cooktop' },
  { id: 'a15', name: 'Install bathroom exhaust fan', category: 'fan' },
  { id: 'a16', name: 'Install outdoor IP-rated GPO', category: 'gpo' },
  { id: 'a17', name: 'Install LED strip lighting', category: 'strip_light' },
  { id: 'a18', name: 'Install wired doorbell or intercom', category: 'doorbell_intercom' },
  { id: 'a19', name: 'Install security camera (single)', category: 'security_camera' },
  { id: 'a20', name: 'Install motion sensor flood light', category: 'outdoor_light' },
  {
    id: 'a21',
    name: 'Install LED downlight (new install, single-storey)',
    category: 'downlight',
    hasBom: true,
  },
  {
    id: 'a22',
    name: 'Hardwire 240V smoke alarm (whole-house compliance install)',
    category: 'smoke_alarm',
  },
  {
    id: 'a23',
    name: 'Install outdoor light (new circuit from indoor power)',
    category: 'outdoor_light',
  },
  { id: 'a24', name: 'Install ceiling fan (new wiring, no existing rose)', category: 'fan' },
  { id: 'a25', name: 'Install 20A dedicated GPO', category: 'gpo', hasBom: true },
  { id: 'a26', name: 'Install 32A three-phase outlet', category: 'gpo' },
]

// The winner for each of the 10 electrical job_type enum values.
const EXPECTED: Record<string, string | null> = {
  downlights: 'Install LED downlight (new install, single-storey)',
  power_points: 'Replace double GPO',
  ceiling_fans: 'Supply + install AC ceiling fan',
  smoke_alarms: 'Hardwire 240V smoke alarm',
  outdoor_lighting: 'Install outdoor IP-rated LED light',
  oven_cooktop: 'Install oven (existing wiring)',
  ev_charger: 'Install EV charger',
  fault_finding: 'Diagnostic call-out (fault finding)',
  switchboard: null,
  renovation: null,
}

describe('Phase 1 — job_type resolves to exactly one assembly', () => {
  for (const [jobType, expected] of Object.entries(EXPECTED)) {
    it(`${jobType} → ${expected ?? 'null (inspection route)'}`, () => {
      const won = pickBestAssembly(jobType, SEEDED)
      expect(won?.name ?? null).toBe(expected)
    })
  }

  it('never depends on candidate row order', () => {
    const reversed = [...SEEDED].reverse()
    for (const [jobType, expected] of Object.entries(EXPECTED)) {
      expect(pickBestAssembly(jobType, reversed)?.name ?? null, jobType).toBe(expected)
    }
  })

  it('resolves to a recipe-bearing row wherever one exists', () => {
    // The whole point of the phase: reaching an assembly that has a BOM.
    // ev_charger is the known exception until Phase 2 seeds its recipe.
    const noRecipeYet = new Set(['ev_charger'])
    for (const [jobType, expected] of Object.entries(EXPECTED)) {
      if (!expected || noRecipeYet.has(jobType)) continue
      const row = SEEDED.find((r) => r.name === expected)
      expect(row?.hasBom, `${jobType} resolved to a row with no recipe`).toBe(true)
    }
  })

  it('returns null for a job type with no assembly rather than guessing', () => {
    expect(pickBestAssembly('switchboard', SEEDED)).toBeNull()
    expect(pickBestAssembly('renovation', SEEDED)).toBeNull()
    expect(pickBestAssembly('other', SEEDED)).toBeNull()
    expect(pickBestAssembly('', SEEDED)).toBeNull()
  })

  it('returns null when the mapped assembly is absent from the candidates', () => {
    // A renamed or unseeded row must fail closed, not fall through to a
    // near-miss — a wrong recipe is worse than no recipe.
    const without = SEEDED.filter((r) => r.name !== 'Replace double GPO')
    expect(pickBestAssembly('power_points', without)).toBeNull()
  })

  it('maps only job types that have a real assembly', () => {
    // SEEDED is the ELECTRICAL fixture. Step 2 added plumbing entries to the
    // same map, so scope this assertion to the electrical keys — the plumbing
    // names are checked against the plumbing fixture in
    // plumbing-assembly-resolve.test.ts. Widening SEEDED instead would make
    // one fixture claim to be two trades' catalogues.
    const ELECTRICAL_KEYS = [
      'downlights', 'power_points', 'ceiling_fans', 'smoke_alarms',
      'outdoor_lighting', 'oven_cooktop', 'ev_charger', 'fault_finding',
    ]
    for (const key of ELECTRICAL_KEYS) {
      const name = JOB_TYPE_ASSEMBLY[key]
      expect(name, `electrical key lost from the map: ${key}`).toBeTruthy()
      expect(
        SEEDED.some((r) => r.name === name),
        `mapped to a name that is not seeded: ${name}`,
      ).toBe(true)
    }
    expect(JOB_TYPE_ASSEMBLY.switchboard).toBeUndefined()
    expect(JOB_TYPE_ASSEMBLY.renovation).toBeUndefined()
  })
})
