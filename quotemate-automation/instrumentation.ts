// Next.js server-side instrumentation hook (auto-detected — no next.config
// flag needed in Next 16). Loads the right Sentry init for each runtime and
// wires the request-error hook so unhandled errors in route handlers, RSC and
// nested server components are captured.
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Captures all unhandled server-side request errors (requires @sentry/nextjs
// >= 8.28.0 — we're on 10.63.0).
export const onRequestError = Sentry.captureRequestError
