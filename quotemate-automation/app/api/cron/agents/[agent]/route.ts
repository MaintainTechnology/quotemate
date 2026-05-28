// GET /api/cron/agents/[agent] — Vercel-Cron trigger for the three
// quality agents (eval | catalogue | tradie-learn).
//
// Schedule wired in vercel.json. Vercel sends an auto-injected
// `Authorization: Bearer ${CRON_SECRET}` header on every cron call —
// same convention as /api/cron/sms-cleanup.
//
// This route proxies to the mt-qm-quality-agents Railway service via
// the shared agents-client. Reads QM_AGENTS_URL + QM_AGENTS_API_KEY
// from env (set in Vercel dashboard). Returns the agent's run result
// so the Vercel cron log surfaces meaningful status.
//
// For Tradie-Learn we pass lookback_hours = 168 (one week) — matches
// the recommended cadence. Adjust by overriding via query string
// (?lookback_hours=72) if you want a manual trigger with a different
// window.

import {
  readAgentClientConfig,
  runAgent,
  type AgentName,
} from '@/lib/agents/client'
import { isCronAuthorised, parseAgentName } from '@/lib/agents/cron'

export const dynamic = 'force-dynamic'
// Allow the Eval Agent's longest expected run-time (5 fixtures, multiple
// Sonnet calls each, plus DB writes). Catalogue + Tradie-Learn complete
// well inside this budget.
export const maxDuration = 300

export async function GET(
  req: Request,
  ctx: { params: Promise<{ agent: string }> },
) {
  if (!isCronAuthorised(req)) {
    return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })
  }

  const { agent: slug } = await ctx.params
  const agent = parseAgentName(slug)
  if (!agent) {
    return Response.json(
      { ok: false, error: 'invalid_agent', valid: ['eval', 'catalogue', 'tradie-learn'] },
      { status: 400 },
    )
  }

  const config = readAgentClientConfig()
  if (!config) {
    console.error('[cron/agents] not configured — set QM_AGENTS_URL + QM_AGENTS_API_KEY')
    return Response.json(
      { ok: false, error: 'agent_service_not_configured' },
      { status: 503 },
    )
  }

  // Per-agent body. Tradie-Learn honours an optional ?lookback_hours
  // query for manual ad-hoc triggers; the other two ignore.
  const body = buildAgentBody(agent, req)

  const t0 = Date.now()
  const result = await runAgent(agent, config, body)
  const elapsedMs = Date.now() - t0

  console.log('[cron/agents] run complete', {
    agent,
    ok: result.ok,
    elapsedMs,
    // Surface the agent-specific summary fields for the Vercel log.
    total_score: result.total_score,
    rows_audited: result.rows_audited,
    findings_created: result.findings_created,
    events_seen: result.events_seen,
    patterns_created: result.patterns_created,
    error: result.error,
  })

  return Response.json({ agent, elapsedMs, ...result }, { status: result.ok ? 200 : 502 })
}

function buildAgentBody(agent: AgentName, req: Request): Record<string, unknown> {
  if (agent !== 'tradie-learn') return {}
  const url = new URL(req.url)
  const lookbackRaw = url.searchParams.get('lookback_hours')
  const lookback = lookbackRaw ? parseInt(lookbackRaw, 10) : 168
  return { lookback_hours: Number.isFinite(lookback) && lookback > 0 ? lookback : 168 }
}
