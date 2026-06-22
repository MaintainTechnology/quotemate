// The ONE shared archive+ingest helper (spec 2026-06-19, R8/R9/R10/R12/R13/R15).
//
// Called post-ack (inside next/server `after()`) from every per-trade finalize
// hook and the invoice route. Contract:
//   • The CALLER has already archived the FULL, unredacted document to Supabase
//     Storage (a quote `ensure*Pdf` path, or the invoice route's raw-image
//     upload) and passes its `fullDocPath`.
//   • The CALLER has built the PII-minimized `kbText` via lib/filestore/minimize.
//   • This helper uploads ONLY that minimized markdown to the tenant's Gemini
//     store, and records a `tenant_file_documents` row.
//
// Guarantees:
//   • Best-effort — never throws, never blocks the quote/invoice pipeline.
//   • Flag-gated — STUBs when TENANT_FILESTORE_ENABLED !== 'true'.
//   • Lockstep — no KB ingest without an archived full doc (`fullDocPath`).
//   • Idempotent — dedup by (tenant_id, display_name); identical content_hash is
//     skipped; a material re-draft (changed content_hash) replaces the stale KB
//     doc. DB-state-independent: the Supabase archive stands even if these DB
//     writes fail.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { pipelineLog } from '@/lib/log/pipeline'
import {
  isKbActiveState,
  kbDeleteDocument,
  loadKbConfigFromEnv,
  type KbConfig,
  type KbFetch,
} from '../admin-loader/mt-filestore-kb'
import { quoteDocDisplayName } from './tenant-store-name'
import { addDocumentToTenantStore, ensureTenantStore } from './tenant-store'

export type TenantFileDocRow = {
  tenant_id: string
  source_kind: 'quote' | 'invoice'
  source_id: string
  trade: string | null
  display_name: string
  storage_path: string | null
  kb_document_id: string | null
  state: 'pending' | 'active' | 'failed' | 'skipped'
  skip_reason?: string | null
  bytes?: number | null
  error?: string | null
  attempts?: number
  content_hash?: string | null
  updated_at?: string
}

/** Minimal DB surface for the tracking table — injectable for tests. */
export interface TenantFileDocsRepo {
  find(tenantId: string, displayName: string): Promise<TenantFileDocRow | null>
  /** Upsert on (tenant_id, display_name). */
  save(row: TenantFileDocRow): Promise<void>
}

export type IngestDeps = {
  repo?: TenantFileDocsRepo
  env?: NodeJS.ProcessEnv
  config?: KbConfig
  fetchImpl?: KbFetch
  /** Override now() for deterministic tests. */
  nowIso?: string
}

export type ArchiveAndIngestArgs = {
  tenantId: string | null | undefined
  sourceKind: 'quote' | 'invoice'
  sourceId: string
  trade?: string | null
  /** Supabase path of the full, unredacted doc the caller already archived. */
  fullDocPath: string | null
  /** PII-minimized markdown (string or utf-8 bytes) — the ONLY thing sent to KB. */
  kbText: string | Uint8Array
  contentHash?: string | null
  /** Informational: the caller already reflected this in kbText. */
  pricesHidden?: boolean
}

