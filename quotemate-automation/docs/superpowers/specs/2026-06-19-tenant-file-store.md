# Per-tenant File Store — Spec

## Objective
Give every QuoteMate tenant (tradie) their own dedicated, durable file store: a downloadable PDF archive in Supabase Storage plus the same PDFs ingested into a per-tenant Gemini File Search store for search/Q&A. At the moment any quote PDF is finalized/sent — across all trades — and whenever a tenant uploads an invoice, the system archives the PDF and ingests it into that tenant's store. A one-time backfill seeds existing active tenants; everything new flows automatically thereafter. This unlocks (P2) a Files tab to browse/download the archive and a cited KB chat, and (P3) grounding new quote drafts on the tenant's own past jobs and invoices.

## Context / background
This builds on already-shipped assets and must reuse them, not rebuild them:
- **KB HTTP client** `lib/admin-loader/mt-filestore-kb.ts`: `kbCreateStore`, `kbUploadDocument` (multipart, `KB_UPLOAD_MAX_BYTES`=100MB), `kbListStores`, `kbListDocuments`, `kbSearch` (supports `systemInstruction` + `metadataFilter`), `kbDeleteDocument`, `kbDeleteStore`, `loadKbConfigFromEnv` (reads `KB_API_URL`/`KB_API_KEY`, fallbacks `MT_FILESTORE_KB_URL`/`_API_KEY`), `KbHttpError`.
- **Per-session pattern to generalise** `lib/filestore/session-store.ts` (`ensureSessionStore` / `addDocumentsToSessionStore` [dedup by `displayName`, best-effort, never throws] / `searchSessionStore`) + `lib/filestore/store-name.ts` (`slug()`, deterministic store key, 128-char cap, label-tolerant `startsWith` match, `bareStoreId()`) + `lib/filestore/provision.ts` (`provisionSessionStore()`, fire-and-forget via `after()`, flag-gated).
- **PDF stack** `lib/quote/pdf.ts` (`storePdf`, `ensureQuotePdf`, `downloadQuotePdf`; Supabase bucket `quote-pdfs`; paths `quotes/<id>.pdf`, `roofs/<token>.pdf`, `solar/<token>.pdf`, `paint/<token>.pdf`; `quotes.pdf_path` column); per-trade HTML builders `lib/quote/report-html.ts`, `lib/roofing/report-html.ts`, `lib/solar/report-html.ts`, `lib/painting/report-html.ts`; `lib/pdf/gotenberg.ts` (`renderPdfFromHtml`, `gotenbergConfigured`); per-trade PDF routes `/api/q/[token]/pdf`, `/api/q/roof|solar|paint/[token]/pdf`.
- **Invoices** migration `075_invoice_calibration_tables.sql` (`invoice_uploads`, `invoice_extractions`, both `tenant_id`-scoped); `lib/invoice/extract.ts`.
- **Provisioning shape to mirror** `lib/twilio/provision.ts` + `lib/vapi/provision.ts` (discriminated union `{ok:true,…,(stubbed?)} | {ok:false,reason,code?}`, STUB when flag !== 'true', invoked from `app/api/onboard/activate`). Tenant columns precedent: `twilio_sms_number`, `vapi_assistant_id`, `stripe_connect_account_id` → mirror with `file_store_id TEXT UNIQUE`.
- **Existing KB sync** `lib/kb-sync/sync.ts` + `app/api/cron/kb-sync/route.ts` (DB→KB sync for trade-book/brand stores; migration `094_brand_kb_stores.sql`).

**Two hard API constraints that shape the whole design:**
1. **Gemini File Search does NOT persist raw files** — only chunks + embeddings; there is no endpoint to download an original PDF back. The durable, downloadable copy lives ONLY in Supabase Storage; the KB is search/Q&A only.
2. **Single global `KB_API_KEY`, no per-tenant auth** — every store is reachable with that one key. Tenant isolation is 100% QuoteMate's job: the tenant→store mapping is server-side only and a store id is never sent to a client.

## Requirements

### Phase 1 — Backend (provisioning + dual-write archive + KB ingest + backfill)

1. Add migration `sql/migrations/NNN_tenant_file_store.sql` + `scripts/run-migration-NNN.mjs`, and update `sql/init.sql` to stay representative. Migration adds `tenants.file_store_id TEXT UNIQUE` (nullable) and a tracking table `tenant_file_documents` (`id uuid pk`, `tenant_id uuid not null`, `source_kind text check in ('quote','invoice')`, `source_id text not null`, `display_name text not null`, `storage_path text`, `kb_document_id text`, `state text check in ('pending','active','failed') default 'pending'`, `bytes int`, `error text`, `created_at timestamptz default now()`, `updated_at timestamptz`, UNIQUE `(tenant_id, display_name)`). Enable RLS to match migration-040 posture (service-role bypass; no positive client policy needed in P1).

