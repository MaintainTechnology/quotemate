// Deterministic naming for the per-TENANT Gemini File Search stores (spec
// 2026-06-19 tenant-file-store). This is the per-tradie counterpart to the
// per-session naming in store-name.ts: every tenant gets ONE lasting store,
// addressed by a display name derived from the tenant UUID alone so it can be
// found-or-created idempotently even if the persisted id is ever lost.
//
// Reuses the identical slug + 128-char cap from store-name.ts (exported there
// in this PR) — single source of truth, no re-implementation.
//
// Pure string helpers — no I/O, unit-tested.

import { slug, MAX_DISPLAY_NAME, bareStoreId } from './store-name'

export { bareStoreId }

const PREFIX = 'qm-tenant'

/**
 * Stable identity of a tenant's store. Same tenantId always yields the same
 * key — this is what `displayNameMatchesTenant` matches on, so the store is
 * found again even without the persisted `tenants.file_store_id`.
 */
export function tenantStoreKey(tenantId: string): string {
  const id = slug(tenantId)
  if (!id) throw new Error('tenantStoreKey: a non-empty tenantId is required')
  return `${PREFIX}-${id}`.slice(0, MAX_DISPLAY_NAME)
}

/**
 * The store's displayName: the stable key, plus a friendly label (business
 * name) when known. The key is always the head so `startsWith(key)` still
 * identifies the tenant even with a label appended. The label is decorative —
 * the key (tenant UUID) is the identity, so a business rename never orphans
 * the store.
 */
export function tenantStoreDisplayName(tenantId: string, businessName?: string | null): string {
  const key = tenantStoreKey(tenantId)
  const friendly = businessName ? slug(businessName) : ''
  if (!friendly) return key
  return `${key} ${friendly}`.slice(0, MAX_DISPLAY_NAME)
}

/** True when `displayName` belongs to the given tenant (key match, label-tolerant). */
export function displayNameMatchesTenant(
  displayName: string | null | undefined,
  tenantId: string,
): boolean {
  if (!displayName) return false
  const key = tenantStoreKey(tenantId)
  return displayName === key || displayName.startsWith(`${key} `)
}

// ── Per-document display-name conventions (spec conventions table) ──────
//
// commercial-painting and residential painting both map to the `painting`
// trade slug; roofing/solar keep their own. electrical/plumbing keep theirs.
const TRADE_ALIAS: Record<string, string> = {
  'commercial-painting': 'painting',
  commercial_painting: 'painting',
}

/** Normalise a trade label to the slug used in document display names. */
export function normalizeTradeForDoc(trade?: string | null): string {
  const t = (trade ?? '').toLowerCase().trim()
  if (!t) return 'job'
  if (TRADE_ALIAS[t]) return TRADE_ALIAS[t]
  if (t.includes('paint')) return 'painting'
  return t
}

/**
 * The deterministic, extension-free `tenant_file_documents.display_name` for a
 * document. Quotes → `quote-<trade>-<sourceId>`; invoices → `invoice-<id>`.
 * `sourceId` is a uuid for electrical/plumbing/invoice and a public_token for
 * roofing/solar/painting (the conventions table). The value is what KB dedup
 * and the UNIQUE (tenant_id, display_name) constraint key on, so it MUST be
 * deterministic for a given source.
 */
export function quoteDocDisplayName(args: {
  sourceKind: 'quote' | 'invoice'
  trade?: string | null
  sourceId: string
}): string {
  const id = String(args.sourceId ?? '').trim()
  if (!id) throw new Error('quoteDocDisplayName: a non-empty sourceId is required')
  if (args.sourceKind === 'invoice') return `invoice-${id}`.slice(0, MAX_DISPLAY_NAME)
  return `quote-${normalizeTradeForDoc(args.trade)}-${id}`.slice(0, MAX_DISPLAY_NAME)
}
