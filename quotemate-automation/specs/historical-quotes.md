# Historical Quotes — Spec

## Objective
Let a tradie bring their **existing quote history** into QuoteMate so they can price new
jobs consistently against their own past numbers. A tradie imports past quotes (CSV
exports and/or PDF quote documents), the system parses and categorises them against
QuoteMate's canonical job-type taxonomy, and the tradie can then (a) browse/filter that
history, (b) see analytics such as *"your average price for an air-conditioner install
was $X across N jobs"*, (c) see that historical average as a hint while reviewing a freshly
drafted quote, and (d) optionally push their historical pricing into their grounded
pricing book so it influences future auto-drafts. This is built as an enhancement to the
dashboard **Files tab**, reusing the existing per-tenant **File store** for PDF documents.

## Context / background
Grounding facts discovered in the codebase that this build must respect:

- **Files tab + File store.** `app/dashboard/_components/FilesTab.tsx` renders inside the
  dashboard tab switcher in `app/dashboard/page.tsx` (each tab gets `accessToken`). Tenant
  documents are tracked in `tenant_file_documents` (migration `134_tenant_file_store.sql`):
  `source_kind CHECK ('quote','invoice')`, plus `tenant_id, source_id, trade, display_name,
  storage_path, kb_document_id, state ('pending'|'active'|'failed'|'skipped'), content_hash,
  bytes, …`, `UNIQUE(tenant_id, display_name)`. Each tenant has one persistent Gemini File
  Search store (`tenants.file_store_id`), managed by `lib/filestore/tenant-store.ts`
  (`ensureTenantStore`, `addDocumentToTenantStore`, `searchTenantStore`). Full files live in
  the Supabase Storage `quote-pdfs` bucket.
- **Canonical taxonomy.** `lib/intake/schema.ts` → `IntakeSchema.job_type` is a Zod enum:
  `downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting, switchboard,
  oven_cooktop, ev_charger, fault_finding, renovation` (electrical) and `blocked_drain,
  hot_water, tap_repair, tap_replace, toilet_repair, toilet_replace, gas_fitting, burst_pipe,
  bathroom_renovation, cctv_inspection, prv_install` (plumbing), plus `other`. `trade` is
  `electrical | plumbing`. Categorisation maps each historical quote to exactly one of these.
- **LLM structured output.** Use the Vercel AI SDK pattern from `lib/intake/structure.ts` /
  `lib/commercial-painting/classify.ts`: `generateObject({ model: anthropic(modelId), schema,
  maxRetries: 0, temperature: 0, system, messages })` with a Zod schema. Money is never
  invented by the LLM — the LLM only *classifies* (chooses a `job_type`); prices come from the
  parsed source data.
- **Grounded pricing.** Customer-facing prices must derive from the pricing book / shared +
  tenant_custom assemblies, enforced by `lib/estimate/validate.ts`; ungrounded prices downgrade
  a quote to the inspection route. Historical data is **not** a grounded source, so it may
  never directly set a customer-facing price. The estimator reads tenant overrides via
  `makeLookupAssembly(tenantId)` in `lib/estimate/tools.ts`, which UNIONs `shared_assemblies`
  with `tenant_custom_assemblies` (migration `023`: `tenant_id, trade CHECK('electrical',
  'plumbing'), name, default_unit, default_unit_price_ex_gst, default_labour_hours, enabled,
  …`, `UNIQUE(tenant_id, trade, lower(name))`). Calibration writes here, gated on tradie
  approval, so it becomes grounded legitimately.
- **Conventions.** Currency stored **ex-GST**, displayed **inc-GST**. Tenant API routes:
  module-level service-role client, `Authorization: Bearer <token>` → `supabase.auth.getUser`
  → resolve tenant by `owner_user_id` → every query filters `tenant_id`; `export const dynamic
  = 'force-dynamic'`. Heavy LLM routes use `import { after } from 'next/server'` + `export
  const maxDuration = 300`. DB change = new `sql/migrations/NNN_*.sql` + `scripts/run-migration-
  NNN.mjs` (pg + `SUPABASE_DB_URL`, `ssl:{rejectUnauthorized:false}`, idempotent `IF NOT
  EXISTS`). **Next migration number is `137`.** Available parsers: `csv-parse@^6`,
  `pdfjs-dist@^6`, `mupdf`/`unpdf`. **No `xlsx`/`exceljs`** is installed. Tests: `vitest`,
  mock `@supabase/supabase-js` before importing the route.

## Requirements

