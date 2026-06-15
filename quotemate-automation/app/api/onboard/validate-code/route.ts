// POST /api/onboard/validate-code — read-only invitation-code check.
// Called on-blur from the /onboard Step-0 gate and from the SMS inbound
// handler. Never consumes quota (that happens at /api/onboard/activate).

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { checkInvitationCode } from '@/lib/onboard/invitation-codes'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const Body = z.object({
  code: z.string().trim().min(1).max(60),
  channel: z.enum(['web', 'sms']).optional(),
})

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }
  const result = await checkInvitationCode(supabase, parsed.data.code)
  // 200 for valid, 422 for a well-formed but invalid code so the client
  // can distinguish "bad request" (400) from "code rejected" (422).
  return Response.json(result, { status: result.ok ? 200 : 422 })
}
