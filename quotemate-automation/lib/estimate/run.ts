import { anthropic } from '@ai-sdk/anthropic'
import { generateText, stepCountIs } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { systemPrompt } from './prompt'
import { makeTools } from './tools'
import { buildCandidatePrices, validateQuoteGrounding, type GroundingFailure, type PricingBookForValidation } from './validate'
import {
  catalogueCandidateRows,
  formatCatalogueHint,
  formatBomHint,
  formatTierLadderHint,
  effectiveAssembly,
  enrichLinesWithCatalogue,
  applyChosenProduct,
  type CatalogueHintRow,
  type BomHintRow,
  type TierLadderHintRow,
  type TenantMaterial,
  type SharedMaterial,
  type BomLine,
  type CatalogueProductRef,
} from './catalogue'
import { applyMinLabourFloor } from './min-labour'
import { reconcileTierMath, collapseDuplicateTiers, checkQuantityVsItemCount, reconcileInflatedLabour } from './reconcile'
import { specGuardMode, evaluateSpecGuard, evaluateDraftSpecGuard } from './spec-guard'
import { resolveInspectionReason } from './inspection-reason'
import { carriedPricedTiers, forceInspectionTiers } from './inspection-normalize'
import { checkSanityBounds, boundForJob, type JobTypeBound } from './sanity-bounds'
import { categoryForJobType } from '@/lib/sms/product-options'
import {
  mergeRecipesIntoDraft,
  buildRecipeSlots,
  type AssemblyMeta,
  type DraftWithTiers,
} from './merge-recipes'
import type { PriceQuestion } from './price-bands'
import {
  summarisePriceHistory,
  formatPriceHistoryHint,
  type PastQuoteTiers,
} from './price-history'
import { buildDeterministicTiers, type DeterministicTierInput } from './deterministic-bom'
import { fetchSimilarPastQuotesContext } from './rag'
import { runKbEstimateVerification } from './kb-verify'
import { searchTenantStore } from '@/lib/filestore/tenant-store'
import type { KbSearchResult } from '@/lib/admin-loader/mt-filestore-kb'
import { pipelineLog } from '@/lib/log/pipeline'
import { createTracer, stopwatch } from '@/lib/log/trace'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type EstimationResult = {
  /** The draft quote that the route handler should persist + dispatch.
   *  If grounding validation failed, this draft is downgraded to
   *  inspection-required (good/better/best=null, needs_inspection=true). */
  draft: any
  /** Set when the validator found ungrounded prices — populated for
   *  observability so Vercel logs show exactly which line items failed. */
  groundingFailures?: GroundingFailure[]
  /** True when the draft was forced to inspection-required because
   *  validation failed. The route handler should NOT create three-tier
   *  Stripe sessions in this case. */
  downgradedToInspection?: boolean
  /** R15b — set when a HARD spec mismatch blocked SOME (not all) priced
   *  tiers in enforce mode. The quote still ships with its spec-correct
   *  tier(s) (so it is NOT an inspection downgrade), but the route handler
   *  gets the same explicit, structured observability the grounding path
   *  gets via groundingFailures — the blocked tiers are never silently
   *  nulled. `null`/absent when no partial spec-block happened. */
  specBlock?: {
    partial: true
    blocked_tiers: Array<'good' | 'better' | 'best'>
    reasons: Array<{ tier: 'good' | 'better' | 'best'; reason: string }>
  }
}

/** Phase 6 (2026-05-27) — optional conversation_state for the price-bands
 *  recipe engine. When the caller is the SMS route, it loads the
 *  sms_conversations.conversation_state for the intake and passes it here
 *  so the merge step (buildRecipeSlots) can see the customer's most
 *  recent slot answers (distance_to_existing_power, circuit_required,
 *  etc.). Voice and other callers pass null — they don't have an SMS
 *  conversation state — and the recipe falls back to intake.scope.
 *
 *  Kept loose-typed because callers persist this as jsonb; runtime shape
 *  is normalised inside lib/sms/extract-slots.ts before consumption by
 *  the dialog. Here we only forward .slots into buildRecipeSlots, so a
 *  malformed shape produces an empty slot map rather than a crash. */
export type RecipeConversationState = {
  slots?: Record<string, unknown> | null
} | null | undefined

