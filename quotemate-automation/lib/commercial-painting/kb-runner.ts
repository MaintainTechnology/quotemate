// ════════════════════════════════════════════════════════════════════
// lib/commercial-painting/kb-runner.ts
//
// Orchestrates the per-session TEMPORARY mt-filestore-kb store used to
// supplement a commercial-paint takeoff from the tradie's own uploaded
// PDFs. Lifecycle (all best-effort, store ALWAYS torn down):
//
//   create store → upload PDFs → wait for indexing → grounded search
//   → parse + apply (hybrid merge) → finally: delete the whole store.
//
// Any failure degrades to "no supplement": the original reconciled items
// are returned untouched and the extraction proceeds. The temp store is
// deleted in a `finally`, including on the error path, so nothing leaks.
//
// Network + clock are injected (`deps`) so this is unit-tested without
// hitting the live service.
// ════════════════════════════════════════════════════════════════════

import {
  kbCreateStore,
  kbDeleteStore,
  kbListDocuments,
  kbSearch,
  kbUploadDocument,
  type KbConfig,
  type KbFetch,
} from '../admin-loader/mt-filestore-kb'
import {
  applyPaintSupplement,
  buildPaintSupplementQuery,
  parsePaintSupplementFindings,
  type PaintSupplementFlag,
} from './kb-supplement'
import type { PaintTakeoffItem } from './types'

export type KbSupplementFile = {
  name: string
  bytes: Buffer | Uint8Array
  mime?: string
}

export type SupplementTakeoffArgs = {
  config: KbConfig
  items: PaintTakeoffItem[]
  jobHint?: string
  /** Display name for the temporary store, e.g. `paint-temp-<runId>`. */
  displayName: string
  files: KbSupplementFile[]
  /** Optional Gemini model override for the search step. */
  model?: string
  deps?: {
    fetchImpl?: KbFetch
    sleep?: (ms: number) => Promise<void>
    /** Total budget to wait for document indexing (default 90s). */
    maxIndexWaitMs?: number
    /** Poll interval (default 2.5s). */
    pollIntervalMs?: number
  }
}

export type SupplementTakeoffResult = {
  items: PaintTakeoffItem[]
  flags: PaintSupplementFlag[]
  usedKb: boolean
  storeName?: string
}

const DEFAULT_MAX_INDEX_WAIT_MS = 90_000
const DEFAULT_POLL_INTERVAL_MS = 2_500

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toUploadFile(f: KbSupplementFile): Blob & { name?: string } {
  const type = f.mime ?? 'application/pdf'
  // Buffer/Uint8Array are valid BlobParts at runtime; the cast sidesteps
  // the ArrayBufferLike vs ArrayBuffer friction in the lib.dom types.
  const part = f.bytes as unknown as BlobPart
  return new File([part], f.name, { type })
}

/** Poll until no document is still `processing`, bounded by an attempt
 *  count derived from the wait budget (deterministic under an injected
 *  no-op sleep). Best-effort: returns regardless once ready or exhausted. */
async function waitForIndexing(
  config: KbConfig,
  storeId: string,
  deps: { fetchImpl?: KbFetch; sleep: (ms: number) => Promise<void>; maxIndexWaitMs: number; pollIntervalMs: number },
): Promise<void> {
  const attempts = Math.max(1, Math.ceil(deps.maxIndexWaitMs / Math.max(1, deps.pollIntervalMs)))
  for (let i = 0; i < attempts; i++) {
    const docs = await kbListDocuments(config, storeId, deps.fetchImpl)
    const stillProcessing = docs.some((d) => d.state === 'processing')
    if (docs.length > 0 && !stillProcessing) return
    if (i < attempts - 1) await deps.sleep(deps.pollIntervalMs)
  }
}

/**
 * Run the temporary-store supplement pass. NEVER throws; on any failure
 * returns the original items with `usedKb:false`. ALWAYS deletes the temp
 * store it created (force).
 */
export async function supplementTakeoffViaKb(
  args: SupplementTakeoffArgs,
): Promise<SupplementTakeoffResult> {
  const { config, items, jobHint, displayName, files, model } = args
  const fetchImpl = args.deps?.fetchImpl
  const sleep = args.deps?.sleep ?? realSleep
  const maxIndexWaitMs = args.deps?.maxIndexWaitMs ?? DEFAULT_MAX_INDEX_WAIT_MS
  const pollIntervalMs = args.deps?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  if (!Array.isArray(files) || files.length === 0) {
    return { items, flags: [], usedKb: false }
  }

  let storeName: string | undefined
  try {
    const store = await kbCreateStore(config, { displayName }, fetchImpl)
    storeName = store.name
    if (!storeName) return { items, flags: [], usedKb: false }

    for (const f of files) {
      await kbUploadDocument(
        config,
        { storeId: storeName, file: toUploadFile(f), displayName: f.name },
        fetchImpl,
      )
    }

    await waitForIndexing(config, storeName, { fetchImpl, sleep, maxIndexWaitMs, pollIntervalMs })

    const res = await kbSearch(
      config,
      { store: storeName, query: buildPaintSupplementQuery(items, jobHint), ...(model ? { model } : {}) },
      fetchImpl,
    )
    const findings = parsePaintSupplementFindings(res.answer)
    const applied = applyPaintSupplement(items, findings)
    return { items: applied.items, flags: applied.flags, usedKb: true, storeName }
  } catch {
    // Best-effort: degrade to the un-supplemented takeoff.
    return { items, flags: [], usedKb: false, storeName }
  } finally {
    if (storeName) {
      try {
        await kbDeleteStore(config, storeName, { force: true }, fetchImpl)
      } catch {
        // Swallow — a cleanup failure must not surface as an extraction error.
      }
    }
  }
}
