// Sentry — Node.js server runtime.
//
// Loaded by `instrumentation.ts` `register()` when NEXT_RUNTIME === 'nodejs'.
// Covers: server errors (route handlers, RSC, server actions*), request
// tracing, Sentry Logs, and AI/LLM monitoring for the Vercel AI SDK calls.
//
// *Server Actions are NOT auto-instrumented under Turbopack — wrap any
// `'use server'` action with `Sentry.withServerActionInstrumentation` to
// trace it. (This app is route-handler-first, so few/none exist today.)
import * as Sentry from '@sentry/nextjs'

const isProd = process.env.NODE_ENV === 'production'

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    'https://9d57d176f05033495f8f2387fea9db00@o4511691827838976.ingest.us.sentry.io/4511691834720256',
  environment: process.env.NODE_ENV,

  // PII guard — estimate prompts + SMS bodies contain customer PII.
  sendDefaultPii: false,

  // See note in instrumentation-client.ts on why tracing is prod-gated.
  tracesSampleRate: isProd ? 0.1 : 0,

  // Sentry Logs (Sentry.logger.*).
  enableLogs: true,

  integrations: [
    // Forward console.warn / console.error into Sentry Logs. Deliberately
    // NOT console.log — the app's log pipeline is chatty and log lines can
    // contain phone numbers / addresses (avoids quota blowout + PII leak).
    Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),

    // AI/LLM monitoring. Surfaces model id, token usage, latency and tool
    // calls for Vercel AI SDK generateText/generateObject calls that opt in
    // via `experimental_telemetry: { isEnabled: true }`.
    Sentry.vercelAIIntegration(),
  ],
})
