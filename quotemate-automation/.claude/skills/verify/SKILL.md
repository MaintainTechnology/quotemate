---
name: verify
description: Drive the authed tradie dashboard (or any Clerk-authed page) end-to-end for verification. Use when a change touches /dashboard, tenant APIs, or any surface behind Clerk sign-in and you need real browser evidence.
---

# Verifying Clerk-authed surfaces in this repo

The Playwright e2e suite covers unauthenticated pages only — but the authed
dashboard CAN be driven end-to-end. Recipe (proven 2026-07-08):

1. **Dev server**: `npx next dev` (check first — one may already be running on
   port 3000; Next refuses a second instance in the same dir, reuse it).
2. **Find a signed-in user for THIS env's Clerk instance.** `tenants.clerk_user_id`
   may belong to the OTHER instance (dev/prod see-saw — see CLAUDE.md). Resolve
   by email instead:
   `GET https://api.clerk.com/v1/users?email_address=<tenants.owner_email>`
   with `Authorization: Bearer $CLERK_SECRET_KEY` (via `node --env-file=.env.local`).
   The API's tenant resolver email-fallback maps that identity to the tenant even
   when the stored clerk_user_id differs.
3. **Mint a sign-in token** (single-use, so mint one per browser run):
   `POST https://api.clerk.com/v1/sign_in_tokens` body `{ user_id, expires_in_seconds: 1800 }`.
4. **Playwright** (`import { chromium } from '@playwright/test'`, script in
   scripts/, delete after): goto
   `http://localhost:3000/sign-in?__clerk_ticket=<token>`, wait ~6s (the Clerk
   component consumes the ticket; URL may stay on /sign-in — the session cookie
   still lands), then goto `/dashboard`.

Gotchas:
- Locator `has-text("Quotes")` matches the search palette placeholder
  ("Search quotes, customers, jobs") and opens a modal that intercepts all
  clicks. Navigate the sidebar by exact trimmed textContent match instead.
- Overview widgets (chats, trade jobs) fetch lazily — allow ~6s (longer when
  the dev server is busy) before asserting their content.
- The MCP Playwright browser profile can be held by another session — launch
  your own chromium via a script instead.
