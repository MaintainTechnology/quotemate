// Read the latest inbound+outbound SMS messages for the test pair
// (+61489083371 ↔ +61481613464) to see what the agent replied with.

import pg from "pg";
const { Client } = pg;
const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const TEST_FROM = "+61489083371";
const AGENT_TO = "+61481613464";

try {
  await c.connect();

  // Find the conversation for this pair
  const { rows: convos } = await c.query(
    `select id, status, turn_count, last_message_at, created_at, conversation_state
       from sms_conversations
       where from_number = $1 and to_number = $2
       order by last_message_at desc nulls last, created_at desc
       limit 3`,
    [TEST_FROM, AGENT_TO],
  );

  if (convos.length === 0) {
    console.log("No conversation found for the test pair.");
    process.exit(0);
  }

  const convo = convos[0];
  console.log(`Latest conversation: id=${convo.id}`);
  console.log(`  status=${convo.status}  turn_count=${convo.turn_count}`);
  console.log(`  created_at=${convo.created_at.toISOString()}`);
  console.log(`  last_message_at=${convo.last_message_at?.toISOString() ?? "(null)"}`);
  if (convo.conversation_state) {
    const s = convo.conversation_state;
    console.log(`  conversation_state.phase=${s.phase ?? "?"}`);
    console.log(`  conversation_state.slots=${JSON.stringify(s.slots ?? s.persistent_slots ?? {}).slice(0, 220)}`);
  }

  // Pull the last ~15 messages
  const { rows: msgs } = await c.query(
    `select direction, body, twilio_message_sid, created_at
       from sms_messages
       where conversation_id = $1
       order by created_at desc
       limit 15`,
    [convo.id],
  );
  console.log(`\nLast ${msgs.length} messages (newest first):`);
  for (const m of msgs.reverse()) {
    const dir = m.direction === "inbound" ? "→ CUST" : "← AGNT";
    const ts = m.created_at.toISOString().slice(11, 19);
    console.log(`  [${ts}] ${dir}  ${m.body?.slice(0, 280) ?? ""}`);
  }
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
