# Finish the Electrical/Plumbing job quoter on the Tools tab

## Goal

The Tools-tab job quoter stops losing a tradie's answers, stops inviting customers to use a
button that cannot work, tells the tradie something useful when it fails, and makes a pinned
catalogue product actually determine the price.

## Role

Principal engineer. Two items here touch money: a field whose answer currently reaches nothing
(so the most expensive electrical job is under-quoted), and the product pin, which routes through
`lib/estimate/run.ts` — code shared with every SMS-originated quote. A wrong condition there
changes tier output for live customers. The rest is a client and copy change with no server
behaviour.

Read `AGENTS.md` before touching a route: Next.js 16, conventions differ from training data.

## Context

Paths relative to `quotemate-automation/`. Every claim verified by reading the file or querying
prod this session. ⚠ marks a corrected premise so it is not rebuilt.

### R1 — `ev_charger`'s phase answer reaches nothing (regression, commit `6402a389`)

`lib/quote/recipe-slots.ts:25` is
`RECIPE_SLOT_CODES = ['distance_to_existing_power', 'circuit_required']`.
`app/api/tenant/job-quote/route.ts:234` filters those codes out of the prose transcript
**unconditionally, for every job type** — correct for `power_points`, where the recipe consumes
them, and wrong for `ev_charger`, which `lib/quote/job-fields.ts:193-198` gives a field coded
`circuit_required` with options `single phase | three phase | not sure`.

The answer is dropped twice: from `answered` (`route.ts:233-234`) and again from the `extras`
fallback, because `known` contains the code (`route.ts:244-246`). It is inert as a recipe slot
too — prod holds exactly **one** `price_recipe` (`Replace double GPO`, electrical/`gpo`,
`d19f97df-…`), whose band values are `10A` / `20A` / `three-phase`, compared by exact lowercased
string (`lib/estimate/price-bands.ts:228-230`), so `'three phase'` matches nothing.

