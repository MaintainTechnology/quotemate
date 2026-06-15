# Spec — Ephemeral file-store supplementation for the Electrical Estimator

**Date:** 2026-06-15
**Status:** to build (driven by a ralph loop; completion = all tests pass)

## Goal

After the Electrical Estimator ("Estimator Beta") extracts a quantity take-off from
an uploaded electrical plan PDF, use the **mt-filestore-kb** service (a Gemini
File Search proxy) to **verify, correct, and fill gaps** in the extracted data —
using the customer's own uploaded PDF as the retrieval source — then **tear down**
the temporary store. The whole step is automated and ephemeral: the file store
exists only for the duration of one extraction and is always deleted afterwards.

Primary purpose: a throwaway retrieval index built from the upload itself, used to
**supplement/correct** the estimator's extracted results — not permanent storage.

## Grounded facts (already verified against the code — read the cited files before editing)

### mt-filestore-kb HTTP API (NestJS proxy over Gemini File Search)

Base URL from env `KB_FILESTORE_URL` (e.g. `https://mt-filestore-kb-production.up.railway.app`).
Auth: header `x-api-key: <KB_API_KEY>` on every `/v1/*` route.

- `POST /v1/stores` — body `{ displayName }` → `{ name: "fileSearchStores/<id>", displayName?, createTime?, activeDocumentsCount? }`. Blocks until the store is created.
- `POST /v1/stores/:storeId/upload` — `multipart/form-data`, field **`file`** (PDF, ≤100 MB), optional `displayName`. **Synchronous** — blocks until the doc is indexed, then returns `{ indexed: true, store, document: {...} }`. No client-side polling needed. `:storeId` may be the bare id or the full `fileSearchStores/<id>` name.
- `POST /v1/search` — body `{ store, query, model?, metadataFilter? }` → `{ store, model, answer, citations: [{ title?, page?, snippet? }] }`.
  - **CRITICAL CAVEAT:** the service injects a fixed *signage-compliance* system persona into search, so the synthesized **`answer` field is UNRELIABLE** for electrical content. **Rely on `citations[].snippet`** (raw passages retrieved from the uploaded PDF), never on `answer`.
- `DELETE /v1/stores/:storeId?force=true` → `{ deleted: true, store }`. `force=true` is required to delete a store that still holds documents.
- Single shared `KB_API_KEY`; isolation is by store naming only. Create a uniquely-named store per run and delete it.

### Electrical Estimator flow (in `quotemate-automation/`)

- Upload UI: `app/dashboard/_components/EstimatorBetaTab.tsx` (POSTs multipart `pdf` + `sheet_hint`).
- Extract API route: `app/api/tenant/estimator/extract/route.ts` — POST, `maxDuration = 300`, `MAX_PDF_BYTES = 32MB`, Bearer auth. Reads the PDF into an in-memory `Buffer` (~line 46), calls `runExtraction`, then persists `plan_uploads` + `plan_extractions` (~lines 79–99). **Injection point: after `runExtraction()` returns `result.parsed`, before the `plan_extractions` insert.**
- Extraction core: `lib/estimation/extract.ts` → `runExtraction()` returns `ExtractionResult` whose `.parsed` is:
  ```ts
  ParsedExtraction = {
    sheets_used: string[]
    legend_symbols: { symbol: string; means: string }[]
    items: ExtractionItem[]
    overall_note: string
  }
  ExtractionItem = {
    type: string; symbol: string; count: number;
    confidence: 'high' | 'medium' | 'low'; note?: string;
    locations?: { page: number; x: number; y: number }[]
  }
  ```
- Architecture convention: **pure-core + thin-IO** (see `extract.ts`, `lib/estimation/price.ts`, `lib/estimation/refine.ts`).
- Tests: mirror `lib/estimation/extract.test.ts` — vitest, pure functions, hard-coded fixtures, **no network/LLM**. Gated live variants live in `*.live.test.ts`.
- Note: `lib/estimation/sms-run.ts` runs its own `runExtraction`; wiring it there is optional (out of scope for v1 unless trivial — leave a TODO).

## Deliverables

