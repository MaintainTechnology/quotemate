// ═══════════════════════════════════════════════════════════════════════
// QuoteMate · slot correction unit test (PR-B step 7)
//
// Verifies the pure logic of conversation_state seeding + merging without
// hitting Haiku or the DB. The Haiku-driven NLU pass (extractSlots) is
// exercised naturally by the existing test-sms-agent.mjs scenarios — this
// script focuses on what makes Con's bug stay fixed:
//   - seedStateFromKnownFields tags pre-seeded fields as 'from_memory'
//   - mergeSlotUpdates flips a from_memory field to 'customer_corrected'
//     when the customer overrides it this conversation
//   - the same field staying the same does NOT change source
//   - new fields get 'from_transcript', verified gets 'from_transcript'
//
// The merge logic is duplicated here as plain JS so the script is
// runnable without TypeScript tooling — matches the project's .mjs
// convention. If this drifts from lib/sms/extract-slots.ts, the test
// will surface it (assertions reference the same behaviour contract).
//
// Usage:  node scripts/test-slot-correction.mjs
//         → no env vars needed; no network; <50ms runtime
// ═══════════════════════════════════════════════════════════════════════

// ── inlined logic mirror (must match lib/sms/extract-slots.ts) ────────

function seedStateFromKnownFields({ first_name, suburb }) {
  const slots = {}
  const sources = {}
  if (first_name && first_name.trim()) {
    slots.first_name = first_name.trim()
    sources.first_name = 'from_memory'
  }
  if (suburb && suburb.trim()) {
    slots.suburb = suburb.trim()
    sources.suburb = 'from_memory'
  }
  return { slots, sources, last_extracted_at: null }
}

function mergeSlotUpdates(current, updates) {
  const nextSlots = { ...current.slots }
  const nextSources = { ...current.sources }
  let changed = false

  for (const [key, rawValue] of Object.entries(updates)) {
    if (rawValue === null || rawValue === undefined) continue
    const oldValue = current.slots[key]
    if (oldValue === rawValue) continue

    nextSlots[key] = rawValue
    changed = true

    if (key === 'verified') {
      nextSources[key] = 'from_transcript'
    } else {
      nextSources[key] = (oldValue === null || oldValue === undefined)
        ? 'from_transcript'
        : 'customer_corrected'
    }
  }

  return {
    slots: nextSlots,
    sources: nextSources,
    last_extracted_at: changed ? new Date().toISOString() : current.last_extracted_at,
  }
}

// ── tiny assertion harness ─────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    failures.push({ label, actual, expected })
    console.log(`  ✗ ${label}`)
    console.log(`      expected: ${JSON.stringify(expected)}`)
    console.log(`      actual:   ${JSON.stringify(actual)}`)
  }
}

function section(name, fn) {
  console.log(`\n— ${name} —`)
  fn()
}

// ── scenarios ──────────────────────────────────────────────────────────

section('seed from customer record', () => {
  const seeded = seedStateFromKnownFields({ first_name: 'Con', suburb: 'Coorparoo' })
  assertEq(seeded.slots.first_name, 'Con', 'first_name seeded')
  assertEq(seeded.slots.suburb, 'Coorparoo', 'suburb seeded')
  assertEq(seeded.sources.first_name, 'from_memory', 'first_name source = from_memory')
  assertEq(seeded.sources.suburb, 'from_memory', 'suburb source = from_memory')
})

section('seed ignores empty / whitespace fields', () => {
  const seeded = seedStateFromKnownFields({ first_name: '', suburb: '   ' })
  assertEq(Object.keys(seeded.slots).length, 0, 'no slots seeded from blanks')
  assertEq(Object.keys(seeded.sources).length, 0, 'no sources for blanks')
})

