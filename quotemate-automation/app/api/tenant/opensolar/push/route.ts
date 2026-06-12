// POST /api/tenant/opensolar/push — body { estimate_token }
//
// The lead push — the two-way feature the Pylon tab can't do: create an
// OpenSolar contact + project from a QuoteMate solar estimate so the
// tradie opens OpenSolar studio with the site, customer and (when the
// optional bill field was captured) real usage pre-loaded.
//
// Write-path: gated by OPENSOLAR_PROPOSALS_ENABLED *and* the
// OPENSOLAR_LEAD_PUSH_TENANTS allowlist. Usage push is best-effort —
// a failed PATCH never fails the project creation.

import { createClient } from '@supabase/supabase-js'
import {
  createOpenSolarContact,
  createOpenSolarProject,
  openSolarLeadPushEnabled,
  openSolarProposalsEnabled,
  updateOpenSolarProjectUsage,
} from '@/lib/opensolar/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export async function POST(req: Request) {
  if (!openSolarProposalsEnabled(process.env)) {
    return Response.json({ ok: false, error: 'opensolar_disabled' }, { status: 404 })
  }

  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }
  if (!openSolarLeadPushEnabled(process.env, tenant.id as string)) {
    return Response.json({ ok: false, error: 'lead_push_not_enabled' }, { status: 403 })
  }

  let estimateToken: string | null = null
  try {
    const body = (await req.json()) as { estimate_token?: unknown }
    if (typeof body.estimate_token === 'string' && body.estimate_token.trim().length > 0) {
      estimateToken = body.estimate_token.trim()
    }
  } catch {
    /* fall through to 400 */
  }
  if (!estimateToken) {
    return Response.json({ ok: false, error: 'estimate_token required' }, { status: 400 })
  }

  const { data: est } = await supabase
    .from('solar_estimates')
    .select('id, tenant_id, address, postcode, state, estimate')
    .eq('public_token', estimateToken)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!est) {
    return Response.json({ ok: false, error: 'estimate_not_found' }, { status: 404 })
  }

  // Customer + usage facts ride inside the estimate jsonb; both optional.
  const estimate = rec(est.estimate)
  const context = rec(estimate.context)
  const customer = rec(estimate.customer)
  const customerName = typeof customer.name === 'string' ? customer.name.trim() : ''
  const [firstName, ...rest] = customerName.split(/\s+/).filter(Boolean)
  const quarterlyBill =
    typeof context.quarterly_bill_aud === 'number' && context.quarterly_bill_aud > 0
      ? context.quarterly_bill_aud
      : null

  // Contact first (best-effort — a project without a contact still helps).
  let contactUrl: string | null = null
  if (firstName || customer.email || customer.phone) {
    const contactRes = await createOpenSolarContact({
      first_name: firstName ?? null,
      family_name: rest.join(' ') || null,
      email: typeof customer.email === 'string' ? customer.email : null,
      phone: typeof customer.phone === 'string' ? customer.phone : null,
    })
    if (contactRes.ok && typeof contactRes.data.url === 'string') {
      contactUrl = contactRes.data.url
    } else if (!contactRes.ok) {
      console.warn(`[opensolar/push] contact create skipped (${contactRes.code}): ${contactRes.detail}`)
    }
  }

  const projectRes = await createOpenSolarProject({
    address: est.address ?? undefined,
    zip: est.postcode ?? undefined,
    state: est.state ?? undefined,
    country_iso2: 'AU',
    notes: `Pushed from QuoteMate solar estimate ${estimateToken}`,
    ...(contactUrl ? { contacts: [contactUrl] } : {}),
  })
  if (!projectRes.ok) {
    return Response.json(
      { ok: false, error: `OpenSolar project create failed (${projectRes.code}): ${projectRes.detail}` },
      { status: 502 },
    )
  }
  const projectId = projectRes.data.id != null ? String(projectRes.data.id) : null
  if (!projectId) {
    return Response.json({ ok: false, error: 'OpenSolar returned no project id' }, { status: 502 })
  }

  // Usage push (the customer's real quarterly bill) — best-effort.
  if (quarterlyBill != null) {
    const usageRes = await updateOpenSolarProjectUsage(projectId, {
      usage_data_source: 'bill_quarterly',
      values: [quarterlyBill, quarterlyBill, quarterlyBill, quarterlyBill],
    })
    if (!usageRes.ok) {
      console.warn(`[opensolar/push] usage push skipped (${usageRes.code}): ${usageRes.detail}`)
    }
  }

  return Response.json({
    ok: true,
    project_id: projectId,
    project_url: `https://app.opensolar.com/#/projects/${projectId}`,
  })
}