let _client: SupabaseClient | null = null
function serviceClient(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

/** Default Supabase-backed repo (service role; bypasses RLS). */
function defaultRepo(): TenantFileDocsRepo {
  return {
    async find(tenantId, displayName) {
      const { data } = await serviceClient()
        .from('tenant_file_documents')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('display_name', displayName)
        .maybeSingle<TenantFileDocRow>()
      return data ?? null
    },
    async save(row) {
      const { error } = await serviceClient()
        .from('tenant_file_documents')
        .upsert(row, { onConflict: 'tenant_id,display_name' })
      if (error) throw new Error(error.message ?? String(error))
    },
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function resolveConfig(deps?: IngestDeps): KbConfig | null {
  if (deps?.config) return deps.config
  try {
    return loadKbConfigFromEnv()
  } catch {
    return null
  }
}

/**
 * Archive (already done by caller) + ingest one document into the tenant store.
 * Never throws.
 */
export async function archiveAndIngestQuote(
  args: ArchiveAndIngestArgs,
  deps?: IngestDeps,
): Promise<void> {
  const env = deps?.env ?? process.env
  const log = pipelineLog('filestore')
  const { tenantId, sourceKind, sourceId, trade, fullDocPath } = args

  // Orphan rows (no tenant) — pure no-op.
  if (!tenantId) {
    log.ok('skip:no-tenant', { sourceKind, sourceId })
    return
  }
  // Flag off — STUB (no KB calls, no rows).
  if (env.TENANT_FILESTORE_ENABLED !== 'true') return

  let displayName: string
  try {
    displayName = quoteDocDisplayName({ sourceKind, trade, sourceId })
  } catch (e) {
    log.err('skip:bad-display-name', e, { sourceKind, sourceId })
    return
  }

  const kbStr = typeof args.kbText === 'string' ? args.kbText : new TextDecoder().decode(args.kbText)
  const bytes = typeof args.kbText === 'string' ? new TextEncoder().encode(args.kbText) : args.kbText

  const repo = deps?.repo ?? defaultRepo()
  const nowIso = deps?.nowIso ?? new Date().toISOString()
  const contentHash = args.contentHash ?? null

  // R12: persist an auditable 'skipped' row on a no-op skip path so skips are
  // visible in tenant_file_documents, not just logs — but NEVER clobber a doc
  // that already ingested successfully (active/pending).
  const recordSkip = async (reason: string) => {
    try {
      const prior = await repo.find(tenantId, displayName)
      if (prior && (prior.state === 'active' || prior.state === 'pending')) return
      await repo.save({
        tenant_id: tenantId,
        source_kind: sourceKind,
        source_id: sourceId,
        trade: trade ?? null,
        display_name: displayName,
        storage_path: fullDocPath ?? null,
        kb_document_id: prior?.kb_document_id ?? null,
        state: 'skipped',
        skip_reason: reason,
        content_hash: contentHash,
        attempts: prior?.attempts ?? 0,
        updated_at: nowIso,
      })
    } catch (e) {
      log.err('skip-row save failed', e, { displayName })
    }
  }

  if (!kbStr.trim()) {
    log.ok('skip:empty-kbtext', { displayName })
    await recordSkip('empty-kbtext')
    return
  }
  // Lockstep: no KB ingest without an archived full doc.
  if (!fullDocPath) {
    log.ok('skip:no-full-doc', { displayName })
    await recordSkip('no-full-doc')
    return
  }

  // Existing row → dedup / material-re-draft decision.
  let existing: TenantFileDocRow | null = null
  try {
    existing = await repo.find(tenantId, displayName)
  } catch (e) {
    log.err('repo.find failed (continuing)', e, { displayName })
  }
  if (existing && existing.state === 'active' && existing.content_hash && existing.content_hash === contentHash) {
    log.ok('dedup:unchanged', { displayName })
    return
  }

  const base: TenantFileDocRow = {
    tenant_id: tenantId,
    source_kind: sourceKind,
    source_id: sourceId,
    trade: trade ?? null,
    display_name: displayName,
    storage_path: fullDocPath,
    kb_document_id: existing?.kb_document_id ?? null,
    state: 'pending',
    bytes: bytes.byteLength,
    content_hash: contentHash,
    attempts: existing?.attempts ?? 0,
    updated_at: nowIso,
  }

  // Record the archive immediately (best-effort; archive itself already done).
  try {
    await repo.save(base)
  } catch (e) {
    log.err('row save (pending) failed', e, { displayName })
    // DB-state-independent: the full doc is already archived; continue to KB.
  }

  // Ensure the tenant's store (lazy safety net).
  const storeId = await ensureTenantStore(tenantId, null, { config: deps?.config, fetchImpl: deps?.fetchImpl })
  if (!storeId) {
    log.err('no store (KB unavailable) — left pending', undefined, { displayName })
    return // reconcile cron will retry
  }

  // Material re-draft: drop the stale KB doc before re-uploading.
  const isReplace = !!(existing?.kb_document_id && existing.content_hash && existing.content_hash !== contentHash)
  if (isReplace) {
    const cfg = resolveConfig(deps)
    if (cfg) {
      try {
        await kbDeleteDocument(cfg, existing!.kb_document_id!, deps?.fetchImpl)
        log.ok('replaced:deleted-stale', { displayName })
      } catch (e) {
        log.err('stale kb doc delete failed (continuing)', e, { displayName })
      }
    }
  }

  // Upload the PII-minimized markdown (never the PDF/image). On a REPLACE, skip
  // the displayName dedup: Gemini deletes aren't strongly consistent, so the
  // dedup list could still show the just-deleted doc and wrongly skip the
  // re-upload — leaving the tracking row pointing at a deleted id.
  const res = await addDocumentToTenantStore(
    { tenantId, storeId, fileBytes: bytes, displayName, mimeType: 'text/markdown', skipDedup: isReplace },
    { config: deps?.config, fetchImpl: deps?.fetchImpl },
  )

  if (res?.kbDocumentId) {
    // The upload (and name-recovery) polls Gemini's operation to completion, so
    // a small markdown doc is usually already STATE_ACTIVE here — record that
    // directly. If it's still indexing, stay 'pending' and let the reconcile
    // cron flip it once kbListDocuments reports active.
    const state = isKbActiveState(res.state) ? 'active' : 'pending'
    try {
      await repo.save({ ...base, kb_document_id: res.kbDocumentId, state, updated_at: nowIso })
    } catch (e) {
      log.err('row save (uploaded) failed', e, { displayName })
    }
    log.ok('ingested', { displayName, bytes: bytes.byteLength, state })
  } else {
    try {
      await repo.save({ ...base, state: 'failed', error: 'kb upload failed', updated_at: nowIso })
    } catch (e) {
      log.err('row save (failed) failed', e, { displayName })
    }
    log.err('kb upload failed — row failed', undefined, { displayName })
  }
}
