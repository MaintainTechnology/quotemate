// GET /api/dashboard/flyer/canva/status
//   The Flyer tab's Canva panel state in one call: whether the integration is
//   configured (env creds present), whether THIS tenant has connected their
//   Canva account, and the list of Canva designs they've created (with public
//   URLs for any imported PNG/PDF exports).
// Auth: Authorization: Bearer <token>. Tenant-scoped.

import { marketingSupabase as supabase, userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { isCanvaConnected } from '@/lib/canva/api-logic'
import { readCanvaConfig } from '@/lib/canva/config'
import { FLYER_BUCKET } from '@/lib/canva/storage'

export const dynamic = 'force-dynamic'

interface DesignRow {
  id: string
  title: string | null
  canva_design_id: string
  edit_url: string
  view_url: string | null
  status: string
  png_path: string | null
  pdf_path: string | null
  updated_at: string
}

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const { data: conn } = await supabase
    .from('canva_connections')
    .select('refresh_token, canva_user_id')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  const { data: designs } = await supabase
    .from('canva_designs')
    .select('id, title, canva_design_id, edit_url, view_url, status, png_path, pdf_path, updated_at')
    .eq('tenant_id', tenant.id)
    .order('updated_at', { ascending: false })

  const publicUrl = (path: string | null): string | null =>
    path ? supabase.storage.from(FLYER_BUCKET).getPublicUrl(path).data.publicUrl : null

  const list = ((designs as DesignRow[] | null) ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    edit_url: d.edit_url,
    view_url: d.view_url,
    status: d.status,
    png_url: publicUrl(d.png_path),
    pdf_url: publicUrl(d.pdf_path),
    updated_at: d.updated_at,
  }))

  return Response.json({
    configured: Boolean(readCanvaConfig()),
    connected: isCanvaConnected((conn as { refresh_token: string | null } | null) ?? null),
    designs: list,
  })
}
