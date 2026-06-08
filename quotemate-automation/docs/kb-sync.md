# DB → MT-QM-PRICING-KB sync

Triggers (`kb_sync_dirty`) on every public table set `kb_sync_state.dirty=true`
on any change. cron-job.org calls `/api/cron/kb-sync` every 5 min; the worker
re-exports dirty tables to CSV and replaces `db__<table>.csv` in the store
(`KB_PRICING_STORE_ID`). Unchanged tables (same sha256) are skipped.

## Env (Vercel prod + .env.local)
- SUPABASE_DB_URL  (pooler URL recommended for serverless)
- KB_API_URL, KB_API_KEY
- KB_PRICING_STORE_ID=fileSearchStores/mtqmpricingkb-o95jk3es162t
- KB_SYNC_MAX_TABLES_PER_RUN=8
- CRON_SECRET

## cron-job.org job
- URL: https://quote-mate-rho.vercel.app/api/cron/kb-sync  (GET)
- Schedule: */5 * * * *
- Header: Authorization: Bearer <CRON_SECRET>
- Enable failure notifications.

## Ops
- Full re-sync / backfill: `node --env-file=.env.local --import tsx scripts/kb-sync-once.mts --all`
- Inspect state: `select table_name, dirty, last_synced_at, last_error, row_count from kb_sync_state order by bumped_at desc;`

## Caveats
- All 47 tables sync, incl. customer PII (explicit decision — see spec).
- High-churn tables (sms_messages, pipeline_traces, quotes) re-embed on most
  ticks; tune cadence / KB_SYNC_MAX_TABLES_PER_RUN if cost is high.