1. **`lib/estimation/filestore-client.ts`** — typed thin-IO client for mt-filestore-kb:
   - `isFileStoreConfigured(env?): boolean` (true only when `KB_FILESTORE_URL` and `KB_API_KEY` are both set).
   - `createStore(displayName)` → `{ name }`.
   - `uploadPdf(storeName, bytes, filename)` → `{ document }` (multipart, field `file`).
   - `search(storeName, query, opts?)` → `{ answer, citations: {title?,page?,snippet?}[] }`.
   - `deleteStore(storeName)` → `{ deleted: true }` (uses `?force=true`).
   - Accept an injectable `fetch` (and base config) so it is unit-testable without network. Never log the api key or file contents.

2. **`lib/estimation/supplement.ts`**
   - **Pure functions (fully unit-tested, no IO):**
     - `buildSupplementQueries(parsed: ParsedExtraction): SupplementQuery[]` — targeted queries focused on low/medium-confidence items, ambiguous legend symbols, and likely-missing/zero-count fields. Deterministic, bounded count.
     - `mergeSupplement(parsed, evidence): { parsed: ParsedExtraction; changes: SupplementChange[] }` — apply corrections / gap-fills supported by retrieved **snippet** evidence; record per-change provenance (extracted vs supplemented). **Never fabricate**: only adjust an item when the evidence supports it; otherwise leave it untouched.
   - **Orchestrator** `supplementExtraction({ parsed, pdf, filename, client, env? })`:
     1. If not configured / flag off → return original `parsed` unchanged (+ a note). Never throw.
     2. Create a uniquely-named temp store → upload the PDF → run `buildSupplementQueries` → search each (use `citations[].snippet`, ignore `answer`) → `mergeSupplement`.
     3. **Always delete the temp store in a `finally` block** — guaranteed cleanup on success, error, or timeout.
     4. On any failure, return the ORIGINAL `parsed` (graceful degradation), with a short note; do not throw into the estimate.

3. **Wire into `app/api/tenant/estimator/extract/route.ts`** at the injection point, behind env flag `ESTIMATOR_FILESTORE_SUPPLEMENT_ENABLED` (default OFF). Persist the supplemented `items`; fold a short provenance summary into `overall_note`. **No DB migration** (reuse existing columns; per-item provenance goes in the item `note`).

4. **Tests** (vitest, no network, injected fakes — mirror `extract.test.ts`):
   - `lib/estimation/supplement.test.ts`: `buildSupplementQueries` (targets low-confidence items; bounded), `mergeSupplement` (correction, gap-fill, **no-fabrication**, provenance recorded), and `supplementExtraction` with a FAKE injected client asserting: (a) the store is deleted **even when search throws**, (b) graceful passthrough when unconfigured/flag-off returns the original parsed, (c) **snippet** evidence (not `answer`) drives merges.
   - `lib/estimation/filestore-client.test.ts`: URL/header/multipart/payload construction and response parsing using a mocked `fetch` (assert `x-api-key` header, `?force=true` on delete, field name `file`).

## Constraints

- **Ephemeral guarantee:** the temp store MUST be deleted in all paths (success / error / timeout). Assert it in tests.
- Supplementation enriches the **extracted take-off only**; it must NOT override or bypass the deterministic, grounded pricing step.
- **Privacy:** persist no new raw PDF bytes; the temp store is the only external copy and is torn down. Never log file bytes or the api key.
- **Graceful degradation:** if mt-filestore-kb is unavailable or env is unset, the estimate proceeds with the original extraction.
- Default test runs must NOT hit the network or any LLM — use injected fakes/mocks.
- **Git/ops:** do **NOT** perform any git operations (no branch switch, no commit, no push), no deploy, and no DB migrations. Other automation is active in this working tree — only create/modify the feature's own files and leave version control to the human operator, who will review and commit afterward.

## Completion criteria ("All tests pass")

- `npx vitest run` (from `quotemate-automation/`) is green: the new tests **and** the existing unit suite. Exclude gated `*.live.test.ts` and Playwright e2e that require external services.
- `npx tsc --noEmit` reports no errors in the changed files.

## Live enablement (manual, outside the loop)

To actually run live, set in `.env.local` / Vercel: `KB_FILESTORE_URL`, `KB_API_KEY`, and `ESTIMATOR_FILESTORE_SUPPLEMENT_ENABLED=true`. Tests do not require these.
