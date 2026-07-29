# Sanity bounds, the missing trade guard, and internal route auth

## Goal

Three defects on the electrical/plumbing money path stop being defects, and the documentation
stops claiming a fan-out that does not happen:

1. A quote is no longer routed to the $99 inspection because a **fixed** labour cost was divided
   by the item count. Today every single-item `power_points` or `downlights` quote on the three
   tenants with `min_labour_hours = 2.00` fails R9 unconditionally, recipe or no recipe.
2. A roofing or painting SMS thread can no longer mint an **electrical** intake and charge a real
   $99 electrical inspection.
3. `POST /api/estimate/draft` and `POST /api/intake/structure` stop accepting anonymous calls.

## Role

Principal engineer. All three touch the live money path: R9 is the guard that stops absurd
quotes reaching a customer, `sideEffectsAllowed` is the single gate on intake creation, and the
two unauthenticated routes mint Stripe sessions and text customers. A wrong change here is worse
than the defect — an over-loose R9 ships a $12,000 quote for a $500 job, an over-broad trade
guard silently stops all SMS quoting, and a missed `Authorization` header takes every intake
channel offline at once.

Read `AGENTS.md` before touching any route: this is Next.js 16 and its route conventions differ
from training data. Consult `node_modules/next/dist/docs/` rather than assuming.

## Context

All paths relative to `quotemate-automation/`. Every claim below was verified by reading the file
or running the query against prod Supabase this session. Where a premise turned out to be false
it is marked ⚠ so it does not get rebuilt.

### WS1 — R9 models labour as proportional when it is affine

`lib/estimate/sanity-bounds.ts:41` sets `PER_UNIT_TOLERANCE = 1.75`. The per-unit branch is:

```ts
const perUnit = input.totalLabourHours / input.quantity
const cap = bound.per_unit_labour_hours * PER_UNIT_TOLERANCE
if (perUnit > cap) { /* → inspection */ }
```

Real labour is `fixed + per_unit × n`. Dividing the fixed part by `quantity` makes the cap
tightest exactly where the fixed part dominates — at `quantity = 1`.

Two live consequences, both verified against `pipeline_traces`:

- **`min_labour_hours` collides at `quantity = 1`, with no recipe involved.** Intake `5350290e`
  (tenant `829702af`, `item_count 1`): trace 2026-07-07 07:37:05 → `["total $229.5 < min $250",
  "per-unit labour 2.00h > 1.75h (1.75× expected 1h)"]`. That 2.00h **is** the tenant's
  `pricing_book.min_labour_hours`, applied by `applyMinLabourFloor`
  (`lib/estimate/min-labour.ts:81-92`), which tops labour *up to* the floor and never beyond.
  Three of five tenants sit at 2.00, so for them **every** single-item `power_points` /
  `downlights` quote fails R9. `ceiling_fans` is safe (1.50 × 1.75 = 2.625); plumbing rows have
  a null `per_unit`.
- **A recipe's one-off run is amortised.** Intake `0c39d4c2` (`item_count 2`,
  `distance_to_existing_power 6` → the `max 10` band → **+1.0h**): trace 2026-07-29 06:37:45 →
  `sanity-bounds out of band → inspection (R9)`, `["per-unit labour 2.00h > 1.75h"]`. One 6 m
  cable run shared by two GPOs was charged half a run against a per-GPO ceiling.

Ordering, all verified in `lib/estimate/run.ts`: `applyMinLabourFloor` :411 → `mergeRecipesIntoDraft`
:499 → `validateQuoteGrounding` :685 → R9 `checkDraftSanityBounds` :1077. `checkDraftSanityBounds`
is declared at :1411; `qty = Number(intake?.scope?.item_count) || null`; per-tier `totalLabourHours`
sums lines where `source === 'labour' || unit === 'hr'`; the first failing tier wins. `pricingBook`
is already in scope at :1077 (used at :411 and :685) but is **not** passed in.

`job_type_bounds` (5 rows, all noted `PROVISIONAL — confirm with tradie`, seeded 2026-06-19):

