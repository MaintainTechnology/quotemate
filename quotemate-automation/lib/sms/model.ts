// ════════════════════════════════════════════════════════════════════
// The model every SMS AI receptionist runs on.
//
// Three call sites share this: the customer dialog (dialog.ts), the slot
// extractor (extract-slots.ts) and the intent classifier (intent.ts).
// They were three separate string literals and drifted as a matter of
// course; this is the one place to change them.
//
// Lives in its own module rather than on dialog.ts because dialog.ts
// already imports from extract-slots.ts — hanging the const off either
// would make the other's import circular.
//
// ROOFING + PAINTING (updated 2026-07-26, docs/strategy.md v17) — these
// two receptionists WERE deterministic state machines with zero LLM
// calls. They now run this same model for the CONVERSATION layer via
// lib/sms/llm-receptionist.ts, behind SMS_LLM_RECEPTIONIST_ENABLED
// (default OFF — with the flag unset they are byte-identical to the old
// machines and this constant still cannot affect them).
//
// The old note here forbade an LLM "polish" step, and that prohibition
// STANDS in its real sense: no model output is ever post-processed into a
// price. The conversation layer picks a TOOL; every dollar figure, area,
// structure count, measured address, quote link and booking confirmation
// still comes from lib/roofing/{measure,pricing}, lib/sms/roofing-compose,
// lib/sms/verify-address and lib/painting/pricing, and a grounding
// validator discards any turn whose text states one the tools did not
// produce. Rewriting a composed price through the model is still banned.
// ════════════════════════════════════════════════════════════════════

/** Claude Sonnet 5. Note the id carries NO date suffix — the dated forms
 *  (e.g. claude-sonnet-5-20260115) are not valid model ids. */
export const SMS_RECEPTIONIST_MODEL = 'claude-sonnet-5'

/**
 * Output ceiling for every receptionist call. MUST be passed explicitly.
 *
 * The pinned @ai-sdk/anthropic@3.0.71 resolves per-model limits from a
 * hardcoded table (getModelCapabilities in its dist bundle) that predates
 * Sonnet 5. 'claude-sonnet-5' matches none of its branches — notably NOT
 * the `claude-sonnet-4-` prefix — so it falls into the unknown-model
 * default of maxOutputTokens: 4096. When a call site omits
 * maxOutputTokens the provider substitutes that 4096 for what was
 * effectively 128000 under Sonnet 4.6.
 *
 * That matters more on Sonnet 5 than it would have on 4.6: Sonnet 5 runs
 * ADAPTIVE THINKING whenever the request omits a `thinking` field, and
 * this provider version never sends one (its `disabled` variant is a
 * silent no-op — the schema accepts it but no branch ever emits it). So
 * thinking tokens are drawn from the same ceiling as the reply. 8192
 * leaves ample room for reasoning plus a TurnDecision whose
 * reply_to_send is capped at 320 characters.
 *
 * Revisit if @ai-sdk/anthropic is upgraded to a release that knows this
 * model — at that point the explicit value can go back to being a tuning
 * choice rather than a correctness requirement.
 */
export const SMS_RECEPTIONIST_MAX_TOKENS = 8192
