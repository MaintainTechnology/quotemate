import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

// Pin the Turbopack workspace root to this app directory so the dev server
// doesn't pick up a stray lockfile in the parent (the repo root has an
// orphaned package-lock.json from an accidental `npm install` outside this app).
const nextConfig: NextConfig = {
  // `output: 'standalone'` produces a self-contained `.next/standalone/server.js`
  // bundle that runs anywhere Node 20+ is available — Railway, Fly.io, Render,
  // any Docker host. Vercel ignores this flag (uses its own pipeline) so it's
  // safe to leave on for both deploy targets.
  output: "standalone",
  turbopack: {
    root: path.join(__dirname, "."),
  },
  // mupdf is a WASM package loaded at runtime by the estimator's tiled-refine
  // pass — keep it external so the bundler doesn't try to inline the .wasm.
  serverExternalPackages: ["mupdf"],
  async headers() {
    return [
      {
        // Opt every response into the browser's JS self-profiler so Sentry
        // browser profiling (browserProfilingIntegration) can collect samples.
        source: "/:path*",
        headers: [{ key: "Document-Policy", value: "js-profiling" }],
      },
    ];
  },
};

// withSentryConfig injects the SDK and, on production builds, uploads source
// maps. Under Turbopack (the Next 16 default) there is no bundler plugin —
// upload happens AFTER the build via Next's runAfterProductionCompile hook,
// auto-enabled by the SDK. It only runs when SENTRY_AUTH_TOKEN is present at
// build time (set it in Vercel + Railway build env; see .env.local + Dockerfile).
//
// NB: webpack-only options (autoInstrument*, excludeServerRoutes,
// automaticVercelMonitors, unstable_sentryWebpackPluginOptions) are NO-OPS
// under Turbopack — intentionally omitted. Route/trace exclusion, if ever
// needed, goes in a beforeSendTransaction filter instead.
export default withSentryConfig(nextConfig, {
  org: "quotemax",
  project: "javascript",

  // Build-time secret (NOT the DSN). Absent locally → build still succeeds,
  // just skips source-map upload (prod stack traces would stay minified).
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Route browser events through a same-origin path so ad-blockers don't drop
  // them. proxy.ts runs Clerk here but never calls auth.protect(), so the
  // tunnel is not gated.
  tunnelRoute: "/monitoring",

  // Upload a wider set of client files for better stack-trace resolution.
  widenClientFileUpload: true,

  // Quiet unless we're in CI, and don't phone home about the build itself.
  silent: !process.env.CI,
  telemetry: false,
});
