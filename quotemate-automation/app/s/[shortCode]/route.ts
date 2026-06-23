// GET /s/<shortCode> — public QR redirect + scan tracking.
//
// Resolves a marketing_qrs row, logs the scan (non-blocking), then routes:
//   • landing  → 302 to /t/<slug>?qr=<shortCode>
//   • signup   → 302 to SIGNUP_URL?ref=<shortCode> (tradie recruitment)
//   • sms      → interstitial HTML that auto-launches sms:<number>?body=…
//               (302-to-sms: is unreliable across browsers, so we serve a
//                tiny page that triggers the link + shows a tap button).
// Unknown / archived codes redirect home; paused codes show a notice.

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { resolveDestination } from '@/lib/marketing/qr'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function appOrigin(req: Request): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(req: Request, ctx: { params: Promise<{ shortCode: string }> }) {
  const { shortCode } = await ctx.params
  const origin = appOrigin(req)

  const { data: qr } = await supabase
    .from('marketing_qrs')
    .select('id, short_code, tenant_id, destination_type, destination_config, status')
    .ilike('short_code', shortCode)
    .maybeSingle()

  // Unknown or archived → quietly send them to the app home.
  if (!qr || qr.status === 'archived') {
    return Response.redirect(origin, 302)
  }
  if (qr.status === 'paused') {
    return htmlResponse(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available</title><body style="font-family:system-ui;padding:2rem;text-align:center"><h2>This code isn't active right now</h2><p>Please check back later.</p></body>`,
      200,
    )
  }

  // Need the tenant's slug + SMS number to resolve the destination.
  const { data: tenant } = await supabase
    .from('tenants')
    .select('slug, twilio_sms_number')
    .eq('id', qr.tenant_id)
    .maybeSingle()

  // Log the scan without blocking the redirect.
  const ua = req.headers.get('user-agent')
  const ref = req.headers.get('referer')
  after(async () => {
    try {
      await supabase.from('qr_scans').insert({ qr_id: qr.id, user_agent: ua, referrer: ref })
      await supabase.rpc('increment_qr_scan', { p_qr_id: qr.id })
    } catch {
      // non-fatal — a missed scan log must never break the redirect
    }
  })

  const dest = resolveDestination(
    qr as Parameters<typeof resolveDestination>[0],
    (tenant ?? { slug: null, twilio_sms_number: null }) as Parameters<typeof resolveDestination>[1],
    origin,
  )

  // landing + signup are both a plain 302 to an https URL.
  if (dest.kind === 'landing' || dest.kind === 'signup') {
    return Response.redirect(dest.url, 302)
  }

  // SMS destination — interstitial that launches the messaging app.
  if (!dest.number) {
    return Response.redirect(origin, 302)
  }
  return htmlResponse(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Text for a quote</title>
<meta http-equiv="refresh" content="0;url=${dest.smsUri}">
<style>body{font-family:system-ui;padding:2.5rem 1.5rem;text-align:center;color:#111}a.btn{display:inline-block;margin-top:1.25rem;background:#ff5a1f;color:#fff;text-decoration:none;font-weight:600;padding:.9rem 1.6rem;border-radius:8px}</style>
</head><body>
<h2>Opening your messages…</h2>
<p>Tap below if it doesn't open automatically.</p>
<a class="btn" href="${dest.smsUri}">Text us for a quote</a>
<script>location.href=${JSON.stringify(dest.smsUri)}</script>
</body></html>`,
  )
}
