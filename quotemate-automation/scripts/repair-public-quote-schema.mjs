// Incident repair for the deployed public quote readers. No quote data is backfilled.
// Dry run: node --env-file=.env.local scripts/repair-public-quote-schema.mjs
// Apply:   node --env-file=.env.local scripts/repair-public-quote-schema.mjs --apply
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import pg from 'pg'

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const identifier = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid schema identifier')
  return `"${value}"`
}
export const releaseColumns = [
  ['quotes', 'customer_released_at', 'timestamp with time zone'],
  ['quotes', 'customer_released_by', 'text'],
  ['roofing_measurements', 'released_at', 'timestamp with time zone'],
  ['plan_extractions', 'released_at', 'timestamp with time zone'],
  ['aircon_recommendations', 'released_at', 'timestamp with time zone'],
  ['paint_runs', 'released_at', 'timestamp with time zone'],
]

export function stripOuterTransaction(sql) {
  const match = sql.match(/^(?:\s|--[^\n]*(?:\n|$))*begin\s*;([\s\S]*)\bcommit\s*;\s*$/i)
  if (!match || /^\s*(?:begin|commit|rollback|start\s+transaction)\s*;/im.test(match[1])) {
    throw new Error('Migration 207 must have exactly one outer BEGIN/COMMIT transaction')
  }
  return match[1]
}

export function loadRepairAssets(directory = appDirectory) {
  const migration = readFileSync(join(directory, 'sql/migrations/207_quote_pricing_versions.sql'), 'utf8')
  const source = readFileSync(join(directory, 'lib/quote/public-schema.ts'), 'utf8')
  const contracts = [...source.matchAll(/family:\s*'([^']+)',\s*table:\s*'([^']+)',\s*select:\s*'([^']+)'/g)]
    .map(match => ({ family: match[1], table: match[2], select: match[3] }))
  if (contracts.length !== 7 || new Set(contracts.map(contract => contract.family)).size !== 7) {
    throw new Error('Public quote schema contract format changed; review the repair runner')
  }
  return { contracts, pricingSql: stripOuterTransaction(migration), migrationSha256: createHash('sha256').update(migration).digest('hex') }
}

export async function pricingSchemaState(db) {
  const { rows } = await db.query(`select
    to_regclass('public.quote_pricing_versions') is not null as version_table,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='quotes' and column_name='pricing_book_version_id') as quote_column,
    to_regprocedure('public.guard_quote_pricing_version()') is not null as immutable_function,
    to_regprocedure('public.guard_quote_pricing_version_owner()') is not null as owner_function,
    to_regprocedure('public.capture_quote_pricing_version(uuid,text,uuid,jsonb)') is not null as capture_function,
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.quote_pricing_versions') and tgname='quote_pricing_version_immutable' and not tgisinternal and tgenabled='O') as immutable_trigger,
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.quotes') and tgname='quote_pricing_version_owner' and not tgisinternal and tgenabled='O') as owner_trigger,
    exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
      where c.conrelid=to_regclass('public.quotes') and c.confrelid=to_regclass('public.quote_pricing_versions')
      and c.contype='f' and c.confdeltype='r' and a.attname='pricing_book_version_id') as version_foreign_key`)
  const flags = rows[0]
  const present = Object.values(flags).filter(Boolean).length
  if (present && present !== Object.keys(flags).length) {
    throw new Error(`Partial migration 207 detected; manual review required: ${JSON.stringify(flags)}`)
  }
  if (present) {
    const { rows: security } = await db.query(`select
      (select relrowsecurity from pg_class where oid='public.quote_pricing_versions'::regclass) as rls,
      not has_table_privilege('anon','public.quote_pricing_versions','SELECT') as anon_blocked,
      not has_table_privilege('authenticated','public.quote_pricing_versions','SELECT') as authenticated_blocked,
      has_table_privilege('service_role','public.quote_pricing_versions','SELECT') as service_read,
      has_function_privilege('service_role','public.capture_quote_pricing_version(uuid,text,uuid,jsonb)','EXECUTE') as service_capture,
      not has_function_privilege('anon','public.capture_quote_pricing_version(uuid,text,uuid,jsonb)','EXECUTE') as anon_capture_blocked,
      not has_function_privilege('authenticated','public.capture_quote_pricing_version(uuid,text,uuid,jsonb)','EXECUTE') as authenticated_capture_blocked`)
    if (!Object.values(security[0]).every(Boolean)) throw new Error('Migration 207 security contract is incomplete')
    await db.query('select id,tenant_id,trade,pricing_book_id,snapshot,content_hash,created_at from public.quote_pricing_versions where false')
  }
  return present ? 'complete' : 'absent'
}

