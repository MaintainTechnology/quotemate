// Shared CRON_SECRET auth + agent-name validation for the
// /api/cron/agents/[agent] route. Pure helpers so the auth rules are
// unit-testable without spinning up the route handler.

import type { AgentName } from './client'

const VALID_AGENTS: ReadonlySet<AgentName> = new Set([
  'eval',
  'catalogue',
  'tradie-learn',
])

/**
 * True iff the request carries the right CRON_SECRET. Matches the
 * convention used by /api/cron/sms-cleanup so Vercel Cron's
 * auto-injected `Authorization: Bearer ${CRON_SECRET}` header works
 * unchanged.
 *
 * Production: secret is required. No secret on the request → 401.
 * Dev/test: callers without a Bearer get through (easy manual
 * trigger); a wrong Bearer still 401s.
 */
export function isCronAuthorised(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = env.CRON_SECRET
  const got = req.headers.get('authorization')

  if (env.NODE_ENV === 'production') {
    if (!expected) return false
    return got === `Bearer ${expected}`
  }
  // Dev — open to no-header calls, strict on wrong-header calls.
  if (got && expected) return got === `Bearer ${expected}`
  return true
}

/**
 * Narrow an arbitrary string to a known AgentName. Returns null when
 * the slug isn't one of the three valid agents so the route can return
 * a clean 400 instead of silently proxying nonsense to Railway.
 */
export function parseAgentName(slug: string): AgentName | null {
  return (VALID_AGENTS as Set<string>).has(slug) ? (slug as AgentName) : null
}

export const VALID_AGENT_NAMES: readonly AgentName[] = [
  'eval',
  'catalogue',
  'tradie-learn',
]
