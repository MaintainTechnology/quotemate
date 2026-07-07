// /api/onboard/retry-provision — re-runs Twilio + Vapi provisioning for a
// tenant whose first activation persisted the tenant row but failed at
// the external provisioning step (most often: Twilio account not yet
// funded, no AU inventory, or transient API error).
//
// Auth: Bearer <supabase-access-token>, same pattern as /api/tenant/me.
// We resolve the tenant by owner_user_id rather than trusting a client-
// supplied tenant_id so users can only re-provision their own tenant.
//
// Idempotent: if the tenant already has both twilio_sms_number AND
// vapi_assistant_id we short-circuit with the current values. If only
// one is set, runProvisioning finishes the missing half.
//
// Successful response shape mirrors /api/onboard/activate so the client
// can treat the two endpoints interchangeably.

import { createClient } from '@supabase/supabase-js'
import { runProvisioning } from '@/lib/onboard/run-provisioning'
import { setTwilioSmsWebhook } from '@/lib/twilio/set-sms-webhook'
import { isStubTwilioNumber, isStubVapiId } from '@/lib/onboard/health'
import { computePreflight } from '@/lib/onboard/preflight-logic'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  // Dual-auth: resolve the caller's tenant by clerk_user_id or owner_user_id,
  // never a client-supplied id, so users only re-provision their own tenant.
  const resolved = await resolveTenantRequest(
    supabase,
    req,
    'id, business_name, owner_first_name, owner_mobile, trade, trades, twilio_sms_number, vapi_assistant_id, status',
  )
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // Provisioning mode (live vs stub) — surfaced on every response so a stub
  // retry is never mistaken for a production-ready tenant (spec A2).
  const { summary } = computePreflight(process.env)
  const provisioningMode = { twilio: summary.twilio_mode, vapi: summary.vapi_mode }

  const tenant = resolved.tenant as {
    id: string
    business_name: string | null
    owner_first_name: string | null
    owner_mobile: string | null
    trade: string | null
    trades: string[] | null
    twilio_sms_number: string | null
    vapi_assistant_id: string | null
    status: string | null
  } | null
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  // Fast path: already fully provisioned. We still reset the SMS
  // webhook on every hit because Vapi's /phone-number registration has
  // a history of rewriting Twilio's SmsUrl to api.vapi.ai/twilio/sms
  // (its AI-SMS feature) — and we always want inbound texts to land
  // at /api/sms/inbound so our tenant lookup + intake structurer run.
  // Tradies stuck with the wrong webhook can hit Retry and have it
  // self-heal without re-running Twilio purchase or Vapi assistant
  // creation.
  if (tenant.twilio_sms_number && tenant.vapi_assistant_id) {
    const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
    let smsWarning: string | undefined
    if (appUrl) {
      const smsHook = await setTwilioSmsWebhook({
        phoneNumber: tenant.twilio_sms_number,
        smsUrl: `${appUrl}/api/sms/inbound`,
      })
      if (!smsHook.ok) {
        smsWarning = `SMS webhook reclaim failed: ${smsHook.reason}`
      }
    } else {
      smsWarning =
        'APP_URL / NEXT_PUBLIC_APP_URL not set — cannot reclaim SMS webhook.'
    }
    // A2: even on the fast path, a pre-existing stub number/assistant means
    // the tenant is NOT production-ready — never report it as complete.
    const stubbed =
      isStubTwilioNumber(tenant.twilio_sms_number) || isStubVapiId(tenant.vapi_assistant_id)
    return Response.json({
      ok: true,
      tenantId: tenant.id,
      setupComplete: !stubbed && !smsWarning,
      provisioningMode,
      phoneNumber: tenant.twilio_sms_number,
      vapiAssistantId: tenant.vapi_assistant_id,
      alreadyProvisioned: true,
      warning:
        smsWarning ??
        (stubbed
          ? 'Existing number/assistant is a STUB — enable live provisioning and re-provision.'
          : undefined),
    })
  }

  // Resolve trades for the Vapi prompt. Falls back to [trade] for legacy
  // single-trade tenant rows that pre-date migration 017.
  const tradesArr: Array<'electrical' | 'plumbing'> =
    Array.isArray(tenant.trades) && tenant.trades.length > 0
      ? (tenant.trades as Array<'electrical' | 'plumbing'>)
      : ([(tenant.trade ?? 'electrical')] as Array<'electrical' | 'plumbing'>)

  const result = await runProvisioning(supabase, {
    tenantId: tenant.id,
    businessName: tenant.business_name ?? '',
    trade: tradesArr[0],
    trades: tradesArr,
    ownerFirstName: tenant.owner_first_name ?? 'mate',
    ownerMobile: tenant.owner_mobile ?? '',
    existing: {
      twilioSmsNumber: tenant.twilio_sms_number,
      vapiAssistantId: tenant.vapi_assistant_id,
    },
  })

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        tenantId: tenant.id,
        setupComplete: false,
        provisioningMode,
        phoneNumber: result.phoneNumber,
        vapiAssistantId: result.vapiAssistantId,
        error: result.error ?? 'provisioning_failed',
      },
      { status: 200 }, // 200 so the client UI can read the body without try/catch on res.ok
    )
  }

  // A2: a stub result, or a non-fatal warning (registration / SMS webhook
  // reclaim failed), means the line isn't fully working — not "complete".
  const stubbed = result.stubbedTwilio || result.stubbedVapi
  return Response.json({
    ok: true,
    tenantId: tenant.id,
    setupComplete: result.ok && !stubbed && !result.warning,
    provisioningMode,
    phoneNumber: result.phoneNumber,
    vapiAssistantId: result.vapiAssistantId,
    stubbedTwilio: result.stubbedTwilio,
    stubbedVapi: result.stubbedVapi,
    warning:
      result.warning ??
      (stubbed
        ? 'Provisioning ran in STUB mode — enable live provisioning (TWILIO/VAPI_PROVISIONING_ENABLED) and retry.'
        : undefined),
  })
}
