# Tenant Health — False "Stub Number" Detection Fix — Spec

> Bug ref: **BUG-15** (raised by Jeph, verified live with Jon). The Oculus / Oak
> Crest tenant's real, working Twilio number is wrongly flagged as a "stub"
> (fake/placeholder) by the new Tenant Health monitor.

## Objective

The admin **Tenant Health** monitor (`/api/admin/tenant-health` →
`/admin/tenants`) decides whether a tenant's Twilio number is a real provisioned
number or a deterministic placeholder ("stub") by pattern-matching the **shape of
the digits**. That shape overlaps the live AU mobile band that the stub generator
*deliberately* uses, so genuine numbers in the `+614820xxxxx` range are
misclassified as stubs and the tenant is marked **Incomplete**. We need the
monitor to classify from a **persisted, authoritative provisioning signal** (the
Twilio Phone Number SID) rather than the number's digits, so a real, working
number is never reported as a stub. Audience: the QuoteMate ops/admin team who
rely on Tenant Health to know which accounts are correctly set up.

## Context / background

- **Evidence the flag is a false positive:** Jon texted the Oak Crest number and
  received a real AI reply that correctly knew the caller's name ("Mark"). That
  proves the number is provisioned, bound to the Vapi/SMS pipeline, and routing
  inbound SMS to `/api/sms/inbound` — i.e. genuinely live.
- **Root cause — shape-based inference collides with the real band:**
  - Detection: `isStubTwilioNumber(n)` ⇒ `/^\+614820\d{5}$/` —
    `quotemate-automation/lib/onboard/health.ts:20`, consumed by required check #5
    "Real Twilio number (not a stub)" at `health.ts:181-193`.
  - Generation: `stubNumberFor()` mints placeholders as `+614820` + 5 digits,
    **intentionally inside the live AU mobile band** (`+61 482 0XX XXX`) —
    `quotemate-automation/lib/twilio/provision.ts:269-273`. Because placeholders
    live in the real-number range, no regex on the digits alone can separate a
    placeholder from a real number that happens to look like one.
- **The ground truth is already known but thrown away:** `provisionTenant()`
  returns `stubbedTwilio: boolean`, and a live Twilio provision returns a real
  `twilioSid` (`ProvisionResult` with `stubbed: false` carries `twilioSid:
  string`). But only `twilio_sms_number` / `twilio_voice_number` are persisted
  (`lib/onboard/run-provisioning.ts:135` and `:192-198`) — the SID and the
  stub/live fact are dropped. There is **no** `twilio_*_sid` or
  `provisioning_mode` column on `tenants` today (confirmed: SQL grep finds none).
  With nothing authoritative stored, the health check is forced to guess.
- **The "consistency problem" Jeph named:** the same fragile regex is copy-pasted
  in 4 places that must currently be kept in sync —
  `lib/onboard/health.ts:20`, `lib/twilio/provision.ts:258`,
  `lib/onboard/run-provisioning.ts:258`, `scripts/verify-tenant.mjs:33`.
- **Repo conventions that bound the fix** (`CLAUDE.md`): DB changes = a new
  `sql/migrations/NNN_*.sql` + a `scripts/run-migration-NNN.mjs`, applied to prod
  Supabase, keeping `sql/init.sql` representative. Scripts run with
  `node --env-file=.env.local scripts/X.mjs`. Server routes use the
  service-role key. Before writing Next.js code, read
  `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/`
  guide (Next 16 differs from training-data knowledge).

## Requirements

1. **Add an authoritative column.** A new migration
   `quotemate-automation/sql/migrations/NNN_tenants_twilio_number_sid.sql` (next
   free number) plus a matching `scripts/run-migration-NNN.mjs` adds
   `tenants.twilio_number_sid text` (nullable, default NULL). Update
   `sql/init.sql` so it stays representative.
2. **Persist the SID at provision time.** In
   `lib/onboard/run-provisioning.ts`, whenever `twilio_sms_number` is written
   (the early Vapi-fail update ~`:135` and the final update ~`:192-198`), also
   write `twilio_number_sid`: the live Twilio Phone Number SID (`PN…`) for a real
   provision, and `NULL` for a stub. Surface the SID through
   `lib/twilio/provision.ts`'s `ProvisionResult` if it is not already reachable
   at the call site (the live branch already has `twilioSid`).
