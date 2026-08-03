// Phase 6 — resolve DETERMINISTIC_BOM per tenant instead of globally.
//
// Until now this was one `process.env.DETERMINISTIC_BOM === '1'` check, so the
// deterministic pricer was on for all eight tenants or none. That was fine
// while it was off; it is the wrong shape now that it is ON in production,
// because the only way to react to one tenant's recipe misbehaving is to turn
// the engine off for everybody — including the seven it is working for.
//
// This is rollback granularity, not a feature gate. It buys the ability to
// isolate one tenant on the next inbound with no redeploy.
//
// Mirrors llmReceptionistEnabled (lib/sms/llm-receptionist.ts:94) deliberately,
// down to the accepted spellings, so an operator who has used one flag already
// knows how this one behaves. One difference, and it matters:
//
//   ⚠ THE DEFAULT STAYS OFF. The SMS flag defaults ON because its rollout is
//   finished. This module's contract is still "dormant until explicitly
//   enabled" — run.ts says so, the builder's own header says so, and the test
//   suite assumes it. Flipping the default here would silently switch the
//   deterministic pricer on in every dev environment and every CI run.
//   Production sets DETERMINISTIC_BOM=1 explicitly, which is unchanged.
//
// Read fresh on every call so flipping the variable takes effect on the next
// request (next lambda), with no redeploy and no state cleanup.

/**
 * DETERMINISTIC_BOM —
 *   unset (the default)            → OFF for every tenant
 *   '0' / 'false' / 'off' / 'no'   → OFF, the kill switch
 *   '1' / 'true' / 'on' / 'all'    → ON for every tenant (what prod sets)
 *   anything else                  → a comma-separated tenant-id allow-list,
 *                                    for narrowing to one tenant or excluding
 *                                    a misbehaving one
 *
 * A null tenantId returns false under an allow-list: an intake with no tenant
 * cannot be on a list of tenants, and those rows are the legacy/dev-number
 * traffic that should never be priced deterministically anyway.
 */
export function deterministicBomEnabled(tenantId: string | null | undefined): boolean {
  const raw = (process.env.DETERMINISTIC_BOM ?? '').trim()
  if (!raw || /^(0|false|off|no)$/i.test(raw)) return false
  if (/^(1|true|on|yes|all)$/i.test(raw)) return true
  if (!tenantId) return false
  return allowList(raw).includes(String(tenantId))
}

function allowList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Phase 6 — a human-readable mode for /api/health.
 *
 * A boolean can no longer describe this flag: `=== '1'` would report false
 * while the engine is on for every tenant on an allow-list, which is worse than
 * reporting nothing. Returns the MODE and, for a list, the COUNT — never the
 * tenant ids, matching that endpoint's rule of exposing presence not values.
 */
export function deterministicBomMode(): 'off' | 'all' | `allow-list:${number}` {
  const raw = (process.env.DETERMINISTIC_BOM ?? '').trim()
  if (!raw || /^(0|false|off|no)$/i.test(raw)) return 'off'
  if (/^(1|true|on|yes|all)$/i.test(raw)) return 'all'
  return `allow-list:${allowList(raw).length}`
}
