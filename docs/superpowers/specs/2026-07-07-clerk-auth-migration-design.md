# Clerk identity over Supabase data — phased, non-destructive auth migration

> Design record. Date: 2026-07-07. Status: approved to build (Phases 0–1 on dev first, then prod).

## Goal (acceptance criteria)

1. **Existing subscribers can log in via Clerk exactly as before** — same email + same password → their tradie dashboard, with all their data. No password reset, no email-code first-login.
2. **Nothing is lost.** `owner_user_id`, `auth.users`, and all rows are preserved. Migration is additive-only and reversible.
3. **Their current Supabase login keeps working the whole time** (dual-auth). No lock-out at any point.
4. **The Twilio provisioned number keeps working through onboarding** — proven auth-independent (binds to the tenant row + number columns; inbound SMS/voice resolve tenant by the destination number / `vapi_assistant_id`, never by the auth user).

## Key facts established (grounded in code)

- Auth today is 100% Supabase: browser anon-key PKCE client, `signInWithPassword`; the dashboard sends `Authorization: Bearer <supabase-jwt>` and every API route validates via `supabase.auth.getUser(token)` then looks up the tenant by `owner_user_id`.
- A **dormant Clerk coexistence scaffold already exists**: `@clerk/nextjs@7.5.10`, `ClerkProvider` in `app/layout.tsx`, `clerkMiddleware()` in `proxy.ts` (no `auth.protect()` — gates nothing), branded `/sign-in` `/sign-up` `/account` pages, `lib/clerk/link.ts` + `scripts/link-accounts-clerk.ts`, and migration **163** adding `tenants.clerk_user_id text` (nullable, partial-unique). Env keys (`CLERK_SECRET_KEY`, publishable, redirect URLs) are set in dev.
- The chosen identity remap is the **`clerk_user_id` column** (Clerk keeps its native `user_...` id; tenant maps to it). `owner_user_id` is left untouched — that is what makes the change non-destructive.
- Twilio: `provisionTwilioNumber`/`runProvisioning` take only `tenantId` + business data + env secrets; number is stored on `tenants.twilio_sms_number/twilio_voice_number/vapi_assistant_id/twilio_number_sid`; inbound SMS resolves via `tenantByDestinationSms` (destination number). **No auth coupling in the binding or routing.**

## Decisions (locked with user)

- **Passwords:** import Supabase bcrypt hashes into Clerk (`password_digest` + `password_hasher: 'bcrypt'`) so users keep their exact password. (Overrides the built link script's `skipPasswordRequirement: true`.)
- **Cutover:** phased with dual-auth. Accept **both** a Clerk session token and a legacy Supabase Bearer during (and after) transition.
- **Environment:** build + verify on the **dev** Supabase first, then apply to **prod** where Sparky lives.
- **Out of scope now:** Phase 3 "retire Supabase auth" (drop the `auth.uid()` RLS policy, remove Supabase sign-in). Supabase login stays accepted indefinitely as a safety net.

## The load-bearing component: one dual-auth resolver

`lib/tenant/current.ts` — given a `Request`, resolve the caller's tenant by:

1. Read the `Authorization: Bearer <token>`.
2. **Clerk first:** verify as a Clerk session token; on success take the Clerk user id (`sub`) → `tenants.clerk_user_id = <id>`.
3. **Supabase fallback:** `supabase.auth.getUser(token)`; on success take `user.id` → `tenants.owner_user_id = <id>` (existing behaviour) + the email self-heal already in `/api/tenant/me`.
4. Neither → `null` (caller answers 401).

Routing between the two verifiers is by the JWT `iss` claim (decode-without-verify to pick the verifier, then verify with the correct one). Returns a normalised `{ userId, email, provider, tenant }` so callers keep working. This becomes the single chokepoint; `lib/tenant/bearer.ts`, the inline `userFromBearer` copies, and `retry-provision` delegate to it.

Because the Supabase branch is preserved, **any route not yet converted keeps working** → no lock-out.

## Dashboard client

Keep the existing `Authorization: Bearer` fetch pattern. The client sends Clerk `getToken()` when a Clerk session exists, else the Supabase access token. Clerk sign-in fallback redirect → `/dashboard` (was `/account`; `/account` stays as a debug surface).

## Phases

- **Phase 0 (dev):** apply migration 163 to dev; rewrite `link-accounts-clerk.ts` to import bcrypt passwords + stamp `clerk_user_id`. Dry-run, then apply.
- **Phase 1 (dev):** dual-auth resolver (+ unit tests); wire `/api/tenant/me`, `tenantFromBearer`, `retry-provision`; dashboard token + redirect. **Acceptance: log into a test tenant via Clerk with its real password → dashboard; and an un-migrated user still logs in via Supabase.**
- **Phase 2 (dev):** onboarding via Clerk `<SignUp/>`; `activate` stamps `clerk_user_id`; email fallback → Clerk lookup. Twilio/Vapi provisioning unchanged. SMS `intent` handoff preserved.
- **Phase 4 (prod):** repeat 0–2 on prod; run password-import link script; **verify: real Sparky logs in via Clerk with its password; its Twilio number still routes an inbound SMS to Sparky.**

## Testing

- Unit: resolver (Clerk token → tenant, Supabase token → tenant, neither → 401; `iss`-based routing); password-import decision logic.
- One-user bcrypt round-trip: confirm Clerk accepts Supabase's `$2a/$2b` digest before the bulk run.
- E2E: Clerk sign-in as a migrated tenant → dashboard loads with its data.
- Regression: un-migrated user still logs in via Supabase (dual-auth).
- Twilio: inbound SMS to the tenant's number still resolves to the tenant (unchanged, confirm).

## Rollback

`owner_user_id` + `auth.users` untouched; Supabase login still accepted; revert code + `sql/migrations/163_down.sql`. No data-loss path exists.
