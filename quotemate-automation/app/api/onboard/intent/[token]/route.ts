// GET /api/onboard/intent/[token] — resolve an SMS-initiated signup
// intent token into its prefill payload, for the /signup page to read
// when it loads with ?intent=<token> in the URL.
//
// Returns distinct invalid/expired/used states so acquisition clients can
// recover accurately without ever retrying an SMS-only invitation as web.

import { createClient } from '@supabase/supabase-js'
import { inspectIntentToken } from '@/lib/onboard/intent-tokens'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Params = { token: string }
const INTENT_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{3,15}$/

export async function GET(
  _req: Request,
  ctx: { params: Promise<Params> },
) {
  const { token } = await ctx.params
  if (!INTENT_TOKEN_RE.test(token)) {
    return Response.json(
      { ok: false, error: 'intent_invalid', message: 'That SMS signup link is invalid.' },
      { status: 400 },
    )
  }

  const inspected = await inspectIntentToken(supabase, token)
  if (inspected.status === 'unavailable') {
    return Response.json(
      { ok: false, error: 'intent_unavailable', message: 'Could not check that signup link just now.' },
      { status: 503 },
    )
  }
  if (inspected.status !== 'verified') {
    const responseStatus = inspected.status === 'expired' ? 410 : inspected.status === 'used' ? 409 : 404
    return Response.json(
      {
        ok: false,
        error: `intent_${inspected.status}`,
        message:
          inspected.status === 'expired'
            ? 'That SMS signup link has expired.'
            : inspected.status === 'used'
              ? 'That SMS signup link was already used.'
              : 'That SMS signup link is invalid.',
      },
      { status: responseStatus },
    )
  }

  const intent = inspected.intent

  return Response.json({
    ok: true,
    intent: {
      owner_mobile: intent.owner_mobile,
      expires_at: intent.expires_at,
      provenance: 'sms',
    },
  })
}