| trade | job_type | per_unit | max_labour | min_total | max_total |
|---|---|---|---|---|---|
| electrical | ceiling_fans | 1.50 | 8.00 | 300 | 3500 |
| electrical | downlights | 1.00 | 11.00 | 300 | 4000 |
| electrical | power_points | 1.00 | 8.00 | 250 | 3000 |
| plumbing | blocked_drain | null | 4.00 | 150 | 2500 |
| plumbing | hot_water | null | 6.00 | 800 | 6000 |

Blast radius is bounded: **1** `shared_assemblies` row has a `price_recipe` (`d19f97df`,
electrical/gpo, "Replace double GPO"), **0** `tenant_custom_assemblies` do, and only 3 bound rows
have a non-null `per_unit`.

⚠ **R9 is one of three inspection routes on this job type.** The three dashboard-entered
`power_points` intakes from 2026-07-29 all ended at $99 for *different* causes: `0c39d4c2`
`sanity_bounds` (this spec fixes it), `7df97a2a` `grounding_failed` (fixed already by commit
`6402a389`, which withheld recipe answers from the transcript), `9eff9517` `llm_self_reported`
(correct behaviour — switchboard work must be inspected). Do not claim this spec "unblocks the
recipe path".

Recipe-added labour is recoverable from the draft: every recipe line is stamped
`recipe_origin: true` (`lib/estimate/merge-recipes.ts:248, 260, 324`; type at :72). `TierMergeOutcome`
(:120-128) carries `added_line_items` as a **count only, no hours**.

### WS2 — the intake handoff has no trade guard

⚠ **The stated symptom is a traffic artefact, not a code regression, and must not be "fixed".**
`intakes where trade='electrical' and created_at >= '2026-07-08'` → 10 rows: 7 `job_type='other'`
**plus 3 `power_points`** created 2026-07-29. The classifier works. Further, the WP9 offer gate
reads `decision.job_type_guess` (`app/api/sms/inbound/route.ts:3379`), whose enum
(`lib/sms/dialog.ts:40-47`) does **not contain `'other'`** — so `intakes.job_type='other'` cannot
disable the product offer. Both are downstream symptoms of "no electrical job was ever stated".
The real suppressor is that `handleRoofingTurn` hard-returns at `route.ts:2185-2187`, before
`extractSlots` at :2353.

**The defect that matters.** `IntakeSchema.trade` is `z.enum(['electrical','plumbing'])`
(`lib/intake/schema.ts:9`) — it cannot represent roofing. `deriveTradeFromJobType` returns
`'electrical'` for anything not in `PLUMBING_JOB_TYPES`, **including `'other'`**
(`lib/intake/schema.ts:129-132`). The handoff at `route.ts:3735` is gated only by
`sideEffectsAllowed({ decisionIsFinish, hasExistingIntake, wp9HoldingForChoice, inflightContinuation })`
(`lib/sms/inbound-helpers.ts:127-143`) — **no trade signal**. Verified in prod `quotes`:

| intake | quote | routing_decision | total_inc_gst | status |
|---|---|---|---|---|
| `4b56636b` re-roof | `8d02aa98` | inspection_required | 99.00 | **paid** |
| `9ae67eb2` re-roof | `7030df6c` | inspection_required | 99.00 | viewed |
| `962efea1` roofing (voice) | `530bd60b` | tradie_review | **0.00** | viewed |
| `54fd331d` re-roof (voice) | `d1d3cc6c` | inspection_required | 99.00 | **accepted** |

A customer with a $73,522 roofing estimate paid $99 for an electrical inspection.

### WS5 — both internal routes accept anonymous calls

`app/api/estimate/draft/route.ts` — case-insensitive grep for
`auth|bearer|clerk|requireTenant|currentUser|protect` → **0 matches**. `maxDuration = 300` at :59,
`POST` at :66, first statement `const { intakeId, tradieDrafted } = await req.json()` at :72.
`app/api/intake/structure/route.ts` — same grep → 4 hits, **all prose**. `maxDuration = 300` at
:25, `POST` at :43. `proxy.ts:20` is `export default clerkMiddleware()`; the file's own contract
at :5-12 states it does not gate any route, and its matcher includes `'/(api|trpc)(.*)'`.

