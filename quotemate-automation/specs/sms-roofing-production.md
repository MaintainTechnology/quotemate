# Roofing SMS receptionist — production-hardening (F11, F15c, F14, F7/F13, F8, F4, F6)

## Title
Close the blocker and five majors the live 20-scenario Twilio acceptance run surfaced, so the SMS roofing receptionist is deployable: no false cancel, no wrong-address confirm, no painting hijack, no intent-stall loop, no stale-idle quote, deterministic burst harvest, clean topic-switch handoff.

## Goal
A re-run of `.scratch-audit/scenario-runner.mjs` shows 0 blockers and 0 open majors: F11 keeps a live thread on "will the roof stop leaking?"; F15c/F15a/F15b all clear the address on "not quite right" / "no that isn't correct" / "that's wrong yeah"; F14 does not run a roofing measure on "quote painting my gutters"; F7/F13 reach the picker or the inspection fallback instead of looping; F8 starts fresh after a 2h idle; F4 harvests the burst address; F6 hands a topic switch off without bouncing back. Why: these are live-reproduced customer-facing defects on common phrasings, and the whole flow is the money path.

## Role
Principal engineer. The roofing gather + intent + engagement + stop-word logic are PURE, unit-tested modules (`lib/sms/roofing-{intake,receptionist}.ts`, `lib/sms/painting-intake.ts`); the route only wires them. Money path deterministic; no em dashes in customer SMS; AU/NZ. Verification is a NET not a GATE.

## Context (grounded in code opened)
- **F11** — `isStopRequest` (`roofing-intake.ts:337`, identical copy `painting-intake.ts:144`) returns true when `STOP_RE = /\b(stop|cancel|…)\b/` matches anywhere, so "will the old roof **stop** leaking after this?" cancels the thread (live F11 → "I've stopped there", state closed). "stop leaking" is core roofing vocabulary.
- **F15c** — confirm_address (`roofing-intake.ts:452` applyRoofingAnswer) confirms on `isAffirmative(msg) && !isNegative(msg)`. "not quite right" matches AFFIRM (bare `right`) with NO DENY token, so it CONFIRMS and advances (live F15c → intent). `AFFIRM`/`DENY` at :309-310. F15a "no that isn't correct" and F15b "that's wrong yeah" already have a DENY token and clear correctly.
- **F14** — `looksLikeRoofingEnquiry` (`roofing-intake.ts:132`) returns true on `ROOFING_KEYWORDS` incl. `gutter`/`eaves`/`fascia` (:97-99), so "quote **painting** my gutters, eaves and fascia" engages roofing (live F14 → roofing measure). `NOT_ROOFING` (:115) is the existing top-of-function exclusion pattern to mirror.
- **F7/F13** — the gather loop (`roofing-receptionist.ts:600-644`): when `applyRoofingAnswer` for the asked step doesn't land, `crossStepFold` (:371) may harvest a DIFFERENT slot out of order and returns slots with `misses` DELETED, so the asked step (intent) never accrues a miss → the `intent='unknown'→inspection` fallback (:625) never fires → the bot loops "What do you need done?" (live F7/F13; F13 never reached the picker). `missBudget('intent')=2` (:213). `answerLanded` (:220) is the per-step "did the asked slot fill?" predicate.
- **F8** — `expireIdleRoofingState` (:764) only stales `ROOFING_STALE_REPLAY_STEPS = {confirm_roof, quoted}` (:753); a mid-gather step (intent) idle 2h continues, so live F8 measured + quoted the stale 670 London Rd ($164k) after "Hi" + a postcode-less "223 Archer St". `await_booking` is deliberately excluded (a late "yes book it" must still book, :749). Wired at `route.ts:1388` in the reuse branch with `ageMs`.
- **F4** — `roofingTurnInput` (:452) returns `decision: coldStart ? burst : lastLine`; on an ACTIVE flow awaiting the address it uses only the last line, so a burst "opener | address | noise" drops the address (live F4 x3 stalled at `address`). `latestInboundBurst` (:429) already joins the pending inbounds. The last-line-only rule exists to stop a stray digit/deny hijacking a pick/booking (:447) — those are confirm_roof/await_booking, NOT the address step.
- **F6** — a topic-switch bail returns `{action:'passthrough', slots}` (:598) and the route (`route.ts:555`) deliberately KEEPS the gather state on a mid-gather bail, so the next message re-engages roofing (live F6: "leaking tap" → plumbing LLM, then "downlights" → back to roofing intent). `shouldBailToDialog` (:354) fires on `TOPIC_SWITCH` (:283), `INTERRUPT`, or a question; only a genuine `TOPIC_SWITCH` (another trade) should close roofing — an interrupt/question is a resume-able self-correction.
- **U1 cross-tenant** — `customerMemoryAllowed` write gate (`lib/customers/lookup.ts`) unit-tested but not live-verified across two tenants (the live run was single-tenant Atomic).
- Harness: `.scratch-audit/scenario-runner.mjs` (20 scenarios F1-F15, A1-A5; SCENARIO_TO=Atomic +61468011464; forged-sig to quote-mate-rho.vercel.app). Tests: `lib/sms/*.test.ts`, `lib/customers/*.test.ts` (vitest).
- Do NOT break P1/P2/P3/B1/U1/U2/U3 or the parallel-session cross-step work (tryAddressFold/crossStepFold/shouldBailToDialog). Do NOT re-attempt the reverted U5c ("no wait yes" → confirm) — that stays deferred.

