// Step 2 — plumbing job types resolve to an assembly.
//
// Phase 1 fixed "random materials" for ELECTRICAL only: all eight
// JOB_TYPE_ASSEMBLY entries are electrical job types, so every plumbing job
// returned null from pickBestAssembly, found no recipe, and got no parts hint.
// The recipe engine existed and one of the two labour trades could not reach it.
//
// hot_water is the interesting one: it splits three ways across three separate
// assemblies (Install electric/gas/heat pump HWS), and the intake already
// captures which (lib/intake/structure.ts:153). Without that signal we return
// null rather than guess — the same rule as the category remap, because picking
// gas for an electric job prices a $1,845 unit onto a $1,448 job.
//
// Assembly names verified against the live DB 2026-07-30.

import { describe, it, expect } from 'vitest'
import { JOB_TYPE_ASSEMBLY, pickBestAssembly } from './assembly-search'

// The real plumbing assemblies, with whether they carry a BOM.
const ROWS = [
  { name: 'CCTV drain inspection' },
  { name: 'Disposal and site cleanup' },
  { name: 'Gas appliance connection' },
  { name: 'Hand rod blocked drain' },
  { name: 'Install dishwasher' },
  { name: 'Install electric HWS' },
  { name: 'Install external garden tap' },
  { name: 'Install gas HWS' },
  { name: 'Install heat pump HWS' },
  { name: 'Jet blast blocked drain' },
  { name: 'Leak detection' },
  { name: 'Pressure reduction valve install' },
  { name: 'Replace shower head' },
  { name: 'Tap replacement' },
  { name: 'Tap washer replacement' },
  { name: 'Toilet cistern repair' },
  { name: 'Toilet suite install' },
]

describe('Step 2 — the six auto-quoteable plumbing job types resolve', () => {
  it('blocked_drain → Hand rod blocked drain (the first-line method, and it has a BOM)', () => {
    expect(pickBestAssembly('blocked_drain', ROWS)?.name).toBe('Hand rod blocked drain')
  })

  it('tap_replace → Tap replacement', () => {
    expect(pickBestAssembly('tap_replace', ROWS)?.name).toBe('Tap replacement')
  })

  it('tap_repair → Tap washer replacement, NOT Tap replacement', () => {
    // A dripping washer is not a new mixer. Getting this backwards quotes a
    // $28 washer job as a $180 tapware swap.
    expect(pickBestAssembly('tap_repair', ROWS)?.name).toBe('Tap washer replacement')
  })

  it('toilet_replace → Toilet suite install', () => {
    expect(pickBestAssembly('toilet_replace', ROWS)?.name).toBe('Toilet suite install')
  })

  it('toilet_repair → Toilet cistern repair, NOT the suite install', () => {
    expect(pickBestAssembly('toilet_repair', ROWS)?.name).toBe('Toilet cistern repair')
  })
})

describe('Step 2 — hot_water splits three ways by system_type', () => {
  it('electric → Install electric HWS', () => {
    expect(pickBestAssembly('hot_water', ROWS, 'electric')?.name).toBe('Install electric HWS')
  })

  it('gas → Install gas HWS', () => {
    expect(pickBestAssembly('hot_water', ROWS, 'gas')?.name).toBe('Install gas HWS')
  })

  it('heat_pump → Install heat pump HWS, not the electric one', () => {
    // A heat pump IS electric. Same trap as the category remap.
    expect(pickBestAssembly('hot_water', ROWS, 'heat_pump')?.name).toBe('Install heat pump HWS')
  })

  it('returns NULL with no system_type — never a coin flip between gas and electric', () => {
    expect(pickBestAssembly('hot_water', ROWS)).toBeNull()
  })

  it('returns null for an unrecognised system_type rather than defaulting', () => {
    expect(pickBestAssembly('hot_water', ROWS, 'solar_thermal')).toBeNull()
  })

  it('ignores a variant on a job type that has no variants', () => {
    // tap_replace:anything must still resolve via the plain key.
    expect(pickBestAssembly('tap_replace', ROWS, 'gas')?.name).toBe('Tap replacement')
  })
})

describe('Step 2 — the electrical map is untouched', () => {
  it('still resolves the electrical job types Phase 1 fixed', () => {
    const e = [
      { name: 'Install LED downlight (new install, single-storey)' },
      { name: 'Replace double GPO' },
      { name: 'Supply + install AC ceiling fan' },
    ]
    expect(pickBestAssembly('downlights', e)?.name).toBe(
      'Install LED downlight (new install, single-storey)',
    )
    expect(pickBestAssembly('power_points', e)?.name).toBe('Replace double GPO')
    expect(pickBestAssembly('ceiling_fans', e)?.name).toBe('Supply + install AC ceiling fan')
  })

  it('keeps every electrical entry present', () => {
    for (const k of [
      'downlights', 'power_points', 'ceiling_fans', 'smoke_alarms',
      'outdoor_lighting', 'oven_cooktop', 'ev_charger', 'fault_finding',
    ]) {
      expect(JOB_TYPE_ASSEMBLY[k], k).toBeTruthy()
    }
  })

  it('no plumbing key collides with an electrical one', () => {
    // A flat map is only safe while the two trades' job_type namespaces are
    // disjoint. Assert it rather than assume it.
    const plumbing = ['blocked_drain', 'tap_repair', 'tap_replace', 'toilet_repair', 'toilet_replace']
    const electrical = ['downlights', 'power_points', 'ceiling_fans', 'smoke_alarms',
      'outdoor_lighting', 'oven_cooktop', 'ev_charger', 'fault_finding']
    for (const p of plumbing) expect(electrical, p).not.toContain(p)
  })

  it('every mapped name is a real assembly name in its trade', () => {
    // Guards the fixture: a typo in the map means silent null in production.
    const all = [...ROWS.map((r) => r.name),
      'Install LED downlight (new install, single-storey)', 'Replace double GPO',
      'Supply + install AC ceiling fan', 'Hardwire 240V smoke alarm',
      'Install outdoor IP-rated LED light', 'Install oven (existing wiring)',
      'Install EV charger', 'Diagnostic call-out (fault finding)']
    for (const [key, name] of Object.entries(JOB_TYPE_ASSEMBLY)) {
      expect(all, `${key} → ${name}`).toContain(name)
    }
  })

  it('returns null for an unmapped job type, as before', () => {
    expect(pickBestAssembly('burst_pipe', ROWS)).toBeNull()
    expect(pickBestAssembly('', ROWS)).toBeNull()
  })
})
