// Persistent, per-session Gemini File Search stores for the estimator chatbot.
//
// This is the DURABLE counterpart to the ephemeral supplement passes
// (lib/estimation/supplement.ts, lib/commercial-painting/kb-runner.ts), which
// create a throwaway store and tear it down. Here every estimator upload
// SESSION (a commercial-paint run or an electrical plan extraction) gets ONE
// lasting store that holds:
//   • the files the customer/tradie uploaded for that job, and
//   • the finished estimate result PDF,
// so the on-page chatbot can answer "why is this value here?" grounded in that
// session's own documents.
//
// The store is addressed by a DETERMINISTIC display name derived from
// (estimator, sessionId) — see store-name.ts — so it is found again from the
// session id alone, with no extra DB column to persist the store id.
//
// Everything here is best-effort and NEVER throws into the estimator pipeline:
// a failure (missing KB env, network, indexing) degrades to "no store / no
// answer". The HTTP layer is the injectable admin-loader client so this is
// fully unit-testable without a live service.

import {
  kbCreateStore,
  kbListDocuments,
  kbListStores,
  kbSearch,
  kbUploadDocument,
  type KbConfig,
  type KbFetch,
  type KbStoreSummary,
} from '../admin-loader/mt-filestore-kb'
import {
  displayNameMatchesSession,
  sessionStoreDisplayName,
  type EstimatorKind,
} from './store-name'

/**
 * The chatbot's framing. Generalises away the upstream service's default
 * signage-compliance persona: here Gemini is grounding answers in ONE
 * customer's own job documents (their uploads + the estimate PDF).
 */
export const ESTIMATOR_CHAT_SYSTEM = `You are the QuoteMax Estimate Assistant. The documents indexed in this File Search store are ONE customer's own job: the files they uploaded for it (plans, measurement sheets, services layouts, site photos) and the finished estimate or quote PDF that QuoteMax produced for this job.

Your job is to help the customer or tradie understand THIS estimate:
- Answer only from the indexed documents for this job. Treat them as the single source of truth.
- When asked why a figure, quantity, surface, line item, loading or assumption is in the estimate, explain it and cite the document (and page) it comes from, quoting the relevant text where you can.
- When asked about an uploaded file, describe what that document shows and how it fed into the estimate.
- If the indexed documents do not cover what was asked, say so plainly (e.g. "That isn't in the uploaded documents or the estimate") rather than guessing. Never invent a price, quantity, measurement, colour, or page reference.
- Be clear, friendly and concise — this is a customer-facing helper, not an internal report. Prices are in Australian dollars and include GST where the estimate says so.
- You explain and clarify the estimate; you do not change it, approve it, or promise a final price — a human reviews every quote before anything is booked.`

/** A document to push into a session store. `bytes` is the raw file content. */
export type SessionStoreDoc = {
  /** Display name / filename shown in the store and used for de-duplication. */
  name: string
  bytes: Uint8Array | Buffer
  mime?: string
}

export type EnsureStoreResult =
  | { ok: true; storeName: string; created: boolean }
  | { ok: false; reason: string }

export type AddDocsResult = {
  ok: boolean
  storeName?: string
  uploaded: number
  skipped: number
  /** Per-file failure reasons (store created but a doc failed to index). */
  errors: string[]
  reason?: string
}

export type ChatCitation = { title?: string; page?: number; snippet?: string }

