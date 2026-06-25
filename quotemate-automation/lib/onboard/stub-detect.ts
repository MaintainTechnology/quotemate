// Single source of truth for the deterministic stub-artifact *shapes*.
//
// A "stub" Twilio number / Vapi assistant is what provisioning mints when the
// provisioning flag is off (lib/twilio/provision.ts `stubNumberFor`, and the
// `vapi-stub-` assistant id) so the onboarding flow can run end-to-end without
// burning Twilio/Vapi money. The tenant CANNOT receive real calls/SMS.
//
// IMPORTANT — these are HINTS, never the authoritative real-vs-stub verdict:
//   • The Twilio stub generator mints placeholders INSIDE the live AU mobile
//     band (+61 482 0XX XXX), so a real Twilio number can share the stub shape.
//     Classifying a Twilio number as a stub from its digits alone is exactly
//     the false positive in BUG-15 (real Oculus/Oak Crest number flagged fake).
//     The authoritative signal is `tenants.twilio_number_sid` — a live Twilio
//     provision returns a Phone Number SID (PN…); a stub never does. See
//     lib/onboard/health.ts check #5.
//   • The Vapi `vapi-stub-` prefix cannot collide with a real assistant id, so
//     the Vapi shape check is safe to use as a verdict.

/** Deterministic stub Twilio number shape: +614820xxxxx. Hint only — never a
 *  standalone verdict (the shape overlaps the live AU mobile band). */
export function isStubTwilioNumber(n: string | null | undefined): boolean {
  return !!n && /^\+614820\d{5}$/.test(n)
}

/** Deterministic stub Vapi assistant id shape: vapi-stub-xxxxxxxx. */
export function isStubVapiId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('vapi-stub-')
}
