// ════════════════════════════════════════════════════════════════════
// The deterministic-sampling policy for every Anthropic call in the app.
//
// POLICY: money- and fact-bearing LLM calls run at temperature 0.
//
// The catch is that newer Anthropic models REJECT the parameter outright.
// It is not a warning and not a silent no-op — it is an HTTP 400 that
// fails the whole call:
//
//     `temperature` is deprecated for this model.
//
// Verified live against the Anthropic API 2026-08-04:
//
//     claude-sonnet-5     temperature:0  FAIL 400   temperature:1  PASS
//     claude-opus-4-8     temperature:0  FAIL 400   temperature:1  PASS
//     claude-sonnet-4-6   temperature:0  PASS       temperature:1  PASS
//     claude-haiku-4-5    temperature:0  PASS       temperature:1  PASS
//
// `top_p` and `top_k` are rejected by exactly the same models, with the
// same wording. There is no `seed` on this API either, so on a rejecting
// model there is NO sampling knob at all — determinism has to come from
// the prompt, from tool-calling, and from the grounding validators.
//
// Three near-identical copies of this guard already existed
// (lib/estimation/extract.ts, lib/aircon/plan-extract.ts,
// lib/commercial-painting/extract.ts) and had already drifted apart —
// `/opus-4-[78]/` in two of them, `/opus-4-[789]/` in the third, and
// none of them covering Sonnet 5. That drift is exactly how
// ROOFING_VISION_MODEL=claude-sonnet-5 turned two unguarded
// `temperature: 0` call sites into hard 400s. New call sites use THIS
// module; the older copies are correct for the models they pin and can
// fold in here whenever they are next touched.
// ════════════════════════════════════════════════════════════════════

/**
 * Models that reject `temperature` / `top_p` / `top_k`.
 *
 * Matched as substrings against the model id, so `claude-sonnet-4-5` and
 * `claude-haiku-4-5` do NOT match `sonnet-5` / `haiku-5` — the hyphenated
 * minor version keeps them apart.
 */
const REJECTS_SAMPLING_PARAMS = /opus-4-[789]|opus-5|sonnet-5|haiku-5/

/** False when passing `temperature` to this model would 400 the request. */
export function modelAcceptsTemperature(model: string): boolean {
  return !REJECTS_SAMPLING_PARAMS.test(model)
}

/**
 * Spread this into any Anthropic call that wants deterministic output:
 *
 *     generateText({ model: anthropic(m), ...deterministicSampling(m), ... })
 *
 * Yields `{ temperature: 0 }` on a model that accepts it and `{}` on one
 * that does not, so the intent is declared once at every call site and the
 * request still succeeds when the model has dropped the knob.
 */
export function deterministicSampling(model: string): { temperature?: 0 } {
  return modelAcceptsTemperature(model) ? { temperature: 0 } : {}
}
