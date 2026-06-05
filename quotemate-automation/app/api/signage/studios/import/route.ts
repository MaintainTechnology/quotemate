// POST /api/signage/studios/import — bulk-add this org's location roster
// from a CSV (name required; address/region/state/postcode/contacts optional).
// Skips rows whose name already exists for the org. HQ-authed.

import { createClient } from '@supabase/supabase-js'
import { orgFromBearer } from '@/lib/signage/org'
import { resolveSignageBrand } from '@/lib/signage/brand'
import { parseStudiosCsv } from '@/lib/signage/studios-csv'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { brand } = await resolveSignageBrand(supabase, req, ctx.orgId)

  let text: string
  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('multipart/form-data')) {
      const fd = await req.formData()
      const file = fd.get('csv')
      if (!(file instanceof File)) return Response.json({ ok: false, error: 'no_csv' }, { status: 400 })
      text = await file.text()
    } else {
      text = await req.text()
    }
  } catch {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 })
  }

  const { studios, errors } = parseStudiosCsv(text)
  if (studios.length === 0) {
    return Response.json({ ok: false, error: 'no_valid_rows', issues: errors }, { status: 400 })
  }

  // Skip names that already exist for this org + brand.
  const { data: existing } = await supabase
    .from('studios')
    .select('name')
    .eq('org_id', ctx.orgId)
    .eq('brand_slug', brand.slug)
  const have = new Set((existing ?? []).map((s) => String(s.name).toLowerCase()))
  const fresh = studios.filter((s) => !have.has(s.name.toLowerCase()))
  const skipped = studios.length - fresh.length

  let created = 0
  if (fresh.length > 0) {
    const rows = fresh.map((s) => ({ ...s, org_id: ctx.orgId, brand_slug: brand.slug, status: 'open' }))
    const { data, error } = await supabase.from('studios').insert(rows).select('id')
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
    created = data?.length ?? 0
  }

  return Response.json({ ok: true, created, skipped_existing: skipped, parse_errors: errors })
}
