// READ-ONLY: compare the two "Sparky" tenants so we can decide which is real.
// Surfaces: tenants row, attached intakes/quotes/sms/conversations/customers,
// twilio/vapi numbers, stripe ids, signup intent, custom catalogue, materials.

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const SPARKY_IDS = [
  "4f93e688-deb1-41f0-84d9-0f57e956720d",
  "6dca084c-10d5-4459-b48f-9b45e4bbc68a",
];

try {
  await c.connect();

  // 1. Full tenants rows
  const { rows: tenants } = await c.query(
    `select * from tenants where id = any($1::uuid[])`,
    [SPARKY_IDS],
  );

  for (const t of tenants) {
    console.log("\n" + "═".repeat(78));
    console.log(`TENANT  id=${t.id}`);
    console.log("═".repeat(78));
    for (const [k, v] of Object.entries(t)) {
      const s = v === null ? "(null)" : typeof v === "object" ? JSON.stringify(v) : String(v);
      console.log(`  ${k.padEnd(28)} ${s}`);
    }

    // 2. Counts per related table
    const queries = [
      ["intakes (via signup_intents.tenant? no — direct?)", `select count(*) from intakes where tenant_id = $1`],
      ["quotes (via intake -> quote, no direct tenant col)", null],
      ["sms_conversations", `select count(*) from sms_conversations where tenant_id = $1`],
      ["sms_messages (via conversation)", `select count(*) from sms_messages m join sms_conversations c on c.id = m.conversation_id where c.tenant_id = $1`],
      ["calls (no tenant col? check)", null],
      ["customers", `select count(*) from customers where tenant_id = $1`],
      ["tradie_signup_intents", `select count(*) from tradie_signup_intents where tenant_id = $1`],
      ["tenant_custom_assemblies", `select count(*) from tenant_custom_assemblies where tenant_id = $1`],
      ["tenant_material_catalogue", `select count(*) from tenant_material_catalogue where tenant_id = $1`],
      ["tenant_material_preferences", `select count(*) from tenant_material_preferences where tenant_id = $1`],
      ["tenant_service_offerings", `select count(*) from tenant_service_offerings where tenant_id = $1`],
      ["pricing_book", `select count(*) from pricing_book where tenant_id = $1`],
      ["tenant_licences", `select count(*) from tenant_licences where tenant_id = $1`],
    ];
    console.log(`\n  ─── related-table counts ───`);
    for (const [label, sql] of queries) {
      if (!sql) {
        console.log(`    ${label.padEnd(40)} (skipped — no tenant_id column)`);
        continue;
      }
      try {
        const { rows } = await c.query(sql, [t.id]);
        console.log(`    ${label.padEnd(40)} ${rows[0].count}`);
      } catch (e) {
        console.log(`    ${label.padEnd(40)} ERR: ${e.message}`);
      }
    }
  }

  // 3. Check which columns each table has tenant_id on (for schema confidence)
  const { rows: tenantColTables } = await c.query(`
    select table_name from information_schema.columns
      where table_schema='public' and column_name='tenant_id'
      order by table_name`);
  console.log("\n" + "═".repeat(78));
  console.log("Tables with a tenant_id column (for reference):");
  console.log("═".repeat(78));
  for (const r of tenantColTables) console.log(`  ${r.table_name}`);

  // 4. Owner / auth_user_id for each Sparky tenant (if column exists)
  const { rows: ownerCheck } = await c.query(`
    select column_name from information_schema.columns
      where table_schema='public' and table_name='tenants'
        and column_name in ('owner_id', 'auth_user_id', 'user_id', 'created_by', 'email')`);
  console.log("\nTenants ownership columns present:", ownerCheck.map((r) => r.column_name).join(", ") || "(none)");
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
