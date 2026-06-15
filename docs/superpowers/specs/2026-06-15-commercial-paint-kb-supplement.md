# Commercial Paint Estimator — KB file-store supplementation

> Status: ready to implement · Branch: feat/invitation-codes (current) · 2026-06-15
> Work happens in `quotemate-automation/`.

## Goal

After the commercial-paint extraction reconciles a takeoff from the uploaded PDFs, run a
**best-effort second pass** that:

1. creates a **temporary** mt-filestore-kb store,
2. uploads the user's uploaded PDFs (plan set + measurement/services docs) into it,
3. uses grounded File-Search retrieval to **verify and fill gaps** in the extracted takeoff,
4. **deletes the temporary store** (always — even on error).

The KB pass exists only to improve the accuracy of the data the estimator already extracted.

## Locked decisions

- **Trade:** `commercial_painting` only. Do not touch residential paint, electrical, plumbing, or signage.
- **Mode = HYBRID:**
  - Auto-fill a field on an extracted item **only** when that field is missing/empty **or** the item's `confidence === 'low'`.
  - Append items the KB finds in the documents that are **absent** from the takeoff.
  - **Never overwrite a confident (high/medium) extracted value.** When the KB disagrees with such a value, emit a **flag** (suggested correction) for the tradie editor — do not change the number.
- **Cleanup:** delete the whole temp store via `DELETE /v1/stores/:id?force=true` in a `finally` — always, including on error/early-exit. No orphaned stores or documents.
- **Best-effort:** any failure (missing KB env, network error, indexing timeout, unparsable answer) ⇒ fall back to the un-supplemented reconciled items, still attempt cleanup, **never fail the extraction**.
- **Gated:** runs only when `loadKbConfigFromEnv()` succeeds **and** `process.env.PAINT_KB_SUPPLEMENT_ENABLED !== 'false'`.

## Verified facts (do not re-discover)

- KB client: `lib/admin-loader/mt-filestore-kb.ts` — has `kbCreateStore`, `kbUploadDocument`, `kbSearch`,
  `kbDeleteDocument`, `kbListDocuments`, `loadKbConfigFromEnv`, `KbHttpError`, types `KbConfig`/`KbFetch`.
  **Missing:** `kbDeleteStore` (this spec adds it).
- Live service supports `DELETE /v1/stores/:storeId?force=true` (deletes store + its docs) — confirmed in
  `mt-filestore-kb/src/controllers/stores.controller.ts:69`.
- Extraction route: `app/api/tenant/commercial-painting/extract/route.ts`. Hook point is **after**
  `reconcileTakeoff(...)` and **before** the `plan_extractions` insert. Read the file for exact variable names.
- Extraction lib + types: `lib/commercial-painting/extract.ts`, `lib/commercial-painting/reconcile.ts`,
  `lib/commercial-painting/types.ts` (`PaintTakeoffItem`, `MeasurementLine`, `ReconcileResult`,
  `PaintConfidence`, `PaintLineSource`, `PaintSystem`).
- Mirror patterns: `lib/signage/kb-supplement.ts`, `lib/estimate/kb-verify.ts` (existing kbSearch-based supplement/verify).
- Env present in `.env.local`: `KB_API_URL`, `KB_API_KEY`.
- KB indexing is async (10–60s/doc); poll `kbListDocuments` until state leaves `processing`.
- Node 20+ has a global `File`; build the upload payload as `new File([buf], name, { type: 'application/pdf' })`.

## Build plan (TDD — write the failing test first for each unit)

### 1. `kbDeleteStore` in `lib/admin-loader/mt-filestore-kb.ts` (+ tests in `mt-filestore-kb.test.ts`)
- `export async function kbDeleteStore(config: KbConfig, storeId: string, opts: { force?: boolean } = {}, fetchImpl: KbFetch = fetch): Promise<void>`
- `DELETE /v1/stores/${encodeURIComponent(storeId)}` + `?force=true` when `opts.force`. (Accepts a full
  `fileSearchStores/<id>` name or a bare id; the service normalizes.) Sets `x-api-key`. Throws `KbHttpError` on non-2xx.
- Tests: DELETEs the right URL incl. `?force=true` + api-key header; omits the query when `force` not set;
  throws `KbHttpError` on 404/500; throws when `storeId` empty.

