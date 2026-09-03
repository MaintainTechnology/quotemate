# Go-live runbook — payments for Jon

**Status as of 2026-09-03.** Stripe is in **test mode**. The Connect platform
review has **not been opened**. Migration 194 has **not been applied**. None of
this is code work — every step below needs Stripe-dashboard or Vercel-env
access. Nothing in the repo shortens step 1.

Read the ordering note before doing anything: **step 5 must not happen before
step 4**, or the existing quote funnel breaks.

---

## 0. The long pole — do this first, today

**Open the Stripe Connect platform review, in LIVE mode.**

Stripe reviews every platform before it will let you create connected accounts
and take destination charges in live mode. It is a queue with a **multi-day**
turnaround, and it gates everything else here: without it Jon cannot onboard,
and without Jon onboarded no deposit can be collected (the mint refuses a
non-Connect tenant by design — an unrouted deposit could never be paid out to
him).

Stripe Dashboard → Connect → Get started → complete the platform profile.
Everything below can proceed in parallel; none of it matters until this clears.

---

## 1. What Jon can have without any of this

The **existing** flow is already live-capable and untouched by the new work:
inbound SMS → AI quote → `$99` site visit → booking. That is the Thursday
minimum the spec named, and it needs only steps 2–4 plus Jon's onboarding.

The post-site-visit chain (final quote → deposit → balance) needs step 0 to
clear first. Plan on demoing it, not transacting on it, until then.

---

## 2. Live keys and webhooks

In Stripe Dashboard, switch to **live** mode, then set in Vercel (Production
**and** Preview — `NODE_ENV` is `production` on Preview too, and the intake
routes fail closed without their secrets):

| Var | Where it comes from |
|---|---|
| `STRIPE_SECRET_KEY` | Developers → API keys → **live** secret key (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | New live endpoint → `/api/stripe/webhook` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | New live endpoint → `/api/stripe/connect-webhook` |
| `STRIPE_PROVISIONING_ENABLED` | `true` |

Both webhook endpoints are **new objects in live mode** — the test-mode
secrets do not carry over.

- `/api/stripe/webhook` — events: `checkout.session.completed`,
  `customer.subscription.created`, `.updated`, `.deleted`
- `/api/stripe/connect-webhook` — event: `account.updated`, and you **must**
  tick **"Listen to events on Connected accounts"** or Jon's onboarding will
  never flip `stripe_connect_payouts_enabled` and he will look permanently
  half-onboarded.

Then re-run the billing price setup against the live key — subscription prices
are resolved by `lookup_key` and the resolver **throws** if they are absent:

```bash
node --env-file=.env.local scripts/setup-stripe-billing.mjs
```

⚠ Every stored `acct_…` / `cus_…` / `sub_…` in the database is a **test-mode**
object. They do not exist in live mode. The code self-heals stale customer and
account ids, but every tenant must redo Connect onboarding in live.

---

## 3. Preflight

```
GET /api/onboard/preflight     (on the production deployment)
```

Expect `twilio_mode: real`, `vapi_mode: real`, `missing: []`.

Preflight only checks **this app's** env. The SMS receptionist is the
out-of-repo Front Desk service on Railway, so verify it separately: **send a
real text to a live electrical number and confirm a `quotes` row appears.**
That row is the root of the whole chain — if the receptionist is not creating
it, Jon's SMS leads have nothing to build on and the sequence has to start from
the dashboard job-quote tool instead.

---

## 4. Apply migration 194 — BEFORE deploying the new code

```bash
# dry run first — prints the SQL, connects to nothing
node --env-file=.env.local scripts/run-migration-194.mjs

# then, once you are happy:
node --env-file=.env.local scripts/run-migration-194.mjs --apply
```

**Ordering is not optional.** 22 runtime files now query `quote_kind`. Deploy
the code against a database without that column and you do not merely fail to
add deposits — the **existing** funnel breaks: the Stripe webhook, the `/r`
mint, the customer quote page, send, and the dashboard all error.

Apply the migration, confirm the columns exist, *then* deploy.

The runner is transactional and verifies the columns, CHECK and index before
committing. `--rollback` reverses it (and refuses if any non-`initial` row
exists, so it cannot orphan a live chain).

---

## 5. Jon's tenant

1. Generate an invitation code — `/dashboard/invites`.
2. Jon: `/sign-up` → `/onboard` → trade **electrical**, state, mobile, licence
   → pricing essentials → enter code → **Activate**.
   Expect `setupComplete: true`, a real `+61` number, and no "stub" warning.
   If provisioning failed, the dashboard Retry button
   (`POST /api/onboard/retry-provision`) is idempotent and re-asserts the SMS
   webhook.
3. `/dashboard/pricing-wizard` → refine rates → **toggle "Install EV charger"
   ON** (it seeds OFF, and there is no price recipe behind it yet — confirm the
   provisional migration-192 bounds with Jon before his first real EV quote).
4. **Payouts tab → Stripe Connect** → hosted onboarding → real KYC + bank.
   He is not payments-ready until the `account.updated` webhook flips
   `stripe_connect_payouts_enabled`. Reaching the return URL does **not** mean
   KYC is done.

---

## 6. Seed the deposit map (EV chargers = 50%)

```bash
# dry run
node --env-file=.env.local scripts/seed-deposit-pct-by-job-type.mjs \
  --tenant <jon-tenant-uuid> --trade electrical \
  --map '{"ev_charger":50,"default":30}'

# apply
… --apply
```

The script refuses any value outside a whole 1–90 — worth knowing why: the
resolver treats an out-of-range number as *unset* and silently falls back to
30%, so a typo'd `100` would quietly charge Jon's customers 30% instead of
half. Catching it at seed time is the only place a human sees it.

---

## 7. Verify end to end, in live

- Text the live number → a `quotes` row appears.
- Pay a real `$99` → it lands in **Jon's** Connect balance, not the platform's.
- Payouts tab shows the job with the 2% fee deducted, and
  "Mark complete & release" pays it to his bank.
- Only once step 0 has cleared and a real job exists: **Issue final quote** →
  price it → Send → the deposit link charges
  `pct% of total − $99 + 2%`, and **Request final payment** charges the rest.

---

## What is still true after all of this

- The 2% platform fee on the deposit/balance is charged **on top**, so Jon nets
  exactly his quoted price. Stripe's own processing fee is borne by the
  platform, which means the 2% nets QuoteMax roughly 0.3% after Stripe takes
  its cut. If 2% was meant to be margin rather than cost-recovery, that number
  needs revisiting — it is an open question in the spec.
- The `$99` is advertised as **refundable** on every surface, but there is no
  refund path in code. A customer who declines the final quote has to be
  refunded manually in the Stripe dashboard (`reverse_transfer: true`).
