// QuoteMate · clone the full DB schema into a fresh sandbox / staging project.
//
// Rebuilds the schema in the exact order production was built:
//   init.sql  ->  sql/0N_*.sql stage files  ->  sql/migrations/NNN_*.sql
// init.sql + the stage files + the migrations' own seed/backfill steps also
// populate the base catalogue, trades, categories and pricing defaults, so
// the sandbox lands schema-complete and ready for the synthetic seed.
//
// Re-runnable: it FIRST drops + recreates the public schema, so every run
// gives a clean rebuild. That is why the production guard below is
// non-negotiable — this script must only ever touch a staging sandbox.
//
// SAFETY: refuses to run if SUPABASE_DB_URL points at the production
// project. Always run with  --env-file=.env.staging.local
//
// Usage: node --env-file=.env.staging.local scripts/clone-schema.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlDir = join(here, '..', 'sql')

// The production Supabase project ref. This script must NEVER touch it.
const PROD_REF = 'bobvihqwhtcbxneelfns'

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error(
    'Missing SUPABASE_DB_URL.\n' +
      'Run with:  node --env-file=.env.staging.local scripts/clone-schema.mjs',
  )
  process.exit(1)
}
if (dbUrl.includes(PROD_REF)) {
  console.error(
    `\n  ✗ REFUSING TO RUN — SUPABASE_DB_URL points at the PRODUCTION project\n` +
      `    (${PROD_REF}). This script drops + rebuilds the public schema and\n` +
      `    must only ever run against a staging sandbox. Check your --env-file.\n`,
  )
  process.exit(1)
}

// Reset public to a clean slate so the rebuild is deterministic and the
// script is safely re-runnable. Re-grant the Supabase roles afterwards.
const RESET_SQL = `
  drop schema if exists public cascade;
  create schema public;
  grant usage  on schema public to postgres, anon, authenticated, service_role;
  grant all    on schema public to postgres, service_role;
`

// After the schema is built, make sure the Supabase API roles can reach
// every object (RLS still governs row visibility, exactly as in prod).
const GRANT_SQL = `
  grant all on all tables    in schema public to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
  grant all on all routines  in schema public to anon, authenticated, service_role;
`

// Build order: init.sql, then the top-level numbered stage files
// (02_… 03_… 04_…), then every migration in zero-padded filename order.
const stageFiles = readdirSync(sqlDir)
  .filter((f) => f.endsWith('.sql') && /^\d/.test(f))
  .sort()
const migrationFiles = readdirSync(join(sqlDir, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
const files = [
  'init.sql',
  ...stageFiles,
  ...migrationFiles.map((m) => join('migrations', m)),
]

const c = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
})

try {
  await c.connect()

  console.log('Resetting the staging public schema...')
  await c.query(RESET_SQL)

  console.log(`Cloning schema — ${files.length} SQL files in build order.\n`)
  let applied = 0
  for (const rel of files) {
    const sql = readFileSync(join(sqlDir, rel), 'utf8')
    try {
      await c.query(sql)
      applied++
      console.log(`  ✓ ${rel}`)
    } catch (err) {
      console.error(`  ✗ ${rel}`)
      console.error(`    ${err.message ?? err}`)
      console.error(
        `\nStopped at ${rel} (${applied}/${files.length} applied). ` +
          'Fix the cause, then re-run.',
      )
      process.exit(1)
    }
  }

  console.log('\nRe-granting Supabase API roles on the rebuilt schema...')
  await c.query(GRANT_SQL)

  console.log(
    `\nOK — applied all ${applied} SQL files. The staging schema now matches production.`,
  )
} catch (err) {
  console.error('Clone failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
