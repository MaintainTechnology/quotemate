// Thin HTTP client for the mt-qm-quality-agents Railway service.
//
// Lives in lib/ (not app/) so the server-side /api/admin/agents/* routes
// can import it without pulling in any React. The client never runs in
// the browser — the API key stays server-side. The dashboard talks to
// /api/admin/agents/* which talks to this client.
//
// Configuration comes from two env vars on the QuoteMax Vercel app:
//   QM_AGENTS_URL      — Railway base URL, e.g.
//                        https://mt-qm-quality-agents-production.up.railway.app
//   QM_AGENTS_API_KEY  — same value as the agent service's QM_AGENTS_API_KEY
//
// When either is missing the client returns a structured "not configured"
// error rather than throwing — the admin UI can render a banner instead
// of breaking.

export type AgentName = 'eval' | 'catalogue' | 'tradie-learn'

export interface AgentRunResult {
  ok: boolean
  /** Eval-specific. */
  total_score?: number
  per_category?: Record<string, number>
  per_dimension?: Record<string, number>
  fixture_scores?: unknown[]
  run_id?: string
  /** Catalogue + Tradie-Learn. */
  rows_audited?: number
  findings_created?: number
  events_seen?: number
  patterns_created?: number
  error?: string
}

export interface AgentClientConfig {
  baseUrl: string
  apiKey: string
}

/**
 * Read the runtime config from env vars. Returns null when either var
 * is missing — admin UI uses this to render a "not configured" banner
 * rather than crashing.
 */
export function readAgentClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): AgentClientConfig | null {
  const baseUrl = (env.QM_AGENTS_URL || '').trim()
  const apiKey = (env.QM_AGENTS_API_KEY || '').trim()
  if (!baseUrl || !apiKey) return null
  // Drop any trailing slash so route concatenation stays clean.
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey }
}

/**
 * Map AgentName → its trigger path on the agent service.
 */
export function agentRunPath(name: AgentName): string {
  switch (name) {
    case 'eval':
      return '/v1/agents/eval/run'
    case 'catalogue':
      return '/v1/agents/catalogue/run'
    case 'tradie-learn':
      return '/v1/agents/tradie-learn/run'
  }
}

/**
 * POST to the named agent's /run endpoint.
 *
 * Pure-ish: the only side effect is the network call. No DB, no console
 * logging beyond what the caller wants. Errors are returned as
 * `{ ok: false, error }` so the admin route can render a clean message.
 */
export async function runAgent(
  name: AgentName,
  config: AgentClientConfig | null,
  body: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<AgentRunResult> {
  if (!config) {
    return {
      ok: false,
      error:
        'Agent service not configured — set QM_AGENTS_URL + QM_AGENTS_API_KEY env vars on Vercel.',
    }
  }
  const url = config.baseUrl + agentRunPath(name)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as AgentRunResult
    if (!res.ok) {
      return {
        ok: false,
        error: json?.error || `agent service returned HTTP ${res.status}`,
      }
    }
    return { ...json, ok: true }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `agent service unreachable: ${msg}` }
  }
}
