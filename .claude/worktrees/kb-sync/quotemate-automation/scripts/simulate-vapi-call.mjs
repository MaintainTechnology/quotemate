// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Simulate a Vapi end-of-call-report (S3.8 dry run)
//
// Builds a realistic Vapi webhook payload, POSTs it to your live
// VAPI_SERVER_URL (the ngrok endpoint), then queries Supabase to
// confirm a row landed in calls. Tests the full Stage 03 path without
// needing a real phone call.
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";
import { randomUUID } from "node:crypto";
const { Client } = pg;

const VAPI_SERVER_URL = process.env.VAPI_SERVER_URL;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

if (!VAPI_SERVER_URL) { console.error("Missing VAPI_SERVER_URL"); process.exit(1); }
if (!SUPABASE_DB_URL) { console.error("Missing SUPABASE_DB_URL"); process.exit(1); }

// ─── Build a realistic end-of-call-report ───────────────────────────
const callId = `sim-${Date.now()}-${randomUUID().slice(0, 8)}`;

const transcript = [
  "AI: G'day, you've reached the AI quoting line. I can take down all the details for your electrical job and have a quote sent through. This call may be recorded for quality and quote-drafting purposes. Sound good?",
  "Customer: Yeah, all good.",
  "AI: Great — what's your name?",
  "Customer: Anant.",
  "AI: Thanks Anant. Which suburb are you in?",
  "Customer: Bondi.",
  "AI: Got it. What do you need done?",
  "Customer: I need six LED downlights installed in my kitchen, replacing the old halogens. Wiring's already there. Single-storey house, plaster ceiling.",
  "AI: Perfect. So six LED downlights replacing existing halogens in the kitchen, wiring already run, plaster ceiling, single-storey. Roof access available?",
  "Customer: Yes, attic access is fine.",
  "AI: Warm white, cool white, tri-colour, dimmable, or smart?",
  "Customer: Tri-colour would be good.",
  "AI: Right. I'll send you an SMS link for a couple of photos — ceiling area and existing switch. Quote will follow within an hour. Anything else?",
  "Customer: Nope, that's all.",
  "AI: Cheers, Anant — quote on its way."
].join("\n");

const payload = {
  message: {
    type: "end-of-call-report",
    durationSeconds: 92,
    transcript,
    recordingUrl: "https://example.com/simulated-recording.mp3",
    call: {
      id: callId,
      customer: { number: "+61400123456" }
    }
  }
};

console.log(`\n[1/4] POSTing simulated end-of-call-report to ngrok webhook...`);
console.log(`      Target:  ${VAPI_SERVER_URL}`);
console.log(`      vapi_call_id:  ${callId}`);
console.log(`      transcript:    ${transcript.length} chars`);

const res = await fetch(VAPI_SERVER_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  },
  body: JSON.stringify(payload),
});

const respText = await res.text();
console.log(`      HTTP ${res.status}  →  ${respText.slice(0, 100)}`);

if (!res.ok) {
  console.error(`\n✗ Webhook returned ${res.status}. Aborting.`);
  process.exit(1);
}

console.log(`\n[2/4] Waiting 1.5s for the webhook to finish writing to Supabase...`);
await new Promise((r) => setTimeout(r, 1500));

// ─── Query Supabase to confirm ──────────────────────────────────────
console.log(`\n[3/4] Querying Supabase calls table for vapi_call_id=${callId}...`);

const client = new Client({ connectionString: SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(
  `select id, vapi_call_id, caller_number, duration_seconds,
          length(transcript) as transcript_chars,
          recording_url, ended_at, created_at
   from calls where vapi_call_id = $1`,
  [callId]
);

if (rows.length === 0) {
  console.error(`\n✗ No row found in calls table.`);
  console.error(`  This means the webhook handler ran but the insert failed.`);
  console.error(`  Check the pnpm dev terminal for errors.`);
  await client.end();
  process.exit(1);
}

const r = rows[0];
console.log(`      ✓ Row found.`);
console.log(`        id:                ${r.id}`);
console.log(`        vapi_call_id:      ${r.vapi_call_id}`);
console.log(`        caller_number:     ${r.caller_number}`);
console.log(`        duration_seconds:  ${r.duration_seconds}`);
console.log(`        transcript_chars:  ${r.transcript_chars}`);
console.log(`        recording_url:     ${r.recording_url}`);
console.log(`        ended_at:          ${r.ended_at?.toISOString()}`);
console.log(`        created_at:        ${r.created_at?.toISOString()}`);

// ─── Show recent calls table state ──────────────────────────────────
console.log(`\n[4/4] Recent rows in calls table:`);
const { rows: recent } = await client.query(
  `select vapi_call_id, caller_number, duration_seconds, created_at
   from calls order by created_at desc limit 5`
);
for (const row of recent) {
  const marker = row.vapi_call_id === callId ? " ← just inserted" : "";
  console.log(`      ${row.vapi_call_id.padEnd(28)}  ${row.caller_number ?? "(no caller)"}  ${row.duration_seconds}s  ${row.created_at.toISOString()}${marker}`);
}

await client.end();
console.log(`\n✓ Stage 03 simulated end-to-end. The pipeline works.\n`);
console.log(`  Next: Stage 04 (Intake Engine) will pick this row up and structure the transcript.`);
console.log(`  Right now /api/intake/structure doesn't exist yet, so the fire-and-forget call`);
console.log(`  from the webhook to that route will have failed silently — the calls row still landed.\n`);
