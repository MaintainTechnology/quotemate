// QuoteMax · Trade-readiness report (spec A5).
//
// Prints whether each candidate trade is "onboardable" — i.e. fully wired
// into the self-serve quote pipeline — and, for any that aren't, exactly
// what's missing. Run this BEFORE an onboarding batch so you know which
// trades the wizard/admin will offer.
//
//   node --env-file=.env.local scripts/check-trade-readiness.mjs
//
// Mirrors lib/onboard/trade-readiness.ts — keep the criteria in sync:
//   1. pricing defaults   (ONBOARDING_TRADES — electrical/plumbing)
//   2. shared_assemblies  (>=1 catalogue row, DB)
//   3. estimator prompt   (bundled template OR trade_prompts row, DB)
//   4. intake support     (ONBOARDING_TRADES)
//   5. licence schema     (LICENCE_BODIES keys — electrical/plumbing)

import pg from 'pg'

const { Client } = pg

const CANDIDATE_TRADES = ['electrical', 'plumbing', 'roofing', 'solar', 'commercial_painting']
// Mirror of lib/onboard/schema.ts ONBOARDING_TRADES + LICENCE_BODIES keys
// and lib/estimate/prompt.ts bundled templates.
const ONBOARDING_TRADES = new Set(['electrical', 'plumbing'])
const BUNDLED_ESTIMATOR_TRADES = new Set(['electrical', 'plumbing'])
const LICENCE_TRADES = new Set(['electrical', 'plumbing'])

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function hasSharedAssemblies(trade) {
  const r = await client.query('select count(*)::int as n from shared_assemblies where trade = $1', [
    trade,
  ])
  return (r.rows[0]?.n ?? 0) > 0
}

async function hasTradePromptRow(trade) {
  try {
    const r = await client.query(
      `select tp.estimator_system_prompt as tpl
         from trade_prompts tp
         join trades tr on tr.id = tp.trade_id
        where tr.name = $1
        limit 1`,
      [trade],
    )
    const tpl = r.rows[0]?.tpl
    return !!(tpl && String(tpl).trim() !== '')
  } catch {
    // trade_prompts/trades shape differs or table absent — fall back to bundled.
    return false
  }
}

try {
  await client.connect()
  console.log('Trade readiness — QuoteMax onboarding pipeline\n')

  const results = []
  for (const trade of CANDIDATE_TRADES) {
    const pricingDefaults = ONBOARDING_TRADES.has(trade)
    const sharedAssemblies = await hasSharedAssemblies(trade)
    const estimatorPrompt = BUNDLED_ESTIMATOR_TRADES.has(trade) || (await hasTradePromptRow(trade))
    const intakeRules = ONBOARDING_TRADES.has(trade)
    const licenceSchema = LICENCE_TRADES.has(trade)

    const missing = []
    if (!pricingDefaults) missing.push('onboarding pricing defaults')
    if (!sharedAssemblies) missing.push('shared_assemblies catalogue rows')
    if (!estimatorPrompt) missing.push('estimator prompt (bundled or trade_prompts)')
    if (!intakeRules) missing.push('intake structuring support')
    if (!licenceSchema) missing.push('licence schema (LICENCE_BODIES)')

    results.push({ trade, ready: missing.length === 0, missing })
  }

  for (const r of results) {
    const badge = r.ready ? 'READY      ' : 'NOT READY  '
    console.log(`  [${badge}] ${r.trade}`)
    if (!r.ready) {
      for (const m of r.missing) console.log(`               - missing: ${m}`)
    }
  }

  const ready = results.filter((r) => r.ready).map((r) => r.trade)
  console.log(`\nOnboardable now: ${ready.length ? ready.join(', ') : '(none)'}`)
  const notReady = results.filter((r) => !r.ready).map((r) => r.trade)
  if (notReady.length) {
    console.log(`Gated out:       ${notReady.join(', ')}`)
    console.log('\nThese trades run on separate bespoke flows and are NOT wired into the')
    console.log('self-serve onboarding pipeline. Wire the missing pieces above to enable them.')
  }
} catch (err) {
  console.error('Readiness check failed:', err.message ?? err)
  process.exit(1)
} finally {
  await client.end()
}