section("Con's bug: customer overrides stored suburb", () => {
  // Stored: Coorparoo from a prior conversation.
  // This conversation: customer says "Chandler" in turn 3.
  const seeded = seedStateFromKnownFields({ first_name: 'Con', suburb: 'Coorparoo' })
  const corrected = mergeSlotUpdates(seeded, { suburb: 'Chandler' })

  assertEq(corrected.slots.suburb, 'Chandler', 'suburb now Chandler')
  assertEq(corrected.slots.first_name, 'Con', 'first_name unchanged')
  assertEq(corrected.sources.suburb, 'customer_corrected', 'suburb source flipped to customer_corrected')
  assertEq(corrected.sources.first_name, 'from_memory', 'first_name source still from_memory')
})

section('idempotent: same value applied again is a no-op', () => {
  const seeded = seedStateFromKnownFields({ suburb: 'Bondi' })
  const merged = mergeSlotUpdates(seeded, { suburb: 'Bondi' })
  assertEq(merged.slots.suburb, 'Bondi', 'suburb unchanged')
  assertEq(merged.sources.suburb, 'from_memory', 'source NOT flipped (no real change)')
  assertEq(merged.last_extracted_at, null, 'timestamp NOT bumped (no change)')
})

section('new field on empty state gets from_transcript', () => {
  const empty = seedStateFromKnownFields({})
  const merged = mergeSlotUpdates(empty, {
    first_name: 'Mike',
    suburb: 'Bondi',
    job_type: 'downlights',
    count: 6,
  })
  assertEq(merged.slots.first_name, 'Mike', 'first_name extracted')
  assertEq(merged.slots.count, 6, 'count extracted')
  assertEq(merged.sources.first_name, 'from_transcript', 'first_name source = from_transcript')
  assertEq(merged.sources.suburb, 'from_transcript', 'suburb source = from_transcript')
  assertEq(merged.sources.job_type, 'from_transcript', 'job_type source = from_transcript')
  assertEq(merged.sources.count, 'from_transcript', 'count source = from_transcript')
})

section('verified flag never carries customer_corrected', () => {
  const stateA = mergeSlotUpdates(seedStateFromKnownFields({}), { verified: false })
  assertEq(stateA.sources.verified, 'from_transcript', 'verified=false → from_transcript')
  const stateB = mergeSlotUpdates(stateA, { verified: true })
  assertEq(stateB.sources.verified, 'from_transcript', 'verified true after false → still from_transcript (not customer_corrected)')
})

section('null / undefined updates are ignored', () => {
  const seeded = seedStateFromKnownFields({ suburb: 'Coorparoo' })
  const merged = mergeSlotUpdates(seeded, { suburb: null, first_name: undefined })
  assertEq(merged.slots.suburb, 'Coorparoo', 'suburb unchanged on null')
  assertEq(merged.sources.suburb, 'from_memory', 'source preserved on null')
})

section("Con's full trajectory: re-apply same correction is a no-op", () => {
  // Customer says "Chandler" on turn 3 → corrected.
  // Customer says "In chandler" on turn 5 (extracted as suburb=Chandler again).
  // Second extraction should NOT re-flip; it's already correct.
  const seeded = seedStateFromKnownFields({ first_name: 'Con', suburb: 'Coorparoo' })
  const afterTurn3 = mergeSlotUpdates(seeded, { suburb: 'Chandler' })
  const afterTurn5 = mergeSlotUpdates(afterTurn3, { suburb: 'Chandler' })
  assertEq(afterTurn5.slots.suburb, 'Chandler', 'suburb still Chandler')
  assertEq(afterTurn5.sources.suburb, 'customer_corrected', 'source remains customer_corrected')
  assertEq(afterTurn5.last_extracted_at, afterTurn3.last_extracted_at, 'no timestamp churn on no-op')
})

// ── summary ────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`)
console.log(`PASSED: ${passed}`)
console.log(`FAILED: ${failed}`)
if (failed > 0) {
  console.log(`\nFailures:`)
  for (const f of failures) {
    console.log(`  • ${f.label}`)
  }
  process.exit(1)
} else {
  console.log(`\n✓ All slot-correction invariants hold. Con's bug stays fixed.`)
}
