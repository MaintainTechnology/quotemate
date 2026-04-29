// ═══════════════════════════════════════════════════════════════════
// QuoteMate · V.3 — Complex test (inspection path)
//
// Sends the deliberately-risky transcript from beginner-walkthrough V.3
// through the full Stage 03 → 04 → 05 pipeline and verifies the
// inspection-routing fallback triggers correctly.
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";
import { randomUUID } from "node:crypto";
const { Client } = pg;

const VAPI_SERVER_URL = process.env.VAPI_SERVER_URL;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

const callId = `v3-${Date.now()}-${randomUUID().slice(0, 8)}`;

// V.3 verbatim transcript from the walkthrough — burning smell, ceramic fuses, EV charger.
// In a real Vapi call the AI would emergency-override and cut Q&A short. This stub
// simulates the customer's statements as Vapi would have transcribed them.
const transcript = [
  "AI: G'day, you've reached the AI quoting line for Anant Electrical. This call may be recorded for quality and quote-drafting purposes. Sound good?",
  "Customer: Yeah.",
  "AI: What's your name?",
  "Customer: Anant.",
  "AI: Suburb?",
  "Customer: Bondi, Sydney.",
  "AI: What's happening?",
  "Customer: Hey, there's a burning smell coming from my switchboard, and the breakers keep tripping. I also want to add an EV charger. It's an old place — the switchboard still has ceramic fuses.",
  "AI: That sounds urgent — please switch off the main switch at your switchboard if it's safe, and don't use anything electrical until we get there.",
  "Customer: Okay, doing that now.",
  "AI: I've alerted the on-call electrician. They'll call you back within 15 minutes to dispatch.",
].join("\n");

const payload = {
  message: {
    type: "end-of-call-report",
    durationSeconds: 75,
    transcript,
    recordingUrl: "https://example.com/v3-recording.mp3",
    call: { id: callId, customer: { number: "+61400123456" } },
  },
};

const client = new Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log(`\n[1/4] POSTing V.3 transcript to ${VAPI_SERVER_URL}...`);
const r = await fetch(VAPI_SERVER_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
  body: JSON.stringify(payload),
});
console.log(`      HTTP ${r.status} — ${(await r.text()).slice(0, 80)}`);

console.log(`\n[2/4] Polling intakes for vapi_call_id=${callId}...`);
let intakeId = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { rows } = await client.query(
    `select i.id from intakes i join calls c on c.id = i.call_id where c.vapi_call_id = $1`,
    [callId]
  );
  if (rows.length) { intakeId = rows[0].id; break; }
  process.stdout.write(".");
}
console.log("");
if (!intakeId) { console.error("✗ no intake row in 60s"); process.exit(1); }

console.log(`\n[3/4] Polling quotes for intake_id=${intakeId}...`);
let quoteRow = null;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { rows } = await client.query(`select * from quotes where intake_id = $1`, [intakeId]);
  if (rows.length) { quoteRow = rows[0]; break; }
  process.stdout.write(".");
}
console.log("");
if (!quoteRow) { console.error("✗ no quote row in 180s"); process.exit(1); }

// ─── Pull intake to verify intake-side expectations ─────────────────
const { rows: intakeRows } = await client.query(`select * from intakes where id = $1`, [intakeId]);
const intake = intakeRows[0];

console.log(`\n[4/4] Verifying V.3 expectations\n`);

// ─── Each expected outcome from the walkthrough ─────────────────────
const checks = [];
const ok = (name, got) => checks.push({ pass: true, name, got });
const fail = (name, expected, got) => checks.push({ pass: false, name, expected, got });

// 1. risks array contains the four risk strings
const risks = (Array.isArray(intake.risks) ? intake.risks : []).map((r) => r.toLowerCase());
const riskTokens = [
  ["burning smell", "burning"],
  ["tripping breakers", "trip"],
  ["ceramic-fuse switchboard", "ceramic"],
  ["EV charger on old board", "ev"],
];
for (const [label, token] of riskTokens) {
  const found = risks.some((r) => r.includes(token));
  if (found) ok(`risk "${label}"`, "present in risks[]");
  else fail(`risk "${label}"`, `mention of "${token}"`, "NOT FOUND");
}

