// Quick check: dump the conversation_state JSONB for a given phone
// number so we can verify slot extraction is populating the slots.
//
// Usage:
//   node --env-file=.env.local scripts/check-conversation-state.mjs --phone +61489083371

import pg from "pg";

const { Client } = pg;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) { console.error("Missing SUPABASE_DB_URL"); process.exit(1); }

const i = process.argv.indexOf("--phone");
const phone = i >= 0 ? process.argv[i + 1] : null;
if (!phone) { console.error("Need --phone +61XXXXXXXXX"); process.exit(1); }

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(
  `select id, from_number, status, turn_count, conversation_state, last_message_at
     from sms_conversations
     where from_number = $1
     order by last_message_at desc nulls last
     limit 1`,
  [phone],
);

if (rows.length === 0) {
  console.log(`No conversation for ${phone}`);
} else {
  const c = rows[0];
  console.log("─".repeat(72));
  console.log(`id:      ${c.id}`);
  console.log(`status:  ${c.status}    turns: ${c.turn_count}`);
  console.log(`last:    ${c.last_message_at?.toISOString?.() ?? c.last_message_at}`);
  console.log("─".repeat(72));
  console.log("conversation_state:");
  console.log(JSON.stringify(c.conversation_state, null, 2));
}

await client.end();
