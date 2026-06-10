// Diagnose the SMS roofing repeating-reply bug: is roofing_state actually
// being persisted? Reads via pg (bypasses PostgREST) so it shows the TRUE
// column value, and forces a PostgREST schema-cache reload.
// Usage: node --env-file=.env.local scripts/diag-roofing-state.mjs

import pg from 'pg'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const col = await c.query(
  `select exists(select 1 from information_schema.columns
     where table_schema='public' and table_name='sms_conversations' and column_name='roofing_state') as p`,
)
console.log('sms_conversations.roofing_state column exists:', col.rows[0].p)

// Force PostgREST (the API layer supabase-js uses) to reload its schema
// cache so it can read/write the new column. Migration 085 omitted this.
await c.query(`notify pgrst, 'reload schema'`)
console.log("sent: notify pgrst 'reload schema'")

const recent = await c.query(
  `select id, from_number, to_number, status, last_message_at,
          (roofing_state is not null) as has_roofing_state,
          roofing_state
     from sms_conversations
    order by last_message_at desc nulls last
    limit 8`,
)
console.log('\n--- 8 most-recent conversations ---')
for (const r of recent.rows) {
  console.log(
    `${(r.last_message_at ?? '').toString().slice(0, 19)} | ${r.from_number} -> ${r.to_number} | ${r.status} | roofing_state=${r.has_roofing_state ? JSON.stringify(r.roofing_state) : 'NULL'}`,
  )
}

await c.end()
