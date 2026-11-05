import { afterEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { loadSmsRepairAssets, repairSmsDashboardSchema } from '../scripts/repair-sms-dashboard-schema.mjs'

const databases: PGlite[] = []
afterEach(async () => { for (const pg of databases.splice(0)) await pg.close() })
const tenant = '00000000-0000-4000-8000-000000000001'
const otherTenant = '00000000-0000-4000-8000-000000000002'

async function fixture() {
  const pg = new PGlite()
  databases.push(pg)
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create table tenants(id uuid primary key);
    create table sms_conversations(id uuid primary key default gen_random_uuid(),from_number text,to_number text,status text,conversation_type text,tenant_id uuid);
    create table sms_messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,direction text,body text,twilio_message_sid text,audience text default 'customer',to_number text,tenant_id uuid);
    create unique index sms_messages_unique_inbound_sid_idx on sms_messages(twilio_message_sid) where direction='inbound' and twilio_message_sid is not null;
    create table intakes(id uuid primary key); create table quotes(id uuid primary key,customer_released_at timestamptz,customer_released_by text,pricing_book_version_id uuid);
    create table plan_upload_requests(id uuid primary key default gen_random_uuid(),token text not null unique,tenant_id uuid,sms_conversation_id uuid,customer_phone text,twilio_number text,status text,created_at timestamptz default now(),updated_at timestamptz default now(),expires_at timestamptz default now()+interval '7 days');
    insert into sms_messages(direction,body,twilio_message_sid) values ('outbound','Existing accepted message','SMfixture'),('outbound','Existing unknown message',null),('inbound','Existing customer message','SMinbound');`)
  await pg.query('insert into tenants values($1),($2)', [tenant, otherTenant])
  const db = { query: async (sql: string, values?: unknown[]) => values ? pg.query(sql, values) : (await pg.exec(sql)).at(-1) ?? { rows: [] } }
  return { pg, db, assets: loadSmsRepairAssets() }
}

describe('SMS dashboard schema repair', () => {
  it('dry-runs without writes and restricts canonical201 to its exact human-task block', async () => {
    const { pg, db, assets } = await fixture()
    expect(assets.humanTasks).toContain('create table if not exists public.sms_human_tasks')
    expect(assets.humanTasks).not.toMatch(/sms_release_quote_resource|sms_save_solar_estimate|create or replace function/)
    const result = await repairSmsDashboardSchema(db, { assets })
    expect(result.mode).toBe('dry-run')
    expect(result.installRequired).toBe(true)
    expect(result.legacyClassification).toEqual({ provider_accepted: 1, unknown: 1 })
    expect((await pg.query("select to_regclass('public.sms_outbox') as found")).rows[0]).toEqual({ found: null })
    await expect(pg.query('select delivery_status from sms_messages')).rejects.toThrow('does not exist')
  })

  it('restores projections and service-only controls without creating sends or exposing approval RPCs', async () => {
    const { pg, db, assets } = await fixture()
    const before = (await pg.query('select id,direction,body,twilio_message_sid from sms_messages order by body')).rows
    await repairSmsDashboardSchema(db, { apply: true, assets })
    expect((await pg.query('select id,direction,body,twilio_message_sid from sms_messages order by body')).rows).toEqual(before)
    expect((await pg.query('select delivery_status from sms_messages order by body')).rows).toEqual([{ delivery_status: 'accepted' }, { delivery_status: null }, { delivery_status: 'unknown' }])
    for (const table of ['sms_outbox', 'sms_work_jobs', 'sms_human_tasks']) expect((await pg.query(`select count(*)::int as count from ${table}`)).rows[0]).toEqual({ count: 0 })
    expect((await pg.query("select to_regprocedure('public.sms_release_quote_resource(uuid,text,uuid,text,jsonb,text,jsonb)') as release,to_regprocedure('public.approve_generic_quote_release(uuid,uuid,text,jsonb,timestamptz,jsonb,text)') as generic")).rows[0]).toEqual({ release: null, generic: null })
    const again = await repairSmsDashboardSchema(db, { apply: true, assets })
    expect(again.installRequired).toBe(false)
    expect(again.legacyClassification).toEqual({ provider_accepted: 0, unknown: 0 })
  })

  it('supports tenant-bound definite-failure retries while protecting unknown and opted-out messages', async () => {
    const { pg, db, assets } = await fixture()
    await repairSmsDashboardSchema(db, { apply: true, assets })
    for (const [status, error, expected] of [['failed', null, true], ['undelivered', '21610', false], ['unknown', null, false], ['accepted', null, false]] as const) {
      const row = (await pg.query<{ id: string }>(`insert into sms_outbox(delivery_key,payload_hash,payload,tenant_id,body,to_number,status,provider_error)
        values(gen_random_uuid()::text,'fixture','{}',$1,'fixture','+61400000000',$2,$3) returning id`, [tenant, status, error])).rows[0]
      expect((await pg.query('select sms_outbox_retry($1,$2) as retried', [row.id, otherTenant])).rows[0]).toEqual({ retried: false })
      expect((await pg.query('select sms_outbox_retry($1,$2) as retried', [row.id, tenant])).rows[0]).toEqual({ retried: expected })
    }
    const task = (await pg.query<{ id: string }>(`insert into sms_human_tasks(tenant_id,customer_phone,request_key,trade,reason) values($1,'+61400000000','fixture','electrical','Review') returning id`, [tenant])).rows[0]
    await pg.query("update sms_human_tasks set status='resolved',updated_at=now() where id=$1 and tenant_id=$2", [task.id, tenant])
    expect((await pg.query('select status from sms_human_tasks where id=$1', [task.id])).rows[0]).toEqual({ status: 'resolved' })
  })

  it('rejects partial installations before altering legacy messages', async () => {
    const { pg, db, assets } = await fixture()
    await pg.exec('alter table quotes add column sms_work_id uuid')
    await expect(repairSmsDashboardSchema(db, { apply: true, assets })).rejects.toThrow('Partial SMS')
    await expect(pg.query('select delivery_status from sms_messages')).rejects.toThrow('does not exist')
  })

  it('rolls back all schema and evidence changes if a required dependency is absent', async () => {
    const { pg, db, assets } = await fixture()
    await pg.exec('drop table tenants')
    await expect(repairSmsDashboardSchema(db, { apply: true, assets })).rejects.toThrow('does not exist')
    expect((await pg.query("select to_regclass('public.sms_work_jobs') as found")).rows[0]).toEqual({ found: null })
    await expect(pg.query('select delivery_status from sms_messages')).rejects.toThrow('does not exist')
  })

  it('refuses to overwrite changed functions or accept elevated browser grants on rerun', async () => {
    const { pg, db, assets } = await fixture()
    await repairSmsDashboardSchema(db, { apply: true, assets })
    await pg.exec('grant select on sms_human_tasks to anon')
    await expect(repairSmsDashboardSchema(db, { apply: true, assets })).rejects.toThrow('security contract')
    await pg.exec('revoke select on sms_human_tasks from anon')
    await pg.exec('create or replace function sms_outbox_retry(p_id uuid,p_tenant uuid) returns boolean language sql security definer as $$select true$$')
    await expect(repairSmsDashboardSchema(db, { apply: true, assets })).rejects.toThrow('Unexpected SMS function definition')
  })
})
