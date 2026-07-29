// Phase 3 — an ordered task checklist per job, owned by the tradie.
//
// There is no task, step or checklist table anywhere in the schema today: the
// "task list" for a job is one free-text shared_assemblies.description and a
// single default_labour_hours scalar. This adds the pair that mirrors the BOM
// tables (028 shared / 031 tenant), so a tradie can fork the standard steps and
// edit their own copy without touching everyone else's.
//
// NO hours per task — settled decision. default_labour_hours stays the single
// source of labour. The shape must not preclude adding hours later.
//
// Migration assertions read the .sql as TEXT (no database needed), following
// lib/roofing/edge-analysis-migration.test.ts.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TenantTaskLineSchema } from './update-schema'

const root = process.cwd()
const upPath = resolve(root, 'sql', 'migrations', '184_assembly_tasks.sql')
const downPath = resolve(root, 'sql', 'migrations', '184_down.sql')
const runnerPath = resolve(root, 'scripts', 'run-migration-184.mjs')

describe('Phase 3 — migration 184 creates both task tables', () => {
  it('the migration, its down and its runner all exist', () => {
    expect(existsSync(upPath), '184_assembly_tasks.sql').toBe(true)
    // 24 of 25 down files use the bare NNN_down.sql form; 183 is the outlier.
    expect(existsSync(downPath), '184_down.sql').toBe(true)
    expect(existsSync(runnerPath), 'run-migration-184.mjs').toBe(true)
  })

  it('creates shared_assembly_tasks and tenant_assembly_tasks', () => {
    const sql = readFileSync(upPath, 'utf8')
    expect(sql).toMatch(/create table if not exists shared_assembly_tasks/i)
    expect(sql).toMatch(/create table if not exists tenant_assembly_tasks/i)
  })

  it('mirrors the BOM identity columns, with title in place of material_category', () => {
    const sql = readFileSync(upPath, 'utf8')
    expect(sql).toMatch(/title text not null/i)
    expect(sql).toMatch(/notes text/i)
    expect(sql).toMatch(/required boolean not null default true/i)
    expect(sql).toMatch(/sort int not null default 0/i)
  })

  it('carries NO per-task hours column — the settled decision', () => {
    // Strip `--` comments first: the header legitimately explains WHY hours
    // live on shared_assemblies.default_labour_hours, and that prose must not
    // trip an assertion about the schema.
    const schemaOnly = readFileSync(upPath, 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
    expect(schemaOnly).not.toMatch(/hours/i)
  })

  it('copies the two-trade CHECK from the BOM tables verbatim', () => {
    const sql = readFileSync(upPath, 'utf8')
    const checks = sql.match(/check \(trade in \('electrical', 'plumbing'\)\)/g) ?? []
    expect(checks.length, 'one per table').toBe(2)
  })

  it('cascades from shared_assemblies and, for the tenant table, from tenants', () => {
    const sql = readFileSync(upPath, 'utf8')
    const asmFks =
      sql.match(/assembly_id uuid not null references shared_assemblies\(id\) on delete cascade/g) ??
      []
    expect(asmFks.length, 'one per table').toBe(2)
    expect(sql).toMatch(/tenant_id uuid not null references tenants\(id\) on delete cascade/i)
  })

  it('adds the two unique indexes keyed on lower(title)', () => {
    const sql = readFileSync(upPath, 'utf8')
    expect(sql).toMatch(
      /create unique index if not exists shared_assembly_tasks_unique\s+on shared_assembly_tasks \(assembly_id, lower\(title\)\)/i,
    )
    expect(sql).toMatch(
      /create unique index if not exists tenant_assembly_tasks_unique\s+on tenant_assembly_tasks \(tenant_id, assembly_id, lower\(title\)\)/i,
    )
  })

  it('gives ONLY the tenant table updated_at plus its trigger, mirroring 031', () => {
    const sql = readFileSync(upPath, 'utf8')
    // shared_assembly_bom has created_at only and no trigger; mirror that.
    expect((sql.match(/updated_at timestamptz not null default now\(\)/g) ?? []).length).toBe(1)
    expect(sql).toMatch(/create or replace function tenant_assembly_tasks_set_updated_at/i)
    expect(sql).toMatch(/create trigger tenant_assembly_tasks_set_updated_at/i)
    expect(sql).not.toMatch(/shared_assembly_tasks_set_updated_at/i)
  })

  it('kicks the PostgREST schema cache, as 028 and 031 do', () => {
    expect(readFileSync(upPath, 'utf8')).toMatch(/notify pgrst, 'reload schema'/i)
  })

  it('the down migration drops both tables and the trigger function', () => {
    const sql = readFileSync(downPath, 'utf8')
    expect(sql).toMatch(/drop table if exists (public\.)?tenant_assembly_tasks cascade/i)
    expect(sql).toMatch(/drop table if exists (public\.)?shared_assembly_tasks cascade/i)
    expect(sql).toMatch(/drop function if exists (public\.)?tenant_assembly_tasks_set_updated_at/i)
  })

  it('the runner is dry-run by default and opts in with --apply, like 031', () => {
    const js = readFileSync(runnerPath, 'utf8')
    expect(js).toMatch(/--apply/)
    expect(js).toMatch(/DRY RUN/i)
    expect(js).toMatch(/information_schema\.tables/i)
  })
})

describe('Phase 3 — TenantTaskLineSchema mirrors TenantBomLineSchema', () => {
  const valid = {
    assembly_id: '11111111-1111-4111-8111-111111111111',
    trade: 'electrical' as const,
    title: 'Mount the fitting',
  }

  it('accepts a minimal task line', () => {
    const r = TenantTaskLineSchema.safeParse(valid)
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true)
  })

  it('rejects an empty or whitespace-only title', () => {
    expect(TenantTaskLineSchema.safeParse({ ...valid, title: '' }).success).toBe(false)
    expect(TenantTaskLineSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false)
  })

  it('rejects an out-of-range sort, bounded like the BOM schema', () => {
    expect(TenantTaskLineSchema.safeParse({ ...valid, sort: -1 }).success).toBe(false)
    expect(TenantTaskLineSchema.safeParse({ ...valid, sort: 1000 }).success).toBe(false)
    expect(TenantTaskLineSchema.safeParse({ ...valid, sort: 3 }).success).toBe(true)
  })

  it('rejects a non-uuid assembly_id', () => {
    expect(TenantTaskLineSchema.safeParse({ ...valid, assembly_id: 'nope' }).success).toBe(false)
  })

  it('has no hours field — a caller cannot smuggle one in', () => {
    const r = TenantTaskLineSchema.safeParse({ ...valid, labour_hours: 2 })
    // Zod strips unknown keys by default; assert it never reaches the output.
    expect(r.success).toBe(true)
    if (r.success) expect('labour_hours' in r.data).toBe(false)
  })
})
