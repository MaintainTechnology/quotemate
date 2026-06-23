// List public base tables + check a few key objects for whichever project
// the passed env file points at.
//   node --env-file=.env.development.local scripts/diag-schema-list.mjs
//   node --env-file=.env.local             scripts/diag-schema-list.mjs

import pg from 'pg'

const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').match(/https:\/\/([^.]+)/)?.[1]
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const t = await c.query(
  `select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by 1`,
)
console.log('project:', ref)
console.log(`tables (${t.rows.length}):`, t.rows.map((r) => r.table_name).join(', '))

const iu = await c.query(`select to_regclass('public.invoice_uploads') as t`)
const tfd = await c.query(`select to_regclass('public.tenant_file_documents') as t`)
const fc = await c.query(
  `select 1 from information_schema.columns
    where table_schema='public' and table_name='tenants' and column_name='file_store_id'`,
)
console.log('invoice_uploads:', iu.rows[0].t || 'MISSING')
console.log('tenant_file_documents:', tfd.rows[0].t || 'MISSING')
console.log('tenants.file_store_id:', fc.rows.length ? 'present' : 'MISSING')

await c.end()
