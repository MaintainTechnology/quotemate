// Is the general (electrical/plumbing) dialog mid-gather on this thread?
//
// WHY THIS EXISTS. The roofing and painting receptionists each engage on a
// KEYWORD with no knowledge of whether the general dialog is already gathering
// a job. So a single colliding word takes the thread — and once taken it is
// kept, because resuming only checks the receptionist's own state.
//
// Live, conversation b2625cbe (2026-07-31 22:12 UTC, Atomic Electrical):
// the general dialog had gathered first_name=Jon, suburb=Chandler, count=16,
// room=patio, job_type=downlights — every one of them from_transcript. It then
// asked "what's the ceiling type out there — flat, raked, cathedral, or sheet
// metal?", and the customer answered "It's a 125mm insulated panel roofing."
// The bare substring 'roofing' matched, the roofing receptionist engaged COLD,
// fed that sentence to the geocoder as an address, and never let go. The
// customer said downlights FOUR more times. The thread ended by telling an
// electrical customer a roofer would call.
//
// Patching the vocabulary does not fix this. Four such patches are already
// recorded in roofing-intake.ts (22, 24, 25 July, and 3 August) — each a new
// word, each patched alone. The routing guarantee the code needs is structural:
// a fresh keyword must not outrank a gather already in progress.
//
// ── WHY *THIS* SIGNAL ──────────────────────────────────────────────────
//
// Chosen against live data (378 conversations), not by intuition:
//
//   · `slots.job_type` alone — CLAUDE.md says it is null on every conversation
//     since 2026-07-08 and that keying on it would suppress all SMS quoting.
//     That claim is WRONG as written: it was set, correctly, on the failing
//     thread. But it is set on only 3 of 24 slot-bearing conversations since
//     that date, so a guard keyed on it would miss 5 of the 7 historical class
//     rows. Near-inert, not suppressive. Its rarity is itself a SYMPTOM of this
//     bug — the receptionists take the traffic and the route returns before
//     extractSlots ever runs, so slots are never written.
//
//   · A slot being non-null is NOT enough. first_name/suburb/address/verified
//     are trade-agnostic AND usually `from_memory` — pre-seeded from the
//     customers row, no dialog turn behind them. 15 live conversations hold
//     only those alongside a roofing state, and every one is a LEGITIMATE
//     handoff (mostly roofing-only tenants). Treating them as mid-gather would
//     block real roofing enquiries.
//
//   · So: a TRADE-SPECIFIC slot, gathered FROM THE TRANSCRIPT. That pair
//     isolates the 7 real class rows from the 15 clean handoffs with zero
//     overlap in the live data, and 159 of 183 recent conversations have an
//     empty `{}` state, so this cannot fire on the roofing-only tenants that
//     carry most traffic.
//
// Pure and I/O-free — the caller passes the jsonb.

/** Slots that say nothing about WHICH trade is being quoted. Each is commonly
 *  pre-seeded from the customers row (`from_memory`) before any dialog turn
 *  happens, so none of them is evidence of a gather in progress. */
const TRADE_AGNOSTIC: ReadonlySet<string> = new Set([
  'first_name',
  'suburb',
  'address',
  'email',
  'verified',
])

/** Provenance values meaning "the customer said this ON THIS THREAD". Anything
 *  else (notably `from_memory`) was carried in from the customers row, which is
 *  keyed on phone number alone and can hold data from an unrelated earlier job. */
const SAID_ON_THIS_THREAD: ReadonlySet<string> = new Set([
  'from_transcript',
  'customer_corrected',
])

/**
 * True when the general dialog has gathered at least one TRADE-SPECIFIC slot
 * from this conversation's own transcript.
 *
 * Deliberately conservative — every uncertain case returns false, which leaves
 * today's behaviour untouched. A guard that over-fires would block genuine
 * roofing enquiries, which is a worse failure than the one being fixed.
 */
export function generalDialogIsMidGather(conversationStateRaw: unknown): boolean {
  if (!conversationStateRaw || typeof conversationStateRaw !== 'object') return false
  const state = conversationStateRaw as {
    slots?: Record<string, unknown> | null
    sources?: Record<string, unknown> | null
  }
  const slots = state.slots
  const sources = state.sources
  if (!slots || typeof slots !== 'object') return false

  for (const [key, value] of Object.entries(slots)) {
    if (TRADE_AGNOSTIC.has(key)) continue
    // A null/blank slot is not gathered. `verified: false` is excluded above
    // anyway, but an explicit false elsewhere still counts as an answer.
    if (value === null || value === undefined || value === '') continue
    const provenance = sources && typeof sources === 'object' ? sources[key] : undefined
    if (typeof provenance === 'string' && SAID_ON_THIS_THREAD.has(provenance)) return true
  }
  return false
}