export async function planSchemaRepair(db, assets) {
  const pricing = await pricingSchemaState(db)
  const statements = []
  const columns = []
  for (const [table, column, type] of releaseColumns) {
    const { rows } = await db.query(`select data_type,is_nullable,column_default from information_schema.columns
      where table_schema='public' and table_name=$1 and column_name=$2`, [table, column])
    if (rows.length) {
      if (rows[0].data_type !== type || rows[0].is_nullable !== 'YES' || rows[0].column_default !== null) {
        throw new Error(`Unexpected existing release column contract: ${table}.${column}`)
      }
    } else {
      columns.push(`${table}.${column}`)
      statements.push(`alter table public.${identifier(table)} add column ${identifier(column)} ${type}`)
    }
  }
  if (pricing === 'absent') statements.push(assets.pricingSql)
  return { columns, applyMigration207: pricing === 'absent', migrationSha256: assets.migrationSha256, statements }
}

// Validate the source contract using zero-row SQL, including the FK relations
// required by PostgREST. A separate HTTP probe verifies its schema cache after commit.
export async function verifyReaderSchema(db, contracts) {
  for (const contract of contracts) {
    const fields = []
    const joins = []
    let remainder = contract.select
    for (const match of contract.select.matchAll(/([a-z_]+)(?::([a-z_]+))?\(([^()]+)\)/g)) {
      const table = match[1]
      const foreignKey = match[2] || ({ plan_uploads: 'plan_upload_id' })[table]
      if (!foreignKey) throw new Error('Unknown public quote relation')
      const alias = `r${joins.length}`
      joins.push(`left join public.${identifier(table)} ${alias} on ${alias}.id=q.${identifier(foreignKey)}`)
      fields.push(...match[3].split(',').map(field => `${alias}.${identifier(field.trim())}`))
      remainder = remainder.replace(match[0], '')
      const { rows } = await db.query(`select exists(select 1 from pg_constraint c join pg_attribute a
        on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
        where c.conrelid=to_regclass($1) and c.confrelid=to_regclass($2)
        and c.contype='f' and a.attname=$3) as present`, [`public.${contract.table}`, `public.${table}`, foreignKey])
      if (!rows[0].present) throw new Error(`Missing public relation: ${contract.table}.${foreignKey}`)
    }
    fields.push(...remainder.split(',').map(field => field.trim()).filter(Boolean).map(field => `q.${identifier(field)}`))
    await db.query(`select ${fields.join(',')} from public.${identifier(contract.table)} q ${joins.join(' ')} where false`)
  }
  await db.query('select customer_released_at,customer_released_by,pricing_book_version_id from public.quotes where false')
  if (await pricingSchemaState(db) !== 'complete') throw new Error('Migration 207 verification failed')
}

export async function repairPublicQuoteSchema(db, { apply = false, assets = loadRepairAssets() } = {}) {
  await db.query(apply ? 'begin' : 'begin read only')
  try {
    await db.query("set local lock_timeout='5s'")
    await db.query("set local statement_timeout='30s'")
    if (apply) {
      const { rows } = await db.query("select pg_try_advisory_xact_lock(hashtextextended('repair-public-quote-schema',0)) as locked")
      if (!rows[0].locked) throw new Error('Another public quote schema repair is running')
    }
    const plan = await planSchemaRepair(db, assets)
    if (apply) {
      for (const statement of plan.statements) await db.query(statement)
      await verifyReaderSchema(db, assets.contracts)
      await db.query("notify pgrst, 'reload schema'")
      await db.query('commit')
    } else await db.query('rollback')
    return { mode: apply ? 'applied' : 'dry-run', addedColumns: plan.columns, applyMigration207: plan.applyMigration207,
      migrationSha256: plan.migrationSha256, quoteDataChanged: false, publicFamiliesVerified: apply ? assets.contracts.length : 0 }
  } catch (error) {
    await db.query('rollback')
    throw error
  }
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported; omitting it performs a read-only dry run')
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL missing')
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try { console.log(JSON.stringify(await repairPublicQuoteSchema(client, { apply: process.argv.includes('--apply') }), null, 2)) }
  finally { await client.end() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Do not print the connection string, SQL parameters, quote rows or credentials.
    console.error(`Public quote schema repair failed: ${error.message}`)
    process.exitCode = 1
  })
}
