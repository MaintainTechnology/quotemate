// ════════════════════════════════════════════════════════════════════
// POST /api/opensolar/confirm/[token] — the forced tradie review step
// for an imported OpenSolar proposal.
//
// Mirrors /api/pylon/confirm/[token]: a flagged proposal (STC / totals
// mismatch) cannot be confirmed — the fix loop is edit-in-OpenSolar-
// studio → re-import. Confirm stamps confirmed_at, creates the Stripe
// deposit Checkout from the design's own deposit figure, then (after the
// response) renders the PDF, texts the customer their proposal, and —
// allowlist-gated, best-effort — advances the OpenSolar project workflow
// stage so the tradie's pipeline tracks the release.
//
// Next 16: params is a Promise (await it). Bearer auth required.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import {
  ensureOpenSolarProposalPdf,
  openSolarProposalPdfUrl,
  signQuotePdfUrl,
} from '@/lib/quote/pdf'
import { dispatchQuoteWithPdf } from '@/lib/sms/send-quote-pdf'
import {
  openSolarLeadPushEnabled,
  openSolarProposalsEnabled,
  updateOpenSolarProjectStage,
} from '@/lib/opensolar/client'
import { createOpenSolarDepositCheckoutSession } from '@/lib/opensolar/checkout'
import { buildOpenSolarCustomerSms } from '@/lib/opensolar/notify'
import {
  buildOpenSolarQuoteUrl,
  formatAud,
  type OpenSolarProposalCustomer,
  type OpenSolarProposalDesign,
} from '@/lib/opensolar/proposal'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  if (!openSolarProposalsEnabled(process.env)) {
    return Response.json({ ok: false, error: 'opensolar_disabled' }, { status: 404 })
  }

  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'invalid_token' }, { status: 400 })
  }

  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const supabase = getSupabase()
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7).trim())
  if (userErr || !userData?.user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: row, error } = await supabase
    .from('opensolar_proposals')
    .select(
      'id, tenant_id, public_token, opensolar_project_id, title, address_text, customer, design, flags, confirmed_at',
    )
    .eq('public_token', token)
    .maybeSingle()
  if (error || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const flags = Array.isArray(row.flags) ? (row.flags as string[]) : []
  if (flags.length > 0) {
    return Response.json(
      {
        ok: false,
        error:
          'This proposal has open checks. Fix the design in OpenSolar studio and re-import before confirming.',
      },
      { status: 409 },
    )
  }
  if (row.confirmed_at) {
    return Response.json({ ok: true, confirmed_at: row.confirmed_at })
  }

  const design = (row.design as OpenSolarProposalDesign | null) ?? null
  const customer = (row.customer as OpenSolarProposalCustomer | null) ?? null
  const appUrl = (process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app').replace(/\/$/, '')

  // Deposit Checkout from the design's own deposit figure (best-effort —
  // a Stripe hiccup must not block the release; the page just omits the CTA).
  let checkoutUrl: string | null = null
  if (design) {
    try {
      checkoutUrl = await createOpenSolarDepositCheckoutSession({
        token,
        design,
        customerEmail: customer?.email ?? null,
        appUrl,
      })
    } catch (e) {
      console.warn(
        '[opensolar/confirm] deposit session failed (non-fatal)',
        e instanceof Error ? e.message : e,
      )
    }
  }

  const confirmedAt = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('opensolar_proposals')
    .update({
      confirmed_at: confirmedAt,
      status: 'confirmed',
      stripe_checkout_url: checkoutUrl,
      updated_at: confirmedAt,
    })
    .eq('id', row.id)
  if (updErr) {
    return Response.json({ ok: false, error: 'confirm_failed' }, { status: 500 })
  }

  // Heavy work after the response: PDF render + customer SMS/MMS + the
  // optional OpenSolar pipeline stage sync. All best-effort.
  after(() =>
    sendCustomerOpenSolarProposal(supabase, {
      tenantId: (row.tenant_id as string | null) ?? null,
      token,
      title: (row.title as string | null) ?? design?.system_name ?? null,
      customer,
      design,
      appUrl,
    }),
  )
  after(() =>
    syncOpenSolarStage({
      tenantId: (row.tenant_id as string | null) ?? null,
      projectId: row.opensolar_project_id as string,
    }),
  )

  return Response.json({ ok: true, confirmed_at: confirmedAt })
}

/** Best-effort customer SMS with the proposal + PDF links. Never throws. */
async function sendCustomerOpenSolarProposal(
  supabase: ReturnType<typeof getSupabase>,
  args: {
    tenantId: string | null
    token: string
    title: string | null
    customer: OpenSolarProposalCustomer | null
    design: OpenSolarProposalDesign | null
    appUrl: string
  },
): Promise<void> {
  try {
    const phone = args.customer?.phone?.trim()
    if (!phone) return

    const { data: tenant } = await supabase
      .from('tenants')
      .select('business_name, twilio_sms_number')
      .eq('id', args.tenantId)
      .maybeSingle()
    const businessName = (tenant?.business_name as string | null) ?? 'Your installer'

    const pdfPath = await ensureOpenSolarProposalPdf(args.token)
    const totalFormatted =
      args.design?.price_including_tax_aud != null
        ? formatAud(args.design.price_including_tax_aud)
        : null

    const body = buildOpenSolarCustomerSms({
      businessName,
      customerName: args.customer?.name ?? null,
      title: args.title,
      totalFormatted,
      quoteUrl: buildOpenSolarQuoteUrl(args.appUrl, args.token),
      pdfUrl: pdfPath ? openSolarProposalPdfUrl(args.token) : null,
    })
    await dispatchQuoteWithPdf({
      to: phone,
      text: body,
      from: (tenant?.twilio_sms_number as string | null) ?? process.env.TWILIO_SMS_NUMBER,
      pdfPath,
      signMediaUrl: signQuotePdfUrl,
    })
  } catch (e) {
    console.error(
      '[opensolar/confirm] customer proposal send failed (non-fatal)',
      e instanceof Error ? e.message : e,
    )
  }
}

/**
 * Best-effort OpenSolar pipeline sync: advance the project's workflow
 * stage on release. Only runs when the tenant is on the write-path
 * allowlist AND an explicit, Phase-0-verified stage id is configured
 * (OPENSOLAR_CONFIRM_STAGE_ID) — we never PATCH a guessed stage into the
 * tradie's CRM.
 */
async function syncOpenSolarStage(args: {
  tenantId: string | null
  projectId: string
}): Promise<void> {
  try {
    if (!openSolarLeadPushEnabled(process.env, args.tenantId)) return
    const stageId = Number.parseInt(process.env.OPENSOLAR_CONFIRM_STAGE_ID ?? '', 10)
    if (!Number.isFinite(stageId)) return
    const res = await updateOpenSolarProjectStage(args.projectId, stageId)
    if (!res.ok) {
      console.warn(`[opensolar/confirm] stage sync skipped (${res.code}): ${res.detail}`)
    }
  } catch (e) {
    console.warn(
      '[opensolar/confirm] stage sync failed (non-fatal)',
      e instanceof Error ? e.message : e,
    )
  }
}
