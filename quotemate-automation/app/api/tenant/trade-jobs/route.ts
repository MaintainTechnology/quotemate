// /api/tenant/trade-jobs — lightweight summaries of the tradie's saved
// trade-specific jobs that live OUTSIDE the quotes table (roofing_measurements,
// solar_estimates, painting_measurements). Powers the dashboard Quotes-tab
// "link-out summary cards" (spec R4/R8/R19, link-out variant): each card shows
// the trade, address, a headline figure and status, and links to that job's
// rich customer page (/q/roof, /q/solar, /q/paint) — instead of forcing those
// jobs through the electrical Good/Better/Best card.
//
// Deliberately isolated from /api/tenant/me (the central dashboard read) to keep
// the blast radius small. Same Bearer-token auth as /me. Each table is queried
// independently and a failing/absent table degrades to an empty list for that
// trade rather than failing the whole response.
//
// DELETE removes a single saved job — tenant-scoped hard delete against the
// trade's own table. FK reality (checked against sql/ 2026-07-02): nothing
// references roofing_measurements or painting_measurements; paint_runs IS
// referenced by plan_uploads.paint_run_id + plan_extractions.paint_run_id
// (mig 107, ON DELETE CASCADE) and solar_estimates by
// solar_building_analyses.estimate_id (mig 114, ON DELETE CASCADE) — so those
// deletes cascade their derived rows, which is the intent (the analyses/
// extractions are meaningless without the job). Money guards: a painting job
// with paid_at set is immutable (409, mirrors /api/quote/[id]) and its live
// Checkout Sessions are expired pre-delete; a solar job linked to a PAID
// quote is likewise refused.

import { createClient } from '@supabase/supabase-js'
import { expireCheckoutSession } from '@/lib/stripe/checkout'

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
      .limit(100)
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
      .limit(100)
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
      .limit(100)
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
      .limit(100)
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

// Maps a TradeJobSummary.trade to the table its rows live in. DELETE only
// accepts these four keys — a table name is never built from raw input.
// Lookups go through Object.hasOwn so prototype members ("constructor",
// "toString", …) can't sneak a non-string past the allowlist.
const TRADE_TABLES: Record<string, string> = {
  roofing: 'roofing_measurements',
  solar: 'solar_estimates',
  painting: 'painting_measurements',
  'commercial-painting': 'paint_runs',
}

export async function DELETE(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { trade, id } = (body ?? {}) as { trade?: unknown; id?: unknown }
  const table =
    typeof trade === 'string' && Object.hasOwn(TRADE_TABLES, trade)
      ? TRADE_TABLES[trade]
      : undefined
  if (!table || typeof id !== 'string' || !id.trim()) {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }

  // ── Money guards ─────────────────────────────────────────────
  // Painting rows carry their own deposit state (mig 156: paid_at +
  // stripe_links). A paid job is the customer's only payment record —
  // refuse deletion, and expire any live Checkout Sessions on unpaid rows
  // so the SMS pay links can't charge a card after the row is gone.
  if (trade === 'painting') {
    const { data: row } = await supabase
      .from('painting_measurements')
      .select('id, paid_at, stripe_links')
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    if (!row) return Response.json({ error: 'not_found' }, { status: 404 })
    if (row.paid_at) {
      return Response.json({ error: 'job_already_paid' }, { status: 409 })
    }
    const links = (row.stripe_links ?? {}) as Record<string, string | undefined>
    for (const [tier, sessionUrl] of Object.entries(links)) {
      if (!sessionUrl) continue
      const exp = await expireCheckoutSession(sessionUrl)
      if (!exp.ok) {
        console.warn('[trade-jobs/delete] expire failed (continuing)', {
          id,
          tier,
          reason: exp.reason,
        })
      }
    }
  }
  // A solar estimate can be linked to a quotes row (mig 100). If that quote
  // took a deposit, deleting the estimate would strand the paid job's
  // source data — refuse, same 409 contract as above.
  if (trade === 'solar') {
    const { data: row } = await supabase
      .from('solar_estimates')
      .select('id, quote_id')
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    if (!row) return Response.json({ error: 'not_found' }, { status: 404 })
    if (row.quote_id) {
      const { data: linkedQuote } = await supabase
        .from('quotes')
        .select('paid_at')
        .eq('id', row.quote_id)
        .maybeSingle()
      if (linkedQuote?.paid_at) {
        return Response.json({ error: 'job_already_paid' }, { status: 409 })
      }
    }
  }

  // Tenant-scoped hard delete. `.select('id')` returns the deleted rows so a
  // cross-tenant or stale id surfaces as a 404 instead of a silent success.
  // For painting the paid guard is re-applied atomically on the statement
  // itself (`.is('paid_at', null)`) — a deposit landing between the check
  // above and this delete can't get a just-paid job removed.
  let del = supabase.from(table).delete().eq('id', id).eq('tenant_id', tenant.id)
  if (trade === 'painting') del = del.is('paid_at', null)
  const { data, error } = await del.select('id')
  if (error) return Response.json({ error: 'delete_failed' }, { status: 500 })
  if (!data || data.length === 0) {
    // Painting rows that passed the load above but matched 0 here were paid
    // in the interim — everything else is a stale/cross-tenant id.
    const status = trade === 'painting' ? 409 : 404
    const errCode = trade === 'painting' ? 'job_already_paid' : 'not_found'
    return Response.json({ error: errCode }, { status })
  }
  return Response.json({ ok: true })
}
