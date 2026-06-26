// /api/tenant/campaigns/announcement — the "announce my QuoteMax account" blast.
//
// GET  → campaign summary (counts) for the dashboard.
// POST → preview (default) or send.
//        body: { mode?: 'unsent' | 'all', confirm?: boolean }
//        - confirm !== true  → PREVIEW: compute the recipient list + breakdown,
//                              send nothing. (R7 confirm-before-send.)
//        - confirm === true  → SEND: render + deliver per recipient, record
//                              per-recipient status (R12), update counts.
//
// The campaign is re-sendable (R6): 'unsent' (default) targets contacts not yet
// sent this campaign; 'all' re-targets everyone. Unsubscribes are always
// suppressed. Compliance (address + unsubscribe + Twilio number) is enforced by
// the renderer, which throws if any required field is missing.

import { getServiceClient } from '@/lib/supabase/admin'
import { tenantFromBearer } from '@/lib/tenant/bearer'
import { selectRecipients, type Contact, type SelectMode } from '@/lib/email/recipients'
import { renderAnnouncementEmail, type AnnouncementTenant } from '@/lib/email/announcement'
import { sendCampaign, summarizeOutcomes } from '@/lib/email/campaign'
import { sendEmail } from '@/lib/email/resend'
import { generateQrDataUrl } from '@/lib/qr/generate'
import { tenantIntakeUrl, unsubscribeUrl } from '@/lib/email/links'
import { makeUnsubscribeToken } from '@/lib/email/unsubscribe-token'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TENANT_COLUMNS = 'id, business_name, business_address, twilio_sms_number, contact_name'

type TenantRow = {
  id: string
  business_name: string | null
  business_address: string | null
  twilio_sms_number: string | null
  contact_name: string | null
}

/**
 * Fetch-or-create the single 'announcement' campaign row for a tenant. Atomic —
 * backed by the unique index on (tenant_id, type), so two concurrent sends can't
 * create duplicate rows (which would later break .maybeSingle() reads). The
 * payload omits `status` so a conflict on an already-sent campaign doesn't reset
 * it back to 'draft'.
 */
async function getOrCreateCampaign(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('email_campaigns')
    .upsert({ tenant_id: tenantId, type: 'announcement' }, { onConflict: 'tenant_id,type' })
    .select('id')
    .single()
  return data ? { id: data.id as string } : null
}

export async function GET(req: Request) {
  const supabase = getServiceClient()
  const tenant = await tenantFromBearer(supabase, req, 'id')
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('email_campaigns')
    .select('id, status, recipient_count, sent_count, failed_count, last_sent_at')
    .eq('tenant_id', tenant.id as string)
    .eq('type', 'announcement')
    .maybeSingle()

  return Response.json({ campaign: data ?? null })
}

