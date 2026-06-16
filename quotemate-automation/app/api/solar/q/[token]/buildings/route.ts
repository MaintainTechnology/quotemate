// GET /api/solar/q/[token]/buildings — PUBLIC, share-token-gated.
//
// Returns the structures detected on the property behind a saved solar
// estimate plus which one the row's headline `estimate` currently reflects,
// so the customer/tradie quote page can render the building picker. The
// share token IS the capability (mirrors flux-heatmap / static-map): no
// bearer — anyone with the link can read which buildings exist.
//
// [] / null on the single-building path (picker hidden client-side).
// 404 when no row matches the token.
//
// Next 16: params is a Promise (awaited); force-dynamic.

import { createClient } from '@supabase/supabase-js'
import type { DetectedBuilding } from '@/lib/solar/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }

  const { data: row } = await supabase
    .from('solar_estimates')
    .select('buildings, selected_building_id')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  return Response.json({
    ok: true,
    buildings: (row.buildings as DetectedBuilding[] | null) ?? [],
    selected_building_id: (row.selected_building_id as string | null) ?? null,
  })
}
