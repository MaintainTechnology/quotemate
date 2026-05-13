import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Minimal Vitest config — keeps tests Node-only (no jsdom) so schema-style
// unit tests stay fast and don't pull in the React/Next runtime. Path
// alias mirrors tsconfig.json `paths` so test files can `import` from
// `@/lib/...` exactly like app code does.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
    // E2E specs live in tests/e2e/*.spec.ts and are driven by Playwright,
    // not vitest. Exclude them so `npm test` stays node-only and fast.
    exclude: ['node_modules/**', 'tests/e2e/**'],
    globals: false,
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
