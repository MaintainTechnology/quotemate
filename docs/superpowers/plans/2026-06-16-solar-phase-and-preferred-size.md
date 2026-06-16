# Solar Estimate: 3-phase power + preferred system size — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the property's electrical phase (single vs 3-phase) and an optional preferred system size (kW) as new Solar Estimate inputs — declared by the customer and overridable by the tradie — so the sizing engine offers the right system size (and stops under-sizing 3-phase homes).

**Architecture:** One engine change drives two entry points. Phase scales the per-phase DNSP export cap by phase count (×1 single, ×3 three); a preferred size anchors the headline "best" tier and steps Good/Better down. Both values ride on `SolarEstimateContext` into the pure `sizeSolarSystem` function, are persisted to two new `solar_estimates` columns, and are overridable on the existing in-place re-draft path. Batteries are explicitly out of scope (next release).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Vitest, Supabase Postgres (`pg` migration runner), Tailwind (Maintain design tokens).

**Spec:** [docs/superpowers/specs/2026-06-16-solar-phase-and-preferred-size-design.md](../specs/2026-06-16-solar-phase-and-preferred-size-design.md)

> ⚠ **Before editing any Next.js route/page file** (`app/api/.../route.ts`, `app/.../page.tsx`, the form component) read `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guide — Next 16 has breaking changes vs training-data knowledge.
>
> All commands run from the `quotemate-automation/` directory. Tests: `npx vitest run <file>`. Typecheck: `npx tsc --noEmit`. Lint: `npx eslint <files>`. Migration scripts: `node --env-file=.env.local scripts/run-migration-NNN.mjs`.

---

## File map

| File | Change |
|---|---|
| `sql/migrations/114_solar_phase_and_requested_size.sql` | **Create** — add `electrical_phase`, `requested_system_kw` columns |
| `scripts/run-migration-114.mjs` | **Create** — runner mirroring `run-migration-111.mjs` |
| `lib/solar/types.ts` | Add `SolarPhase`; extend `SolarEstimateContext` + `SolarSizingResult` |
| `lib/solar/sizing.ts` | Phase-aware export cap; preferred-size anchored ladder + clamp flag |
| `lib/solar/sizing.test.ts` | New tests for cap math + anchoring/clamp |
| `lib/solar/request-schema.ts` | Add optional `phase`, `desired_kw` |
| `lib/solar/form-payload.ts` | Thread `phase`, `desiredKw` into payload |
| `lib/solar/form-payload.test.ts` | New/extended tests (create if absent) |
| `lib/solar/intake.ts` | Add `phase`/`desiredKw` args; set `context.phase` + `context.requested_system_kw` |
| `app/api/solar/[tenantSlug]/estimate/route.ts` | Destructure + pass `phase`/`desired_kw` |
| `lib/solar/persist-helpers.ts` | Write the two new columns from context |
| `lib/solar/redraft.ts` | Override resolution in `reconstructSolarInputs` |
| `app/api/solar/redraft/[token]/route.ts` | Parse optional override body; thread to engine |
| `lib/solar/dashboard-view.ts` | Expose `electricalPhase` + `requestedSystemKw` |
| `app/api/tenant/solar/route.ts` | Add columns to the dashboard query select |
| `app/dashboard/_components/SolarTab.tsx` | Per-card phase/size override controls |
| `lib/solar/premium-quote.ts` | Add phase + requested-size rows (+ clamp note) |
| `app/solar/[tenantSlug]/_components/SolarAddressForm.tsx` | Power-supply + preferred-size selectors |
| `scripts/test-solar-parity.mjs` | Extend with no-regression assertions |

---

## Task 1: Migration — add `electrical_phase` + `requested_system_kw`

**Files:**
- Create: `sql/migrations/114_solar_phase_and_requested_size.sql`
- Create: `scripts/run-migration-114.mjs`

- [ ] **Step 1: Write the migration SQL**

Create `sql/migrations/114_solar_phase_and_requested_size.sql`:

```sql
-- QuoteMate · migration 114 — solar phase + preferred system size
-- (design 2026-06-16). Adds the property's electrical phase and an optional
-- customer/tradie-requested system size to solar_estimates. Both are inputs
-- to the sizing engine; phase scales the DNSP export cap (single ×1, 3-phase
-- ×3), requested size anchors the headline tier. Idempotent / re-entrant.

alter table public.solar_estimates
  add column if not exists electrical_phase text not null default 'single'
    check (electrical_phase in ('single', 'three')),
  add column if not exists requested_system_kw numeric
    check (requested_system_kw is null
           or (requested_system_kw > 0 and requested_system_kw <= 30));
```

- [ ] **Step 2: Write the migration runner**

Create `scripts/run-migration-114.mjs` (mirrors `run-migration-111.mjs`):

```js
// QuoteMate · run migration 114 (solar phase + preferred system size)
// Usage: node --env-file=.env.local scripts/run-migration-114.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '114_solar_phase_and_requested_size.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 114_solar_phase_and_requested_size.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='solar_estimates'
           and column_name='electrical_phase') as phase_ok,
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='solar_estimates'
           and column_name='requested_system_kw') as size_ok`,
  )
  const r = rows[0]
  console.log(`  ${r.phase_ok ? '✓' : '✗'} electrical_phase: ${r.phase_ok}`)
  console.log(`  ${r.size_ok ? '✓' : '✗'} requested_system_kw: ${r.size_ok}`)
  if (!(r.phase_ok && r.size_ok)) process.exit(1)
  console.log('\nOK — migration 114 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
```

- [ ] **Step 3: Apply the migration**

Run: `node --env-file=.env.local scripts/run-migration-114.mjs`
Expected: `✓ electrical_phase: true`, `✓ requested_system_kw: true`, `OK — migration 114 verified.`

- [ ] **Step 4: Commit**