export type SessionChatResult = {
  ok: boolean
  /** False when no store exists yet for this session (no uploads indexed). */
  storeFound: boolean
  answer: string
  citations: ChatCitation[]
  reason?: string
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Find the persistent store for a session by its deterministic display name,
 * or null when none exists yet. Throws only on a hard list failure (callers
 * wrap this).
 */
export async function findSessionStore(
  config: KbConfig,
  estimator: EstimatorKind,
  sessionId: string,
  fetchImpl?: KbFetch,
): Promise<KbStoreSummary | null> {
  const stores = await kbListStores(config, fetchImpl)
  return (
    stores.find((s) => displayNameMatchesSession(s.displayName, estimator, sessionId)) ?? null
  )
}

/**
 * Find-or-create the persistent store for a session. Best-effort: returns
 * `{ ok:false, reason }` instead of throwing so the estimator pipeline is never
 * broken by a KB problem.
 */
export async function ensureSessionStore(
  config: KbConfig,
  estimator: EstimatorKind,
  sessionId: string,
  label?: string | null,
  fetchImpl?: KbFetch,
): Promise<EnsureStoreResult> {
  try {
    const existing = await findSessionStore(config, estimator, sessionId, fetchImpl)
    if (existing?.name) return { ok: true, storeName: existing.name, created: false }
    const created = await kbCreateStore(
      config,
      { displayName: sessionStoreDisplayName(estimator, sessionId, label) },
      fetchImpl,
    )
    if (!created?.name) return { ok: false, reason: 'createStore returned no store name' }
    return { ok: true, storeName: created.name, created: true }
  } catch (e) {
    return { ok: false, reason: errMessage(e) }
  }
}

/**
 * Ensure the session store exists and upload `documents` into it. De-duplicates
 * by display name (an already-indexed file is skipped) so re-running an
 * extraction or re-saving a quote does not pile up duplicates. Never throws;
 * per-file upload failures are swallowed so a single bad file can't abort the
 * rest. Returns counts for logging.
 */
export async function addDocumentsToSessionStore(args: {
  config: KbConfig
  estimator: EstimatorKind
  sessionId: string
  label?: string | null
  documents: SessionStoreDoc[]
  fetchImpl?: KbFetch
  /** Skip files whose display name is already indexed (default true). */
  skipExistingByName?: boolean
}): Promise<AddDocsResult> {
  const { config, estimator, sessionId, label, documents, fetchImpl } = args
  const skipExisting = args.skipExistingByName !== false
  const docs = (documents ?? []).filter((d) => d && d.bytes && d.bytes.byteLength > 0)
  if (docs.length === 0) return { ok: true, uploaded: 0, skipped: 0, errors: [] }

  const ensured = await ensureSessionStore(config, estimator, sessionId, label, fetchImpl)
  if (!ensured.ok) return { ok: false, uploaded: 0, skipped: 0, errors: [ensured.reason], reason: ensured.reason }
  const storeName = ensured.storeName

  let existingNames = new Set<string>()
  if (skipExisting) {
    try {
      const indexed = await kbListDocuments(config, storeName, fetchImpl)
      existingNames = new Set(
        indexed.map((d) => (d.displayName ?? '').trim()).filter(Boolean),
      )
    } catch {
      // dedup is best-effort — proceed and risk a duplicate over dropping a file
    }
  }

  let uploaded = 0
  let skipped = 0
  const errors: string[] = []
  for (const d of docs) {
    const name = (d.name || 'document.pdf').trim()
    if (skipExisting && existingNames.has(name)) {
      skipped++
      continue
    }
    try {
      // Buffer/Uint8Array are valid BlobParts at runtime; the cast bridges the
      // typed-array generic vs DOM BufferSource friction (same as kb-runner).
      const file = new File([d.bytes as unknown as BlobPart], name, {
        type: d.mime ?? 'application/pdf',
      })
      await kbUploadDocument(config, { storeId: storeName, file, displayName: name }, fetchImpl)
      uploaded++
      existingNames.add(name)
    } catch (e) {
      // best-effort per file — keep going, but record why so the caller can log it
      errors.push(`${name}: ${errMessage(e)}`)
    }
  }
  return { ok: true, storeName, uploaded, skipped, errors }
}

/**
 * Answer a question grounded in a session's store, using the estimate-assistant
 * framing (or a caller override). Returns `storeFound:false` when the session
 * has no store yet (nothing uploaded) so the UI can show a helpful empty state.
 * Never throws.
 */
export async function searchSessionStore(args: {
  config: KbConfig
  estimator: EstimatorKind
  sessionId: string
  query: string
  model?: string
  systemInstruction?: string
  fetchImpl?: KbFetch
}): Promise<SessionChatResult> {
  const { config, estimator, sessionId, query, model, fetchImpl } = args
  try {
    const store = await findSessionStore(config, estimator, sessionId, fetchImpl)
    if (!store?.name) {
      return { ok: true, storeFound: false, answer: '', citations: [] }
    }
    const res = await kbSearch(
      config,
      {
        store: store.name,
        query,
        ...(model ? { model } : {}),
        systemInstruction: args.systemInstruction ?? ESTIMATOR_CHAT_SYSTEM,
      },
      fetchImpl,
    )
    const citations: ChatCitation[] = (res.passages ?? [])
      .map((p) => ({ title: p.documentTitle, page: p.page, snippet: p.text }))
      .filter((c) => (c.snippet && c.snippet.trim()) || (c.title && c.title.trim()))
    return { ok: true, storeFound: true, answer: res.answer ?? '', citations }
  } catch (e) {
    return { ok: false, storeFound: false, answer: '', citations: [], reason: errMessage(e) }
  }
}
