// Smoke test: connect as the public anon role (NOT service role) and
// confirm the 13 RLS Phase 1 tables now return 0 rows. Before migration
// 040 these would have leaked every row. Service-role still bypasses
// RLS — verified separately by the running app.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}

const anon = createClient(url, anonKey, { auth: { persistSession: false } });

// Tables Phase 1 enabled RLS on. Reads should now return 0 rows for anon.
const PHASE_1 = [
  "tenants",
  "customers",
  "sms_conversations",
  "sms_messages",
  "tradie_signup_intents",
  "tenant_assembly_bom",
  "tenant_assembly_overrides",
  "tenant_custom_assemblies",
  "tenant_licences",
  "tenant_material_catalogue",
  "tenant_material_preferences",
  "tenant_service_offerings",
  "shared_assembly_bom",
];

let leaks = 0;
console.log("─── anon-role smoke test (post-migration 040) ──────────");
for (const table of PHASE_1) {
  const { data, error, count } = await anon.from(table).select("*", { count: "exact" }).limit(5);
  if (error) {
    console.log(`  ✓ ${table.padEnd(28)} error: ${error.code}/${error.message.slice(0, 40)}`);
    continue;
  }
  const rows = data?.length ?? 0;
  const total = count ?? rows;
  if (total === 0) {
    console.log(`  ✓ ${table.padEnd(28)} 0 rows visible to anon`);
  } else {
    console.log(`  ✗ ${table.padEnd(28)} LEAK: ${total} rows visible to anon (showing ${rows})`);
    leaks++;
  }
}

if (leaks > 0) {
  console.error(`\n✗ ${leaks} table(s) still leak to anon — RLS not closed`);
  process.exit(1);
}
console.log("\n✓ all 13 Phase 1 tables return 0 rows to anon. Leak closed.");