```bash
git add sql/migrations/114_solar_phase_and_requested_size.sql scripts/run-migration-114.mjs
git commit -m "feat(solar): migration 114 — electrical_phase + requested_system_kw columns"
```

---

## Task 2: Types — `SolarPhase`, context fields, sizing-result fields

**Files:**
- Modify: `lib/solar/types.ts`

- [ ] **Step 1: Add the `SolarPhase` type**

In `lib/solar/types.ts`, immediately above the `SolarExportLimitConfig` type (around line 516), add:

```ts
/** Property electrical supply phase. Drives the DNSP export cap (single ×1,
 *  three ×3). Absent/legacy estimates are treated as single-phase. */
export type SolarPhase = 'single' | 'three'
```

- [ ] **Step 2: Extend `SolarEstimateContext`**

In the `SolarEstimateContext` type (around line 643), add two fields after the `network` field:

```ts
  /** The network/DNSP resolved from postcode (for FiT + export limit). */
  network: string
  /** Property electrical phase (design 2026-06-16). Absent → single-phase. */
  phase?: SolarPhase
  /** Customer/tradie-requested system size in kW DC; null when auto-sized. */
  requested_system_kw?: number | null
```

- [ ] **Step 3: Extend `SolarSizingResult`**

In the `SolarSizingResult` type (around line 336), add two optional fields after `export_limit_kw_ac`:

```ts
  /** Export ceiling applied (default 5 kW/phase × phase count), kW AC. */
  export_limit_kw_ac: number
  /** Echo of the requested system size (kW DC), when one was supplied. */
  requested_kw?: number | null
  /** True when the requested size could not be met (roof/export limited it). */
  requested_kw_clamped?: boolean
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors — all additions are optional/new).

- [ ] **Step 5: Commit**

```bash
git add lib/solar/types.ts
git commit -m "feat(solar): add SolarPhase + phase/requested-size fields to context and sizing result"
```

---

## Task 3: Sizing engine — phase-aware export cap

**Files:**
- Modify: `lib/solar/sizing.ts:66-69`
- Test: `lib/solar/sizing.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/solar/sizing.test.ts` (mirror the existing file's imports/fixtures — it already imports `sizeSolarSystem`, `DEFAULT_SOLAR_CONFIG`, roof helpers, and builds a `SolarEstimateContext` inline). Use a large-roof config that allows distinct tiers:

```ts
describe('sizeSolarSystem — phase-aware export cap', () => {
  // A roof big enough that the export limit, not the roof, is the binding cap.
  const bigRoof = normaliseSolarRoofFacts(buildingInsightsFixture, { panel_capacity_watts: 400 })
  const baseCtx = {
    postcode: '2000', state: 'NSW' as const, install_year: 2026, network: 'default',
  }

  it('single-phase (default) caps at the per-phase limit ×1', () => {
    const res = sizeSolarSystem({
      roof: bigRoof, panelType: 'standard_panels', config: DEFAULT_SOLAR_CONFIG,
      context: { ...baseCtx, phase: 'single' },
    })
    // default_kw_per_phase = 5, ×1 → 5 kW AC.
    expect(res.export_limit_kw_ac).toBe(5)
  })

  it('three-phase caps at the per-phase limit ×3', () => {
    const res = sizeSolarSystem({
      roof: bigRoof, panelType: 'standard_panels', config: DEFAULT_SOLAR_CONFIG,
      context: { ...baseCtx, phase: 'three' },
    })
    expect(res.export_limit_kw_ac).toBe(15)
  })

  it('absent phase behaves as single-phase (no regression)', () => {
    const res = sizeSolarSystem({
      roof: bigRoof, panelType: 'standard_panels', config: DEFAULT_SOLAR_CONFIG,
      context: { ...baseCtx },
    })
    expect(res.export_limit_kw_ac).toBe(5)
  })
})
```

> If the existing test file already defines a roof/context fixture helper, reuse it instead of `bigRoof`/`baseCtx`. Confirm `normaliseSolarRoofFacts` + `buildingInsightsFixture` import names against the top of `sizing.test.ts`; adjust to whatever that file already imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/solar/sizing.test.ts -t "phase-aware export cap"`
Expected: FAIL — three-phase returns 5 (no multiplier yet).

- [ ] **Step 3: Implement the phase multiplier**

In `lib/solar/sizing.ts`, replace the export-limit lookup (lines 66-69):

```ts
  const export_limit_kw_ac =
    config.export_limits.by_network[context.network] ??
    config.export_limits.default_kw_per_phase
  const exportDcCeiling = round2(export_limit_kw_ac / config.derate_factor)
```

with:

```ts
  // Per-phase AC export cap (network override wins), scaled by the property's
  // phase count: single-phase = ×1, 3-phase = ×3. Absent/legacy phase → single,
  // so every existing single-phase estimate keeps its exact numbers.
  const perPhaseCapKw =
    config.export_limits.by_network[context.network] ??
    config.export_limits.default_kw_per_phase
  const phaseCount = context.phase === 'three' ? 3 : 1
  const export_limit_kw_ac = perPhaseCapKw * phaseCount
  const exportDcCeiling = round2(export_limit_kw_ac / config.derate_factor)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/solar/sizing.test.ts`
