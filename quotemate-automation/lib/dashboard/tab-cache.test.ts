// Unit tests for the per-tab SWR-lite cache (specs/dashboard-performance.md R4).
// Pure logic, no React — same idiom as recent-activity.ts shouldRefresh: the
// caller passes timestamps, the module never reads the clock itself.

import { beforeEach, describe, expect, test } from 'vitest'
import {
  clearTabCache,
  isFresh,
  readTabCache,
  writeTabCache,
} from './tab-cache'

beforeEach(() => {
  clearTabCache()
})

describe('readTabCache / writeTabCache', () => {
  test('read of an unknown key returns null', () => {
    expect(readTabCache('chats')).toBeNull()
  })

  test('write then read returns the stored data and fetchedAt', () => {
    writeTabCache('chats', [{ id: 'c1' }], 1_000)
    expect(readTabCache<Array<{ id: string }>>('chats')).toEqual({
      data: [{ id: 'c1' }],
      fetchedAt: 1_000,
    })
  })

  test('write overwrites an existing key', () => {
    writeTabCache('chats', ['old'], 1_000)
    writeTabCache('chats', ['new'], 2_000)
    expect(readTabCache('chats')).toEqual({ data: ['new'], fetchedAt: 2_000 })
  })

  test('keys are independent', () => {
    writeTabCache('chats', ['a'], 1_000)
    expect(readTabCache('trade-jobs')).toBeNull()
  })
})

describe('isFresh', () => {
  test('null entry (never fetched) is not fresh', () => {
    expect(isFresh(null, 10_000)).toBe(false)
  })

  test('entry inside the 15s window is fresh', () => {
    expect(isFresh({ data: [], fetchedAt: 1_000 }, 15_999)).toBe(true)
  })

  test('entry at exactly the 15s boundary is stale (matches shouldRefresh >= semantics)', () => {
    expect(isFresh({ data: [], fetchedAt: 1_000 }, 16_000)).toBe(false)
  })

  test('entry past the window is stale', () => {
    expect(isFresh({ data: [], fetchedAt: 1_000 }, 60_000)).toBe(false)
  })

  test('custom maxAge is honoured', () => {
    expect(isFresh({ data: [], fetchedAt: 1_000 }, 5_000, 3_000)).toBe(false)
    expect(isFresh({ data: [], fetchedAt: 1_000 }, 3_999, 3_000)).toBe(true)
  })
})

describe('clearTabCache', () => {
  test('drops all entries', () => {
    writeTabCache('chats', ['a'], 1_000)
    writeTabCache('trade-jobs', ['b'], 1_000)
    clearTabCache()
    expect(readTabCache('chats')).toBeNull()
    expect(readTabCache('trade-jobs')).toBeNull()
  })
})
