// GET  /api/admin/loader/trade-book/stores — list the mt-filestore-kb
// stores the admin can extract from. Admin-only.
//
// POST /api/admin/loader/trade-book/stores — create a NEW store inline,
// without leaving QuoteMax. Body: { displayName: string,
// embeddingModel?: string }. Admin-only. Used by the 01·b StepCard's
// "+ New store" button so the admin can spin up a store right before
// uploading the first PDF.
//
// Returns:
//   GET  { ok: true, stores: [{ id, name, displayName, state? }] }
//   POST { ok: true, store: { id, name, displayName, state? } }
//
// Used by the /admin/loader UI's trade-book section to populate the
// store-picker dropdown. Returns a 503 with a clear message when KB_API_URL
// or KB_API_KEY env vars aren't set yet, so the operator sees actionable
// diagnostics instead of a silent failure.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'
import {
  kbCreateStore,
  kbListStores,
  loadKbConfigFromEnv,
  type KbStoreSummary,
} from '@/lib/admin-loader/mt-filestore-kb'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })

  let kbConfig
  try {
    kbConfig = loadKbConfigFromEnv()
  } catch (e: any) {
    return Response.json(
      { ok: false, error: `mt-filestore-kb not configured: ${e?.message ?? String(e)}` },
      { status: 503 },
    )
  }

  try {
    const stores = await kbListStores(kbConfig)
    // Surface the short id (last URL segment) alongside the full resource
    // name so the UI can show a human label + send the right value back
    // to the extract route.
    const shaped = stores.map(shapeStore)
    return Response.json({ ok: true, stores: shaped })
  } catch (e: any) {
    return Response.json(
      { ok: false, error: `mt-filestore-kb error: ${e?.message ?? String(e)}` },
      { status: 502 },
    )
  }
}

function shapeStore(s: KbStoreSummary) {
  return {
    id: (s.name ?? '').split('/').pop() ?? '',
    name: s.name ?? '',
    displayName: s.displayName ?? null,
    state: s.state ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────
// POST — create a new store
// ─────────────────────────────────────────────────────────────────────

const CreateStoreSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  embeddingModel: z.string().trim().min(1).max(120).optional(),
})

export async function POST(req: Request) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })

  let kbConfig
  try {
    kbConfig = loadKbConfigFromEnv()
  } catch (e: any) {
    return Response.json(
      { ok: false, error: `mt-filestore-kb not configured: ${e?.message ?? String(e)}` },
      { status: 503 },
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = CreateStoreSchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'validation_failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  try {
    const store = await kbCreateStore(kbConfig, {
      displayName: parsed.data.displayName,
      embeddingModel: parsed.data.embeddingModel,
    })
    return Response.json({ ok: true, store: shapeStore(store) })
  } catch (e: any) {
    return Response.json(
      { ok: false, error: `mt-filestore-kb error: ${e?.message ?? String(e)}` },
      { status: 502 },
    )
  }
}