Consequence: `lib/intake/structure.ts:397` ("mains, underground cabling, three-phase work →
always `inspection_required = true`") never fires, and a three-phase EV install is priced as
single-phase.

### R2 — three options guarantee a $99 inspection and do not say so

`lib/quote/job-fields.ts:99` `'new run from the switchboard'`, `:184` `'new circuit needed'`,
`:196` `'three phase'`. `lib/intake/structure.ts:405-407` forces `inspection_required` for any
`oven_cooktop` / `power_points` / `outdoor_lighting` job mentioning a new circuit, mains or
switchboard work. The precedent for labelling this is already in the file and already tested:
`job-fields.ts:252-253` suffixes the non-mapping hot-water options "(on-site inspection)" and
`lib/quote/job-fields.test.ts:64-81` asserts every non-mapping option says so.

⚠ Worse on `power_points`: the `20A` band's own `risk_flag` is *"switchboard spare way required"*,
so a tradie wanting a dedicated circuit naturally picks **both** `20A` and
`'new run from the switchboard'` — and the second choice forces the inspection that discards the
recipe's assembly swap. The two fields on that job type fight each other; labelling is the fix,
not re-plumbing.

### R3 — every portal customer quote ships a dead photo upload

`app/q/[token]/page.tsx:1077` puts electrical/plumbing on `usesGenericCard`; `:1198` renders
`<CustomerPhotosBlock urls={[]} uploadToken={null} nested />` **unguarded** (the guarded copy at
`:1988` is unreachable for these trades). Inside, `app/q/[token]/CustomerPhotosBlock.tsx:50` sets
`canUpload = false`, `:193` reads *"Tap to pick a few photos from your phone…"*, `:209` is
`disabled={!canUpload}`, and `:232` omits the `/upload/<token>` link. A portal intake has neither
a `calls.photo_request_token` nor an `sms_conversations.photo_request_token`, which is all
`app/api/upload/[token]/route.ts:34-60` can resolve — so the token is structurally absent, not
merely missing.

### R4 — a failure after ~300 s is unreadable, and retrying double-charges

`app/dashboard/job/_components/JobQuoteForm.tsx:179` is `await res.json()` with no `.catch()`.
`route.ts:33` is `maxDuration = 300` wrapping a self-call to `/api/estimate/draft`, which declares
its own 300 s. A platform 504 returns HTML, so the tradie sees `Unexpected token '<'` while the
draft route keeps running in its own invocation and creates the quote. `router.push` (`:195`) is
not awaited and `finally { setBusy(false) }` (`:199`) re-enables the button mid-navigation, with
no `if (busy) return` at the top of `submit` (`:137`). Retrying a request that in fact succeeded
yields two intakes, two quotes, two Stripe session sets and two tradie-notify SMS.

Only two error shapes are handled (`:186-194`); the rest render an internal slug. The full set:
`unauthorized` (401), `no_tenant` (404), `feature_not_enabled` (403) — all from
`lib/features/guard.ts:36-45`; `intake_insert_failed` (`route.ts:130`); `draft_failed` (`:150-155`);
`draft_incomplete` / `not_entitled` / `voice_not_entitled` (`:170-178`); `pipeline_failed`
(`:197`). ⚠ Worst case is **HTTP 200 with `shareToken: null`** (`:181-191`), which says "Could not
draft the quote" *while the quote exists* — and `quoteId` and `needsInspection` are both in the
payload and thrown away.

### R5 — no customers row, and the phone is stored in a format nothing matches

`route.ts:108-124` inserts no `customer_id` and calls nothing in `lib/customers/*`. The form sends
free text (`<input type="tel">`, no validation) and `route.ts:100` stamps it raw.
`lib/customers/lookup.ts:66-133` `findOrCreateCustomer` matches on **exact `phone_number` string
equality**, and prod's 7 `customers` rows are all `+61`+9 digits — so a row minted from
`'0400 123 456'` is one Twilio's `+61400123456` never matches. `lib/phone/au.ts:14-29`
`normaliseAuMobile` already exists and returns `null` rather than throwing.

Consequence: a later inbound SMS from that handset arrives cold, when
`app/api/sms/inbound/route.ts:1356` would otherwise greet by name and skip the name/suburb
questions.

⚠ **`customers` has no `phone` column** — it is `phone_number`, NOT NULL (verified in prod). So
source #4 of the recipient chain is dead code: `lib/quote/send-customer.ts:119` selects
`'phone, email'` and `:123` reads `row?.phone`, which supabase-js resolves to
`{data: null, error}` — the `catch` never fires and both values silently vanish. The identical bug
was already fixed on the other reader (`app/api/tenant/me/route.ts:435-444`, with a comment naming
the 2026-07-23 audit). `lib/quote/send-customer.test.ts:111` stubs `{ phone: … }` and therefore
green-lights the broken code.

⚠ `customers` is globally phone-keyed and `findOrCreateCustomer` returns another tenant's row
unchanged, so `lib/customers/memory-scope.ts:18` `customerMemoryAllowed` is **not optional**.

### R6 — the product pin is a sentence, not a price

`JobQuoteForm.tsx:175` sends `product_name` only, though `CatalogueRow` (`:34-45`) already holds
`id`, `unit_price_ex_gst` and `image_path`. `route.ts:253-258` renders it as one prose line. Nothing
guarantees the quoted price is the pinned row's.

The deterministic channel exists: `scope.chosen_product`, written **only** at
`app/api/intake/structure/route.ts:483-490` behind `WP9_ENABLED` (`:24`), read at
`lib/estimate/run.ts:742` behind the same flag → live re-resolve of photo/blurb by id (`:750-766`)
→ `evaluateSpecGuard` (`:773-799`, default mode `shadow`) → `applyChosenProduct` (`:801`), which
writes `unit_price_ex_gst`, `total_ex_gst`, `source = 'material:<uuid>'` and `catalogue_id`
(`lib/estimate/catalogue.ts:674-694`).

Grounding accepts it: `run.ts:1347-1356` loads `tenant_material_catalogue` trade-filtered with
`id`, and `lib/estimate/validate.ts:1160-1166` includes a 0 % variant in `standardMarkups`.
`validate.ts:958` is the strict-UUID failure, which is why the row must be re-read **server-side**
scoped to `(id, tenant_id, trade)`.

⚠ **`run.ts:803-825` then collapses the tiers**: `keep = applied.includes('good') ? 'good' :
applied[0]`, other two set to `null`, `selected_tier = keep`. Prod: 57 of 58 non-inspection quotes
off a `chosen_product` intake are `good`-only. The customer is unaffected — all **15** prod
`pricing_book` rows are `quote_tier_mode = 'single'` and `lib/quote/tier-visibility.ts:120` returns
one tier regardless. The cost falls entirely on the tradie:
`app/dashboard/quote/[token]/TierSelect.tsx:29,40` returns `null` below two priced tiers, so the
collapse deletes the only tier control on a quote the review gate exists to review.

⚠ `WP9_PRODUCT_OPTIONS` is **absent from `.env.local`** (zero `WP9` matches), so a pin built under
today's gate is inert in dev and local verification would silently pass while doing nothing.

⚠ `applyChosenProduct` picks the line to rewrite via `findIndex(refsChosenProduct)` and falls back
to `findHeadlineMaterialIndex` (`catalogue.ts:669-672`, `:609-619`) — the first non-sundry material
line. `lib/estimate/catalogue.test.ts:602-641` pins that as correct: a `TPS cable, 100m` line at
$150 becomes a $19.50 downlight. On `power_points` that first line **is** the recipe's TPS cable,
and the portal is more exposed than SMS because the tradie's transcript names a product but not as
a catalogue row, so Opus may not emit it and put it on the happy path.

### Decisions taken (no further input needed)

- **Tradie photo upload is OUT OF SCOPE.** Only the dead-block fix (R3) ships. `lib/estimate/*`
  attaches no images at all (grep: zero hits), `structure.ts:216-218,226-227` bars photos from
  `risks[]` and `scope.specs`, and prod has carried **zero** photo-bearing intakes for 30 days
  (54 of 245 total, 45 of them in one month). The only thing photos unlock is the AI "after" render
  skipped at `app/api/estimate/draft/route.ts:704-706`, which nobody has asked for. Do not describe
  photo upload as a pricing-accuracy feature — it is not one.
- **The tradie pin bypasses the WP9 kill switch.** Without it the feature is unverifiable in dev.
  The switch then covers SMS only; say so in a comment.
- **The tradie pin skips the tier collapse.** `collapseDuplicateTiers` (`run.ts:873`) remains as
  the net and nulls genuinely identical tiers by line-item signature.

## Task

### Stage 1 — R1, the lost answer (land first, alone)

1. Rename the `ev_charger` field code at `lib/quote/job-fields.ts:196` from `circuit_required` to
   `phase`. Nothing else reads it — verify by grep before and after.
2. Add the root-cause guard to `lib/quote/recipe-slots.test.ts`: **no `RECIPE_SLOT_CODE` may appear
   as a field code on a job type whose `catalogueCategory` is not the recipe's** — i.e. only
   `power_points` may use them. This test, not the rename, is the fix: the class recurs the next
   time a recipe slot is added.

### Stage 2 — copy, client and customer (independent of each other)

3. **R2.** Suffix the three options at `job-fields.ts:99`, `:184`, `:196` so each says it routes to
   an on-site inspection, matching the hot-water precedent at `:252-253`. Extend
   `job-fields.test.ts:64-81`'s assertion to cover them.
4. **R3.** In `app/q/[token]/CustomerPhotosBlock.tsx`, when `uploadToken` is absent render the
   empty-state line only: drop the button (`:206-220`) and the "Tap to pick…" copy (`:193`). Do not
   add an upload path.
5. **R4.** In `JobQuoteForm.tsx`: `await res.json().catch(() => ({}))` (the pattern already exists
   at `app/dashboard/quote/[token]/SendQuotePanel.tsx:61`); an `if (busy) return` at the top of
   `submit`; drop `setBusy(false)` on the success path; map every error shape from R4 to actionable
   copy, reusing the session-expired line already at `:161` for `unauthorized`; and when the
   response carries `shareToken` **navigate** rather than erroring, surfacing `needsInspection` as
   a notice rather than a failure.
6. **R5.** In `route.ts`: normalise the mobile with `normaliseAuMobile`, `findOrCreateCustomer` when
   it resolves, gate the result through `customerMemoryAllowed(cust.tenant_id, tenant.id)`, stamp
   `customer_id` on the insert, and store the normalised number on `intake.caller.phone` with the
   raw string as fallback. **Do not** call `updateCustomerFromIntake` — it makes an inline
   `verifyAuAddress()` network call on an already-300 s route (`lookup.ts:195`) and increments
   `total_quotes` unconditionally (`:210`), so a re-draft would read as three quotes.
7. **R5b.** Fix `lib/quote/send-customer.ts:119` to select `phone_number` and `:123` to read
   `row?.phone_number`, and correct the `phone` stubs in `send-customer.test.ts:111,135,141` so the
   test genuinely exercises source #4.
8. Also: `JobQuoteForm.tsx:346` `onSelect` fills **suburb** as well as address (today a picked
   address fails the `:140` completeness check); `route.ts:99` flips to
   `body.customer_name || intake.caller?.name || ''` to match its own comment and its sibling
   fields; and the submit button uses `aria-disabled` with the busy guard rather than `disabled`,
   so focus is not lost on failure (`:438`), with the status `<p>` always rendered and its text
   swapped rather than created (`:443-444`).

### Stage 3 — R6, the pin (last; money path)

9. `BodySchema` gains `product_id: z.string().uuid().optional()`; `JobQuoteForm` sends it.
10. Before the insert, re-read the row server-side by `(id, tenant_id, trade)` — never trust a
    client price — build the existing `ChosenProduct` shape (`lib/sms/product-options.ts:486-524`)
    plus a marker `pinned_by: 'tradie'`, and spread it onto `intake.scope` beside the recipe slots
    already there (`route.ts:93`). A jsonb marker, not a 5th `runEstimation` parameter: the
    signature is `(intake, pricingBook, modelId, conversationState)` (`run.ts:109-114`) and
    `intakes` has no channel column.
11. `run.ts:742` — widen the gate to `process.env.WP9_PRODUCT_OPTIONS === '1' || chosen?.pinned_by === 'tradie'`.
    `run.ts:803` — skip the collapse when `chosen?.pinned_by === 'tradie'`.
12. Keep the prose sentence at `route.ts:253-258`. It makes Opus emit the product itself, which puts
    `refsChosenProduct` on the happy path and avoids the wrong-line rewrite.

## Constraints

- **No migration.** Nothing here needs one.
- **Do not** add photo upload, a customer upload token, a signed/two-step upload, or a tradie photo
  surface. RLS on `storage.objects` is on with **zero** policies, so browser-direct upload is
  impossible anyway.
- **Do not** raise a body-size cap. Vercel caps function bodies at ~4.5 MB and Next 16 buffers a
  proxied body to 10 MB then **continues with a partial body and no error**
  (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/proxyClientMaxBodySize.md`).
- **Do not** flip `SPEC_GUARD_MODE` to `enforce` (default `shadow`, `lib/estimate/spec-guard.ts:43-49`) —
  an independent money-path decision.
- **Do not** touch the deterministic `tierLadder` / `chosenProduct` path through `makeLookupMaterial`.
  Prod has one `tenant_tier_ladder` row; it delivers nothing Stage 3 does not.
- **Do not** Zod-reject a non-mobile in `BodySchema` — a behaviour change on an optional free-text
  field. Add it when a tradie actually hits Twilio 21211.
- **Do not** make `'other'` reachable for plumbing in this change (`deriveTradeFromJobType` returns
  `'electrical'` for it, so the intake is stamped and priced electrical). Real gap, separate change.
- Prices ex-GST stored, inc-GST displayed. Australian English. No emoji.

## Acceptance criteria & gates

```
pnpm test        # vitest run --testTimeout=20000
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint  (repo baseline is already dirty; assert NO NEW findings on changed lines)
```

Per stage:

- **Stage 1.** A test that no `RECIPE_SLOT_CODE` is used as a field code by any job type other than
  `power_points`. A test that `ev_charger`'s phase field survives into the transcript — i.e. is not
  in `RECIPE_SLOT_CODES`.
- **Stage 2.** Extend the existing "routes to inspection but does not say so" assertion to the three
  new options. A test that `normaliseAuMobile` output is what lands on `intake.caller.phone` for
  `'0400 123 456'`. A test that a `customers` row belonging to another tenant is **not** stamped as
  `customer_id`. The corrected `send-customer` stub exercises source #4 for real.
- **Stage 3.** A test that `applyChosenProduct` on a `power_points`-shaped tier whose lines are TPS
  cable + labour and **no** GPO rewrites the line the spec expects — pinning the R6 hazard
  explicitly. A test that `pinned_by: 'tradie'` leaves `better`/`best` non-null while the SMS shape
  still collapses. No existing test covers the collapse, so nothing to update.

Completion bar: `pnpm test`, `pnpm typecheck` pass; no new lint findings on changed lines;
`/review` and `/code-review` report no blocker or major findings; `app/api/tenant/job-quote/route.ts`
has at least one test where today it has none.