Expected: PASS (new cases pass; all pre-existing sizing tests still pass — single-phase default is unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/solar/sizing.ts lib/solar/sizing.test.ts
git commit -m "feat(solar): scale DNSP export cap by phase count (single ×1, 3-phase ×3)"
```

---

## Task 4: Sizing engine — preferred-size anchored ladder + clamp flag

**Files:**
- Modify: `lib/solar/sizing.ts:100-106` (targets), `:213` (final return)
- Test: `lib/solar/sizing.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/solar/sizing.test.ts`:

```ts
describe('sizeSolarSystem — preferred system size', () => {
  const bigRoof = normaliseSolarRoofFacts(buildingInsightsFixture, { panel_capacity_watts: 400 })
  // 3-phase + a generous network override so neither roof nor export clamps a
  // mid-size request — lets us assert the request is honoured exactly.
  const config = {
    ...DEFAULT_SOLAR_CONFIG,
    export_limits: { default_kw_per_phase: 30, by_network: {} as Record<string, number> },
  }
  const ctx = {
    postcode: '2000', state: 'NSW' as const, install_year: 2026, network: 'default',
    phase: 'three' as const,
  }

  it('anchors the best tier at the requested size and steps lower tiers down', () => {
    const res = sizeSolarSystem({
      roof: bigRoof, panelType: 'standard_panels', config,
      context: { ...ctx, requested_system_kw: 10 },
    })
    const best = res.tiers[res.tiers.length - 1]
    // 10 kW / 0.4 kW panels = 25 panels → 10 kW DC headline.
    expect(best.system_kw_dc).toBe(10)
    expect(res.requested_kw).toBe(10)
    expect(res.requested_kw_clamped).toBe(false)
    // Lower tiers are genuinely smaller.
    expect(res.tiers[0].system_kw_dc).toBeLessThan(best.system_kw_dc)
  })

  it('clamps a request the roof/export cannot meet and flags it', () => {
    // Single-phase (5 kW cap) but the customer asked for 14 kW.
    const res = sizeSolarSystem({
      roof: bigRoof, panelType: 'standard_panels', config: DEFAULT_SOLAR_CONFIG,
      context: { ...ctx, phase: 'single', requested_system_kw: 14 },
    })
    const best = res.tiers[res.tiers.length - 1]
    expect(res.requested_kw).toBe(14)
    expect(res.requested_kw_clamped).toBe(true)
    expect(best.system_kw_dc).toBeLessThanOrEqual(7) // ~5 kW AC / 0.81 derate ≈ 6.x kW DC
  })

  it('without a requested size, falls back to roof-fraction tiers (no regression)', () => {
    const res = sizeSolarSystem({
      roof: bigRoof, panelType: 'standard_panels', config,
      context: { ...ctx },
    })
    expect(res.requested_kw == null).toBe(true)
    expect(res.requested_kw_clamped).toBeFalsy()
    expect(res.tiers.length).toBeGreaterThanOrEqual(2)
  })
})
```

> The exact `system_kw_dc` numbers depend on the fixture's `max_panels_count` and `panel_capacity_watts`. If `buildingInsightsFixture` doesn't yield ≥25 max panels, use a fixture/override with a larger roof so the 10 kW request isn't roof-clamped, or adjust the asserted kW to match the fixture. Keep the *structure* of the assertions (best == request when unclamped; clamped flag flips when capped).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/solar/sizing.test.ts -t "preferred system size"`
Expected: FAIL — `requested_kw` is undefined; the best tier is roof-derived, not anchored.

- [ ] **Step 3: Implement the anchored ladder**

In `lib/solar/sizing.ts`, replace the targets block (lines 100-106):

```ts
  // Candidate panel counts, ascending, deduped, each capped by the roof.
  const maxPanels = roof.max_panels_count
  const targets = [
    Math.max(1, Math.round(maxPanels * GOOD_FRACTION)),
    Math.max(1, Math.round(maxPanels * MIDDLE_FRACTION)),
    maxPanels,
  ]
```

with:

```ts
  // Candidate panel counts, ascending, deduped, each capped by the roof.
  const maxPanels = roof.max_panels_count

  // Optional customer/tradie-preferred system size (kW DC). When present, anchor
  // the headline ("best") tier at the requested size and step the lower tiers
  // down (≈90% better, ≈75% good), still bounded by the roof and the phase
  // export ceiling. requested_kw_clamped records that the full request could
  // not be met, so the quote can say why.
  const requestedKw =
    typeof context.requested_system_kw === 'number' &&
    Number.isFinite(context.requested_system_kw) &&
    context.requested_system_kw > 0
      ? context.requested_system_kw
      : null

  let requested_kw_clamped = false
  let targets: number[]
  if (requestedKw != null) {
    const targetPanels = Math.max(1, Math.round((requestedKw * 1000) / wattsPerPanel))
    const feasibleMax = Math.min(maxPanels, exportCeilPanels)
    const effectiveBest = Math.min(targetPanels, feasibleMax)
    requested_kw_clamped = targetPanels > feasibleMax
    targets = [
      Math.max(1, Math.ceil(effectiveBest * 0.75)),
      Math.max(1, Math.ceil(effectiveBest * 0.9)),
      effectiveBest,
    ]
  } else {
    targets = [
      Math.max(1, Math.round(maxPanels * GOOD_FRACTION)),
      Math.max(1, Math.round(maxPanels * MIDDLE_FRACTION)),
      maxPanels,
    ]
  }
```

Then update the final success return (line 213):

```ts
  return { tiers, roof_capacity_kw_dc, export_limit_kw_ac, routing }
```

to:

```ts
  return {
    tiers,
    roof_capacity_kw_dc,
    export_limit_kw_ac,
    routing,
    requested_kw: requestedKw,
    requested_kw_clamped,
  }
```

> `wattsPerPanel` (line 61) and `exportCeilPanels` (line 86) are already in scope above the targets block. Leave the three inspection-route early returns unchanged — `requested_kw`/`requested_kw_clamped` are optional, so an inspection result simply omits them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/solar/sizing.test.ts`
Expected: PASS (preferred-size cases pass; phase cases from Task 3 and all pre-existing tests still pass).

- [ ] **Step 5: Commit**

```bash
git add lib/solar/sizing.ts lib/solar/sizing.test.ts
git commit -m "feat(solar): anchor tiers at a requested system size with a clamp flag"
```

---

## Task 5: Request schema + form-payload builder

**Files:**
- Modify: `lib/solar/request-schema.ts:17-54`, `lib/solar/form-payload.ts:8-67`
- Test: `lib/solar/form-payload.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/solar/form-payload.test.ts` (or append if it exists):

```ts
import { describe, it, expect } from 'vitest'
import { buildSolarFormPayload } from './form-payload'

const base = {
  address: '1 Test St', postcode: '2000', state: 'NSW', manualOpen: false,
  orientation: 'north', roofSize: 'medium' as const, storeys: 1 as const,
  panelType: 'standard_panels' as const,
}

describe('buildSolarFormPayload — phase + preferred size', () => {
  it('includes phase when single or three', () => {
    expect(buildSolarFormPayload({ ...base, phase: 'three' }).phase).toBe('three')
    expect(buildSolarFormPayload({ ...base, phase: 'single' }).phase).toBe('single')
  })

  it('omits phase when unset', () => {
    expect('phase' in buildSolarFormPayload({ ...base })).toBe(false)
  })

  it('includes a positive desired size and omits a missing one', () => {
    expect(buildSolarFormPayload({ ...base, desiredKw: 10 }).desired_kw).toBe(10)
    expect('desired_kw' in buildSolarFormPayload({ ...base })).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/solar/form-payload.test.ts`
Expected: FAIL — `phase`/`desired_kw` not on the payload (and TS errors on the new state keys).

- [ ] **Step 3: Extend the request schema**

In `lib/solar/request-schema.ts`, inside the `SolarEstimateRequestSchema` object, add these fields before the closing `})` (after `variant`):

```ts
  variant: z.enum(['instant', 'felt']).optional(),
  // Property electrical phase (design 2026-06-16). Absent → single-phase.
  // Scales the DNSP export cap (single ×1, 3-phase ×3) in the sizing engine.
  phase: z.enum(['single', 'three']).optional(),
  // Customer/tradie-preferred system size in kW DC. Anchors the headline tier;
  // bounded so a typo can't request an implausible array.
  desired_kw: z.number().positive().max(30).optional(),
})
```

- [ ] **Step 4: Extend the form-payload builder**

In `lib/solar/form-payload.ts`, add two fields to the `state` parameter type (after `variant?`):

```ts
  /** Quote layout variant (Felt tab spec 2026-06-13). Omitted = instant. */
  variant?: 'instant' | 'felt'
  /** Property electrical phase; omit when the customer is unsure. */
  phase?: 'single' | 'three'
  /** Preferred system size in kW DC; omit to auto-size. */
  desiredKw?: number
```

and add the conditional inclusion just before `return payload` (after the `variant` block):

```ts
  if (state.variant === 'felt') {
    payload.variant = 'felt'
  }
  // Phase only ships when the customer actually chose one ("Not sure" → omit,
  // engine defaults to single).
  if (state.phase === 'single' || state.phase === 'three') {
    payload.phase = state.phase
  }
  // Preferred size — only a finite positive value within the schema bound.
  if (typeof state.desiredKw === 'number' && Number.isFinite(state.desiredKw) && state.desiredKw > 0) {
    payload.desired_kw = state.desiredKw
  }
  return payload
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/solar/form-payload.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/solar/request-schema.ts lib/solar/form-payload.ts lib/solar/form-payload.test.ts
git commit -m "feat(solar): accept optional phase + desired_kw on the estimate request"
```

---

## Task 6: Intake threading + estimate route

**Files:**
- Modify: `lib/solar/intake.ts:102-138`, `app/api/solar/[tenantSlug]/estimate/route.ts:75-100`

> Read `node_modules/next/dist/docs/` route conventions before editing the route file (see header warning).

- [ ] **Step 1: Extend `runSolarEstimate` args + context**

In `lib/solar/intake.ts`, add two fields to the `runSolarEstimate` args type (after `panelType?`):

```ts
  panelType?: SolarPanelType
  /** Property electrical phase (design 2026-06-16). Absent → single-phase. */
  phase?: SolarPhase
  /** Customer/tradie-preferred system size in kW DC; null/absent → auto-size. */
  desiredKw?: number | null
```

Add the `SolarPhase` import to the existing type-import block at the top of `intake.ts` (alongside `SolarEstimateContext` etc.).

Then in the `context` object construction (around line 125), add two fields after `network`:

```ts
    network: opts.network,
    phase: args.phase === 'three' ? 'three' : 'single',
    requested_system_kw:
      typeof args.desiredKw === 'number' &&
      Number.isFinite(args.desiredKw) &&
      args.desiredKw > 0
        ? args.desiredKw
        : null,
```

The `sizeSolarSystem({ roof, panelType, config, context })` call (line 210) needs **no change** — it reads `context.phase` and `context.requested_system_kw`.

- [ ] **Step 2: Thread the fields through the estimate route**

In `app/api/solar/[tenantSlug]/estimate/route.ts`, extend the destructure (line 75):

```ts
  const { address, manual, panel_type, customer, energy, phase, desired_kw } = parsed.data
```

and add the two args to the `runSolarEstimate({ ... })` call (alongside `panelType`/`quarterlyBillAud`):

```ts
      panelType: panel_type,
      phase,
      desiredKw: desired_kw ?? null,
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Run the solar test suite (no regressions)**

Run: `npx vitest run lib/solar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/solar/intake.ts "app/api/solar/[tenantSlug]/estimate/route.ts"
git commit -m "feat(solar): thread phase + desired_kw from request through to the sizing context"
```

---

## Task 7: Persistence — write the two new columns

**Files:**
- Modify: `lib/solar/persist-helpers.ts:73-98`
- Test: `lib/solar/persist-helpers.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or append `lib/solar/persist-helpers.test.ts`. Build a minimal `SolarEstimate` fixture whose `context` carries the new fields (reuse `lib/solar/__fixtures__/estimate.ts` if it exposes a builder; otherwise import the fixture and spread an override on `.context`):

```ts
import { describe, it, expect } from 'vitest'
import { buildSolarRowPayloads } from './persist-helpers'
import { estimateFixture } from './__fixtures__/estimate' // adjust to the actual export

describe('buildSolarRowPayloads — phase + requested size columns', () => {
  it('stamps electrical_phase and requested_system_kw from context', () => {
    const estimate = {
      ...estimateFixture,
      context: { ...estimateFixture.context, phase: 'three' as const, requested_system_kw: 10 },
    }
    const { solarEstimate } = buildSolarRowPayloads({
      estimate, tenantId: 't1',
      address: { address: '1 Test St', state: 'NSW', postcode: '2000' },
    })
    expect(solarEstimate.electrical_phase).toBe('three')
    expect(solarEstimate.requested_system_kw).toBe(10)
  })

  it('defaults to single / null when context omits them', () => {
    const { solarEstimate } = buildSolarRowPayloads({
      estimate: estimateFixture, tenantId: 't1',
      address: { address: '1 Test St', state: 'NSW', postcode: '2000' },
    })
    expect(solarEstimate.electrical_phase).toBe('single')
    expect(solarEstimate.requested_system_kw).toBe(null)
  })
})
```

> Confirm the destructured return key — `buildSolarRowPayloads` builds a `solarEstimate` object (seen in the source), so the return almost certainly exposes it as `solarEstimate`. If `__fixtures__/estimate.ts` exports under a different name, fix the import.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/solar/persist-helpers.test.ts`
Expected: FAIL — `electrical_phase`/`requested_system_kw` are undefined on the row.

- [ ] **Step 3: Add the column assignments**

In `lib/solar/persist-helpers.ts`, in the `solarEstimate` object (after `network: estimate.context.network,`), add:

```ts
    network: estimate.context.network,
    electrical_phase: estimate.context.phase ?? 'single',
    requested_system_kw: estimate.context.requested_system_kw ?? null,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/solar/persist-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/solar/persist-helpers.ts lib/solar/persist-helpers.test.ts
git commit -m "feat(solar): persist electrical_phase + requested_system_kw on the estimate row"
```

---

## Task 8: Tradie override on re-draft

**Files:**
- Modify: `lib/solar/redraft.ts:64-117`, `app/api/solar/redraft/[token]/route.ts`
- Test: `lib/solar/redraft.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/solar/redraft.test.ts` (it already imports `reconstructSolarInputs`). Build a `previous` estimate whose `context` carries phase/size:

```ts
describe('reconstructSolarInputs — phase + size override resolution', () => {
  const previous = {
    ...estimateFixture,
    coverage_source: 'google' as const,
    context: { ...estimateFixture.context, phase: 'single' as const, requested_system_kw: 6 },
  }
  const row = { address: '1 Test St', state: 'NSW', postcode: '2000' }

  it('falls back to the persisted context values when no override is given', () => {
    const out = reconstructSolarInputs({ row, estimate: previous })!
    expect(out.phase).toBe('single')
    expect(out.desiredKw).toBe(6)
  })

  it('lets the tradie override win', () => {
    const out = reconstructSolarInputs({
      row, estimate: previous, overrides: { phase: 'three', desired_kw: 12 },
    })!
    expect(out.phase).toBe('three')
    expect(out.desiredKw).toBe(12)
  })

  it('treats an explicit null desired_kw override as "clear to auto-size"', () => {
    const out = reconstructSolarInputs({
      row, estimate: previous, overrides: { desired_kw: null },
    })!
    expect(out.desiredKw).toBe(null)
  })
})
```

> Reuse whatever fixture `redraft.test.ts` already imports for `estimate`; the names above (`estimateFixture`) are illustrative — match the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/solar/redraft.test.ts -t "override resolution"`
Expected: FAIL — `out.phase`/`out.desiredKw` don't exist.

- [ ] **Step 3: Extend `reconstructSolarInputs`**

In `lib/solar/redraft.ts`, add to the `ReconstructedSolarInputs` type:

```ts
export type ReconstructedSolarInputs = {
  input: SolarAddressInput
  manual?: SolarManualRoofInput
  panelType: SolarPanelType
  quarterlyBillAud: number | null
  phase: SolarPhase
  desiredKw: number | null
}
```

Add `SolarPhase` to the type-import block at the top of the file. Extend the function signature's args with an `overrides` field:

```ts
export function reconstructSolarInputs(args: {
  row: { address: string | null; state: string | null; postcode: string | null }
  estimate: SolarEstimate
  /** Tradie-supplied overrides from the re-draft request (design 2026-06-16).
   *  A field present here wins over the persisted value; `desired_kw: null`
   *  explicitly clears a previous request (back to auto-sizing). */
  overrides?: { phase?: SolarPhase; desired_kw?: number | null }
}): ReconstructedSolarInputs | null {
```

Then, just before the final `return { input, manual, panelType, quarterlyBillAud }`, compute the resolved values and add them to the return:

```ts
  const phase: SolarPhase =
    args.overrides?.phase ??
    (estimate.context.phase === 'three' ? 'three' : 'single')

  const desiredKw =
    args.overrides && 'desired_kw' in args.overrides
      ? args.overrides.desired_kw ?? null
      : typeof estimate.context.requested_system_kw === 'number' &&
          Number.isFinite(estimate.context.requested_system_kw) &&
          estimate.context.requested_system_kw > 0
        ? estimate.context.requested_system_kw
        : null

  return { input, manual, panelType, quarterlyBillAud, phase, desiredKw }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/solar/redraft.test.ts`
Expected: PASS.

- [ ] **Step 5: Parse the override body + thread it in the route**

In `app/api/solar/redraft/[token]/route.ts`, after the auth check and before the row fetch, parse an optional override body (the request may have no body — guard it):

```ts
  // Optional tradie overrides (design 2026-06-16). A plain re-draft sends no
  // body; an override sends { phase?, desired_kw? }. Invalid/empty → no override.
  let overrides: { phase?: 'single' | 'three'; desired_kw?: number | null } = {}
  try {
    const raw = (await req.json()) as Record<string, unknown> | null
    if (raw && typeof raw === 'object') {
      if (raw.phase === 'single' || raw.phase === 'three') overrides.phase = raw.phase
      if (raw.desired_kw === null) overrides.desired_kw = null
      else if (typeof raw.desired_kw === 'number' && raw.desired_kw > 0 && raw.desired_kw <= 30)
        overrides.desired_kw = raw.desired_kw
    }
  } catch {
    // No body / invalid JSON → plain re-draft, unchanged behaviour.
  }
```

Pass `overrides` into the existing `reconstructSolarInputs({ row: {...}, estimate: previous })` call:

```ts
  const inputs = reconstructSolarInputs({
    row: {
      address: (row.address as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      postcode: (row.postcode as string | null) ?? null,
    },
    estimate: previous,
    overrides,
  })
```

Finally, in the route's `runSolarEstimate({ ... })` call (the re-run, further down the file), add the two engine inputs:

```ts
      panelType: inputs.panelType,
      phase: inputs.phase,
      desiredKw: inputs.desiredKw,
```

> Locate the existing `runSolarEstimate({ input: inputs.input, manual: inputs.manual, panelType: inputs.panelType, ... })` call in this file and add the two lines alongside `panelType`.

- [ ] **Step 6: Verify typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run lib/solar`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/solar/redraft.ts lib/solar/redraft.test.ts "app/api/solar/redraft/[token]/route.ts"
git commit -m "feat(solar): tradie phase/size override on re-draft (override > persisted > auto)"
```

---

## Task 9: Dashboard view model + SolarTab override controls

**Files:**
- Modify: `lib/solar/dashboard-view.ts:141-189` (type) + the `mapSolarEstimateRow` body, `app/api/tenant/solar/route.ts` (query select), `app/dashboard/_components/SolarTab.tsx`
- Test: `lib/solar/dashboard-view.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/solar/dashboard-view.test.ts` (mirror its existing `mapSolarEstimateRow` row fixture; add the two columns to the row object):

```ts
describe('mapSolarEstimateRow — phase + requested size', () => {
  it('surfaces electrical_phase and requested_system_kw', () => {
    const vm = mapSolarEstimateRow({ ...baseRow, electrical_phase: 'three', requested_system_kw: 10 })
    expect(vm.electricalPhase).toBe('three')
    expect(vm.requestedSystemKw).toBe(10)
  })

  it('defaults phase to single and size to null when columns are absent', () => {
    const vm = mapSolarEstimateRow({ ...baseRow })
    expect(vm.electricalPhase).toBe('single')
    expect(vm.requestedSystemKw).toBe(null)
  })
})
```

> Reuse the file's existing `baseRow` fixture (whatever it is named); these two keys are the only additions.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/solar/dashboard-view.test.ts -t "phase + requested size"`
Expected: FAIL — `electricalPhase`/`requestedSystemKw` undefined.

- [ ] **Step 3: Extend the view model + mapper**

In `lib/solar/dashboard-view.ts`, add to `SolarEstimateViewModel` (after `quoteVariant`):

```ts
  /** Property electrical phase (design 2026-06-16). */
  electricalPhase: 'single' | 'three'
  /** Tradie/customer-requested system size in kW DC; null when auto-sized. */
  requestedSystemKw: number | null
```

In `mapSolarEstimateRow`, add to the returned object:

```ts
    electricalPhase: (row.electrical_phase as 'single' | 'three' | null) ?? 'single',
    requestedSystemKw:
      typeof row.requested_system_kw === 'number' ? row.requested_system_kw : null,
```

- [ ] **Step 4: Add the columns to the dashboard query**

In `app/api/tenant/solar/route.ts`, find the `.select('...')` on `solar_estimates` that feeds the dashboard list and add `electrical_phase, requested_system_kw` to the column list.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/solar/dashboard-view.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the override controls to SolarTab**

In `app/dashboard/_components/SolarTab.tsx`:

(a) Add a per-token override-draft state near the other per-token state (after `redraftDone`):

```ts
  // Per-token re-draft override draft (design 2026-06-16): the phase/size the
  // tradie will re-run with. Initialised lazily from the card's current values.
  const [overrideDraft, setOverrideDraft] = useState<
    Record<string, { phase: 'single' | 'three'; desiredKw: string }>
  >({})

  const draftFor = useCallback(
    (e: SolarEstimateViewModel) =>
      overrideDraft[e.token] ?? {
        phase: e.electricalPhase,
        desiredKw: e.requestedSystemKw != null ? String(e.requestedSystemKw) : '',
      },
    [overrideDraft],
  )
```

(b) Change `redraftEstimate` to accept and send overrides. Update its signature and the `fetch` call:

```ts
  const redraftEstimate = useCallback(
    async (
      token: string,
      overrides?: { phase?: 'single' | 'three'; desired_kw?: number | null },
    ) => {
      if (!accessToken) return
      // ...unchanged state resets...
      try {
        const res = await fetch(`/api/solar/redraft/${token}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(overrides ?? {}),
        })
        // ...unchanged response handling...
```

(Leave the rest of the callback body and its dependency array unchanged.)

(c) Render the controls next to the Re-draft button (inside the `{e.canRedraft && (...)}` region). Replace the existing single `<button>` with a small control group:

```tsx
                    {e.canRedraft && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="grid grid-cols-2 border border-ink-line" role="radiogroup" aria-label="Power supply">
                          {(['single', 'three'] as const).map((p, i) => {
                            const d = draftFor(e)
                            return (
                              <button
                                key={p}
                                type="button"
                                role="radio"
                                aria-checked={d.phase === p}
                                onClick={() =>
                                  setOverrideDraft((m) => ({ ...m, [e.token]: { ...draftFor(e), phase: p } }))
                                }
                                className={`px-3 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${
                                  i > 0 ? 'border-l border-ink-line' : ''
                                } ${
                                  d.phase === p
                                    ? 'bg-accent text-ink-deep'
                                    : 'bg-ink-deep text-text-sec hover:text-text-pri'
                                }`}
                              >
                                {p === 'three' ? '3-phase' : 'Single'}
                              </button>
                            )
                          })}
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={30}
                          step="0.1"
                          inputMode="decimal"
                          aria-label="Preferred size (kW)"
                          placeholder="Size kW"
                          value={draftFor(e).desiredKw}
                          onChange={(ev) =>
                            setOverrideDraft((m) => ({ ...m, [e.token]: { ...draftFor(e), desiredKw: ev.target.value } }))
                          }
                          className="w-24 border border-ink-line bg-ink-deep px-3 py-2.5 font-mono text-xs tabular-nums text-text-pri"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const d = draftFor(e)
                            const kw = Number.parseFloat(d.desiredKw)
                            void redraftEstimate(e.token, {
                              phase: d.phase,
                              desired_kw: Number.isFinite(kw) && kw > 0 ? kw : null,
                            })
                          }}
                          disabled={!!redrafting[e.token]}
                          className={`inline-flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors disabled:opacity-60 ${
                            e.status === 'flagged'
                              ? 'bg-accent text-white hover:bg-accent-press'
                              : 'border border-ink-line text-text-pri hover:border-accent hover:text-accent'
                          }`}
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${redrafting[e.token] ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          {redrafting[e.token] ? 'Re-drafting…' : 'Re-draft'}
                        </button>
                      </div>
                    )}
