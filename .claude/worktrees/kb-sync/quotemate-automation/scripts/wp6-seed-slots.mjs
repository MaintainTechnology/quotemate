// WP6 — seed bookable slots for EVERY tradie so the booking page always
// has future times for customers to pick.
//
// Generates the next ~2 weeks of weekday slots (Mon–Fri) at 9am / 12pm /
// 3pm AEST (+10:00 — correct for the current pilot window; the brief
// defers a full DST-aware calendar). Overwrites available_slots with the
// fresh forward-looking set on each tradie (past slots are noise — the
// UI drops them anyway). Idempotent: re-running just regenerates the
// same rolling window.
//
// Usage: node --env-file=.env.local scripts/wp6-seed-slots.mjs
//        (read-only preview)  add  --apply  to write.

import pg from "pg";

const APPLY = process.argv.includes("--apply");
const DAYS_AHEAD = 14;
const HOURS = [9, 12, 15]; // 9am, 12pm, 3pm
const OFFSET = "+10:00"; // AEST (pilot window is May — no DST)

function pad(n) {
  return String(n).padStart(2, "0");
}

function generateSlots() {
  const out = [];
  const now = new Date();
  for (let d = 1; d <= DAYS_AHEAD; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    const dow = day.getDay(); // 0 Sun … 6 Sat
    if (dow === 0 || dow === 6) continue; // weekdays only
    const ymd = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    for (const h of HOURS) {
      const iso = `${ymd}T${pad(h)}:00:00${OFFSET}`;
      // Keep only genuinely-future instants.
      if (Date.parse(iso) > Date.now()) out.push(iso);
    }
  }
  return out;
}

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows: tradies } = await c.query(
  `select id, business_name, available_slots from tradies order by business_name`,
);
if (tradies.length === 0) {
  console.log("No tradies rows found.");
  await c.end();
  process.exit(0);
}

const fresh = generateSlots();
console.log(
  `${APPLY ? "APPLYING" : "PREVIEW (no --apply)"} — ${fresh.length} slots/tradie ` +
    `(${DAYS_AHEAD}d, weekdays, ${HOURS.length}×/day)\n`,
);
console.log("  sample:", fresh.slice(0, 4), "…\n");

for (const t of tradies) {
  let before = [];
  try {
    before = Array.isArray(t.available_slots)
      ? t.available_slots
      : JSON.parse(t.available_slots ?? "[]");
  } catch {
    before = [];
  }
  const beforeFuture = before.filter((s) => Date.parse(s) > Date.now()).length;
  if (APPLY) {
    await c.query(
      `update tradies set available_slots = $1::jsonb where id = $2`,
      [JSON.stringify(fresh), t.id],
    );
  }
  console.log(
    `  ${t.business_name} (id=${t.id}): ${before.length} slot(s) / ` +
      `${beforeFuture} future  →  ${APPLY ? fresh.length + " future (written)" : fresh.length + " future (would write)"}`,
  );
}

if (!APPLY) {
  console.log("\nNothing written. Re-run with --apply to commit.");
} else {
  console.log("\nDone — every tradie now has a rolling 2-week slot window.");
}
await c.end();
