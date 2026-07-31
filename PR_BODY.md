## What this is

Two workstreams that ran in parallel on this branch and have been passing together as one tree: the **Electrical/Plumbing job quoter** on the dashboard Tools tab, and the **electrical recipe engine** work it depends on.

`npm test` → **7215 pass, 559 files, 0 failures**. `tsc --noEmit` clean. No new lint findings on changed lines. No migration.

---

## The money-path defects this closes

Each was verified against production data, not inferred.

**A roofing thread was minting electrical quotes and charging for them.** `IntakeSchema.trade` is `z.enum(['electrical','plumbing'])` and cannot represent roofing; `deriveTradeFromJobType` maps anything unrecognised — including `'other'` — to `'electrical'`. The intake handoff had no trade signal, so roofing enquiries became electrical intakes with real $99 inspection quotes: `8d02aa98` **paid**, `d1d3cc6c` **accepted**, `530bd60b` left at $0.00. One of those customers had a $73,522 roofing estimate. Fixed with an `otherTradeActive` signal on `sideEffectsAllowed`, derived from the existing tested `isActiveRoofingFlow`/`isActivePaintingFlow` — a naive `last_step != null` would have suppressed the legitimate trade-switch handoffs instead.

**R9 divided a fixed cost by the item count.** `checkSanityBounds` compared `totalLabourHours / quantity` against a per-unit ceiling, which makes the cap tightest exactly where fixed costs dominate — at quantity 1. On the three tenants whose `min_labour_hours` is 2.00, **every single-item `power_points` or `downlights` quote failed unconditionally** and went to the $99 inspection. Now an affine cap: `max(minCharge, per_unit × n × 1.75) + recipeOneOff`. `max`, not a sum — summing would drift the guard toward inert.

**Two internal routes accepted anonymous calls.** `POST /api/estimate/draft` and `POST /api/intake/structure` mint quotes, Stripe sessions and customer SMS; `proxy.ts` is a bare `clerkMiddleware()` that gates nothing. Both now require the shared secret via the already-tested `isCronAuthorised`, and all six internal callers send it.

**A tradie's answers vanished between the form and the price.** `ev_charger`'s phase question reused the code `circuit_required`, which the route filters out of the transcript for every job type — so "three phase" reached nothing, and the rule that three-phase work forces an inspection never fired. The rename is not the fix; the collision-guard test is.

---

## ⚠ Before merging — deploy precondition

`isCronAuthorised` is **fail-closed in production, and `NODE_ENV` is `'production'` on Vercel Preview too.** A deployment without `CRON_SECRET` rejects every internal self-call: no voice call, SMS lead, flyer-QR lead or dashboard quote produces a quote, and three of the four text the customer a failure message.

`GET /api/health` now reports `cron_secret_present` so this is checkable in one request:

```bash
curl -s https://<deployment>/api/health | jq '{commit, cron_secret_present}'
```

Confirm `true` on **both** Production and Preview before merging.

---

## What this deliberately does NOT do

- **No tradie photo upload.** `lib/estimate/*` attaches no images at all, the intake prompt bars photos from `risks[]` and `scope.specs`, and prod has carried zero photo-bearing intakes for 30 days. The real defect there — every portal customer quote shipping a permanently disabled upload button under copy inviting its use — is fixed.
- **No migration.** All five `job_type_bounds` rows remain flagged `PROVISIONAL — confirm with tradie`; 184 is reserved for that pass.
- **No mid-thread trade switch.** An active roofing thread still captures every turn. Changing which receptionist wins a live turn on the two 8-trade tenants needs its own eval corpus first.
- **`SPEC_GUARD_MODE` untouched** (default `shadow`) — an independent money-path decision.

## Known residual risk

`/api/vapi/webhook` still has **no authentication of its own** — no Vapi server secret exists anywhere in the repo — so the pipeline remains reachable through that door. Out of scope here; it needs its own change and is the highest-value security work left.

---

## Review notes

Every change went through spec → build → independent review → fix → re-review. The review passes caught four defects that would otherwise have shipped, including two of mine: a `setBusy` that bricked the form on a lapsed session, and a `wp9Handled` gate that had to widen in lockstep with the product-pin gate or the spec guard would route pinned quotes to the $99 inspection.

Drift is recorded in `docs/strategy.md` **v18** and `CLAUDE.md` (SMS routing, the trade guard, the `CRON_SECRET` requirement). Specs are in `quotemate-automation/specs/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
