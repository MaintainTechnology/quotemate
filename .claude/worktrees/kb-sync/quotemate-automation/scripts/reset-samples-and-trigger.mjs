// Reset samples_status to idle, clear the old sample paths, and hit the
// quote page so the after() hook triggers regeneration with the latest
// code. Then poll for completion and dump samples_prompt.

import pg from "pg";
const dbUrl = process.env.SUPABASE_DB_URL;
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const i = process.argv.indexOf("--token");
const token = i >= 0 ? process.argv[i + 1] : null;
if (!token) { console.error("Need --token <share_token>"); process.exit(1); }

// 1. Reset samples state
const upd = await client.query(
  `update quotes
     set samples_status = 'idle',
         sample_image_paths = '{}',
         samples_error = null,
         samples_prompt = null
     where share_token = $1
     returning id`,
  [token],
);
console.log("Reset", upd.rowCount, "quote(s)");

// 2. Hit the quote page to trigger after()
const url = `https://quote-mate-rho.vercel.app/q/${token}`;
console.log("Hitting", url);
const r = await fetch(url, { headers: { "user-agent": "QuoteMateTest/1.0" } });
console.log("HTTP", r.status);

// 3. Poll samples_status every 10s for up to 2 min
const t0 = Date.now();
for (let attempt = 1; attempt <= 12; attempt++) {
  await new Promise(res => setTimeout(res, 10000));
  const { rows } = await client.query(
    `select samples_status, samples_error, sample_image_paths,
            (samples_prompt is not null) as has_prompt
       from quotes where share_token = $1`,
    [token],
  );
  const s = rows[0];
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`t+${elapsed}s  status=${s.samples_status}  has_prompt=${s.has_prompt}  images=${(s.sample_image_paths ?? []).length}  err=${s.samples_error ?? "-"}`);
  if (s.samples_status === "ready" || s.samples_status === "partial" || s.samples_status === "failed") break;
}

await client.end();
