// Read-only diagnostic: which estimator tables + pdf_path columns exist on
// the live DB (informs whether migrations 089/115 need applying for the
// residential-painting Download-PDF feature).
// Usage: node --env-file=.env.local scripts/check-pdf-columns.mjs

import pg from 'pg'

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function tableExists(t) {
  const { rows } = await c.query(
    `select exists (select 1 from information_schema.tables where table_schema='public' and table_name=$1) e`,
    [t],
  )
  return rows[0].e
}
async function columnExists(t, col) {
  const { rows } = await c.query(
    `select exists (select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2) e`,
    [t, col],
  )
  return rows[0].e
}

try {
  await c.connect()
  console.log('table painting_measurements        :', await tableExists('painting_measurements'))
  console.log('col   painting_measurements.pdf_path:', await columnExists('painting_measurements', 'pdf_path'))
  console.log('col   roofing_measurements.pdf_path :', await columnExists('roofing_measurements', 'pdf_path'))
  console.log('col   solar_estimates.pdf_path      :', await columnExists('solar_estimates', 'pdf_path'))
  console.log('col   quotes.pdf_path               :', await columnExists('quotes', 'pdf_path'))
} catch (e) {
  console.error('CHECK FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
