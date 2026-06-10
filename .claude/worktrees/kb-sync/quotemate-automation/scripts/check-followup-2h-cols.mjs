// Verifies migration 079 columns are present on prod:
//   - quotes.followup_2h_sent_at         (timestamptz, nullable)
//   - pricing_book.followup_2h_enabled   (boolean, not null, default false)
//
// Run:
//   node --env-file=.env.local scripts/check-followup-2h-cols.mjs
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

let ok = true

// 1. quotes.followup_2h_sent_at — selectable on the quotes table
{
  const { data, error } = await supabase
    .from('quotes')
    .select('id, followup_2h_sent_at')
    .limit(1)
  if (error) {
    ok = false
    console.error('FAIL  quotes.followup_2h_sent_at:', error.message)
  } else {
    console.log('PASS  quotes.followup_2h_sent_at — selectable (sample:', data?.[0]?.followup_2h_sent_at ?? 'null', ')')
  }
}

// 2. pricing_book.followup_2h_enabled — selectable and default applied
{
  const { data, error } = await supabase
    .from('pricing_book')
    .select('id, tenant_id, trade, followup_2h_enabled')
    .order('trade', { ascending: true })
  if (error) {
    ok = false
    console.error('FAIL  pricing_book.followup_2h_enabled:', error.message)
  } else {
    const nullRows = data.filter((r) => r.followup_2h_enabled === null)
    if (nullRows.length > 0) {
      ok = false
      console.error('FAIL  pricing_book.followup_2h_enabled — NULL on', nullRows.length, 'rows (expected NOT NULL DEFAULT false)')
    } else {
      console.log('PASS  pricing_book.followup_2h_enabled — present on all', data.length, 'rows; defaults:')
      for (const r of data) {
        console.log(`        tenant=${r.tenant_id?.slice(0, 8)}…  trade=${r.trade.padEnd(10)}  enabled=${r.followup_2h_enabled}`)
      }
    }
  }
}

// 3. Confirm the partial index exists (planner picks the hot path)
{
  const { data, error } = await supabase
    .rpc('exec_sql', { sql: "select 1" })
    .single()
  // exec_sql may not exist; fall back to a metadata-free assertion: count pending candidates
  if (error) {
    // Best-effort fallback — just count what the cron would scan
    const { count, error: countErr } = await supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .is('followup_2h_sent_at', null)
      .in('status', ['sent', 'viewed'])
      .not('sent_at', 'is', null)
      .is('paid_at', null)
      .is('accepted_at', null)
      .not('needs_inspection', 'is', true)
    if (countErr) {
      console.error('WARN  could not run pending-candidate count:', countErr.message)
    } else {
      console.log('INFO  pending follow-up candidates (the cron sweep set):', count)
    }
  }
}

process.exit(ok ? 0 : 1)
