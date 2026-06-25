// POST /api/book/<tenantId> — public self-serve booking request.
//
// A customer who has a tradie's booking link fills in their details and
// picks an appointment time. This creates a lightweight "booking request":
// an intake (source = web_booking) + a minimal quote carrying the chosen
// slot and booking_state = 'requested'. NO AI estimate is run and NO
// payment is taken — the tradie sees the request in their dashboard
// Calendar tab and confirms it. See specs/dashboard-calendar-tab.md.
//
// Public + unauthenticated → validate the tenant id and every input
// server-side, and validate the slot against the SAME bookable-slot logic
// the booking page renders so request and validation always agree.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { resolveBookableSlots } from '@/lib/quote/slots'
import { BOOKING_STATE } from '@/lib/quote/hold'
import { generateShareToken } from '@/lib/stripe/checkout'
import { notifyBookingConfirmed } from '@/lib/quote/booking-notify'
import { normaliseAuMobile } from '@/lib/onboard/schema'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Same AU-mobile shape the QR-flyer lead route accepts.
const AU_MOBILE = /^(\+?61\s?4\d{2}\s?\d{3}\s?\d{3}|0?4\d{2}\s?\d{3}\s?\d{3})$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  req: Request,
  ctx: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await ctx.params

  // A non-uuid id can't match a tenant and would throw on the uuid column —
  // treat as not found.
  if (!UUID_RE.test(tenantId)) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  let body: {
    name?: unknown
    phone?: unknown
    email?: unknown
    address?: unknown
    suburb?: unknown
    description?: unknown
    slot?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  const suburb = typeof body.suburb === 'string' ? body.suburb.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const slot = typeof body.slot === 'string' ? body.slot : ''

  // ── Required-field validation (before any DB write) ─────────────────
  if (!name) {
    return Response.json({ ok: false, error: 'name_required', message: 'Please enter your name.' }, { status: 400 })
  }
  if (!AU_MOBILE.test(phoneRaw)) {
    return Response.json({ ok: false, error: 'invalid_mobile', message: 'Enter a valid Australian mobile.' }, { status: 400 })
  }
  const phone = normaliseAuMobile(phoneRaw)
  if (!slot) {
    return Response.json({ ok: false, error: 'slot_required', message: 'Please pick an appointment time.' }, { status: 400 })
  }
  const slotMs = Date.parse(slot)
  if (!Number.isFinite(slotMs)) {
    return Response.json({ ok: false, error: 'invalid_slot', message: 'That time is not valid.' }, { status: 400 })
  }
  if (slotMs <= Date.now()) {
    return Response.json({ ok: false, error: 'slot_past', message: 'Please pick a time in the future.' }, { status: 400 })
  }

  // ── Resolve + validate the tenant ───────────────────────────────────
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, business_name, status, trade, available_slots')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantErr) {
    return Response.json({ ok: false, error: 'lookup_failed' }, { status: 500 })
  }
  if (!tenant || tenant.status !== 'active') {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  // The bookable set is derived the same way the booking page renders it
  // (curated future slots, else a rolling window) so a picked slot the page
  // offered is never rejected here.
  const bookableSlots = resolveBookableSlots(tenant.available_slots)
  if (!bookableSlots.includes(slot)) {
    return Response.json(
      { ok: false, error: 'slot_unavailable', message: 'That time is no longer available — please pick another.' },
      { status: 409 },
    )
  }

  // ── Idempotency — a double-submit (same tenant + phone + slot within a
  //    short window) must not create two bookings. ─────────────────────
  const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: recentIntakes } = await supabase
    .from('intakes')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('caller->>phone', phone)
    .gte('created_at', sinceIso)
  const recentIntakeIds = (recentIntakes ?? []).map((r) => r.id as string)
  if (recentIntakeIds.length > 0) {
    const { data: dupe } = await supabase
      .from('quotes')
      .select('id, share_token, scheduled_at')
      .in('intake_id', recentIntakeIds)
      .eq('scheduled_at', slot)
      .eq('booking_state', BOOKING_STATE.REQUESTED)
      .limit(1)
      .maybeSingle()
    if (dupe) {
      return Response.json({
        ok: true,
        deduped: true,
        shareToken: dupe.share_token,
        scheduledAt: slot,
        businessName: tenant.business_name ?? null,
      })
    }
  }

  // ── Create the intake (web_booking source) ──────────────────────────
  const { data: intakeRow, error: intakeErr } = await supabase
    .from('intakes')
    .insert({
      tenant_id: tenant.id,
      trade: (tenant.trade as string | null) ?? 'electrical',
      // The single free-text "what do you need" field lands in job_type so
      // the tradie's calendar has a one-line description of the job.
      job_type: description || null,
      address: address || null,
      suburb: suburb || null,
      caller: { name, phone, email: email || undefined },
      scope: { source: 'web_booking', description: description || null },
      inspection_required: false,
    })
    .select('id')
    .single()
  if (intakeErr || !intakeRow) {
    return Response.json({ ok: false, error: 'intake_failed' }, { status: 500 })
  }

  // ── Create the minimal quote carrying the booking request ───────────
  const shareToken = generateShareToken()
  const nowIso = new Date().toISOString()
  const { data: quoteRow, error: quoteErr } = await supabase
    .from('quotes')
    .insert({
      tenant_id: tenant.id,
      intake_id: intakeRow.id,
      status: 'draft',
      scheduled_at: slot,
      booking_state: BOOKING_STATE.REQUESTED,
      share_token: shareToken,
      last_status_at: nowIso,
    })
    .select('id')
    .single()
  if (quoteErr || !quoteRow) {
    // Don't strand an orphan intake on a half-failed booking.
    await supabase.from('intakes').delete().eq('id', intakeRow.id)
    return Response.json({ ok: false, error: 'booking_failed' }, { status: 500 })
  }

  // ── Notify (after the ack so the customer's page returns instantly) ──
  // Reuses the booking-confirmation pattern: customer gets a confirmation,
  // the tradie gets a notification with name / phone / job / time.
  after(async () => {
    await notifyBookingConfirmed(supabase, {
      quoteId: quoteRow.id,
      intakeId: intakeRow.id,
      tenantId: tenant.id,
      shareToken,
      slotIso: slot,
    })
  })

  return Response.json({
    ok: true,
    shareToken,
    scheduledAt: slot,
    businessName: tenant.business_name ?? null,
  })
}
