// Send-once orchestration for the onboarding welcome email.
//
// Called when a tradie reaches the dashboard (POST /api/tenant/welcome-email).
// The single-send guarantee is enforced at the DB layer, NOT in app memory:
// the row is CLAIMED with one conditional UPDATE that flips
// welcome_email_sent_at from NULL → now() only when it's still NULL and the
// tenant is active. Whoever wins that update (exactly one caller, even under
// concurrent dashboard loads) owns the send; everyone else is a no-op.
//
// On a send failure we RELEASE the claim (reset to NULL, but only if it's
// still the timestamp we wrote) so the next dashboard visit retries instead of
// silently swallowing the email forever.
//
// Pure over its supabase + sendEmail deps so the tests run without network/DB.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail as defaultSendEmail } from '@/lib/email/resend'
import { renderWelcomeEmail } from '@/lib/email/welcome'

/** The subset of the tenants row the welcome path reads. */
export type WelcomeEmailTenantRow = {
  id: string
  status: string | null
  welcome_email_sent_at: string | null
  owner_email: string | null
  business_name: string | null
  owner_first_name: string | null
  twilio_sms_number: string | null
  trades: string[] | null
}

export type WelcomeEmailDeps = {
  /** Injectable for tests; defaults to the live Resend sender. */
  sendEmail?: typeof defaultSendEmail
  /** Absolute app origin (no trailing slash needed). Falls back to env. */
  appUrl?: string
  /** Deterministic timestamp for tests; defaults to new Date().toISOString(). */
  nowIso?: string
}

export type WelcomeEmailOutcome =
  // Email actually went out in THIS call.
  | { ok: true; sent: true; messageId: string }
  // Nothing to do — already sent, not active yet, or missing recipient.
  | { ok: true; sent: false; reason: 'not_active' | 'already_sent' | 'no_recipient' | 'no_business_name' }
  // We tried but couldn't — claim or send failed. Safe to retry later.
  | { ok: false; sent: false; reason: string }

function resolveAppUrl(explicit?: string): string {
  const raw =
    explicit ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://quote-mate-rho.vercel.app'
  return raw.replace(/\/+$/, '')
}

/**
 * Send the welcome email at most once for `tenant`.
 *
 * `supabase` must be a service-role client (the claim UPDATE bypasses RLS).
 */
export async function sendWelcomeEmailOnce(
  supabase: Pick<SupabaseClient, 'from'>,
  tenant: WelcomeEmailTenantRow,
  deps: WelcomeEmailDeps = {},
): Promise<WelcomeEmailOutcome> {
  const send = deps.sendEmail ?? defaultSendEmail

  // ── 1. Cheap eligibility pre-checks (skip the write on the common path) ──
  // Only active tenants are "live" — an onboarding tenant hasn't finished
  // provisioning, so welcoming them would be premature.
  if (tenant.status !== 'active') return { ok: true, sent: false, reason: 'not_active' }
  if (tenant.welcome_email_sent_at) return { ok: true, sent: false, reason: 'already_sent' }
  const to = (tenant.owner_email ?? '').trim()
  if (!to) return { ok: true, sent: false, reason: 'no_recipient' }
  if (!(tenant.business_name ?? '').trim()) return { ok: true, sent: false, reason: 'no_business_name' }

  // ── 2. Atomic claim — NULL → now(), guarded on still-NULL + active ──
  // Exactly one concurrent caller flips the column; the rest match zero rows.
  const stampedAt = deps.nowIso ?? new Date().toISOString()
  const claim = await supabase
    .from('tenants')
    .update({ welcome_email_sent_at: stampedAt })
    .eq('id', tenant.id)
    .is('welcome_email_sent_at', null)
    .eq('status', 'active')
    .select('id')

  if (claim.error) {
    return { ok: false, sent: false, reason: `claim_failed: ${claim.error.message}` }
  }
  if (!claim.data || claim.data.length === 0) {
    // Lost the race (another load already claimed it) — idempotent no-op.
    return { ok: true, sent: false, reason: 'already_sent' }
  }

  // ── 3. Render + send ─────────────────────────────────────────────
  const dashboardUrl = `${resolveAppUrl(deps.appUrl)}/dashboard`
  let rendered: ReturnType<typeof renderWelcomeEmail>
  try {
    rendered = renderWelcomeEmail({
      tenant: {
        business_name: tenant.business_name,
        owner_first_name: tenant.owner_first_name,
        twilio_sms_number: tenant.twilio_sms_number,
        trades: tenant.trades,
      },
      dashboardUrl,
    })
  } catch (err) {
    await releaseClaim(supabase, tenant.id, stampedAt)
    return { ok: false, sent: false, reason: `render_failed: ${(err as Error)?.message ?? String(err)}` }
  }

  const result = await send({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  })

  // ── 4. On failure, release the claim so a later visit retries ────
  if (!result.ok) {
    await releaseClaim(supabase, tenant.id, stampedAt)
    return { ok: false, sent: false, reason: `send_failed: ${result.reason}` }
  }

  return { ok: true, sent: true, messageId: result.messageId }
}

/** Reset welcome_email_sent_at back to NULL, but only if it's STILL the
 *  timestamp we wrote — so we never clobber a concurrent successful claim.
 *  Best-effort: a release failure is swallowed (the column simply stays
 *  stamped and the email won't retry, which is the safe direction). */
async function releaseClaim(
  supabase: Pick<SupabaseClient, 'from'>,
  tenantId: string,
  stampedAt: string,
): Promise<void> {
  try {
    await supabase
      .from('tenants')
      .update({ welcome_email_sent_at: null })
      .eq('id', tenantId)
      .eq('welcome_email_sent_at', stampedAt)
  } catch {
    // best-effort
  }
}
