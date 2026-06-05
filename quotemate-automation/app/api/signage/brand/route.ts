// /api/signage/brand
//   GET   → the org's brand config (for the shots editor)
//   PATCH → update the brand's shot list (and optionally persona/nouns).
//
// Shots are per-brand DATA, so editing them needs no code change. HQ-authed.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { orgFromBearer } from '@/lib/signage/org'
import { resolveSignageBrand, loadBrand } from '@/lib/signage/brand'
import { normalizeShots } from '@/lib/signage/shots'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { brand, brands } = await resolveSignageBrand(supabase, req, ctx.orgId)
  return Response.json({ ok: true, brand, brands, selected: brand.slug })
}

const PatchSchema = z.object({
  shots: z.array(z.object({ slot: z.string(), label: z.string(), instruction: z.string().optional() })).optional(),
  vision_persona: z.string().trim().min(1).max(200).optional(),
  location_noun: z.string().trim().min(1).max(40).optional(),
  location_noun_plural: z.string().trim().min(1).max(40).optional(),
  hq_name: z.string().trim().min(1).max(80).optional(),
})

export async function PATCH(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { brand } = await resolveSignageBrand(supabase, req, ctx.orgId)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (parsed.data.shots) {
    const shots = normalizeShots(parsed.data.shots)
    if (shots.length === 0) return Response.json({ ok: false, error: 'no_valid_shots' }, { status: 400 })
    update.shots = shots
  }
  if (parsed.data.vision_persona) update.vision_persona = parsed.data.vision_persona
  if (parsed.data.location_noun) update.location_noun = parsed.data.location_noun
  if (parsed.data.location_noun_plural) update.location_noun_plural = parsed.data.location_noun_plural
  if (parsed.data.hq_name) update.hq_name = parsed.data.hq_name

  if (Object.keys(update).length === 0) {
    return Response.json({ ok: false, error: 'nothing_to_update' }, { status: 400 })
  }

  const { error } = await supabase.from('brands').update(update).eq('slug', brand.slug)
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })

  const updated = await loadBrand(supabase, brand.slug)
  return Response.json({ ok: true, brand: updated })
}
