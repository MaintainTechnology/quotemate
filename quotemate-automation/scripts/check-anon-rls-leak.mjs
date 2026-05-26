// Probe each of the 9 RLS-off tables with the public anon key (NOT the
// service role) — proves what an outsider would see. Read-only.
//
// Run: node --env-file=.env.local scripts/check-anon-rls-leak.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, anon);

const TABLES = [
  "admin_users",
  "categories",
  "import_batches",
  "import_staged_rows",
  "quote_followup_events",
  "supplier_catalogue",
  "tenant_tier_ladder",
  "trade_pricing_defaults",
  "trade_prompts",
  "trades",
];

console.log("Anon-key read probe (what an outsider sees right now):\n");
console.log("Table                          rows_visible_to_anon");
console.log("─".repeat(56));

for (const t of TABLES) {
  const { count, error } = await supabase
    .from(t)
    .select("*", { count: "exact", head: true });
  if (error) {
    console.log(`  ${t.padEnd(30)} ERROR: ${error.message}`);
  } else {
    const badge = count > 0 ? "  ⚠ LEAK" : "  (locked)";
    console.log(`  ${t.padEnd(30)} ${String(count).padEnd(6)} ${badge}`);
  }
}
