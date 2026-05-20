// Investigate the no-reply cliff at T017+.
// Look at: what inbound messages actually landed at /api/sms/inbound,
// the conversations that got created, and any error patterns.

import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const TEST_FROM = "+61489083371";
const AGENT_TO = "+61481613464";

try {
  await c.connect();

  // 1. All conversations created during the sweep window
  const { rows: convos } = await c.query(`
    select id, status, turn_count, conversation_type, created_at, last_message_at, updated_at,
           processing_until
      from sms_conversations
      where from_number = $1 and to_number = $2
        and created_at >= now() - interval '1 hour'
      order by created_at`,
    [TEST_FROM, AGENT_TO]);
  console.log(`Conversations in last hour: ${convos.length}`);
  for (const cv of convos)
    console.log(`  ${cv.created_at.toISOString().slice(11,19)}  id=${cv.id.slice(0,8)}  status=${cv.status.padEnd(8)} turns=${cv.turn_count}  type=${cv.conversation_type ?? "?"}  proc_until=${cv.processing_until?.toISOString().slice(11,19) ?? "—"}`);

  // 2. All messages in those conversations
  const { rows: msgs } = await c.query(`
    select m.direction, m.body, m.created_at, m.twilio_message_sid,
           m.conversation_id
      from sms_messages m
      join sms_conversations sc on sc.id = m.conversation_id
     where sc.from_number = $1 and sc.to_number = $2
       and m.created_at >= now() - interval '1 hour'
     order by m.created_at`,
    [TEST_FROM, AGENT_TO]);
  console.log(`\nMessages in last hour: ${msgs.length}`);

  // 3. Group by inbound TEST_ID
  const inbounds = msgs.filter((m) => m.direction === "inbound");
  console.log(`\nInbound messages by TEST_ID (chronological):`);
  for (const m of inbounds) {
    const id = m.body?.match(/\[T\d{3}\]/)?.[0] ?? "(none)";
    console.log(`  ${m.created_at.toISOString().slice(11,19)}  ${id}  body="${m.body?.slice(0,80)}"`);
  }

  // 4. Look for the cliff
  if (inbounds.length > 0) {
    const last = inbounds[inbounds.length - 1];
    console.log(`\nLAST inbound received: ${last.created_at.toISOString()}  body=${last.body?.slice(0,80)}`);
    console.log(`Sweep finished around: now-ish`);
    const lastIdMatch = last.body?.match(/\[T(\d{3})\]/);
    if (lastIdMatch) console.log(`Cliff at T${lastIdMatch[1]} (test ${parseInt(lastIdMatch[1], 10)} of 43)`);
  }
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