```

- [ ] **Step 7: Typecheck + lint + manual verify**

Run: `npx tsc --noEmit && npx eslint "app/dashboard/_components/SolarTab.tsx" lib/solar/dashboard-view.ts "app/api/tenant/solar/route.ts"`
Expected: PASS.

Manual: `npm run dev`, open `/dashboard?tab=solar`, on an unreleased estimate set phase = 3-phase and a size, click Re-draft, confirm the card's System kW updates and the values persist after reload.

- [ ] **Step 8: Commit**

```bash
git add lib/solar/dashboard-view.ts lib/solar/dashboard-view.test.ts "app/api/tenant/solar/route.ts" "app/dashboard/_components/SolarTab.tsx"
git commit -m "feat(solar): tradie phase/size override controls on the dashboard re-draft"
```

---

## Task 10: Customer-facing display — premium-quote rows + clamp note

**Files:**
- Modify: `lib/solar/premium-quote.ts:204-273`
- Test: `lib/solar/premium-quote.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/solar/premium-quote.test.ts` (it already builds an estimate fixture and calls the premium-quote builder — match its existing call signature/import):

```ts
describe('premium quote — phase + requested size assumed values', () => {
  it('shows the power supply and a clamped requested size', () => {
    const estimate = {
      ...estimateFixture,
      context: { ...estimateFixture.context, phase: 'three' as const, requested_system_kw: 14 },
      sizing: { ...estimateFixture.sizing, requested_kw_clamped: true },
    }
    const q = buildSolarPremiumQuote(estimate) // adjust to the real builder name/args
    const labels = q.assumed_values.map((r) => r.label)
    expect(labels).toContain('Power supply')
    const supply = q.assumed_values.find((r) => r.label === 'Power supply')
    expect(supply?.value).toBe('3-phase')
    const requested = q.assumed_values.find((r) => r.label === 'Requested size')
    expect(requested?.value).toContain('capped')
  })
})
```

> Match the builder's real export name and call shape from the top of `premium-quote.test.ts`. If `headlineTier` may be absent in the fixture, ensure the fixture has at least one priced tier so the clamp note can reference a headline kW.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/solar/premium-quote.test.ts -t "phase + requested size"`
Expected: FAIL — no `Power supply`/`Requested size` rows.

