# EV charger SMS receptionist — auto-quote fix — Spec

> Incident: Jon texted the Atomic Electrical ("Quotemate Atomix") number asking for an EV
> charger on 2026-09-01. The receptionist asked every qualifying question and finished
> cleanly, but the customer received the **$99 inspection SMS** ("Every site is different —
> we can't price this safely without seeing the work in person… SCOPE: Supply and install a
> single-phase 7kW EV charger on a new dedicated circuit at 652 London Rd, Chandler") instead
> of a priced quote. Quote token `7zNJCjsaxBOL_N3cATDNvQ`, intake `92bf61d4…`, conversation
> `e5e7caa0…`. This spec is the fix. Companion to `specs/ev-charger-job-quoter.md` (dashboard).

## Objective

Make an EV charger enquiry over SMS produce a priced Good/Better/Best quote whenever the
receptionist gathers the qualifying answers and the tenant offers the service — and make sure
a customer is **never** shown an inspection message that was actually caused by an internal
pricing/grounding failure. Ship it to the surface that actually serves the number: the
exported `qm-electrical-receptionist` on Railway, fed from the monolith.

## Context — what the forensics proved (errors and causes, ranked)

Traced end-to-end in prod data (`quotes`, `intakes`, `sms_conversations`/`sms_messages`,
`pipeline_traces`) and both codebases. **Every hypothesis about the receptionist itself was
ruled out** — the failure is downstream of the conversation.

**What actually happened, in order**

1. Conversation `e5e7caa0…`: "Do you do Ev chargers" → name → "Yes id like a charger
   installed" → suburb "Chanlder" → "Not its not on site yet" / "Can you supply" → "7meters"
   → "Single phase" → spare capacity "Yes there is." → recap confirmed "Yes". Every dispatch
   trace is `decision_action=ask` until the last, which is `finish, ready_for_intake=true,
   job_type=ev_charger`. **The dialog never escalated.**
2. Intake `92bf61d4…`: `job_type=ev_charger`, `inspection_required=FALSE`, `supplied_by=
   'tradie'`, distance 7 m, `property.phase='single'`, confidence MEDIUM with reason
   "…caller phone and full address were not provided." **The structurer did not inspect it.**
3. `runEstimation` (claude-opus-4-8, 41.7 s): produced a **priced** draft — good $496.80,
   better $591.80, best $741.80 ex-GST, `needs_inspection=false`, zero risk flags.
4. `validate_grounding` → **status err, 3 lines ungrounded → `{cause:'grounding_failed',
   route:'inspection'}`** → tiers nulled, `selected_tier='inspection'`, total $99,
   `inspection_reason` = the `SAFE_INSPECTION_REASON` fallback ("A quick on-site inspection
   is needed to quote this job accurately."). The customer got `buildInspectionQuoteSms`
   (`lib/sms/templates.ts:1174`), the tradie got the inspection notify.

**Error 1 — Typed-ref type mismatch (the decisive failure, 2 of 3 lines).**
Opus emitted "Add RCBO safety switch on the EV circuit" ($95, better + best) with
`source: material:5b48eed9-3f37-4d1c-a3e2-d4afae0a5e20`. That UUID is real — it is the
**shared_assemblies** row "Install 20A dedicated GPO" (electrical, *Includes RCBO*, enabled
for this tenant) — but the strict UUID path in `lib/estimate/validate.ts:951-963` looks the
id up **only in the declared type's map** (`ref.type === 'material' ? materialById :
assemblyById`), so a correct-row/wrong-prefix tag fails hard with "not found in this
tenant+trade candidate set". A grounded RCBO existed either way: tenant catalogue "HPM 2-pole
RCBO 32A" (`bed5b1a0…`, category safety_switch) and shared "RCBO safety switch" (`b98c8371…`).

**Error 2 — Prompt-invited line that can never ground (1 of 3 lines).**
"Switchboard health check" $150 (best tier) matched no priced row anywhere — because there is
none. `lib/estimate/electrical-prompt.ts:494-498` tells Opus to add
`{ name: "Switchboard health check", price_ex_gst: 150 }` for ev_charger jobs. It is meant
for `optional_upsells[]`, but nothing stops Opus folding it into a tier, and a hard-coded
price with no catalogue row is ungroundable by construction. Same class: "Add RCBO safety
switch $95" and "Per-property compliance certificate $80".

**Error 3 — Whole-quote downgrade + wrong customer copy.**
Three optional/upsell lines took down a quote whose base lines (install assembly, labour,
sundries) were fully grounded. The customer was then told "Every site is different — we
can't price this safely without seeing the work in person", which is a *site-conditions*
message, for what was an *internal validation* failure. Nothing in the pipeline distinguishes
"genuine inspection decision" from "grounding_failed" when composing the SMS.

**Error 4 — Stale address printed into the customer SMS.**
Jon typed only "Chanlder". "652 London Rd" came from the **customers** row for that phone
(`b9d5412e…`, name "Mark"), captured on **2026-07-23 in a roofing conversation**. The SMS
route seeds `conversation_state.slots.address` from customer memory
(`app/api/sms/inbound/route.ts:1964-1969`, `:2090-2092`) and the structure route backfills the
intake from the same memory (`app/api/intake/structure/route.ts:398-410`), so the intake
gained a street address the customer never stated — and the SCOPE line printed it. The
intake's own `confidence_reason` admits the address was not provided.

**Error 5 — The fix must land in the fleet, not (only) the monolith.**
Atomic Electrical's Twilio `sms_url` points at `qm-front-desk-production.up.railway.app`,
which forwarded the turn to **`qm-electrical-receptionist`** — a NestJS carve-out of the
monolith's SMS→intake→estimate pipeline generated by `scripts/export-receptionist.mjs`. The
deployed build is ~2026-08-07 (uptime ~25.8 days, no redeploy). Evidence: the quote link is
on apex `quotemax.com.au` (the fleet's `APP_URL`), not `www.` (the monolith default). Its
`src/lib/estimate/validate.ts` is hash-identical to monolith HEAD, so Errors 1–3 reproduce
there. The **local** fleet working copy already has the SMS-parity patch applied (9/1) but
was never deployed; a future `export-receptionist.mjs` re-sync overwrites `src/lib` from
monolith HEAD — so the monolith is the only durable home for every fix below.

**Latent defects confirmed live at HEAD (not the trigger this time, will bite next time)**
- `lib/sms/assumptions.ts:371-378` still lists 'ev charger'/'tesla charger'/'wallbox'/
  'wall charger' in `UNIVERSAL_INSPECTION_TRIGGERS`, injected into the dialog prompt as
  "escalate immediately" — contradicting the enabled-service HARD RULE (prompt-level coin
  flip; the prior night's thread at 00:18Z *did* escalate).
- `lib/sms/extract-slots.ts:516-529` auto-stamps `circuit_required='three-phase'` on any
  EV/Tesla mention; `:347-354` worked example maps "Tesla wall charger" → `power_points`
  while `:429` maps it → `ev_charger`.
- `lib/sms/quote-readiness.ts:466-494` accepts ONE topic-word hit as "answered" — the word
  "charger" in the opening message can mark all three mig-033 clarifying questions answered.
- All four are fixed by the parked, committed-as-a-file
  `specs/ev-charger-sms-parity.phase2.patch` (applies cleanly to HEAD), which also adds
  supply-gated EV product offers. It does **not** update `scripts/test-sms-parity.mjs:371`
  (asserts "ev charger" stays a trigger) — applying it alone breaks that harness.

**Ruled out (not causes):** dialog escalation; the service toggle (ON for this tenant since
~00:43Z); `job_type_bounds` (draft sat inside 10 h / $400–$6,000; no bounds trace); the
`supplied_by` assembly filter (`assemblyPropertyFiltersForJob` is committed in `ef967b7a`);
front-desk misrouting; Vercel/monolith deployment (it no longer receives this number).

## Requirements

**R1 — Cross-type UUID resolution in the grounding validator.** In
`lib/estimate/validate.ts` strict path (`~:951`): when `source` is `material:<id>` and the
id is absent from `materialById` but present in `assemblyById` (or the reverse), resolve
against the other map. If the line's price matches that row (raw or markup variant, ±$0.50
as today) → line is **valid** and its `source` is rewritten to the correct prefix
(`assembly:<id>`) so downstream consumers agree. If the id exists in neither map, or the
price does not match, fail exactly as today. Log the correction (`typed_ref_retagged`).

**R2 — Upsells can never sink a tier.** Two parts, both required:
(a) Deterministic pre-validation guard in `runEstimation`: a tier line whose description
matches an OPTIONAL UPSELLS name from the electrical prompt ("RCBO safety switch",
"Switchboard health check", "compliance certificate") **and** has no grounded row is removed
from `line_items`, the tier subtotal recomputed, and the item appended to
`optional_upsells[]` with no price (rendered "quoted on site"). Never mutate the input draft;
log removals.
(b) `lib/estimate/electrical-prompt.ts:494-498`: state that upsells go in `optional_upsells[]`
**only, never in a tier**, and remove the hard-coded prices for any upsell that has no priced
row in `shared_assemblies`/`shared_materials` (keep the price only where a row exists and
reference it by id).

**R3 — Line-level downgrade instead of quote-level.** When `validateQuoteGrounding` fails
after R1/R2, do not route straight to `inspection`. Apply this ladder in `runEstimation`:
1. If every remaining failure is on an R2-class line → strip per R2(a), re-validate; valid →
   proceed as a priced quote (`pricing_path` unchanged, `risk_flags += 'ungrounded_lines_
   stripped'`).
2. Otherwise → **hold for tradie review** with the priced draft **preserved** (tiers not
   nulled): `shouldHoldForReview` reason `grounding_failed`, quote status
   `awaiting_tradie_approval`, `grounding_result` stored, tradie gets
   `buildTradieReviewNotification` (approve + edit links) naming the failing lines. The
   customer receives the existing "quote on its way / being checked" holding path — **not**
   the inspection SMS.
3. `route:'inspection'` from a grounding failure is reserved for the case where the base
   lines themselves (install assembly / labour) are ungrounded.

**R4 — Inspection copy only for genuine inspection decisions.** `buildInspectionQuoteSms`
(`lib/sms/templates.ts:~1160-1180`) and the `/q/[token]` inspection view
(`app/q/[token]/page.tsx:1582, :2485`) may include "Every site is different — we can't price
this safely without seeing the work in person" **only** when `routing_decision` /
`inspection_reason` originates from a genuine inspection rule (three-phase, safety,
switchboard, mains/underground, `needs_inspection` from the structurer, or a tradie
`usuallyInspection` job). For any `grounding_failed`/`system` cause reaching a customer
(should be unreachable after R3, but keep the belt) the copy is neutral: "We've got your
details and <tradie> is confirming the price. You can lock in a $99 site visit now…".
Persist the cause (`quotes.routing_decision` already exists; add `inspection_cause`
`'site_conditions' | 'grounding_failed' | 'model_declared'` if no existing column carries it).

**R5 — Remembered address is not this job's address.** The customer-memory address may
prefill the *dialog* (so returning customers are not re-asked), but:
(a) the intake/structure backfill (`app/api/intake/structure/route.ts:398-410`) may fill
`suburb` from memory; it may fill `address` **only if the current thread contains a street
address the verifier matched** — otherwise `intake.address` stays null and
`scope.address_source='none'`;
(b) the customer-facing SCOPE line and quote page print suburb-only ("in Chandler") when no
in-thread street address exists;
(c) the tradie surfaces (review page, notify SMS) show the remembered address labelled
"from customer records — confirm on site";
(d) the dialog, when finishing an EV (or any priced electrical) job with no in-thread street
address, asks one more question for it before `finish` — unless the customer already
declined to give it.

**R6 — Land the SMS parity fixes (the parked patch) plus its missing pieces.** Apply
`specs/ev-charger-sms-parity.phase2.patch` from the repo root (paths carry the
`quotemate-automation/` prefix) and in the same change:
(a) `scripts/test-sms-parity.mjs:371-375` — remove `"ev charger"` from `required`, keep
`"three-phase"`/`"switchboard"`, add a negative assertion that the six EV phrases are absent;
(b) verify the live `shared_assemblies` row "Install EV charger" has `category='ev_charger'`
and `always_inspection=false` (the patch's readiness 40 % threshold and
`findMatchedService` both key on that exact value) — assert it in a test against the seed;
(c) add a deterministic SMS-side three-phase gate mirroring the dashboard: explicit
`requested_specs.phase ∈ {'three-phase','3 phase','three phase'}` from the customer's own
words → `inspection_required=true` on the intake; `'single-phase'` is never stamped by
inference (the patch removes the inference; this asserts it);
(d) re-sync the Vapi voice prompt (`lib/vapi/voice-prompt.ts:33,:299` bakes
`UNIVERSAL_INSPECTION_TRIGGERS`) via the existing `VAPI_PROMPT_SYNC_ENABLED` / update-prompt
script so voice stops sending EV enquiries to inspection;
(e) refresh the hard-coded trigger lists in `public/docs/sms-sop.html`, `sms-progress.html`,
`onboarding-bundle.html` (cosmetic, same commit).

**R7 — Tradie-supplies-but-nothing-stocked is a priced install-only quote.** For
`job_type=ev_charger`, `supplied_by='tradie'` and zero active `tenant_material_catalogue`
rows in category `ev_charger`: the draft prices the install assembly + labour + sundries
(exactly what Opus produced in the incident), adds the assumption line "Charger unit supplied
separately — model and price confirmed before booking", and is **not** downgraded for the
missing unit. When ≥1 charger row exists, the WP9 product offer (from the parity patch) runs
and the chosen unit is added as its own grounded line (dashboard fence semantics apply for
`customer` supply). Charger rows themselves remain Jon-supplied data (never seeded).

**R8 — Ship it to the surface that serves the number.** After the monolith changes are
committed and pushed: `node scripts/export-receptionist.mjs electrical` → confirm the export
diff contains R1–R7 → `node scripts/railway-deploy-receptionists.mjs electrical` → verify
`/api/health` uptime resets and `/api/health/deep` reports `missing: []`. The local fleet
copy's hand-applied changes are discarded by the export (monolith is the source of truth).
Front desk needs no code change; redeploying it is optional (its ~Aug 4 build predates its
8/7 routing updates).

**R9 — Regression net for the incident itself.** One pipeline-level test (mocked model,
real `runEstimation` + `validateQuoteGrounding`) replaying the incident draft — install
assembly + labour + "Add RCBO safety switch" tagged `material:<assembly-uuid>` + "Switchboard
health check" $150 with no row — asserts: R1 retags the RCBO line and it grounds; R2 moves
the health check to `optional_upsells`; the quote is **priced** (`needs_inspection=false`,
`pricing_path≠'inspection'`). Plus a second case where the *base* install line is ungrounded
→ hold-for-review (R3.2), not customer inspection SMS.

## Non-goals

- Painting, roofing, plumbing, solar receptionists (they share `assumptions.ts` — the trigger
  edit is EV-scoped and their own tests must stay green, nothing more).
- Front-desk routing logic.
- Seeding charger unit prices into shared data (Phase-2 R5 strike stands).
- Changing the $99 site-visit commercial model or the auto-send policy for genuine
  inspection decisions.
- A general rewrite of the grounding validator beyond R1; deterministic BOM for EV.

## Constraints

- Money path stays deterministic: every accepted price must still derive from a candidate
  row; R1 only *re-types* an existing match, it never loosens the ±$0.50 rule.
- Monolith is the source of truth; the fleet is an export. Never patch the fleet only.
- `supabase-js` resolves `{data, error}` — check `error` on every write added (hold-for-review
  status, `inspection_cause`); never report a send that did not happen.
- Any DB column added = migration + `_down` + runner script, applied to prod; `sql/init.sql`
  kept representative.
- Existing suites: `npm test` (`--testTimeout=20000`), the SMS parity harness
  `scripts/test-sms-parity.mjs`, tsc; no new lint errors on touched lines.
- `CRON_SECRET` must be present in the fleet env (fail-closed pipeline) — verify with
  `scripts/check-receptionist-env.mjs` before deploy.

## Edge cases to handle

- Typed ref whose UUID exists in the other map but price does not match → FAIL as today
  (no silent acceptance of a wrong price).
- Typed ref UUID present in **both** maps (should not happen — different tables) → prefer
  the declared type; log.
- Upsell-class line that **does** ground (tenant stocks an RCBO and Opus tagged it right) →
  stays in the tier as a priced line; R2 only removes ungrounded ones.
- All three tiers lose their only extra line and become identical → existing
  `collapseDuplicateTiers` behaviour applies.
- Customer texts an explicit street address mid-thread that differs from memory → thread wins,
  memory is updated at finish (existing verified write-back), SMS prints the thread address.
- Customer refuses to give an address → suburb-only quote proceeds; tradie sees "no address
  provided"; booking calendar unaffected.
- `supplied_by='not sure'` → treat as `tradie` for pricing purposes (install-only + assumption
  line); never inspection on its own.
- Three-phase stated explicitly ("three phase supply") → genuine inspection route with the
  *site-conditions* copy — this is the one case "Every site is different" is correct.
- Grounding fails on a **base** line (e.g. the install assembly toggled off mid-flight) →
  R3.2 hold-for-review; tradie notify names the line; no customer inspection SMS.
- Fleet redeploy while a conversation is mid-flight → existing 60 s inflight lock; accept.

## Definition of done

- [ ] `validate.ts` unit test: `material:<assembly-uuid>` with matching price → valid, source
      retagged `assembly:<uuid>`; non-matching price → invalid; unknown uuid → invalid.
- [ ] `runEstimation` test: ungrounded "Switchboard health check" tier line → removed,
      subtotal recomputed, present in `optional_upsells`; grounded RCBO line untouched.
- [ ] R9 incident replay test green: quote priced, `pricing_path≠'inspection'`.
- [ ] Base-line grounding failure → quote status `awaiting_tradie_approval`, tiers preserved,
      tradie review SMS built, no `buildInspectionQuoteSms` call (assert by mock).
- [ ] Templates test: "Every site is different" absent for `inspection_cause='grounding_
      failed'`, present for `'site_conditions'`.
- [ ] Structure-route test: memory address + thread with suburb only → `intake.address` null,
      suburb set; thread with verified street → address set from thread.
- [ ] SMS SCOPE line for the incident replay reads "…in Chandler" (no street).
- [ ] Parity patch applied; `assumptions.test.ts` EV-absent assertions green;
      `scripts/test-sms-parity.mjs` green with the updated required list.
- [ ] SMS three-phase gate test: explicit "three phase" → inspection; "single phase" +
      "Tesla" mention → not inspection.
- [ ] `npm test` green (canonical timeout); tsc clean; zero new lint errors on touched lines.
- [ ] Commit pushed; `export-receptionist.mjs electrical` diff shows R1–R7;
      `railway-deploy-receptionists.mjs electrical` succeeded; `/api/health/deep` `missing:[]`;
      uptime reset.
- [ ] Vapi prompt re-synced (script output captured).
- [ ] **Live replay** on the Atomix number (or its `/api/receptionist/simulate` with
      `SMS_SIMULATE_ENABLED=1`): the exact incident script ("Do you do Ev chargers" … "Single
      phase" … "Yes") ends in a priced G/B/B SMS with the `/q/[token]` link, and the quote page
      shows prices, not the inspection panel.
- [ ] `/code-review` pass on the fix diff before merge (correctness + money-path focus).

## Resolved during the build (2026-09-03)

Two things this spec did not settle, decided during implementation and
recorded here so the next reader is not caught by them.

**R3.2 vs R3.3 contradicted each other.** R3.2 says a remaining grounding
failure holds for tradie review; R3.3 says `route:'inspection'` is "reserved
for the case where the base lines themselves are ungrounded". But the
Definition of done requires *base-line* failure → `awaiting_tradie_approval`,
tiers preserved, **no** `buildInspectionQuoteSms` call. R4 also calls a
grounding cause reaching a customer "unreachable after R3".

Resolution: **no grounding failure ever produces a customer-facing inspection
SMS.** R3.2 is universal — base-line failures included — and R3.3 is treated
as vestigial. This is what the DoD asks for and what the Objective demands
("never shown an inspection message that was actually caused by an internal
pricing/grounding failure"). R4's copy gate stays as defence in depth for any
other path that might still downgrade.

**R2(b) said "reference it by id".** A catalogue row id is environment-specific
and would rot in a prompt, and the only upsell with a real row (`RCBO safety
switch`, $85 ex-GST in shared_materials) is priced per tenant markup anyway, so
no literal is correct. Implemented as: the prompt names the row and instructs
the model to price it via `lookup_material` in that run, or omit the price
entirely. Same guarantee — no invented number — without a brittle id.

**Still open, deliberately:** R8 (export + Railway deploy), the live replay,
and R6(d) (Vapi prompt re-sync). All three are production or outward-facing and
were left for an operator to run; everything they depend on is committed and
migration 193 is already applied to prod.
## Open questions

1. **Jon:** charger unit prices for the tenant catalogue (Tesla Wall Connector 7 kW, a Type 2
   BYD-compatible wallbox) — until then R7's install-only path is what customers get for
   "can you supply".
2. **Jon:** confirm the R7 assumption wording and that install-only auto-send is acceptable
   when he supplies the unit (recommended: yes — it beats a $99 dead-end).
3. **Product:** R3.2 hold-for-review for base-line grounding failures — acceptable that the
   customer waits for the tradie in that rare case rather than getting an instant $99 link?
   (Recommended: yes; it is the honest outcome.)
4. **Ops:** redeploy `qm-front-desk` in the same pass, or leave the Aug-4 build?
5. **Data hygiene:** the customers row for Jon's test phone is named "Mark" with a July
   roofing address — should test numbers be excluded from customer memory entirely?
