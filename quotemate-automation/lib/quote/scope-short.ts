// Section 2's one-line job summary (mig 175) — the shared stamp used by the
// two producers so both routes persist it the same way and one test covers
// the mechanics (spec customer-quote-five-sections R2 / acceptance 1):
//   • app/api/estimate/draft — the LLM estimator emits scope_short on every
//     electrical/plumbing draft (previously handed to the SMS builder and
//     DISCARDED);
//   • app/api/roofing/save-as-quote — roofing never runs the LLM estimator,
//     so the recommended tier's deterministic scope line (tierScopeLine
//     output) is the sentence.
//
// Best-effort by design: the update is SEPARATE from the quote insert so a
// deploy that lands before migration 175 applies logs and moves on — a
// missing column must never fail a draft or a promotion.

import type { SupabaseClient } from '@supabase/supabase-js'

/** PURE — the roofing Section 2 sentence: the recommended tier's scope line,
 *  falling back to the Better tier (index-free: keyed by tier name). */
export function roofingScopeShort(
  tiers: ReadonlyArray<{ tier: 'good' | 'better' | 'best'; scope: string }>,
  selectedTier: string | null,
): string | null {
  const picked =
    tiers.find((t) => t.tier === selectedTier)?.scope ??
    tiers.find((t) => t.tier === 'better')?.scope ??
    null
  return picked && picked.trim() ? picked : null
}

/**
 * PURE — the customer-view "Job details" sentence (section 02), resolved the
 * ONE way for every surface: the persisted scope_short, else the first sentence
 * of the scope paragraph (the same slice lib/sms/templates.ts pickScopeForSms
 * takes) for quotes drafted before migration 175 stamped the column.
 *
 * Shared deliberately: the quote page had this fallback inline while the PDF
 * read scope_short alone, so every live roofing quote (all of which predate the
 * column) would have shown Job details on the page and nothing in the PDF.
 */
export function jobDetailsSentence(
  scopeShort: string | null | undefined,
  scopeOfWorks: string | null | undefined,
): string | null {
  const short = scopeShort?.trim()
  if (short) return short
  const scope = scopeOfWorks?.trim()
  if (!scope) return null
  const m = scope.match(/^[^.]+\./)
  return (m ? m[0] : scope).trim()
}

/**
 * Persist quotes.scope_short — best-effort. Returns true when the update
 * succeeded, false when it was skipped (blank value or pre-175 schema).
 * Never throws.
 */
export async function stampScopeShort(
  supabase: SupabaseClient,
  args: { quoteId: string; scopeShort: string | null | undefined; source: string },
): Promise<boolean> {
  const value = args.scopeShort?.trim()
  if (!value) return false
  try {
    const { error } = await supabase
      .from('quotes')
      .update({ scope_short: value })
      .eq('id', args.quoteId)
    if (error) {
      console.warn(
        `[${args.source}] scope_short stamp skipped (non-fatal — apply migration 175)`,
        error.message,
      )
      return false
    }
    return true
  } catch (e) {
    console.warn(
      `[${args.source}] scope_short stamp threw (non-fatal)`,
      e instanceof Error ? e.message : String(e),
    )
    return false
  }
}
