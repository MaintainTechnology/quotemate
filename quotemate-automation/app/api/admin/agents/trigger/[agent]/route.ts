// POST /api/admin/agents/trigger/[agent]
//
// Server-side proxy that invokes the mt-qm-quality-agents service
// (deployed on Railway). The admin UI clicks "Run now" → this route
// resolves the admin gate, then forwards to Railway with the API key
// from env. The browser never sees the agent service URL or its key.
//
// `agent` must be one of: eval | catalogue | tradie-learn.

import { createClient } from '@supabase/supabase-js'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'
import { readAgentClientConfig, runAgent, type AgentName } from '@/lib/agents/client'

export const dynamic = 'force-dynamic'
// The Eval Agent can take 30-60s end-to-end (5 fixtures × Sonnet calls);
// give Vercel headroom so the trigger doesn't time out before the agent
// service even finishes its run.
export const maxDuration = 120

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const VALID: ReadonlySet<AgentName> = new Set([
  'eval',
  'catalogue',
  'tradie-learn',
])

export async function POST(
  req: Request,
  ctx: { params: Promise<{ agent: string }> },
) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { agent } = await ctx.params
  if (!VALID.has(agent as AgentName)) {
    return Response.json(
      { error: 'invalid_agent', valid: Array.from(VALID) },
      { status: 400 },
    )
  }

  // Optional body — forwarded as-is to the agent. Tradie-Learn supports
  // { lookback_hours }; the other two ignore.
  let body: Record<string, unknown> = {}
  try {
    const raw = await req.json()
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>
  } catch {
    // No body is fine.
  }

  const config = readAgentClientConfig()
  const result = await runAgent(agent as AgentName, config, body)
  return Response.json(result, { status: result.ok ? 200 : 502 })
}
