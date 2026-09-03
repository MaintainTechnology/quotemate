import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'

// Each case boots its own PGlite (a full Postgres in WASM) and applies the
// migration, which runs 5-10s on a cold cache — comfortably past vitest's 5s
// default. Declared once here rather than per-case so a new test can't be
// added without it and start flaking.
const PGLITE_TIMEOUT_MS = 60_000

const root = process.cwd()
const upSql = readFileSync(resolve(root, 'sql', 'migrations', '194_quote_chain.sql'), 'utf8')
const downSql = readFileSync(resolve(root, 'sql', 'migrations', '194_down.sql'), 'utf8')
const runner = readFileSync(resolve(root, 'scripts', 'run-migration-194.mjs'), 'utf8')
const initSql = readFileSync(resolve(root, 'sql', 'init.sql'), 'utf8')

const databases: PGlite[] = []

// sql/init.sql's quotes DDL is NOT prod schema — it has no paid_at (nor
// share_token, paid_tier, deposit_pct, tenant_id; those live in
// sql/02_stages_06_10_partial.sql, sql/04_f3_finish.sql and later migrations).
// The partial index this migration adds is keyed on paid_at, so the test
// builds the minimal real shape itself rather than pretending init.sql is it.
async function databaseWithQuotesTable(): Promise<PGlite> {
  const db = new PGlite()
  databases.push(db)
  await db.exec(`
    create table public.quotes (
      id uuid primary key default gen_random_uuid(),
      status text default 'draft',
      total_inc_gst numeric(12,2),
      paid_at timestamptz
    );
  `)
  return db
}

async function insertRoot(db: PGlite): Promise<string> {
  const result = await db.query<{ id: string }>(
    `insert into public.quotes (status) values ('sent') returning id`,
  )
  return result.rows[0]!.id
}

async function insertChild(db: PGlite, parentId: string, kind: string): Promise<void> {
  await db.query(
    `insert into public.quotes (parent_quote_id, quote_kind) values ($1, $2)`,
    [parentId, kind],
  )
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()))
})

