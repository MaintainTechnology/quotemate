// GET /api/signage/brands — the active brands the HQ user can manage, for
// the dashboard tab switcher (F45 / Anytime Fitness / …). Plus the currently
// selected brand resolved from `?brand=` (validated, falls back to the org's
// brand). HQ-authed; org-scoped via the bearer token.

import { createClient } from '@supabase/supabase-js'
import { orgFromBearer } from '@/lib/signage/org'
import { resolveSignageBrand } from '@/lib/signage/brand'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { brands, slug } = await resolveSignageBrand(supabase, req, ctx.orgId)
  return Response.json({ ok: true, brands, selected: slug })
}
