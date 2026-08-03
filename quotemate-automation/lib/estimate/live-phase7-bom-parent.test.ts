// Phase 7 — exactly one parent on a recipe line, asserted against the LIVE
// schema.
//
// Migration 187 makes assembly_id NULLABLE so a line can hang off a tenant's
// own custom job instead. That widening is only safe because of the
// tenant_assembly_bom_one_parent CHECK: without it the column accepts a row
// with NO parent at all — an orphan the estimator would never find, that
// nobody would ever see in the Estimating tab, and that no test of the
// application code could detect because the application never creates one.
//
// The runner verifies this at apply time. This is the standing version: it
// fails if someone later drops the constraint, marks it NOT VALID, or restores
// NOT NULL on assembly_id and quietly breaks custom-parented recipes.
//
// Read-only apart from two probe inserts that are ALWAYS rolled back. Run with:
//   LIVE_DB=1 node --env-file=.env.local \
//     ./node_modules/vitest/vitest.mjs run \
//     lib/estimate/live-phase7-bom-parent.test.ts --testTimeout=120000

import { describe, it, expect } from 'vitest'
import { Client } from 'pg'

const LIVE = !!process.env.LIVE_DB

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

describe.skipIf(!LIVE)('Phase 7 — tenant_assembly_bom parents (LIVE_DB)', () => {
  it('both parent columns exist and are NULLABLE', async () => {
    const rows = await withDb(async (c) => {
      const { rows } = await c.query(
        `select column_name, is_nullable from information_schema.columns
          where table_name = 'tenant_assembly_bom'
            and column_name in ('assembly_id','custom_assembly_id')
          order by column_name`,
      )
      return rows as Array<{ column_name: string; is_nullable: string }>
    })
    expect(rows.map((r) => r.column_name)).toEqual(['assembly_id', 'custom_assembly_id'])
    // assembly_id MUST stay nullable — restoring NOT NULL silently makes every
    // custom-parented recipe line un-insertable.
    for (const r of rows) expect(r.is_nullable, r.column_name).toBe('YES')
  })

  it('the one-parent CHECK exists and is VALIDATED', async () => {
    // NOT VALID would guard future writes while leaving existing rows unproven,
    // which is exactly the ambiguity worth catching.
    const rows = await withDb(async (c) => {
      const { rows } = await c.query(
        `select convalidated from pg_constraint
          where conrelid = 'tenant_assembly_bom'::regclass
            and conname = 'tenant_assembly_bom_one_parent'`,
      )
      return rows as Array<{ convalidated: boolean }>
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].convalidated).toBe(true)
  })

  it('the custom parent cascades on delete', async () => {
    // Deliberately different from migration 185's catalogue_id (SET NULL): a
    // deleted PRODUCT leaves a line that still needs a part in that category,
    // but a deleted ASSEMBLY means the job is gone and its lines describe
    // nothing.
    const rows = await withDb(async (c) => {
      const { rows } = await c.query(
        `select confdeltype from pg_constraint
          where conrelid = 'tenant_assembly_bom'::regclass
            and contype = 'f'
            and conkey = array[(
              select attnum from pg_attribute
               where attrelid = 'tenant_assembly_bom'::regclass
                 and attname = 'custom_assembly_id')]`,
      )
      return rows as Array<{ confdeltype: string }>
    })
    expect(rows[0]?.confdeltype).toBe('c')
  })

  it('every live row satisfies exactly one parent', async () => {
    const bad = await withDb(async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from tenant_assembly_bom
          where (assembly_id is null) = (custom_assembly_id is null)`,
      )
      return (rows[0] as { n: number }).n
    })
    expect(bad, 'rows with no parent or two parents').toBe(0)
  })

  it('the database REJECTS a row with no parent', async () => {
    // Proves the constraint bites rather than merely existing. Rolled back.
    const rejected = await withDb(async (c) => {
      await c.query('begin')
      try {
        await c.query(
          `insert into tenant_assembly_bom (tenant_id, trade, material_category, quantity)
             select tenant_id, trade, 'probe-no-parent', 1 from tenant_assembly_bom limit 1`,
        )
        return false
      } catch {
        return true
      } finally {
        await c.query('rollback')
      }
    })
    expect(rejected).toBe(true)
  })

  it('the database REJECTS a row with two parents', async () => {
    const rejected = await withDb(async (c) => {
      await c.query('begin')
      try {
        await c.query(
          `insert into tenant_assembly_bom
             (tenant_id, trade, material_category, quantity, assembly_id, custom_assembly_id)
           select tenant_id, trade, 'probe-two-parents', 1, assembly_id,
                  (select id from tenant_custom_assemblies limit 1)
             from tenant_assembly_bom where assembly_id is not null limit 1`,
        )
        return false
      } catch {
        return true
      } finally {
        await c.query('rollback')
      }
    })
    expect(rejected).toBe(true)
  })
})