### Data model
1. Add migration `sql/migrations/137_tenant_historical_quotes.sql` (+ `137_down.sql` +
   `scripts/run-migration-137.mjs`) creating two tables, both `tenant_id`-scoped with RLS
   enabled (no positive client policy — service role bypasses, matching `tenant_file_documents`):
   - `tenant_historical_import_batches`: `id uuid PK`, `tenant_id uuid NOT NULL REFERENCES
     tenants(id) ON DELETE CASCADE`, `source_kind text CHECK ('csv','pdf')`, `filename text`,
     `status text CHECK ('parsing','categorizing','awaiting_review','committed','failed')
     DEFAULT 'parsing'`, `column_mapping jsonb DEFAULT '{}'`, `row_count int DEFAULT 0`,
     `error text`, `created_at timestamptz DEFAULT now()`, `updated_at timestamptz`.
   - `tenant_historical_quotes`: `id uuid PK`, `tenant_id uuid NOT NULL REFERENCES tenants(id)
     ON DELETE CASCADE`, `batch_id uuid REFERENCES tenant_historical_import_batches(id) ON
     DELETE CASCADE`, `source_kind text CHECK ('csv','pdf')`, `trade text`, `job_type text`
     (nullable until categorised), `job_type_confidence text CHECK ('high','medium','low')`,
     `raw_description text`, `quoted_at date`, `price_ex_gst numeric(12,2)`, `price_inc_gst
     numeric(12,2)`, `gst_basis text CHECK ('inc','ex','unknown') DEFAULT 'unknown'`, `currency
     text DEFAULT 'AUD'`, `status text CHECK ('pending_review','confirmed','rejected') DEFAULT
     'pending_review'`, `file_document_id uuid REFERENCES tenant_file_documents(id) ON DELETE
     SET NULL`, `content_hash text`, `raw_row jsonb`, `created_at timestamptz DEFAULT now()`,
     `updated_at timestamptz`. Indexes on `(tenant_id)`, `(tenant_id, job_type)`,
     `(tenant_id, status)`; `UNIQUE(tenant_id, content_hash)` for dedup.
2. The same migration extends `tenant_file_documents.source_kind` CHECK to also allow
   `'historical_quote'`, so imported PDF history can be stored + browsed through the existing
   File store / `/api/tenant/files` surface.

### Import & parsing
3. `POST /api/tenant/historical-quotes/import` (tenant-scoped, `maxDuration = 300`) accepts a
   `multipart/form-data` upload of one CSV or one PDF. It creates a
   `tenant_historical_import_batches` row (`status='parsing'`), fast-acks with `{ batchId }`,
   and runs parse + categorise in `after()`.
4. CSV parsing uses `csv-parse`. Column mapping is **LLM-assisted**: an `generateObject` call
   maps the file's header columns to canonical fields (`description`, `price`, `gst_basis`,
   `date`, `quantity`/`unit` if present) and is persisted to `batch.column_mapping`. One
   `tenant_historical_quotes` row is created per data row.
5. PDF parsing extracts text via `pdfjs-dist`/`unpdf`; one `tenant_historical_quotes` row is
   created per PDF document, with the original PDF stored in the `quote-pdfs` bucket and
   registered in `tenant_file_documents` (`source_kind='historical_quote'`) via
   `addDocumentToTenantStore`, with `file_document_id` linking back.
6. Categorisation: for each imported row/document an LLM (`generateObject`, Zod schema returning
   `{ job_type: <canonical enum>, confidence: 'high'|'medium'|'low', reason }`, `temperature:0`,
   `maxRetries:0`) assigns a canonical `job_type` + `job_type_confidence` + `trade`. Rows are
   saved with `status='pending_review'`. The batch moves to `status='awaiting_review'` when done,
   or `status='failed'` (with `error`) on unrecoverable failure.
7. Price handling: prices are parsed from the source. Both `price_ex_gst` and `price_inc_gst`
   are populated using the detected `gst_basis` (assume `gst_registered` ⇒ 10% GST). When the
   GST basis cannot be determined it is stored as `'unknown'` and the inc/ex split is derived
   with the documented default (treat the stated number as **inc-GST**, the tradie-quoting norm)
   and flagged for the tradie in review.

### Review & correction
8. `GET /api/tenant/historical-quotes/batches/[batchId]` returns the batch + its rows so the UI
   can show the proposed categorisations. `POST /api/tenant/historical-quotes/review` accepts
   per-row corrections `{ id, job_type?, status: 'confirmed'|'rejected' }[]` and/or a bulk
   "confirm all" and writes them. Only `status='confirmed'` rows count toward analytics, hints,
   and calibration.

