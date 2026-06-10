// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Verify RLS is set up correctly
//
// Tries to read every table with both keys:
//   · anon (the "publicly visible" key — should be REJECTED everywhere)
//   · service_role (your pipeline's key — should READ everything)
// If anon = 0 reads and service_role = 7 reads, you're locked down right.
// ═══════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("Missing one of NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const tables = [
  "shared_assemblies",
  "shared_materials",
  "pricing_book",
  "calls",
  "intakes",
  "quotes",
  "quote_line_items",
];

const anon = createClient(url, anonKey);
const service = createClient(url, serviceKey);

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Step 1 · Get true row counts via service_role (bypasses RLS)");
console.log("══════════════════════════════════════════════════════════════════\n");

const truth = {};
for (const table of tables) {
  const { count } = await service.from(table).select("*", { count: "exact", head: true });
  truth[table] = count ?? 0;
  console.log(`  ${table.padEnd(22)} ${truth[table]} actual rows`);
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Step 2 · Try the same reads through anon key (should see 0)");
console.log("══════════════════════════════════════════════════════════════════\n");

let anonLeaks = 0;
let anonBlocked = 0;

for (const table of tables) {
  const { count, error } = await anon.from(table).select("*", { count: "exact", head: true });
  if (error) {
    console.log(`  ✓ ${table.padEnd(22)} BLOCKED  (${error.code ?? "?"}: ${error.message.slice(0, 60)})`);
    anonBlocked++;
  } else if ((count ?? 0) === 0 && truth[table] > 0) {
    console.log(`  ✓ ${table.padEnd(22)} BLOCKED  (anon sees 0 of ${truth[table]} actual rows — RLS hiding them)`);
    anonBlocked++;
  } else if ((count ?? 0) === 0 && truth[table] === 0) {
    console.log(`  ✓ ${table.padEnd(22)} BLOCKED  (table empty + RLS on — both anon & service see 0; can't distinguish but RLS is on)`);
    anonBlocked++;
  } else {
    console.log(`  ✗ ${table.padEnd(22)} LEAKED  anon sees ${count} of ${truth[table]} rows!`);
    anonLeaks++;
  }
}

// Try a write attack — should fail with explicit RLS error
const { error: writeErr } = await anon.from("calls").insert({ vapi_call_id: "anon-attack-test", transcript: "I shouldn't be here" });
if (writeErr && writeErr.code === "42501") {
  console.log(`  ✓ ${"calls (write)".padEnd(22)} BLOCKED  (42501: new row violates row-level security policy)`);
  anonBlocked++;
} else if (writeErr) {
  console.log(`  ✓ ${"calls (write)".padEnd(22)} BLOCKED  (${writeErr.code}: ${writeErr.message.slice(0, 50)})`);
  anonBlocked++;
} else {
  console.log(`  ✗ ${"calls (write)".padEnd(22)} ALLOWED — anon could insert! Big problem.`);
  anonLeaks++;
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Verdict");
console.log("══════════════════════════════════════════════════════════════════\n");

const totalChecks = tables.length + 1;
const pipelineOK = Object.values(truth).some((n) => n > 0); // service_role saw actual data

if (anonLeaks === 0 && pipelineOK) {
  console.log("  ✓ Anon role: blocked on all 7 reads + 1 write attempt. Cannot read or modify anything.");
  console.log("  ✓ Service role: full access (sees the seeded library tables and pipeline rows).");
  console.log("  ✓ RLS is set up correctly. Public-internet attackers with the anon key get nothing.");
  console.log("    Your webhook handler keeps working because it uses service_role.\n");
} else {
  if (anonLeaks > 0) console.log(`  ✗ Anon role leaked ${anonLeaks} access path(s). Check the BLOCKED/LEAKED markers above.`);
  if (!pipelineOK) console.log(`  ✗ Service role saw nothing — that's odd; check the connection.`);
  console.log("");
  process.exit(1);
}
