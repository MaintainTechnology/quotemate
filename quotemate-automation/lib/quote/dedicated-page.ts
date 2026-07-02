// Resolvers that connect a quotes row on the generic /q/[token] page to the
// trade's DEDICATED measurement-rich customer page (spec R1–R3 registry:
// lib/quote/trade-format.ts customerRouteBase).
//
// Two behaviours, chosen per trade by what each surface owns:
//
//   • SOLAR — the solar pipeline token-twins the rows: quotes.share_token ==
//     solar_estimates.public_token (lib/solar/persist-helpers.ts), and the
//     quotes row is a tier-less stub (no good/better/best). The dedicated
//     /q/solar/[token] page owns pricing AND payment, so the generic page
//     should REDIRECT — this also repairs every /q/<token> link already sent.
//
//   • COMMERCIAL PAINTING — the quotes row owns the deposit checkout, so the
//     generic page keeps rendering; we resolve the rich tender page's token
//     (a DIFFERENT namespace: paint_runs.public_token) through the
//     plan_extractions.sheets_used.saved_quote backlink stamped by
//     /api/tenant/commercial-painting/save-quote, and render it as a
//     "full measured takeoff" link-out instead of redirecting.
//
// Roofing deliberately has NO resolver: its generic-page quote is the deposit
// surface by design and no backlink to roofing_measurements exists; the page
// renders the measurement snapshot inline (lib/quote/trade-scope.ts).
//
// Every resolver returns null on any miss or error — these are enhancement
// paths on a public page and must never 500 it.

import type { SupabaseClient } from '@supabase/supabase-js'

/** /q/solar/<token> when a renderable solar estimate is token-twinned with
 *  this quote's share token; null otherwise. The dedicated page notFound()s
 *  on a null `estimate` jsonb, so that is part of the redirect condition. */
export async function resolveSolarPagePath(
  supabase: SupabaseClient,
  shareToken: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('solar_estimates')
      .select('public_token, estimate')
      .eq('public_token', shareToken)
      .maybeSingle()
    if (error || !data || data.estimate == null) return null
    return `/q/solar/${shareToken}`
  } catch {
    return null
  }
}

/** /q/commercial-paint/<paint_runs.public_token> for the tender behind this
 *  quotes row, resolved via the saved_quote backlink; null when the backlink
 *  or the run's public token is absent (pre-migration-143 saves). */
export async function resolveCommercialPaintTenderPath(
  supabase: SupabaseClient,
  quoteId: string,
): Promise<string | null> {
  try {
    const { data: extractions, error: extErr } = await supabase
      .from('plan_extractions')
      .select('paint_run_id')
      .eq('sheets_used->saved_quote->>quote_id', quoteId)
      .limit(1)
    const paintRunId = extractions?.[0]?.paint_run_id as string | null | undefined
    if (extErr || !paintRunId) return null

    const { data: run, error: runErr } = await supabase
      .from('paint_runs')
      .select('public_token')
      .eq('id', paintRunId)
      .maybeSingle()
    const token = run?.public_token as string | null | undefined
    if (runErr || typeof token !== 'string' || token.length === 0) return null
    return `/q/commercial-paint/${token}`
  } catch {
    return null
  }
}
