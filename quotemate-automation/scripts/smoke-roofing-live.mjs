// Live HTTP smoke test for the roofing measurement-review flow against a
// running `next dev` (localhost:3000). Proves the core fix end-to-end:
//   • the /m/[measure_token] page renders
//   • PATCH /api/roofing/measurement/[token] persists a narrowed selection and
//     recomputes the denormalised total (the headline shrinks)
//   • the customer /q/roof/[public_token] page still renders post-change
//   • the PDF endpoint responds (200 if Gotenberg is configured locally)
// Restores the row's original selection at the end. Read args:
//   node scripts/smoke-roofing-live.mjs <measureToken> <publicToken> <origIndicesCsv>
const [measureToken, publicToken, origCsv] = process.argv.slice(2)
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000'
const orig = (origCsv ?? '1,2,3').split(',').map((n) => parseInt(n, 10)).filter(Number.isInteger)

if (!measureToken || !publicToken) {
  console.error('usage: smoke-roofing-live.mjs <measureToken> <publicToken> <origIndicesCsv>')
  process.exit(1)
}

const results = []
let failed = false
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail })
  if (!cond) failed = true
}

async function patch(indices) {
  const res = await fetch(`${BASE}/api/roofing/measurement/${measureToken}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ included_indices: indices }),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

try {
  // 1. /m page renders
  const mRes = await fetch(`${BASE}/m/${measureToken}`)
  const mHtml = await mRes.text()
  check('GET /m/[token] → 200', mRes.status === 200, `status ${mRes.status}`)
  check('/m page shows measurement UI', /Measurement|structure|In job/i.test(mHtml), 'body keyword present')

  // 2. narrow to ALL (baseline) then to structure #1 only
  const all = await patch(orig)
  check('PATCH all → ok', all.json.ok === true, JSON.stringify(all.json).slice(0, 160))
  const totalAll = all.json.combined_better_inc_gst
  const countAll = all.json.structure_count

  const one = await patch([1])
  check('PATCH [1] → ok', one.json.ok === true, JSON.stringify(one.json).slice(0, 160))
  const totalOne = one.json.combined_better_inc_gst
  const countOne = one.json.structure_count

  // 3. THE core assertion: narrowing the selection shrank the priced total
  check('structure_count dropped (3→1)', countAll > countOne, `${countAll} → ${countOne}`)
  check('headline total shrank when narrowed', Number(totalOne) < Number(totalAll), `$${totalAll} → $${totalOne}`)

  // 4. customer quote page still renders after the change
  const qRes = await fetch(`${BASE}/q/roof/${publicToken}`)
  check('GET /q/roof/[token] → 200', qRes.status === 200, `status ${qRes.status}`)

  // 5. PDF endpoint responds (200 if Gotenberg configured; 404/503 = env, not a bug)
  const pdfRes = await fetch(`${BASE}/api/q/roof/${publicToken}/pdf`, { method: 'GET' })
  check('PDF endpoint reachable (no 500)', pdfRes.status !== 500, `status ${pdfRes.status}`)
  const pdfNote = pdfRes.status === 200 ? 'PDF generated' : `status ${pdfRes.status} (Gotenberg likely not local)`

  // 6. restore original selection
  const restore = await patch(orig)
  check('restored original selection', restore.json.ok === true, JSON.stringify(restore.json.included_indices))

  console.log(JSON.stringify({ ok: !failed, totalAll, totalOne, countAll, countOne, pdfNote, results }, null, 2))
  process.exit(failed ? 1 : 0)
} catch (e) {
  console.error('smoke failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
}
