// /api/dashboard/flyer
//   GET  → list the caller's saved flyers (lightweight columns).
//   POST → create a flyer from a template, auto-filled with the tenant's
//          brand fields. Returns { ok, id }.
// Auth: Authorization: Bearer <supabase access token>. Tenant-scoped.

import { marketingSupabase as supabase, userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { CreateFlyerBody, DEFAULT_FLYER_NAME } from '@/lib/flyer/api-logic'
import { getTemplate } from '@/lib/flyer/templates'
import { buildInitialDocument } from '@/lib/flyer/document'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const { data, error } = await supabase
    .from('flyers')
    .select('id, name, template_id, png_path, pdf_path, created_at, updated_at')
    .eq('tenant_id', tenant.id)
    .order('updated_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ flyers: data ?? [] })
}

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = CreateFlyerBody.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }

  const template = getTemplate(parsed.data.template_id)
  if (!template) return Response.json({ error: 'unknown_template' }, { status: 400 })

  const document = buildInitialDocument(template, tenant)
  const { data, error } = await supabase
    .from('flyers')
    .insert({
      tenant_id: tenant.id,
      name: parsed.data.name || DEFAULT_FLYER_NAME,
      template_id: template.id,
      document,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !data) return Response.json({ error: error?.message ?? 'insert_failed' }, { status: 500 })
  return Response.json({ ok: true, id: data.id })
}
