// READ-ONLY: assess feasibility of backfilling tenant_id on pre-mig-015/017
// orphan rows. The 5 tables with tenant_id IS NULL counts (per the 038
// orphan check):
//   intakes 128 · sms_conversations 74 · quotes 108 · calls 49 · customers 4
//
// Attribution strategies to test:
//   1. calls: caller_number matches a customer? OR vapi_call_id maps to a tenant's vapi_assistant_id?
//   2. sms_conversations: twilio_number column → match against tenants.twilio_sms_number
//   3. intakes: via call_id → if calls is resolved, follow the FK
//   4. quotes: via intake_id → if intakes is resolved, follow the FK
//   5. customers: 4 rows, look at columns
//
// Print the columns each orphan table actually has so we know what
// joins are possible.

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const orphanTables = ["intakes", "sms_conversations", "quotes", "calls", "customers"];

try {
  await c.connect();

  // 1. Per-table orphan counts (re-confirm post mig-040)
  console.log("─── orphan counts (tenant_id IS NULL) ─────────────────");
  for (const t of orphanTables) {
    const { rows } = await c.query(`select count(*)::int n from ${t} where tenant_id is null`);
    const { rows: total } = await c.query(`select count(*)::int n from ${t}`);
    console.log(`  ${t.padEnd(22)} ${String(rows[0].n).padStart(4)} / ${total[0].n} total`);
  }

  // 2. Schema for each — what attribution columns do we have?
  for (const t of orphanTables) {
    const { rows } = await c.query(`
      select column_name, data_type from information_schema.columns
        where table_schema='public' and table_name=$1
        order by ordinal_position`, [t]);
    console.log(`\n─── ${t} columns (${rows.length}) ────────`);
    for (const r of rows) console.log(`  ${r.column_name.padEnd(28)} ${r.data_type}`);
  }

  // 3. tenants reference columns we can match against
  const { rows: tenants } = await c.query(`
    select id, business_name, twilio_sms_number, twilio_voice_number, vapi_assistant_id,
           owner_mobile, created_at
      from tenants order by created_at`);
  console.log(`\n─── tenants reference (${tenants.length} rows) ────────`);
  for (const t of tenants)
    console.log(`  ${t.business_name.padEnd(18)} sms=${t.twilio_sms_number ?? "—"} voice=${t.twilio_voice_number ?? "—"} vapi=${(t.vapi_assistant_id ?? "—").slice(0, 16)} created=${t.created_at.toISOString().slice(0, 10)}`);

  // 4. Sample orphan rows from each table to see what data we have
  for (const t of orphanTables) {
    const { rows } = await c.query(`select * from ${t} where tenant_id is null order by created_at desc limit 2`);
    if (!rows.length) continue;
    console.log(`\n─── ${t} sample orphan (newest 2) ────────`);
    for (const r of rows) {
      const cols = Object.entries(r)
        .filter(([k, v]) => v !== null && k !== "embedding" && k !== "transcript" && k !== "scope" && k !== "access" && k !== "property" && k !== "risks" && k !== "caller" && k !== "timing" && k !== "good" && k !== "better" && k !== "best" && k !== "conversation_state")
        .map(([k, v]) => {
          const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v).slice(0, 30) : String(v);
          return `${k}=${s.length > 50 ? s.slice(0, 50) + "…" : s}`;
        })
        .join("  ");
      console.log(`  ${cols}`);
    }
  }
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
