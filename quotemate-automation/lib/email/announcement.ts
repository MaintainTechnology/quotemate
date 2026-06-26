// Renders the "I'm now on QuoteMax" announcement email. Enforces the spec's
// content requirements (R8) and the legal/compliance requirements (R10) at
// render time: business name, physical address, the tradie's Twilio number, a
// QR image, an intake CTA, and a working unsubscribe link must all be present,
// or rendering throws. That makes "compliant or it doesn't send" a hard
// invariant rather than a thing a caller has to remember.

export type AnnouncementTenant = {
  business_name: string | null
  business_address: string | null
  twilio_sms_number: string | null
  contact_name?: string | null
}

export type AnnouncementParams = {
  tenant: AnnouncementTenant
  recipientFirstName?: string | null
  intakeUrl: string
  qrDataUrl: string
  unsubscribeUrl: string
}

export type RenderedEmail = { subject: string; html: string; text: string }

/** Escape text for safe interpolation into HTML attribute / element context. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function requireField(value: string | null | undefined, label: string): string {
  const v = (value ?? '').trim()
  if (!v) throw new Error(`announcement email requires ${label}`)
  return v
}

export function renderAnnouncementEmail(p: AnnouncementParams): RenderedEmail {
  const businessName = requireField(p.tenant.business_name, 'a business name')
  const address = requireField(p.tenant.business_address, 'a business address')
  const phone = requireField(p.tenant.twilio_sms_number, 'a Twilio phone number')
  const intakeUrl = requireField(p.intakeUrl, 'an intake URL')
  const qrDataUrl = requireField(p.qrDataUrl, 'a QR image')
  const unsubscribeUrl = requireField(p.unsubscribeUrl, 'an unsubscribe URL')

  const greetingName = (p.recipientFirstName ?? '').trim() || 'there'
  const signOff = (p.tenant.contact_name ?? '').trim() || businessName

  const subject = `${businessName} now gives instant quotes — just text us`

  const text = [
    `Hi ${greetingName},`,
    '',
    `Good news — ${businessName} is now on QuoteMax, so you can get a fast,`,
    `itemised quote without waiting around for a callback.`,
    '',
    `Need a price? Text a quick description of the job (a photo helps) to ${phone},`,
    `or open ${intakeUrl}. You'll get a clear Good / Better / Best quote back,`,
    `usually within minutes.`,
    '',
    businessName,
    address,
    phone,
    '',
    `Cheers,`,
    signOff,
    '',
    '—',
    `You're receiving this because you're a contact of ${businessName}.`,
    `Unsubscribe: ${unsubscribeUrl}`,
    `${businessName} · ${address}`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px 32px;">
          <p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;">Hi ${esc(greetingName)},</p>
          <p style="margin:0 0 16px 0;font-size:16px;line-height:1.5;">
            Good news — <strong>${esc(businessName)}</strong> is now on QuoteMax, so you can get a fast,
            itemised quote without waiting around for a callback.
          </p>
          <p style="margin:0 0 24px 0;font-size:16px;line-height:1.5;">
            Need a price? Text a quick description of the job (a photo helps) to
            <strong>${esc(phone)}</strong>, or scan the code below. You'll get a clear
            Good / Better / Best quote back, usually within minutes.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 8px 32px;">
          <a href="${esc(intakeUrl)}" style="text-decoration:none;">
            <img src="${esc(qrDataUrl)}" width="200" height="200" alt="Scan to start your quote with ${esc(businessName)}" style="display:block;border:0;border-radius:8px;" />
          </a>
          <p style="margin:8px 0 0 0;font-size:13px;color:#71717a;">
            <a href="${esc(intakeUrl)}" style="color:#ff5a1f;text-decoration:none;">Scan or tap to start your quote</a>
          </p>
        </td></tr>
        <tr><td style="padding:24px 32px 8px 32px;border-top:1px solid #f4f4f5;">
          <p style="margin:0;font-size:15px;line-height:1.6;color:#3f3f46;">
            <strong>${esc(businessName)}</strong><br>
            ${esc(address)}<br>
            ${esc(phone)}
          </p>
          <p style="margin:16px 0 0 0;font-size:15px;line-height:1.5;">Cheers,<br>${esc(signOff)}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 28px 32px;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
            You're receiving this because you're a contact of ${esc(businessName)}.<br>
            <a href="${esc(unsubscribeUrl)}" style="color:#a1a1aa;">Unsubscribe</a> · ${esc(businessName)} · ${esc(address)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}
