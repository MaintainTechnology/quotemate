// Lightweight liveness probe. Used by Railway's healthcheck and any
// uptime monitor (UptimeRobot, BetterStack, etc.). Should return fast
// — don't ping the DB here; that's what /api/health/deep is for.

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
  })
}
