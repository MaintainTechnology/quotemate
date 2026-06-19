// R26 - quarterly price-drift re-calibration report (READ-ONLY, no DB writes, no network in this build).
// Run: node --env-file=.env.local scripts/quarterly-recalibration.mjs
//
// What this does:
//   Reads the stored supplier price references (supplier_price_refs - the table
//   R12 introduces: item, supplier, sku, price_ex_gst, source_url, captured_at)
//   and produces the drift report that the quarterly re-calibration acts on. A
//   source that has drifted > 10% from the stored reference opens a review for
//   that material (re-calibrate R12, which may demote a job_type via R22/R20).
//
// What this does NOT do (deliberately):
//   - It does NOT write to the database (no price updates - re-calibration is a
//     reviewed human step; this only flags candidates).
//   - It does NOT fetch the live supplier URLs in this build. Live fetches need
//     network access + per-supplier auth/scraping that is out of scope here, so
//     the re-check is STRUCTURED but stubbed: the loop is written, the current
//     vs stored comparison + > 10% drift rule is encoded, and each ref is printed
//     in a "would re-check" list with its source_url. Wiring a real fetcher is the
//     single clearly-marked TODO below - drop a fetchLivePrice() in and the drift
//     math already works.
//
// FLAG-NOT-FABRICATE: this report never invents a "current" price. A current
// price only enters the drift calc from a real fetch; with the fetcher stubbed,
// every row is reported as "would re-check" (drift not yet measured) - never as
// "0% drift / all clear", which would be a false negative.

import pg from 'pg'

const { Client } = pg

const DRIFT_THRESHOLD = 0.10 // > 10% movement from the stored ref opens a review (spec R26)

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set (expected in .env.local). Aborting - read-only, nothing changed.')
  process.exit(1)
}

const c = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

/**
 * TODO (R26 live-fetch wiring): fetch the current trade-counter buy price for a
 * stored supplier reference. MUST be flag-not-fabricate:
 *   - return a positive number ONLY for a verified live price from `ref.source_url`
 *     (Reece/Tradelink for plumbing; L&H/MMEM/Middys for electrical - NOT Bunnings RRP).
 *   - return null when the price cannot be verified (login wall, page moved, parse
 *     failure). null => the ref is reported "could not re-check", NEVER assumed unchanged.
 * Until wired this returns null for every ref (stub), so no drift is fabricated.
 */
async function fetchLivePrice(_ref) {
  // Intentionally unimplemented in this build - see header. Returns null = "not re-checked".
  return null
}

async function tableExists(client, table) {
  const { rows } = await client.query(`select to_regclass($1) as t`, [`public.${table}`])
  return rows[0]?.t != null
}

await c.connect()
console.log('=== R26 quarterly price-drift re-calibration (READ-ONLY) ===')
console.log(`Drift rule: a source > ${Math.round(DRIFT_THRESHOLD * 100)}% from its stored reference opens a re-calibration review.\n`)

try {
  if (!(await tableExists(c, 'supplier_price_refs'))) {
    console.log('supplier_price_refs table does NOT exist yet.')
    console.log('It is introduced by the R12 calibration migration (item, supplier, sku, price_ex_gst,')
    console.log('source_url, captured_at). Until that migration lands there are no stored references to')
    console.log('drift-check, so this report has nothing to compare against. This is reported plainly')
    console.log('rather than as an all-clear. Re-run after the R12 migration seeds the references.')
    console.log('\n(done - read-only, no writes)')
    await c.end()
    process.exit(0)
  }

  const refs = await c.query(
    `select item, supplier, sku, price_ex_gst, source_url, captured_at
       from supplier_price_refs
      order by supplier, item`,
  )

  console.log(`--- Stored supplier price references (${refs.rows.length}) ---`)
  if (refs.rows.length === 0) {
    console.log('  (supplier_price_refs is empty - nothing to re-check)')
    console.log('\n(done - read-only, no writes)')
    await c.end()
    process.exit(0)
  }
  console.table(
    refs.rows.map((r) => ({
      item: r.item,
      supplier: r.supplier,
      sku: r.sku ?? '(none)',
      stored_ex_gst: r.price_ex_gst,
      captured_at: r.captured_at instanceof Date ? r.captured_at.toISOString().slice(0, 10) : r.captured_at,
    })),
  )

  // ── Re-check loop (drift math live; live fetch stubbed) ─────────────────
  const drifted = []
  const notRechecked = []
  const inBand = []

  for (const ref of refs.rows) {
    const stored = Number(ref.price_ex_gst)
    const current = await fetchLivePrice(ref) // null until fetchLivePrice() is wired
    if (current == null || !Number.isFinite(stored) || stored === 0) {
      notRechecked.push(ref)
      continue
    }
    const driftFrac = Math.abs(current - stored) / Math.abs(stored)
    if (driftFrac > DRIFT_THRESHOLD) {
      drifted.push({ ref, current, driftFrac })
    } else {
      inBand.push({ ref, current, driftFrac })
    }
  }

  console.log('\n--- WOULD RE-CHECK (live fetch stubbed - wire fetchLivePrice()) ---')
  if (notRechecked.length === 0) {
    console.log('  (none - every ref was re-checked)')
  } else {
    for (const r of notRechecked) {
      console.log(`  - ${r.supplier} / ${r.item}${r.sku ? ` (${r.sku})` : ''}: stored $${r.price_ex_gst} ex-GST`)
      console.log(`      source: ${r.source_url ?? '(no source_url on file)'}`)
    }
    console.log(`\n  ${notRechecked.length} ref(s) NOT yet drift-checked (no live price). Not assumed unchanged.`)
  }

  if (drifted.length > 0) {
    console.log('\n=== DRIFT REVIEW REQUIRED (> 10% from stored reference) ===')
    for (const d of drifted) {
      console.log(
        `  - ${d.ref.supplier} / ${d.ref.item}: stored $${d.ref.price_ex_gst} -> current $${d.current.toFixed(2)} (${Math.round(d.driftFrac * 100)}% drift)`,
      )
    }
    console.log('\n  Open an R12 re-calibration review for each. A job_type whose materials drifted may')
    console.log('  need demotion (R22) and re-graduation (R20) after re-pricing.')
  } else if (inBand.length > 0) {
    console.log(`\nAll ${inBand.length} re-checked ref(s) within +-${Math.round(DRIFT_THRESHOLD * 100)}%. No drift review needed for those.`)
  }

  console.log('\n(done - read-only, no writes; live fetch stubbed - see fetchLivePrice TODO)')
} catch (err) {
  console.error('quarterly-recalibration failed (read-only - nothing changed):', err.message ?? err)
  process.exitCode = 1
} finally {
  await c.end()
}
