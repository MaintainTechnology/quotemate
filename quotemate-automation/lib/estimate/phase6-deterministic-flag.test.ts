// Phase 6 — DETERMINISTIC_BOM resolves per tenant.
//
// It used to be one global `=== '1'` check, so the deterministic pricer was on
// for all eight tenants or none. Fine while it was off; the wrong shape now it
// is ON in production, because the only way to react to one tenant's recipe
// misbehaving was to turn the engine off for everybody — including the seven it
// was working for. This is rollback granularity.
//
// ⚠ THE DEFAULT MUST STAY OFF. The SMS flag it mirrors defaults ON because that
// rollout finished; this one's contract is still "dormant until explicitly
// enabled", asserted by run.ts, the builder's header, and the test suite.
// Flipping the default would silently switch the deterministic pricer on in
// every dev environment and CI run — which is why the first two tests below
// exist and why they are the ones to look at if this ever starts failing.

import { describe, it, expect, afterEach } from 'vitest'
import { deterministicBomEnabled, deterministicBomMode } from './deterministic-flag'

const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'

const set = (v: string | undefined) => {
  if (v === undefined) delete process.env.DETERMINISTIC_BOM
  else process.env.DETERMINISTIC_BOM = v
}
afterEach(() => set(undefined))

describe('Phase 6 — the default is OFF and stays OFF', () => {
  it('unset means off for every tenant', () => {
    set(undefined)
    expect(deterministicBomEnabled(T1)).toBe(false)
    expect(deterministicBomEnabled(null)).toBe(false)
  })

  it('an empty or whitespace value is off, not an empty allow-list quirk', () => {
    for (const v of ['', '   ']) {
      set(v)
      expect(deterministicBomEnabled(T1), JSON.stringify(v)).toBe(false)
    }
  })
})

describe('Phase 6 — the global settings behave exactly as before', () => {
  it("'1' is on for everyone — what production sets today", () => {
    set('1')
    expect(deterministicBomEnabled(T1)).toBe(true)
    expect(deterministicBomEnabled(T2)).toBe(true)
    // Including a tenant-less intake, which is the pre-Phase-6 behaviour and
    // must not change: the old check never looked at a tenant at all.
    expect(deterministicBomEnabled(null)).toBe(true)
  })

  it('accepts the same spellings as the SMS flag', () => {
    for (const v of ['true', 'on', 'yes', 'all', 'ON', 'All']) {
      set(v)
      expect(deterministicBomEnabled(T1), v).toBe(true)
    }
    for (const v of ['0', 'false', 'off', 'no', 'OFF', 'No']) {
      set(v)
      expect(deterministicBomEnabled(T1), v).toBe(false)
    }
  })

  it('tolerates surrounding whitespace, as a pasted env value has', () => {
    set('  1  ')
    expect(deterministicBomEnabled(T1)).toBe(true)
  })
})

describe('Phase 6 — the allow-list, which is the point', () => {
  it('one tenant on, the rest off', () => {
    set(T1)
    expect(deterministicBomEnabled(T1)).toBe(true)
    expect(deterministicBomEnabled(T2)).toBe(false)
  })

  it('several tenants, comma-separated with untidy spacing', () => {
    set(` ${T1} , ${T2} `)
    expect(deterministicBomEnabled(T1)).toBe(true)
    expect(deterministicBomEnabled(T2)).toBe(true)
  })

  it('a tenant NOT on the list is off — the isolate-one-tenant case', () => {
    // The operational scenario: tenant 2's recipe is producing bad quotes, so
    // list everyone except tenant 2 rather than turning the engine off for all.
    set(T1)
    expect(deterministicBomEnabled(T2)).toBe(false)
  })

  it('a null tenant is OFF under an allow-list', () => {
    // An intake with no tenant cannot be on a list of tenants, and those rows
    // are the legacy/dev-number traffic that must never be priced
    // deterministically. Note this DIFFERS from '1', where null is on — that
    // asymmetry preserves the old global behaviour exactly.
    set(T1)
    expect(deterministicBomEnabled(null)).toBe(false)
    expect(deterministicBomEnabled(undefined)).toBe(false)
  })

  it('does not match on a prefix or substring of an id', () => {
    // A trailing-character typo in the env must not silently enable a
    // different tenant.
    set(T1.slice(0, -1))
    expect(deterministicBomEnabled(T1)).toBe(false)
  })

  it('empty entries from a trailing comma are ignored', () => {
    set(`${T1},,`)
    expect(deterministicBomEnabled(T1)).toBe(true)
  })

  it('is read fresh each call, so a flip needs no redeploy', () => {
    set(T1)
    expect(deterministicBomEnabled(T2)).toBe(false)
    set(`${T1},${T2}`)
    expect(deterministicBomEnabled(T2)).toBe(true)
  })
})

describe('Phase 6 — /api/health reports the MODE, not a boolean', () => {
  // A boolean cannot describe this any more: `=== '1'` would report false while
  // the engine is on for every tenant on an allow-list, which is worse than
  // reporting nothing at all.
  it('off when unset or explicitly off', () => {
    set(undefined)
    expect(deterministicBomMode()).toBe('off')
    set('0')
    expect(deterministicBomMode()).toBe('off')
  })

  it('all when globally on', () => {
    set('1')
    expect(deterministicBomMode()).toBe('all')
  })

  it('counts the allow-list', () => {
    set(`${T1},${T2}`)
    expect(deterministicBomMode()).toBe('allow-list:2')
    set(T1)
    expect(deterministicBomMode()).toBe('allow-list:1')
  })

  it('never leaks a tenant id — this endpoint is public', () => {
    // /api/health exposes presence, not values. An id here would hand an
    // outsider a real tenant identifier for free.
    set(`${T1},${T2}`)
    const mode = deterministicBomMode()
    expect(mode).not.toContain(T1)
    expect(mode).not.toContain(T2)
  })

  it('agrees with the resolver — mode never says off while a tenant is on', () => {
    set(T1)
    expect(deterministicBomMode()).not.toBe('off')
    expect(deterministicBomEnabled(T1)).toBe(true)
  })
})
