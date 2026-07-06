// ════════════════════════════════════════════════════════════════════
// Solar — shared input/storage bounds.
//
// SINGLE SOURCE OF TRUTH for the largest preferred system size a customer
// may request on the public form (and a tradie may override to on re-draft).
//
// This ONE number must be honoured identically by every layer that touches
// the customer's requested size, or a value that passes one layer's check
// fails the next:
//   • client payload builder .......... lib/solar/form-payload.ts
//   • request Zod schema .............. lib/solar/request-schema.ts
//   • sizing tier anchor cap .......... lib/solar/sizing.ts
//   • tradie re-draft override ........ app/api/solar/redraft/[token]/route.ts
//   • persist clamp (defence-in-depth)  lib/solar/persist-helpers.ts
//   • DB CHECK constraint ............. solar_estimates.requested_system_kw
//                                       (sql/migrations/162_*)
//
// Regression this guards (fixed 2026-07-06): the form accepted up to 100 kW
// and the Zod schema/migration 116 agreed on 100, but the LIVE DB check had
// drifted to <= 30. Any preferred size in (30, 100] therefore passed
// validation, ran the engine, then failed the solar_estimates INSERT with
// `estimate_insert_failed` — surfaced to the customer as the misleading
// "We could not save your estimate just now." (Only the 14 kW / <=30 chips
// worked.) Migration 162 realigns the DB to this constant; keeping every
// layer pinned here stops the ceilings drifting apart again.
//
// PURE, zero-dependency — safe to import from both client and server code.
// ════════════════════════════════════════════════════════════════════

/** Largest preferred system size (kW DC) a customer may request / we store. */
export const MAX_REQUESTED_SYSTEM_KW = 100
