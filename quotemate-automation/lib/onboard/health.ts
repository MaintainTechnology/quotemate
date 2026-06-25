// Tenant-health checks — the single source of truth for "is this tenant
// correctly and completely set up?". Used by:
//   • /api/admin/tenant-health  (admin tenant-health view)
//   • the activate route          (compute setupComplete after provisioning)
//   • mirrored by scripts/verify-tenant.mjs (plain JS — keep the stub
//     regexes + check list in sync if you change them here)
//
// A tenant is "ready" when every REQUIRED check passes. INFO checks are
// surfaced but never block readiness.

import type { SupabaseClient } from '@supabase/supabase-js'
import { checkTradeReadiness } from './trade-readiness'
import { isStubTwilioNumber, isStubVapiId } from './stub-detect'

// ── Stub artifact detection ────────────────────────────────────────────
// The shape detectors now live in one shared module (./stub-detect) so
// health.ts, run-provisioning.ts and the retry-provision route share a single
// definition. Re-exported here for back-compat with existing importers
// (app/api/onboard/retry-provision/route.ts) and the unit tests.
//
// The Twilio shape is a HINT, never the authoritative real-vs-stub verdict:
// the stub generator mints placeholders inside the live AU mobile band, so a
// real number can match the stub shape (BUG-15). The authoritative signal is
// tenants.twilio_number_sid — a live Twilio provision returns a Phone Number
// SID; a stub never does. See check #5 below.
export { isStubTwilioNumber, isStubVapiId } from './stub-detect'

export type HealthLevel = 'required' | 'info'

export interface HealthCheck {
  key: string
  label: string
  level: HealthLevel
  ok: boolean
  detail?: string
}

export interface TenantHealth {
  tenantId: string
  businessName: string | null
  status: string | null
  trades: string[]
  checks: HealthCheck[]
  /** True when every REQUIRED check passes. */
  ready: boolean
  /** Labels of the required checks that failed (empty when ready). */
  requiredFailures: string[]
}

export interface CheckTenantHealthOptions {
  /** When true, verify the live Twilio SMS webhook (extra Twilio API call).
   *  Off by default so listing many tenants stays fast. */
  checkWebhook?: boolean
}

interface TenantRow {
  id: string
  business_name: string | null
  status: string | null
  activated_at: string | null
  owner_user_id: string | null
  trade: string | null
  trades: string[] | null
  twilio_sms_number: string | null
  /** Twilio Phone Number SID (PN…) — authoritative real-vs-stub signal.
   *  Present only for numbers a live Twilio provision (or the backfill) confirmed. */
  twilio_number_sid: string | null
  vapi_assistant_id: string | null
}

type DbClient = Pick<SupabaseClient, 'from'>

function tradesOf(t: TenantRow): string[] {
  if (Array.isArray(t.trades) && t.trades.length > 0) return t.trades
  return t.trade ? [t.trade] : []
}

/**
 * Compute the full health report for one tenant. Accepts a tenant id (it
 * fetches the row) or a pre-fetched row.
 */