**The precedent to reuse — do not write a new helper.** `lib/agents/cron.ts:23-37`
`isCronAuthorised(req, env = process.env)`: production requires `CRON_SECRET` and an exact
`Bearer ${expected}` (fail-closed at :31); dev allows a no-header call and is strict on a wrong
header (:35-36). `lib/agents/cron.test.ts` has **11 tests, green**. Four cron routes already
hand-roll the same shape.

**Every self-call site — all must carry the header in the same commit:**

| # | file:line | trigger | failure mode on 401 |
|---|---|---|---|
| A | `app/api/vapi/webhook/route.ts:200` → structure | Vapi end-of-call | 3 × 2s retry, then failure SMS to caller (:222-239) |
| B | `app/api/sms/inbound/route.ts:3735` → structure | Twilio inbound, dialog `finish` | burns 3 retries, then "we hit a snag" SMS |
| C | `app/api/q/choose/[token]/route.ts:149` → structure | customer taps the WP9 pick link | no retry; reverts `'structuring'` → `'open'` (:161-164). Degrades gracefully |
| D | `app/api/intake/structure/route.ts:799` → draft | transitively every voice + SMS + product-pick lead | 3 × 2s, then failure SMS (:820-847) |
| E | `app/api/t/[slug]/lead/route.ts:209` → draft | public flyer-QR web lead | `console.error` only (:215) — **silent dead lead** |
| F | `app/api/tenant/job-quote/route.ts:138` → draft | dashboard job-quote form | HTTP 502 surfaced in the form |
| G | `scripts/test-stage-04.mjs:38` → structure | manual dev script | not production; helper is header-optional off prod, no change needed |

Note `intake/structure` is **both** a guarded route and a caller (D). No client-side caller
exists: the only `.tsx` hits on those paths are comments. `grep -rn "estimate/draft\|intake/structure" tests/`
→ 0 matches, so `test:e2e` is a regression gate here, not a verification.

`after()` interaction is safe: both routes register `after()` well below the top (`structure` :631,
:741; `draft` :675, :753), after all DB writes, so a guard at the first statement of `POST`
returns before anything is registered or written.

`CRON_SECRET` is present in `.env.local`. **The user has confirmed it is set in Vercel Production.**

### WS6 — already applied and uncommitted ⚠

`lib/sms/product-options.ts` and `.test.ts` are already modified in the working tree.
`product-options.ts:150-163` already replaces `sorted[sorted.length - 1]` with a next-price-up
`find`. **47 tests green.** This workstream is review-and-keep, not build.

`tier_hint` is not selectable-on: `select tier_hint, count(*) from tenant_material_catalogue` →
`good 27, better 2, best 2, null 1`; only 3 (tenant, category) groups have 3+ rows, and Sparky's
downlights are price-inverted ($56 = `best`, $69 = `better`). Offering **3** options would touch
8 coupled sites (`app/q/choose/[token]/page.tsx:75` `.slice(0,2)`; `ChoiceCards.tsx:103,122-126`;
the `tier: 'good' | 'better'` union; `interpretChoiceReply:306,332`; `buildProductOptionsSms:231`;
`buildChoiceHoldSms:261`; `recommendedOption:280`) — out of scope.

`WP9_PRODUCT_OPTIONS` is absent from `.env.local` (`grep -c` → 0), so the picker is off in dev.
It stays that way: there is **no dev guard on the send path**. `lib/sms/dispatch.ts` goes straight
to `sendSms`, the only bail-out is `lib/sms/twilio.ts:39-41` returning `NO_CREDS` when creds are
missing, and `.env.local` has live values. Blanking `TWILIO_AUTH_TOKEN` does not help — signature
validation (`lib/sms/twilio-validator.ts:14-17`) then 403s the route before any logic.

### WS4 — the real documentation drift

⚠ `CLAUDE.md` does **not** say electrical/plumbing are SMS-only — grep for `SMS-only` / `SMS only`
across `CLAUDE.md`, `README.md`, `docs/strategy.md` → **0 hits**. Do not write that claim into the
strategy log.