// 2. confidence === LOW
if (intake.confidence === "LOW") ok("intake.confidence", "LOW");
else fail("intake.confidence", "LOW", intake.confidence);

// 3. inspection_required === true
if (intake.inspection_required === true) ok("intake.inspection_required", "true");
else fail("intake.inspection_required", "true", String(intake.inspection_required));

// 4. timing.urgency === 'emergency'
const urgency = intake.timing?.urgency;
if (urgency === "emergency") ok("intake.timing.urgency", "emergency");
else fail("intake.timing.urgency", "'emergency'", urgency ?? "(missing)");

// 5. quotes.needs_inspection === true
if (quoteRow.needs_inspection === true) ok("quotes.needs_inspection", "true");
else fail("quotes.needs_inspection", "true", String(quoteRow.needs_inspection));

// 6. quotes uses indicative ranges (no fixed line items)
const tiers = ["good", "better", "best"];
let usesIndicative = true;
let indicativeDetails = [];
for (const t of tiers) {
  const tier = quoteRow[t];
  if (!tier) { indicativeDetails.push(`${t}: null`); continue; }
  const items = Array.isArray(tier.line_items) ? tier.line_items : [];
  const isIndicative = items.length === 0;
  indicativeDetails.push(`${t}: ${items.length} line_items, subtotal=$${tier.subtotal_ex_gst}, label="${tier.label}"`);
  if (!isIndicative) usesIndicative = false;
}
if (usesIndicative) ok("quotes uses indicative ranges", indicativeDetails.join(" | "));
else fail("quotes uses indicative ranges", "all tiers have empty line_items[]", indicativeDetails.join(" | "));

// ─── Print results ─────────────────────────────────────────────────
console.log("─".repeat(78));
let pass = 0, total = 0;
for (const c of checks) {
  total++;
  const tag = c.pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  if (c.pass) {
    console.log(`  ${tag} ${c.name.padEnd(36)} ${c.got}`);
    pass++;
  } else {
    console.log(`  ${tag} ${c.name.padEnd(36)} expected ${c.expected}; got ${c.got}`);
  }
}
console.log("─".repeat(78));
console.log(`  ${pass}/${total} V.3 expectations passed.\n`);

// ─── Show the actual data so the user can sanity-check ─────────────
console.log("─── Intake row ───────────────────────────────────────");
console.log(`  job_type:            ${intake.job_type}`);
console.log(`  inspection_required: ${intake.inspection_required}`);
console.log(`  confidence:          ${intake.confidence}`);
console.log(`  timing:              ${JSON.stringify(intake.timing)}`);
console.log(`  risks:`);
for (const r of intake.risks ?? []) console.log(`    · ${r}`);

console.log("\n─── Quote row ────────────────────────────────────────");
console.log(`  status:              ${quoteRow.status}`);
console.log(`  needs_inspection:    ${quoteRow.needs_inspection}`);
console.log(`  inspection_reason:   ${quoteRow.inspection_reason ?? "(empty)"}`);
console.log(`  estimated_timeframe: ${quoteRow.estimated_timeframe}`);
console.log(`  total_inc_gst:       $${quoteRow.total_inc_gst}`);
console.log(`  scope_of_works:`);
console.log(`    ${(quoteRow.scope_of_works ?? "").replace(/\n/g, "\n    ")}`);

for (const t of ["good", "better", "best"]) {
  const tier = quoteRow[t];
  console.log(`\n  ${t.toUpperCase()}:`);
  if (!tier) { console.log("    (null)"); continue; }
  console.log(`    label:    ${tier.label}`);
  console.log(`    subtotal: $${tier.subtotal_ex_gst}`);
  console.log(`    timeframe: ${tier.timeframe}`);
  console.log(`    line_items: ${tier.line_items?.length ?? 0}`);
}

await client.end();
process.exit(pass === total ? 0 : 1);
