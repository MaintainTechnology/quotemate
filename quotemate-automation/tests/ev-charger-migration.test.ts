import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'

const root = process.cwd()
const upSql = readFileSync(
  resolve(root, 'sql', 'migrations', '192_ev_charger_bounds.sql'),
  'utf8',
)
const downSql = readFileSync(resolve(root, 'sql', 'migrations', '192_down.sql'), 'utf8')
const runner = readFileSync(resolve(root, 'scripts', 'run-migration-192.mjs'), 'utf8')
const initSql = readFileSync(resolve(root, 'sql', 'init.sql'), 'utf8')

const databases: PGlite[] = []

async function databaseWithBoundsTable(): Promise<PGlite> {
  const db = new PGlite()
  databases.push(db)
  await db.exec(`
    create table public.job_type_bounds (
      trade text not null,
      job_type text not null,
      max_labour_hours numeric not null,
      min_total_ex_gst numeric not null,
      max_total_ex_gst numeric not null,
      per_unit_labour_hours numeric,
      notes text,
      primary key (trade, job_type)
    );
  `)
  return db
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()))
})

describe('192 EV charger bounds migration', () => {
  it('applies twice and creates the provisional electrical bound exactly once', async () => {
    const db = await databaseWithBoundsTable()

    await db.exec(upSql)
    await db.exec(upSql)

    const result = await db.query<{
      max_labour_hours: number
      min_total_ex_gst: number
      max_total_ex_gst: number
      notes: string
    }>(`
      select
        max_labour_hours::float8 as max_labour_hours,
        min_total_ex_gst::float8 as min_total_ex_gst,
        max_total_ex_gst::float8 as max_total_ex_gst,
        notes
      from public.job_type_bounds
      where trade = 'electrical' and job_type = 'ev_charger'
    `)

    expect(result.rows).toEqual([
      expect.objectContaining({
        max_labour_hours: 10,
        min_total_ex_gst: 400,
        max_total_ex_gst: 6000,
        notes: expect.stringContaining('PROVISIONAL_EV_CHARGER_BOUNDS_V1'),
      }),
    ])
  }, 45_000)

  it('does not overwrite a tenant-authoritative bound already present', async () => {
    const db = await databaseWithBoundsTable()
    await db.exec(`
      insert into public.job_type_bounds
        (trade, job_type, max_labour_hours, min_total_ex_gst, max_total_ex_gst, notes)
      values ('electrical', 'ev_charger', 8, 500, 5500, 'Jon confirmed');
    `)

    await db.exec(upSql)

    const result = await db.query<{ max_labour_hours: number; notes: string }>(`
      select max_labour_hours::float8 as max_labour_hours, notes
      from public.job_type_bounds
      where trade = 'electrical' and job_type = 'ev_charger'
    `)
    expect(result.rows).toEqual([{ max_labour_hours: 8, notes: 'Jon confirmed' }])
  }, 45_000)

  it('rolls back only the untouched provisional row', async () => {
    const db = await databaseWithBoundsTable()
    await db.exec(upSql)
    await db.exec(downSql)
    expect(
      (await db.query<{ count: number }>('select count(*)::int as count from job_type_bounds'))
        .rows[0]?.count,
    ).toBe(0)

    await db.exec(upSql)
    await db.exec(`update job_type_bounds set notes = 'Jon confirmed'`)
    await db.exec(downSql)
    expect(
      (await db.query<{ notes: string }>('select notes from job_type_bounds')).rows,
    ).toEqual([{ notes: 'Jon confirmed' }])
  }, 45_000)

  it('keeps init representative and makes the runner opt-in and transactional', () => {
    expect(initSql).toMatch(
      /'electrical',[\s\S]*?'ev_charger',[\s\S]*?10\.0,[\s\S]*?400\.0,[\s\S]*?6000\.0/i,
    )
    expect(runner).toMatch(/--apply/)
    expect(runner).toMatch(/DRY RUN/i)
    expect(runner).toMatch(/await client\.query\('begin'\)/)
    expect(runner).toMatch(/Verified electrical\/ev_charger bounds/)
    expect(runner.indexOf("await client.query('commit')")).toBeGreaterThan(
      runner.indexOf('Migration 192 verification failed'),
    )
  })
})
