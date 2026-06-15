// /api/dashboard/marketing/slug
//   GET   → the caller's current landing-page slug (may be null).
//   PATCH → set/change the slug. Validates format + uniqueness.
// Auth: Authorization: Bearer <supabase access token>.

import { z } from 'zod'
import { marketingSupabase as supabase, userFromBearer, tenantForUser } from '@/lib/marketing/auth'
import { slugifyBusinessName } from '@/lib/marketing/qr'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })
  return Response.json({ slug: tenant.slug })
}

const PatchBody = z.object({ slug: z.string().trim().min(2).max(40) })

export async function PATCH(req: Request) {
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
  const parsed = PatchBody.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }

  // Normalise to a safe slug shape (reuse the same slugifier).
  const slug = slugifyBusinessName(parsed.data.slug)
  if (slug === 'tradie' && parsed.data.slug.toLowerCase() !== 'tradie') {
    return Response.json({ error: 'invalid_slug', message: 'Use letters, numbers and dashes.' }, { status: 422 })
  }

  // Uniqueness — case-insensitive, excluding the caller's own row.
  const { data: clash } = await supabase
    .from('tenants')
    .select('id')
    .ilike('slug', slug)
    .neq('id', tenant.id)
    .maybeSingle()
  if (clash) {
    return Response.json({ error: 'slug_taken', message: 'That link is already taken — try another.' }, { status: 409 })
  }

  const { error } = await supabase.from('tenants').update({ slug }).eq('id', tenant.id)
  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: 'slug_taken', message: 'That link is already taken — try another.' }, { status: 409 })
    }
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json({ ok: true, slug })
}
