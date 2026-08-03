// The live hijack of 2026-08-03 — an ELECTRICAL enquiry answered by the
// ROOFING receptionist, ending in a $99 roofing inspection.
//
// The transcript, verbatim from the customer's side:
//   "Can I have some downlights put in"          → electrical, correctly
//   "Jon" / "Chandler" / "16 downlights on my verandah"
//                                                → electrical dialog gathering
//   "It's a 125mm insulated panel roofing. The cable has been run already."
//                                                → ⚠ HIJACKED
//   → "Sorry, I can't find '125mm insulated panel roofing…' on the map."
//   "New downlights."                            → ignored
//   "No I need new downlights"                   → ignored
//   → "we'll arrange a quick on-site inspection … Reply YES"
//
// TWO SEPARATE DEFECTS, and the second is why it could not recover:
//
// 1. THE HIJACK. looksLikeRoofingEnquiry matches the bare substring 'roofing',
//    and the customer used it to describe a CEILING MATERIAL — which is the
//    literal answer to the question the electrical dialog had just asked
//    ("what's the ceiling type out there — flat, raked, cathedral, or sheet
//    metal?"). Answering the bot's own question is what triggered the wrong
//    receptionist.
//
// 2. NO ESCAPE. namesOtherTrade('New downlights') is FALSE, so once roofing
//    engaged, the clearest possible correction — said twice — was parsed as a
//    failed roofing answer, and two misses fire the inspection fallback.
//
// Defect 2's cause is a GOOD decision applied too broadly. The comment above
// OTHER_TRADE is right that 'downlight' appears in ordinary roofing answers
// ("water coming through around the downlights"), so it cannot be an
// unconditional trade-switch word. The distinction it misses: that sentence is
// roofing because it names WATER. "New downlights" carries no roofing context
// at all. So an electrical noun switches trade only when nothing in the message
// suggests a roof — the same shape as looksLikeRoofingEnquiry's own rule that
// bare "roof" needs an accompanying work word.

import { describe, it, expect } from 'vitest'
import { looksLikeRoofingEnquiry, namesOtherTrade } from './roofing-intake'

describe('DEFECT 1 — a ceiling material must not read as a roofing enquiry', () => {
  it('the exact turn that hijacked the thread', () => {
    expect(
      looksLikeRoofingEnquiry("It's a 125mm insulated panel roofing. The cable has been run already."),
    ).toBe(false)
  })

  it('and its shortened repeat', () => {
    expect(looksLikeRoofingEnquiry("It's insulated panel roofing")).toBe(false)
  })

  it('other ceiling-type answers the electrical dialog asks for', () => {
    // The question is "flat, raked, cathedral, or sheet metal?" — every one of
    // these is a valid answer, not a roofing job.
    for (const t of [
      'sheet metal roofing',
      'panel roofing',
      'insulated panel',
      'colorbond sheet roofing over the verandah',
    ]) {
      expect(looksLikeRoofingEnquiry(t), t).toBe(false)
    }
  })

  it('a REAL roofing enquiry still engages — the guard must not go too far', () => {
    for (const t of [
      'need a re-roof',
      'my roof is leaking',
      'roofing quote please',
      'can you replace my tile roof',
      'need a roofer',
      'gutters and downpipes',
      'roof repair after the storm',
    ]) {
      expect(looksLikeRoofingEnquiry(t), t).toBe(true)
    }
  })

  it('a roof that is leaking THROUGH panel roofing is still roofing', () => {
    // The narrow fix must not swallow a genuine leak that happens to describe
    // the material.
    expect(looksLikeRoofingEnquiry('water leaking through the panel roofing')).toBe(true)
  })
})

describe('DEFECT 2 — an electrical noun must break out of a roofing gather', () => {
  it('the exact corrections the customer sent twice', () => {
    expect(namesOtherTrade('New downlights.')).toBe(true)
    expect(namesOtherTrade('No I need new downlights')).toBe(true)
  })

  it('other unambiguous electrical asks', () => {
    for (const t of [
      'i want downlights',
      'new power point please',
      'add a gpo in the kitchen',
      'switchboard upgrade',
      'ceiling fan install',
    ]) {
      expect(namesOtherTrade(t), t).toBe(true)
    }
  })

  it('but NOT when the message carries roofing context — the case the comment protects', () => {
    // This is why 'downlight' could not simply be added to the trade list.
    // Each of these is a legitimate ROOFING answer that happens to name an
    // electrical fitting, and throwing away a live gather for it would be a
    // regression.
    for (const t of [
      'water coming through around the downlights',
      'theres a leak near the downlight',
      'stains on the ceiling around the downlights',
      'water drips from the light fitting when it rains',
    ]) {
      expect(namesOtherTrade(t), t).toBe(false)
    }
  })

  it('the existing explicit trade words still work', () => {
    for (const t of ['How about electrical', 'No im asking electrical', 'i need a plumber']) {
      expect(namesOtherTrade(t), t).toBe(true)
    }
  })

  it('and a roof word still wins outright', () => {
    // Unchanged precedence: an on-topic roofing answer is never a trade switch.
    for (const t of ['re-roof', 'the gutters', 'reroof the lot', 'ridge cap is cracked']) {
      expect(namesOtherTrade(t), t).toBe(false)
    }
  })
})