2. Add env flag `TENANT_FILESTORE_ENABLED` (default disabled, gate is `=== 'true'`), reusing `KB_API_URL`/`KB_API_KEY` via `loadKbConfigFromEnv`. When the flag is not `'true'`, every new code path STUBs (returns a discriminated-union stub, writes nothing to KB, never throws).

3. Create `lib/filestore/tenant-store-name.ts` mirroring `lib/filestore/store-name.ts`: a deterministic `tenantStoreKey(tenantId)` and `tenantStoreDisplayName(tenantId, businessName?)` producing a stable, 128-char-capped, slugged name keyed on the **tenant UUID** (not business name, which can change), and a label-tolerant `startsWith` matcher for find-or-create. Reuse `slug()` and `bareStoreId()` from `store-name.ts`.

4. Create `lib/filestore/tenant-store.ts` mirroring `lib/filestore/session-store.ts`:
   - `ensureTenantStore(tenantId, businessName?)` — find-or-create via `kbListStores` + label-tolerant match, else `kbCreateStore`; returns the store id. Best-effort; on KB error returns `null` and never throws.
   - `addDocumentToTenantStore({tenantId, storeId, fileBytes, displayName, mimeType})` — dedup by `displayName` against `kbListDocuments` (skip if present), else `kbUploadDocument`. Best-effort, never throws; returns `{kbDocumentId} | null`.
   - `searchTenantStore({storeId, query, systemInstruction?, metadataFilter?})` — wraps `kbSearch`. (Consumed in P2/P3.)
   - A `TENANT_KB_SYSTEM` persona constant analogous to `ESTIMATOR_CHAT_SYSTEM`.

5. Create `lib/filestore/tenant-provision.ts` mirroring `lib/twilio/provision.ts`/`lib/vapi/provision.ts`: `provisionTenantStore({tenantId, businessName}): Promise<{ok:true, fileStoreId, stubbed?:true} | {ok:false, reason, code?}>`. When `TENANT_FILESTORE_ENABLED !== 'true'` return `{ok:true, stubbed:true, fileStoreId:null}`. On success it calls `ensureTenantStore`, writes `tenants.file_store_id`, and is **idempotent** (no-op if `file_store_id` already set and the store still exists).

6. Wire `provisionTenantStore` into `app/api/onboard/activate` alongside the existing twilio/vapi provisioning, fire-and-forget via `next/server` `after()` (mirrors `lib/filestore/provision.ts`). Activation must never fail because store provisioning failed.

7. Create ONE shared ingest helper `lib/filestore/ingest-quote.ts` exporting `archiveAndIngestQuote({tenantId, sourceKind, sourceId, pdfBytes|pdfPath, displayName})`. It (a) ensures the PDF is in Supabase Storage via the existing `storePdf`/`ensureQuotePdf` in `lib/quote/pdf.ts` (archive), then (b) lazily `ensureTenantStore` (safety net — create if `tenants.file_store_id` is null), then (c) `addDocumentToTenantStore`, then (d) upserts a `tenant_file_documents` row (state `pending`→`active`/`failed`). Entirely best-effort: any failure logs via `lib/log/pipeline.ts` and returns; it MUST NOT block or fail the quote pipeline.

8. Call `archiveAndIngestQuote` at **every trade's quote-finalize/send point**, via the single helper, run post-ack inside `after()` so it never adds latency to the customer-facing send. Coverage must include all live trades — electrical, plumbing, roofing, painting, commercial-painting, solar, aircon, signage — wired at each trade's PDF route / finalize path (`/api/q/[token]/pdf`, `/api/q/roof|solar|paint/[token]/pdf`, and the corresponding aircon/signage/commercial-painting finalize handlers). `displayName` is deterministic: `quote-<trade>-<id|token>.pdf`.

9. Invoice ingest: when an invoice reaches a finalized/extracted state (`invoice_extractions` written by `lib/invoice/extract.ts`), call the same helper with `sourceKind:'invoice'`, `sourceId:<invoice_uploads.id>`, archiving the raw uploaded file to Supabase Storage (bucket `quote-pdfs`, path `invoices/<id>.<ext>`) and ingesting it. Reuse `invoice_uploads`/`invoice_extractions`; do not add a new invoice table.

10. Skip rule: `archiveAndIngestQuote` returns immediately (no-op, logged) when `tenantId` is null/empty (orphan rows). KB-unsupported file types (audio/video/archives/exe) are skipped at the helper before upload.

