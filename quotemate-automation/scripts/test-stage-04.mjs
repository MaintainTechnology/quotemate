// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Test Stage 04 (Intake Engine) end-to-end
//
// 1. Finds the most recent calls row
// 2. POSTs its callId to /api/intake/structure
// 3. Waits for Sonnet to extract + Voyage/stub to embed
// 4. Queries intakes to confirm a row landed
// 5. Pretty-prints the structured output
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";
const { Client } = pg;

const APP_URL = process.env.APP_URL || "http://localhost:3000";
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("\n[1/5] Finding most recent calls row...");
const { rows: calls } = await client.query(
  `select id, vapi_call_id, length(transcript) as chars
   from calls order by created_at desc limit 1`
);
if (calls.length === 0) {
  console.error("✗ No rows in calls table. Run scripts/simulate-vapi-call.mjs first.");
  await client.end();
  process.exit(1);
}
const call = calls[0];
console.log(`      Found call ${call.id} (vapi_call_id=${call.vapi_call_id}, transcript=${call.chars} chars)`);

console.log(`\n[2/5] POSTing to ${APP_URL}/api/intake/structure...`);
console.log(`      This calls Claude Sonnet 4.6 to extract structured fields. Takes 5–15 seconds.`);

const t0 = Date.now();
const res = await fetch(`${APP_URL}/api/intake/structure`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ callId: call.id }),
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const body = await res.text();
console.log(`      HTTP ${res.status} in ${elapsed}s  →  ${body.slice(0, 200)}`);

if (!res.ok) {
  console.error("\n✗ Stage 04 returned an error. Check the pnpm dev terminal.");
  await client.end();
  process.exit(1);
}

const { intakeId } = JSON.parse(body);

console.log(`\n[3/5] Waiting 0.5s for the row to be queryable...`);
await new Promise((r) => setTimeout(r, 500));

console.log(`\n[4/5] Querying intakes table for id=${intakeId}...`);
const { rows: intakes } = await client.query(
  `select id, call_id, job_type, address, suburb,
          scope, access, property, risks, inspection_required,
          caller, timing, confidence, confidence_reason,
          (embedding is not null) as has_embedding,
          array_length(string_to_array(trim(both '[]' from embedding::text), ','), 1) as embedding_dim
   from intakes where id = $1`,
  [intakeId]
);

if (intakes.length === 0) {
  console.error("✗ No intake row found.");
  await client.end();
  process.exit(1);
}

const i = intakes[0];

console.log(`\n[5/5] Stage 04 output:\n`);
console.log(`  ── identity ─────────────────────────────────────`);
console.log(`  intake.id            = ${i.id}`);
console.log(`  call_id              = ${i.call_id}`);
console.log(`  embedding present    = ${i.has_embedding} (${i.embedding_dim} dims)`);
console.log(``);
console.log(`  ── classification ───────────────────────────────`);
console.log(`  job_type             = ${i.job_type}`);
console.log(`  inspection_required  = ${i.inspection_required}`);
console.log(`  confidence           = ${i.confidence}`);
console.log(`  confidence_reason    = ${i.confidence_reason}`);
console.log(``);
console.log(`  ── caller ───────────────────────────────────────`);
console.log(`  ${JSON.stringify(i.caller, null, 2).split("\n").join("\n  ")}`);
console.log(``);
console.log(`  ── address ──────────────────────────────────────`);
console.log(`  address              = ${i.address}`);
console.log(`  suburb               = ${i.suburb}`);
console.log(``);
console.log(`  ── scope ────────────────────────────────────────`);
console.log(`  ${JSON.stringify(i.scope, null, 2).split("\n").join("\n  ")}`);
console.log(``);
console.log(`  ── access ───────────────────────────────────────`);
console.log(`  ${JSON.stringify(i.access ?? null, null, 2).split("\n").join("\n  ")}`);
console.log(``);
console.log(`  ── property ─────────────────────────────────────`);
console.log(`  ${JSON.stringify(i.property ?? null, null, 2).split("\n").join("\n  ")}`);
console.log(``);
console.log(`  ── risks ────────────────────────────────────────`);
if (Array.isArray(i.risks) && i.risks.length) {
  for (const r of i.risks) console.log(`  · ${r}`);
} else {
  console.log(`  (none flagged)`);
}
console.log(``);
console.log(`  ── timing ───────────────────────────────────────`);
console.log(`  ${JSON.stringify(i.timing ?? null, null, 2).split("\n").join("\n  ")}`);

await client.end();
console.log(`\n✓ Stage 04 verified end-to-end.`);
console.log(`  Note: Stage 04 fired Stage 05 in the background. /api/estimate/draft doesn't`);
console.log(`  exist yet, so that fire-and-forget call failed silently. The intakes row still`);
console.log(`  landed. Build Stage 05 next to complete the pipeline.\n`);