## Task (blocker first, then majors in the given order)
1. **F11** — treat an opt-out only when the ambiguous keyword (stop/cancel/cancelled/unsubscribe/quit) is the whole/dominant message (Twilio convention: the message stripped of punctuation is the keyword, optional leading/trailing courtesy or opt-out continuation like please/now/texting/messaging/me). Keep the unambiguous multi-word phrases (not interested / leave me alone / go away / never mind / forget it / end this / end the) matching anywhere. Apply the SAME shape to `painting-intake.ts`.
2. **F15c** — make confirm_address CONSERVATIVE: a negation cue (`\bnot\b`/`\bcannot\b`/`n't`, plus the existing DENY tokens) blocks the confirm and clears+re-asks; a plain affirm with no negation still confirms. This only biases toward re-ask (never a wrong confirm). Must not regress F15a/F15b (still clear) or A1 "yes" (still confirms). Do NOT make "no wait yes" confirm.
3. **F14** — in `looksLikeRoofingEnquiry`, an explicit paint keyword with NO strong roofing-replacement term (re-roof / roof replacement / new roof / roof restoration / roofer) means NOT a roofing enquiry (return false). Keeps "reroof, no paint needed" roofing; sends "quote painting my gutters" to painting/general.
4. **F7/F13** — in the gather loop, after `crossStepFold`, re-check `answerLanded` for the ASKED step; if it is still unanswered (the fold harvested a different slot), count the miss and run the existing miss-budget path (at budget: material/pitch/intent → 'unknown' sentinel → inspection; address → inspection). Keep the fold's harvest of the other slot. Terminates the loop; the picker is reached when intent IS given, the inspection fallback when it is not.
5. **F8** — extend `ROOFING_STALE_REPLAY_STEPS` to the mid-gather steps (address, confirm_address, intent, material, material_profile, pitch) in addition to confirm_roof/quoted; keep `await_booking` (and ready/inspection/closed) EXCLUDED. An idle-then-resumed mid-gather starts fresh instead of measuring the stale address.
6. **F4** — `roofingTurnInput` uses the whole burst for `decision` when `coldStart` OR the step is `address`/`confirm_address`; keeps last-line-only for intent/material/pitch/confirm_roof/await_booking (the anti-hijack rule). Log the deeper webhook/leader race (60s-lock debt) as out of scope.
7. **F6** — add `close?: boolean` to the passthrough decision; set it true when the bail is a genuine `TOPIC_SWITCH` (not an interrupt/question). In `route.ts` passthrough handling, persist a closed roofing_state when `decision.close` (in addition to the existing 'quoted' close), so a topic switch does not re-grab roofing on the next turn. Do NOT close on an interrupt/question/address-correction bail.
8. **Cross-tenant U1 check** — a scratch DB check (or an added test) proving with one customer phone that an Atomic-scoped write does not overwrite a Peppers customer row and vice-versa via `customerMemoryAllowed`.
9. **Re-tests + cleanup** — F12: use a KNOWN-VALID unit address in the runner; A4: raise the runner reply timeout so a slow returning-customer measure isn't a false NO REPLY; clear the stale `name:Sam` on the test number's customer row (data cleanup, not code).

## Constraints
- Minimal, correct, general fixes; reuse existing predicates/helpers; no new production files/abstractions beyond spec + tests; no unrelated refactors. Keep `.scratch-audit/scenario-runner.mjs` and its 20 scenarios. No em dashes in customer SMS; AU/NZ.
- Every fix keeps the fail-soft / net-not-gate posture: a map/Geoscape/tenant-null failure never blocks a lead or a write. Do not re-attempt reverted U5c.

