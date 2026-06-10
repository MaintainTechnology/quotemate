import pg from "pg";
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const i = process.argv.indexOf("--token");
const token = i >= 0 ? process.argv[i + 1] : null;
if (!token) { console.error("Need --token"); process.exit(1); }

const { rows } = await client.query(
  `select samples_prompt from quotes where share_token = $1`,
  [token],
);
console.log(rows[0]?.samples_prompt ?? "(no samples_prompt stored)");
await client.end();
