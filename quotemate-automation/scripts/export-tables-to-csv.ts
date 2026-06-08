// QuoteMate · dump every public table to db-export/<table>.csv
// Run: node --env-file=.env.local --import tsx scripts/export-tables-to-csv.ts
//
// ⚠ Output contains real customer PII — db-export/ is gitignored.

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'
import { exportTableCsv, listPublicTables } from '../lib/kb-sync/export-table-csv'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'db-export')
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
try {
  await c.connect()
  mkdirSync(outDir, { recursive: true })
  const tables = await listPublicTables(c)
  console.log(`Exporting ${tables.length} table(s) → ${outDir}\n`)
  let total = 0
  for (const table of tables) {
    const { csv, rowCount } = await exportTableCsv(c, table)
    writeFileSync(join(outDir, `${table}.csv`), csv, 'utf8')
    total += rowCount
    console.log(`  ✓ ${table.padEnd(34)}${String(rowCount).padStart(7)} rows`)
  }
  console.log(`\nDone. ${tables.length} tables, ${total.toLocaleString()} rows → ${outDir}`)
} catch (err) {
  console.error('Export failed:', (err as Error).message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