## Acceptance criteria & gates
- **F11**: unit — `isStopRequest('will the old roof stop leaking after this?')===false`; `('stop')`, `('STOP')`, `('stop please')`, `('please stop')`, `('stop texting me')`, `('cancel')`, `('unsubscribe')`, `('not interested')`, `('leave me alone')` all `===true`; same for the painting copy. Live: F11 keeps the thread (state not closed).
- **F15c**: unit — `applyRoofingAnswer({address:'X…',address_confirmed:false},'confirm_address','not quite right').address_confirmed !== true` and address cleared; same for "not correct" / "isn't right" / "not sure"; `('… ,'yes').address_confirmed===true`; F15a/F15b still clear. Live: F15c re-asks the address.
- **F14**: unit — `looksLikeRoofingEnquiry('quote painting my gutters, eaves and fascia')===false`; `('reroof, no paint needed')===true`; `('quote my roof')===true`; `('my gutter is falling off')===true`. Live: F14 does not measure.
- **F7/F13**: unit — advanceRoofing at the `intent` step fed material then pitch (no intent) reaches `action:'inspection'` (or a measure with intent 'unknown') within the miss budget, never an infinite `ask intent`; a valid intent still advances to material/pitch/measure. Live: F13 reaches the picker (when intent given) / inspection; no 3x "What do you need done?".
- **F8**: unit — `expireIdleRoofingState({last_step:'intent',…}, 2h)` returns a closed state; `({last_step:'await_booking'}, 2h)` returns null (still books); within 1h returns null. Live: F8 does not measure the stale address.
- **F4**: unit — `roofingTurnInput('address', [opener, addressLine, noise]).decision` contains the address; `roofingTurnInput('confirm_roof', [.. burst ..]).decision` is still the last line only. Live: F4 harvests the burst address (state advances past `address`).
- **F6**: unit — advanceRoofing on a mid-gather `TOPIC_SWITCH` returns `action:'passthrough'` with `close===true`; on an interrupt/question bail `close` is falsy. Live: F6 "downlights" after the tap switch does not return to roofing intent.
- **Cross-tenant**: the two-tenant check passes (Atomic write does not touch Peppers' row).
- **Gates each iteration**: `npx vitest run lib/sms lib/customers` green; `npx tsc --noEmit` clean; /review + /code-review no blocker/major (each finding adversarially verified before it counts). Overall: after deploy, a full `.scratch-audit/scenario-runner.mjs` re-run shows 0 blockers, 0 open majors, with the residual known-limits (U5c "no wait yes", "no worries" idiom, quotable-only count) logged.

## Known-limits (accepted, from the adversarial review)
- F11: STOP_OUTCOME can swallow a rare leak-adjacent opt-out ("stop the leak texts"); the compliance-critical bare keywords (STOP/unsubscribe/cancel) are unaffected, and an opting-out customer texts STOP.
- F15c: an enthusiastic confirm containing a real contraction ("yes that's it, can't wait") re-asks once — fail-soft (never a wrong confirm). The common-word over-match (apartment/front/point) was fixed.
- F6: a same-property roofing addition ("also do the garage while you're there") closes the gather (matches the spec's close-on-TOPIC_SWITCH rule); a bounded re-confirm, not a lost lead.
- Carried over: U5c "no wait yes" re-asks (deferred); "no worries" AU idiom; quotable-only structure count wording.

## Examples
<example>
F11 keyword-dominant shape mirrors the existing FRUSTRATION_RE standalone intent — an opt-out is the message BEING the keyword, not containing it: normalize (lowercase, strip punctuation), then `^(please )?(stop|cancel|cancelled|unsubscribe|quit)( (please|now|it|texts?|texting|messages?|messaging|me|…))*$`, plus the unambiguous multi-word phrases matched anywhere.
</example>
<example>
F15c mirrors the isInspectionOnlyQuote-style single-predicate approach: a `NEGATION_CUE` alongside the existing `isNegative`, consulted at confirm_address so `isAffirmative && !isNegative && !NEGATION_CUE` confirms. Only ever biases toward the safe re-ask.
</example>
<example>
F4 mirrors roofingTurnInput's existing coldStart branch — extend the burst condition to `coldStart || prevLastStep === 'address' || prevLastStep === 'confirm_address'`, leaving the last-line rule for the pick/booking steps that the 2026-07-24 anti-hijack note protects.
</example>
<example>
F8 mirrors the existing ROOFING_STALE_REPLAY_STEPS set — add the mid-gather steps, keep await_booking excluded exactly as the :749 comment requires.
</example>