3. **Classify from the SID, not the digits.** Rewrite required check #5 in
   `lib/onboard/health.ts` so its verdict is: real ⇔ `twilio_sms_number` present
   **and** `twilio_number_sid` present. Remove the digit shape from the
   pass/fail decision. Add `twilio_number_sid` to the `select` in both
   `lib/onboard/health.ts` and `app/api/admin/tenant-health/route.ts`.
4. **Fail-safe fallback ("unverified").** When a tenant has a
   `twilio_sms_number` but **no** `twilio_number_sid`, and the live truth cannot
   be confirmed (no Twilio creds / lookup unavailable at evaluation time), the
   check must surface a **neutral, non-blocking "unverified" state** (INFO level,
   `ok: true` for readiness purposes, with a detail like "could not confirm —
   run backfill / verify-tenant"). It must **never** assert "stub" on a number it
   cannot prove is a placeholder. A confirmed stub (SID known to be absent
   because it was provisioned in stub mode) still reports "stub" and still blocks
   readiness.
5. **Backfill / self-heal script.** Add
   `scripts/backfill-twilio-sid.mjs` (run via
   `node --env-file=.env.local scripts/backfill-twilio-sid.mjs`,
   with `--apply` to write, dry-run by default per repo norm). For every tenant
   with a `twilio_sms_number` and a NULL `twilio_number_sid`, query Twilio's
   `IncomingPhoneNumbers` API for that number; if Twilio returns a SID, the number
   is real → set `twilio_number_sid`. Reuse/extend the existing Twilio lookup
   helper in `health.ts` (`fetchTwilioSmsUrl()`) to also return the SID. Numbers
   Twilio does not recognise are left NULL (they were never live).
6. **Remove the duplication.** Converge the three TypeScript regex copies
   (`health.ts`, `provision.ts`, `run-provisioning.ts`) onto a single shared
   helper, and update `scripts/verify-tenant.mjs` to read the persisted
   `twilio_number_sid` signal instead of mirroring the regex. The shape regex may
   remain **only** as a non-deciding hint/log, never as the thing that fails a
   tenant. The "keep the stub regexes in sync" coupling noted in the
   `verify-tenant.mjs` / `health.ts` headers should no longer be load-bearing.
7. **Tests.** Add/extend `lib/onboard/health.test.ts` to cover the new logic
   (see Definition of done for the specific cases). All existing tests that
   assert on the old shape-based behaviour are updated to the new signal.
8. **Apply and verify in prod.** Apply the migration to prod Supabase, run the
   backfill against prod, and confirm the Oak Crest tenant flips to "Real Twilio
   number ✓" / **Ready** in `/admin/tenants` with no manual DB edit.

## Non-goals

- **Do not change the placeholder format or move stubs off the AU mobile band.**
  Fix the classifier, not the generator. `stubNumberFor()` stays as-is.
- No Stripe / Connect work, and no changes to any other Tenant Health check
  (owner link, status, pricing_book, service offerings, Vapi assistant, SMS
  webhook, trade readiness, licences, provenance) beyond what's needed to read
  the new column.
- Not introducing a live Twilio API call **per tenant** into the admin
  `/api/admin/tenant-health` view (it deliberately avoids one call per tenant for
  speed). View-time classification reads the persisted column; freshness is
  maintained by the backfill script and by provisioning writing the SID going
  forward.
- Not re-provisioning or changing any tenant's actual phone number.

## Constraints

- **Stack:** Next.js 16 App Router, Supabase (Postgres + service-role key in
  server routes), vitest for unit tests. Read `quotemate-automation/AGENTS.md`
  and the relevant `node_modules/next/dist/docs/` guide before writing Next code.
- **Migrations:** new `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs`
  applied to prod Supabase; keep `sql/init.sql` representative (per `CLAUDE.md`).
- **Scripts:** run with `node --env-file=.env.local …`; never commit or echo
  `.env.local` secrets.
- **Twilio creds for backfill:** the backfill needs prod
  `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` available in the environment it runs
  in. If they are absent, the backfill must exit cleanly and report which tenants
  it could not verify (those stay "unverified", never "stub").
- **Auth:** `/api/admin/tenant-health` stays admin-gated (`isAdminUser`); no
  change to its access model.

## Edge cases to handle

- **Real number inside the stub band (`+614820xxxxx`) with a SID present** →
  classified **real** ("Real Twilio number ✓"); this is the Oak Crest case.
- **Genuine stub** (provisioned with `TWILIO_PROVISIONING_ENABLED=false`, SID
  NULL, known stub) → classified **stub**, required check fails, tenant
  **Incomplete**.
- **Has `twilio_sms_number` but NULL SID, Twilio creds unavailable / lookup
  fails** → **"unverified"** neutral INFO, non-blocking; not reported as stub.
- **No `twilio_sms_number` at all** → existing behaviour unchanged ("no twilio
  number", required failure).
- **Backfill: Twilio does not recognise the number** → leave SID NULL (it was
  never a live Twilio number); do not invent a SID.
- **Backfill idempotency / re-runs** → only touches rows where SID is NULL;
  safe to run repeatedly; dry-run by default, writes only with `--apply`.
- **Number later released/re-bought in Twilio** → backfill re-run repopulates;
  out-of-scope to detect automatically at view time.
- **`verify-tenant.mjs` run with no Twilio creds** → reports "unverified" for
  unknown-SID rows rather than asserting stub.

## Definition of done

- [ ] Migration `sql/migrations/NNN_tenants_twilio_number_sid.sql` +
      `scripts/run-migration-NNN.mjs` exist, add `tenants.twilio_number_sid`
      (nullable text), and `sql/init.sql` reflects the column.
- [ ] `lib/onboard/run-provisioning.ts` writes `twilio_number_sid` (real SID for
      live provisions, NULL for stubs) at every point it sets
      `twilio_sms_number`.
- [ ] `lib/onboard/health.ts` check #5 passes iff `twilio_sms_number` **and**
      `twilio_number_sid` are present; the digit shape no longer drives the
      verdict; the new column is in the `select` here and in
      `app/api/admin/tenant-health/route.ts`.
- [ ] A tenant with a real number lacking a SID and unverifiable at runtime shows
      neutral **"unverified"** (non-blocking), never "stub".
- [ ] `scripts/backfill-twilio-sid.mjs` exists, dry-runs by default, writes with
      `--apply`, populates SIDs from Twilio's `IncomingPhoneNumbers` API, and
      leaves unrecognised numbers NULL.
- [ ] The 4 regex copies are de-duplicated: TS callers use one shared helper;
      `scripts/verify-tenant.mjs` reads `twilio_number_sid`; the shape regex is no
      longer a deciding factor anywhere.
- [ ] `lib/onboard/health.test.ts` includes passing cases:
      (a) real number in stub band + SID ⇒ **real**;
      (b) true stub (no SID) ⇒ **stub** + required failure;
      (c) number present, no SID, unverifiable ⇒ **unverified**, non-blocking.
      Full vitest suite passes (`npm test` or the repo's test command).
- [ ] Migration applied to prod Supabase and backfill run against prod.
- [ ] In `/admin/tenants`, the Oculus / Oak Crest tenant reads "Real Twilio
      number ✓" and **Ready** (assuming its other required checks pass), with no
      manual DB edit.
- [ ] Deleting the shape regex entirely would not reintroduce the false positive
      (classification is independent of the number's digits).

## Open questions

- **Prod Twilio creds for the backfill:** confirm `TWILIO_ACCOUNT_SID` /
  `TWILIO_AUTH_TOKEN` for the live account are available wherever the backfill is
  executed. If not, the backfill leaves affected rows "unverified" and a human
  must run it later with creds present.
- **Existing stub tenants:** confirm whether any currently-active tenant is a
  legitimate stub (provisioned with the flag off) that *should* stay Incomplete,
  so the backfill/verification doesn't accidentally green-light it. (Current
  expectation: only real, Twilio-recognised numbers receive a SID.)