11. Force-confirm / inspection-routed quotes: archive + ingest the **finalized PDF as actually rendered** (prices hidden per the publish gate). Never bypass the publish gate to ingest a price-bearing version. If no finalized PDF exists yet (still draft), the helper is a no-op until finalize.

12. Backfill script `scripts/backfill-tenant-filestore.mjs` (run via `node --env-file=.env.local`): for each tenant with `status='active'`, `ensureTenantStore`, then iterate that tenant's `quotes` (non-null `tenant_id`, finalized/sent) and `invoice_uploads`/`invoice_extractions`, calling the same `archiveAndIngestQuote` path. It MUST skip rows where `tenant_id IS NULL`. It MUST be re-runnable: dedup-by-`displayName` (KB) + the `tenant_file_documents` UNIQUE `(tenant_id, display_name)` guarantee a second run adds zero duplicates. Supports `--dry-run` and `--tenant=<id>`.

13. Failed-doc reconciliation: extend `app/api/cron/kb-sync/route.ts` (or add `app/api/cron/tenant-filestore-reconcile/route.ts`) to (a) re-check `tenant_file_documents` rows in `pending` against `kbListDocuments` and flip to `active` when indexing completed, and (b) retry rows in `failed` a bounded number of times. Cron registered in `vercel.json`.

**Exit condition:** With `TENANT_FILESTORE_ENABLED=true`, a newly finalized quote in any trade and a newly extracted invoice each (1) land as a downloadable PDF in the `quote-pdfs` bucket and (2) appear as an `active` document in the tenant's Gemini store, with exactly one `tenant_file_documents` row each; the backfill script seeds all active tenants, skips orphan rows, and a second run adds zero duplicate `displayName`s; the quote/invoice pipeline still succeeds even with the KB API unreachable. No UI shipped yet.

### Phase 2 — Dashboard (Files tab: browse/download archive + cited KB chat)

14. Add a "Files" tab to `/dashboard`. Server component resolves the authenticated tenant (existing `app/api/tenant/me` pattern), lists `tenant_file_documents` for **that tenant_id only**, showing display name, source kind, state, created date. Never render or transmit `file_store_id` or `kb_document_id` to the browser.

15. Download endpoint `/api/tenant/files/[id]/download` (server-only): looks up the `tenant_file_documents` row, asserts `row.tenant_id === authenticated tenant`, and streams the Supabase Storage object via `downloadQuotePdf`-style access. Downloads come ONLY from Supabase Storage, never from the KB (which holds no raw file). Cross-tenant id → 404.

16. KB chat endpoint `/api/tenant/files/chat` (server-only POST `{query}`): resolves the caller's tenant → its `file_store_id` server-side, calls `searchTenantStore` with `TENANT_KB_SYSTEM`, returns the answer **plus citations** (document display names / source ids from the search result). The store id is never accepted from or returned to the client. If the tenant has no store yet, lazily `ensureTenantStore`; if still empty, return a friendly "no documents indexed yet" state.

