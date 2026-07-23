// Backfill roofing_measurements.included_indices for SMS-origin quotes
// confirmed BEFORE the fix that persists the confirmed set (commit
// 089afa1c era). Those rows have confirmed_at set but included_indices
// NULL, so /q/roof/[token] falls back to main-dwelling-only and can show
// a DIFFERENT price than the SMS the customer received (observed live
// 2026-07-22: SMS $115,117 for 2 structures vs page $69,652 for 1).
//
// Selection source, in order:
//   1. the conversation's roofing_state.last_served_structures (what the
//      SMS actually served)
//   2. confirmed_structure (single pick)
//   3. all structures 1..structure_count (customer replied YES to all)
//
// pdf_path is NULLed on changed rows so the cached PDF regenerates with
// the corrected selection on next download.
//
// DRY-RUN by default — prints exactly what would change, including the
// before-values needed to reverse it. Apply with --apply.
// Usage: node --env-file=.env.local scripts/backfill-roofing-included-indices.mjs [--apply]

import pg from 'pg'

const apply = process.argv.includes('--apply')
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const { rows } = await c.query(`
  select m.id, m.public_token, m.address, m.structure_count,
         m.confirmed_structure, m.included_indices, m.pdf_path,
         m.confirmed_at, t.business_name,
         sc.roofing_state -> 'last_served_structures' as last_served
    from roofing_measurements m
    left join tenants t on t.id = m.tenant_id
    left join lateral (
      select roofing_state
        from sms_conversations
       where roofing_state ->> 'pending_quote_token' = m.public_token
       order by last_message_at desc nulls last
       limit 1
    ) sc on true
   where m.confirmed_at is not null
     and m.included_indices is null
     and m.customer_phone is not null
   order by m.confirmed_at desc
`)

console.log(`${rows.length} confirmed SMS-origin rows lack included_indices\n`)
let changed = 0
for (const r of rows) {
  const count = Number(r.structure_count ?? 1)
  const served = Array.isArray(r.last_served)
    ? r.last_served.map(Number).filter((n) => n >= 1 && n <= count)
    : null
  const target =
    served && served.length > 0
      ? served
      : r.confirmed_structure != null
        ? [Number(r.confirmed_structure)]
        : Array.from({ length: count }, (_, i) => i + 1)

  console.log(
    `${r.public_token} | ${(r.business_name ?? '(no tenant)').padEnd(20)} | ${String(r.address).slice(0, 40)}`,
  )
  console.log(
    `  structures=${count} confirmed_structure=${r.confirmed_structure} last_served=${JSON.stringify(r.last_served)}`,
  )
  console.log(`  BEFORE included_indices=null pdf_path=${r.pdf_path}`)
  console.log(`  AFTER  included_indices=${JSON.stringify(target)} pdf_path=null`)

  if (apply) {
    await c.query(
      `update roofing_measurements
          set included_indices = $1, pdf_path = null
        where id = $2 and included_indices is null`,
      [target, r.id],
    )
    changed++
  }
}

console.log(apply ? `\nAPPLIED to ${changed} rows.` : '\nDRY-RUN — nothing written. Re-run with --apply.')
await c.end()
