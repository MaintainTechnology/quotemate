// Next.js 16 Proxy (formerly `middleware.ts`) — wires Clerk into the request
// pipeline so `auth()` / `currentUser()` are available in Server Components,
// Route Handlers and Server Actions.
//
// ⚠ COEXISTENCE CONTRACT (v6 Clerk dev setup, 2026-06-30):
//   This runs `clerkMiddleware()` on matched routes BUT deliberately never
//   calls `auth.protect()`. That means it ONLY attaches Clerk's session
//   context to the request — it does NOT gate any route. Every existing
//   route keeps its current Supabase Bearer-token auth completely untouched,
//   so nothing in the running app changes behaviour. Clerk-based protection
//   is switched on per-route as the auth migration proceeds (see the Clerk
//   migration notes in the PR / CLAUDE.md).
//
// Next 16 note: the file convention is `proxy.ts` (not `middleware.ts`) and
// must export a single function as the default export. `clerkMiddleware()`
// returns exactly that. See node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md

import { clerkMiddleware } from '@clerk/nextjs/server'

export default clerkMiddleware()

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes…
    '/(api|trpc)(.*)',
    // …and Clerk's auto-proxy path (keyless / handshake / account portal).
    '/__clerk/:path*',
  ],
}