export async function runEstimation(
  intake: any,
  pricingBook: any,
  modelId = 'claude-opus-4-8',
  conversationState: RecipeConversationState = null,
): Promise<EstimationResult> {
  const cacheLog = pipelineLog('estimate', intake?.id ?? null)
  // Phase 7 — structured tracer. Fires fire-and-forget DB writes to
  // pipeline_traces (mig 076) at every key transition so the dashboard
  // Pipeline tab can render a step-by-step timeline. console.log lines
  // via `cacheLog` still go to Vercel logs — these are additive, never
  // replacing the existing scannable lines.
  const trace = createTracer(supabase, {
    tenant_id: (intake?.tenant_id as string | null) ?? null,
    intake_id: (intake?.id as string | null) ?? null,
  })
  const totalSw = stopwatch()
  trace('estimate', 'ok', {
    substep: 'start',
    message: `runEstimation invoked (model=${modelId})`,
    inputs: {
      intake_id: intake?.id ?? null,
      job_type: intake?.job_type ?? null,
      trade: intake?.trade ?? null,
      confidence: intake?.confidence ?? null,
      tenant_id: intake?.tenant_id ?? null,
      hourly_rate: (pricingBook as { hourly_rate?: unknown })?.hourly_rate ?? null,
      markup_pct:
        (pricingBook as { default_markup_pct?: unknown })?.default_markup_pct ?? null,
      conversation_state_slot_count:
        conversationState && typeof conversationState === 'object' && conversationState.slots
          ? Object.keys(conversationState.slots).length
          : 0,
    },
  })

  // RAG: anchor Opus to similar past quotes. Returns null on cold-start
  // (no usable matches), all-inspection results, or if RAG_DISABLED=true.
  // The block goes in the user message — keeps the system message
  // fully cacheable while still informing this specific draft.
  let ragContext: string | null = null
  let ragMatchCount = 0
  try {
    const rag = await fetchSimilarPastQuotesContext(supabase, intake)
    if (rag) {
      ragContext = rag.context
      ragMatchCount = rag.matchCount
      cacheLog.ok('RAG context attached', { match_count: ragMatchCount, chars: rag.context.length })
    } else {
      cacheLog.ok('RAG context skipped', { reason: 'no usable matches or disabled' })
    }
  } catch (e: any) {
    // RAG must never block estimation. Log + carry on.
    cacheLog.err('RAG fetch failed — continuing without similar-quote context', e?.message ?? String(e))
  }

  // Brand preferences (migration 022). Soft hint appended to the system
  // prompt so Opus biases material picks toward the tradie's preferred
  // brands when multiple candidates fit the customer's tier/spec. Never
  // a hard filter — the grounding validator (loadCandidatePrices +
  // validateQuoteGrounding below) keeps the safety guarantees regardless
  // of which brand Opus picks. Preferences are scoped to intake.trade so
  // a plumbing-only quote doesn't see electrical-brand hints and vice
  // versa.
  const preferencesBlock = await buildPreferencesBlock(
    (intake?.tenant_id as string | null) ?? null,
    (intake?.trade as string | null) ?? null,
    cacheLog,
  )

  // WP2 — operator brand+range catalogue hint. WP3 — structured BOM hint.
  // Both soft, both null when the tenant has no catalogue / the BOM table
  // is unseeded, so this is purely additive (no change for legacy data).
  const catalogueBlock = await buildCatalogueHint(
    (intake?.tenant_id as string | null) ?? null,
    (intake?.trade as string | null) ?? null,
    cacheLog,
  )
  const bomBlock = await buildBomHint(intake, (intake?.trade as string | null) ?? null, cacheLog)

  // WP2 historical-pricing (safe slice). SOFT advisory only — appended
  // to the user prompt exactly like the catalogue/BOM hints, NEVER fed
  // to the grounding validator, so it can only nudge and can never
  // over-reject or change an accepted price. Flag-gated off by default
  // (PRICE_HISTORY_HINT) and best-effort → fully inert until enabled.
  const priceHistoryBlock =
    process.env.PRICE_HISTORY_HINT === '1'
      ? await buildPriceHistoryHint(
          (intake?.tenant_id as string | null) ?? null,
          (intake?.job_type as string | null) ?? null,
          cacheLog,
        )
      : null

  // Phase 3 (spec 2026-06-19) — per-tenant AI grounding. When enabled,
  // retrieve relevant snippets from the DRAFTING TENANT'S OWN past
  // jobs/invoices (their per-tenant Gemini File Search store) and append
  // them to the user prompt as ADVISORY background only — exactly like the
  // catalogue / BOM / price-history hints above. Three guarantees make this
  // safe to add to the money path:
  //   • Flag-gated (TENANT_FILESTORE_ENABLED): fully dormant + byte-identical
  //     to today when the flag is off (the helper returns null without any
  //     DB read or KB call).
  //   • Best-effort, never-blocking: buildTenantGroundingHint wraps all work
  //     in try/catch and returns null on any error/timeout — the pipeline
  //     proceeds with the un-grounded prompt.
  //   • Additive only: the retrieved text is appended to the user prompt's
  //     contextual background. It is NEVER fed to the tools, the candidate
  //     loader, or the grounding validator, so it cannot become a price
  //     source — prices still come solely from tool-calling against
  //     pricing_book/shared_*/tenant_custom_assemblies, and the grounding
  //     validator remains the hard backstop. Scoped to THIS tenant's
  //     file_store_id only (no cross-tenant data); indexed docs are already
  //     PII-minimized so no extra redaction is needed.
  const tenantGroundingBlock =
    process.env.TENANT_FILESTORE_ENABLED === 'true'
      ? await buildTenantGroundingHint(
          (intake?.tenant_id as string | null) ?? null,
          intake,
          cacheLog,
        )
      : null

  const userPrompt =
    (ragContext ? `${ragContext}\n` : '') +
    (preferencesBlock ? `${preferencesBlock}\n` : '') +
    (catalogueBlock ? `${catalogueBlock}\n` : '') +
    (bomBlock ? `${bomBlock}\n` : '') +
    (priceHistoryBlock ? `${priceHistoryBlock}\n` : '') +
    (tenantGroundingBlock ? `${tenantGroundingBlock}\n` : '') +
    `Draft a quote for this NEW intake:\n\n${JSON.stringify(intake, null, 2)}`

  // Tenant-scoped tool factory. lookupAssembly now reads BOTH
  // shared_assemblies AND this tenant's tenant_custom_assemblies
  // (migration 023). Legacy intakes without tenant_id get the
  // shared catalogue only — same behaviour as pre-023.
  const tools = makeTools((intake?.tenant_id as string | null) ?? null)

  // Anthropic prompt caching: the system prompt + pricing-book derivation
  // is identical across estimations until pricing_book changes, so we mark
  // it as ephemeral. First call inside the 5-min cache window pays full
  // price (cacheCreationInputTokens > 0); subsequent calls read at ~10%
  // cost (cacheReadInputTokens > 0). Cache invalidates automatically when
  // any pricing_book field changes (different prompt content → different key).
  const llmSw = stopwatch()
  const result = await generateText({
    model: anthropic(modelId),
    messages: [
      {
        role: 'system',
        // Data-driven router: loads the trade's trade_prompts template
        // (bundled-template + oracle fallback). See lib/estimate/prompt.ts.
        content: await systemPrompt(intake, pricingBook),
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    tools,
    stopWhen: stepCountIs(10),  // build-guide says `maxSteps: 10`; AI SDK v5+ renamed it to stopWhen+stepCountIs
    maxRetries: 0,              // wrapper handles retries with logging — no double-retry
    // Opus 4.7 ignores temperature — AI SDK warns on every call if it's
    // set. Determinism here comes from the strict tool-call grounding +
    // pricing book lookup, not from temperature.
  })

  const cacheMeta = (result.providerMetadata as any)?.anthropic
  if (cacheMeta) {
    cacheLog.ok(`${modelId} call complete (cache stats)`, {
      cache_creation_input_tokens: cacheMeta.cacheCreationInputTokens ?? 0,
      cache_read_input_tokens: cacheMeta.cacheReadInputTokens ?? 0,
      input_tokens: cacheMeta.usage?.inputTokens ?? null,
      output_tokens: cacheMeta.usage?.outputTokens ?? null,
    })
  }

  const draft = parseJsonFromText(result.text)

  // Phase 7 — record the LLM-call outcome.
  trace('estimate', 'ok', {
    substep: 'llm_draft',
    message: `${modelId} produced draft (needs_inspection=${!!draft?.needs_inspection})`,
    inputs: {
      // The full prompt is too large to store; record what shaped it.
      model: modelId,
      rag_match_count: ragMatchCount,
    },
    outputs: {
      needs_inspection: !!draft?.needs_inspection,
      job_type: intake?.job_type ?? null,
      good_subtotal: draft?.good?.subtotal_ex_gst ?? null,
      better_subtotal: draft?.better?.subtotal_ex_gst ?? null,
      best_subtotal: draft?.best?.subtotal_ex_gst ?? null,
      inspection_reason: draft?.inspection_reason ?? null,
      assumptions_count: Array.isArray(draft?.assumptions) ? draft.assumptions.length : 0,
      risk_flags_count: Array.isArray(draft?.risk_flags) ? draft.risk_flags.length : 0,
    },
    decisions: {
      cache_read_input_tokens: cacheMeta?.cacheReadInputTokens ?? 0,
      cache_creation_input_tokens: cacheMeta?.cacheCreationInputTokens ?? 0,
    },
    duration_ms: llmSw.elapsed(),
  })

  // Inspection-required quotes don't carry line items, so there's nothing
  // to validate — accept as-is. The route handler will force tier nulls and
  // the $99 inspection total.
  if (draft?.needs_inspection === true) {
    // R13 — the self-report reason is free-form LLM text shown to the
    // customer; resolve it to the closed enum before it leaves the engine.
    draft.inspection_reason = resolveInspectionReason(draft.inspection_reason)
    // R3/R7 — never trust the model to have nulled the tiers: a self-declared
    // inspection must not ship priced tiers. Force them null + stamp the path
    // centrally (lib/estimate/inspection-normalize.ts, unit-tested).
    if (carriedPricedTiers(draft)) {
      cacheLog.err('needs_inspection=true but draft carried priced tiers — force-nulling (R3)', null, {
        had_good: !!draft.good, had_better: !!draft.better, had_best: !!draft.best,
      })
    }
    forceInspectionTiers(draft)
    trace('estimate', 'warn', {
      substep: 'route_to_inspection',
      message: 'draft self-reported needs_inspection=true; tiers nulled; skipping validation',
      decisions: { route: 'inspection', cause: 'llm_self_reported' },
      duration_ms: totalSw.elapsed(),
    })
    return { draft }
  }

  // ── Phase 2 — DETERMINISTIC BOM (flag-gated, default OFF) ──────────
  // When DETERMINISTIC_BOM=1 AND this tenant has a curated recipe +
  // catalogue for the job, REBUILD good/better/best from their own data
  // so the same job quotes the same parts at the same prices every
  // time. Opus's scope_of_works / assumptions / framing are kept; only
  // the priced line items are replaced. Any safe-failure (no recipe,
  // service off, unpriceable required part, no rate) → leave Opus's
  // draft exactly as-is (zero regression). The min-labour floor + the
  // grounding validator below STILL run on the result, so a drifted
  // deterministic price self-corrects to inspection — same safety
  // envelope as the Opus path. This block is fully dormant until the
  // env flag is explicitly set.
  if (process.env.DETERMINISTIC_BOM === '1') {
    try {
      const loaded = await loadDeterministicInputs(intake, pricingBook)
      if (loaded.input) {
        const built = buildDeterministicTiers(loaded.input)
        if (built.tiers) {
          for (const tier of ['good', 'better', 'best'] as const) {
            const prev =
              draft[tier] && typeof draft[tier] === 'object' ? draft[tier] : {}
            draft[tier] = {
              ...prev,
              line_items: built.tiers[tier].line_items,
              subtotal_ex_gst: built.tiers[tier].subtotal_ex_gst,
            }
          }
          draft.needs_inspection = false
          // R7 — this quote's prices were recomputed deterministically (LLM
          // prices discarded), so it is auto-send eligible (subject to the gate).
          draft.pricing_path = 'deterministic'
          cacheLog.ok('deterministic BOM applied (recipe × catalogue — same job, same price)', {
            assembly: loaded.assemblyName,
            good_subtotal: built.tiers.good.subtotal_ex_gst,
            better_subtotal: built.tiers.better.subtotal_ex_gst,
            best_subtotal: built.tiers.best.subtotal_ex_gst,
          })
        } else {
          cacheLog.ok('deterministic BOM skipped — falling back to Opus draft', {
            reason: built.reason,
          })
        }
      } else {
        cacheLog.ok('deterministic BOM skipped — falling back to Opus draft', {
          reason: loaded.reason,
        })
      }
    } catch (e: any) {
      // Never let the deterministic path break estimation — fall back.
      cacheLog.err(
        'deterministic BOM errored — falling back to Opus draft',
        e?.message ?? String(e),
      )
    }
  }

  // Apply the configured minimum-charge floor BEFORE grounding so a
  // small but correctly-priced job (e.g. one GPO) is quoted at the
  // tradie's own minimum instead of being bounced to a $99 inspection.
  // Deterministic + grounded (tops labour up at pricing_book.hourly_rate);
  // never undercharges, never fabricates; no-ops when already compliant.
  // This mutates `draft` in place, so validation below sees the floor.
  const floorSw = stopwatch()
  const floored = applyMinLabourFloor(draft, pricingBook)
  if (floored.adjustedTiers.length > 0) {
    cacheLog.ok('min-labour floor applied (small-job minimum charge — not bounced to inspection)', {
      tiers: floored.adjustedTiers,
      min_labour_hours: (pricingBook as any)?.min_labour_hours ?? 2.0,
    })
    trace('estimate', 'ok', {
      substep: 'min_labour_floor',
      message: `floor applied to ${floored.adjustedTiers.length} tier(s)`,
      decisions: {
        adjusted_tiers: floored.adjustedTiers,
        min_labour_hours: (pricingBook as any)?.min_labour_hours ?? 2.0,
      },
      duration_ms: floorSw.elapsed(),
    })
  }

  // Auto-quote path: every line_item.unit_price_ex_gst MUST be derivable
  // from pricing_book + shared_materials + shared_assemblies + the
  // tenant's tenant_custom_assemblies (migration 023). v5 multi-trade:
  // scope grounding to intake.trade so an electrical quote can never
  // coincidentally validate against a plumbing price (or vice versa).
  // Loaded HERE (before the recipe merge) so the R9 appended-extra
  // micro-validation can reuse the SAME candidate set the main grounding
  // pass uses below — one DB round-trip, identical safety semantics.
  const candidates = await loadCandidatePrices(
    pricingBook,
    intake?.trade ?? null,
    (intake?.tenant_id as string | null) ?? null,
    // R10 — when this quote was priced deterministically, ground with EXACT
    // markup (no ±5pp band): the deterministic builder marks up at exactly
    // default_markup_pct, so any drift is a real bug, not Opus rounding.
    draft?.pricing_path === 'deterministic',
  )

  // ── Phase 3 — PRICE-BANDS RECIPE MERGE ─────────────────────────────
  // For each tier where Opus picked an assembly that carries a
  // price_recipe (jsonb), evaluate the recipe against the customer's
  // slot answers (intake.scope + conversation_state.slots) and merge
  // the resulting extras into the tier — extra labour, cable per
  // metre, risk flags, and optionally a base-assembly SWAP. Lets the
  // GPO recipe (mig 074) auto-quote installs that previously routed
  // to a $99 inspection because the customer mentioned a non-default
  // distance or amperage. No-op when the assembly has no recipe; falls
  // back silently on load errors so the un-banded draft still ships.
  //
  // PHASE 1 integrity (R7 + R9): the merge APPENDS recipe extras to the
  // END of a tier AFTER Opus drafted it. Two failure modes are closed
  // here, both ENFORCED (not advisory):
  //   • R7 — an appended extra that double-charges an Opus-drafted line
  //     (same catalogue id / product, qty, unit) is DROPPED.
  //   • R9 — the appended extras of a tier are micro-validated against
  //     the grounding candidate set; if ANY appended line is un-grounded
  //     the WHOLE tier's recipe result is reverted to its pre-merge
  //     state (CRITICAL log) so a partial / un-grounded merge never
  //     ships. A revert restores the exact Opus-drafted tier object.
  let mergedDraft: DraftWithTiers = draft
  try {
    const recipeCtx = await loadRecipeContext(
      (intake?.trade as string | null) ?? null,
      (intake?.tenant_id as string | null) ?? null,
    )
    if (recipeCtx.recipesByAssemblyId.size > 0) {
      // Snapshot the pre-merge tiers (deep-cloned) + per-tier Opus line
      // counts BEFORE merge. The clones are the revert targets for R9;
      // the counts mark the Opus-drafted prefix for R7/R9.
      const preMergeTiers: Partial<Record<(typeof PHASE1_TIERS)[number], any>> = {}
      const preCounts: Partial<Record<(typeof PHASE1_TIERS)[number], number>> = {}
      for (const k of PHASE1_TIERS) {
        const t = (draft as any)?.[k]
        if (t && Array.isArray(t.line_items)) {
          preMergeTiers[k] = JSON.parse(JSON.stringify(t))
          preCounts[k] = t.line_items.length
        }
      }

      // Phase 6: SMS callers thread sms_conversations.conversation_state
      // through here. buildRecipeSlots gives conversation slots priority
      // over intake.scope (newer signal wins), so live customer answers
      // captured by the slot extractor (Phase 4) reach the recipe engine.
      // Other callers (voice, /api/quote/[id]/edit) pass null and the
      // recipe falls back to intake.scope only — same as Phase 3-5 behaviour.
      const slots = buildRecipeSlots(
        intake,
        conversationState && typeof conversationState === 'object'
          ? { slots: (conversationState.slots ?? {}) as Record<string, unknown> }
          : null,
      )
      const { draft: postMerge, outcome } = mergeRecipesIntoDraft(draft, {
        recipesByAssemblyId: recipeCtx.recipesByAssemblyId,
        assembliesById: recipeCtx.assembliesById,
        slots,
        pricingBook,
      })
      mergedDraft = postMerge
      if (outcome.any_changed) {
        // Copy mutations back onto the original `draft` reference so
        // downstream code (validator, enrich, WP9, downgrade path) sees
        // them. mergeRecipesIntoDraft is purely functional; we apply
        // its result onto the live draft here.
        Object.assign(draft, postMerge)

        // R7 — drop appended recipe extras that duplicate an Opus line.
        const r7 = dropDuplicateAppendedLines(draft, preCounts)
        if (r7.dropped.length > 0) {
          cacheLog.err(
            'R7 recipe-dedup — dropped appended recipe line(s) that double-charged an Opus-drafted line',
            null,
            { dropped: r7.dropped },
          )
          trace('estimate', 'warn', {
            substep: 'recipe_dedup',
            message: `R7 dropped ${r7.dropped.length} duplicate appended line(s)`,
            decisions: { dropped: r7.dropped },
          })
        }

        // R9 — micro-validate ONLY the appended extras against the same
        // grounding candidate set. A tier with an un-grounded appended
        // line is reverted to its pre-merge (Opus-drafted) state so a
        // partial / un-grounded merge can never reach the customer.
        try {
          const r9 = validateAppendedLines(draft, preCounts, pricingBook as PricingBookForValidation, candidates)
          if (r9.failedTiers.size > 0) {
            for (const k of r9.failedTiers) {
              if (preMergeTiers[k] !== undefined) {
                ;(draft as any)[k] = preMergeTiers[k]
              }
            }
            cacheLog.err(
              'R9 CRITICAL — recipe appended an un-grounded extra; reverted affected tier(s) to the pre-merge Opus draft',
              null,
              {
                reverted_tiers: Array.from(r9.failedTiers),
                failures: r9.failures.map((f) => ({
                  tier: f.tier,
                  lineIndex: f.lineIndex,
                  description: f.description?.slice(0, 80),
                  expected: f.expected,
                })),
              },
            )
            trace('estimate', 'err', {
              substep: 'recipe_merge_isolation',
              message: `R9 reverted ${r9.failedTiers.size} tier(s) — un-grounded appended extra`,
              decisions: { reverted_tiers: Array.from(r9.failedTiers) },
            })
          }
        } catch (r9Err: any) {
          // Fail-closed on an isolation error: revert ALL tiers that the
          // merge changed, so a crash in the micro-validator can't leave a
          // partially-merged tier in the draft.
          cacheLog.err(
            'R9 isolation errored — reverting all merged tiers to the pre-merge Opus draft',
            r9Err?.message ?? String(r9Err),
          )
          for (const k of PHASE1_TIERS) {
            if (preMergeTiers[k] !== undefined) (draft as any)[k] = preMergeTiers[k]
          }
        }

        trace('estimate', 'ok', {
          substep: 'recipe_merge',
          message: 'price-bands recipe modifiers applied',
          decisions: {
            good_recipes_fired: outcome.good.recipes_fired,
            good_swapped_to: outcome.good.swapped_to,
            good_added_line_items: outcome.good.added_line_items,
            better_recipes_fired: outcome.better.recipes_fired,
            best_recipes_fired: outcome.best.recipes_fired,
            good_subtotal_after: draft?.good?.subtotal_ex_gst ?? null,
          },
        })
        cacheLog.ok('price-bands recipe merge applied', {
          good: outcome.good.changed
            ? {
                recipes_fired: outcome.good.recipes_fired,
                swapped_to: outcome.good.swapped_to,
                added_lines: outcome.good.added_line_items,
                defaults_used: outcome.good.defaults_used,
              }
            : null,
          better: outcome.better.changed
            ? {
                recipes_fired: outcome.better.recipes_fired,
                swapped_to: outcome.better.swapped_to,
                added_lines: outcome.better.added_line_items,
                defaults_used: outcome.better.defaults_used,
              }
            : null,
          best: outcome.best.changed
            ? {
                recipes_fired: outcome.best.recipes_fired,
                swapped_to: outcome.best.swapped_to,
                added_lines: outcome.best.added_line_items,
                defaults_used: outcome.best.defaults_used,
              }
            : null,
        })
      }
    }
  } catch (e: any) {
    // Recipe merge must NEVER block estimation. Log + carry on.
    cacheLog.err(
      'price-bands recipe merge errored — continuing with un-banded draft',
      e?.message ?? String(e),
    )
  }

  // ── KB VERIFICATION (MT-QM-PRICING-KB) ─────────────────────────────
  // Flag-gated (KB_VERIFY_ESTIMATES: off | shadow | apply). Cross-checks
  // every priced line item against the authoritative MT-QM-PRICING-KB file
  // store (which mirrors the Supabase pricing/materials tables) BEFORE the
  // grounding validator runs below. This is the key safety property: any
  // price the KB rewrites in `apply` mode STILL has to ground against
  // pricing_book + shared_* + tenant_custom_assemblies — an ungrounded KB
  // "correction" self-downgrades the whole quote to the $99 inspection
  // route, exactly like a drifted deterministic price. `shadow` only
  // appends [kb-verify] risk_flags for tradie review without touching a
  // customer-facing price. Best-effort + safe-degrade: KB disabled,
  // unreachable, low-confidence, or no parseable price → the draft is
  // bit-identical to the KB-off path. Default OFF → zero behaviour change.
  try {
    const kb = await runKbEstimateVerification(
      { intake, draft },
      {
        log: {
          ok: (m: string, x?: unknown) => cacheLog.ok(m, x as any),
          err: (m: string, x?: unknown) =>
            cacheLog.err(m, (typeof x === 'string' ? x : x == null ? null : String(x)) as any),
        },
      },
    )
    if (kb) {
      // R10 — KB apply-mode grounding integrity. When the KB rewrites a
      // line's price, stamp the line with an explicit KB-origin marker and
      // surface it via risk_flags so a stale/incorrect KB price cannot
      // silently launder through the loose category grounding path: the
      // main validateQuoteGrounding pass (which runs AFTER this) still
      // re-checks every KB-rewritten price, and now its provenance is
      // visible to operators. No-op in shadow/off (zero corrections).
      if (kb.mode === 'apply' && kb.reconciliation.corrections.length > 0) {
        const r10 = markKbRewrittenLines(draft, kb.reconciliation.corrections)
        if (r10.stamped > 0) {
          cacheLog.ok('R10 — stamped KB-rewritten prices with origin marker (re-ground + operator-visible)', {
            stamped: r10.stamped,
          })
        }
      }
      trace('estimate', kb.reconciliation.summary.mismatch > 0 ? 'warn' : 'ok', {
        substep: 'kb_verify',
        message: `MT-QM-PRICING-KB verification (${kb.mode})`,
        decisions: {
          mode: kb.mode,
          confirmed: kb.reconciliation.summary.confirmed,
          mismatch: kb.reconciliation.summary.mismatch,
          uncovered: kb.reconciliation.summary.uncovered,
          flagged: kb.flagged,
          corrected: kb.corrected,
        },
      })
    }
  } catch (e: any) {
    // KB verification must NEVER block estimation.
    cacheLog.err('KB verification errored — continuing without it', e?.message ?? String(e))
  }

  // Grounding pass: every line_item.unit_price_ex_gst MUST be derivable
  // from pricing_book + shared_materials + shared_assemblies + the
  // tenant's tenant_custom_assemblies (migration 023). If even one
  // line item fails grounding, downgrade the entire quote to inspection.
  // `candidates` was loaded above (before the recipe merge) so the R9
  // appended-extra micro-validation and this pass share one candidate set.
  const validateSw = stopwatch()
  const check = validateQuoteGrounding(draft, pricingBook as PricingBookForValidation, candidates)

  if (check.valid) {
    trace('estimate', 'ok', {
      substep: 'validate_grounding',
      message: 'all line items grounded',
      decisions: {
        good_subtotal: draft?.good?.subtotal_ex_gst ?? null,
        better_subtotal: draft?.better?.subtotal_ex_gst ?? null,
        best_subtotal: draft?.best?.subtotal_ex_gst ?? null,
        route: 'auto_quote',
      },
      duration_ms: validateSw.elapsed(),
    })
    // WP4 — link each grounded material line back to the operator
    // catalogue product that priced it (catalogue_id + image_path) so
    // the render can show THE EXACT product. STRICTLY render-only: this
    // runs AFTER grounding, mutates only render metadata, never a
    // price/total/route, and is best-effort (any failure → today's
    // text-only behaviour, no regression). The deterministic path has
    // already stamped exact links; enrichment is idempotent there.
    // Loaded once and reused by both WP4 enrichment and the WP9
    // live-product re-resolve below.
    let catalogueRefs: CatalogueProductRef[] = []
    try {
      catalogueRefs = await loadCatalogueProductRefs(
        (intake?.tenant_id as string | null) ?? null,
        (intake?.trade as string | null) ?? null,
      )
      if (catalogueRefs.length > 0) {
        const e = enrichLinesWithCatalogue(draft, catalogueRefs)
        if (e.linked > 0) {
          cacheLog.ok('WP4 — linked quote lines to operator catalogue products', {
            linked: e.linked,
          })
        }
      }
    } catch (err: any) {
      cacheLog.err(
        'WP4 catalogue-link enrichment failed (non-fatal — quote unaffected)',
        err?.message ?? String(err),
      )
    }

    // WP9 — if the customer picked a specific product mid-chat, FORCE it
    // (name + its catalogue price + photo) into every priced tier's
    // headline line. Deterministic, not a hint. Runs AFTER grounding;
    // the price is the operator's own catalogue price (the WP2-grounded
    // legitimate price the customer literally selected) so this is
    // consistent with the money model — same post-draft adjustment
    // pattern as applyMinLabourFloor. Flag-gated + best-effort.
    if (process.env.WP9_PRODUCT_OPTIONS === '1') {
      try {
        const chosen = (intake?.scope as { chosen_product?: any } | null)?.chosen_product
        if (chosen) {
          // The SMS offer froze a snapshot of the product when it was
          // sent. If the tradie uploaded/edited the photo or description
          // AFTER that, the snapshot is stale. Re-resolve the CURRENT
          // photo + blurb from the live catalogue row by id so the
          // latest uploaded image + description always win the render.
          const live = catalogueRefs.find(
            (rf) =>
              rf?.id != null &&
              chosen?.catalogue_id != null &&
              String(rf.id) === String(chosen.catalogue_id),
          )
          const chosenLive = {
            ...chosen,
            image_path:
              live?.image_path && String(live.image_path).trim() !== ''
                ? live.image_path
                : chosen.image_path ?? null,
            description:
              live?.description && String(live.description).trim() !== ''
                ? live.description
                : chosen.description ?? null,
          }
          // SPEC GUARD — does the product about to be locked contradict the
          // spec the customer agreed to (intake.scope.specs.requested_specs)?
          // Shadow (default) logs only; enforce skips the lock so a wrong-
          // spec product is never forced — the quote keeps its conventional
          // grounded Good/Better/Best. Degrade-never-block: only a positive
          // same-key contradiction blocks; unknown/missing never does.
          const guardMode = specGuardMode()
          let guardBlocked = false
          if (guardMode !== 'off') {
            try {
              const requestedSpecs =
                (intake?.scope as { specs?: { requested_specs?: unknown } } | null)
                  ?.specs?.requested_specs ?? null
              const decision = evaluateSpecGuard({
                requested: requestedSpecs as Record<string, string> | null,
                properties: chosen?.properties ?? null,
                name: chosen?.name,
                trade: (intake?.trade as string | null) ?? chosen?.trade ?? null,
                category: chosen?.category ?? null,
                mode: guardMode,
              })
              if (decision.verdict === 'mismatch') {
                cacheLog.err(
                  `WP9 spec guard [${guardMode}] — chosen product contradicts requested spec${decision.block ? ' (BLOCKED lock)' : ' (shadow — not blocked)'}`,
                  decision.reason,
                  { product: chosen?.name, conflicts: decision.conflicts },
                )
                guardBlocked = decision.block
              }
            } catch (gErr: any) {
              cacheLog.err('WP9 spec guard errored (non-fatal — lock proceeds)', gErr?.message ?? String(gErr))
            }
          }
          const r = guardBlocked
            ? { applied: [] as string[] }
            : applyChosenProduct(draft, chosenLive)
          if (r.applied.length > 0) {
            // The customer already PICKED one product — Good/Better/Best
            // no longer makes sense (all three now hold the same chosen
            // product at the same price, which reads as 3 confusing
            // identical tiers). Collapse to ONE option: keep the chosen
            // tier, drop the others. The SMS builder + /q page + Stripe
            // pay-links already support <3 tiers (this is the same shape
            // as "BEST dropped"), so this is safe.
            const keep = (r.applied.includes('good')
              ? 'good'
              : r.applied[0]) as 'good' | 'better' | 'best'
            if (draft[keep]) {
              for (const t of ['good', 'better', 'best'] as const) {
                if (t !== keep) draft[t] = null
              }
              draft.selected_tier = keep
            }
            cacheLog.ok('WP9 — chosen product forced into the quote (single option)', {
              product: chosen?.name,
              price: chosen?.price_ex_gst,
              kept_tier: keep,
            })
          }
        }
      } catch (err: any) {
        cacheLog.err(
          'WP9 chosen-product apply failed (non-fatal — quote unaffected)',
          err?.message ?? String(err),
        )
      }
    }

    // Phase 1 — when set true by R14 (post-reconcile re-check) or R15
    // (hard spec mismatch with no safe tier), the success branch returns
    // the inspection downgrade instead of the auto-quote. Carries the
    // observability payload for the route handler + logs.
    let forcedInspection: {
      reason: string
      groundingFailures?: GroundingFailure[]
    } | null = null

    // R15b — populated when a partial spec-block removed some (not all)
    // priced tiers. Threaded onto the success return so the route handler
    // sees the structured downgrade signal (mirrors groundingFailures).
    let partialSpecBlock: EstimationResult['specBlock'] | null = null

    // ── Deterministic quote-integrity backstops (post-grounding, pre-return) ──
    // Grounding proved each UNIT price; these make the BILL consistent with
    // those proven prices, collapse fake-identical tiers, and flag a quantity
    // that disagrees with item_count — without fabricating a price, changing a
    // billed quantity, or downgrading a good quote. Best-effort: a failure here
    // must never break an already-grounded quote.
    try {
      // Undo product-picker labour over-billing (install line billed the item
      // count as hours) BEFORE the arithmetic pass, so reconcileTierMath then
      // re-asserts a consistent bill on the corrected hours. Reduce-only; no-op
      // unless the model's own "minimum job allowance" line proves the tier was
      // topped to the floor yet total labour exceeds it.
      const labour = reconcileInflatedLabour(draft, {
        itemCount: intake?.scope?.item_count,
        minLabourHours: (pricingBook as any)?.min_labour_hours,
        hourlyRate: (pricingBook as any)?.hourly_rate,
      })
      if (labour.corrections.length > 0) {
        cacheLog.ok('inflated-labour backstop applied (picker count-as-hours fix)', {
          corrections: labour.corrections,
        })
      }
      const { corrections } = reconcileTierMath(draft)
      collapseDuplicateTiers(draft)
      const qtyFlags = checkQuantityVsItemCount(draft, intake?.scope?.item_count)
      if (qtyFlags.length > 0) {
        draft.risk_flags = [
          ...(Array.isArray(draft.risk_flags) ? draft.risk_flags : []),
          ...qtyFlags,
        ]
      }
      if (corrections.length > 0 || qtyFlags.length > 0 || labour.corrections.length > 0) {
        cacheLog.ok('reconcile backstops applied', {
          math_corrections: corrections.length,
          quantity_flags: qtyFlags.length,
          labour_corrections: labour.corrections.length,
        })
      }

      // R14 — POST-RECONCILIATION RE-CHECK. reconcileInflatedLabour +
      // reconcileTierMath rewrite line totals / labour hours / subtotals
      // AFTER the grounding pass already proved every unit price. Those
      // helpers are arithmetic-only and reduce-only by design, but this
      // is the deterministic backstop that PROVES it: re-run the grounding
      // validator over the post-reconcile draft. If any priced line's
      // (unit_price_ex_gst, unit) no longer matches a grounded candidate
      // — i.e. reconciliation arithmetic somehow introduced an ungrounded
      // number — downgrade the whole quote to inspection (existing
      // behaviour) and log. Only runs when at least one reconcile op
      // actually changed the draft, so a clean quote pays nothing.
      if (corrections.length > 0 || labour.corrections.length > 0) {
        const recheck = validateQuoteGrounding(
          draft,
          pricingBook as PricingBookForValidation,
          candidates,
        )
        if (!recheck.valid) {
          forcedInspection = {
            reason:
              `Pricing not yet available — ${recheck.failures.length} line item(s) failed the ` +
              `post-reconciliation grounding re-check. A site visit is needed before we can quote accurately.`,
            groundingFailures: recheck.failures,
          }
          cacheLog.err(
            'R14 CRITICAL — post-reconcile re-check found an ungrounded price; downgrading to inspection',
            null,
            {
              failure_count: recheck.failures.length,
              failures: recheck.failures.slice(0, 10).map((f) => ({
                tier: f.tier,
                lineIndex: f.lineIndex,
                description: f.description?.slice(0, 80),
                price: f.unit_price_ex_gst,
                expected: f.expected,
              })),
            },
          )
        }
      }
    } catch (err: any) {
      cacheLog.err(
        'reconcile backstops failed (non-fatal — quote unaffected)',
        err?.message ?? String(err),
      )
    }

    // Main-path spec guard. The WP9 block above
    // already guards a customer-CHOSEN product; this covers the ~95% of quotes
    // where the model picked the product. It reconciles each tier's headline
    // product against the customer's agreed specs (intake.scope.specs.
    // requested_specs) — e.g. agreed 15A GPO vs a quoted 10A, using the
    // backfilled catalogue amperage. SHADOW only logs the rate; ENFORCE
    // appends a [spec-guard] risk flag that the dispatch route treats as
    // tradie-review-only customer release.
    // Best-effort — never breaks an already-grounded quote.
    try {
      const guardMode = specGuardMode()
      const requested =
        (intake?.scope as { specs?: { requested_specs?: unknown } } | null)?.specs
          ?.requested_specs ?? null
      const wp9Handled =
        process.env.WP9_PRODUCT_OPTIONS === '1' &&
        !!(intake?.scope as { chosen_product?: unknown } | null)?.chosen_product
      if (guardMode !== 'off' && requested && !wp9Handled) {
        const category = categoryForJobType((intake?.job_type as string | null) ?? null)
        if (category) {
          const productRows = await loadCategorySpecRows(
            (intake?.tenant_id as string | null) ?? null,
            (intake?.trade as string | null) ?? null,
            category,
          )
          const results = evaluateDraftSpecGuard({
            draft,
            requested: requested as Record<string, string> | null,
            trade: (intake?.trade as string | null) ?? null,
            category,
            productRows,
            mode: guardMode,
          })
          const mismatches = results.filter((r) => r.decision.verdict === 'mismatch')
          if (mismatches.length > 0) {
            cacheLog.err(
              `spec guard [${guardMode}] main-path — ${mismatches.length} tier(s) contradict the requested spec (${guardMode === 'enforce' ? 'BLOCKING bad tier(s)' : 'shadow — observe only'})`,
              mismatches.map((m) => `${m.tier}: ${m.decision.reason}`).join(' | '),
            )
            // R15 — SPEC-MISMATCH HANDLING.
            //   • SHADOW (and the old enforce behaviour): logging + risk_flag
            //     only — never blocks. Unchanged.
            //   • ENFORCE: a HARD spec mismatch must ACT, not ship silently.
            //     A product that contradicts the customer's agreed spec
            //     (e.g. customer said 15A GPO, model picked 10A) is removed:
            //     partial mismatch → the offending tier(s) are nulled
            //     (blocked); ALL priced tiers mismatch → the whole quote is
            //     routed to inspection so a wrong-spec product never reaches
            //     the customer.
            if (guardMode === 'enforce') {
              const mismatchTiers = mismatches.map((m) => ({
                tier: m.tier as 'good' | 'better' | 'best',
                reason: m.decision.reason ?? 'spec mismatch',
              }))
              const r15 = enforceSpecMismatch(draft, mismatchTiers, guardMode)
              if (r15.routeToInspection) {
                forcedInspection = {
                  reason:
                    'Spec mismatch — every quoted option contradicts the specification you agreed to. ' +
                    'A site visit is needed so we can confirm the right product before quoting.',
                }
                cacheLog.err(
                  'R15 — all priced tiers contradict the agreed spec; downgrading to inspection',
                  mismatchTiers.map((m) => `${m.tier}: ${m.reason}`).join(' | '),
                )
              } else if (r15.blockedTiers.length > 0) {
                // R15b — surface the partial block the same way the grounding
                // path surfaces its downgrade, so the route's routing +
                // risk_flags treat it consistently (review-required) rather
                // than seeing a tier that vanished with only a soft note.
                // enforceSpecMismatch already stamped draft.spec_block +
                // draft.needs_review; mirror it onto the result here.
                partialSpecBlock = {
                  partial: true,
                  blocked_tiers: [...r15.blockedTiers],
                  reasons: mismatchTiers.filter((m) =>
                    r15.blockedTiers.includes(m.tier),
                  ),
                }
                cacheLog.err(
                  `R15 — blocked ${r15.blockedTiers.length} spec-contradicting tier(s); kept the spec-correct option(s)`,
                  null,
                  { blocked: r15.blockedTiers },
                )
                trace('estimate', 'warn', {
                  substep: 'spec_block_partial',
                  message: `R15 partial spec-block — ${r15.blockedTiers.length} tier(s) removed, spec-correct tier(s) kept`,
                  decisions: { blocked_tiers: r15.blockedTiers, route: 'tradie_review' },
                })
              }
            } else {
              // Shadow — observe only (append risk flags, never block).
              draft.risk_flags = [
                ...(Array.isArray(draft.risk_flags) ? draft.risk_flags : []),
                ...mismatches.map((m) => `[spec-guard] ${m.tier}: ${m.decision.reason}`),
              ]
            }
          }
        }
      }
    } catch (err: any) {
      cacheLog.err(
        'main-path spec guard failed (non-fatal — quote unaffected)',
        err?.message ?? String(err),
      )
    }

    // Phase 1 (R14 / R15) — a post-grounding integrity step forced the
    // whole quote to inspection (post-reconcile re-check found an
    // ungrounded number, or every priced tier contradicted the agreed
    // spec). Return the same inspection-downgrade shape the grounding-fail
    // path uses so the route handler doesn't build three-tier Stripe
    // sessions. This NEVER loosens grounding — it only adds reasons to
    // route to the safe $99 inspection.
    if (forcedInspection) {
      const downgraded = {
        ...draft,
        good: null,
        better: null,
        best: null,
        needs_inspection: true,
        inspection_reason: resolveInspectionReason(forcedInspection.reason),
        pricing_path: 'inspection',
        estimated_timeframe: 'After site visit (within 5 business days)',
      }
      trace('estimate', 'warn', {
        substep: 'done',
        message: 'returned inspection-downgrade (phase-1 integrity gate)',
        decisions: { route: 'inspection', cause: 'phase1_integrity' },
        duration_ms: totalSw.elapsed(),
      })
      return {
        draft: downgraded,
        ...(forcedInspection.groundingFailures
          ? { groundingFailures: forcedInspection.groundingFailures }
          : {}),
        downgradedToInspection: true,
      }
    }

    // R9 — deterministic sanity-bounds backstop. A fully-grounded quote can
    // still be grossly mis-sized (the 6-downlight-17.5h class) — per-line
    // grounding can't see the total. If the quote is outside its
    // per-(trade,job_type) band, route to the $99 inspection (NOT auto-
    // corrected; an out-of-band total signals a misread scope). Opt-in: only
    // job types with a job_type_bounds row are checked; table-missing / no row
    // → no-op, so this is inert where bounds aren't seeded.
    const sanity = await checkDraftSanityBounds(draft, intake)
    if (!sanity.ok) {
      cacheLog.err('sanity-bounds out of band — routing to inspection (R9)', null, { failures: sanity.failures })
      const downgraded = forceInspectionTiers({ ...draft }) as typeof draft
      downgraded.needs_inspection = true
      downgraded.inspection_reason = resolveInspectionReason('on-site check needed to confirm scope and quantities')
      downgraded.estimated_timeframe = 'After site visit (within 5 business days)'
      trace('estimate', 'warn', {
        substep: 'done',
        message: 'sanity-bounds out of band → inspection (R9)',
        decisions: { route: 'inspection', cause: 'sanity_bounds', failures: sanity.failures },
        duration_ms: totalSw.elapsed(),
      })
      return { draft: downgraded, downgradedToInspection: true }
    }

    trace('estimate', partialSpecBlock ? 'warn' : 'ok', {
      substep: 'done',
      message: partialSpecBlock
        ? 'quote returned with partial spec-block (spec-correct tier(s) kept, review-required)'
        : 'auto-quote returned (grounded, enriched)',
      decisions: {
        route: partialSpecBlock ? 'tradie_review' : 'auto_quote',
        tier_count: ['good', 'better', 'best'].filter((k) => draft?.[k]).length,
        ...(partialSpecBlock ? { spec_blocked_tiers: partialSpecBlock.blocked_tiers } : {}),
      },
      duration_ms: totalSw.elapsed(),
    })
    return {
      draft,
      ...(partialSpecBlock ? { specBlock: partialSpecBlock } : {}),
    }
  }

  // Log every failure so the next-time diagnosis is one log query away.
  // Without this the only signal we have is the count, which masks
  // whether the failures are price-band, semantic-category, or labour-rate.
  cacheLog.err('grounding validation failed — per-line failures follow', null, {
    inspection_cause: 'grounding_failed',
    failure_count: check.failures.length,
    failures: check.failures.map((f) => ({
      tier: f.tier,
      lineIndex: f.lineIndex,
      description: f.description?.slice(0, 80),
      unit: f.unit,
      price: f.unit_price_ex_gst,
      expected: f.expected,
    })),
  })
  trace('estimate', 'err', {
    substep: 'validate_grounding',
    message: `grounding validation failed — ${check.failures.length} line(s) ungrounded`,
    outputs: {
      failure_count: check.failures.length,
      failures: check.failures.slice(0, 10).map((f) => ({
        tier: f.tier,
        line_index: f.lineIndex,
        description: f.description?.slice(0, 80),
        unit: f.unit,
        price: f.unit_price_ex_gst,
        expected: f.expected,
      })),
    },
    decisions: {
      route: 'inspection',
      cause: 'grounding_failed',
    },
    duration_ms: validateSw.elapsed(),
  })

  const reason = `Pricing not yet available — ${check.failures.length} line item(s) failed grounding check against the database. A site visit is needed before we can quote accurately.`

  const downgraded = {
    ...draft,
    good: null,
    better: null,
    best: null,
    needs_inspection: true,
    inspection_reason: resolveInspectionReason(reason),
    pricing_path: 'inspection',
    estimated_timeframe: 'After site visit (within 5 business days)',
    // Preserve scope_short for the SMS, but null the assumptions if they
    // referenced fabricated prices/inclusions.
  }

  trace('estimate', 'warn', {
    substep: 'done',
    message: 'returned inspection-downgrade (grounding failed)',
    decisions: { route: 'inspection', cause: 'grounding_failed' },
    duration_ms: totalSw.elapsed(),
  })

  return {
    draft: downgraded,
    groundingFailures: check.failures,
    downgradedToInspection: true,
  }
}

/**
 * Load every shared_materials and shared_assemblies row (name + price) and
 * expand each into raw + marked-up candidate prices so the validator can
 * enforce both price-grounding AND semantic-category-grounding.
 *
 * v5 multi-trade: pass `trade` to scope candidates to the intake's trade.
 * Without this filter, an electrical quote could "pass" validation by
 * coincidentally matching a plumbing price — the trade column is now the
 * canonical scope.
 *
 * v6+ migration 023: also pulls tenant_custom_assemblies for this tenant
 * so prices the LLM grounded on a tenant-owned custom assembly pass
 * validation. always_inspection=true rows are excluded (matching the
 * tool exclusion) so the validator never accepts a price derived from
 * a service the tradie wanted to always inspect.
 *
 * Exported for re-use by /api/quote/[id]/edit so tradie hand-edits get the
 * same grounding gate the LLM draft gets (H-2, 2026-05-25).
 */
/**
 * Phase 3 (2026-05-27) — recipe context loader for mergeRecipesIntoDraft.
 *
 * Returns two parallel maps keyed by assembly_id:
 *   • recipesByAssemblyId — the parsed PriceQuestion[] for any
 *     shared_assemblies / tenant_custom_assemblies row whose
 *     price_recipe column is set
 *   • assembliesById — name + default_unit_price + default_labour_hours
 *     for EVERY assembly in the trade+tenant scope, so the merge module
 *     can resolve assembly_override_id swaps regardless of whether the
 *     swap target itself carries a recipe.
 *
 * Both maps are scoped to the intake's trade + tenant (with the same
 * always_inspection=false filter that loadCandidatePrices uses for
 * tenant_custom_assemblies — we never let the recipe path price a
 * service the tradie wants to always inspect).
 *
 * Deploy-order-safe: a pre-074 prod (no price_recipe column) yields
 * recipesByAssemblyId.size === 0, which short-circuits the merge in
 * runEstimation to a no-op. Same SELECT * approach used by
 * loadCandidatePrices for the same reason.
 */
async function loadRecipeContext(
  trade: string | null,
  tenantId: string | null,
): Promise<{
  recipesByAssemblyId: Map<string, readonly PriceQuestion[]>
  assembliesById: Map<string, AssemblyMeta>
}> {
  let sharedQ = supabase.from('shared_assemblies').select('*')
  if (trade) sharedQ = sharedQ.eq('trade', trade)

  const tenantCustomPromise = tenantId
    ? (() => {
        let q = supabase
          .from('tenant_custom_assemblies')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('always_inspection', false)
        if (trade) q = q.eq('trade', trade)
        return q
      })()
    : Promise.resolve({ data: [] as any[] })

  const [{ data: shared }, { data: custom }] = await Promise.all([
    sharedQ,
    tenantCustomPromise,
  ])

  const recipesByAssemblyId = new Map<string, readonly PriceQuestion[]>()
  const assembliesById = new Map<string, AssemblyMeta>()

  for (const row of (shared ?? []) as any[]) {
    if (!row?.id) continue
    assembliesById.set(row.id, {
      id: row.id,
      name: row.name,
      default_unit_price_ex_gst: row.default_unit_price_ex_gst,
      default_labour_hours: row.default_labour_hours,
    })
    if (Array.isArray(row.price_recipe) && row.price_recipe.length > 0) {
      recipesByAssemblyId.set(row.id, row.price_recipe as PriceQuestion[])
    }
  }
  // Tenant custom rows override shared by id (custom never shares an id
  // with shared via UUID birthright; this loop is additive — sets that
  // key for any tenant-owned id that wasn't in shared).
  for (const row of (custom ?? []) as any[]) {
    if (!row?.id) continue
    assembliesById.set(row.id, {
      id: row.id,
      name: row.name,
      default_unit_price_ex_gst: row.default_unit_price_ex_gst,
      default_labour_hours: row.default_labour_hours,
    })
    if (Array.isArray(row.price_recipe) && row.price_recipe.length > 0) {
      recipesByAssemblyId.set(row.id, row.price_recipe as PriceQuestion[])
    }
  }

  return { recipesByAssemblyId, assembliesById }
}

export async function loadCandidatePrices(
  pricingBook: any,
  trade: string | null,
  tenantId: string | null,
  strictMarkup = false,
) {
  const materialsQuery = supabase
    .from('shared_materials')
    .select('*')
  // select('*') (not an explicit column list) so a pre-029 prod where
  // `category` doesn't exist yet can't turn into a PostgREST
  // missing-column error → null data → ZERO assembly candidates → every
  // quote dumped to inspection. Missing column just yields
  // r.category===undefined → null → name-regex fallback. Same pattern as
  // tools.ts makeLookupAssembly. Makes code/migration deploy order safe.
  const assembliesQuery = supabase
    .from('shared_assemblies')
    .select('*')

  // M-6 (2026-05-25) — DELIBERATE difference from the lookup tools.
  // The tools filter `enabled=true` / `active=true` so DISABLED rows are
  // never offered to a NEW quote. But the VALIDATOR's job is different
  // — it accepts prices that Opus already chose. If a tradie disables a
  // product seconds after Opus grounded a draft on it, the row vanishes
  // from the validator's candidate set and the otherwise-valid quote
  // dumps to a $99 inspection. That race is purely time-based and
  // operator-visible to no-one.
  //
  // The fix: load ALL tenant rows for this trade as candidates, not
  // just currently-active ones. `always_inspection=true` rows are STILL
  // excluded because they're a different semantic (services the tradie
  // explicitly wants to inspect, not "I deactivated this product").
  // shared_assemblies + shared_materials have no enabled/active flag,
  // so they remain unchanged.
  const customAssembliesPromise = tenantId
    ? (() => {
        let q = supabase
          .from('tenant_custom_assemblies')
          .select('*') // see assembliesQuery note — deploy-order-safe
          .eq('tenant_id', tenantId)
          // .eq('enabled', true) ← REMOVED (M-6). See block comment above.
          .eq('always_inspection', false)
        if (trade) q = q.eq('trade', trade)
        return q
      })()
    : Promise.resolve({ data: [] as Array<{ name: string; default_unit_price_ex_gst: number | string; trade: string; category: string | null }> })

  // WP2 TRAP-FIX (lockstep with tools.ts makeLookupMaterial): lookupMaterial
  // now returns operator-owned tenant_material_catalogue rows (migration
  // 028), so the validator MUST accept prices grounded on them or every
  // branded quote is downgraded to inspection. Absent table (prod pre-028)
  // → supabase-js returns {data:null} (no throw) → [] → behaviour identical
  // to pre-WP2.
  //
  // M-6 (2026-05-25) — like customAssembliesPromise above, the `active=true`
  // filter is DELIBERATELY OMITTED here. Deactivating a product is a
  // tradie-facing UX action; it shouldn't retroactively invalidate a
  // draft Opus has already grounded on. The lookup tool still filters
  // active=true so no NEW draft will reach for the deactivated row.
  //
  // R-3 (2026-05-25) — `id` is now in the SELECT so the validator's
  // strict UUID path can resolve `source: "material:<id>"` lines back
  // to the exact catalogue row.
  const tenantCataloguePromise = tenantId
    ? (() => {
        let q = supabase
          .from('tenant_material_catalogue')
          .select('id, name, category, unit_price_ex_gst, customer_supply_price_ex_gst, active, trade')
          .eq('tenant_id', tenantId)
          // .eq('active', true) ← REMOVED (M-6). See block comment above.
        if (trade) q = q.eq('trade', trade)
        return q
      })()
    : Promise.resolve({ data: [] as Array<{ id?: string; name: string; unit_price_ex_gst: number | string; customer_supply_price_ex_gst: number | string | null; active: boolean; trade: string }> })

  const [
    { data: materials },
    { data: assemblies },
    { data: customAssemblies },
    { data: tenantCatalogue },
  ] = await Promise.all([
    trade ? materialsQuery.eq('trade', trade) : materialsQuery,
    trade ? assembliesQuery.eq('trade', trade) : assembliesQuery,
    customAssembliesPromise,
    tenantCataloguePromise,
  ])

  // Merge shared + custom assemblies into one candidate set — the
  // validator treats them identically as a (name, price) pair.
  const allAssemblies = [
    ...(assemblies ?? []),
    ...(customAssemblies ?? []),
  ]

  // Expand the tenant catalogue (supply + customer-supply price variants)
  // into material candidates so a branded tenant-priced line grounds.
  const tenantMaterialCandidates = catalogueCandidateRows(
    (tenantCatalogue ?? []) as any[],
  )

  // R-3 (2026-05-25) — propagate the DB row `id` through the candidate
  // builder so the validator's strict path can match by UUID. Shared
  // rows (shared_materials, shared_assemblies) carry an id since they
  // were created with `gen_random_uuid()` (sql/init.sql). Tenant rows
  // (tenant_material_catalogue, tenant_custom_assemblies) likewise.
  return buildCandidatePrices(
    [
      ...(materials ?? []).map((r: any) => ({
        id: r.id ?? null,
        name: r.name,
        price: r.default_unit_price_ex_gst,
        category: r.category ?? null,
      })),
      ...tenantMaterialCandidates,
    ],
    // Migration 029: pass the explicit row category through. NULL on
    // pre-029 prod or un-backfilled rows → buildCandidatePrices falls
    // back to name-regex categorisation (identical to old behaviour).
    allAssemblies.map((r: any) => ({
      id: r.id ?? null,
      name: r.name,
      price: r.default_unit_price_ex_gst,
      category: r.category ?? null,
    })),
    pricingBook,
    { strictMarkup },
  )
}

// R9 — load the per-(trade, job_type) sanity band and check a built draft
// against it. Defensive: any DB/shape problem → no bound → ok (a bounds-load
// failure must never block a quote). Bounds are opt-in — only job types with a
// job_type_bounds row are gated; everything else is a clean no-op.
async function checkDraftSanityBounds(
  draft: any,
  intake: any,
): Promise<{ ok: true } | { ok: false; failures: string[] }> {
  const trade = intake?.trade
  const jobType = intake?.job_type
  if (!trade || !jobType) return { ok: true }
  let bounds: JobTypeBound[] = []
  try {
    const { data } = await supabase
      .from('job_type_bounds')
      .select('*')
      .eq('trade', trade)
      .eq('job_type', jobType)
    bounds = (data ?? []) as JobTypeBound[]
  } catch {
    return { ok: true }
  }
  const bound = boundForJob(bounds, trade, jobType)
  if (!bound) return { ok: true }
  const qty = Number(intake?.scope?.item_count) || null
  for (const tier of ['good', 'better', 'best'] as const) {
    const t = draft?.[tier]
    if (!t || !Array.isArray(t.line_items)) continue
    const totalLabourHours = t.line_items
      .filter((l: any) => l.source === 'labour' || l.unit === 'hr')
      .reduce((s: number, l: any) => s + (Number(l.quantity) || 0), 0)
    const totalExGst =
      Number(t.subtotal_ex_gst) ||
      t.line_items.reduce((s: number, l: any) => s + (Number(l.total_ex_gst) || 0), 0)
    const v = checkSanityBounds(
      { jobType, trade, quantity: qty, totalLabourHours, totalExGst },
      bound,
    )
    if (!v.ok) return v
  }
  return { ok: true }
}

/**
 * Build the "Preferred brands" hint block for the user message.
 *
 * Reads tenant_material_preferences and joins to shared_materials to
 * confirm each (category, brand) pair still exists in the catalogue.
 * Returns null when:
 *   • intake has no tenant_id (legacy pre-v6 or dev intakes)
 *   • the tenant has set no preferences
 *   • the preferences table is unavailable (migration 022 not run)
 *
 * Lives in the USER message, not the system message, so per-tenant
 * variance doesn't fragment the system-prompt cache. The system prompt
 * stays identical across all tenants — only the per-call user message
 * carries tenant-specific hints.
 *
 * Soft instruction phrasing: "prefer X when matching candidates exist"
 * — never starves a quote when the customer needs a tier the preferred
 * brand can't fulfil.
 */
async function buildPreferencesBlock(
  tenantId: string | null,
  trade: string | null,
  log: ReturnType<typeof pipelineLog>,
): Promise<string | null> {
  if (!tenantId) return null

  try {
    const { data, error } = await supabase
      .from('tenant_material_preferences')
      .select('category, preferred_brand')
      .eq('tenant_id', tenantId)

    if (error) {
      // Table missing or RLS blocking — log + carry on. Estimation
      // continues without preferences (current behaviour pre-022).
      log.err('preferences fetch failed — continuing without brand hints', error.message)
      return null
    }
    if (!data || data.length === 0) return null

    // Scope hints to the intake's trade so an electrical quote doesn't
    // see plumbing-side brand picks. We join to shared_materials.category
    // to filter — but a single category slug can technically be reused
    // across trades (e.g. "sundries"), so we use an IN-list filter via
    // a category lookup rather than assuming exclusivity.
    if (trade) {
      const categories = data.map((p) => p.category as string)
      const { data: catRows } = await supabase
        .from('shared_materials')
        .select('category')
        .in('category', categories)
        .eq('trade', trade)
        .limit(categories.length * 4)

      const validCategories = new Set<string>(
        (catRows ?? []).map((r) => r.category as string),
      )
      const scoped = data.filter((p) =>
        validCategories.has(p.category as string),
      )
      if (scoped.length === 0) return null
      return formatPreferencesBlock(scoped)
    }

    return formatPreferencesBlock(data)
  } catch (e: any) {
    log.err('preferences block build failed', e?.message ?? String(e))
    return null
  }
}

function formatPreferencesBlock(
  rows: Array<{ category: string | null; preferred_brand: string | null }>,
): string {
  const lines = rows
    .filter((r): r is { category: string; preferred_brand: string } =>
      typeof r.category === 'string' && typeof r.preferred_brand === 'string',
    )
    .map((r) => `  • ${r.category}: ${r.preferred_brand}`)

  if (lines.length === 0) return ''

  return [
    'Tradie preferred brands (soft hint — apply ONLY when picking materials):',
    ...lines,
    'When multiple shared_materials candidates fit the customer\'s tier and specs,',
    'prefer the row whose brand matches the tradie\'s preference for that category.',
    'If no preferred-brand candidate matches the customer\'s actual need, pick the',
    'best fit regardless of brand — never sacrifice tier/spec match for brand.',
    'Grounding validation runs after your output regardless of brand choice.',
  ].join('\n')
}

/**
 * WP2 — operator catalogue hint. Lists the tenant's active
 * tenant_material_catalogue rows (brand + range -> tier) so Opus
 * prefers their real products. Resilient: missing table / no rows /
 * error -> null, so legacy tenants are unaffected.
 */
async function buildCatalogueHint(
  tenantId: string | null,
  trade: string | null,
  log: ReturnType<typeof pipelineLog>,
): Promise<string | null> {
  if (!tenantId) return null
  try {
    let q = supabase
      .from('tenant_material_catalogue')
      .select('category, name, brand, range_series, tier_hint')
      .eq('tenant_id', tenantId)
      .eq('active', true)
    if (trade) q = q.eq('trade', trade)
    const { data, error } = await q
    if (error) {
      log.err('catalogue hint fetch failed — continuing without it', error.message)
      return null
    }
    const baseHint = formatCatalogueHint((data ?? []) as CatalogueHintRow[])

    // v7 Phase 3 — prepend the tenant's explicit Good/Better/Best ladder
    // (tenant_tier_ladder, migration 043) when present. The ladder hint is
    // the strongest soft signal we surface; the grounding validator still
    // governs the money path regardless. Resilient: missing table /
    // empty ladder → baseHint unchanged.
    try {
      let lq = supabase
        .from('tenant_tier_ladder')
        .select(
          'category, tier, ' +
            'tenant_material_catalogue!inner ( name, brand, trade )',
        )
        .eq('tenant_id', tenantId)
      if (trade) lq = lq.eq('tenant_material_catalogue.trade', trade)
      const { data: ladderRows } = await lq
      const hintRows: TierLadderHintRow[] = []
      for (const r of (ladderRows ?? []) as any[]) {
        const cat = r.category as string
        const tier = r.tier as TierLadderHintRow['tier']
        const tmc = Array.isArray(r.tenant_material_catalogue)
          ? r.tenant_material_catalogue[0]
          : r.tenant_material_catalogue
        if (!tmc) continue
        hintRows.push({
          category: cat,
          tier,
          product_name: tmc.name as string,
          brand: (tmc.brand ?? null) as string | null,
        })
      }
      const ladderHint = formatTierLadderHint(hintRows)
      if (ladderHint && baseHint) return `${ladderHint}\n\n${baseHint}`
      if (ladderHint) return ladderHint
    } catch (e: any) {
      // Pre-043 prod / FK absent → fall through to baseHint quietly.
      log.err('tier ladder hint fetch failed — continuing without it', e?.message ?? String(e))
    }
    return baseHint
  } catch (e: any) {
    log.err('catalogue hint build failed', e?.message ?? String(e))
    return null
  }
}

/**
 * WP3 — structured bill-of-materials hint. Finds shared_assemblies that
 * match the job, pulls their shared_assembly_bom rows, and lists the
 * baseline parts so the same job quotes the same parts every time.
 * Resilient: no matching assembly / unseeded BOM / error -> null.
 */
async function buildBomHint(
  intake: any,
  trade: string | null,
  log: ReturnType<typeof pipelineLog>,
): Promise<string | null> {
  const jobType = (intake?.job_type as string | null) ?? null
  if (!jobType) return null
  try {
    const term = jobType.replace(/_/g, ' ')
    let aq = supabase.from('shared_assemblies').select('id, name, trade').ilike('name', `%${term}%`)
    if (trade) aq = aq.eq('trade', trade)
    const { data: asm, error: aerr } = await aq.limit(5)
    if (aerr || !asm || asm.length === 0) return null
    const ids = asm.map((a: any) => a.id)
    const tenantId = (intake?.tenant_id as string | null) ?? null

    // Prefer this tradie's OWN recipe (tenant_assembly_bom, migration
    // 031) over the shared baseline. Absent table (prod pre-031) →
    // supabase returns {data:null} (no throw) → [] → falls back to
    // shared, so this is purely additive / no behaviour change.
    if (tenantId) {
      const { data: ownBom } = await supabase
        .from('tenant_assembly_bom')
        .select('material_category, quantity, required, description, sort')
        .eq('tenant_id', tenantId)
        .in('assembly_id', ids)
        .order('sort', { ascending: true })
      if (ownBom && ownBom.length > 0) {
        return formatBomHint(ownBom as BomHintRow[])
      }
    }

    const { data: bom, error: berr } = await supabase
      .from('shared_assembly_bom')
      .select('material_category, quantity, required, description, sort')
      .in('assembly_id', ids)
      .order('sort', { ascending: true })
    if (berr) {
      log.err('BOM hint fetch failed — continuing without it', berr.message)
      return null
    }
    return formatBomHint((bom ?? []) as BomHintRow[])
  } catch (e: any) {
    log.err('BOM hint build failed', e?.message ?? String(e))
    return null
  }
}

/**
 * WP2 historical-pricing (safe slice). Best-effort: pulls THIS tenant's
 * own past priced quotes for the same job_type (the same data RAG
 * already uses — no external import) and summarises them into a SOFT
 * per-tier $ band hint. Resilient: missing rows / error / too-few
 * samples → null (no hint, behaviour unchanged). NEVER feeds the
 * validator — advisory only.
 */
async function buildPriceHistoryHint(
  tenantId: string | null,
  jobType: string | null,
  log: ReturnType<typeof pipelineLog>,
): Promise<string | null> {
  if (!tenantId || !jobType) return null
  try {
    const { data, error } = await supabase
      .from('quotes')
      .select('good, better, best, needs_inspection, created_at, intakes!inner(tenant_id, job_type)')
      .eq('intakes.tenant_id', tenantId)
      .eq('intakes.job_type', jobType)
      .order('created_at', { ascending: false })
      .limit(60)
    if (error) {
      log.err('price-history hint fetch failed — continuing without it', error.message)
      return null
    }
    const past: PastQuoteTiers[] = (data ?? [])
      .filter((r: any) => r?.needs_inspection !== true)
      .map((r: any) => ({
        good: r?.good?.subtotal_ex_gst ?? null,
        better: r?.better?.subtotal_ex_gst ?? null,
        best: r?.best?.subtotal_ex_gst ?? null,
      }))
    return formatPriceHistoryHint(summarisePriceHistory(past, jobType))
  } catch (e: any) {
    log.err('price-history hint build failed', e?.message ?? String(e))
    return null
  }
}

/**
 * Phase 3 (spec 2026-06-19) — pure formatter for the per-tenant grounding
 * block. Takes the KbSearchResult from searchTenantStore and renders a
 * short, clearly-labelled ADVISORY block for the drafting prompt — or null
 * when there's nothing useful to add.
 *
 * Extracted as a pure (no-I/O) helper so it is trivially unit-testable
 * offline (see run.grounding.test.ts) and so the labelling / length-cap /
 * "do-not-price" framing live in exactly one place.
 *
 * SAFETY: the returned text is appended ONLY to the user-prompt background
 * (advisory). It is NEVER parsed for prices, never reaches the tools, the
 * candidate loader, or the grounding validator — so it cannot become a
 * price source. The block heading states this explicitly to the model.
 */
const TENANT_GROUNDING_MAX_CHARS = 1800

export function buildTenantGroundingBlock(
  result: KbSearchResult | null | undefined,
): string | null {
  if (!result) return null
  const answer = typeof result.answer === 'string' ? result.answer.trim() : ''
  const passages = Array.isArray(result.passages) ? result.passages : []

  // Build short snippet lines from cited passages (text + the doc it came
  // from), de-duplicated and individually length-capped so one huge passage
  // can't blow the budget.
  const seen = new Set<string>()
  const snippetLines: string[] = []
  for (const p of passages) {
    const text = typeof p?.text === 'string' ? p.text.trim().replace(/\s+/g, ' ') : ''
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const title =
      typeof p?.documentTitle === 'string' && p.documentTitle.trim() !== ''
        ? p.documentTitle.trim()
        : null
    const clipped = text.length > 300 ? `${text.slice(0, 300)}…` : text
    snippetLines.push(`  • ${clipped}${title ? ` (from: ${title})` : ''}`)
  }

  // Nothing grounded → no block (keeps the prompt clean / no empty heading).
  if (!answer && snippetLines.length === 0) return null

  const body: string[] = [
    'Your past similar jobs (advisory only — do not use as a price source):',
    'The following is background from THIS business\'s own past quotes/invoices,',
    'retrieved from their private records. Use it ONLY to inform scope, wording,',
    'and typical inclusions. It is NOT a price source — every price you output',
    'must still come from the pricing tools, and a grounding validator runs',
    'after your output regardless of anything written here.',
  ]
  if (answer) body.push('', answer.length > 700 ? `${answer.slice(0, 700)}…` : answer)
  if (snippetLines.length > 0) body.push('', 'Cited records:', ...snippetLines)

  const block = body.join('\n')
  return block.length > TENANT_GROUNDING_MAX_CHARS
    ? `${block.slice(0, TENANT_GROUNDING_MAX_CHARS)}…`
    : block
}

/**
 * Phase 3 (spec 2026-06-19) — per-tenant grounding hint.
 *
 * Resolves THIS tenant's own Gemini File Search store id (from
 * tenants.file_store_id, server-side only — never accepted from a client),
 * builds a query from the structured intake (job type + scope summary), and
 * asks searchTenantStore for relevant snippets from the tenant's own past
 * jobs/invoices. Returns a short advisory block (via buildTenantGroundingBlock)
 * or null.
 *
 * Best-effort + never-blocking: ANY problem (no tenant_id, no store id yet,
 * KB unavailable, query empty, error/timeout) → null, so the pipeline drafts
 * with the un-grounded prompt exactly as it does today. NEVER throws.
 *
 * Scoped strictly to the caller's own file_store_id, so no cross-tenant data
 * can enter the prompt. Indexed docs are PII-minimized at ingest, so the
 * snippets carry no customer PII.
 *
 * Only ever invoked behind the TENANT_FILESTORE_ENABLED flag in
 * runEstimation, so it is completely dormant until explicitly enabled.
 */
async function buildTenantGroundingHint(
  tenantId: string | null,
  intake: any,
  log: ReturnType<typeof pipelineLog>,
): Promise<string | null> {
  if (!tenantId) return null
  try {
    // Resolve the tenant's store id server-side (same Supabase access this
    // file already uses). null/empty → tenant has no store yet → no-op.
    const { data, error } = await supabase
      .from('tenants')
      .select('file_store_id')
      .eq('id', tenantId)
      .maybeSingle<{ file_store_id: string | null }>()
    if (error) {
      log.err('tenant grounding store lookup failed — continuing without it', error.message)
      return null
    }
    const storeId = data?.file_store_id ?? null
    if (!storeId) return null

    // Build a query from the structured intake: job type + a short scope
    // summary. Kept compact; the KB does the relevance retrieval.
    const query = buildTenantGroundingQuery(intake)
    if (!query) return null

    const result = await searchTenantStore({ storeId, query })
    const block = buildTenantGroundingBlock(result)
    if (block) {
      // Observable per the spec — show grounding context was added (no
      // snippet bodies in the log line; just that it fired + sizes).
      log.ok('tenant grounding context attached (advisory — never a price source)', {
        chars: block.length,
        passages: Array.isArray(result?.passages) ? result.passages.length : 0,
      })
    } else {
      log.ok('tenant grounding context skipped', { reason: 'no usable snippets' })
    }
    return block
  } catch (e: any) {
    // Grounding must NEVER block estimation. Log + carry on (un-grounded).
    log.err('tenant grounding hint build failed — continuing without it', e?.message ?? String(e))
    return null
  }
}

/**
 * Phase 3 — derive the retrieval query from the structured intake. Combines
 * job_type with a short scope summary (free-text + item_count) so the KB can
 * find the tenant's most similar past jobs. Returns null when there's nothing
 * meaningful to query on. Pure (no I/O) — small enough to inline-test if needed.
 */
export function buildTenantGroundingQuery(intake: any): string | null {
  const jobType =
    typeof intake?.job_type === 'string' ? intake.job_type.replace(/_/g, ' ').trim() : ''
  const scope = intake?.scope ?? null
  const scopeBits: string[] = []
  if (scope && typeof scope === 'object') {
    const summary =
      typeof scope.summary === 'string'
        ? scope.summary
        : typeof scope.description === 'string'
          ? scope.description
          : ''
    if (summary.trim()) scopeBits.push(summary.trim())
    const count = Number(scope.item_count)
    if (Number.isFinite(count) && count > 0) scopeBits.push(`quantity ${count}`)
  }
  const parts = [jobType, ...scopeBits].filter((s) => s && s.length > 0)
  if (parts.length === 0) return null
  const q = `Past similar jobs for: ${parts.join(' — ')}. What did this business quote and include?`
  // Cap the query length defensively.
  return q.length > 500 ? q.slice(0, 500) : q
}

/**
 * Phase 2 — load the DB inputs the deterministic BOM builder needs.
 * Returns { input:null, reason } whenever the job cannot be honoured
 * deterministically (no recipe / service switched off / no rate) so
 * the caller falls straight back to the Opus draft (zero regression).
 * Only ever invoked behind the DETERMINISTIC_BOM flag in runEstimation,
 * so it is completely dormant until explicitly enabled.
 */
async function loadDeterministicInputs(
  intake: any,
  pricingBook: any,
): Promise<
  | { input: DeterministicTierInput; assemblyName: string }
  | { input: null; reason: string }
> {
  const jobType = (intake?.job_type as string | null) ?? null
  const tenantId = (intake?.tenant_id as string | null) ?? null
  const trade = (intake?.trade as string | null) ?? null
  if (!jobType) return { input: null, reason: 'no job_type' }
  if (!tenantId) return { input: null, reason: 'no tenant_id' }

  // Match the job the same way buildBomHint does (name ilike job term,
  // trade-scoped). default_labour_hours grounds the labour line.
  const term = jobType.replace(/_/g, ' ')
  let aq = supabase
    .from('shared_assemblies')
    .select('id, name, trade, default_labour_hours')
    .ilike('name', `%${term}%`)
  if (trade) aq = aq.eq('trade', trade)
  const { data: asm, error: aerr } = await aq.limit(5)
  if (aerr || !asm || asm.length === 0) {
    return { input: null, reason: 'no matching assembly' }
  }
  const ids = asm.map((a: any) => a.id)
  const primary = asm[0] as {
    id: string
    name: string
    default_labour_hours: number | string
  }

  // The tradie's OWN recipe for this job wins; when they haven't authored
  // one, fall back to the shared baseline recipe (shared_assembly_bom) —
  // exactly as buildBomHint does above. This lets the deterministic builder
  // fire for ANY job with a seeded shared recipe, priced from THIS tenant's
  // tier-hinted catalogue (with shared_materials as the universal floor).
  // No tenant recipe AND no shared recipe → not deterministic (Opus path).
  const { data: ownRecipe } = await supabase
    .from('tenant_assembly_bom')
    .select('material_category, quantity, required, description, sort')
    .eq('tenant_id', tenantId)
    .in('assembly_id', ids)
    .order('sort', { ascending: true })
  let recipe = ownRecipe
  if (!recipe || recipe.length === 0) {
    const { data: sharedRecipe } = await supabase
      .from('shared_assembly_bom')
      .select('material_category, quantity, required, description, sort')
      .in('assembly_id', ids)
      .order('sort', { ascending: true })
    recipe = sharedRecipe
  }
  if (!recipe || recipe.length === 0) {
    return { input: null, reason: 'no recipe (tenant or shared) for this job' }
  }

  // v7 Phase 0: single source of truth per table —
  //   tenant_service_offerings.enabled    → Services-tab toggle (this read)
  //   tenant_assembly_overrides.labour|markup → Estimation-tab overrides
  // (Pre-v7 this block selected labour/markup from tenant_service_offerings,
  // but those columns never existed on that table — see migration 015 and
  // 028. The select was a latent error; only the early-return on the
  // disabled flag was actually doing work.)
  const { data: offerings } = await supabase
    .from('tenant_service_offerings')
    .select('assembly_id, enabled')
    .eq('tenant_id', tenantId)
    .in('assembly_id', ids)
  const primaryOffering =
    (offerings ?? []).find((o: any) => o.assembly_id === primary.id) ?? null
  if (primaryOffering && primaryOffering.enabled === false) {
    return { input: null, reason: 'service disabled in Services tab' }
  }

  const { data: assemblyOverrides } = await supabase
    .from('tenant_assembly_overrides')
    .select('assembly_id, labour_hours_override, markup_pct_override')
    .eq('tenant_id', tenantId)
    .in('assembly_id', ids)
  const primaryOverride =
    (assemblyOverrides ?? []).find((o: any) => o.assembly_id === primary.id) ?? null

  const eff = effectiveAssembly(
    primary.default_labour_hours,
    (pricingBook as any)?.default_markup_pct,
    primaryOverride
      ? {
          labour_hours_override: primaryOverride.labour_hours_override,
          markup_pct_override: primaryOverride.markup_pct_override,
        }
      : null,
  )

  // Catalogue (active, trade) + shared materials (trade) — the price
  // sources. Selects mirror loadCandidatePrices for deploy-safety.
  let cq = supabase
    .from('tenant_material_catalogue')
    .select(
      'id, category, name, brand, range_series, supplier, unit, unit_price_ex_gst, customer_supply_price_ex_gst, tier_hint, active',
    )
    .eq('tenant_id', tenantId)
    .eq('active', true)
  if (trade) cq = cq.eq('trade', trade)
  let mq = supabase
    .from('shared_materials')
    .select('name, category, default_unit_price_ex_gst, unit')
  if (trade) mq = mq.eq('trade', trade)
  const [{ data: catRows }, { data: sharedRows }] = await Promise.all([cq, mq])

  const input: DeterministicTierInput = {
    bom: (recipe ?? []) as BomLine[],
    tenantMaterials: (catRows ?? []) as TenantMaterial[],
    sharedMaterials: (sharedRows ?? []) as SharedMaterial[],
    labourHours: Number(eff.labourHours.value),
    hourlyRate: Number((pricingBook as any)?.hourly_rate),
    markupPct: Number(eff.markupPct.value),
  }
  return { input, assemblyName: primary.name }
}

/**
 * WP4 — load the operator catalogue as {id, name, image_path} so a
 * grounded line can be linked back to the exact product it was priced
 * from (for the render). Best-effort + render-only: this runs AFTER
 * grounding, never feeds the validator, and any failure just means
 * "no product link" (today's behaviour). Absent table (pre-028 prod)
 * → supabase returns {data:null} → [] → no-op.
 */
async function loadCatalogueProductRefs(
  tenantId: string | null,
  trade: string | null,
): Promise<CatalogueProductRef[]> {
  if (!tenantId) return []
  try {
    let q = supabase
      .from('tenant_material_catalogue')
      .select('id, name, image_path, description')
      .eq('tenant_id', tenantId)
      .eq('active', true)
    if (trade) q = q.eq('trade', trade)
    const { data } = await q
    return (data ?? []) as CatalogueProductRef[]
  } catch {
    return []
  }
}

// Load id/name/properties for the (tenant, trade, category) products the
// main-path spec guard reconciles a quoted product against. Covers BOTH the
// shared catalogue and the operator catalogue (a line can be priced from
// either). Best-effort: any failure → [] (the guard simply sees no rows and
// degrades to name-parsing the line description).
async function loadCategorySpecRows(
  tenantId: string | null,
  trade: string | null,
  category: string | null,
): Promise<Array<{ id: string | null; name: string | null; properties: any }>> {
  if (!category) return []
  const rows: Array<{ id: string | null; name: string | null; properties: any }> = []
  try {
    let sq = supabase.from('shared_materials').select('id, name, properties').eq('category', category)
    if (trade) sq = sq.eq('trade', trade)
    const { data } = await sq
    for (const r of data ?? []) rows.push({ id: r.id ?? null, name: r.name ?? null, properties: r.properties ?? null })
  } catch {
    /* shared lookup is best-effort */
  }
  if (tenantId) {
    try {
      let tq = supabase
        .from('tenant_material_catalogue')
        .select('id, name, properties')
        .eq('tenant_id', tenantId)
        .eq('category', category)
      if (trade) tq = tq.eq('trade', trade)
      const { data } = await tq
      for (const r of data ?? []) rows.push({ id: r.id ?? null, name: r.name ?? null, properties: r.properties ?? null })
    } catch {
      /* tenant lookup is best-effort */
    }
  }
  return rows
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 1 PRICE-INTEGRITY HELPERS (pure, no I/O — unit-tested in
// run-phase1.test.ts). Each closes a specific way the recipe / KB /
// reconcile post-processing could launder an ungrounded or double-charged
// price PAST the grounding validator. They are deliberately fail-closed:
// when in doubt they DROP/FLAG/DOWNGRADE, never accept. They STRENGTHEN
// the price-integrity envelope; they never loosen validate.ts.
// ═══════════════════════════════════════════════════════════════════════

type AnyLine = Record<string, any>
type AnyTier = { line_items?: AnyLine[]; subtotal_ex_gst?: number | string; [k: string]: unknown } | null | undefined
const PHASE1_TIERS = ['good', 'better', 'best'] as const

function p1Num(v: unknown): number {
  if (v === null || v === undefined || v === '') return Number.NaN
  return typeof v === 'string' ? parseFloat(v) : (v as number)
}
function p1Round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** True for a labour line (source === 'labour'). Labour lines are NEVER
 *  deduped by R7 (see lineDuplicateKey / dropDuplicateAppendedLines): a
 *  recipe's ADDITIONAL labour is additive work, not a duplicate, even when
 *  it coincidentally totals the same hours/rate as an Opus base-labour
 *  line. Dropping it would under-bill the tradie for real work. */
function p1IsLabour(li: AnyLine): boolean {
  return String(li?.source ?? '').trim().toLowerCase() === 'labour'
}

/** Identity key for a priced line, used to detect a recipe-appended line
 *  that double-charges an Opus-drafted line. Keys on the catalogue anchor
 *  when present (source `material:<id>`/`assembly:<id>`), else the
 *  normalised description — combined with quantity + normalised unit.
 *
 *  R7 (2026-06-18): labour lines now also fold the normalised DESCRIPTION
 *  into the key (`labour|<desc>|<unit>|<qty>`) instead of the bare
 *  `labour|<unit>|<qty>`. The old key collapsed EVERY labour line that
 *  shared hours+unit, so a recipe's distinct additional-labour line (e.g.
 *  "Extra labour — long cable run", 2hr) was wrongly treated as a duplicate
 *  of an unrelated Opus base-labour line (e.g. "Labour — install", 2hr) and
 *  dropped, under-billing real work. Folding the description in makes two
 *  genuinely-distinct labour lines distinct keys while still collapsing an
 *  exact repeat. (dropDuplicateAppendedLines additionally SKIPS labour
 *  lines entirely — this key change is defence-in-depth for any other
 *  caller of lineDuplicateKey.) */
export function lineDuplicateKey(li: AnyLine): string {
  const srcRaw = String(li?.source ?? '').trim()
  const refMatch = srcRaw.match(/^(material|assembly):([A-Za-z0-9_-]{4,})$/i)
  const unit = String(li?.unit ?? '').toLowerCase().trim()
  const qty = p1Num(li?.quantity)
  const qtyKey = Number.isFinite(qty) ? String(qty) : ''
  const normDesc = String(li?.description ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(.*$/, '') // strip parenthetical decorations like "(supplied)"
  let anchor: string
  if (refMatch) {
    anchor = `${refMatch[1].toLowerCase()}:${refMatch[2].toLowerCase()}`
  } else if (srcRaw.toLowerCase() === 'labour') {
    // Description-aware so two distinct labour lines don't collide.
    anchor = `labour:${normDesc}`
  } else {
    anchor = normDesc
  }
  return `${anchor}|${unit}|${qtyKey}`
}

/**
 * Decide which line indices in a tier are "recipe-created" (and which are
 * the Opus-drafted base). PREFERS the explicit `recipe_origin` marker that
 * merge-recipes stamps on every line it created/swapped in; falls back to
 * the positional `preCount` prefix only when NO line in the tier carries a
 * marker (legacy callers / tests that pre-date the marker).
 *
 * R7/R9 SWAP FIX (2026-06-18): the positional index model is unsound for a
 * recipe SWAP, because merge-recipes PREPENDS the new sundries+labour lines
 * (`[newSundries, newLabour, ...preserved]`) — so "everything past preCount"
 * no longer equals "the recipe lines". After a swap, the prefix indices hold
 * recipe-created lines and a preserved Opus line can sit past preCount. Keying
 * off the marker fixes both directions: R7 never drops a legit Opus line, and
 * R9 validates exactly the recipe-created lines.
 */
function recipeOriginIndices(
  lineItems: AnyLine[],
  preCount: number | undefined,
): { indices: Set<number>; source: 'marker' | 'precount' | 'none' } {
  const markerIdx = new Set<number>()
  for (let i = 0; i < lineItems.length; i++) {
    if (lineItems[i]?.recipe_origin === true) markerIdx.add(i)
  }
  if (markerIdx.size > 0) return { indices: markerIdx, source: 'marker' }
  // No markers → fall back to the positional prefix (legacy/test path).
  if (typeof preCount === 'number' && preCount >= 0 && lineItems.length > preCount) {
    const idx = new Set<number>()
    for (let i = preCount; i < lineItems.length; i++) idx.add(i)
    return { indices: idx, source: 'precount' }
  }
  return { indices: new Set<number>(), source: 'none' }
}

/**
 * R7 — Recipe pre-emption / Opus-vs-recipe duplication.
 *
 * The recipe engine adds extras (extra cable runs, supply-line extensions,
 * extra labour) to a tier AFTER Opus already drafted it, and on a SWAP it
 * replaces the base sundries+labour. If Opus already drafted the same
 * MATERIAL/ASSEMBLY extra, the recipe-created line double-charges the
 * customer for the same thing. This is an ENFORCED check (not advisory
 * prompt text): the recipe-created lines are identified by the explicit
 * `recipe_origin` marker merge-recipes stamps (with a positional `preCount`
 * fallback for legacy callers). Any recipe-created line whose duplicate-key
 * collides with an Opus-drafted line (same catalogue id / product, same
 * quantity, same unit) is DROPPED, and the tier subtotal is recomputed from
 * the surviving lines.
 *
 * LABOUR IS NEVER DEDUPED (R7 fix, 2026-06-18): a recipe's additional labour
 * is additive work, not a duplicate — even when it coincidentally totals the
 * same hours/rate as an Opus base-labour line. Dropping it under-bills the
 * tradie for real work. So `source:'labour'` lines are skipped entirely here;
 * they always survive. (lineDuplicateKey is also description-aware for labour
 * as defence-in-depth, but this skip is the primary guarantee.)
 *
 * Fail-closed: a true material/assembly duplicate is removed rather than
 * shipped. Pure — mutates the passed draft in place and returns the dropped
 * lines for logging. Idempotent: re-running finds nothing to drop.
 */
export function dropDuplicateAppendedLines(
  draft: Record<string, any> | null | undefined,
  preCounts: Partial<Record<(typeof PHASE1_TIERS)[number], number>>,
): { dropped: Array<{ tier: string; description: string; key: string }> } {
  const dropped: Array<{ tier: string; description: string; key: string }> = []
  if (!draft) return { dropped }
  for (const key of PHASE1_TIERS) {
    const tier = draft[key] as AnyTier
    if (!tier || !Array.isArray(tier.line_items)) continue
    const items = tier.line_items
    const { indices: recipeIdx } = recipeOriginIndices(items, preCounts[key])
    if (recipeIdx.size === 0) continue // nothing recipe-created → nothing to dedupe

    // The "base" set the recipe lines must not duplicate = every line that
    // is NOT recipe-created (after a swap, an Opus material can sit anywhere,
    // so we key off the marker rather than a positional prefix). Labour is
    // excluded from BOTH sets — recipe labour is additive (never dropped),
    // and an Opus labour line can never be a dedupe target for a material.
    const baseKeys = new Set<string>()
    for (let i = 0; i < items.length; i++) {
      if (recipeIdx.has(i)) continue
      if (p1IsLabour(items[i])) continue
      baseKeys.add(lineDuplicateKey(items[i]))
    }

    const survivors: AnyLine[] = []
    const keptRecipeKeys = new Set<string>()
    for (let i = 0; i < items.length; i++) {
      const li = items[i]
      if (!recipeIdx.has(i)) {
        survivors.push(li)
        continue
      }
      // This is a recipe-created line. NEVER drop recipe labour — additive.
      if (p1IsLabour(li)) {
        survivors.push(li)
        continue
      }
      const k = lineDuplicateKey(li)
      if (baseKeys.has(k) || keptRecipeKeys.has(k)) {
        dropped.push({ tier: key, description: String(li?.description ?? '(no description)'), key: k })
        continue
      }
      keptRecipeKeys.add(k)
      survivors.push(li)
    }
    if (survivors.length !== items.length) {
      tier.line_items = survivors
      // Recompute subtotal from surviving lines (qty × unit_price), 2dp —
      // matches the merge module's recompute + validator tolerance.
      const subtotal = survivors.reduce((s, li) => {
        const q = p1Num(li?.quantity)
        const up = p1Num(li?.unit_price_ex_gst)
        if (!Number.isFinite(q) || !Number.isFinite(up)) return s
        return s + q * up
      }, 0)
      tier.subtotal_ex_gst = p1Round2(subtotal)
    }
  }
  return { dropped }
}

/**
 * R9 — appended-extra micro-validation.
 *
 * After a recipe merge changes a tier, the recipe-created lines must be
 * grounded just like Opus's lines. This builds a draft that contains ONLY
 * the recipe-created lines per tier and runs the existing
 * `validateQuoteGrounding` against it — so a recipe that adds an un-grounded
 * extra is caught here, BEFORE the main grounding pass, and the offending
 * tier's recipe result can be reverted. Returns the set of tiers whose
 * recipe lines failed grounding.
 *
 * R7/R9 SWAP FIX (2026-06-18): the recipe-created lines are identified by the
 * explicit `recipe_origin` marker merge-recipes stamps (positional `preCount`
 * is only a fallback for legacy/test callers). The positional prefix is
 * unsound after a SWAP — merge-recipes PREPENDS the new sundries+labour, so
 * `slice(preCount)` would validate a preserved Opus line and miss the actual
 * swapped-in recipe lines. Keying off the marker validates exactly the lines
 * the recipe created/swapped in.
 *
 * R9 FRAMING FIX (2026-06-18): the sub-draft now carries the live draft's
 * scope_of_works / scope_short / assumptions. The embedded cross-tier
 * duplicate check (detectCrossTierDuplicates) reads those fields to decide
 * whether a differing-quantity cross-tier appearance is legitimately FRAMED
 * (e.g. "3 cable metres in Good, 6 in Best", explained in scope_of_works).
 * Without the framing, a legitimately-framed cross-tier recipe extra was
 * falsely reverted. Copying the framing makes the sub-draft check identical
 * to what the full pass sees — this can only ADD precision, never loosen
 * grounding (an UNframed cross-tier jump still fails, exactly as before).
 *
 * NOTE: this constructs a throwaway draft whose tiers hold only recipe lines.
 * We pass a relaxed pricing book where min_labour_hours=0 so the "tier below
 * labour floor" rule (a WHOLE-tier property, irrelevant to "are these extras
 * grounded") cannot false-fail the extras-only sub-draft.
 */
export function validateAppendedLines(
  draft: Record<string, any> | null | undefined,
  preCounts: Partial<Record<(typeof PHASE1_TIERS)[number], number>>,
  pricingBook: PricingBookForValidation,
  candidates: Parameters<typeof validateQuoteGrounding>[2],
): { failedTiers: Set<(typeof PHASE1_TIERS)[number]>; failures: GroundingFailure[] } {
  const failedTiers = new Set<(typeof PHASE1_TIERS)[number]>()
  const failures: GroundingFailure[] = []
  if (!draft) return { failedTiers, failures }

  // R9 framing fix — carry the live draft's top-level framing onto the
  // sub-draft so detectCrossTierDuplicates sees the same scope/assumptions
  // the full grounding pass sees. Copy the exact fields the cross-tier check
  // reads (scope_of_works, scope_short, assumptions).
  const subDraft: Record<string, any> = {
    scope_of_works: draft.scope_of_works,
    scope_short: draft.scope_short,
    assumptions: draft.assumptions,
  }
  let anyAppended = false
  for (const key of PHASE1_TIERS) {
    const tier = draft[key] as AnyTier
    if (!tier || !Array.isArray(tier.line_items)) continue
    const { indices: recipeIdx } = recipeOriginIndices(tier.line_items, preCounts[key])
    if (recipeIdx.size === 0) continue
    const appended = tier.line_items.filter((_, i) => recipeIdx.has(i))
    if (appended.length === 0) continue
    anyAppended = true
    subDraft[key] = { ...tier, line_items: appended }
  }
  if (!anyAppended) return { failedTiers, failures }

  // Relax ONLY the per-tier labour-floor rule for the extras-only sub-draft
  // (the floor is a whole-tier property, irrelevant to "are these extras
  // grounded"). Every other grounding rule — price match, category match,
  // strict-UUID, duplicates — runs unchanged, so this can only ADD
  // rejections, never accept something the full pass wouldn't.
  const relaxedBook: PricingBookForValidation = { ...pricingBook, min_labour_hours: 0 }
  const res = validateQuoteGrounding(subDraft, relaxedBook, candidates)
  if (!res.valid) {
    for (const f of res.failures) {
      failedTiers.add(f.tier)
      failures.push(f)
    }
  }
  return { failedTiers, failures }
}

/**
 * R10 — KB apply-mode grounding integrity.
 *
 * When KB verification (apply mode) rewrites a line's price, stamp the
 * line with an explicit KB-origin marker (`kb_origin: true`) and surface
 * it to operators via a risk_flag. This means a stale/incorrect KB price
 * can never silently launder through the loose category grounding path —
 * the price is still re-checked by the main `validateQuoteGrounding` pass
 * (KB runs before it), and now its KB provenance is visible on the line
 * and in risk_flags for tradie review. Pure — mutates the draft in place;
 * returns the count + flags added. No-op when there are zero KB
 * corrections (KB off / shadow / no mismatch).
 */
export function markKbRewrittenLines(
  draft: Record<string, any> | null | undefined,
  corrections: ReadonlyArray<{ tier: 'good' | 'better' | 'best'; lineIndex: number; from: number; to: number }>,
): { stamped: number; flags: string[] } {
  const flags: string[] = []
  let stamped = 0
  if (!draft || !corrections || corrections.length === 0) return { stamped, flags }
  for (const c of corrections) {
    const tier = draft[c.tier] as AnyTier
    const li = tier?.line_items?.[c.lineIndex]
    if (!li || typeof li !== 'object') continue
    li.kb_origin = true
    li.kb_rewritten_from = c.from
    stamped++
    flags.push(
      `[kb-origin] ${c.tier} line ${c.lineIndex}: price rewritten by MT-QM-PRICING-KB ` +
        `from $${Number(c.from).toFixed(2)} to $${Number(c.to).toFixed(2)} — KB-sourced, ` +
        `must still ground; verify before sending.`,
    )
  }
  if (flags.length > 0) {
    draft.risk_flags = [
      ...(Array.isArray(draft.risk_flags) ? draft.risk_flags : []),
      ...flags,
    ]
  }
  return { stamped, flags }
}

/**
 * R15 — Spec-mismatch handling (enforce mode).
 *
 * The spec guard's shadow mode logs/flags only (unchanged). In ENFORCE
 * mode a HARD spec mismatch (a chosen product contradicting the
 * customer's agreed specs — e.g. customer said 15A GPO, model picked 10A)
 * must ACT, not ship silently:
 *   • If only SOME priced tiers mismatch → BLOCK those tiers (null them)
 *     so the customer only ever sees grounded, spec-correct options.
 *   • If EVERY priced tier mismatches → there is no safe tier to show;
 *     signal the caller to route the whole quote to inspection /
 *     tradie-review.
 * Pure — mutates the draft in place (nulling blocked tiers, appending
 * risk_flags) and returns what it did. The caller decides the inspection
 * downgrade based on `routeToInspection`.
 */
export function enforceSpecMismatch(
  draft: Record<string, any> | null | undefined,
  mismatchTiers: ReadonlyArray<{ tier: 'good' | 'better' | 'best'; reason: string }>,
  mode: 'off' | 'shadow' | 'enforce',
): { blockedTiers: Array<'good' | 'better' | 'best'>; routeToInspection: boolean; flags: string[] } {
  const flags: string[] = []
  if (!draft || mode !== 'enforce' || !mismatchTiers || mismatchTiers.length === 0) {
    return { blockedTiers: [], routeToInspection: false, flags }
  }
  // R15b — clear any stale signal from a previous enforce pass so this is
  // idempotent and a no-block re-run can't leave a phantom marker.
  if ('spec_block' in draft) delete (draft as Record<string, unknown>).spec_block
  // Which priced tiers exist at all?
  const pricedTiers = PHASE1_TIERS.filter((k) => {
    const t = draft[k] as AnyTier
    return !!(t && Array.isArray(t.line_items) && t.line_items.length > 0)
  })
  const mismatchSet = new Set(mismatchTiers.map((m) => m.tier))
  // Only count a mismatch tier that is actually a priced tier.
  const blockedTiers = pricedTiers.filter((k) => mismatchSet.has(k))
  if (blockedTiers.length === 0) {
    return { blockedTiers: [], routeToInspection: false, flags }
  }

  const allPricedMismatch =
    pricedTiers.length > 0 && blockedTiers.length >= pricedTiers.length
  if (allPricedMismatch) {
    // No safe tier remains → route the whole quote to inspection. Don't
    // null tiers here; the caller owns the inspection-downgrade shape so
    // the existing groundingFailures/downgrade path stays single-sourced.
    for (const m of mismatchTiers) {
      flags.push(`[spec-guard] ${m.tier}: ${m.reason} (BLOCKED — routed to inspection)`)
    }
    draft.risk_flags = [
      ...(Array.isArray(draft.risk_flags) ? draft.risk_flags : []),
      ...flags,
    ]
    return { blockedTiers, routeToInspection: true, flags }
  }

  // Partial mismatch → block (null) the offending tiers; keep the rest.
  for (const k of blockedTiers) {
    draft[k] = null
    const reason = mismatchTiers.find((m) => m.tier === k)?.reason ?? 'spec mismatch'
    flags.push(`[spec-guard] ${k}: ${reason} (BLOCKED — tier removed, spec contradiction)`)
  }
  // If the previously-selected tier was blocked, re-point to a survivor.
  const sel = draft.selected_tier as string | null | undefined
  if (sel && !draft[sel]) {
    draft.selected_tier = draft.better
      ? 'better'
      : draft.good
        ? 'good'
        : draft.best
          ? 'best'
          : null
  }
  draft.risk_flags = [
    ...(Array.isArray(draft.risk_flags) ? draft.risk_flags : []),
    ...flags,
  ]
  // R15b — DON'T let a nulled tier ship silently. The grounding path makes
  // its downgrade visible (downgradedToInspection + structured risk_flags);
  // a partial spec-block keeps the spec-correct tier(s) priced, so it must
  // NOT flip the whole quote to needs_inspection. Instead stamp an explicit,
  // machine-readable signal that the route + routing read so the partial
  // downgrade is treated consistently (review-required) rather than the route
  // seeing a tier that vanished with only a soft note. The caller (runEstimation)
  // mirrors this onto EstimationResult.specBlock — the same way it mirrors
  // groundingFailures — so the route handler has identical observability.
  draft.spec_block = {
    partial: true,
    blocked_tiers: [...blockedTiers],
    reasons: blockedTiers.map((k) => ({
      tier: k,
      reason: mismatchTiers.find((m) => m.tier === k)?.reason ?? 'spec mismatch',
    })),
  }
  // Review signal: a spec-blocked quote must be tradie-reviewed before the
  // customer sees it (same posture as a grounding-flagged draft). This is
  // additive — the route already defaults non-inspection quotes to
  // tradie_review; this makes the intent explicit and queryable.
  draft.needs_review = true
  return { blockedTiers, routeToInspection: false, flags }
}

// Opus often prefixes its response with reasoning ("Calculation: ...", "Here is the quote:")
// or wraps in ```json fences. Extract the first balanced { ... } block.
function parseJsonFromText(text: string): any {
  // Try direct parse first (happy path)
  const direct = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try { return JSON.parse(direct) } catch {}

  // Fallback: find the first { and walk forward counting braces (respecting strings)
  const start = text.indexOf('{')
  if (start < 0) throw new Error(`No JSON object found in Opus output. First 300 chars: ${text.slice(0, 300)}`)

  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const candidate = text.slice(start, i + 1)
        try { return JSON.parse(candidate) }
        catch (e: any) {
          throw new Error(`Found JSON-shaped block but couldn't parse it: ${e.message}\n\nFirst 300 chars of candidate:\n${candidate.slice(0, 300)}`)
        }
      }
    }
  }

  throw new Error(`Unbalanced braces in Opus output. First 300 chars: ${text.slice(0, 300)}`)
}
