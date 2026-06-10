// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Test full Stage 03 → 04 → 05 pipeline (S5.5)
//
// 1. POSTs a synthetic Vapi end-of-call-report to /api/vapi/webhook
// 2. Waits for Stage 04 (Sonnet structures) and Stage 05 (Opus drafts)
// 3. Queries Supabase to confirm the chain landed
// 4. Pretty-prints the resulting quote with all three tiers
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";
import { randomUUID } from "node:crypto";
const { Client } = pg;

const VAPI_SERVER_URL = process.env.VAPI_SERVER_URL;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!VAPI_SERVER_URL || !SUPABASE_DB_URL) {
  console.error("Missing VAPI_SERVER_URL or SUPABASE_DB_URL");
  process.exit(1);
}

// ─── Realistic transcript matching S5.5's "easy 5" prompt ──────────
const callId = `s5-${Date.now()}-${randomUUID().slice(0, 8)}`;
const transcript = [
  "AI: G'day, you've reached the AI quoting line. Sound good?",
  "Customer: Yeah, all good.",
  "AI: Great — what's your name?",
  "Customer: Anant.",
  "AI: Suburb?",
  "Customer: Bondi, Sydney.",
  "AI: What do you need done?",
  "Customer: I need six downlights in my kitchen, replacing existing halogens, wiring's already there, plaster ceiling, indoor.",
  "AI: Roof access?",
  "Customer: Yes, attic access is fine.",
  "AI: Tri-colour, dimmable, or basic?",
  "Customer: Tri-colour is fine.",
  "AI: All set. Quote on its way.",
].join("\n");

const payload = {
  message: {
    type: "end-of-call-report",
    durationSeconds: 60,
    transcript,
    recordingUrl: "https://example.com/sim-recording.mp3",
    call: { id: callId, customer: { number: "+61400123456" } },
  },
};

const client = new Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log(`\n[1/5] POSTing to ${VAPI_SERVER_URL}...`);
const r = await fetch(VAPI_SERVER_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
  body: JSON.stringify(payload),
});
console.log(`      HTTP ${r.status} — ${(await r.text()).slice(0, 80)}`);
if (!r.ok) { await client.end(); process.exit(1); }

console.log(`\n[2/5] Polling intakes for vapi_call_id=${callId} (Stage 04)...`);
let intakeId = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { rows } = await client.query(
    `select i.id from intakes i join calls c on c.id=i.call_id where c.vapi_call_id = $1`,
    [callId]
  );
  if (rows.length) { intakeId = rows[0].id; break; }
  process.stdout.write(".");
}
console.log("");
if (!intakeId) {
  console.error(`✗ No intake row found after 60s. Stage 04 likely failed; check pnpm dev terminal.`);
  await client.end(); process.exit(1);
}
console.log(`      ✓ intake.id = ${intakeId}`);

console.log(`\n[3/5] Polling quotes for intake_id=${intakeId} (Stage 05)...`);
console.log(`      Opus is calling tools — usually takes 30–90 seconds.`);
let quoteRow = null;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { rows } = await client.query(`select * from quotes where intake_id = $1`, [intakeId]);
  if (rows.length) { quoteRow = rows[0]; break; }
  process.stdout.write(".");
}
console.log("");
if (!quoteRow) {
  console.error(`\n✗ No quote row found after 180s. Stage 05 likely failed; check pnpm dev terminal for errors.`);
  await client.end(); process.exit(1);
}

console.log(`\n[4/5] ✓ Quote drafted in ${Math.round((Date.now() - new Date(quoteRow.created_at).getTime()) / 1000)}s ago.\n`);

console.log(`  ── identity ────────────────────────────────────────────────`);
console.log(`  quote.id              = ${quoteRow.id}`);
console.log(`  intake_id             = ${quoteRow.intake_id}`);
console.log(`  status                = ${quoteRow.status}`);
console.log(`  selected_tier         = ${quoteRow.selected_tier}`);
console.log(``);
console.log(`  ── totals ──────────────────────────────────────────────────`);
console.log(`  subtotal_ex_gst       = $${quoteRow.subtotal_ex_gst}`);
console.log(`  gst                   = $${quoteRow.gst}`);
console.log(`  total_inc_gst         = $${quoteRow.total_inc_gst}`);
console.log(`  estimated_timeframe   = ${quoteRow.estimated_timeframe}`);
console.log(`  needs_inspection      = ${quoteRow.needs_inspection}`);
console.log(``);
console.log(`  ── scope_of_works ──────────────────────────────────────────`);
console.log(`  ${(quoteRow.scope_of_works ?? '').replace(/\n/g, "\n  ")}`);
console.log(``);

const showTier = (label, t) => {
  if (!t) { console.log(`  ── ${label.padEnd(8)} ──── (null)`); return; }
  console.log(`  ── ${label.toUpperCase().padEnd(8)} ───────────────────────────────────────────`);
  console.log(`  label:           ${t.label ?? '(missing)'}`);
  console.log(`  subtotal_ex_gst: $${t.subtotal_ex_gst ?? '?'}`);
  console.log(`  timeframe:       ${t.timeframe ?? '?'}`);
  if (Array.isArray(t.line_items)) {
    for (const li of t.line_items) {
      console.log(`    · ${(li.description ?? '').padEnd(48)} qty=${li.quantity ?? '?'} unit=${li.unit ?? '?'} unit_$=${li.unit_price_ex_gst ?? '?'} total=$${li.total_ex_gst ?? '?'}`);
    }
  }
  console.log(``);
};

showTier("good", quoteRow.good);
showTier("better", quoteRow.better);
showTier("best", quoteRow.best);

if (Array.isArray(quoteRow.optional_upsells) && quoteRow.optional_upsells.length) {
  console.log(`  ── optional_upsells ────────────────────────────────────────`);
  for (const u of quoteRow.optional_upsells) {
    console.log(`    · ${u.name} — $${u.price_ex_gst}`);
  }
  console.log(``);
}

if (Array.isArray(quoteRow.risk_flags) && quoteRow.risk_flags.length) {
  console.log(`  ── risk_flags ──────────────────────────────────────────────`);
  for (const r of quoteRow.risk_flags) console.log(`    · ${r}`);
  console.log(``);
}

await client.end();

console.log(`[5/5] ✓ Stage 05 verified — full pipeline works end-to-end.`);
console.log(`      Stage 03 → 04 → 05 chain confirmed.\n`);
