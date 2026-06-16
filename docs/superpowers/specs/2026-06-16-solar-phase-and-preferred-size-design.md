# Solar Estimate: 3-phase power + preferred system size — design

> Date: 2026-06-16
> Status: approved design, pre-plan
> Scope owner: solar estimate engine (`quotemate-automation/lib/solar/*`)
> Related: [2026-06-08 solar estimate design](2026-06-08-solar-estimate-design.md), [feasibility research](2026-06-08-solar-estimate-feasibility-research.md)

## Summary

Add two new inputs to the Solar Estimate that change the system size offered to a customer:

1. **Electrical phase** — single-phase vs 3-phase supply at the property. Today the sizing engine caps every system at the single-phase DNSP export limit (5 kW/phase), which **silently under-sizes every 3-phase home**. Capturing phase fixes this.
2. **Preferred system size (kW)** — lets a customer or tradie target a size (e.g. 6.6 / 10 / 13.2 kW) instead of always taking the roof-derived ladder.

Both inputs are captured **two ways**: declared by the customer on the public solar form (optional), and overridden by the tradie on the dashboard re-draft action (authoritative — tradie value wins). Both entry points flow through the same `runSolarEstimate → sizeSolarSystem` engine, so the sizing logic is written once.

**Batteries are explicitly out of scope** for this release (next release). The phase field here affects **only** the export cap / maximum system size — it does not select inverter hardware.

## Why this is worth doing now

- **Correctness, not just a feature.** `lib/solar/config.ts` already stores the export limit as `default_kw_per_phase = 5`, and `lib/solar/sizing.ts` already caps tiers by it — but applies a single flat 5 kW AC cap to everyone, i.e. it assumes single-phase. A 3-phase property can legitimately run ~3× the export. So today's estimator hands 3-phase homes a smaller system than they qualify for.
- **Contained.** The cap is already keyed "per phase" with a `by_network` override structure; preferred-size slots into the existing tier-generation step. Both share one engine change.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Scope this release | 3-phase + preferred size. Batteries deferred to next release. |
| Input placement | Both: customer-declared (optional) **and** tradie override on re-draft. Tradie value wins. |
| 3-phase cap rule | Multiply the per-phase cap by phase count: single = ×1 (5 kW), 3-phase = ×3 (15 kW). Per-network overrides still apply (and scale the same way). |
| Preferred-size tier semantics | Anchor the headline **Best** tier at the requested kW; **Better** ≈ 90%, **Good** ≈ 75%, all bounded by roof capacity + phase-adjusted export cap. |
| Over-target behavior | Clamp to the max feasible size and flag it (`requested_kw_clamped`), **not** route to inspection. Quote page shows a short note. |
| Override storage | Dedicated columns on `solar_estimates` (queryable, dashboard-friendly, survive re-drafts), not buried in the `estimate` jsonb. |

## Architecture

### Data flow (unchanged shape, two new fields threaded through)

```
Customer form (SolarAddressForm) ──┐
                                   ├─▶ POST /api/solar/[tenantSlug]/estimate
Tradie re-draft (SolarTab) ────────┘        │  (validates SolarEstimateRequest)
                                            ▼
                                   runSolarEstimate(args)        lib/solar/intake.ts
                                            │  builds context, calls…
                                            ▼
                                   sizeSolarSystem({ roof, panelType, config, context,
                                                     phase, desiredKw })   lib/solar/sizing.ts
                                            │  phase → export cap; desiredKw → anchored tiers
                                            ▼
                                   buildSolarRowPayloads → solar_estimates row
                                   (INSERT on first estimate, UPDATE-in-place on re-draft)
```

### Component changes

#### 1. Sizing engine — `lib/solar/sizing.ts` (core)

`sizeSolarSystem` gains two args:
- `phase: 'single' | 'three'` (default `'single'`)
- `desiredKw?: number`

**Phase → export cap.** Replace the flat AC cap with a phase-aware one:

```
phaseCount      = phase === 'three' ? 3 : 1
perPhaseCapKw   = config.export_limits.by_network[network] ?? config.export_limits.default_kw_per_phase
export_limit_kw_ac = perPhaseCapKw × phaseCount
```

Everything downstream (DC ceiling = `export_limit_kw_ac / derate_factor`, the `export_limited` flag) is unchanged. `by_network` values keep their current per-phase meaning, so the override scales by phase count exactly like the default.

**Preferred size → anchored ladder.** When `desiredKw` is set:
1. `targetPanels = round(desiredKw × 1000 / panel_capacity_watts)`
2. `maxFeasible = min(max_panels_count, exportCeilPanels)`; `effectiveBest = clamp(targetPanels, 1, maxFeasible)`
3. If `effectiveBest < targetPanels` → set `requested_kw_clamped = true`
4. Generate tiers anchored at `effectiveBest`: **Best** = `effectiveBest`, **Better** = `ceil(effectiveBest × 0.90)`, **Good** = `ceil(effectiveBest × 0.75)`; dedup ascending, filter to ≥1, and apply the existing "fewer than 2 distinct tiers → fall back / inspection" rule.

When `desiredKw` is **not** set, the current 55% / 80% / 100%-of-roof tier logic is untouched.

**New result fields** on the sizing output: echo `requested_kw` (or null), `requested_kw_clamped` (boolean), and `phase`.

