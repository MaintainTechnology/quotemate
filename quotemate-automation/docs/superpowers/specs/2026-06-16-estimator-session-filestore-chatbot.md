# Estimator per-session File Store + grounded chatbot

**Date:** 2026-06-16
**Status:** Shipped (dashboard surfaces). Customer-page placement is a noted follow-up.

## What this adds

Every estimator upload **session** now gets its own persistent Gemini File Search
store (via the existing `mt-filestore-kb` service) holding that session's own
documents — the files the customer/tradie uploaded **and** the finished estimate
result — and a flexible **chatbot** on the estimator answers questions
("why is this value here?", "what does my plan show?") grounded in that store,
using the free **Gemini 2.5** model and the file-search tool, with citations.

This is the durable counterpart to the pre-existing *ephemeral* supplement passes
(`lib/estimation/supplement.ts`, `lib/commercial-painting/kb-runner.ts`), which
create a throwaway store and delete it after extraction. Those are untouched.

## Two estimators

| | Commercial paint | Electrical (Estimator Beta) |
|---|---|---|
| Session id | `paint_runs.id` (`runId`) | `plan_extractions.id` (`extractionId`) |
| Source files indexed | plan set + services layout (at `/extract`) | plan PDF (at `/extract` — the only point the bytes exist server-side) |
| Result indexed | tender PDF (at `/save-quote`) | priced-BOM text summary (at `/price`; the dashboard flow renders no PDF) |
| Chatbot rendered in | `CommercialPaintingTab` | `RunWorkspace` |

## Design

- **Store naming** (`lib/filestore/store-name.ts`): deterministic display name
  `qm-<estimator>-<sessionId>` (+ optional `· <label>`). The store is found again
  from the session id alone — **no new DB column** to persist a store id.
- **Persistent layer** (`lib/filestore/session-store.ts`): `ensureSessionStore`
  (find-or-create by display name via `kbListStores`), `addDocumentsToSessionStore`
  (de-dupes by display name), `searchSessionStore` (grounded answer + citations).
  Built on the existing `lib/admin-loader/mt-filestore-kb.ts` HTTP client.
- **System instruction**: the upstream `/v1/search` defaulted to a *signage-
  compliance* persona. It now accepts an optional `systemInstruction`
  (`SearchDto` → `GeminiService.search`, default unchanged). The chatbot passes
  `ESTIMATOR_CHAT_SYSTEM` so answers are framed for an estimate, grounded only in
  the session's docs, never inventing numbers.
- **Provisioning** (`lib/filestore/provision.ts`): runs in `after()` (post-
  response) — uploading + indexing on Gemini takes 10–60s and must never sit on
  the estimate's critical path. Best-effort; never throws into the pipeline.
- **Chat API** (`app/api/filestore/chat/route.ts`): tenant-scoped (Bearer) +
  session-ownership check (the session row must carry a matching `tenant_id`), so
  one tenant can never query another's store. Degrades gracefully when the KB
  service is unconfigured or the session has no documents yet.

## Config (env)

- `KB_API_URL` (or `MT_FILESTORE_KB_URL`) — mt-filestore-kb base URL.
- `KB_API_KEY` — `x-api-key` shared secret. (Both already required by the
  existing paint KB supplement, so prod already sets them.)
- `FILESTORE_CHAT_MODEL` — chatbot model, default `gemini-2.5-flash`.
- `ESTIMATOR_CHATBOT_ENABLED=false` — opt-out kill switch for provisioning.

## Tests

- `lib/filestore/{store-name,session-store,chat-request,estimate-summary}.test.ts`
  (34 tests, fetch-mocked, node-only).
- `lib/admin-loader/mt-filestore-kb.test.ts` — extended for `systemInstruction`.
- `mt-filestore-kb` (separate repo) — `gemini.service.spec.ts` extended for the
  custom/blank `systemInstruction` paths.

## Follow-ups (out of scope here)

- Render the chatbot on the **customer-facing** quote pages (`/q/[token]`,
  `/q/plan/[token]`). Needs a public, rate-limited chat variant that resolves a
  share token → session id server-side (the dashboard route is tenant-auth only).
- Index the electrical SMS-path **report PDF** (currently only the dashboard
  summary text is indexed for electrical).
