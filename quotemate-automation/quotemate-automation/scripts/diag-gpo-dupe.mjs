// READ-ONLY: confirm whether the two "Clipsal 2000...10A" rows are a true
// same-tenant duplicate, and whether either is referenced by a tier ladder,
// before the 087 migration touches them. No writes.
// Run: node --env-file=.env.local scripts/diag-gpo-dupe.mjs

import pg from 'pg'
const { Client } = pg
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const dupA = 'ce083a0c-f6ea-4889-a9b8-a8276028d510'
const dupB = 'f5a60ce4-f0ff-4762-bda9-3864ea1a866c'

const tenant = await c.query(
  `select tmc.id, tmc.tenant_id, t.business_name, tmc.name, tmc.active, tmc.unit_price_ex_gst, tmc.created_at
     from tenant_material_catalogue tmc left join tenants t on t.id = tmc.tenant_id
    where tmc.id in ($1,$2) order by tmc.created_at`, [dupA, dupB])
console.log('\n=== the two Clipsal 2000 10A rows ===')
console.table(tenant.rows)

try {
  const ladder = await c.query(
    `select * from tenant_tier_ladder where catalogue_id in ($1,$2)`, [dupA, dupB])
  console.log('\n=== tier-ladder references to either row ===')
  console.table(ladder.rows.length ? ladder.rows : [{ note: 'none' }])
} catch (e) {
  console.log('\n=== tier-ladder check failed:', e.message)
}

// Also: the typo row tenant for context
const typo = await c.query(
  `select id, tenant_id, name, active from tenant_material_catalogue where id = 'bf199644-5602-4517-bd85-49c75239bf61'`)
console.log('\n=== typo row (Clipal Iconic Wifi) ===')
console.table(typo.rows)

await c.end()
console.log('\n[done] read-only.')
