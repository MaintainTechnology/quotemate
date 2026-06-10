// Throwaway diagnostic for v7 Phase 0: confirm whether
// tenant_service_offerings already carries labour/markup overrides.
import pg from 'pg'

const { Client } = pg
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})
await c.connect()
const cols = await c.query(
  "select column_name, data_type, is_nullable from information_schema.columns where table_name = 'tenant_service_offerings' order by ordinal_position",
)
console.log('tenant_service_offerings columns:')
for (const r of cols.rows) {
  console.log(`  ${r.column_name}: ${r.data_type}${r.is_nullable === 'NO' ? ' NOT NULL' : ''}`)
}
const offStats = await c.query(
  "select count(*)::int as total, count(*) filter (where enabled = false)::int as off from tenant_service_offerings",
)
console.log(`\noffering rows: ${offStats.rows[0].total}, enabled=false: ${offStats.rows[0].off}`)

const bomStats = await c.query("select count(*)::int as n from tenant_assembly_bom")
console.log(`tenant_assembly_bom rows: ${bomStats.rows[0].n}`)
await c.end()
