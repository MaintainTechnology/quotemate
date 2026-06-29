// POST /api/dashboard/flyer/canva/designs
//   Create a new Canva design (flyer-sized) on the connected tenant's account,
//   record it in canva_designs, and return the raw Canva edit URL the inline
//   studio opens in a new browser tab. We deliberately do NOT append a
//   correlation_state:
//   return-navigation requires a Return Navigation URL configured in the Canva
//   Developer Portal, and sending it without that config makes Canva reject the
//   edit URL (HTTP 400). Import-back works via the export API, so it isn't needed.
// Auth: Authorization: Bearer <token>. Tenant-scoped; requires a connection.

import { marketingSupabase as supabase, userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { CreateCanvaDesignBody, DEFAULT_CANVA_TITLE } from '@/lib/canva/api-logic'
import { getValidAccessToken } from '@/lib/canva/tokens'
import { createDesign } from '@/lib/canva/client'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  // Body is optional ({} is valid); only an optional title is accepted.
  let raw: unknown = {}
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const parsed = CreateCanvaDesignBody.safeParse(raw ?? {})
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }

  const accessToken = await getValidAccessToken(tenant.id)
  if (!accessToken) return Response.json({ error: 'not_connected' }, { status: 409 })

  const title = (parsed.data.title || `${tenant.business_name ?? DEFAULT_CANVA_TITLE} flyer`).slice(0, 120)

  let design
  try {
    design = await createDesign(accessToken, { title })
  } catch (err) {
    return Response.json({ error: 'canva_create_failed', detail: String(err) }, { status: 502 })
  }

  const { data, error } = await supabase
    .from('canva_designs')
    .insert({
      tenant_id: tenant.id,
      canva_design_id: design.id,
      title,
      edit_url: design.editUrl,
      view_url: design.viewUrl,
      status: 'editing',
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !data) return Response.json({ error: error?.message ?? 'insert_failed' }, { status: 500 })

  return Response.json({ ok: true, id: data.id, editUrl: design.editUrl, viewUrl: design.viewUrl })
}