### 2. PURE module `lib/commercial-painting/kb-supplement.ts` (+ `kb-supplement.test.ts`)
Types:
- `PaintSupplementCorrection = { surface: string; room?: string; field: 'quantity'|'unit'|'system'|'substrate'|'coats'|'height_m'; value: string|number; page?: number; confidence?: PaintConfidence }`
- `PaintSupplementMissingItem = { surface: string; room: string; substrate?: string; system?: PaintSystem; unit: 'm2'|'item'; quantity: number; page?: number; confidence?: PaintConfidence }`
- `PaintSupplementFindings = { missing_items: PaintSupplementMissingItem[]; corrections: PaintSupplementCorrection[] }`
- `PaintSupplementFlag = { kind: 'kb_filled'|'kb_added'|'kb_conflict'; surface: string; room: string; detail: string }`

Functions:
- `buildPaintSupplementQuery(items: PaintTakeoffItem[], jobHint?: string): string` — asks the KB to return
  **strict JSON** `{ missing_items, corrections }` grounded in the uploaded PDFs, including the current takeoff
  (surface/room/unit/quantity/system) so the model can diff. Demands page citations and forbids prose/code-fences.
- `parsePaintSupplementFindings(answer: string): PaintSupplementFindings | null` — defensive: strip code fences,
  `JSON.parse`, validate/whitelist each entry's shape, drop invalid entries; return `null` on total failure.
- `applyPaintSupplement(items: PaintTakeoffItem[], findings: PaintSupplementFindings): { items: PaintTakeoffItem[]; flags: PaintSupplementFlag[] }`
  — PURE (clone input, never mutate). Match by `surface`+`room` (trim + case-insensitive). Hybrid rules:
  - **correction, item field empty OR item.confidence==='low'** → apply value; note `kb-filled (p.N)`; flag `kb_filled`.
  - **correction, item has a confident value that differs** → do **not** change; flag `kb_conflict` with
    `detail: "plan: <old> · documents: <new> (p.N)"`.
  - **missing_item not present in items** → append a new `PaintTakeoffItem` (`source:'measurements'`,
    `confidence: finding.confidence ?? 'low'`, `coats: 1`, `note:'kb-added (p.N)'`); flag `kb_added`.
- Tests: fill-missing applies + `kb_filled`; confident conflict NOT overwritten + `kb_conflict`; missing item
  appended + `kb_added`; empty findings ⇒ items unchanged + no flags; parse handles fenced/garbage/`null`.

### 3. Orchestrator `lib/commercial-painting/kb-runner.ts` (+ `kb-runner.test.ts`, injected deps)
- `export async function supplementTakeoffViaKb(args: { config: KbConfig; items: PaintTakeoffItem[]; jobHint?: string; displayName: string; files: { name: string; bytes: Buffer; mime?: string }[]; model?: string; deps?: { fetchImpl?: KbFetch; sleep?: (ms: number) => Promise<void>; maxIndexWaitMs?: number } }): Promise<{ items: PaintTakeoffItem[]; flags: PaintSupplementFlag[]; usedKb: boolean; storeName?: string }>`
- Flow: `kbCreateStore` → `kbUploadDocument` per file → poll `kbListDocuments` until none `processing`
  (bounded by `maxIndexWaitMs`, default ~90s, via injected `sleep`) → `kbSearch(buildPaintSupplementQuery)` →
  `parsePaintSupplementFindings` → `applyPaintSupplement` → return.
- `finally`: if a store was created, `kbDeleteStore(config, store.name, { force: true })` swallowing errors.
- On **any** thrown error before return: return `{ items: args.items, flags: [], usedKb: false }` (cleanup still ran).
- Tests (inject `fetchImpl` + no-op `sleep`): happy path does create→upload→search→**delete**; cleanup is called
  **even when search throws**; returns original items unchanged on failure.

### 4. Wire into `app/api/tenant/commercial-painting/extract/route.ts`
- After `reconcileTakeoff(...)`, before the `plan_extractions` insert, in a `try/catch` (best-effort):
  - skip entirely if `process.env.PAINT_KB_SUPPLEMENT_ENABLED === 'false'`;
  - `const cfg = loadKbConfigFromEnv()` (throws if env missing → caught → skip);
  - build `files` from the same plan/measurement buffers the route already loaded;
  - `const sup = await supplementTakeoffViaKb({ config: cfg, items: reconciled.items, jobHint: extraction.parsed?.job, displayName: 'paint-temp-' + paintRunId, files })`;
  - use `sup.items` as the persisted `items`; append `sup.flags` into `sheets_used` (new key `kb_flags`).
- When disabled/unavailable, the persisted result is byte-identical to today (`reconciled.items`, no `kb_flags`).
- Keep within the route's existing `maxDuration` budget.

## Done when
- `cd quotemate-automation && npx vitest run` is **fully green** (existing suites + the new
  `kbDeleteStore`, `kb-supplement`, `kb-runner` tests).
- `npx tsc --noEmit` introduces **no new** errors beyond the known pre-existing baseline.
- No existing test is weakened, skipped, or deleted to go green.
