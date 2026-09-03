// Migration 195 — quotes.estimate_number + its sequence and assignment
// function (spec ev-charger-estimate-template R5/R17).
//
// Mirrors tests/ev-charger-migration.test.ts: PGlite in-memory, apply twice for
// idempotency, roll back, and check sql/init.sql stays representative and the
// runner keeps its safe-by-default shape.
//
// NUMBERING: the spec calls this migration 194. 194 was already taken by
// 194_quote_chain.sql (the post-visit money chain) when this landed, so the
// estimate number took the next free slot. Nothing else about R5 changes.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'

// Each case boots its own PGlite (Postgres in WASM) and applies the migration,
// which runs well past vitest 5s default on a cold cache. Same treatment as
// tests/quote-chain-migration.test.ts.
const PGLITE_TIMEOUT_MS = 60_000

const root = process.cwd()
const upSql = readFileSync(
  resolve(root, 'sql', 'migrations', '195_quotes_estimate_number.sql'),
  'utf8',
)
const downSql = readFileSync(resolve(root, 'sql', 'migrations', '195_down.sql'), 'utf8')
const runner = readFileSync(resolve(root, 'scripts', 'run-migration-195.mjs'), 'utf8')
const initSql = readFileSync(resolve(root, 'sql', 'init.sql'), 'utf8')

const databases: PGlite[] = []

/** A minimal `quotes` table — only what this migration touches. */
async function databaseWithQuotes(): Promise<PGlite> {
  const db = new PGlite()
  databases.push(db)
  await db.exec(`
    create table public.quotes (
      id uuid primary key default gen_random_uuid(),
      needs_inspection boolean not null default false
    );
  `)
  return db
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()))
})

describe('195 estimate number migration', () => {
  it('applies twice and leaves one nullable bigint column, sequence and function', async () => {
    const db = await databaseWithQuotes()

    await db.exec(upSql)
    await db.exec(upSql)

    const col = await db.query<{ data_type: string; is_nullable: string; count: number }>(`
      select data_type, is_nullable, count(*) over ()::int as count
      from information_schema.columns
      where table_schema = 'public' and table_name = 'quotes'
        and column_name = 'estimate_number'
    `)
    expect(col.rows).toHaveLength(1)
    expect(col.rows[0]?.data_type).toBe('bigint')
    expect(col.rows[0]?.is_nullable).toBe('YES')

    const seq = await db.query<{ count: number }>(
      `select count(*)::int as count from pg_class where relkind = 'S' and relname = 'quote_estimate_number_seq'`,
    )
    expect(seq.rows[0]?.count).toBe(1)

    const fn = await db.query<{ count: number }>(`
      select count(*)::int as count from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'next_quote_estimate_number'
    `)
    expect(fn.rows[0]?.count).toBe(1)
  }, PGLITE_TIMEOUT_MS)

  it('assigns a number once and returns the SAME number on every later call', async () => {
    const db = await databaseWithQuotes()
    await db.exec(upSql)
    const inserted = await db.query<{ id: string }>(
      `insert into public.quotes default values returning id`,
    )
    const id = inserted.rows[0]!.id

    const first = await db.query<{ n: string }>(
      `select public.next_quote_estimate_number($1) as n`,
      [id],
    )
    const second = await db.query<{ n: string }>(
      `select public.next_quote_estimate_number($1) as n`,
      [id],
    )
    // Idempotent: the second call must NOT draw a new number, or a resend would
    // print a different estimate number than the one already sent.
    expect(Number(first.rows[0]?.n)).toBe(1)
    expect(Number(second.rows[0]?.n)).toBe(1)
  }, PGLITE_TIMEOUT_MS)

  it('gives two different quotes two different numbers', async () => {
    const db = await databaseWithQuotes()
    await db.exec(upSql)
    const a = (
      await db.query<{ id: string }>(`insert into public.quotes default values returning id`)
    ).rows[0]!.id
    const b = (
      await db.query<{ id: string }>(`insert into public.quotes default values returning id`)
    ).rows[0]!.id

    const na = Number(
      (await db.query<{ n: string }>(`select public.next_quote_estimate_number($1) as n`, [a]))
        .rows[0]?.n,
    )
    const nb = Number(
      (await db.query<{ n: string }>(`select public.next_quote_estimate_number($1) as n`, [b]))
        .rows[0]?.n,
    )
    expect(na).not.toBe(nb)
  }, PGLITE_TIMEOUT_MS)

  it('returns null for a quote that does not exist, rather than erroring', async () => {
    const db = await databaseWithQuotes()
    await db.exec(upSql)
    const res = await db.query<{ n: string | null }>(
      `select public.next_quote_estimate_number('00000000-0000-0000-0000-000000000000'::uuid) as n`,
    )
    expect(res.rows[0]?.n).toBeNull()
  }, PGLITE_TIMEOUT_MS)

  it('rolls back the column, the sequence and the function', async () => {
    const db = await databaseWithQuotes()
    await db.exec(upSql)
    await db.exec(downSql)

    const col = await db.query<{ count: number }>(`
      select count(*)::int as count from information_schema.columns
      where table_schema = 'public' and table_name = 'quotes' and column_name = 'estimate_number'
    `)
    const seq = await db.query<{ count: number }>(
      `select count(*)::int as count from pg_class where relkind = 'S' and relname = 'quote_estimate_number_seq'`,
    )
    const fn = await db.query<{ count: number }>(`
      select count(*)::int as count from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'next_quote_estimate_number'
    `)
    expect(col.rows[0]?.count).toBe(0)
    expect(seq.rows[0]?.count).toBe(0)
    expect(fn.rows[0]?.count).toBe(0)
  }, PGLITE_TIMEOUT_MS)

  it('keeps sql/init.sql representative', () => {
    expect(initSql).toContain('estimate_number bigint')
    expect(initSql).toContain('quote_estimate_number_seq')
    // A database built from init.sql alone must be able to ASSIGN a number, not
    // just store one — without the function every EV estimate silently falls
    // back to the 8-character quote reference.
    expect(initSql).toContain('next_quote_estimate_number')
    // …and must not ship the SECURITY DEFINER function with PUBLIC execute.
    expect(initSql).toMatch(/revoke execute on function next_quote_estimate_number\(uuid\) from public/)
  })

  it('shuts the SECURITY DEFINER function to anon and authenticated', () => {
    // Left open, this is an unauthenticated write against quotes that bypasses
    // RLS: the anon key ships in the browser bundle.
    expect(upSql).toMatch(/revoke execute on function public\.next_quote_estimate_number\(uuid\) from public/)
    expect(upSql).toMatch(/from anon/)
    expect(upSql).toMatch(/from authenticated/)
    expect(upSql).toMatch(/grant execute on function public\.next_quote_estimate_number\(uuid\) to service_role/)
    // The runner must fail the apply if the grant is ever reopened.
    expect(runner).toContain('anon_can_execute')
    expect(runner).toContain('service_role_can_execute')
  })

  it('keeps the runner safe by default', () => {
    expect(runner).toContain('--apply')
    expect(runner).toContain('DRY RUN')
    expect(runner).toContain("await client.query('begin')")
    expect(runner).toContain("await client.query('commit')")
    expect(runner).toContain("await client.query('rollback')")
    expect(runner).toContain('195_down.sql')
  })
})
