// GET + PUT /api/tenant/pylon/settings
//
// The tenant's nominated hardware SKUs (Pylon component SKUs) that power
// the Instant Estimate's Pylon supplements: datasheet cards on the quote
// + the hardware-floor guardrail. Gated by PYLON_ENABLED (the
// supplements gate — NOT the design-import tab's PYLON_PROPOSALS gate).
// On save, each SKU is validated against Pylon's datasheet endpoint so a
// typo is caught immediately rather than failing silently at draft time.

import { createClient } from '@supabase/supabase-js'
import { fetchPylonComponent, pylonEnabled, type PylonComponentKind } from '@/lib/pylon/client'
import { parsePylonSkuSettings, type PylonSkuSettings } from '@/lib/solar/pylon-hardware'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function gateOpen(): boolean {
  return pylonEnabled({
    PYLON_ENABLED: process.env.PYLON_ENABLED,
    PYLON_API_KEY: process.env.PYLON_API_KEY,
  })
}

async function tenantFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, pylon_settings')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  return tenant ?? null
}

export async function GET(req: Request) {
  if (!gateOpen()) {
    return Response.json({ ok: false, error: 'pylon_disabled' }, { status: 404 })
  }
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  return Response.json({ ok: true, settings: parsePylonSkuSettings(tenant.pylon_settings) })
}

const KINDS: Array<[keyof PylonSkuSettings, PylonComponentKind, string]> = [
  ['module_sku', 'module', 'Panel'],
  ['inverter_sku', 'inverter', 'Inverter'],
  ['battery_sku', 'battery', 'Battery'],
]

export async function PUT(req: Request) {
  if (!gateOpen()) {
    return Response.json({ ok: false, error: 'pylon_disabled' }, { status: 404 })
  }
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const settings = parsePylonSkuSettings(body)

  // Validate each nominated SKU against Pylon's datasheet endpoint —
  // a wrong SKU should fail loudly here, not silently at draft time.
  const resolved: Record<string, string> = {}
  for (const [key, kind, label] of KINDS) {
    const sku = settings[key]
    if (!sku) continue
    const res = await fetchPylonComponent(kind, sku)
    if (!res.ok) {
      return Response.json(
        {
          ok: false,
          error: `${label} SKU "${sku}" was not found in Pylon (${res.code}). Copy the SKU from a Pylon design or datasheet URL.`,
        },
        { status: 422 },
      )
    }
    resolved[key] = res.data.name ?? [res.data.brand, res.data.model_number].filter(Boolean).join(' ')
  }

  const { error } = await supabase
    .from('tenants')
    .update({ pylon_settings: settings })
    .eq('id', tenant.id)
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  return Response.json({ ok: true, settings, resolved })
}
