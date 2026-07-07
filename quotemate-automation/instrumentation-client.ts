// Sentry — BROWSER / client runtime.
//
// Next.js 16 auto-loads this file convention on the client (it replaces the
// legacy `sentry.client.config.ts`). It runs once, as early as possible, in
// the browser bundle.
//
// Covers: client errors, client-side navigation tracing, Session Replay,
// browser JS profiling, and structured logs (`Sentry.logger.*`).
import * as Sentry from '@sentry/nextjs'

const isProd = process.env.NODE_ENV === 'production'

Sentry.init({
  // DSN is public + safe to ship in the client bundle. Env var wins so a
  // deploy can point at a different project without a code change.
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ||
    'https://9d57d176f05033495f8f2387fea9db00@o4511691827838976.ingest.us.sentry.io/4511691834720256',
  environment: process.env.NODE_ENV,

  // PII guard — quote pages and SMS flows carry customer names, addresses
  // and phone numbers. Never auto-attach user identity / IP.
  sendDefaultPii: false,

  // Tracing — gate to production. Next 16 restricts Math.random() before
  // uncached data access, which trips Sentry's OTel span-id generation and
  // spams dev warnings when tracing runs in dev.
  tracesSampleRate: isProd ? 0.1 : 0,

  // Session Replay — 10% of prod sessions, and 100% of any session (incl.
  // dev) in which an error occurs, so captured errors always ship a replay.
  replaysSessionSampleRate: isProd ? 0.1 : 0,
  replaysOnErrorSampleRate: 1.0,

  // Browser JS profiling — profiles attach to sampled transactions, so this
  // only fires when tracing does (prod). Requires the `Document-Policy:
  // js-profiling` header, set in next.config.ts.
  profilesSampleRate: isProd ? 0.1 : 0,

  // Structured logs (Sentry.logger.info/warn/error).
  enableLogs: true,

  integrations: [
    // Mask all text + block media in replays — the safe default for a
    // PII-heavy product surface.
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    Sentry.browserProfilingIntegration(),
  ],
})

// Instruments App Router client-side navigations (route transitions become
// spans). Must be exported from THIS file to take effect.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
