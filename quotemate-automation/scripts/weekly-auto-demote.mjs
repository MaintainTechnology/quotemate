// R22 - weekly accuracy review + auto-demote RECOMMENDER (READ-ONLY, no DB writes, no env changes).
// Run: node --env-file=.env.local scripts/weekly-auto-demote.mjs
//
// What this does (and does NOT do):
//   It REPORTS which job_types should be dropped from AUTO_SEND_JOBTYPES because
//   their post-send tradie-correction rate is too high. It is a recommender for a
//   human: it prints a per-job-type scorecard and a copy-pasteable "keep" allowlist,
//   then stops. It NEVER writes to the database and NEVER edits env / AUTO_SEND_JOBTYPES.
//   The actual demotion is the operator removing the named job_types from the env var
//   (the R21 kill-switch mechanic) - this script only tells them which ones.
//
// The R22 demote rule (spec, proposed thresholds - confirm against the spec before
// treating as final):
//   A job_type is RECOMMENDED FOR DEMOTION when EITHER holds over the review window:
//     (1) > 20% of its auto-sent quotes were corrected by the tradie after send, OR
//     (2) ANY single post-send correction moved the total by more than +-15%.
//   Demotion is "pending re-calibration": the recipe / prices for that job_type get
//   re-checked (R12/R13) before it can re-graduate (R20).
//
// FLAG-NOT-FABRICATE: the correction signal depends on columns that the R7/R27
// observability migrations add to `quotes` (auto_sent, pricing_path, and a
// post-send correction marker). Until those columns exist this script CANNOT
// measure a correction rate, so it does NOT invent one - it detects the missing
// columns, prints exactly what is missing, reports what it CAN see (auto-sent
// volume per job_type), and exits without a (false) "all clear". A silent
// green here would be the dangerous failure mode.

import pg from 'pg'

const { Client } = pg

// ── Tunables (mirror the spec's proposed R22 thresholds) ──────────────────
// Kept as plain consts so the operator can see exactly what bar is applied.
const CORRECTION_RATE_THRESHOLD = 0.20 // > 20% of auto-sends corrected => demote
const SINGLE_CORRECTION_PCT_THRESHOLD = 0.15 // any one correction > +-15% => demote
const REVIEW_WINDOW_DAYS = Number(process.env.R22_REVIEW_WINDOW_DAYS ?? 7) // weekly by default

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set (expected in .env.local). Aborting - read-only, nothing changed.')
  process.exit(1)
}

const c = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