- [ ] **Step 3: Add the rows**

In `lib/solar/premium-quote.ts`, just before the final `assumed_values.push({ label: 'Config version', ... })`, add:

```ts
  // Power supply + any customer/tradie-requested size (design 2026-06-16).
  // Phase explains the export ceiling; a clamped request is called out so the
  // customer understands why they didn't get the full kW they asked for.
  const phase = estimate.context.phase ?? 'single'
  assumed_values.push({
    label: 'Power supply',
    value: phase === 'three' ? '3-phase' : 'Single-phase',
  })
  const requestedKw = estimate.context.requested_system_kw
  if (typeof requestedKw === 'number' && requestedKw > 0) {
    const clamped = estimate.sizing.requested_kw_clamped === true
    const headlineKw = headlineTier?.system_kw_dc
    assumed_values.push({
      label: 'Requested size',
      value:
        clamped && typeof headlineKw === 'number'
          ? `${requestedKw} kW — capped at ${headlineKw} kW by roof / connection`
          : `${requestedKw} kW`,
    })
  }
```

> `headlineTier` is already defined earlier in this builder; `estimate.context` and `estimate.sizing` are already in scope.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/solar/premium-quote.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/solar/premium-quote.ts lib/solar/premium-quote.test.ts
git commit -m "feat(solar): show power supply + requested size (and clamp note) on the quote"
```

---

## Task 11: Customer form — Power supply + Preferred size selectors

**Files:**
- Modify: `app/solar/[tenantSlug]/_components/SolarAddressForm.tsx`

> Client component (`'use client'`). Mirrors the existing Panel-grade segmented control. No new server behaviour.

- [ ] **Step 1: Add the option arrays**

Near the top of `SolarAddressForm.tsx` (where `PANEL_GRADES` / `ORIENTATIONS` constants live), add:

```ts
const PHASE_OPTIONS = [
  { value: 'unknown', label: 'Not sure' },
  { value: 'single', label: 'Single-phase' },
  { value: 'three', label: '3-phase' },
] as const

