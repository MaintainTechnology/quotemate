# Clerk `/sign-up` parity — steps 01 → 04 behave exactly like the legacy `/signup` funnel, on Clerk

## Title
A tradie who starts at `/sign-up` (Clerk) completes the identical 01 → 04 funnel a `/signup` (Supabase) tradie gets — same fields, same recovery from an abandoned signup, same identity carry-through into wizard steps 02–04, and a tenant that reports healthy — with the account, session, and sign-in still owned entirely by Clerk.

## Goal
Close the behavioural gaps that make the Clerk funnel worse than the legacy Supabase one, without touching `/signup` and without moving the account store off Clerk. Why: `/sign-up` is a faithful port of `/signup`'s **form layer** (it literally imports `Field`/`INPUT`/`RequiredLegend`/`ErrorBanner`/`Arrow` from `app/signup/page.tsx:22`), but three things downstream of the form are not ported — abandoned-signup resume, identity backfill into the wizard, and post-activation tenant health — so a Clerk tradie who deviates from the happy path retypes their details, is told to "sign in again" while already signed in, and lands as a tenant that admin health permanently reports as broken.

## Role
Principal engineer for this repo. Reason before acting, take real action with tools, parallelise independent calls, never guess a parameter — read the file or run the check first.

## Context

Every claim below was verified by reading the file in this session. Two independent audit passes (step-01 behaviour inventory; downstream Clerk-id assumption trace) produced the findings.

### Already at parity — lock, do not change
- **Fields**: business name (`maxLength 80`, `autoComplete organization`), first name (`40`, `given-name`), email, mobile (`type tel`, `maxLength 20`, `inputMode tel`), password (`minLength 8`, `new-password`) — byte-identical markup and attributes between `app/signup/page.tsx:186-253` and `app/sign-up/[[...sign-up]]/page.tsx:301-360`.
- **Error copy**: invalid AU mobile (`page.tsx:94` vs `:167`), intent-token 404 (`:66` vs `:101`), intent-token other failure (`:67,74` vs `:102,109`) — exact string matches.
- **`?intent=` SMS prefill + mobile lock**: `mobileLocked = !!(intentToken && intentMobile)` (`:54` vs `:85`); both fetch `/api/onboard/intent/[token]`.
- **`?code=` invite carry-through**: both forward it to `/onboard` (`:151` vs `:127`).
- **`/onboard` hand-off keys**: A sends `owner_user_id`, B sends `clerk_user_id`; `app/onboard/page.tsx:280-281,300-301,311` already reads both and treats either as "identity resolved". Dual-auth plumbing, working as designed.
- **Logo upload on the Clerk path works**: `lib/storage/upload.ts:157` sanitises with `replace(/[^a-zA-Z0-9_-]/g, '')` and `_` is inside the allowlist, so `user_2abc123XYZ` survives byte-for-byte into a valid Supabase Storage key.
- **`OnboardActivateSchema` accepts a Clerk id**: `owner_user_id` is `.uuid()` (`lib/onboard/schema.ts:66`) but nothing routes a `user_…` value into it; `clerk_user_id` (`:70`) has no format check. No schema field rejects a Clerk id.
- **Activate's downstream steps are all tenant-id keyed** (`const id = tenant.id`, `activate/route.ts:167`): pricing_book `:177`, licences `:198`, service offerings `:233`, feature provenance `:269`, invitation code `:336`, SMS intent `:356`, provisioning `:378`. None reads `owner_user_id`.
- **`ensureClerkUser` step 3c is correctly skipped** on a Clerk-native signup (`activate/route.ts:294` `if (!form.clerk_user_id)`, else branch `:328`).
- **Success page, retry panel, Stripe return/refresh all work on a Clerk-only session**: `lib/auth/client-token.ts:70-82` `getAuthToken()` prefers Clerk and falls back to Supabase; every receiving route resolves dual-auth via `resolveTenantRequest` → `lib/tenant/current.ts:97`.
- **`tenants.owner_user_id` is nullable** — `sql/migrations/015_tenants_onboarding.sql:21`, no NOT NULL. A Clerk-only insert succeeds.