export async function POST(req: Request) {
  const supabase = getServiceClient()
  const tenant = (await tenantFromBearer(supabase, req, TENANT_COLUMNS)) as TenantRow | null
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenantId = tenant.id

  let body: { mode?: string; confirm?: boolean } = {}
  try {
    body = (await req.json()) as { mode?: string; confirm?: boolean }
  } catch {
    /* empty body → preview, unsent mode */
  }
  const mode: SelectMode = body.mode === 'all' ? 'all' : 'unsent'
  const confirm = body.confirm === true

  // Compliance/usefulness gate — the announcement needs a physical address +
  // the tradie's Twilio number. Surface a 400 the dashboard can act on.
  const missing: string[] = []
  if (!tenant.business_address) missing.push('business_address')
  if (!tenant.twilio_sms_number) missing.push('twilio_sms_number')
  if (!tenant.business_name) missing.push('business_name')
  if (missing.length > 0) {
    return Response.json({ error: 'missing_business_details', missing }, { status: 400 })
  }

  const campaign = await getOrCreateCampaign(supabase, tenantId)
  if (!campaign) return Response.json({ error: 'campaign_init_failed' }, { status: 500 })

  // Load contacts, unsubscribes, and prior successful sends.
  const [contactsRes, unsubRes, sentRes] = await Promise.all([
    supabase.from('crm_contacts').select('email, first_name').eq('tenant_id', tenantId),
    supabase.from('email_unsubscribes').select('email').eq('tenant_id', tenantId),
    supabase
      .from('email_sends')
      .select('email')
      .eq('campaign_id', campaign.id)
      .eq('status', 'sent'),
  ])

  const contacts: Contact[] = (contactsRes.data ?? []).map((r) => ({
    email: r.email as string,
    first_name: (r.first_name as string | null) ?? null,
  }))
  const unsubscribed = (unsubRes.data ?? []).map((r) => r.email as string)
  const alreadySent = (sentRes.data ?? []).map((r) => r.email as string)

  const selection = selectRecipients({ contacts, unsubscribed, alreadySent, mode })

  const breakdown = {
    total_contacts: contacts.length,
    recipient_count: selection.recipients.length,
    suppressed_unsubscribed: selection.suppressedUnsubscribed,
    skipped_already_sent: selection.skippedAlreadySent,
    duplicates_removed: selection.duplicatesRemoved,
    invalid_removed: selection.invalidRemoved,
  }

  // Links + branding shared by both the preview render and the send loop.
  // Env-first base (the request origin reflects a spoofable Host header, so a
  // trusted APP_URL takes precedence and only falls back to the origin in dev).
  const base = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const intakeUrl = tenantIntakeUrl(tenantId, base)
  const announcementTenant: AnnouncementTenant = {
    business_name: tenant.business_name,
    business_address: tenant.business_address,
    twilio_sms_number: tenant.twilio_sms_number,
    contact_name: tenant.contact_name,
  }

  // ── PREVIEW (R7: recipient count + an email preview; sends nothing) ──
  if (!confirm) {
    let subject: string | null = null
    let html: string | null = null
    try {
      const qrDataUrl = await generateQrDataUrl(intakeUrl)
      const rendered = renderAnnouncementEmail({
        tenant: announcementTenant,
        recipientFirstName: selection.recipients[0]?.first_name ?? null,
        intakeUrl,
        qrDataUrl,
        // Display-only token — this email is never delivered.
        unsubscribeUrl: unsubscribeUrl(makeUnsubscribeToken(tenantId, 'preview@example.com'), base),
      })
      subject = rendered.subject
      html = rendered.html
    } catch {
      // Fall back to count-only if QR / signing secret / render is unavailable.
    }
    return Response.json({ preview: true, mode, ...breakdown, subject, html })
  }

  // ── SEND ───────────────────────────────────────────────────────────
  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: 'email_not_configured' }, { status: 503 })
  }

  // Record unsubscribe-suppressed recipients per-recipient (R12). Insert-only,
  // so this never downgrades an existing 'sent' row on a re-send.
  if (selection.suppressedEmails.length > 0) {
    await supabase.from('email_sends').upsert(
      selection.suppressedEmails.map((email) => ({
        tenant_id: tenantId,
        campaign_id: campaign.id,
        email,
        status: 'suppressed' as const,
        message_id: null,
        error: null,
        sent_at: null,
      })),
      { onConflict: 'campaign_id,email', ignoreDuplicates: true },
    )
  }

  if (selection.recipients.length === 0) {
    return Response.json({ ok: true, mode, ...breakdown, sent: 0, failed: 0, note: 'no_recipients' })
  }

  const qrDataUrl = await generateQrDataUrl(intakeUrl)

  await supabase
    .from('email_campaigns')
    .update({
      status: 'sending',
      subject: `${tenant.business_name} now gives instant quotes — just text us`,
      recipient_count: selection.recipients.length,
    })
    .eq('id', campaign.id)

  const outcomes = await sendCampaign({
    recipients: selection.recipients,
    buildMessage: (contact) =>
      renderAnnouncementEmail({
        tenant: announcementTenant,
        recipientFirstName: contact.first_name,
        intakeUrl,
        qrDataUrl,
        unsubscribeUrl: unsubscribeUrl(makeUnsubscribeToken(tenantId, contact.email), base),
      }),
    send: async (msg) => {
      const r = await sendEmail({ to: msg.to, subject: msg.subject, html: msg.html, text: msg.text })
      return r.ok ? { ok: true, messageId: r.messageId } : { ok: false, reason: r.reason }
    },
  })

  const nowIso = new Date().toISOString()

  // Split the write: a 'sent' outcome always wins (overwrite + stamp sent_at);
  // a 'failed' outcome is insert-only so a transient failure on re-send never
  // downgrades a prior successful delivery.
  const sentRows = outcomes
    .filter((o) => o.status === 'sent')
    .map((o) => ({
      tenant_id: tenantId,
      campaign_id: campaign.id,
      email: o.email,
      status: 'sent' as const,
      message_id: o.messageId ?? null,
      error: null,
      sent_at: nowIso,
    }))
  const failedRows = outcomes
    .filter((o) => o.status === 'failed')
    .map((o) => ({
      tenant_id: tenantId,
      campaign_id: campaign.id,
      email: o.email,
      status: 'failed' as const,
      message_id: null,
      error: o.error ?? null,
      sent_at: null,
    }))
  if (sentRows.length > 0) {
    await supabase.from('email_sends').upsert(sentRows, { onConflict: 'campaign_id,email' })
  }
  if (failedRows.length > 0) {
    await supabase
      .from('email_sends')
      .upsert(failedRows, { onConflict: 'campaign_id,email', ignoreDuplicates: true })
  }

  const summary = summarizeOutcomes(outcomes)

  // Lifetime (cumulative) counts from the per-recipient log — not just this
  // batch — so the dashboard "Sent" total never drops after a small re-send.
  const [sentTotal, failedTotal] = await Promise.all([
    supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .eq('status', 'sent'),
    supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .eq('status', 'failed'),
  ])

  await supabase
    .from('email_campaigns')
    .update({
      status: summary.failed > 0 && summary.sent === 0 ? 'failed' : 'sent',
      sent_count: sentTotal.count ?? summary.sent,
      failed_count: failedTotal.count ?? summary.failed,
      last_sent_at: nowIso,
    })
    .eq('id', campaign.id)

  return Response.json({ ok: true, mode, ...breakdown, sent: summary.sent, failed: summary.failed })
}