/** Which of the named columns actually exist on a table right now. */
async function presentColumns(client, table, columns) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = any($2::text[])`,
    [table, columns],
  )
  return new Set(rows.map((r) => r.column_name))
}

await c.connect()
console.log('=== R22 weekly auto-demote recommender (READ-ONLY) ===')
console.log(`Review window: last ${REVIEW_WINDOW_DAYS} day(s).`)
console.log(`Demote rule: correction-rate > ${Math.round(CORRECTION_RATE_THRESHOLD * 100)}% OR any single correction > +-${Math.round(SINGLE_CORRECTION_PCT_THRESHOLD * 100)}%.\n`)

try {
  // The correction signal lives on `quotes`; the job_type comes from the parent
  // `intakes`. Probe for the observability columns R7/R27 are meant to add.
  const quoteCols = await presentColumns(c, 'quotes', [
    'auto_sent',
    'pricing_path',
    'corrected_at',
    'corrected_total_ex_gst',
    'pre_correction_total_ex_gst',
    'sent_at',
    'subtotal_ex_gst',
    'intake_id',
  ])

  const hasAutoSent = quoteCols.has('auto_sent')
  const hasCorrectedAt = quoteCols.has('corrected_at')
  const hasCorrectedTotal = quoteCols.has('corrected_total_ex_gst')
  const hasPreTotal = quoteCols.has('pre_correction_total_ex_gst')

  // ── Always-available view: auto-sent-ish volume per job_type ────────────
  // Even without the correction columns we can show what is flowing through
  // auto-send (routing_decision = 'auto_send' is the closest stable signal,
  // present per CLAUDE.md as quotes.routing_decision).
  const hasRoutingDecision = (await presentColumns(c, 'quotes', ['routing_decision'])).has('routing_decision')
  const autoSendExpr = hasAutoSent
    ? 'q.auto_sent is true'
    : hasRoutingDecision
      ? `q.routing_decision = 'auto_send'`
      : 'false'

  const volume = await c.query(
    `select coalesce(i.job_type, '(null)') as job_type,
            i.trade,
            count(*)::int as auto_sent_quotes
       from quotes q
       join intakes i on i.id = q.intake_id
      where q.sent_at is not null
        and q.sent_at >= now() - ($1 || ' days')::interval
        and (${autoSendExpr})
      group by i.job_type, i.trade
      order by count(*) desc`,
    [String(REVIEW_WINDOW_DAYS)],
  )

  console.log('--- Auto-sent volume per job_type (review window) ---')
  if (volume.rows.length === 0) {
    console.log('  (no auto-sent quotes in the window - nothing to review)')
  } else {
    console.table(
      volume.rows.map((r) => ({ job_type: r.job_type, trade: r.trade, auto_sent: r.auto_sent_quotes })),
    )
  }

  // ── The actual demote computation - only if the signal columns exist ────
  if (!(hasAutoSent && hasCorrectedAt && hasCorrectedTotal && hasPreTotal)) {
    const missing = []
    if (!hasAutoSent) missing.push('quotes.auto_sent')
    if (!hasCorrectedAt) missing.push('quotes.corrected_at')
    if (!hasCorrectedTotal) missing.push('quotes.corrected_total_ex_gst')
    if (!hasPreTotal) missing.push('quotes.pre_correction_total_ex_gst')
    console.log('\nCANNOT compute correction rates yet - missing observability columns:')
    for (const m of missing) console.log(`  - ${m}`)
    console.log('\nThese are added by the R7/R27 observability work (auto-sent flag + pricing_path +')
    console.log('a post-send tradie-correction marker on `quotes`). Until they exist there is NO')
    console.log('correction signal to measure, so this run makes NO demote recommendation rather')
    console.log('than fabricating an all-clear. Re-run after the observability migration lands.')
    console.log('\n(done - read-only, no writes, no env changes)')
    await c.end()
    process.exit(0)
  }

  // Each corrected auto-sent quote, with its signed correction fraction.
  const corrections = await c.query(
    `select coalesce(i.job_type, '(null)') as job_type,
            i.trade,
            count(*)::int as auto_sent,
            count(*) filter (where q.corrected_at is not null)::int as corrected,
            max(
              case
                when q.corrected_at is not null
                 and q.pre_correction_total_ex_gst is not null
                 and q.pre_correction_total_ex_gst <> 0
                then abs(q.corrected_total_ex_gst - q.pre_correction_total_ex_gst)
                     / abs(q.pre_correction_total_ex_gst)
                else 0
              end
            ) as max_single_correction_frac
       from quotes q
       join intakes i on i.id = q.intake_id
      where q.sent_at is not null
        and q.sent_at >= now() - ($1 || ' days')::interval
        and q.auto_sent is true
      group by i.job_type, i.trade
      order by count(*) desc`,
    [String(REVIEW_WINDOW_DAYS)],
  )

  console.log('\n--- Correction scorecard per job_type ---')
  const recommendDemote = []
  const keep = []
  const scorecard = corrections.rows.map((r) => {
    const rate = r.auto_sent > 0 ? r.corrected / r.auto_sent : 0
    const maxSingle = Number(r.max_single_correction_frac) || 0
    const failRate = rate > CORRECTION_RATE_THRESHOLD
    const failSingle = maxSingle > SINGLE_CORRECTION_PCT_THRESHOLD
    const demote = failRate || failSingle
    const reasons = []
    if (failRate) reasons.push(`rate ${Math.round(rate * 100)}% > ${Math.round(CORRECTION_RATE_THRESHOLD * 100)}%`)
    if (failSingle) reasons.push(`single ${Math.round(maxSingle * 100)}% > ${Math.round(SINGLE_CORRECTION_PCT_THRESHOLD * 100)}%`)
    if (demote) recommendDemote.push(r.job_type)
    else keep.push(r.job_type)
    return {
      job_type: r.job_type,
      trade: r.trade,
      auto_sent: r.auto_sent,
      corrected: r.corrected,
      correction_rate: `${Math.round(rate * 100)}%`,
      max_single: `${Math.round(maxSingle * 100)}%`,
      recommendation: demote ? `DEMOTE (${reasons.join('; ')})` : 'keep',
    }
  })

  if (scorecard.length === 0) {
    console.log('  (no auto-sent quotes with the correction signal in the window)')
  } else {
    console.table(scorecard)
  }

  console.log('\n=== RECOMMENDATION ===')
  if (recommendDemote.length === 0) {
    console.log('No job_type breached the R22 thresholds in this window. No demotion recommended.')
  } else {
    console.log('RECOMMEND DEMOTING (remove from AUTO_SEND_JOBTYPES, pending re-calibration R12/R13):')
    for (const jt of recommendDemote) console.log(`  - ${jt}`)
    const keepUnique = [...new Set(keep)].filter((jt) => jt !== '(null)')
    console.log('\nSuggested AUTO_SEND_JOBTYPES after demotion (review before applying):')
    console.log(`  AUTO_SEND_JOBTYPES=${keepUnique.join(',')}`)
    console.log('\nThis script does NOT change the env. The operator removes the listed job_types')
    console.log('from AUTO_SEND_JOBTYPES (the R21 kill-switch mechanic). Demotion is "pending')
    console.log('re-calibration": re-check the recipe + prices (R12/R13) before re-graduating (R20).')
  }

  console.log('\n(done - read-only, no writes, no env changes)')
} catch (err) {
  console.error('weekly-auto-demote failed (read-only - nothing changed):', err.message ?? err)
  process.exitCode = 1
} finally {
  await c.end()
}
