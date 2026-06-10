// One-off remediation: void quote 3669a680... by clearing its stripe_links
// so the customer can no longer click "Lock in" and pay the inflated price.
//
// The page (app/q/[token]/page.tsx:1072) handles missing-link gracefully:
// shows "Reply to your tradie's SMS to confirm" instead of the payment CTA.
//
// Run: node --env-file=.env.local scripts/void-quote-3669a680.mjs
//
// Read-only by default; pass --apply to write.

import pg from "pg";
const { Client } = pg;

const APPLY = process.argv.includes("--apply");
const QUOTE_ID = "3669a680-ab14-41b6-9255-1eca3c73d5c4";

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows } = await c.query(
  `select id, status, stripe_links, sent_at, viewed_at,
          good->>'subtotal_ex_gst' as good_subtotal
   from quotes where id = $1`,
  [QUOTE_ID],
);
if (rows.length === 0) {
  console.log("Quote not found — nothing to void.");
  process.exit(0);
}
const q = rows[0];
console.log("Pre-state:");
console.log("  id:               ", q.id);
console.log("  status:           ", q.status);
console.log("  sent_at:          ", q.sent_at);
console.log("  viewed_at:        ", q.viewed_at);
console.log("  good subtotal:    $", q.good_subtotal, "ex GST (INFLATED — has duplicate HWS line)");
console.log("  stripe_links:     ", q.stripe_links ? Object.keys(q.stripe_links).join(", ") : "(empty)");

if (!APPLY) {
  console.log("\n(dry run — pass --apply to clear stripe_links)");
  await c.end();
  process.exit(0);
}

const updated = await c.query(
  `update quotes
      set stripe_links = '{}'::jsonb
    where id = $1
    returning id, stripe_links`,
  [QUOTE_ID],
);
console.log("\nPost-state:");
console.log("  stripe_links: ", updated.rows[0].stripe_links);
console.log("\nOK Quote voided. Customer's Lock-In button now renders as 'Reply to your tradie' message.");

await c.end();