17. UI chat box on the Files tab renders cited answers (answer text + clickable citations that deep-link to the matching archive document's download). Loading/empty/error states handled.

**Exit condition:** A signed-in tradie sees only their own documents in the Files tab, can download any archived PDF (served from Supabase Storage), and can ask a question in the chat box that returns a cited answer drawn only from their store; a second tenant signed in sees a disjoint document set and cannot download or query the first tenant's files (verified by an isolation test).

### Phase 3 — AI grounding (per-tenant past-jobs/invoices grounding)

18. Extend the existing supplement/calibration flow in the estimate pipeline (`lib/estimate/run.ts` and its RAG/supplement inputs) with a per-tenant grounding step: before drafting, call `searchTenantStore` for the drafting tenant with a query derived from the structured intake (job type, scope) to retrieve relevant snippets from that tenant's own past quotes/invoices.

19. Grounding is **flag-gated** (reuse `TENANT_FILESTORE_ENABLED`, optionally a sub-flag), **best-effort, never-blocking** (a KB miss/timeout produces an empty supplement and the existing pipeline proceeds unchanged), and **additive** — it informs the prompt context only; it does NOT bypass the money-path rule (prices still come solely from tool-calling against `pricing_book`/`shared_*`/`tenant_custom_assemblies`, and the grounding validator remains the hard backstop). Retrieved snippets are advisory context, never a price source.

20. The grounding query is scoped to the caller's tenant store id only (resolved server-side from `tenants.file_store_id`); no cross-tenant snippets can enter a draft.

**Exit condition:** With grounding enabled, a draft for a tenant who has relevant past jobs includes that tenant's own context in the prompt (observable in `lib/log/pipeline.ts`) while final line-item prices remain 100% tool-call/grounding-validator derived; disabling the flag returns the pipeline to identical pre-P3 behavior; a tenant's draft never contains another tenant's snippets.

## Non-goals
- Do NOT remove or alter the existing per-session estimator-chatbot stores (`lib/filestore/session-store.ts`, `provision.ts`) — per-tenant stores coexist with them at a different scope.
- No Stripe Connect / funds-split / payments work of any kind.
- No invoice *generation* — invoices remain inbound (tradie-uploaded) per migration 075.
- No replacement of the existing trade-book/brand KB sync (`lib/kb-sync/sync.ts`); this is a new, separate per-tenant store class.
- No new PDF renderer — reuse `lib/pdf/gotenberg.ts` + existing per-trade report-html builders.
- No raw-file retrieval from the KB (impossible by design); no client exposure of store/document ids.
- No per-tenant KB auth (not supported by the single-key API); no migration of existing orphan/test data.
- Not normalizing line items into `quote_line_items` (unused).

## Constraints
- **KB API:** single global `KB_API_KEY` (no per-tenant auth → isolation is 100% app-layer); KB holds chunks+embeddings only (no raw download); upload ≤100MB (`KB_UPLOAD_MAX_BYTES`); async indexing 10–60s with states `processing→active→failed`; accepts PDF/Office/text/markdown/html/csv/json, skips audio/video/archives/exe; `DELETE` on a non-empty store needs `?force=true`.
- **Isolation:** tenant→`file_store_id` mapping is server-side only; store id never sent to a client; P2 list/download/chat and P3 grounding all scoped by authenticated `tenant_id`; deterministic store name keyed on the tenant UUID.
- **Next 16:** per `quotemate-automation/AGENTS.md`, read the relevant `node_modules/next/dist/docs/` guide before writing Next code. Webhook/finalize routes fast-ack <500ms; all KB ingest runs post-ack via `next/server` `after()`.
- **Failure isolation:** every new path is best-effort and NEVER throws into or blocks the quote/invoice pipeline (mirrors `addDocumentsToSessionStore`).
- **Migration discipline:** new `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs` applied to prod Supabase, keep `sql/init.sql` representative.
- **Flags:** `TENANT_FILESTORE_ENABLED` default off (`=== 'true'` to enable), reusing `KB_API_URL`/`KB_API_KEY`; STUB shape mirrors twilio/vapi provision when off.
- **Idempotency:** dedup by `displayName` in KB + UNIQUE `(tenant_id, display_name)` on `tenant_file_documents`; deterministic display names so re-send/re-backfill never duplicate.
- **Cost:** Gemini indexing ~$0.15/1M tokens (charged once at ingest); ~1GB free storage tier per the KB — retention policy is an open question (see below).

## Edge cases to handle
- **Indexing slow (10–60s):** ingest marks `tenant_file_documents.state='pending'`, returns immediately; the reconcile cron flips it to `active` once `kbListDocuments` shows it ready.
- **Indexing returns `failed`:** row set to `state='failed'` with `error`; reconcile cron retries a bounded number of times, then leaves it `failed` (no pipeline impact).
- **PDF > 100MB:** skip KB upload (still archive to Supabase Storage), set `state='failed'` reason `too_large`. Quotes essentially never hit this; invoices might.
- **`tenants.file_store_id` is null at finalize (already-active tenant pre-feature):** helper lazily `ensureTenantStore`, writes the id, then ingests (find-or-create safety net, not onboarding-only).
- **Store missing/deleted upstream:** label-tolerant find-or-create recreates it; if KB returns 404 on upload, re-ensure once then give up best-effort.
- **`tenant_id IS NULL` (orphan/test rows):** helper no-ops with a log line; backfill skips them entirely.
- **Re-sent / re-rendered quote (same id/token):** deterministic `displayName` → dedup-by-`displayName` skips re-upload; UNIQUE constraint prevents a duplicate tracking row.
- **Re-run backfill:** zero new KB docs and zero new tracking rows (dedup + UNIQUE).
- **KB API down / `KbHttpError`:** archive to Supabase Storage still succeeds; KB step caught and logged; row left `pending`; reconcile cron picks it up later. Quote/invoice flow unaffected.
- **Gotenberg down (`gotenbergConfigured` false / render error):** no PDF to archive or ingest; helper no-ops and logs; quote still sends per existing behavior.
- **Force-confirm / inspection-routed quote (prices hidden):** archive + ingest the published PDF exactly as rendered (no prices); never ingest a price-bearing variant.
- **Flag off (`TENANT_FILESTORE_ENABLED !== 'true'`):** all paths STUB; no KB calls, no rows written, no behavior change.
- **Cross-tenant access attempt in P2:** download/chat for a doc whose `tenant_id` ≠ authenticated tenant → 404; never leak the other store's id.

## Definition of done

**Phase 1**
- [ ] Migration `NNN_tenant_file_store.sql` applied to prod Supabase; `tenants.file_store_id TEXT UNIQUE` and `tenant_file_documents` exist; `sql/init.sql` updated.
- [ ] `provisionTenantStore` returns the twilio/vapi discriminated-union shape and STUBs when the flag is off (unit test).
- [ ] With flag on, finalizing a quote in EACH of electrical/plumbing/roofing/painting/commercial-painting/solar/aircon/signage produces a `quote-pdfs` archive object AND an `active` KB document (integration check per trade) — coverage routed through the single `lib/filestore/ingest-quote.ts` helper.
- [ ] An extracted invoice produces an `invoices/<id>` archive object + KB document + one `tenant_file_documents` row.
- [ ] `archiveAndIngestQuote` never throws and never blocks: a test with KB stubbed to error still completes the quote send and leaves the row `pending`/`failed`.
- [ ] Backfill run ingests all `status='active'` tenants' finalized quotes + invoices, skips `tenant_id IS NULL` rows; a second run logs zero new uploads and creates zero duplicate `displayName`s (metric: duplicate count = 0).
- [ ] Reconcile cron flips a `pending` row to `active` once indexing completes and bounds `failed` retries (test with a stubbed `kbListDocuments`).

**Phase 2**
- [ ] Files tab lists only the authenticated tenant's `tenant_file_documents`; `file_store_id`/`kb_document_id` appear in no network response (verified in browser network tab / test).
- [ ] `/api/tenant/files/[id]/download` streams from Supabase Storage and returns 404 for a doc owned by another tenant (isolation test).
- [ ] `/api/tenant/files/chat` returns a cited answer scoped to the caller's store; store id never appears in request or response (test).
- [ ] Two-tenant isolation test: tenant B cannot list, download, or query tenant A's documents.

**Phase 3**
- [ ] With grounding flag on, a draft for a tenant with relevant past jobs shows their own snippets injected into prompt context (observable in `lib/log/pipeline.ts`).
- [ ] Final line-item prices remain 100% tool-call derived and pass the grounding validator (existing validator test still green; no price ever sourced from a KB snippet).
- [ ] Disabling the flag yields byte-identical pre-P3 pipeline behavior (regression test).
- [ ] A draft never contains another tenant's snippets (cross-tenant grounding isolation test).

## Open questions
- **PII / DPA:** customer names, addresses, and phone numbers in quote/invoice PDFs flow into Gemini File Search. Is this acceptable under the AU Privacy Act and Google's DPA for this data, and do we need tenant/customer consent, a redaction pass before ingest, or a data-residency commitment? (Owner: legal/product, before enabling the flag in prod.)
- **Retention / cost past 1GB:** per-tenant stores grow unbounded; what is the retention policy (e.g. cap by age/count, prune oldest via `kbDeleteDocument`, or paid storage past the ~1GB free tier)? Who pays Gemini indexing cost at scale?
- **Tenant offboarding:** on tenant suspension/deletion, do we `kbDeleteStore(...?force=true)` and purge the Supabase archive, and on what timeline?
- **Invoice file types:** some uploaded invoices are images (JPG/PNG photos), which the KB may not index well — do we ingest the Opus-extracted text from `invoice_extractions` as a `.txt`/`.md` document instead of the raw image for those cases?
- **Display-name collisions across re-renders:** if a quote is materially re-drafted (not just re-sent), do we want a versioned `displayName` (supersede prior) rather than dedup-skip?

Relevant paths: `quotemate-automation/lib/filestore/` (new `tenant-store.ts`, `tenant-store-name.ts`, `tenant-provision.ts`, `ingest-quote.ts`), `quotemate-automation/lib/admin-loader/mt-filestore-kb.ts`, `quotemate-automation/lib/quote/pdf.ts`, `quotemate-automation/lib/invoice/extract.ts`, `quotemate-automation/app/api/onboard/activate`, `quotemate-automation/app/dashboard`, `quotemate-automation/app/api/tenant/files/*`, `quotemate-automation/scripts/backfill-tenant-filestore.mjs`, `quotemate-automation/sql/migrations/NNN_tenant_file_store.sql`.
