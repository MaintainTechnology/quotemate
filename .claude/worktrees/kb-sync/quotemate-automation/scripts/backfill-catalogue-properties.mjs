// Best-effort backfill of tenant_material_catalogue.properties from product
// NAMES, using the SAME canonicaliser as the runtime guard (imported via tsx
// so the two can never drift). For each active row it fills only the spec keys
// the (trade, category) registry cares about, and ONLY when the row doesn't
// already carry a tradie-set value — it NEVER overwrites.
//
// Dry-run by default (prints the diff). Apply with --apply.
//   node --import tsx --env-file=.env.local scripts/backfill-catalogue-properties.mjs
//   node --import tsx --env-file=.env.local scripts/backfill-catalogue-properties.mjs --apply

import pg from 'pg'
import { canonicalise, getSpecDefs } from '../lib/estimate/spec-registry.ts'

const APPLY = process.argv.includes('--apply')
const { Client } = pg

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === ''
}

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  const { rows } = await c.query(
    `select id, tenant_id, trade, category, name, coalesce(properties, '{}'::jsonb) as properties
       from tenant_material_catalogue
      where active = true
      order by trade, category, name`,
  )

  let scanned = 0
  let toUpdate = 0
  const updates = []

  for (const r of rows) {
    scanned++
    const defs = getSpecDefs(r.trade, r.category)
    if (defs.length === 0) continue
    const current = r.properties && typeof r.properties === 'object' ? r.properties : {}
    const additions = {}
    for (const def of defs) {
      if (!isBlank(current[def.key])) continue // never overwrite a tradie value
      const parsed = canonicalise(def.key, r.name)
      if (parsed !== null) additions[def.key] = parsed
    }
    if (Object.keys(additions).length === 0) continue
    toUpdate++
    updates.push({ id: r.id, name: r.name, trade: r.trade, category: r.category, additions, merged: { ...current, ...additions } })
  }

  console.log(`\nScanned ${scanned} active catalogue rows.`)
  console.log(`${toUpdate} row(s) would gain spec properties parsed from their name:\n`)
  for (const u of updates) {
    console.log(`  • [${u.trade}/${u.category}] ${u.name}`)
    console.log(`      + ${JSON.stringify(u.additions)}`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to persist.')
  } else {
    for (const u of updates) {
      await c.query(`update tenant_material_catalogue set properties = $1 where id = $2`, [
        JSON.stringify(u.merged),
        u.id,
      ])
    }
    console.log(`\nAPPLIED — updated ${updates.length} row(s).`)
  }
} catch (e) {
  console.error('BACKFILL FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
