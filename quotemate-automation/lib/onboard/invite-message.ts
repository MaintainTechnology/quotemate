// Invitation-code delivery messages — pure copy builders for the admin
// "send by email / SMS" action (POST /api/dashboard/invites/codes/[id]/send).
// Kept out of the route so the wording is unit-testable without spinning up
// Supabase / Resend / Twilio. Mirrors the SMS-first house style: plain,
// ASCII-friendly, the code stated explicitly plus a deep link that prefills it.

export type InviteMessageInput = {
  /** Canonical invitation code, e.g. JON-JUNE-FLYERS-7K2P or MATE2026. */
  code: string
  /** Inviting business name, or "QuoteMax" for a platform-wide code. */
  businessName: string
  /** Deep link to signup that prefills the code (…/signup?code=CODE). */
  signupUrl: string
}

/** Single-line SMS body. Code is spelled out so it survives if the link is stripped. */
export function inviteSmsText({ code, businessName, signupUrl }: InviteMessageInput): string {
  return `${businessName} invited you to join QuoteMax. Your invite code is ${code} — sign up here: ${signupUrl}`
}

/** Email subject line. */
export function inviteEmailSubject({
  businessName,
}: Pick<InviteMessageInput, 'businessName'>): string {
  return `Your QuoteMax invite code from ${businessName}`
}

/** Plain-text email body (Resend `text` part / fallback). */
export function inviteEmailText({ code, businessName, signupUrl }: InviteMessageInput): string {
  return [
    `${businessName} has invited you to join QuoteMax.`,
    '',
    `Your invite code: ${code}`,
    '',
    `Get started: ${signupUrl}`,
    '',
    'This code unlocks tradie sign-up and is tied to a limited number of slots,',
    'so use it soon. If you were not expecting this, you can ignore this email.',
  ].join('\n')
}

/** HTML email body. */
export function inviteEmailHtml({ code, businessName, signupUrl }: InviteMessageInput): string {
  const safeCode = escapeHtml(code)
  const safeBiz = escapeHtml(businessName)
  const safeUrl = escapeHtml(signupUrl)
  return `<!doctype html>
<html>
  <body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#e9edf5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#121a2b;border:1px solid #243049;">
          <tr><td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8a97ad;">QuoteMax invite</p>
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#ffffff;">${safeBiz} invited you to join QuoteMax.</h1>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#c4cde0;">Use the invite code below to create your tradie account. It is tied to a limited number of sign-up slots, so get in soon.</p>
            <div style="margin:0 0 24px;padding:16px;text-align:center;background:#0b1220;border:1px solid #2c66ff;">
              <span style="font-family:'Courier New',monospace;font-size:20px;letter-spacing:2px;color:#ffffff;">${safeCode}</span>
            </div>
            <a href="${safeUrl}" style="display:inline-block;background:#2c66ff;color:#ffffff;text-decoration:none;padding:12px 24px;font-size:14px;font-weight:bold;">Sign up now &rarr;</a>
            <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#8a97ad;">If the button does not work, paste this link into your browser:<br>${safeUrl}</p>
            <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#8a97ad;">If you were not expecting this invite, you can safely ignore this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
