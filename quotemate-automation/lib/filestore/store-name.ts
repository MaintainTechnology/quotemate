// Deterministic naming for the per-session Gemini File Search stores that back
// the estimator chatbot. Every upload session (a paint measurement or an
// electrical intake) gets ONE dedicated store, named so that:
//   1. it is reproducible from (estimator, sessionId) alone — the same session
//      always maps to the same canonical key, so we can find-or-create
//      idempotently even if the stored id is ever lost;
//   2. it is human-readable in the KB console — an optional label (customer or
//      tradie name) is appended after the stable key;
//   3. it fits Gemini's 128-char displayName limit.
//
// Pure string helpers — no I/O, unit-tested.

export type EstimatorKind = 'paint' | 'electrical'

const PREFIX = 'qm'
// Exported (per spec 2026-06-19 tenant-file-store, R3) so tenant-store-name.ts
// can reuse the identical slug + cap as the single source of truth rather than
// re-implementing them.
export const MAX_DISPLAY_NAME = 128

/** Lowercase, collapse to [a-z0-9-], trim dashes. Keeps ids/names URL- and
 *  console-friendly without losing their identity. */
export function slug(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The stable identity of a session's store. Same (estimator, sessionId) always
 * yields the same key — this is what `findStoreByDisplayName` matches on, so
 * the store is found again even without the persisted id.
 */
export function sessionStoreKey(estimator: EstimatorKind, sessionId: string): string {
  const id = slug(sessionId)
  if (!id) throw new Error('sessionStoreKey: a non-empty sessionId is required')
  return `${PREFIX}-${estimator}-${id}`.slice(0, MAX_DISPLAY_NAME)
}

/**
 * The store's displayName: the stable key, plus a friendly label (customer or
 * tradie name) when one is known. The key is always the head of the string so
 * `startsWith(key)` still identifies the session even with a label appended.
 */
export function sessionStoreDisplayName(
  estimator: EstimatorKind,
  sessionId: string,
  label?: string | null,
): string {
  const key = sessionStoreKey(estimator, sessionId)
  const friendly = label ? slug(label) : ''
  if (!friendly) return key
  // " · <label>" reads nicely in the console; truncate to the 128 limit while
  // never cutting into the key (the key alone is always < 128).
  return `${key} ${friendly}`.slice(0, MAX_DISPLAY_NAME)
}

/** True when `displayName` belongs to the given session (key match, label-tolerant). */
export function displayNameMatchesSession(
  displayName: string | undefined | null,
  estimator: EstimatorKind,
  sessionId: string,
): boolean {
  if (!displayName) return false
  const key = sessionStoreKey(estimator, sessionId)
  return displayName === key || displayName.startsWith(`${key} `)
}

/** A Gemini store resource name is `fileSearchStores/<id>`; return the bare id.
 *  Path-param endpoints (upload, documents) need the bare id, not the slashed
 *  resource name. Accepts either form. */
export function bareStoreId(nameOrId: string): string {
  const value = String(nameOrId ?? '').trim()
  if (!value) throw new Error('bareStoreId: a store name or id is required')
  return value.includes('/') ? value.split('/').pop()! : value
}
