// Idempotent: add samples_prompt column to quotes if missing.
import pg from "pg";
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
await client.query(`alter table public.quotes add column if not exists samples_prompt text;`);
console.log("samples_prompt column ready");
await client.end();
