// GET /api/onboard/trades — readiness-gated list of onboardable trades.
//
// The /onboard wizard fetches this to render only the trades the whole
// quote pipeline actually supports (trade-readiness gate, spec A4). Public
// on purpose: it returns no tenant data, only which trade slugs are wired.

import { createClient } from '@supabase/supabase-js'
import { checkAllTradesReadiness } from '@/lib/onboard/trade-readiness'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET() {
  try {
    const readiness = await checkAllTradesReadiness(supabase)
    return Response.json({
      ok: true,
      onboardable: readiness.filter((t) => t.ready).map((t) => t.trade),
      trades: readiness,
    })
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    )
  }
}
