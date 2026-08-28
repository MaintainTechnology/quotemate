import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'sql', 'migrations', '191_push_tokens.sql'),
  'utf8',
)

const databases: PGlite[] = []

async function databaseWithPrerequisites(): Promise<PGlite> {
  const db = new PGlite()
  databases.push(db)
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.tenants (id uuid primary key);
    create table public.sms_conversations (id uuid primary key);
  `)
  return db
}

async function uniqueColumnSets(db: PGlite): Promise<string[][]> {
  const result = await db.query<{ columns: string[] }>(`
    select array_agg(attribute.attname order by indexed.ordinality) as columns
    from pg_index index_definition
    cross join lateral unnest(index_definition.indkey::smallint[]) with ordinality as indexed(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = index_definition.indrelid
     and attribute.attnum = indexed.attnum
    where index_definition.indrelid = 'public.push_tokens'::regclass
      and index_definition.indisunique
      and not index_definition.indisprimary
    group by index_definition.indexrelid
  `)
  return result.rows.map(row => row.columns)
}

async function createLegacyTable(db: PGlite, uniquenessSql: string): Promise<void> {
  await db.exec(`
    create table public.push_tokens (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references public.tenants(id) on delete cascade,
      user_id text,
      token text not null,
      platform text not null check (platform in ('ios', 'android')),
      device_name text,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now()
    );
    ${uniquenessSql}
  `)
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map(db => db.close()))
})

describe('191 push token migration — executable PostgreSQL contract', () => {
  it('applies to a fresh schema and is rerunnable', async () => {
    const db = await databaseWithPrerequisites()

    await db.exec(migrationSql)
    await db.exec(migrationSql)

    expect(await uniqueColumnSets(db)).toEqual([['tenant_id', 'user_id', 'token']])
  })

  it.each([
    ['legacy constraint', 'alter table public.push_tokens add constraint arbitrary_old_key unique (tenant_id, token);'],
    ['reversed legacy constraint', 'alter table public.push_tokens add constraint backwards_old_key unique (token, tenant_id);'],
    ['standalone legacy index', 'create unique index arbitrary_old_index on public.push_tokens (tenant_id, token);'],
    ['reversed standalone index', 'create unique index backwards_old_index on public.push_tokens (token, tenant_id);'],
  ])('replaces a %s by indexed column semantics', async (_label, uniquenessSql) => {
    const db = await databaseWithPrerequisites()
    await createLegacyTable(db, uniquenessSql)

    await db.exec(migrationSql)

    expect(await uniqueColumnSets(db)).toEqual([['tenant_id', 'user_id', 'token']])

    const tenantId = '00000000-0000-4000-8000-000000000001'
    await db.query('insert into public.tenants (id) values ($1)', [tenantId])
    await db.query(`
      insert into public.push_tokens (tenant_id, user_id, token, platform)
      values ($1, 'seat-a', 'ExponentPushToken[shared]', 'ios'),
             ($1, 'seat-b', 'ExponentPushToken[shared]', 'ios')
    `, [tenantId])
    const count = await db.query<{ count: number }>('select count(*)::int as count from public.push_tokens')
    expect(count.rows[0]?.count).toBe(2)
  })

  it('atomically records ticket identity and exact DNR pruning before terminalising deliveries', async () => {
    const db = await databaseWithPrerequisites()
    await db.exec(migrationSql)
    const tenantId = '00000000-0000-4000-8000-000000000001'
    const eventId = '00000000-0000-4000-8000-000000000002'
    await db.query('insert into public.tenants (id) values ($1)', [tenantId])
    await db.query(`
      insert into public.push_tokens (tenant_id, user_id, token, platform)
      values ($1, 'seat-a', 'ExponentPushToken[a]', 'ios'),
             ($1, 'seat-b', 'ExponentPushToken[b]', 'android')
    `, [tenantId])
    await db.query(`
      insert into public.push_events (id, event_key, tenant_id, title, body, url)
      values ($1, 'event:atomic', $2, 'New lead', 'Body', '/chats')
    `, [eventId, tenantId])
    await db.query('select public.initialise_push_event_deliveries($1, now())', [eventId])
    const deliveries = await db.query<{ id: string; user_id: string }>(`
      select id, user_id from public.push_event_deliveries order by user_id
    `)

    await db.query(`
      select public.record_push_delivery_results(
        $1,
        $2::jsonb,
        now(),
        now() + interval '15 minutes',
        now() + interval '24 hours'
      )
    `, [eventId, JSON.stringify([
      { delivery_id: deliveries.rows[0]?.id, outcome: 'ticket', expo_ticket_id: 'ticket-a' },
      { delivery_id: deliveries.rows[1]?.id, outcome: 'device_not_registered' },
    ])])

    const states = await db.query<{ user_id: string; status: string }>(`
      select user_id, status from public.push_event_deliveries order by user_id
    `)
    expect(states.rows).toEqual([
      { user_id: 'seat-a', status: 'ticketed' },
      { user_id: 'seat-b', status: 'device_not_registered' },
    ])
    const ticket = await db.query<{ user_id: string; token: string }>(`
      select user_id, token from public.push_tickets where expo_ticket_id = 'ticket-a'
    `)
    expect(ticket.rows).toEqual([{ user_id: 'seat-a', token: 'ExponentPushToken[a]' }])
    const tokens = await db.query<{ user_id: string }>('select user_id from public.push_tokens order by user_id')
    expect(tokens.rows).toEqual([{ user_id: 'seat-a' }])
  })
})