describe('194 quote chain migration', () => {
  it('applies twice and adds both chain columns with their defaults and CHECK', async () => {
    const db = await databaseWithQuotesTable()

    await db.exec(upSql)
    await db.exec(upSql)

    const columns = await db.query<{
      column_name: string
      data_type: string
      is_nullable: string
      column_default: string | null
    }>(`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'quotes'
        and column_name in ('parent_quote_id', 'quote_kind')
      order by column_name
    `)
    expect(columns.rows).toEqual([
      expect.objectContaining({
        column_name: 'parent_quote_id',
        data_type: 'uuid',
        is_nullable: 'YES',
        column_default: null,
      }),
      expect.objectContaining({
        column_name: 'quote_kind',
        data_type: 'text',
        is_nullable: 'NO',
        column_default: expect.stringContaining("'initial'"),
      }),
    ])

    // Existing rows keep today's behaviour: chain roots, kind 'initial'.
    const root = await insertRoot(db)
    const seeded = await db.query<{ quote_kind: string; parent_quote_id: string | null }>(
      `select quote_kind, parent_quote_id from public.quotes where id = $1`,
      [root],
    )
    expect(seeded.rows).toEqual([{ quote_kind: 'initial', parent_quote_id: null }])

    // Applied once, not twice.
    const objects = await db.query<{ index_count: number; check_count: number }>(`
      select
        (select count(*)::int from pg_indexes
          where schemaname = 'public' and indexname = 'quotes_open_child_uniq') as index_count,
        (select count(*)::int from pg_constraint
          where conname = 'quotes_quote_kind_check') as check_count
    `)
    expect(objects.rows[0]).toEqual({ index_count: 1, check_count: 1 })
  }, PGLITE_TIMEOUT_MS)

  it('rejects a quote_kind outside initial/final/balance', async () => {
    const db = await databaseWithQuotesTable()
    await db.exec(upSql)
    const parent = await insertRoot(db)

    await expect(insertChild(db, parent, 'deposit')).rejects.toThrow(
      /quotes_quote_kind_check/,
    )

    // The three legal values all insert.
    await db.query(`update public.quotes set quote_kind = 'initial' where id = $1`, [parent])
    await insertChild(db, parent, 'final')
    await insertChild(db, parent, 'balance')
  }, PGLITE_TIMEOUT_MS)

  it('allows only one UNPAID child per (parent, kind) — the double-click guard', async () => {
    const db = await databaseWithQuotesTable()
    await db.exec(upSql)
    const parent = await insertRoot(db)

    await insertChild(db, parent, 'final')

    // Second tap of "Issue final quote" — 23505, which the route catches and
    // answers with the existing open child.
    await expect(insertChild(db, parent, 'final')).rejects.toThrow(
      /quotes_open_child_uniq/,
    )

    // A 'balance' child of the SAME parent is a different kind: it coexists.
    await insertChild(db, parent, 'balance')

    // Once the first final is paid it leaves the partial index, so the chain
    // can move on (e.g. a superseding quote after a paid deposit).
    await db.query(
      `update public.quotes set paid_at = now() where parent_quote_id = $1 and quote_kind = 'final'`,
      [parent],
    )
    await insertChild(db, parent, 'final')

    const counts = await db.query<{ quote_kind: string; count: number }>(`
      select quote_kind, count(*)::int as count
      from public.quotes where parent_quote_id is not null
      group by quote_kind order by quote_kind
    `)
    expect(counts.rows).toEqual([
      { quote_kind: 'balance', count: 1 },
      { quote_kind: 'final', count: 2 },
    ])
  }, PGLITE_TIMEOUT_MS)

  it('never collides on unpaid chain roots, and scopes the index to one parent', async () => {
    const db = await databaseWithQuotesTable()
    await db.exec(upSql)

    // Every legacy row is an unpaid ('initial', NULL parent) row. NULLs are
    // distinct in a unique index, and the `parent_quote_id is not null` term
    // documents that — thousands of them must coexist.
    await insertRoot(db)
    await insertRoot(db)
    const parentA = await insertRoot(db)
    const parentB = await insertRoot(db)

    // Same kind, different parents: no collision.
    await insertChild(db, parentA, 'final')
    await insertChild(db, parentB, 'final')

    expect(
      (await db.query<{ count: number }>('select count(*)::int as count from public.quotes'))
        .rows[0]?.count,
    ).toBe(6)
  }, PGLITE_TIMEOUT_MS)

  it('rolls back the index, the CHECK and both columns', async () => {
    const db = await databaseWithQuotesTable()
    await db.exec(upSql)
    await db.exec(downSql)

    const remaining = await db.query<{
      chain_columns: number
      open_child_index: number
      kind_check: number
    }>(`
      select
        (select count(*)::int from information_schema.columns
          where table_schema = 'public' and table_name = 'quotes'
            and column_name in ('parent_quote_id', 'quote_kind')) as chain_columns,
        (select count(*)::int from pg_indexes
          where schemaname = 'public' and indexname = 'quotes_open_child_uniq') as open_child_index,
        (select count(*)::int from pg_constraint
          where conname = 'quotes_quote_kind_check') as kind_check
    `)
    expect(remaining.rows[0]).toEqual({
      chain_columns: 0,
      open_child_index: 0,
      kind_check: 0,
    })

    // Re-applying after a rollback works.
    await db.exec(upSql)
    expect(
      (
        await db.query<{ count: number }>(`
          select count(*)::int as count from pg_indexes
          where schemaname = 'public' and indexname = 'quotes_open_child_uniq'
        `)
      ).rows[0]?.count,
    ).toBe(1)
  }, PGLITE_TIMEOUT_MS)

  it('keeps init representative and makes the runner opt-in and transactional', () => {
    expect(initSql).toMatch(/parent_quote_id uuid references quotes\(id\) on delete set null/)
    expect(initSql).toMatch(/quote_kind text not null default 'initial'/)
    expect(initSql).toMatch(/check \(quote_kind in \('initial', 'final', 'balance'\)\)/)
    // init.sql has no paid_at, so the partial index must NOT be created there
    // (the DDL comment may name it; only a CREATE would be a lie).
    expect(initSql).not.toMatch(/create unique index.*quotes_open_child_uniq/)
    // The migration header must say init.sql is not prod schema.
    expect(upSql).toMatch(/init\.sql/)
    expect(upSql).toMatch(/share_token/)

    expect(runner).toMatch(/--apply/)
    expect(runner).toMatch(/DRY RUN/i)
    expect(runner).toMatch(/await client\.query\('begin'\)/)
    expect(runner).toMatch(/Verified quotes chain schema/)
    expect(runner.indexOf("await client.query('commit')")).toBeGreaterThan(
      runner.indexOf('Migration 194 verification failed'),
    )
  })
})
