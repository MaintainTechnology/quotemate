import { afterEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { loadRepairAssets, repairPublicQuoteSchema, stripOuterTransaction } from '../scripts/repair-public-quote-schema.mjs'

const databases: PGlite[] = []
afterEach(async () => { for (const db of databases.splice(0)) await db.close() })
const tenant = '00000000-0000-4000-8000-000000000001'
const otherTenant = '00000000-0000-4000-8000-000000000002'
const intake = '00000000-0000-4000-8000-000000000003'
const quote = '00000000-0000-4000-8000-000000000004'
const book = '00000000-0000-4000-8000-000000000005'

async function fixture() {
  const pg = new PGlite()
  databases.push(pg)
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table tenants(id uuid primary key,business_name text,trade text);
    create table intakes(id uuid primary key,tenant_id uuid,trade text);
    create table pricing_book(id uuid primary key,tenant_id uuid,trade text,gst_registered boolean);
    create table quotes(id uuid primary key,tenant_id uuid,intake_id uuid,good jsonb,total_inc_gst numeric,status text,sent_at timestamptz);
    create table roofing_measurements(id uuid primary key);
    create table plan_uploads(id uuid primary key,filename text);
    create table plan_extractions(id uuid primary key,plan_upload_id uuid references plan_uploads(id),tenant_id uuid references tenants(id));
    create table aircon_recommendations(id uuid primary key,tenant_id uuid references tenants(id));
    create table paint_runs(id uuid primary key,tenant_id uuid references tenants(id));
    create table painting_measurements(id uuid primary key,tenant_id uuid references tenants(id));
    create table solar_estimates(id uuid primary key);`)
  const assets = loadRepairAssets()
  // Fill unrelated legacy reader fields. The columns repaired by this runner
  // remain absent, so its real canonical migration must create them.
  const repaired = new Set(['customer_released_at', 'customer_released_by', 'pricing_book_version_id', 'released_at'])
  for (const contract of assets.contracts) {
    const base = contract.select.replace(/[a-z_]+(?::[a-z_]+)?\([^()]+\)/g, '')
    for (const field of base.split(',').filter(Boolean)) {
      if (repaired.has(field) && !(contract.table === 'painting_measurements' && field === 'released_at')) continue
      await pg.exec(`alter table ${contract.table} add column if not exists ${field} text`)
    }
  }
  await pg.query('insert into tenants(id) values($1),($2)', [tenant, otherTenant])
  await pg.query('insert into intakes values($1,$2,$3)', [intake, tenant, 'electrical'])
  await pg.query('insert into pricing_book values($1,$2,$3,true)', [book, tenant, 'electrical'])
  await pg.query("insert into quotes(id,tenant_id,intake_id,good,total_inc_gst,status,sent_at) values($1,$2,$3,'{\"subtotal_ex_gst\":100}',110,'sent','2026-09-01T00:00:00Z')", [quote, tenant, intake])
  for (const table of ['roofing_measurements', 'plan_extractions', 'aircon_recommendations', 'paint_runs']) {
    await pg.query(`insert into ${table}(id) values($1)`, [quote])
  }
  const db = { query: async (sql: string, params?: unknown[]) => params ? pg.query(sql, params) : (await pg.exec(sql)).at(-1) ?? { rows: [] } }
  return { pg, db, assets }
}

describe('public quote schema incident repair', () => {
  it('is read-only by default and plans the exact missing contracts', async () => {
    const { pg, db, assets } = await fixture()
    const result = await repairPublicQuoteSchema(db, { assets })
    expect(result.mode).toBe('dry-run')
    expect(result.addedColumns).toHaveLength(6)
    expect(result.applyMigration207).toBe(true)
    expect((await pg.query("select to_regclass('public.quote_pricing_versions') as found")).rows[0]).toEqual({ found: null })
    await expect(pg.query('select customer_released_at from quotes')).rejects.toThrow('does not exist')
  })

  it('restores all readers, preserves existing content and approvals, and can be rerun', async () => {
    const { pg, db, assets } = await fixture()
    await pg.exec('alter table quotes add column customer_released_at timestamptz')
    await pg.query("update quotes set customer_released_at='2026-09-02T00:00:00Z' where id=$1", [quote])
    const before = (await pg.query('select good,total_inc_gst,status,sent_at,customer_released_at from quotes')).rows
    const result = await repairPublicQuoteSchema(db, { apply: true, assets })
    expect(result.publicFamiliesVerified).toBe(7)
    expect((await pg.query('select good,total_inc_gst,status,sent_at,customer_released_at from quotes')).rows).toEqual(before)
    expect((await pg.query('select customer_released_by,pricing_book_version_id from quotes')).rows[0]).toEqual({ customer_released_by: null, pricing_book_version_id: null })
    for (const table of ['roofing_measurements', 'plan_extractions', 'aircon_recommendations', 'paint_runs']) {
      expect((await pg.query(`select released_at from ${table}`)).rows[0]).toEqual({ released_at: null })
    }
    const again = await repairPublicQuoteSchema(db, { apply: true, assets })
    expect(again.addedColumns).toEqual([])
    expect(again.applyMigration207).toBe(false)
    expect((await pg.query('select good,total_inc_gst,status,sent_at,customer_released_at from quotes')).rows).toEqual(before)
    expect((await pg.query("select to_regclass('public.sms_outbox') as outbox, to_regprocedure('public.approve_generic_quote_release(uuid,uuid,text,jsonb,timestamptz,jsonb,text)') as approval")).rows[0]).toEqual({ outbox: null, approval: null })
  })

  it('installs canonical pricing ownership, immutable snapshot and FK protections', async () => {
    const { pg, db, assets } = await fixture()
    await repairPublicQuoteSchema(db, { apply: true, assets })
    const snapshot = (await pg.query('select to_jsonb(p) as snapshot from pricing_book p')).rows[0].snapshot
    const saved = (await pg.query('select capture_quote_pricing_version($1,$2,$3,$4::jsonb) as version', [tenant, 'electrical', book, JSON.stringify(snapshot)])).rows[0].version as { id: string }
    await pg.query('update quotes set pricing_book_version_id=$1 where id=$2', [saved.id, quote])
    await expect(pg.query('update quote_pricing_versions set trade=$1 where id=$2', ['plumbing', saved.id])).rejects.toThrow('immutable')
    await expect(pg.query('update quotes set pricing_book_version_id=null where id=$1', [quote])).rejects.toThrow('immutable')
    await expect(pg.query('update quotes set tenant_id=$1 where id=$2', [otherTenant, quote])).rejects.toThrow('ownership mismatch')
    await expect(pg.query('delete from quote_pricing_versions where id=$1', [saved.id])).rejects.toThrow('foreign key constraint')
    await expect(pg.query('select capture_quote_pricing_version($1,$2,$3,$4::jsonb)', [tenant, 'electrical', book, '{}'])).rejects.toThrow('pricing revision changed')
  })

  it('rejects partial migration 207 before adding any release columns', async () => {
    const { pg, db, assets } = await fixture()
    await pg.exec('alter table quotes add column pricing_book_version_id uuid')
    await expect(repairPublicQuoteSchema(db, { apply: true, assets })).rejects.toThrow('Partial migration 207')
    await expect(pg.query('select customer_released_at from quotes')).rejects.toThrow('does not exist')
  })

  it('rolls back the complete repair when reader verification fails', async () => {
    const { pg, db, assets } = await fixture()
    await pg.exec('alter table quotes drop column good')
    await expect(repairPublicQuoteSchema(db, { apply: true, assets })).rejects.toThrow('does not exist')
    expect((await pg.query("select to_regclass('public.quote_pricing_versions') as found")).rows[0]).toEqual({ found: null })
    await expect(pg.query('select customer_released_at from quotes')).rejects.toThrow('does not exist')
  })

  it('never strips unexpected nested transaction boundaries', () => {
    expect(stripOuterTransaction('-- reviewed\nbegin;\nselect 1;\ncommit;')).toContain('select 1;')
    expect(() => stripOuterTransaction('begin;\nselect 1;\ncommit;\nbegin;\ncommit;')).toThrow('exactly one')
    expect(() => stripOuterTransaction('select 1;')).toThrow('exactly one')
  })
})
