// READ-ONLY: pre-flight before deleting tenant 4f93…
//  1. all FKs pointing at tenants.id — confirm ON DELETE CASCADE on every one
//  2. owner_email uniqueness landscape (lower-cased) — for the new partial unique index
//  3. dry-run the cascade — what would be deleted

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const VICTIM = "4f93e688-deb1-41f0-84d9-0f57e956720d";

try {
  await c.connect();

  // 1. FK CASCADE behaviour
  const { rows: fks } = await c.query(`
    select
      c.conname              as constraint_name,
      ns.nspname || '.' || cl.relname  as child_table,
      a.attname              as child_column,
      ns2.nspname || '.' || cl2.relname as parent_table,
      a2.attname             as parent_column,
      c.confdeltype          as on_delete
    from pg_constraint c
    join pg_class cl  on cl.oid  = c.conrelid
    join pg_class cl2 on cl2.oid = c.confrelid
    join pg_namespace ns  on ns.oid  = cl.relnamespace
    join pg_namespace ns2 on ns2.oid = cl2.relnamespace
    join unnest(c.conkey)  with ordinality as k(attnum, ord) on true
    join unnest(c.confkey) with ordinality as k2(attnum, ord) on k2.ord = k.ord
    join pg_attribute a  on a.attrelid  = cl.oid  and a.attnum  = k.attnum
    join pg_attribute a2 on a2.attrelid = cl2.oid and a2.attnum = k2.attnum
    where c.contype = 'f'
      and cl2.relname = 'tenants'
      and ns2.nspname = 'public'
    order by child_table, child_column`);

  console.log("─── FKs referencing tenants.id ─────────────────────────");
  const cascadeMap = { a: "no action", r: "restrict", c: "CASCADE", n: "set null", d: "set default" };
  let nonCascade = 0;
  for (const r of fks) {
    const mode = cascadeMap[r.on_delete] || r.on_delete;
    const flag = r.on_delete === "c" ? "✓" : "⚠";
    if (r.on_delete !== "c") nonCascade++;
    console.log(`  ${flag} ${r.child_table}.${r.child_column.padEnd(15)} → ${r.parent_table}.${r.parent_column}  on_delete=${mode}`);
  }
  console.log(`  Non-CASCADE FKs: ${nonCascade}`);

  // 2. owner_email uniqueness
  const { rows: emails } = await c.query(`
    select lower(owner_email) as e, count(*) c, array_agg(business_name) names, array_agg(status) statuses
      from tenants
      group by lower(owner_email)
      having count(*) > 1
      order by c desc`);
  console.log("\n─── duplicate owner_email (lower-cased) ────────────────");
  if (!emails.length) console.log("  ✓ none — partial unique index will apply cleanly");
  else for (const r of emails) console.log(`  ⚠ ${r.e} x${r.c}  names=${JSON.stringify(r.names)} statuses=${JSON.stringify(r.statuses)}`);

  // 3. Dry-run: what would CASCADE delete?
  console.log(`\n─── CASCADE preview for tenant_id = ${VICTIM} ──────────`);
  const queries = [
    ["intakes", `select count(*) from intakes where tenant_id = $1`],
    ["sms_conversations", `select count(*) from sms_conversations where tenant_id = $1`],
    ["customers", `select count(*) from customers where tenant_id = $1`],
    ["tenant_custom_assemblies", `select count(*) from tenant_custom_assemblies where tenant_id = $1`],
    ["tenant_material_catalogue", `select count(*) from tenant_material_catalogue where tenant_id = $1`],
    ["tenant_material_preferences", `select count(*) from tenant_material_preferences where tenant_id = $1`],
    ["tenant_service_offerings", `select count(*) from tenant_service_offerings where tenant_id = $1`],
    ["tenant_licences", `select count(*) from tenant_licences where tenant_id = $1`],
    ["tenant_assembly_overrides", `select count(*) from tenant_assembly_overrides where tenant_id = $1`],
    ["tenant_assembly_bom", `select count(*) from tenant_assembly_bom where tenant_id = $1`],
    ["pricing_book", `select count(*) from pricing_book where tenant_id = $1`],
    ["calls", `select count(*) from calls where tenant_id = $1`],
    ["quotes", `select count(*) from quotes where tenant_id = $1`],
  ];
  for (const [t, sql] of queries) {
    try {
      const { rows } = await c.query(sql, [VICTIM]);
      console.log(`  ${t.padEnd(30)} ${rows[0].count}`);
    } catch (e) {
      console.log(`  ${t.padEnd(30)} ERR: ${e.message}`);
    }
  }

  // 4. Confirm the tenant exists and is the right one
  const { rows: target } = await c.query(
    `select id, business_name, owner_first_name, owner_email, status, created_at,
            twilio_sms_number, vapi_assistant_id
       from tenants where id = $1`,
    [VICTIM],
  );
  console.log("\n─── target tenant (will be deleted) ────────────────────");
  if (!target.length) console.log("  ⚠ tenant not found");
  else for (const [k, v] of Object.entries(target[0]))
    console.log(`  ${k.padEnd(22)} ${v ?? "(null)"}`);
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
