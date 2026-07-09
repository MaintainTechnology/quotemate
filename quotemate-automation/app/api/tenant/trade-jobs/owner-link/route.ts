// GET /api/tenant/trade-jobs/owner-link — resolves whether the signed-in
// tradie OWNS a roofing/painting job (by its customer-facing public_token)
// and, only then, returns the tradie detail link (/m/[measure_token] or
// /p/[estimate_token]). Spec tradie-onsite-quote-editing R3.
//
// The tradie token is a capability: it must NEVER be exposed to non-owners,
// so any miss (unknown token, NULL tenant_id, different tenant) is a uniform
// { owner: false, tradieHref: null } — no 404 that would leak existence.
// Response shape mirrors app/api/quote/[id]/check-owner.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// trade → { table, tradie-token column, tradie-page prefix }. Own-key lookup
// only — never build a table name from raw input. Trades without a tokenised
// tradie page (commercial-painting, aircon) return a static dashboard
// workspace href instead — their edit surface is a dashboard tab, so there is
// no capability token to protect, only the owner check itself.
const TRADE_LOOKUP: Record<
  string,
  { table: string; tokenColumn?: string; prefix?: string; staticHref?: string }
> = {
  roofing: { table: 'roofing_measurements', tokenColumn: 'measure_token', prefix: '/m' },
  painting: { table: 'painting_measurements', tokenColumn: 'estimate_token', prefix: '/p' },
  'commercial-painting': { table: 'paint_runs', staticHref: '/dashboard?tab=commercial-painting' },
  aircon: { table: 'aircon_recommendations', staticHref: '/dashboard?tab=aircon' },
}

export async function GET(req: Request) {
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id).
  const resolved = await resolveTenantRequest(supabase, req, 'id')
  if (!resolved) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = resolved.tenant as { id: string } | null
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const url = new URL(req.url)
  const trade = url.searchParams.get('trade') ?? ''
  const token = (url.searchParams.get('token') ?? '').trim()
  const lookup = Object.hasOwn(TRADE_LOOKUP, trade) ? TRADE_LOOKUP[trade] : undefined
  if (!lookup || !token) {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }

  const { data: row } = await supabase
    .from(lookup.table)
    .select(lookup.tokenColumn ? `tenant_id, ${lookup.tokenColumn}` : 'tenant_id')
    .eq('public_token', token)
    .maybeSingle()

  // The dynamic column select defeats supabase-js's literal-string row
  // typing — treat the row as a plain record.
  const rec = row as unknown as Record<string, unknown> | null
  const rowTenantId = (rec?.tenant_id ?? null) as string | null
  if (!rec || !rowTenantId || rowTenantId !== tenant.id) {
    return Response.json({ owner: false, tradieHref: null })
  }

  if (!lookup.tokenColumn) {
    return Response.json({ owner: true, tradieHref: lookup.staticHref ?? null })
  }
  const tradieToken = (rec[lookup.tokenColumn] ?? null) as string | null
  return Response.json({
    owner: true,
    tradieHref: tradieToken ? `${lookup.prefix}/${tradieToken}` : null,
  })
}
