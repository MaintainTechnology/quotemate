// /api/tenant/trade-jobs — lightweight summaries of the tradie's saved
// trade-specific jobs that live OUTSIDE the quotes table (roofing_measurements,
// solar_estimates, painting_measurements). Powers the dashboard Quotes-tab
// "link-out summary cards" (spec R4/R8/R19, link-out variant): each card shows
// the trade, address, a headline figure and status, and links to that job's
// rich customer page (/q/roof, /q/solar, /q/paint) — instead of forcing those
// jobs through the electrical Good/Better/Best card.
//
// Deliberately isolated from /api/tenant/me (the central dashboard read) to keep
// the blast radius small. Read-only. Same Bearer-token auth as /me. Each table
// is queried independently and a failing/absent table degrades to an empty list
// for that trade rather than failing the whole response.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

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

export type TradeJobSummary = {
  id: string
  trade: 'roofing' | 'solar' | 'painting' | 'commercial-painting'
  address: string | null
  /** Short headline (e.g. "182 m²", "$8,400 inc GST"). */
  headline: string | null
  /** Coarse status for the badge. */
  status: 'confirmed' | 'inspection' | 'draft'
  /** Link to the rich customer page, or null when no shareable token exists. */
  href: string | null
  createdAt: string | null
}

const aud = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })
  const tenantId = tenant.id

  const jobs: TradeJobSummary[] = []

  // ── Roofing ──────────────────────────────────────────────
  try {
    const { data } = await supabase
      .from('roofing_measurements')
      .select('id, address, combined_area_m2, public_token, confirmed_at, routing, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20)
    for (const r of data ?? []) {
      const area = typeof r.combined_area_m2 === 'number' ? r.combined_area_m2 : null
      jobs.push({
        id: String(r.id),
        trade: 'roofing',
        address: (r.address as string | null) ?? null,
        headline: area !== null ? `${Math.round(area)} m²` : null,
        status: r.confirmed_at
          ? 'confirmed'
          : r.routing === 'inspection_required'
            ? 'inspection'
            : 'draft',
        href: r.public_token ? `/q/roof/${r.public_token}` : null,
        createdAt: (r.created_at as string | null) ?? null,
      })
    }
  } catch {
    /* table absent / column drift — skip roofing */
  }

  // ── Solar ────────────────────────────────────────────────
  try {
    const { data } = await supabase
      .from('solar_estimates')
      .select('id, address, public_token, confirmed_at, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20)
    for (const r of data ?? []) {
      jobs.push({
        id: String(r.id),
        trade: 'solar',
        address: (r.address as string | null) ?? null,
        headline: 'Solar estimate',
        status: r.confirmed_at ? 'confirmed' : 'draft',
        href: r.public_token ? `/q/solar/${r.public_token}` : null,
        createdAt: (r.created_at as string | null) ?? null,
      })
    }
  } catch {
    /* skip solar */
  }

  // ── Residential paint ────────────────────────────────────
  try {
    const { data } = await supabase
      .from('painting_measurements')
      .select('id, address, better_inc_gst, routing, public_token, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20)
    for (const r of data ?? []) {
      const better = typeof r.better_inc_gst === 'number' ? r.better_inc_gst : null
      jobs.push({
        id: String(r.id),
        trade: 'painting',
        address: (r.address as string | null) ?? null,
        headline: better !== null ? `${aud(better)} inc GST` : null,
        status: r.routing === 'inspection_required' ? 'inspection' : 'draft',
        href: r.public_token ? `/q/paint/${r.public_token}` : null,
        createdAt: (r.created_at as string | null) ?? null,
      })
    }
  } catch {
    /* skip painting */
  }

  // ── Commercial painting ──────────────────────────────────
  try {
    const { data } = await supabase
      .from('paint_runs')
      .select('id, job_name, site_address, status, public_token, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20)
    for (const r of data ?? []) {
      jobs.push({
        id: String(r.id),
        trade: 'commercial-painting',
        address: (r.site_address as string | null) ?? (r.job_name as string | null) ?? null,
        headline: (r.job_name as string | null) ?? 'Painting tender',
        status: r.status === 'priced' ? 'confirmed' : r.status === 'failed' ? 'inspection' : 'draft',
        href: r.public_token ? `/q/commercial-paint/${r.public_token}` : null,
        createdAt: (r.created_at as string | null) ?? null,
      })
    }
  } catch {
    /* skip commercial painting */
  }

  // Newest first across all trades.
  jobs.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  return Response.json({ jobs })
}
