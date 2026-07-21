// lib/videos/trade-script.test.ts
//
// Per-trade copy for the trust videos: the spoken noun that makes a script
// sound like the trade being quoted, and the visual scene that makes the
// footage look like it. Branding (logo, business name) is deliberately NOT in
// here — that stays identical across trades.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { tradeWorkNoun, tradeScene } from './trade-script'
import { MAX_SCRIPT_CHARS, defaultScript } from './trust-video'

const TRADES = [
  'electrical',
  'plumbing',
  'roofing',
  'signage',
  'painting',
  'commercial_painting',
  'aircon',
  'solar',
]

test('tradeWorkNoun reads naturally in "quality ___ built to last"', () => {
  assert.equal(tradeWorkNoun('roofing'), 'roofing')
  assert.equal(tradeWorkNoun('electrical'), 'electrical work')
  assert.equal(tradeWorkNoun('commercial_painting'), 'commercial painting')
  assert.equal(tradeWorkNoun('aircon'), 'air conditioning')
})

test('tradeWorkNoun accepts the hyphenated customer TradeKey', () => {
  assert.equal(tradeWorkNoun('commercial-painting'), 'commercial painting')
  assert.equal(tradeWorkNoun('roof'), 'roofing')
})

test('tradeWorkNoun falls back to a neutral noun for unknown or missing trades', () => {
  assert.equal(tradeWorkNoun('carpentry'), 'work')
  assert.equal(tradeWorkNoun(null), 'work')
  assert.equal(tradeWorkNoun(undefined), 'work')
})

test('every trade noun is short enough to keep the default script under the cap', () => {
  // The generator REJECTS a script over MAX_SCRIPT_CHARS, so a long trade noun
  // must never be able to push the default copy over.
  for (const t of TRADES) {
    assert.ok(tradeWorkNoun(t).length <= 20, `${t} noun too long: ${tradeWorkNoun(t)}`)
  }
  assert.ok(MAX_SCRIPT_CHARS >= 200)
})

test('tradeScene differs per trade and per slot', () => {
  const roofWelcome = tradeScene('roofing', 'welcome')
  const elecWelcome = tradeScene('electrical', 'welcome')
  const roofThanks = tradeScene('roofing', 'thankyou')
  assert.notEqual(roofWelcome, elecWelcome)
  assert.notEqual(roofWelcome, roofThanks)
  assert.ok(roofWelcome.length > 0)
})

test('tradeScene falls back to a generic Australian scene for unknown trades', () => {
  const scene = tradeScene('carpentry', 'welcome')
  assert.ok(scene.toLowerCase().includes('australian'))
  assert.equal(scene, tradeScene(null, 'welcome'))
})

test('no scene carries an exclamation mark, em-dash or emoji', () => {
  for (const t of [...TRADES, 'carpentry', null]) {
    for (const slot of ['welcome', 'thankyou'] as const) {
      const s = tradeScene(t, slot)
      assert.ok(!s.includes('!'), `${t}/${slot} has !`)
      assert.ok(!s.includes('—'), `${t}/${slot} has em-dash`)
      assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(s), `${t}/${slot} has emoji`)
    }
  }
})

// ── defaultScript gains the trade noun without breaking the old copy ──

test('defaultScript with no trade keeps the previous trade-neutral copy', () => {
  assert.ok(defaultScript('welcome', 'Bob Roofing', 'Bob').includes('just quality work built to last'))
})

test('defaultScript names the trade when one is given', () => {
  assert.ok(
    defaultScript('welcome', 'Bob Roofing', 'Bob', 'roofing').includes('quality roofing built to last'),
  )
  assert.ok(
    defaultScript('welcome', 'Sparky Co', 'Jo', 'electrical').includes(
      'quality electrical work built to last',
    ),
  )
})

test('every trade keeps the default welcome script within the cap', () => {
  for (const t of [...TRADES, null]) {
    for (const contact of ['Jonathan Peppermill', null]) {
      const s = defaultScript('welcome', 'A Fairly Long Business Name Pty Ltd', contact, t)
      assert.ok(s.length <= MAX_SCRIPT_CHARS, `${t}/${contact}: ${s.length} chars`)
    }
  }
})
