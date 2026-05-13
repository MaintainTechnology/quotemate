// Playwright config — E2E coverage for the onboarding activation flow.
//
// Scoped tightly on purpose: we spin up `next start` against a build the
// developer/CI has already produced, then run the specs in tests/e2e. The
// suite avoids hitting Twilio + Vapi + Supabase by serving the API
// routes with TWILIO_PROVISIONING_ENABLED + VAPI_PROVISIONING_ENABLED
// both unset (stub mode), and by relying on tests that only exercise
// rendered HTML + the always-available preflight endpoint (no auth).
//
// Run with `npm run test:e2e` (will boot the dev server automatically).

import { defineConfig } from '@playwright/test'

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100)

export default defineConfig({
  testDir: './tests/e2e',
  // No retries — keep failures deterministic. Bump in CI if flaky.
  retries: 0,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Boot Next in dev mode so we don't need a separate `next build` first.
  // The webServer entry waits for the URL to respond before tests run.
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/onboard/preflight`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
