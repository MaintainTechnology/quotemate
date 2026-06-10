// ═══════════════════════════════════════════════════════════════════
// QuoteMate · SMS state inspector
//
// Usage:  node --env-file=.env.local scripts/check-sms-state.mjs
//
// Prints row counts and the 5 most recent conversations + messages.
// Use this to verify a test SMS round-trip without opening the
// Supabase dashboard.
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";

const { Client } = pg;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const { rows: convoCount } = await client.query(
  `select count(*)::int as n from sms_conversations`,
);
const { rows: msgCount } = await client.query(
  `select count(*)::int as n from sms_messages`,
);

console.log(`\n┌─ totals ──────────────────────────`);
console.log(`│  sms_conversations: ${convoCount[0].n}`);
console.log(`│  sms_messages:      ${msgCount[0].n}`);
console.log(`└───────────────────────────────────`);

const { rows: convos } = await client.query(
  `select id, from_number, to_number, status, turn_count, created_at, last_message_at
   from sms_conversations
   order by created_at desc
   limit 5`,
);

console.log(`\n┌─ recent conversations (newest first) ──`);
if (convos.length === 0) {
  console.log(`│  (none)`);
} else {
  for (const c of convos) {
    const id = c.id.slice(0, 8);
    const created = new Date(c.created_at).toISOString().slice(11, 19);
    const last = new Date(c.last_message_at).toISOString().slice(11, 19);
    console.log(`│  ${id}…  ${c.from_number} → ${c.to_number}`);
    console.log(`│            status=${c.status}  turns=${c.turn_count}  created=${created}  last=${last}`);
  }
}
console.log(`└────────────────────────────────────────`);

const { rows: messages } = await client.query(
  `select m.id, m.conversation_id, m.direction, m.body, m.twilio_message_sid, m.created_at,
          c.from_number, c.to_number
   from sms_messages m
   join sms_conversations c on c.id = m.conversation_id
   order by m.created_at desc
   limit 10`,
);

console.log(`\n┌─ recent messages (newest first) ──`);
if (messages.length === 0) {
  console.log(`│  (none)`);
} else {
  for (const m of messages) {
    const ts = new Date(m.created_at).toISOString().slice(11, 19);
    const arrow = m.direction === "inbound" ? "←" : "→";
    const sid = m.twilio_message_sid ? `[${m.twilio_message_sid.slice(0, 10)}…]` : "[no sid]";
    const body = m.body.length > 80 ? m.body.slice(0, 77) + "..." : m.body;
    console.log(`│  ${ts}  ${arrow} ${m.direction.padEnd(8)}  ${sid}`);
    console.log(`│            "${body}"`);
  }
}
console.log(`└────────────────────────────────`);

await client.end();
