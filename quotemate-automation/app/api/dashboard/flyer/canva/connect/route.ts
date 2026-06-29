// GET /api/dashboard/flyer/canva/connect
//   Begin the Canva OAuth (authorization-code + PKCE) flow: mint a verifier +
//   challenge + state, persist the one-time state, and return the Canva consent
//   URL. The client opens it in a popup; Canva redirects to /callback when done.
// Auth: Authorization: Bearer <token> (so we know which tenant is connecting).

import { userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { readCanvaConfig, resolveRedirectUri } from '@/lib/canva/config'
import {
  buildAuthorizeUrl,
  generateCodeVerifier,
  codeChallengeFromVerifier,
  generateState,
  CANVA_DEFAULT_SCOPES,
} from '@/lib/canva/oauth'
import { createOauthState } from '@/lib/canva/tokens'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  const cfg = readCanvaConfig()
  if (!cfg) return Response.json({ error: 'canva_not_configured' }, { status: 503 })

  const origin = new URL(req.url).origin
  const redirectUri = resolveRedirectUri(cfg, origin)

  const codeVerifier = generateCodeVerifier()
  const codeChallenge = codeChallengeFromVerifier(codeVerifier)
  const state = generateState()

  // Persist the exact redirect_uri so /callback exchanges with the same value.
  await createOauthState({ state, tenantId: tenant.id, codeVerifier, redirectUri, connectedBy: user.id })

  const url = buildAuthorizeUrl({
    clientId: cfg.clientId,
    redirectUri,
    scopes: CANVA_DEFAULT_SCOPES,
    state,
    codeChallenge,
  })
  return Response.json({ url })
}
