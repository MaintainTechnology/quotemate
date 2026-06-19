// Persistent, per-TENANT Gemini File Search store (spec 2026-06-19).
//
// The per-tradie counterpart to the per-session estimator-chatbot store
// (lib/filestore/session-store.ts): every tenant gets ONE lasting store that
// accumulates the PII-minimized markdown summaries of all their quotes +
// invoices. The store is addressed by a deterministic display name derived
// from the tenant UUID (tenant-store-name.ts), so it is found-or-created
// idempotently even if `tenants.file_store_id` is ever lost.
//
// Everything here is best-effort and NEVER throws into the quote pipeline
// (mirrors addDocumentsToSessionStore). The KB HTTP client's `fetch` and the
// resolved KbConfig are injectable so this is fully unit-testable offline.
//
// PRIVACY: `addDocumentToTenantStore` uploads `text/markdown` ONLY — the
// caller (ingest-quote.ts) passes PII-minimized bytes from minimize.ts. The
// customer PDF/raw image is never passed here.

import {
  kbCreateStore,
  kbListDocuments,
  kbListStores,
  kbSearch,
  kbUploadDocument,
  loadKbConfigFromEnv,
  type KbConfig,
  type KbFetch,
  type KbSearchResult,
} from '../admin-loader/mt-filestore-kb'
import { displayNameMatchesTenant, tenantStoreDisplayName } from './tenant-store-name'

/**
 * The per-tenant chatbot/grounding framing. Generalises the upstream service's
 * default signage-compliance persona: here the indexed docs are ONE tradie
 * business's own past jobs (minimized quote + invoice summaries).
 */
export const TENANT_KB_SYSTEM = `You are the QuoteMate Business Assistant for ONE tradie business. The documents indexed in this File Search store are that business's own past work: privacy-minimized summaries of the quotes they sent customers and the invoices they uploaded (job type, scope, line items, quantities and prices — customer personal details are deliberately omitted).

Your job is to help the tradie (or QuoteMate's estimator) understand and reuse their own pricing history:
- Answer only from the indexed documents. Treat them as the single source of truth and cite the document (its title/displayName) you drew each figure from.
- When asked what they charged for a job type, summarise the relevant past quotes/invoices with their figures.
- If the indexed documents do not cover what was asked, say so plainly rather than guessing. Never invent a price, quantity or job that is not in the documents.
- Prices are in Australian dollars; state inc/ex GST as the document does.
- These summaries omit customer names and contact details by design — do not speculate about who a customer was.`

export type TenantStoreDeps = {
  /** Pre-resolved KB config (tests inject a fake). Defaults to loadKbConfigFromEnv(). */
  config?: KbConfig
  /** Injected fetch for the KB client (tests mock the network). */
  fetchImpl?: KbFetch
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Resolve KbConfig from deps or env; null when env is unset (→ caller STUBs). */
function resolveConfig(deps?: TenantStoreDeps): KbConfig | null {
  if (deps?.config) return deps.config
  try {
    return loadKbConfigFromEnv()
  } catch {
    return null
  }
}

/**
 * Find-or-create the tenant's store by its deterministic display name. Returns
 * the full `fileSearchStores/...` name, or null when the KB is unavailable.
 * Never throws.
 */
export async function ensureTenantStore(
  tenantId: string,
  businessName?: string | null,
  deps?: TenantStoreDeps,
): Promise<string | null> {
  const config = resolveConfig(deps)
  if (!config || !tenantId) return null
  try {
    const stores = await kbListStores(config, deps?.fetchImpl)
    const existing = stores.find((s) => displayNameMatchesTenant(s.displayName, tenantId))
    if (existing?.name) return existing.name
    const created = await kbCreateStore(
      config,
      { displayName: tenantStoreDisplayName(tenantId, businessName) },
      deps?.fetchImpl,
    )
    return created?.name ?? null
  } catch (e) {
    console.error('[filestore/tenant-store] ensureTenantStore failed (non-fatal):', errMsg(e))
    return null
  }
}

export type AddTenantDocResult = { kbDocumentId: string } | null

/**
 * Upload one PII-minimized markdown doc into the tenant's store, de-duplicating
 * by `displayName` (an already-indexed doc is returned, not re-uploaded). Never
 * throws. `mimeType` is always text/markdown — a PDF/image must never reach here.
 */
export async function addDocumentToTenantStore(
  args: {
    tenantId: string
    storeId: string
    fileBytes: Uint8Array | Buffer
    displayName: string
    mimeType?: string
    /** Skip the displayName dedup check. Set on a material-re-draft REPLACE,
     *  where the caller already deleted the stale doc — Gemini deletes are not
     *  strongly consistent, so a dedup list could still return the just-deleted
     *  id and wrongly skip the re-upload. */
    skipDedup?: boolean
  },
  deps?: TenantStoreDeps,
): Promise<AddTenantDocResult> {
  const config = resolveConfig(deps)
  if (!config) return null
  const { storeId, fileBytes, displayName } = args
  if (!storeId || !displayName || !fileBytes || (fileBytes as Uint8Array).byteLength === 0) return null

  try {
    // Dedup: if a doc with this displayName already exists, return its id.
    if (!args.skipDedup) {
      try {
        const docs = await kbListDocuments(config, storeId, deps?.fetchImpl)
        const match = docs.find((d) => (d.displayName ?? '').trim() === displayName)
        if (match?.name) return { kbDocumentId: match.name }
      } catch {
        // dedup is best-effort — fall through and upload (risk a dup over a drop)
      }
    }

    const file = new File([fileBytes as unknown as BlobPart], `${displayName}.md`, {
      type: args.mimeType ?? 'text/markdown',
    })
    const doc = await kbUploadDocument(config, { storeId, file, displayName }, deps?.fetchImpl)
    return doc?.name ? { kbDocumentId: doc.name } : null
  } catch (e) {
    console.error('[filestore/tenant-store] addDocumentToTenantStore failed (non-fatal):', errMsg(e))
    return null
  }
}

/**
 * Answer a question grounded in the tenant's store. Returns an empty result
 * when the KB is unavailable; otherwise propagates the KbSearchResult. Callers
 * (P2 chat / P3 grounding) wrap this in their own try/catch for friendly states.
 */
export async function searchTenantStore(
  args: {
    storeId: string
    query: string
    systemInstruction?: string
    metadataFilter?: string
  },
  deps?: TenantStoreDeps,
): Promise<KbSearchResult> {
  const config = resolveConfig(deps)
  if (!config || !args.storeId || !args.query) {
    return { answer: '', passages: [], raw: null }
  }
  // Never throws: a KB/network error degrades to an empty result so callers
  // (P2 chat, P3 grounding) get a friendly empty state, not an exception.
  try {
    return await kbSearch(
      config,
      {
        store: args.storeId,
        query: args.query,
        systemInstruction: args.systemInstruction ?? TENANT_KB_SYSTEM,
        ...(args.metadataFilter ? { metadataFilter: args.metadataFilter } : {}),
      },
      deps?.fetchImpl,
    )
  } catch (e) {
    console.error('[filestore/tenant-store] searchTenantStore failed (non-fatal):', errMsg(e))
    return { answer: '', passages: [], raw: null }
  }
}