### Browse & analytics
9. `GET /api/tenant/historical-quotes` returns confirmed rows with filters: `job_type`, `trade`,
   `from`/`to` date, free-text `q` over `raw_description`. Supports the browse/filter UI.
10. `GET /api/tenant/historical-quotes/analytics` returns, per `job_type` (confirmed rows only):
    `count`, `avg_price_inc_gst`, `avg_price_ex_gst`, `min_price_inc_gst`, `max_price_inc_gst`,
    `most_recent_quoted_at`. Computed in SQL/JS over `tenant_historical_quotes`. `job_type`s with
    zero confirmed rows are omitted.

### In-quote hint
11. `GET /api/tenant/historical-quotes/hint?job_type=<jt>&trade=<t>` returns
    `{ job_type, trade, count, avg_price_inc_gst, avg_price_ex_gst, min_price_inc_gst,
    max_price_inc_gst, most_recent_quoted_at } | { count: 0 }` for the tenant's confirmed history.
12. A reusable `HistoricalHint` React component renders that data as an informational badge
    (e.g. *"Your historical avg for downlights: $X inc GST · N jobs · last MMM YYYY"*). It is
    wired into the tradie's drafted-quote **review** surface in the dashboard so that, when a
    quote/intake with a known `job_type` is on screen, the hint appears beside the drafted
    pricing. The hint is **informational only** — it never mutates the drafted customer price and
    never triggers a re-draft. When `count` is 0 the component renders nothing.

### Calibration (grounded write, approval-gated)
13. `POST /api/tenant/historical-quotes/calibration/preview` computes, per confirmed `job_type`
    with `count >= MIN_SAMPLES` (default 3), a proposed `tenant_custom_assemblies` upsert:
    `name` derived from the job type, `trade`, `default_unit_price_ex_gst = avg_price_ex_gst`,
    `enabled=false`. It returns the proposed changes as a diff (new vs. existing assembly price)
    **without writing**.
14. `POST /api/tenant/historical-quotes/calibration/apply` accepts the tradie's approved subset
    and upserts those rows into `tenant_custom_assemblies` (`UNIQUE(tenant_id, trade, lower(name))`,
    `enabled=true`, `always_inspection=false`) so the estimator's `makeLookupAssembly` picks them
    up on the next draft. Nothing is written to live pricing without this explicit apply call.

