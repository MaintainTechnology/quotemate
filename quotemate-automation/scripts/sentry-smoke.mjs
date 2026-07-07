// One-off Sentry delivery smoke test.
// Run: node --env-file=.env.local scripts/sentry-smoke.mjs
// Confirms the DSN is valid and Sentry accepts events (flush → true).
// Default import: @sentry/nextjs' CJS server build exposes the full API
// (captureException/flush) on the default export under Node's ESM interop.
import Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: 'smoke-test',
  tracesSampleRate: 0,
})

const eventId = Sentry.captureException(
  new Error('QuoteMax Sentry smoke test — safe to ignore'),
)
const delivered = await Sentry.flush(8000)
console.log(JSON.stringify({ eventId, delivered }))
process.exit(delivered ? 0 : 1)
