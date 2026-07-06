// Seed quotes.report_doc for one quote from its existing fields, so the
// flag-gated document render has something to show. Mirrors lib/quote/report-doc/
// seed.ts (buildDefaultReportDoc) inline (this is a plain .mjs).
//
// Demo the whole Phase 1 render loop:
//   1) node --env-file=.env.local scripts/seed-report-doc.mjs <share_token>
//   2) set FULL_QUOTE_DOC=true in .env.local (dev) / the Vercel env (prod)
//   3) open /api/q/<share_token>/html  → the document renders (with the locked
//      Good/Better/Best pricing block rendered from the same structured tiers)
//
// Idempotent: re-running overwrites report_doc + nulls the PDF cache.
import pg from 'pg'

const { Client } = pg
const token = process.argv[2]
if (!token) {
  console.error('usage: node --env-file=.env.local scripts/seed-report-doc.mjs <share_token>')
  process.exit(1)
}
const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set')
  process.exit(1)
}

function prettyJobType(jt) {
  return (jt || '').replace(/_/g, ' ').trim()
}

function buildDefaultReportDoc({ title, scopeOfWorks, assumptions }) {
  const blocks = [{ type: 'title', content: [{ text: (title || '').trim() || 'Quotation' }] }]
  if (scopeOfWorks && scopeOfWorks.trim()) {
    blocks.push({ type: 'heading', content: [{ text: 'Scope of works' }] })
    blocks.push({ type: 'paragraph', content: [{ text: scopeOfWorks.trim() }] })
  }
  blocks.push({ type: 'pricing' })
  const a = (assumptions || []).filter((x) => x && x.trim())
  if (a.length) {
    blocks.push({ type: 'heading', content: [{ text: 'Assumptions' }] })
    blocks.push({ type: 'bulletList', items: a.map((x) => [{ text: x.trim() }]) })
  }
  return { version: 1, blocks }
}

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  const { rows } = await c.query(
    `select q.id, q.scope_of_works, q.assumptions, i.job_type
       from quotes q left join intakes i on i.id = q.intake_id
      where q.share_token = $1`,
    [token],
  )
  if (rows.length === 0) {
    console.error('no quote for share_token', token)
    process.exit(2)
  }
  const q = rows[0]
  const doc = buildDefaultReportDoc({
    title: prettyJobType(q.job_type),
    scopeOfWorks: q.scope_of_works,
    assumptions: q.assumptions,
  })
  await c.query(
    `update quotes set report_doc = $1, pdf_path = null, pdf_signature = null where id = $2`,
    [JSON.stringify(doc), q.id],
  )
  console.log(`seeded report_doc for quote ${q.id} (${doc.blocks.length} blocks)`)
  console.log('next: set FULL_QUOTE_DOC=true, then open /api/q/%s/html', token)
} catch (e) {
  console.error('seed failed:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