### UI
15. Add a `HistoricalQuotesTab` (new sibling dashboard tab, `app/dashboard/_components/
    HistoricalQuotesTab.tsx`, registered in `app/dashboard/page.tsx`'s tab switcher) styled with
    the existing design tokens (`bg-ink-card`, `text-text-pri`, `text-text-dim`, `border-ink-
    line`, lucide icons) matching `FilesTab`. It provides: (a) an **Import** control (file picker
    → POST import), (b) a **Review** panel for the latest `awaiting_review` batch (correct
    job_type, confirm/reject, "confirm all"), (c) a **Browse/filter** list of confirmed history,
    (d) an **Analytics** panel (avg/count/min/max/most-recent per job type), and (e) a
    **Calibration** action (preview diff → approve subset → apply).

### Tests
16. Vitest unit tests covering: tenant isolation on every new route (401 without bearer; a
    different tenant's batch/rows return 404/empty); CSV parsing + row creation; the
    categorisation Zod schema constrains output to the canonical enum; analytics aggregation math
    (avg/min/max/count) for a known fixture; hint endpoint returns `count:0` cleanly when there is
    no history; calibration preview produces no DB writes and apply upserts only approved rows.

## Non-goals
- Native `.xlsx`/`.xls` binary parsing (tradies export CSV). Documented limitation; not built.
- Auto-applying historical prices to customer-facing quotes without explicit tradie approval.
- Cross-tenant / market benchmarking ("what do other sparkies charge").
- Rebuilding ServiceM8/Tradify CRM, invoicing, or scheduling features.
- OCR of scanned image-only PDFs (text-layer PDFs only for v1; image-only PDFs are flagged
  `failed` with a clear reason).
- Changing the existing estimator grounding/validation logic; calibration only *adds* tenant
  custom assemblies through the existing supported path.

## Constraints
- Reuse the existing File store (`lib/filestore/tenant-store.ts`) and `tenant_file_documents`
  for PDF history; do not stand up a second storage/search system.
- Every new table and route is strictly `tenant_id`-scoped; no cross-tenant read/write is possible.
- LLM calls classify only — never produce or adjust prices. Mirror the `generateObject` + Zod
  pattern already in the repo; `temperature:0`, `maxRetries:0`.
- Customer-facing pricing stays grounded: historical data influences live pricing only via the
  approval-gated calibration write into `tenant_custom_assemblies`.
- Follow repo conventions: ex-GST storage, AU formatting, `dynamic='force-dynamic'`, `after()` +
  `maxDuration=300` for the import route, migration + run-script pair, no committing secrets.
- Build must be additive: existing FilesTab, estimator, and quote flows keep working unchanged
  (their tests still pass).

## Edge cases to handle
- Empty file / 0 data rows → batch `status='failed'`, `error='no rows found'`; UI shows a clear message.
- CSV with unrecognised/missing price or description column → mapping LLM returns nulls; affected
  rows are flagged for manual review rather than silently dropped.
- Duplicate import (same row content) → deduped via `UNIQUE(tenant_id, content_hash)`; re-import
  does not double-count analytics.
- GST basis ambiguous → store `gst_basis='unknown'`, derive inc/ex with documented default, flag in review.
- Low-confidence categorisation (`confidence='low'` or `job_type='other'`) → surfaced first in the
  review panel for tradie correction; excluded from analytics/hint until confirmed.
- Image-only / unparseable PDF → row/batch flagged `failed` with a human-readable reason; no crash.
- File store / KB unavailable (`KB_*` env unset) → CSV import + analytics still fully work; PDF
  documents are stored in Storage and marked `pending`/`skipped` for later reconcile (never throws).
- Huge file (e.g. >5k rows or >10MB) → enforce a documented cap; reject over-cap uploads with a
  clear error and `log()` what was rejected (no silent truncation).
- Another tenant's `batchId`/row id in any route → 404/empty, never leaks existence or data.
- Calibration with `count < MIN_SAMPLES` for a job type → that job type is excluded from the
  preview (not enough signal); shown as such in the UI.
- Calibration apply when a `tenant_custom_assemblies` row already exists for that name → upsert
  updates the price (does not create a duplicate), respecting the unique constraint.

## Definition of done
- [ ] Migration `137_tenant_historical_quotes.sql` (+ `137_down.sql` + `run-migration-137.mjs`)
      creates both tables with the specified columns, checks, indexes, RLS, and extends the
      `tenant_file_documents.source_kind` CHECK; `init.sql` kept representative.
- [ ] `POST /api/tenant/historical-quotes/import` accepts a CSV, parses it with `csv-parse`,
      LLM-maps columns, LLM-categorises each row to a canonical `job_type`, and persists rows with
      `status='pending_review'`; batch ends `awaiting_review`.
- [ ] `POST /api/tenant/historical-quotes/import` accepts a text-layer PDF, stores it in the
      `quote-pdfs` bucket + `tenant_file_documents` (`source_kind='historical_quote'`) via the
      existing tenant store, categorises it, and links `file_document_id`.
- [ ] Review endpoints let a tradie correct `job_type` and confirm/reject rows; only `confirmed`
      rows feed analytics/hint/calibration.
- [ ] `GET /api/tenant/historical-quotes/analytics` returns correct `count`/`avg`/`min`/`max`/
      `most_recent` per job type for a known fixture (verified by a unit test).
- [ ] `GET /api/tenant/historical-quotes/hint` returns the right aggregate for a job type and
      `{count:0}` when there is no history.
- [ ] `HistoricalHint` renders in the dashboard drafted-quote review surface for a known job type
      and renders nothing when `count:0`; it never changes the drafted price.
- [ ] Calibration `preview` returns a diff and writes nothing; `apply` upserts only the approved
      subset into `tenant_custom_assemblies` with `enabled=true`, and a re-apply updates rather
      than duplicates.
- [ ] `HistoricalQuotesTab` is reachable from the dashboard and exposes import, review,
      browse/filter, analytics, and calibration, styled consistently with `FilesTab`.
- [ ] Every new route is tenant-isolated: returns 401 without a bearer token and never returns
      another tenant's data (unit tests assert this).
- [ ] All new vitest tests pass, and the existing suite (FilesTab, estimator, quote routes) is
      unaffected: `npx vitest run` is green; `npx tsc --noEmit` (or the repo typecheck) passes for
      the new/changed files.

## Open questions
- The exact human-readable `name` mapping from each canonical `job_type` to a
  `tenant_custom_assemblies.name` (e.g. `downlights` → "LED downlight — supply & install").
  Resolve during build with a small static map; flag any job types with no obvious assembly name.
- Precise pricing-book mapping rules for calibration when a job type spans several assemblies
  (v1 keeps it 1 job_type → 1 custom assembly at the average price; finer mapping is a fast-follow).
- Whether `.xlsx` should be accepted in a later version by adding a parser dependency (currently a
  documented non-goal: export to CSV).