The load-bearing drift is `CLAUDE.md:17`: *"This one route fans out to four different
receptionists depending on the tenant's trades **and the message**"*. Verified wrong for
multi-trade tenants: `shouldEngageRoofing` (`lib/sms/roofing-receptionist.ts:968`) is
`canResume = isActiveRoofingFlow(prev) && !followupPinActive; if (canResume) return true` — it
never inspects the inbound message for another trade, and `route.ts:2185-2187` returns before
`extractSlots` at :2353. On a tenant holding roofing, an active roofing thread captures every
subsequent turn regardless of content.

Convention: `docs/strategy.md:415` `## Iteration history`, flat bullets `- **vN** (YYYY-MM-DD): …`,
last is **v17** → next is **v18**. `docs/strategy.md:3` carries a one-line "Current iteration"
summary that must be updated in the same edit. Root `CLAUDE.md` mandates invoking the
`strategy-reviewer` agent after editing `docs/strategy.md`.

## Task

### Stage 1 — WS5, internal route auth (land first, alone)

1. Add the guard as the **first statement** of `POST` in both `app/api/estimate/draft/route.ts`
   and `app/api/intake/structure/route.ts`:

   ```ts
   import { isCronAuthorised } from '@/lib/agents/cron'
   if (!isCronAuthorised(req)) return new Response('unauthorised', { status: 401 })
   ```

   Add a one-line comment noting this conflates "cron caller" and "internal self-call" into one
   secret, and that the rename path is `isMachineAuthorised` reading
   `INTERNAL_API_SECRET ?? CRON_SECRET`.

2. Add `Authorization: \`Bearer ${process.env.CRON_SECRET}\`` to the existing headers object at
   **all six** in-app call sites A–F above. Site G (`scripts/test-stage-04.mjs`) needs no change.

3. Do not restructure any caller, do not convert an HTTP hop to an in-process call, and do not
   touch retry logic.

### Stage 2 — WS2, the trade guard

4. Add a fifth signal to `sideEffectsAllowed` (`lib/sms/inbound-helpers.ts:127`):

   ```ts
   otherTradeActive: boolean
   ```

   and require `!args.otherTradeActive`. Derive it in the caller at `route.ts:3724` from the
   already-loaded `roofing_state` / `painting_state` `last_step` being non-null. **Never** derive
   it from `slots.job_type` — that is null on every conversation since 2026-07-08 and would
   suppress all SMS quoting.

### Stage 3 — WS1, the affine cap

5. Add two optional fields to `SanityInput` in `lib/estimate/sanity-bounds.ts`, both defaulting
   to 0, and replace the per-unit comparison:

   ```ts
   minLabourHours?: number | null    // pricing_book.min_labour_hours — a floor, not extra work
   recipeLabourHours?: number | null // one-off labour; does not scale with quantity
   ```

   ```ts
   const minCharge = Math.max(0, Number(input.minLabourHours) || 0)
   const oneOff    = Math.max(0, Number(input.recipeLabourHours) || 0)
   const scaled    = bound.per_unit_labour_hours * input.quantity * PER_UNIT_TOLERANCE
   const cap       = Math.max(minCharge, scaled) + oneOff
   if (input.totalLabourHours > cap) { /* fail */ }
   ```

   `Math.max`, **not** `minCharge + scaled` — summing them would let a 6-downlight tenant with a
   2 h floor reach a 12.5 h cap and drift the guard toward inert.

6. Pass `pricingBook` into `checkDraftSanityBounds` (`run.ts:1411`, called at :1077) and sum
   recipe labour **from the draft's `recipe_origin` markers**, not from `TierMergeOutcome`:

   ```ts
   const recipeHrs = t.line_items
     .filter((l) => l.recipe_origin === true && (l.source === 'labour' || l.unit === 'hr'))
     .reduce((s, l) => s + (Number(l.quantity) || 0), 0)
   ```

   The draft is post-R7-dedup (:514) and post-R9-per-tier-revert (:533); the outcome object is
   not, so reading it would over-count and inflate the cap.

### Stage 4 — WS6 review, then WS4 docs, then WS3

7. Review the already-applied `product-options.ts` change against this spec's WS6 section.
   Keep it if correct; do not extend it to 3 options or to `tier_hint`.