#### 2. Config / types — `lib/solar/config.ts`, `lib/solar/types.ts`

No new config knobs required — `default_kw_per_phase` and `by_network` are reused. Add `phase` and `desiredKw`/`requested_kw` fields to the relevant types (`SolarEstimateContext`, `SolarSizingResult`, sizing args).

#### 3. Migration — `sql/migrations/114_solar_phase_and_requested_size.sql` (+ `scripts/run-migration-114.mjs`)

```sql
alter table solar_estimates
  add column if not exists electrical_phase text not null default 'single'
    check (electrical_phase in ('single','three')),
  add column if not exists requested_system_kw numeric
    check (requested_system_kw is null or (requested_system_kw > 0 and requested_system_kw <= 30));
```

`requested_kw_clamped` is **not** a column — it lives as a derived flag inside the `sizing` jsonb, computed at estimate time. Keep `sql/init.sql` representative.

#### 4. Request schema + threading — `lib/solar/request-schema.ts`, estimate route, `lib/solar/intake.ts`, `lib/solar/persist-helpers.ts`

- `request-schema.ts`: add optional `phase: z.enum(['single','three'])` and `desired_kw: z.number().positive().max(30)`.
- Estimate route (`app/api/solar/[tenantSlug]/estimate/route.ts`): extract both, pass to `runSolarEstimate`.
- `intake.ts` `runSolarEstimate`: add `phase?` and `desiredKw?` to the args object; thread into `context` and the `sizeSolarSystem` call.
- `persist-helpers.ts` `buildSolarRowPayloads`: write `electrical_phase` and `requested_system_kw` to the two new columns.

#### 5. Customer form — `app/solar/[tenantSlug]/_components/SolarAddressForm.tsx`, `lib/solar/form-payload.ts`

Two new optional controls, mirroring the existing segmented `panelType` pattern and the Maintain design system:
- **Power supply:** `Single-phase` / `3-phase` / `Not sure` (default). Helper text: "Check your switchboard — most homes are single-phase." `Not sure` → field omitted, engine defaults to single.
- **Preferred size:** presets `6.6` / `10` / `13.2` kW + `Let us recommend` (default). Optional; only sent when a preset is chosen.

`form-payload.ts`: include `phase` / `desired_kw` in the payload only when set (matching the existing optional-field pattern for customer/energy).

#### 6. Tradie override (re-draft) — `app/api/solar/redraft/[token]/route.ts`, `lib/solar/redraft.ts`, `app/dashboard/_components/SolarTab.tsx`, `lib/solar/dashboard-view.ts`

The re-draft action already re-runs the full engine in-place (same `public_token`, UPDATE not INSERT). Extend it:
- Re-draft route accepts an optional JSON body `{ phase?, desired_kw? }`.
- `reconstructSolarInputs` resolves each value as: **tradie override → else persisted column → else customer-declared value**, then re-runs `runSolarEstimate`. Because overrides persist to the columns, a tradie sets phase/size once and it sticks across subsequent re-drafts.
- `SolarTab` cards gain a small phase select + size input beside the existing **Re-draft** button; `dashboard-view.ts` exposes the current `electrical_phase` and `requested_system_kw` so the controls reflect current state.

#### 7. Display — `lib/solar/premium-quote.ts`, quote page

Phase and (when set) requested size appear in the assumed-values table. When `requested_kw_clamped` is true, the quote page shows a short note: "Capped at X kW by your roof / connection."

## Error handling & edge cases

- **`desired_kw` above roof or phase cap** → clamp to max feasible, set `requested_kw_clamped`, still produce an honest tiered quote (no inspection routing for this reason alone).
- **`desired_kw` so small only one distinct tier results** → existing "fewer than 2 distinct tiers" rule applies (single-tier fallback or inspection per current behavior).
- **`phase` absent / `Not sure`** → defaults to `single` everywhere; identical to today's behavior (no regression for existing single-phase estimates).
- **Legacy rows** (pre-migration) → `electrical_phase` defaults to `single`, `requested_system_kw` null; re-draft reproduces today's numbers unless a tradie sets an override.
- **Network override present** → still honored; multiplied by phase count consistently.

## Testing

- **Unit (`lib/solar/sizing.ts`):** phase cap math — single (×1) vs three (×3); network-override × phase count; preferred-size anchoring (Best/Better/Good at 100/90/75%); the three clamp cases (target within limits, target above roof, target above export cap); `requested_kw_clamped` flag correctness.
- **Schema:** `request-schema` accepts and omits the new optional fields correctly.
- **Persistence + override:** a re-draft body with `{ phase, desired_kw }` threads through and persists to the columns; resolution order (override → column → customer) holds across two re-drafts.
- **Parity:** extend `scripts/test-solar-parity.mjs` so existing single-phase, no-target estimates produce byte-identical numbers (no regression).

## Out of scope (next release)

- Batteries: sizing, pricing, STC + Cheaper Home Batteries / NSW PDRS VPP rebates, and battery-aware economics (self-consumption uplift, payback recalc). Battery hardware is already modeled display-only (`lib/solar/hardware-cards.ts`, Pylon/OpenSolar) but excluded from the money path.
- Inverter-phase hardware selection (single vs three-phase inverter product). Phase here only drives the export cap.
```
