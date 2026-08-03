// Lightweight liveness probe. Used by Railway's healthcheck and any
// uptime monitor (UptimeRobot, BetterStack, etc.). Should return fast
// — don't ping the DB here; that's what /api/health/deep is for.

import { deterministicBomMode } from '@/lib/estimate/deterministic-flag'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    ok: true,
    service: 'quotemate-automation',
    time: new Date().toISOString(),
    region:
      process.env.VERCEL_REGION ??
      process.env.RAILWAY_REGION ??
      process.env.FLY_REGION ??
      'unknown',
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    // Which feature flags are actually live in THIS running deployment.
    // Lets you confirm — in one request — that the deploy serving SMS
    // is the build + flags you expect (the WP9 price/image flow only
    // runs when wp9_product_options is true AND the commit is recent).
    // Is the internal-route guard actually armed on THIS deployment?
    //
    // POST /api/estimate/draft and POST /api/intake/structure require the shared
    // secret via isCronAuthorised, which is FAIL-CLOSED in production — and
    // NODE_ENV is 'production' on Vercel Preview too. So a deployment missing
    // CRON_SECRET rejects every internal self-call, which means no voice call,
    // SMS lead, flyer-QR lead or dashboard quote produces a quote, and three of
    // those four text the customer a failure message.
    //
    // Before this, the only way to discover that was to break it. A BOOLEAN
    // only — never the value. `false` means this deployment is inert, not that
    // it is exploitable (a missing secret locks the routes down harder, it does
    // not open them), so there is nothing here an attacker gains from.
    cron_secret_present: !!process.env.CRON_SECRET,
    features: {
      wp9_product_options: process.env.WP9_PRODUCT_OPTIONS === '1',
      // Phase 6 — a boolean can no longer describe this. The flag resolves per
      // tenant, so `=== '1'` would report FALSE while the engine is on for
      // every tenant on an allow-list, which is worse than saying nothing.
      // Reports the MODE and, for a list, how many tenants — never the ids,
      // matching this endpoint's rule of exposing presence and not values.
      deterministic_bom: deterministicBomMode(),
      wp4_render_verify: process.env.WP4_RENDER_VERIFY === '1',
      price_history_hint: process.env.PRICE_HISTORY_HINT === '1',
    },
  })
}
