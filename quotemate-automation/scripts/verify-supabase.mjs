// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Supabase connection verifier
//
// Usage:  node --env-file=.env.local scripts/verify-supabase.mjs
//
// Confirms the URL + service_role key in .env.local can reach your
// Supabase instance, lists every table the pipeline needs, and counts
// rows in each. If you ran sql/init.sql, you should see:
//   shared_assemblies = 5
//   shared_materials  = 8
//   pricing_book      = 1
//   calls/intakes/quotes/quote_line_items = 0
// ═══════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

if (url.endsWith("/rest/v1/") || url.endsWith("/rest/v1")) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL ends with /rest/v1/ — strip that off");
  console.error(`   Current: ${url}`);
  console.error(`   Should be: ${url.replace(/\/rest\/v1\/?$/, "")}`);
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const tables = [
  "shared_assemblies",
  "shared_materials",
  "pricing_book",
  "calls",
  "intakes",
  "quotes",
  "quote_line_items",
];

console.log(`\n→ Connecting to ${url}\n`);

let pass = 0;
let fail = 0;

for (const table of tables) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) {
    console.log(`  ✗ ${table.padEnd(22)} ERROR: ${error.message}`);
    fail++;
  } else {
    console.log(`  ✓ ${table.padEnd(22)} ${count} row${count === 1 ? "" : "s"}`);
    pass++;
  }
}

console.log("");

if (fail > 0) {
  console.error(`✗ ${fail} table${fail === 1 ? "" : "s"} unreachable.`);
  console.error("  → If error is \"relation does not exist\": you haven't run sql/init.sql yet.");
  console.error("  → If error is auth/network: check SUPABASE_SERVICE_ROLE_KEY and the URL.\n");
  process.exit(1);
}

console.log(`✓ All ${pass} tables reachable. Supabase is wired up correctly.\n`);
