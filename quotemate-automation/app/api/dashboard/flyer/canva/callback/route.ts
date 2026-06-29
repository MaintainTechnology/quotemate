// GET /api/dashboard/flyer/canva/callback
//   The OAuth redirect target (must be registered in the Canva Developer
//   Portal). Canva sends ?code&state (or ?error). We look up the one-time PKCE
//   state, exchange the code for tokens, and persist the tenant's connection.
//   No Bearer here — this is a top-level browser redirect; the unguessable
//   one-time `state` (created only by an authenticated /connect call) binds the
//   callback to the right tenant. Responds with a tiny HTML page that notifies
//   the opener window and closes the popup.

import { readCanvaConfig } from '@/lib/canva/config'
import { buildTokenExchangeRequest, parseTokenResponse } from '@/lib/canva/oauth'
import { consumeOauthState, saveConnection } from '@/lib/canva/tokens'
import { getCanvaUserId } from '@/lib/canva/client'

export const dynamic = 'force-dynamic'

function resultPage(ok: boolean, error: string | null): Response {
  const payload = JSON.stringify({ type: 'canva-oauth', ok, error })
  const heading = ok ? 'Canva connected' : 'Canva connection failed'
  const body = ok
    ? 'You can close this window and return to QuoteMax.'
    : `Something went wrong (${error ?? 'unknown'}). Close this window and try again.`
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${heading}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e8edf5;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
  .card{max-width:340px;padding:28px;border:1px solid #243049;border-radius:2px;background:#111a2e}
  h1{font-size:15px;text-transform:uppercase;letter-spacing:.12em;margin:0 0 10px}
  p{font-size:13px;color:#9fb0c9;line-height:1.6;margin:0}
</style></head>
<body><div class="card"><h1>${heading}</h1><p>${body}</p></div>
<script>
  (function(){
    try { if (window.opener) window.opener.postMessage(${payload}, window.location.origin); } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch (e) {} }, 1200);
  })();
</script></body></html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(req: Request) {
  const u = new URL(req.url)
  const oauthError = u.searchParams.get('error')
  const code = u.searchParams.get('code')
  const state = u.searchParams.get('state')

  if (oauthError) return resultPage(false, oauthError)
  if (!code || !state) return resultPage(false, 'missing_code_or_state')

  const st = await consumeOauthState(state)
  if (!st) return resultPage(false, 'invalid_or_expired_state')

  const cfg = readCanvaConfig()
  if (!cfg) return resultPage(false, 'canva_not_configured')

  const def = buildTokenExchangeRequest({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    code,
    codeVerifier: st.code_verifier,
    redirectUri: st.redirect_uri,
  })

  let json: unknown = null
  try {
    const res = await fetch(def.url, { method: def.method, headers: def.headers, body: def.body })
    if (!res.ok) return resultPage(false, `token_exchange_${res.status}`)
    json = await res.json()
  } catch {
    return resultPage(false, 'token_exchange_network_error')
  }

  let tokens
  try {
    tokens = parseTokenResponse(json, Date.now())
  } catch {
    return resultPage(false, 'token_parse_failed')
  }

  const canvaUserId = await getCanvaUserId(tokens.accessToken)
  await saveConnection({ tenantId: st.tenant_id, tokens, canvaUserId, connectedBy: st.connected_by })

  return resultPage(true, null)
}
