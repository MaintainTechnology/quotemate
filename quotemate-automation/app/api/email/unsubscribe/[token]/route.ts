// GET /api/email/unsubscribe/[token] — public one-click unsubscribe.
//
// The token is a signed (tenant_id, email) pair embedded in every announcement
// email. We verify it, record the suppression (idempotent), and return a small
// HTML confirmation page. No auth — the signature IS the authorisation.
//
// Next 16: params is a Promise (await it).

import { getServiceClient } from '@/lib/supabase/admin'
import { parseUnsubscribeToken } from '@/lib/email/unsubscribe-token'

export const dynamic = 'force-dynamic'

function page(title: string, message: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f4f4f5;color:#18181b;">
<div style="max-width:480px;margin:64px auto;background:#fff;border-radius:12px;padding:32px;text-align:center;">
<h1 style="font-size:20px;margin:0 0 12px;">${title}</h1>
<p style="font-size:15px;line-height:1.5;color:#3f3f46;margin:0;">${message}</p>
</div></body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const parsed = parseUnsubscribeToken(token)
  if (!parsed) {
    return page('Invalid link', 'This unsubscribe link is invalid or has expired.', 400)
  }

  try {
    const supabase = getServiceClient()
    await supabase
      .from('email_unsubscribes')
      .upsert(
        { tenant_id: parsed.tenantId, email: parsed.email },
        { onConflict: 'tenant_id,email', ignoreDuplicates: true },
      )
  } catch {
    return page('Something went wrong', 'We could not process your request. Please try again later.', 500)
  }

  return page(
    'You have been unsubscribed',
    `${parsed.email} will no longer receive these emails. You can close this page.`,
    200,
  )
}
