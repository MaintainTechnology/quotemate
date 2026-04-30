// Deeper readiness probe — verifies the DB is reachable and the seed
// data exists. Don't wire this to Railway's healthcheck (any DB blip
// would cause cascading restarts); use it manually or from a paid
// uptime monitor.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string; ms?: number }> = {}

  // 1. Env vars present?
  const requiredEnv = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
  ]
  const missing = requiredEnv.filter((k) => !process.env[k])
  checks.env = { ok: missing.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : 'all set' }

  // 2. Supabase reachable + has seed data?
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    const t0 = Date.now()
    const { count, error } = await supabase
      .from('shared_assemblies')
      .select('*', { count: 'exact', head: true })
    checks.supabase = {
      ok: !error && (count ?? 0) > 0,
      detail: error ? error.message : `shared_assemblies: ${count} rows`,
      ms: Date.now() - t0,
    }
  } else {
    checks.supabase = { ok: false, detail: 'env vars missing — skipped' }
  }

  const allOk = Object.values(checks).every((c) => c.ok)
  return Response.json(
    { ok: allOk, time: new Date().toISOString(), checks },
    { status: allOk ? 200 : 503 }
  )
}
