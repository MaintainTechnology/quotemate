import type { NextConfig } from "next";
import path from "node:path";

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
};

export default nextConfig;
