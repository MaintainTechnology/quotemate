// POST /api/dashboard/invites/codes/[id]/send — deliver an invitation code to
// a prospective tradie by email or SMS, straight from the admin Invites page.
// Builds a /signup?code=<CODE> deep link (signup carries `code` through to
// onboard Step-0, prefilling it). Ownership mirrors the PATCH sibling:
// platform-wide codes (tenant_id null) require a platform admin; tenant codes
// require the caller to own that tenant.
//
// Auth: Authorization: Bearer <supabase access token>.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { isPlatformAdmin } from '@/lib/onboard/invitation-codes'
import { appBaseUrl } from '@/lib/email/links'
import { normaliseAuMobile } from '@/lib/phone/au'
import { sendEmail } from '@/lib/email/resend'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import {
  inviteSmsText,
  inviteEmailSubject,
  inviteEmailHtml,
  inviteEmailText,
} from '@/lib/onboard/invite-message'

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SendBody = z.object({
  channel: z.enum(['email', 'sms']),
  to: z.string().trim().min(1).max(200),
})

/** Public base URL for the signup link; fall back to the request origin when
 *  APP_URL isn't configured (e.g. local dev without the env var). */
function resolveBase(req: Request): string {
  try {
    return appBaseUrl()
  } catch {
    try {
      return new URL(req.url).origin
    } catch {
      return ''
    }
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params // Next 16: params is a Promise
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = SendBody.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }
  const { channel, to } = parsed.data

  // Load the code + ownership context.
  const { data: code } = await supabase
    .from('onboarding_codes')
    .select('id, code, tenant_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!code) return Response.json({ error: 'not_found' }, { status: 404 })

  // Ownership: platform-wide codes need a platform admin; tenant codes need the
  // caller to own that tenant. Capture the business name for the message copy.
  let businessName = 'QuoteMax'
  if (code.tenant_id === null) {
    if (!isPlatformAdmin(user.id)) return Response.json({ error: 'forbidden' }, { status: 403 })
  } else {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, business_name')
      .eq('owner_user_id', user.id)
      .maybeSingle()
    if (!tenant || tenant.id !== code.tenant_id) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
    if (tenant.business_name) businessName = tenant.business_name as string
  }

  // A revoked code can never be redeemed — refuse to send it.
  if (code.status === 'revoked') {
    return Response.json(
      { error: 'code_revoked', message: 'That code has been revoked and can no longer be used.' },
      { status: 422 },
    )
  }

  const codeStr = code.code as string
  const signupUrl = `${resolveBase(req)}/signup?code=${encodeURIComponent(codeStr)}`

  if (channel === 'email') {
    const emailTo = to.trim()
    if (!EMAIL_RE.test(emailTo)) {
      return Response.json({ error: 'invalid_recipient', message: 'Enter a valid email address.' }, { status: 400 })
    }
    const result = await sendEmail({
      to: emailTo,
      subject: inviteEmailSubject({ businessName }),
      html: inviteEmailHtml({ code: codeStr, businessName, signupUrl }),
      text: inviteEmailText({ code: codeStr, businessName, signupUrl }),
    })
    if (!result.ok) {
      const status = result.code === 'not_configured' ? 503 : 502
      return Response.json({ error: 'send_failed', channel, reason: result.reason }, { status })
    }
    return Response.json({ ok: true, channel, to: emailTo, messageId: result.messageId })
  }

  // channel === 'sms'
  const smsTo = normaliseAuMobile(to)
  if (!smsTo) {
    return Response.json(
      { error: 'invalid_recipient', message: 'Enter a valid Australian mobile number.' },
      { status: 400 },
    )
  }
  const result = await dispatchQuoteMessage({
    to: smsTo,
    text: inviteSmsText({ code: codeStr, businessName, signupUrl }),
  })
  if (!result.ok) {
    return Response.json(
      { error: 'send_failed', channel, reason: result.smsAttempt?.reason ?? 'sms_failed' },
      { status: 502 },
    )
  }
  return Response.json({ ok: true, channel, to: smsTo, sid: result.sid })
}