export async function checkTenantHealth(
  supabase: DbClient,
  tenantOrId: string | TenantRow,
  opts: CheckTenantHealthOptions = {},
): Promise<TenantHealth> {
  let tenant: TenantRow
  if (typeof tenantOrId === 'string') {
    const { data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, status, activated_at, owner_user_id, trade, trades, twilio_sms_number, twilio_number_sid, vapi_assistant_id',
      )
      .eq('id', tenantOrId)
      .single()
    if (error || !data) {
      throw new Error(`tenant not found: ${tenantOrId}`)
    }
    tenant = data as TenantRow
  } else {
    tenant = tenantOrId
  }

  const trades = tradesOf(tenant)
  const checks: HealthCheck[] = []

  // 1. owner_user_id present (sign-in works)
  checks.push({
    key: 'owner_user_id',
    label: 'Owner user linked (sign-in works)',
    level: 'required',
    ok: !!tenant.owner_user_id,
    detail: tenant.owner_user_id ? undefined : 'owner_user_id is NULL — tradie can never sign in',
  })

  // 2. status active + activated_at set
  const activeOk = tenant.status === 'active' && !!tenant.activated_at
  checks.push({
    key: 'status_active',
    label: 'Status active + activated_at set',
    level: 'required',
    ok: activeOk,
    detail: activeOk ? undefined : `status=${tenant.status ?? 'null'}, activated_at=${tenant.activated_at ?? 'null'}`,
  })

  // 3. pricing_book row per selected trade (with positive rates)
  const { data: pbRows } = await supabase
    .from('pricing_book')
    .select('trade, hourly_rate, call_out_minimum, default_markup_pct')
    .eq('tenant_id', tenant.id)
  const pricingByTrade = new Map<string, { hourly_rate: number | null }>()
  for (const r of (pbRows ?? []) as Array<{ trade: string; hourly_rate: number | null }>) {
    pricingByTrade.set(r.trade, r)
  }
  const missingPricing = trades.filter((t) => {
    const row = pricingByTrade.get(t)
    return !row || !(Number(row.hourly_rate) > 0)
  })
  checks.push({
    key: 'pricing_book',
    label: 'Pricing book row per trade',
    level: 'required',
    ok: trades.length > 0 && missingPricing.length === 0,
    detail:
      trades.length === 0
        ? 'tenant has no trades'
        : missingPricing.length
          ? `missing/invalid pricing for: ${missingPricing.join(', ')}`
          : undefined,
  })

  // 4. tenant_service_offerings >= 1 per trade
  const { data: saRows } = await supabase
    .from('shared_assemblies')
    .select('id, trade')
    .in('trade', trades.length ? trades : ['__none__'])
  const assemblyIdsByTrade = new Map<string, Set<string>>()
  for (const r of (saRows ?? []) as Array<{ id: string; trade: string }>) {
    if (!assemblyIdsByTrade.has(r.trade)) assemblyIdsByTrade.set(r.trade, new Set())
    assemblyIdsByTrade.get(r.trade)!.add(r.id)
  }
  const { data: offRows } = await supabase
    .from('tenant_service_offerings')
    .select('assembly_id')
    .eq('tenant_id', tenant.id)
  const offeredIds = new Set(
    ((offRows ?? []) as Array<{ assembly_id: string }>).map((r) => r.assembly_id),
  )
  const missingOfferings = trades.filter((t) => {
    const ids = assemblyIdsByTrade.get(t)
    if (!ids || ids.size === 0) return false // no catalogue for the trade — caught by trade readiness
    for (const id of ids) if (offeredIds.has(id)) return false
    return true
  })
  checks.push({
    key: 'service_offerings',
    label: 'Service offerings seeded per trade',
    level: 'required',
    ok: missingOfferings.length === 0,
    detail: missingOfferings.length ? `no offerings for: ${missingOfferings.join(', ')}` : undefined,
  })

  // 5. Twilio number — REAL iff a Twilio Phone Number SID is on file.
  //
  //    The SID (tenants.twilio_number_sid) is the authoritative signal: a live
  //    Twilio provision returns one; a deterministic stub never does. We do NOT
  //    infer stub-ness from the number's digits — the stub generator mints into
  //    the live AU mobile band, so a real number can share the stub shape
  //    (BUG-15). The digit shape is used ONLY to tell a *confirmed* stub
  //    (no SID + matches the deterministic placeholder) apart from an
  //    *unverified* number (no SID + real-shaped). Because a real number always
  //    carries a SID, the shape branch can never fail a genuine number — and
  //    deleting the regex entirely would only soften a stub into "unverified",
  //    never reintroduce the false positive.
  const twilioNumber = tenant.twilio_sms_number
  const twilioSid = tenant.twilio_number_sid?.trim() || null
  if (!twilioNumber) {
    checks.push({
      key: 'twilio_number',
      label: 'Real Twilio number',
      level: 'required',
      ok: false,
      detail: 'no twilio_sms_number',
    })
  } else if (twilioSid) {
    checks.push({
      key: 'twilio_number',
      label: 'Real Twilio number',
      level: 'required',
      ok: true,
    })
  } else if (isStubTwilioNumber(twilioNumber)) {
    checks.push({
      key: 'twilio_number',
      label: 'Real Twilio number',
      level: 'required',
      ok: false,
      detail: `stub number ${twilioNumber} — provisioned in stub mode (no Twilio SID)`,
    })
  } else {
    checks.push({
      key: 'twilio_number',
      label: 'Twilio number unverified',
      level: 'info',
      ok: true,
      detail: `no Twilio SID on file for ${twilioNumber} — run scripts/backfill-twilio-sid.mjs (or verify-tenant.mjs) to confirm`,
    })
  }

  // 6. Vapi assistant present and NOT a stub
  const vapiStub = isStubVapiId(tenant.vapi_assistant_id)
  checks.push({
    key: 'vapi_assistant',
    label: 'Real Vapi assistant (not a stub)',
    level: 'required',
    ok: !!tenant.vapi_assistant_id && !vapiStub,
    detail: !tenant.vapi_assistant_id
      ? 'no vapi_assistant_id'
      : vapiStub
        ? `stub assistant ${tenant.vapi_assistant_id} — provisioning ran in stub mode`
        : undefined,
  })

  // 7. SMS webhook → /api/sms/inbound (best-effort; only when asked + verifiable)
  //    Skip the live Twilio call for an obvious stub number — the shape is used
  //    here only to avoid a pointless API round-trip, never as a verdict.
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  const canCheckWebhook =
    !!opts.checkWebhook &&
    !!tenant.twilio_sms_number &&
    !isStubTwilioNumber(tenant.twilio_sms_number) &&
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN &&
    !!appUrl
  if (canCheckWebhook) {
    const expected = `${appUrl}/api/sms/inbound`
    const actual = await fetchTwilioSmsUrl(tenant.twilio_sms_number!)
    checks.push({
      key: 'sms_webhook',
      label: 'Twilio SMS webhook → /api/sms/inbound',
      level: 'required',
      ok: actual === expected,
      detail: actual === expected ? undefined : `SmsUrl is "${actual ?? 'unknown'}", expected "${expected}"`,
    })
  } else {
    checks.push({
      key: 'sms_webhook',
      label: 'Twilio SMS webhook → /api/sms/inbound',
      level: 'info',
      ok: true,
      detail: 'not verified here — run scripts/verify-tenant.mjs to check the live SmsUrl',
    })
  }

  // 8. Every selected trade passes the readiness gate
  const readiness = await Promise.all(trades.map((t) => checkTradeReadiness(supabase, t)))
  const notReady = readiness.filter((r) => !r.ready)
  checks.push({
    key: 'trade_readiness',
    label: 'All trades onboardable (readiness gate)',
    level: 'required',
    ok: trades.length > 0 && notReady.length === 0,
    detail: notReady.length ? `not ready: ${notReady.map((r) => r.trade).join(', ')}` : undefined,
  })

  // 9. INFO — licences present
  const { count: licCount } = await supabase
    .from('tenant_licences')
    .select('trade', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
  checks.push({
    key: 'licences',
    label: 'Per-trade licence rows present',
    level: 'info',
    ok: (licCount ?? 0) > 0,
    detail: (licCount ?? 0) > 0 ? undefined : 'no tenant_licences rows (non-blocking)',
  })

  // 10. INFO — feature provenance stamped
  const { count: provCount } = await supabase
    .from('tenant_feature_sources')
    .select('feature', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
  checks.push({
    key: 'feature_provenance',
    label: 'Feature provenance stamped',
    level: 'info',
    ok: (provCount ?? 0) > 0,
    detail: (provCount ?? 0) > 0 ? undefined : 'no tenant_feature_sources rows (non-blocking)',
  })

  const requiredFailures = checks
    .filter((c) => c.level === 'required' && !c.ok)
    .map((c) => c.label)

  return {
    tenantId: tenant.id,
    businessName: tenant.business_name,
    status: tenant.status,
    trades,
    checks,
    ready: requiredFailures.length === 0,
    requiredFailures,
  }
}

/** Fetch the live Twilio SmsUrl for a number, or null on any failure. */
async function fetchTwilioSmsUrl(phoneNumber: string): Promise<string | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { incoming_phone_numbers?: Array<{ sms_url?: string }> }
    return json.incoming_phone_numbers?.[0]?.sms_url ?? null
  } catch {
    return null
  }
}
