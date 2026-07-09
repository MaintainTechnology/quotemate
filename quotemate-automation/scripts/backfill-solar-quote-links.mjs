// Backfill solar_estimates.quote_id from the token-twinned quotes row.
//
// The solar estimate route creates solar_estimates + a quotes row sharing
// one token (solar_estimates.public_token === quotes.share_token) but —
// until 2026-07-09 — never stamped quote_id (mig 100 FK, on delete set
// null). The unified Quotes queue and /api/tenant/trade-jobs use quote_id
// to decide which surface owns the job, and the solar DELETE money guard
// reads it, so NULL links double-render every solar job and disarm the
// guard.
//
// Dry-run by default; pass --apply to write. Only touches rows where
// quote_id IS NULL and a quotes row with the same token exists.
//
//   node --env-file=.env.local scripts/backfill-solar-quote-links.mjs [--apply]

import { createClient } from '@supabase/supabase-js'

const apply = process.argv.includes('--apply')
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const { data: estimates, error } = await supabase
  .from('solar_estimates')
  .select('id, tenant_id, public_token, created_at')
  .is('quote_id', null)
  .not('public_token', 'is', null)
if (error) {
  console.error('read solar_estimates failed:', error.message)
  process.exit(1)
}

let linked = 0
let orphaned = 0
for (const est of estimates ?? []) {
  const { data: quote } = await supabase
    .from('quotes')
    .select('id, share_token')
    .eq('share_token', est.public_token)
    .maybeSingle()
  if (!quote) {
    // No twin (quote insert failed or the quote was since deleted) — the
    // estimate legitimately stays a saved job; leave quote_id NULL.
    orphaned += 1
    continue
  }
  linked += 1
  console.log(
    `${apply ? 'LINK' : 'would link'} solar_estimate ${est.id} → quote ${quote.id} (token ${est.public_token})`,
  )
  if (apply) {
    const { error: upErr } = await supabase
      .from('solar_estimates')
      .update({ quote_id: quote.id })
      .eq('id', est.id)
      .is('quote_id', null)
    if (upErr) console.error(`  update failed for ${est.id}:`, upErr.message)
  }
}

console.log(
  `\n${estimates?.length ?? 0} unlinked estimates: ${linked} ${apply ? 'linked' : 'linkable'}, ${orphaned} without a twin quote (left as saved jobs).${apply ? '' : ' Re-run with --apply to write.'}`,
)
