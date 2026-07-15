// QuoteMate — run migration 172 (roofing semantic edge analysis, Phase 1)
//
// Usage (explicit opt-in):
//   APPLY_ROOF_EDGE_ANALYSIS_MIGRATION=true
//   node --env-file=.env.local scripts/run-migration-172.mjs
//
// This script is intentionally not invoked by tests or application startup.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '172_roofing_semantic_edge_analysis.sql')
const dbUrl = process.env.SUPABASE_DB_URL

if (process.env.APPLY_ROOF_EDGE_ANALYSIS_MIGRATION !== 'true') {
  console.error(
    'Refusing to apply migration 172 without APPLY_ROOF_EDGE_ANALYSIS_MIGRATION=true.',
  )
  process.exit(1)
}

if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
const tables = [
  'roof_topology_source_approvals',
  'roof_edge_analyses',
  'roof_edge_decisions',
  'roofing_quote_revisions',
]
const requiredIndexes = [
  'roof_topology_source_approvals_tenant_source_idx',
  'roof_edge_analyses_expiry_idx',
  'roof_edge_decisions_analysis_created_idx',
  'roofing_quote_revisions_tenant_measurement_idx',
  'roofing_quote_revisions_expiry_idx',
]
const requiredTriggers = [
  'roof_topology_source_approvals_immutable',
  'roof_topology_source_approvals_queue_purge',
  'roof_edge_tenant_consistency',
  'roof_edge_analyses_source_approval_guard',
  'roof_edge_analyses_payload_immutable',
  'roof_edge_analyses_redact_revisions_on_purge',
  'roof_edge_decisions_append_only',
  'roofing_quote_revisions_parentage_guard',
  'roofing_quote_revisions_payload_immutable',
]

let transactionOpen = false

try {
  await client.connect()
  await client.query('begin')
  transactionOpen = true
  console.log('Applying 172_roofing_semantic_edge_analysis.sql...')
  await client.query(sql)

  const { rows: tableRows } = await client.query(
    'select c.relname as table_name, c.relrowsecurity ' +
      'from pg_class c join pg_namespace n on n.oid = c.relnamespace ' +
      "where n.nspname = 'public' and c.relname = any($1::text[])",
    [tables],
  )
  const rlsByTable = new Map(tableRows.map((row) => [row.table_name, row.relrowsecurity]))
  const missingRls = tables.filter((table) => rlsByTable.get(table) !== true)

  const { rows: indexRows } = await client.query(
    'select indexname from pg_indexes ' +
      "where schemaname = 'public' and indexname = any($1::text[])",
    [requiredIndexes],
  )
  const foundIndexes = new Set(indexRows.map((row) => row.indexname))
  const missingIndexes = requiredIndexes.filter((index) => !foundIndexes.has(index))

  const { rows: policyRows } = await client.query(
    'select tablename from pg_policies ' +
      "where schemaname = 'public' and tablename = any($1::text[])",
    [tables],
  )
  const unexpectedPolicies = [...new Set(policyRows.map((row) => row.tablename))]

  const { rows: triggerRows } = await client.query(
    'select t.tgname from pg_trigger t ' +
      'join pg_class c on c.oid = t.tgrelid ' +
      'join pg_namespace n on n.oid = c.relnamespace ' +
      "where not t.tgisinternal and n.nspname = 'public' " +
      'and c.relname = any($1::text[]) and t.tgname = any($2::text[])',
    [tables, requiredTriggers],
  )
  const foundTriggers = new Set(triggerRows.map((row) => row.tgname))
  const missingTriggers = requiredTriggers.filter((trigger) => !foundTriggers.has(trigger))

  for (const table of tables) {
    console.log((rlsByTable.get(table) === true ? 'ok' : 'missing') + ' RLS ' + table)
  }
  for (const index of requiredIndexes) {
    console.log((foundIndexes.has(index) ? 'ok' : 'missing') + ' index ' + index)
  }
  for (const trigger of requiredTriggers) {
    console.log((foundTriggers.has(trigger) ? 'ok' : 'missing') + ' trigger ' + trigger)
  }
  for (const table of unexpectedPolicies) {
    console.log('unexpected policy ' + table)
  }

  if (missingRls.length || missingIndexes.length || unexpectedPolicies.length || missingTriggers.length) {
    throw new Error(
      'Migration verification failed: ' +
        [
          missingRls.length ? 'RLS=' + missingRls.join(', ') : null,
          missingIndexes.length ? 'indexes=' + missingIndexes.join(', ') : null,
          unexpectedPolicies.length ? 'policies=' + unexpectedPolicies.join(', ') : null,
          missingTriggers.length ? 'triggers=' + missingTriggers.join(', ') : null,
        ]
          .filter(Boolean)
          .join(' '),
    )
  }

  // Keep the DDL transaction open through verification so a failed check does
  // not leave an incompletely verified migration committed.
  await client.query('commit')
  transactionOpen = false
  console.log('Migration 172 applied and verified.')
} catch (error) {
  if (transactionOpen) {
    try {
      await client.query('rollback')
    } catch {
      // Keep the original migration failure.
    }
  }
  console.error('Migration 172 failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end()
}