const SIZE_PRESETS = [
  { value: null, label: 'Recommend' },
  { value: 6.6, label: '6.6 kW' },
  { value: 10, label: '10 kW' },
  { value: 13.2, label: '13.2 kW' },
] as const
```

- [ ] **Step 2: Add the form state**

In the `useState` block (after `quarterlyBill`), add:

```ts
  const [phase, setPhase] = useState<'unknown' | 'single' | 'three'>('unknown')
  const [desiredKw, setDesiredKw] = useState<number | null>(null)
```

- [ ] **Step 3: Render the selectors**

Immediately after the Panel-grade segmented-control block (the `{/* ── Panel grade … */}` `</div>`), add:

```tsx
      {/* ── Power supply — segmented control ───────────────────── */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Power supply</span>
        <div className="grid grid-cols-3 border border-ink-line" role="radiogroup" aria-label="Power supply">
          {PHASE_OPTIONS.map((p, i) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={phase === p.value}
              onClick={() => setPhase(p.value)}
              className={`px-3 py-3 text-sm font-semibold transition-colors ${
                i > 0 ? 'border-l border-ink-line' : ''
              } ${
                phase === p.value
                  ? 'bg-accent text-ink-deep'
                  : 'bg-ink-deep text-text-sec hover:text-text-pri'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-text-dim">
          Check your switchboard — most homes are single-phase. 3-phase allows a larger system.
        </span>
      </div>

      {/* ── Preferred size — segmented control ─────────────────── */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass}>Preferred size (optional)</span>
        <div className="grid grid-cols-4 border border-ink-line" role="radiogroup" aria-label="Preferred system size">
          {SIZE_PRESETS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              role="radio"
              aria-checked={desiredKw === s.value}
              onClick={() => setDesiredKw(s.value)}
              className={`px-3 py-3 text-sm font-semibold transition-colors ${
                i > 0 ? 'border-l border-ink-line' : ''
              } ${
                desiredKw === s.value
                  ? 'bg-accent text-ink-deep'
                  : 'bg-ink-deep text-text-sec hover:text-text-pri'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
```

- [ ] **Step 4: Pass the new state into the payload builder**

In `onSubmit`, extend the `buildSolarFormPayload({ ... })` call:

```ts
      const payload = buildSolarFormPayload({
        address, postcode, state: stateCode, manualOpen,
        orientation, roofSize, storeys, panelType,
        customerName, customerMobile, quarterlyBill,
        variant,
        phase: phase === 'unknown' ? undefined : phase,
        desiredKw: desiredKw ?? undefined,
      })
```

- [ ] **Step 5: Typecheck + lint + manual verify**

Run: `npx tsc --noEmit && npx eslint "app/solar/[tenantSlug]/_components/SolarAddressForm.tsx"`
Expected: PASS.

Manual: `npm run dev`, open `/solar/<a-tenant-slug>`, choose 3-phase + 10 kW, submit, and confirm the resulting `/q/solar/[token]` quote shows "Power supply: 3-phase" and the headline tier reflects the requested size (or a clamp note).

- [ ] **Step 6: Commit**

```bash
git add "app/solar/[tenantSlug]/_components/SolarAddressForm.tsx"
git commit -m "feat(solar): customer power-supply + preferred-size selectors on the estimate form"
```

---

## Task 12: Parity guard + full verification

**Files:**
- Modify: `scripts/test-solar-parity.mjs`

- [ ] **Step 1: Add a no-regression parity assertion**

In `scripts/test-solar-parity.mjs`, add an assertion that an estimate run with **no** `phase`/`desired_kw` produces the same headline `system_kw_dc` and `export_limit_kw_ac` as before this change (single-phase default path). Follow the file's existing assertion style (it already exercises `runSolarEstimate`/`sizeSolarSystem` against fixtures). Assert specifically:
- a default (no phase) run and an explicit `phase: 'single'` run yield identical `export_limit_kw_ac`;
- a `phase: 'three'` run yields exactly `3×` that value.

- [ ] **Step 2: Run the parity script**

Run: `node --env-file=.env.local scripts/test-solar-parity.mjs`
Expected: all assertions pass, including the new ones.

- [ ] **Step 3: Run the full solar test suite + typecheck + lint**

Run: `npx vitest run lib/solar && npx tsc --noEmit && npx eslint lib/solar`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-solar-parity.mjs
git commit -m "test(solar): parity guard for phase-scaled export cap (single unchanged, 3-phase ×3)"
```

- [ ] **Step 5: Final review + push**

Review the full diff (`git log --oneline main..HEAD`, `git diff main...HEAD --stat`). Confirm every spec section is covered. Then push the branch and open a PR (ask the user before pushing if not already authorized).

---

## Self-review notes (author)

- **Spec coverage:** phase cap (Tasks 2-3), preferred-size anchoring + clamp (Tasks 2,4), migration/columns (Task 1,7), request+form (Task 5), threading (Task 6), tradie override both API and UI (Tasks 8-9), customer form (Task 11), display + clamp note (Task 10), parity/no-regression (Tasks 3,4,12). Batteries explicitly excluded — no task.
- **Threading decision (minor refinement vs spec):** `desiredKw` rides on `SolarEstimateContext` alongside `phase` rather than as a separate `sizeSolarSystem` arg, so the `sizeSolarSystem(...)` call site needs no signature change. Functionally identical to the spec.
- **Type consistency:** `SolarPhase = 'single' | 'three'` used everywhere; result fields `requested_kw`/`requested_kw_clamped`; context fields `phase`/`requested_system_kw`; columns `electrical_phase`/`requested_system_kw`; view-model `electricalPhase`/`requestedSystemKw`. Engine arg `desiredKw`; request field `desired_kw`.
- **Fixture/identifier caveats:** several test snippets reference existing fixtures/exports by illustrative names (`estimateFixture`, `baseRow`, `buildSolarPremiumQuote`). Each such step flags "match the actual name in the file" — the engineer confirms against the file header before writing the assertion.