### Verified Clerk API surface (probed with a throwaway typed file, `tsc --noEmit` clean, then deleted)
`@clerk/nextjs@7.5.10` → `@clerk/react@6.11.2`. Exports `useSignUp`, `useSignIn`, `useUser`, `useAuth`. The signals API is real on **both** signals: `signIn.password({ identifier, password })` and `signUp.password({...})` each return `{ error }`; `signIn.finalize()` and `signUp.finalize()` both exist. `user.firstName`, `user.primaryEmailAddress?.emailAddress`, `user.unsafeMetadata`, and `useAuth().getToken` are all typed. Nothing in this spec guesses a Clerk parameter.

### The gaps this spec closes

1. **No Clerk identity backfill in the wizard.** `app/onboard/page.tsx:314-334` backfills `business_name`/`owner_first_name`/`owner_email`/`owner_user_id`/`owner_mobile` from the **Supabase** session + `user_metadata`. The only Clerk-aware backfill in the file is `:260-264`, which sets `clerk_user_id` and nothing else — the file never imports `useUser`. A Clerk tradie reaching `/onboard` without URL params (bookmark, a refresh that drops the query, or the dashboard's authed-but-no-tenant bounce at `app/dashboard/page.tsx:715`) gets a blank form, even though `/sign-up` wrote `business_name` + `owner_mobile` into Clerk `unsafeMetadata` and `firstName` at `app/sign-up/[[...sign-up]]/page.tsx:179-181`. **This is the steps 02–04 parity break.**

2. **Abandoned-signup resume is materially worse.** `app/api/auth/signup/route.ts:55-100` `resumeAbandonedSignup`: on a duplicate email it signs in with the submitted password (proof of ownership, `:73-82`), checks whether any tenant is linked by `owner_user_id` **or** `owner_email` (`:87-93`), and if none exists returns `ok:true, resumed:true` (`:161-163`) so the client continues to `/onboard` **in the same submit, same page, fields still populated**. `/sign-up` halts at `:184-190` and makes the tradie navigate to `/sign-in`, re-authenticate, bounce through `/dashboard`, and then retype business name / first name / email onto a blank wizard (compounded by gap 1).

3. **Duplicate-email detection hinges on one unverified string.** `app/sign-up/[[...sign-up]]/page.tsx:184` matches only `code === 'form_identifier_exists'`. Any Clerk change to that code silently falls through to `setError(message)` (`:188`) showing raw Clerk copy instead of the tradie-facing line.

4. **Activate logs a false fault on every Clerk activation.** A Clerk-native signup has no `auth.users` row, so `activate/route.ts:89-103` always enters the fallback, always misses, and always logs `console.warn('[activate] owner_user_id missing AND no auth user matches email')` (`:99`) — a warning that fires on the *correct* path and trains operators to ignore a message that is genuinely diagnostic on the legacy path.

5. **Admin tenant-health permanently reports every Clerk-native tenant as broken.** `lib/onboard/health.ts:107-113` asserts `ok: !!tenant.owner_user_id` with detail `'owner_user_id is NULL — tradie can never sign in'`, and `clerk_user_id` is not even in the selected columns at `:92`. The rollup at `:312-323` therefore sets `ready: false` forever. The claim is false (they sign in through Clerk, resolved by `clerk_user_id`), and because the view is a pass/fail rollup it makes a *genuine* required failure on that tenant indistinguishable from the permanent false one. Surfaced at `app/api/admin/tenant-health/route.ts:54`.

6. **The identity-failure hint is Supabase-only.** `app/onboard/page.tsx:437` lists `identityFields` without `clerk_user_id`, and activate's 422 (`activate/route.ts:110-120`) tells the tradie to *"Sign in again and retry"* — advice that contradicts a live Clerk session and does not repopulate the lost URL param.

### Decisions filling gaps in the brief
- **Resume needs no new endpoint.** `GET /api/tenant/me` already resolves dual-auth and returns **404** for authed-but-no-tenant — the exact signal `app/dashboard/page.tsx:715` already relies on. Password proof happens *before* any tenant fact is disclosed, so this reproduces A's security property: no email-enumeration oracle.
- **Keep activate's `lookupUserIdByEmail` call, fix only the log.** Skipping it when `clerk_user_id` is present would lose a genuinely useful behaviour: a tradie who tried `/signup` first and then `/sign-up` with the same email currently lands **dual-linked** (both ids stamped), so their legacy Supabase session still resolves. Dropping that to save one admin call is a behaviour regression for a latency win on an already slow route. Make the log Clerk-aware instead.
- **Marketing CTAs stay pointed at `/signup`.** Repointing `app/page.tsx`, `app/pricing/page.tsx`, `app/AuthNav.tsx`, `app/_components/site.tsx`, `app/trades/_template.tsx`, `lib/sms/templates.ts`, `lib/marketing/qr.ts`, and `app/api/dashboard/invites/codes/[id]/send/route.ts` changes live acquisition for every channel at once. Out of scope here; raise it as its own decision.

## Task

1. **`lib/onboard/clerk-identity.ts` (new, pure)** — `identityFromClerkUser(user)` returns the wizard patch `{ business_name, owner_first_name, owner_email, owner_mobile }` from `user.firstName`, `user.primaryEmailAddress?.emailAddress`, `user.unsafeMetadata.business_name`, `user.unsafeMetadata.owner_mobile`. Normalise the mobile through `normaliseAuMobile` and keep the raw value when it does not parse (mirror `app/onboard/page.tsx:288-292`). Accept a minimal structural type, not Clerk's `UserResource`, so it unit-tests without the SDK. Omit keys whose source is absent — never emit `''` over a value.
2. **`app/onboard/page.tsx`** — add a Clerk backfill effect beside the existing `useAuth` one (`:260-264`), using `useUser()` + `identityFromClerkUser`. Fill **only** currently-empty fields, exactly as the Supabase pass does with `prev.x || …` (`:327-334`). Add `clerk_user_id` to `identityFields` (`:437`).
   - **One-shot, guarded by a ref.** The URL and Supabase passes live in a `[]` effect and so hydrate exactly once; this must match. Clerk re-creates its `user` object on session-token refresh, and unlike the `clerk_user_id` effect this one writes fields the tradie can EDIT — a re-fire minutes in would resurrect a stale mobile over one they had deliberately cleared. Returning the same object from `setForm` when nothing changed prevents the extra render but NOT the re-application; the ref is what makes it correct.
   - Update the "Source priority" comment to name all three sources, not two.
3. **`lib/onboard/resume-decision.ts` (new, pure)** — classify the failure and decide the outcome.
   - `classifySignUpFailure({ existingSession, isTransferable, error })` → `'already_signed_in' | 'identifier_taken' | 'other'`. Prefer Clerk's own resource signals (`SignUpFutureResource.existingSession`, `.isTransferable` — both confirmed present in `@clerk/shared@4.22.1`) over sniffing error text; `already_signed_in` must rank above `identifier_taken` so a live session is resolved before any resume attempt.
   - `isIdentifierTakenError(err)` / `isAlreadySignedInError(err)` are the string fallbacks for instances where those fields aren't populated: code containing `identifier_exists` / `session_exists`|`already_signed_in`, or a matching message, checking nested `errors[0]` like `clerkErr` does. A Clerk wording change must degrade to `'other'` (raw message, no resume attempted) — the safe direction.
   - `decideDuplicateEmail({ signInFailed, tenantStatus })` → `'needs_signin' | 'resume' | 'existing_account'`. Two invariants: **(a)** only a clean 404 may `resume` — an outage, 401 or 3xx must never open the wizard; **(b)** `needs_signin` is reachable ONLY when the password failed. Once the password authenticates we have finalised a real Clerk session, so "sign in instead" would be false and a dead end; an authenticated tradie we can't resume goes to `existing_account` (the dashboard, which self-routes). Any non-404 after a successful sign-in therefore maps to `existing_account`, and its copy must be true for both "tenant exists" and "couldn't tell".
4. **`app/sign-up/[[...sign-up]]/page.tsx`** — on `isIdentifierTakenError(createErr)`, attempt the resume: `useSignIn()` → `signIn.password({ identifier: cleanEmail, password })` → on `{ error }` absent, `signIn.finalize()`, then `getToken()` and `GET /api/tenant/me`; feed the status to `decideDuplicateEmail`. `resume` ⇒ `goToOnboard(userId, mobileE164)` (same submit, no extra navigation). `existing_account` ⇒ an error banner saying the account is already set up, linking `/dashboard`. `needs_signin` ⇒ the current banner + `/sign-in` link, keeping `/signup`'s wording *"An account with that email already exists. Sign in instead."*.
   - `submitting`: the two terminal branches clear it; the `resume` branch must NOT, because it navigates — clearing before `router.push` re-enables the button mid-navigation and invites a double submit. This matches the pre-existing `finish()` convention in the same file. (Corrected during review: an earlier draft of this spec said "every branch must clear `submitting`", which would have introduced that double-submit window.)
5. **`app/api/onboard/activate/route.ts`** — when `form.clerk_user_id` is present and the email lookup misses, log at info level with a Clerk-aware message (this is the expected Clerk-native shape), not `console.warn` "no auth user matches email". Leave the lookup call and the dual-link behaviour intact. Make the 422 `owner_user_id_unresolved` message not tell an already-signed-in tradie to sign in again. Correct the stale comment above the lookup, which still claims a NULL `owner_user_id` means the tradie can never sign in.
   - **The message must actually reach the tradie.** `handleActivate` threw `data.error`, never `data.message`, so any coded activate failure rendered the raw machine string (`owner_user_id_unresolved`) in the banner. Add `activateErrorMessage(data)` to `lib/onboard/field-labels.ts` — prefer the route's `message`, else humanise the code, else a generic line — and use it at the throw site. This fixes every coded activate error, not just the 422.
6. **`lib/onboard/health.ts`** — add `clerk_user_id` to the selected columns (`:92`) and make the `owner_user_id` check pass when **either** id is present; relabel to "Owner account linked (sign-in works)" and make the failure detail name both columns. Do not weaken any other required check.
7. **Tests (TDD — write failing first)**
   - `lib/onboard/clerk-identity.test.ts`: full metadata → full patch; missing `unsafeMetadata` → only name/email keys; spaced local mobile `'04 1234 5678'` → `'+61412345678'`; unparseable mobile kept raw; absent sources omitted (no `''` keys).
   - `lib/onboard/resume-decision.test.ts`: `isIdentifierTakenError` true for `{code:'form_identifier_exists'}`, for a nested `{errors:[{code:'form_identifier_exists'}]}`, for a message-only "already been registered", false for an unrelated Clerk error and for `null`/`undefined`; `decideDuplicateEmail` covering 404/200/401/500/sign-in-failed, asserting the fail-closed default.
   - `lib/onboard/health.test.ts` (extend): a tenant with `clerk_user_id` set and `owner_user_id` NULL is `ready: true` and does not emit the "can never sign in" detail; a tenant with **neither** id still fails.
   - `tests/e2e/sign-up-parity.spec.ts` (new): `/sign-up` renders the same five labelled fields in the same order as `/signup`, the required legend, the `#clerk-captcha` slot, and a `/sign-in` link. Structural parity only — Clerk's frontend API is a third-party origin this repo's e2e idiom does not mock, so account creation is **not** driven here; state that limitation in the file header.

## Constraints
- **Clerk stays the account store for `/sign-up`.** No Supabase user is created on this path; no reintroduction of `/api/auth/signup`. The resume path authenticates against **Clerk**.
- Do not modify `app/signup/page.tsx` (beyond leaving its shared exports untouched), `/api/auth/signup`, or any marketing/SMS/QR link target.
- Do not add `?ref` / `?plan` handling — `/signup` drops both too (`lib/marketing/qr.ts:27-31`, `app/_components/PricingTiers.tsx:132-133` stashes the plan in `localStorage` instead). Identical means identical.
- Do not resurrect `app/signup/verify/page.tsx` or `app/onboard/check-email/page.tsx` — both are unreachable from every live flow.
- Do not touch the logo route's missing auth or rename its `owner_user_id` form field (pre-existing on both funnels; cosmetic).
- Do not weaken `OnboardActivateSchema`, and do not add a `.uuid()` check to `clerk_user_id`.
- Read `node_modules/next/dist/docs/` before writing Next code (`quotemate-automation/AGENTS.md`). Next 16: `proxy.ts` not `middleware.ts`; `useSearchParams` needs the existing Suspense boundary.
- Minimal diff, no unrelated refactors, no new abstractions beyond the two pure modules the tests require. Australian English, Command Centre tokens, zero emoji.
- Reversible edits only; no git push or destructive ops without confirmation.

## Acceptance criteria & gates
- `npm test` — all vitest suites pass, including every new case above.
- `npm run typecheck` — clean.
- `npm run test:e2e` — all Playwright specs pass, including `sign-up-parity.spec.ts`.
- A Clerk tradie landing on `/onboard` with **no** URL params has business name, first name, email and mobile pre-filled from their Clerk session.
- A duplicate email whose password is correct and whose account has **no tenant** continues to `/onboard` from `/sign-up` in one submit, with fields populated — no trip through `/sign-in`.
- A duplicate email whose password is correct and whose account **has** a tenant is told so and offered `/dashboard`; a wrong password still gets `/signup`'s exact "already exists" wording.
- `checkTenantHealth`'s owner-linkage check passes for a Clerk-only tenant and contributes no required failure, so auth linkage never masks a genuine one. (Asserted at the check level, not via `ready`: the unit fixture also trips the unrelated trade-readiness gate, and manufacturing a green `ready` would test the mock rather than this change.)
- No `console.warn` fires on a successful Clerk-native activation.
- `/review` and `/code-review`: no blocker- or major-severity findings.

## Examples
<example>
The Supabase backfill this mirrors — `app/onboard/page.tsx:322-334`. Note the `prev.x || meta.y || ''` shape: it only ever fills a blank, so a URL param already applied in pass 1 always wins. The Clerk effect must preserve that precedence.
</example>
<example>
`app/api/auth/signup/route.ts:66-100` `resumeAbandonedSignup` — the behaviour being ported. The load-bearing detail is the ORDER: password proof (`:78-82`) strictly precedes the tenant lookup (`:87-93`), which is what stops the endpoint becoming an email-enumeration oracle. The Clerk port must keep that order.
</example>
<example>
`lib/onboard/preflight-logic.ts:1-3` — the repo's stated reason for extracting pure logic into `lib/`: "so we can unit-test the missing-vars math without spinning up Next's request machinery". `clerk-identity.ts` and `resume-decision.ts` follow that precedent so neither needs the Clerk SDK or a browser to test.
</example>
<example>
Edge case: `signUp.createdUserId` can be null (`app/sign-up/[[...sign-up]]/page.tsx:147` → `:123` `clerkUserId ?? ''`). Combined with a lost URL param and Clerk not yet hydrated, activate's 422 guard (`:110`) fires with all three conditions true. R1 fixes the common case by backfilling from the live session; R6 fixes the message so the advice is not self-contradictory. Do not "fix" it by weakening the guard — failing closed there is correct.
</example>
