// Unit tests for the cookie-consent storage helpers.
//
// vitest runs node-only (no jsdom), so we inject an in-memory Storage rather
// than relying on window.localStorage. These cover the show/hide decision,
// versioned round-trips, and the never-throw guarantees the UI depends on.

import { describe, expect, it } from "vitest"
import {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  readConsent,
  shouldShowBanner,
  writeConsent,
  type ConsentStorage,
} from "./cookie-consent"

// In-memory Storage stand-in. `_map` is exposed so a test can assert the
// exact raw bytes that were persisted.
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  const store: ConsentStorage & { _map: Map<string, string> } = {
    _map: map,
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v)
    },
  }
  return store
}

// Storage whose access always throws — emulates private-mode / blocked
// storage so we can prove the helpers swallow it.
const throwingStorage: ConsentStorage = {
  getItem: () => {
    throw new Error("blocked")
  },
  setItem: () => {
    throw new Error("blocked")
  },
}

const TS = "2026-06-26T00:00:00.000Z"

describe("cookie-consent storage", () => {
  it("returns null and shows the banner when nothing is stored", () => {
    const s = memoryStorage()
    expect(readConsent(s)).toBeNull()
    expect(shouldShowBanner(s)).toBe(true)
  })

  it("persists an accept choice as versioned JSON", () => {
    const s = memoryStorage()
    const rec = writeConsent(s, "accepted", TS)
    expect(rec).toEqual({ choice: "accepted", v: CONSENT_VERSION, ts: TS })
    expect(JSON.parse(s._map.get(CONSENT_STORAGE_KEY) as string)).toEqual(rec)
  })

  it("round-trips a reject choice and hides the banner afterwards", () => {
    const s = memoryStorage()
    writeConsent(s, "rejected", TS)
    expect(readConsent(s)).toEqual({
      choice: "rejected",
      v: CONSENT_VERSION,
      ts: TS,
    })
    expect(shouldShowBanner(s)).toBe(false)
  })

  it("ignores a stored consent from an older policy version", () => {
    const s = memoryStorage({
      [CONSENT_STORAGE_KEY]: JSON.stringify({
        choice: "accepted",
        v: CONSENT_VERSION - 1,
        ts: TS,
      }),
    })
    expect(readConsent(s)).toBeNull()
    expect(shouldShowBanner(s)).toBe(true)
  })

  it("ignores malformed or unknown stored values", () => {
    expect(
      readConsent(memoryStorage({ [CONSENT_STORAGE_KEY]: "not json" })),
    ).toBeNull()
    expect(
      readConsent(
        memoryStorage({
          [CONSENT_STORAGE_KEY]: JSON.stringify({
            choice: "maybe",
            v: CONSENT_VERSION,
            ts: TS,
          }),
        }),
      ),
    ).toBeNull()
  })

  it("never throws when storage access is blocked", () => {
    expect(readConsent(throwingStorage)).toBeNull()
    expect(writeConsent(throwingStorage, "accepted")).toBeNull()
    expect(shouldShowBanner(throwingStorage)).toBe(true)
  })

  it("treats a missing storage object as undecided", () => {
    expect(readConsent(null)).toBeNull()
    expect(writeConsent(null, "accepted")).toBeNull()
    expect(shouldShowBanner(undefined)).toBe(true)
  })
})