8. Correct `CLAUDE.md:17` so it no longer claims message-based fan-out, and append a **v18**
   entry to `docs/strategy.md` recording: the roofing-thread capture, the untraded-handoff money
   bug with its four prod rows, the R9 affine correction, and the traffic (not code) verdict on
   `job_type='other'`. Update the "Current iteration" line at `docs/strategy.md:3` in the same
   edit. Then invoke the `strategy-reviewer` agent.
9. Commit. **Confirm with the user before pushing or opening a PR** — that is outward-facing.

## Constraints

- **Do not** raise `PER_UNIT_TOLERANCE`, and do not ship a migration against `job_type_bounds`.
  All five rows stay flagged `PROVISIONAL`; migration **184** is reserved for the
  tradie-confirmation pass that will also revisit `power_points.min_total_ex_gst = 250`.
- **Do not** attempt the mid-thread trade switch (`shouldEngageRoofing:968` resuming regardless
  of message content). It changes which receptionist wins a live turn on the two 8-trade tenants
  with no eval harness behind it.
- **Do not** reconcile the `SlotsSchema` / `IntakeSchema` `job_type` enums (5 missing values).
  Real gap, but it cannot affect `categoryForJobType` and it touches the LLM structured-output
  schema that the pinned `@ai-sdk/anthropic@3.0.71` handles delicately.
- **Do not** add `WP9_PRODUCT_OPTIONS` to `.env.local`, and do not add a dry-run guard to
  `lib/sms/dispatch.ts` — that is a change to the live send path and was not requested.
- **Do not** convert the `structure` → `draft` HTTP hop to an in-process call. Today `draft` gets
  a fresh 300 s budget from its own request; in-process it would have to fit inside `structure`'s
  remaining budget, a real timeout regression on SMS and voice for a ~1200-line diff.
- **Do not** widen where the customer product picker appears. Settled product decision, recorded
  at `product-options.ts:12-14`.
- Prices stay ex-GST in storage, inc-GST in display. Australian English throughout. No emoji.
- Every new migration would need a matching `NNN_down.sql` and `scripts/run-migration-NNN.mjs` —
  but this change ships **no** migration.

## Acceptance criteria & gates

```
npm test           # vitest run --testTimeout=20000
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run test:e2e   # playwright test — only when a dashboard surface changed
```

`npm run check` does not exist in this repo. `package.json:5` declares
`packageManager: pnpm@10.33.2`; both `npm run …` and `pnpm …` work here.

Per-stage acceptance:

- **Stage 1.** A grep proof that the number of call sites referencing either route equals the
  number carrying an `Authorization` header (6 in-app; `scripts/` excluded). `lib/agents/cron.test.ts`
  stays green. A test that each guarded route returns 401 without a header and proceeds with the
  correct one — mock the helper's `env` argument rather than mutating `process.env`.
- **Stage 2.** Extend `describe('sideEffectsAllowed')` (`lib/sms/inbound-helpers.test.ts:75`,
  existing shape at :83-92): a case per signal, plus one asserting an active roofing thread at
  `finish` returns `false`, and one asserting a normal electrical `finish` still returns `true`.
- **Stage 3.** A test that a single-item job on a tenant with `min_labour_hours = 2.00` and
  `per_unit_labour_hours = 1.00` now **passes** (the `5350290e` case). A test that a 2-unit job
  with 1.0 h of `recipe_origin` labour passes (the `0c39d4c2` case). A test that a genuinely
  absurd quote — 4 downlights at 8 h with no floor and no recipe — **still fails**
  (`sanity-bounds.test.ts:38` is the tripwire and must keep failing). A test that
  `recipeLabourHours` counts only `recipe_origin` lines.
- **Stage 4.** `strategy-reviewer` reports no unaddressed drift between `docs/strategy.md`,
  `CLAUDE.md` and `README.md`.

Completion bar: `npm test`, `npm run typecheck` and `npm run lint` all pass; `/review` and
`/code-review` report no blocker or major findings; the R9 fix is confirmed against the two real
intake shapes named in Stage 3 rather than only synthetic ones.
