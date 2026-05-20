// Print every (inbound, first-outbound-reply) pair from the test pair
// so we can eyeball-grade the agent's behaviour.

import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const TEST_FROM = "+61489083371";
const AGENT_TO = "+61481613464";

try {
  await c.connect();
  const { rows: msgs } = await c.query(`
    select m.direction, m.body, m.created_at, m.conversation_id, sc.conversation_state
      from sms_messages m
      join sms_conversations sc on sc.id = m.conversation_id
     where sc.from_number = $1 and sc.to_number = $2
       and m.created_at >= now() - interval '1 hour'
     order by m.created_at`,
    [TEST_FROM, AGENT_TO]);

  // Group by conversation
  const byConvo = new Map();
  for (const m of msgs) {
    if (!byConvo.has(m.conversation_id)) byConvo.set(m.conversation_id, []);
    byConvo.get(m.conversation_id).push(m);
  }

  for (const [cid, list] of byConvo) {
    const inbound = list.find((m) => m.direction === "inbound");
    if (!inbound) continue;
    const id = inbound.body?.match(/\[T(\d{3})\]|CANARY/)?.[0] ?? "(?)";
    const reply = list.find((m) => m.direction === "outbound");
    const state = list[0]?.conversation_state ?? {};
    const slots = state.persistent_slots ?? state.slots ?? {};
    const jobType = slots.job_type ?? state.job_type ?? "?";
    console.log(`──── ${id}  conv=${cid.slice(0,8)}  classified job_type=${jobType} ────`);
    console.log(`CUST: ${inbound.body}`);
    console.log(`AGNT: ${reply?.body ?? "(no reply)"}`);
    console.log(`SLOTS: ${JSON.stringify(slots).slice(0,260)}`);
    console.log("");
  }
} catch (e) {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
