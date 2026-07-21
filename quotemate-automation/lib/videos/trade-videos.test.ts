// lib/videos/trade-videos.test.ts
//
// Per-trade trust videos: a tenant keeps ONE welcome + ONE thank-you video per
// trade they have switched on, stored in the tenants.trade_videos jsonb keyed
// trade -> slot. These are the pure helpers that read/write that map and
// normalise the many trade spellings onto the canonical KNOWN_TRADES slug.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  normaliseVideoTrade,
  readTradeSlot,
  withTradeSlot,
  tradeVideoUrl,
  shouldAutoGenerateTrade,
} from './trade-videos'

// ── normaliseVideoTrade: every spelling collapses to a KNOWN_TRADES slug ──

test('normaliseVideoTrade maps the customer-surface TradeKey onto the storage slug', () => {
  // Customer surfaces use hyphens (lib/quote/trade-format TradeKey), tenants.trades[]
  // uses underscores (lib/admin/trades TradeSlug). This is the bridge.
  assert.equal(normaliseVideoTrade('commercial-painting'), 'commercial_painting')
  assert.equal(normaliseVideoTrade('commercial_painting'), 'commercial_painting')
})

test('normaliseVideoTrade collapses aliases and casing', () => {
  assert.equal(normaliseVideoTrade('roof'), 'roofing')
  assert.equal(normaliseVideoTrade('Roofing'), 'roofing')
  assert.equal(normaliseVideoTrade('  PAINT  '), 'painting')
  assert.equal(normaliseVideoTrade('hvac'), 'aircon')
  assert.equal(normaliseVideoTrade('electrical-estimation'), 'electrical')
})

test('normaliseVideoTrade returns null for unknown or empty input', () => {
  assert.equal(normaliseVideoTrade('carpentry'), null)
  assert.equal(normaliseVideoTrade(''), null)
  assert.equal(normaliseVideoTrade(null), null)
  assert.equal(normaliseVideoTrade(undefined), null)
})

// ── readTradeSlot / withTradeSlot: the (trade, slot) state machine ──

test('readTradeSlot returns an empty idle entry when nothing is stored', () => {
  assert.deepEqual(readTradeSlot(null, 'roofing', 'welcome'), {})
  assert.deepEqual(readTradeSlot({}, 'roofing', 'welcome'), {})
})

test('withTradeSlot writes one (trade, slot) without clobbering the others', () => {
  let map = withTradeSlot(null, 'roofing', 'welcome', { url: 'r-w.mp4', status: 'ready' })
  map = withTradeSlot(map, 'roofing', 'thankyou', { url: 'r-t.mp4', status: 'ready' })
  map = withTradeSlot(map, 'electrical', 'welcome', { url: 'e-w.mp4', status: 'ready' })

  assert.equal(readTradeSlot(map, 'roofing', 'welcome').url, 'r-w.mp4')
  assert.equal(readTradeSlot(map, 'roofing', 'thankyou').url, 'r-t.mp4')
  assert.equal(readTradeSlot(map, 'electrical', 'welcome').url, 'e-w.mp4')
  // Untouched combination stays empty.
  assert.deepEqual(readTradeSlot(map, 'electrical', 'thankyou'), {})
})

test('withTradeSlot merges into an existing entry and stamps updated_at', () => {
  const first = withTradeSlot(null, 'roofing', 'welcome', { status: 'generating', operation: 'op/1' })
  const second = withTradeSlot(first, 'roofing', 'welcome', { status: 'ready', url: 'done.mp4' })
  const entry = readTradeSlot(second, 'roofing', 'welcome')
  assert.equal(entry.status, 'ready')
  assert.equal(entry.url, 'done.mp4')
  assert.equal(entry.operation, 'op/1') // merged, not replaced
  assert.ok(typeof entry.updated_at === 'string' && entry.updated_at.length > 0)
})

test('withTradeSlot normalises the trade key so aliases share one entry', () => {
  const map = withTradeSlot(null, 'roof', 'welcome', { url: 'r.mp4' })
  assert.equal(readTradeSlot(map, 'roofing', 'welcome').url, 'r.mp4')
})

test('withTradeSlot leaves the map untouched for an unknown trade', () => {
  const map = withTradeSlot(null, 'carpentry', 'welcome', { url: 'x.mp4' })
  assert.deepEqual(map, {})
})

// ── tradeVideoUrl: the per-trade url lookup ──

test('tradeVideoUrl returns the stored url for that trade and slot', () => {
  const map = withTradeSlot(null, 'plumbing', 'thankyou', { url: 'p-t.mp4', status: 'ready' })
  assert.equal(tradeVideoUrl(map, 'plumbing', 'thankyou'), 'p-t.mp4')
})

test('tradeVideoUrl returns null when that trade has no video for the slot', () => {
  const map = withTradeSlot(null, 'plumbing', 'welcome', { url: 'p-w.mp4' })
  assert.equal(tradeVideoUrl(map, 'plumbing', 'thankyou'), null)
  assert.equal(tradeVideoUrl(map, 'roofing', 'welcome'), null)
  assert.equal(tradeVideoUrl(null, 'roofing', 'welcome'), null)
})

test('tradeVideoUrl ignores a blank url so it falls through to the tenant default', () => {
  const map = withTradeSlot(null, 'solar', 'welcome', { url: '   ', status: 'failed' })
  assert.equal(tradeVideoUrl(map, 'solar', 'welcome'), null)
})


// ── shouldAutoGenerateTrade: never clobber real content ──

test('shouldAutoGenerateTrade is true when a trade has nothing for the slot', () => {
  assert.equal(shouldAutoGenerateTrade(null, 'roofing', 'welcome'), true)
  assert.equal(shouldAutoGenerateTrade({}, 'roofing', 'welcome'), true)
})

test('shouldAutoGenerateTrade is false once a real video exists', () => {
  const map = withTradeSlot(null, 'roofing', 'welcome', { url: 'r.mp4', status: 'ready' })
  assert.equal(shouldAutoGenerateTrade(map, 'roofing', 'welcome'), false)
})

test('shouldAutoGenerateTrade is false while a job is in flight or ready', () => {
  const gen = withTradeSlot(null, 'solar', 'welcome', { status: 'generating', operation: 'op/1' })
  assert.equal(shouldAutoGenerateTrade(gen, 'solar', 'welcome'), false)
  const ready = withTradeSlot(null, 'solar', 'thankyou', { status: 'ready' })
  assert.equal(shouldAutoGenerateTrade(ready, 'solar', 'thankyou'), false)
})

test('shouldAutoGenerateTrade RETRIES a failed or idle slot', () => {
  const failed = withTradeSlot(null, 'plumbing', 'welcome', { status: 'failed', error: 'rai' })
  assert.equal(shouldAutoGenerateTrade(failed, 'plumbing', 'welcome'), true)
  const idle = withTradeSlot(null, 'plumbing', 'thankyou', { status: 'idle' })
  assert.equal(shouldAutoGenerateTrade(idle, 'plumbing', 'thankyou'), true)
})

test('shouldAutoGenerateTrade is per trade and per slot', () => {
  const map = withTradeSlot(null, 'roofing', 'welcome', { url: 'r.mp4', status: 'ready' })
  assert.equal(shouldAutoGenerateTrade(map, 'roofing', 'thankyou'), true)
  assert.equal(shouldAutoGenerateTrade(map, 'electrical', 'welcome'), true)
})
