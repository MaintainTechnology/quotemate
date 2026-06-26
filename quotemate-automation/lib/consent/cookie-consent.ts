// Cookie-consent persistence for the marketing landing banner.
//
// Tiny, framework-free helpers so the show/hide decision is unit-testable
// without React or a DOM (vitest runs node-only — no jsdom). The banner
// records ONE choice (accept | reject) under `qm-cookie-consent`, mirroring
// the `qm-theme` persistence pattern in app/layout.tsx. The stored value is
// versioned so the banner can re-prompt if the cookie policy materially
// changes (bump CONSENT_VERSION → older stored consents read as absent).

export const CONSENT_STORAGE_KEY = "qm-cookie-consent"

// Bump when the cookie policy/categories change so a consent recorded under
// an older policy is treated as absent and the visitor is asked again.
export const CONSENT_VERSION = 1

export type ConsentChoice = "accepted" | "rejected"

export type ConsentRecord = {
  choice: ConsentChoice
  /** Policy version the choice was made under. */
  v: number
  /** ISO timestamp of when the choice was recorded. */
  ts: string
}

// A minimal subset of the Web Storage API — lets callers pass
// window.localStorage in the browser and an in-memory fake in tests.
export type ConsentStorage = Pick<Storage, "getItem" | "setItem">

// Read the stored consent. Returns null when there is no decision yet, the
// stored value is malformed, or it belongs to an older policy version (all
// of which mean: show the banner). Never throws — storage access can fail
// in private mode or when cookies/storage are blocked.
export function readConsent(
  storage: ConsentStorage | null | undefined,
): ConsentRecord | null {
  if (!storage) return null
  let raw: string | null
  try {
    raw = storage.getItem(CONSENT_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>
    if (
      (parsed.choice === "accepted" || parsed.choice === "rejected") &&
      parsed.v === CONSENT_VERSION &&
      typeof parsed.ts === "string"
    ) {
      return { choice: parsed.choice, v: parsed.v, ts: parsed.ts }
    }
    return null
  } catch {
    return null
  }
}

// Persist a consent choice. Returns the record written (handy for the UI) or
// null if storage was unavailable. Never throws.
export function writeConsent(
  storage: ConsentStorage | null | undefined,
  choice: ConsentChoice,
  now: string = new Date().toISOString(),
): ConsentRecord | null {
  if (!storage) return null
  const record: ConsentRecord = { choice, v: CONSENT_VERSION, ts: now }
  try {
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record))
    return record
  } catch {
    return null
  }
}

// Convenience: should the banner be shown? True when there is no valid,
// current-version decision on record.
export function shouldShowBanner(
  storage: ConsentStorage | null | undefined,
): boolean {
  return readConsent(storage) === null
}
