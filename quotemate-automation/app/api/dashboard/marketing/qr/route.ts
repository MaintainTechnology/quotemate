// /api/dashboard/marketing/qr
//   GET  → list the caller's QR codes (with scan_count).
//   POST → create a QR (generates short_code; ensures a tenant slug when
//          the destination is the landing page).
// Auth: Authorization: Bearer <supabase access token>.

import { z } from 'zod'
import { marketingSupabase as supabase, userFromBearer, tenantForUser } from '@/lib/marketing/auth'
import { generateShortCode, slugifyBusinessName } from '@/lib/marketing/qr'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const { data, error } = await supabase
    .from('marketing_qrs')
    .select('id, short_code, label, campaign, destination_type, destination_config, status, scan_count, created_at')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ qrs: data ?? [], slug: tenant.slug })
}

const CreateBody = z.object({
  label: z.string().trim().min(1).max(60),
  // 'signup' routes a prospective tradie to the QuoteMax signup page; it
  // needs neither a tenant slug nor a provisioned SMS number.
  destination_type: z.enum(['sms', 'landing', 'signup']),
  prefill_body: z.string().trim().max(140).optional().or(z.literal('')),
  campaign: z.string().trim().max(40).optional().or(z.literal('')),
})

/** Ensure the tenant has a unique slug; generate one from the business
 *  name on first need. Returns the slug. */
async function ensureSlug(tenant: { id: string; business_name: string; slug: string | null }): Promise<string> {
  if (tenant.slug) return tenant.slug
  const base = slugifyBusinessName(tenant.business_name)
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    const { error } = await supabase.from('tenants').update({ slug: candidate }).eq('id', tenant.id)
    if (!error) return candidate
    if (error.code !== '23505') throw new Error(error.message)
    // 23505 → slug taken, try next suffix
  }
  // Last resort: append a short random code
  const fallback = `${base}-${generateShortCode(4)}`
  await supabase.from('tenants').update({ slug: fallback }).eq('id', tenant.id)
  return fallback
}

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = CreateBody.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

  // SMS destination requires a provisioned number.
  if (body.destination_type === 'sms' && !tenant.twilio_sms_number) {
    return Response.json({ error: 'no_sms_number', message: 'Your SMS number isn’t provisioned yet.' }, { status: 422 })
  }
  // Landing destination needs a slug — generate one if missing.
  if (body.destination_type === 'landing') {
    try {
      await ensureSlug(tenant)
    } catch (e: any) {
      return Response.json({ error: 'slug_failed', message: e?.message ?? 'Could not set slug' }, { status: 500 })
    }
  }

  const destination_config = body.destination_type === 'sms' && body.prefill_body
    ? { prefill_body: body.prefill_body }
    : {}

  let created: { id: string; short_code: string } | null = null
  for (let i = 0; i < 5 && !created; i++) {
    const short_code = generateShortCode()
    const { data, error } = await supabase
      .from('marketing_qrs')
      .insert({
        tenant_id: tenant.id,
        short_code,
        label: body.label,
        campaign: body.campaign || null,
        destination_type: body.destination_type,
        destination_config,
        created_by: user.id,
      })
      .select('id, short_code')
      .single()
    if (!error && data) { created = data; break }
    if (error && error.code !== '23505') {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }
  if (!created) return Response.json({ error: 'could_not_generate_unique_code' }, { status: 500 })
  return Response.json({ ok: true, ...created })
}
