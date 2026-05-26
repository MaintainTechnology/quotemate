// Pre-flight audit for deleting Pilot Sparky + Pilot Plumber.
//
// For every FK that references tenants.id, count the rows that will be
// CASCADED (gone) vs SET NULL (orphaned but kept). No writes — read-only.
//
// Run: node --env-file=.env.local scripts/audit-pilot-tenant-deletion.mjs

import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("\n=== Target tenants ===");
const targets = await client.query(`
  select id, business_name, owner_email, trade, trades, status,
         vapi_assistant_id, created_at
  from tenants
  where business_name in ('Pilot Sparky','Pilot Plumber')
  order by business_name
`);
console.table(targets.rows);
if (targets.rowCount === 0) {
  console.log("No matching tenants found. Nothing to do.");
  await client.end();
  process.exit(0);
}
const ids = targets.rows.map((r) => r.id);

console.log("\n=== All FKs pointing at tenants(id) ===");
const fks = await client.query(`
  select
    tc.table_name,
    kcu.column_name,
    rc.delete_rule
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
  join information_schema.constraint_column_usage ccu
    on tc.constraint_name = ccu.constraint_name
  join information_schema.referential_constraints rc
    on tc.constraint_name = rc.constraint_name
  where ccu.table_name = 'tenants'
    and ccu.column_name = 'id'
    and tc.constraint_type = 'FOREIGN KEY'
  order by rc.delete_rule, tc.table_name
`);
console.table(fks.rows);

console.log("\n=== Row counts per FK (will be CASCADED or SET NULL) ===");
const counts = [];
for (const fk of fks.rows) {
  const q = `select count(*)::int as n from ${fk.table_name} where ${fk.column_name} = any($1::uuid[])`;
  const r = await client.query(q, [ids]);
  counts.push({
    table: fk.table_name,
    column: fk.column_name,
    delete_rule: fk.delete_rule,
    rows_affected: r.rows[0].n,
    fate: fk.delete_rule === "CASCADE" ? "DELETED" : fk.delete_rule === "SET NULL" ? "ORPHANED (kept, tenant_id=NULL)" : fk.delete_rule,
  });
}
console.table(counts);

console.log("\n=== Per-tenant breakdown ===");
for (const t of targets.rows) {
  console.log(`\n--- ${t.business_name} (${t.id}) ---`);
  const breakdown = [];
  for (const fk of fks.rows) {
    const q = `select count(*)::int as n from ${fk.table_name} where ${fk.column_name} = $1::uuid`;
    const r = await client.query(q, [t.id]);
    if (r.rows[0].n > 0) {
      breakdown.push({ table: fk.table_name, rule: fk.delete_rule, rows: r.rows[0].n });
    }
  }
  if (breakdown.length === 0) {
    console.log("  (no related rows)");
  } else {
    console.table(breakdown);
  }
}

console.log("\n=== SMS messages tied via sms_conversations (transitive) ===");
const smsMsgs = await client.query(
  `select count(*)::int as sms_messages_in_target_conversations
   from sms_messages m
   join sms_conversations c on c.id = m.conversation_id
   where c.tenant_id = any($1::uuid[])`,
  [ids]
);
console.table(smsMsgs.rows);

console.log("\n=== Quotes via intakes that will lose tenant_id (transitive) ===");
const quotesViaIntakes = await client.query(
  `select count(*)::int as quotes_via_intakes
   from quotes q
   join intakes i on i.id = q.intake_id
   where i.tenant_id = any($1::uuid[])`,
  [ids]
);
console.table(quotesViaIntakes.rows);

await client.end();
