// Sentry — Edge runtime.
//
// Loaded by `instrumentation.ts` `register()` when NEXT_RUNTIME === 'edge'.
// This matters here because `proxy.ts` runs Clerk's middleware on the edge.
// Keep integrations minimal — the console/AI integrations rely on Node APIs
// that don't exist on the edge.
import * as Sentry from '@sentry/nextjs'

const isProd = process.env.NODE_ENV === 'production'

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    'https://9d57d176f05033495f8f2387fea9db00@o4511691827838976.ingest.us.sentry.io/4511691834720256',
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: isProd ? 0.1 : 0,
  enableLogs: true,
})
