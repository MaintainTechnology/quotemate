// READ-ONLY: audit RLS state of every public table — is RLS enabled?
// how many policies? Used to design the C8 RLS rollout.

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await c.connect();
  const { rows: tables } = await c.query(`
    select c.relname as table_name,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_force,
           (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count,
           (select count(*) from information_schema.columns col
             where col.table_schema='public' and col.table_name=c.relname
               and col.column_name='tenant_id')::int as has_tenant_col
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname`);

  console.log(`Table                            RLS_on  Policies  tenant_id?`);
  console.log(`────────────────────────────────────────────────────────────`);
  for (const r of tables) {
    const rls = r.rls_enabled ? "✓" : "✗";
    const has = r.has_tenant_col > 0 ? "✓" : "—";
    const warn = (r.rls_enabled && r.policy_count === 0) ? "  ⚠ RLS-on, no policies" : "";
    console.log(`  ${r.table_name.padEnd(32)} ${rls.padEnd(7)} ${String(r.policy_count).padEnd(9)} ${has}${warn}`);
  }

  // Quick view of which tables expose sensitive columns
  const sensitive = ["tenants", "tradies", "customers", "intakes", "quotes", "calls", "sms_conversations", "sms_messages"];
  console.log(`\n─── sensitive columns sample ───`);
  for (const t of sensitive) {
    const { rows: cols } = await c.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name=$1
        order by ordinal_position`, [t]);
    if (!cols.length) continue;
    console.log(`  ${t.padEnd(20)} (${cols.length} cols)`);
  }
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
