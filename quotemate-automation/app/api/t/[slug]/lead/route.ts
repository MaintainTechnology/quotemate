// POST /api/t/<slug>/lead — public web-channel intake from a QR landing page.
//
// A homeowner who scanned a flyer submits a photo + a few details. This
// creates a 'web' intake and runs the SAME structure → estimate → quote
// pipeline as voice/SMS, so a flyer scan becomes an AI-drafted quote that
// gets texted back. Money-touching + public → throttled + honeypotted.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { uploadIntakePhoto } from '@/lib/storage/upload'
import { structureIntake } from '@/lib/intake/structure'
import { embedIntake } from '@/lib/intake/embed'
import { findOrCreateCustomer } from '@/lib/customers/lookup'
import { normaliseAuMobile } from '@/lib/onboard/schema'
import { randomUUID } from 'node:crypto'

export const maxDuration = 300

const MAX_FILES = 5
const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const AU_MOBILE = /^(\+?61\s?4\d{2}\s?\d{3}\s?\d{3}|0?4\d{2}\s?\d{3}\s?\d{3})$/

// Per-window limits (1 hour). Generous enough for a real household,
// tight enough that a bot can't run up the LLM bill.
const MOBILE_LIMIT = 3
const IP_LIMIT = 10
const WINDOW_SECONDS = 3600

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, trade, trades, status, business_name, owner_mobile, owner_first_name, twilio_sms_number')
    .ilike('slug', slug)
    .maybeSingle()
  if (!tenant || tenant.status !== 'active') {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ ok: false, error: 'invalid_form' }, { status: 400 })
  }

  // Honeypot — a real human leaves this hidden field empty.
  if ((form.get('company') ?? '').toString().trim()) {
    return Response.json({ ok: true }) // silently accept + drop
  }

  const name = (form.get('name') ?? '').toString().trim()
  const mobileRaw = (form.get('mobile') ?? '').toString().trim()
  const suburb = (form.get('suburb') ?? '').toString().trim()
  const description = (form.get('description') ?? '').toString().trim()

  if (!AU_MOBILE.test(mobileRaw)) {
    return Response.json({ ok: false, error: 'invalid_mobile', message: 'Enter a valid Australian mobile.' }, { status: 400 })
  }
  const mobile = normaliseAuMobile(mobileRaw)

  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) {
    return Response.json({ ok: false, error: 'photo_required', message: 'Please add at least one photo of the job.' }, { status: 400 })
  }
  if (files.length > MAX_FILES) {
    return Response.json({ ok: false, error: 'too_many_files', message: `Up to ${MAX_FILES} photos.` }, { status: 400 })
  }
  for (const f of files) {
    if (!ALLOWED_MIME.has(f.type)) {
      return Response.json({ ok: false, error: 'bad_type', message: 'Photos must be JPEG, PNG or WebP.' }, { status: 400 })
    }
    if (f.size > MAX_SIZE) {
      return Response.json({ ok: false, error: 'too_large', message: 'Each photo must be under 5 MB.' }, { status: 400 })
    }
  }

  // Throttle (per-mobile and per-IP, fixed 1h window) — reject before any
  // upload or LLM spend.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const [mobileBump, ipBump] = await Promise.all([
    supabase.rpc('bump_lead_throttle', { p_key: `mobile:${mobile}`, p_window_seconds: WINDOW_SECONDS }),
    supabase.rpc('bump_lead_throttle', { p_key: `ip:${ip}`, p_window_seconds: WINDOW_SECONDS }),
  ])
  if ((mobileBump.data ?? 0) > MOBILE_LIMIT || (ipBump.data ?? 0) > IP_LIMIT) {
    return Response.json({ ok: false, error: 'rate_limited', message: 'Too many requests — please try again later.' }, { status: 429 })
  }

  // Upload photos now (so we can report upload errors before ack).
  const owner = `web-${randomUUID()}`
  const photoUrls: string[] = []
  const photoPaths: string[] = []
  try {
    let index = 0
    for (const f of files) {
      const buf = new Uint8Array(await f.arrayBuffer())
      const { path, signedUrl } = await uploadIntakePhoto({
        callId: owner,
        data: buf,
        contentType: f.type,
        index: index++,
      })
      photoUrls.push(signedUrl)
      photoPaths.push(path)
    }
  } catch (e: any) {
    return Response.json({ ok: false, error: 'upload_failed', message: e?.message ?? 'Upload failed' }, { status: 500 })
  }

  const customer = await findOrCreateCustomer(mobile, 'web', tenant.id)
  const tradeHint: 'electrical' | 'plumbing' = tenant.trade === 'plumbing' ? 'plumbing' : 'electrical'

  // Heavy work (Opus structuring + estimate) runs after the ack so the
  // homeowner's page returns instantly.
  after(async () => {
    try {
      // Dialog-first (default): seed an SMS conversation and ask the first
      // clarifying question instead of one-shot drafting. The customer's reply
      // flows through /api/sms/inbound → finish → intake → estimate/draft.
      // Flip WEB_LEAD_DIALOG_ENABLED=false to revert to the legacy one-shot path.
      const dialogEnabled = (process.env.WEB_LEAD_DIALOG_ENABLED ?? 'true').toLowerCase() !== 'false'
      if (dialogEnabled) {
        const { startWebLeadConversation } = await import('@/lib/sms/start-web-lead-conversation')
        await startWebLeadConversation({
          supabase,
          tenant: {
            id: tenant.id,
            business_name: tenant.business_name ?? null,
            trade: tenant.trade ?? null,
            trades: (tenant as { trades?: string[] | null }).trades ?? null,
            owner_mobile: (tenant as { owner_mobile?: string | null }).owner_mobile ?? '',
            owner_first_name: (tenant as { owner_first_name?: string | null }).owner_first_name ?? null,
            twilio_sms_number: (tenant as { twilio_sms_number?: string | null }).twilio_sms_number ?? null,
          },
          form: { name, mobile, suburb, description },
          photoPaths,
          photoUrls,
          customerId: customer?.id ?? null,
          fallbackFrom: process.env.TWILIO_SMS_NUMBER ?? null,
        })
        console.log('[t/lead] web lead → SMS dialog started', { tenant: tenant.id })
        return
      }

      // ── Legacy one-shot path (WEB_LEAD_DIALOG_ENABLED=false) ──
      const transcript =
        `New web enquiry from a QR flyer for ${tenant.business_name}.\n` +
        `Customer name: ${name}\n` +
        `Contact mobile: ${mobile}\n` +
        `Suburb: ${suburb}\n` +
        `What they need: ${description}`

      const intake = await structureIntake(transcript, photoUrls, tradeHint)

      // Stamp the contact details we captured verbatim from the form onto
      // the intake, even if the grounding model didn't lift them from the
      // transcript. The quote SMS recipient is read from caller.phone in
      // /api/estimate/draft, so this must always be the customer's mobile.
      intake.caller = {
        ...(intake.caller ?? {}),
        name: (intake.caller?.name || name) ?? '',
        phone: mobile,
      } as typeof intake.caller

      const embedding = await embedIntake(intake)

      const { data: intakeRow, error: insErr } = await supabase
        .from('intakes')
        .insert({
          customer_id: customer?.id ?? null,
          tenant_id: tenant.id,
          trade: intake.trade,
          job_type: intake.job_type,
          address: intake.address,
          suburb: intake.suburb || suburb,
          scope: intake.scope,
          access: intake.access,
          property: intake.property,
          risks: intake.risks,
          inspection_required: intake.inspection_required,
          caller: intake.caller,
          timing: intake.timing,
          confidence: intake.confidence,
          confidence_reason: intake.confidence_reason,
          embedding,
          photo_paths: photoPaths,
        })
        .select()
        .single()
      if (insErr || !intakeRow) {
        console.error('[t/lead] intake insert failed', insErr?.message)
        return
      }

      // Resolve the base URL for the self-call to /api/estimate/draft.
      // Prefer the configured APP_URL (prod), but fall back to the
      // request's own origin so the quote pipeline still fires in dev /
      // preview environments where APP_URL isn't set. Without this, the
      // fetch becomes "undefined/api/estimate/draft" and no quote drafts.
      const appUrl =
        process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
      const draftRes = await fetch(`${appUrl}/api/estimate/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intakeId: intakeRow.id }),
      })
      if (!draftRes.ok) {
        console.error('[t/lead] estimate/draft returned', draftRes.status, (await draftRes.text()).slice(0, 200))
      } else {
        console.log('[t/lead] web intake → estimate/draft dispatched', { intakeId: intakeRow.id, appUrl })
      }
    } catch (e: any) {
      console.error('[t/lead] web intake pipeline failed', e?.message ?? String(e))
    }
  })

  return Response.json({ ok: true })
}
