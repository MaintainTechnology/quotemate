# Auto-send graduation procedure + kill-switch (R20 / R21)

> The operational runbook for moving a job_type onto AUTO_SEND_JOBTYPES for a
> specific tenant, and for instantly reverting all auto-send if something goes
> wrong. Companion to [`specs/sms-deterministic-pricing-deploy-readiness.md`](../../../specs/sms-deterministic-pricing-deploy-readiness.md)
> (R20 graduation, R21 kill-switch, R23 deploy gate, R22 auto-demote).
> Auto-send is OFF by default (AUTO_SEND_JOBTYPES empty) and is earned one
> tenant + one job_type at a time. Nothing here grants auto-send globally.

## The unit of graduation

Auto-send is granted per (tenant, job_type), never per tenant and never per
job_type alone. Each entry on the allowlist is a deliberate, reviewed decision
recorded with an owner sign-off. The cross-trade tenant graduates last.

This is intentional. The one error class that no automated guard can catch is a
recipe that omits a needed line (grounding catches a wrong price, spec-guard
catches a wrong product, sanity-bounds catches a grossly-wrong total, but none
of them catch a confidently-complete recipe that is missing a line). The only
control for that is a human reviewing real sends. The graduation count below is
that human-in-the-loop check.

## Graduation checklist (R20)

A job_type may be added to AUTO_SEND_JOBTYPES for a tenant only when ALL of the
following hold. Do not graduate on a subset.

1. Deploy gate passes (R23). For this (tenant, job_type) every gate condition in
   `lib/routing/decide.ts` (failedDeployGates) must hold:
   - determinism diff = 0 on the replay set for the job_type;
   - >= 80% of that trade's eval pairs land in band (R15);
   - validator-fire rate = 0 on the trade's replay set;
   - sanity-bounds pass for the job_type (R9);
   - the tenant has confirmed its rates + catalogue (tenants.pricing_confirmed_at
     is set - R14).
   Confirm by replay + eval, not by assertion. Record the run.

2. Deterministic coverage clears the bar (R1). The job_type's deterministic
   coverage on its historical intakes is at or above the bar (proposed >= 90%).
   Source: `scripts/measure-deterministic-coverage.mjs`.

3. >= 10 real tradie-confirmed sends with no material omission and no price
   correction (R20). These are real sends the tradie reviewed after the fact and
   confirmed correct - no added/removed line, no changed total. This is the
   recipe-quality check that the automated guards cannot perform. Fewer than 10,
   or any omission/correction inside the 10, resets the count: re-check the
   recipe (R8) and re-price (R12/R13) before counting again.

4. Owner sign-off. The owner records the graduation: tenant, job_type, the
   deploy-gate run reference, the coverage number, and the 10-send review
   outcome. Sign-off is explicit and dated; an unsigned job_type does not go on
   the allowlist.

Only when 1-4 all hold is the job_type added to AUTO_SEND_JOBTYPES (and, when
the gate is per-tenant in env/config, scoped to that tenant). The change is
made by editing the env var, the same lever the kill-switch uses below - there
is no code deploy required to graduate a job_type.

## Staging order (R20)

Enable in this order, never skipping ahead:

1. A single pilot tenant you control, single job_type, from the covered top set
   (downlights, hot_water, power_points, ceiling_fans, blocked_drain - confirm
   against the R1 coverage output).
2. Additional job_types for the same pilot tenant, one at a time, each through
   the full checklist.
3. A new paying tenant - only after P2 + P3 + P4 + R14 + R23 (the sell-to-new-
   tenant milestone bar), one job_type at a time.
4. The cross-trade tenant last.

## Ongoing review feeds demotion (R22)

After graduation, the weekly review keeps a job_type honest:

- `scripts/weekly-auto-demote.mjs` (read-only) reports each auto-sent job_type's
  post-send tradie-correction rate and recommends demotion when correction rate
  > 20% OR any single correction moved the total by more than +-15%.
- A recommended job_type is removed from AUTO_SEND_JOBTYPES pending
  re-calibration (R12/R13), then must re-graduate through the full checklist
  above (the 10-send count restarts).
- The script only recommends; the operator performs the removal by editing the
  env var (same mechanic as the kill-switch). It never writes to the DB or
  changes env on its own.

## Kill-switch (R21)

The kill-switch is the empty allowlist. Setting:

```
AUTO_SEND_JOBTYPES=""
```

instantly reverts every tenant and every job_type to `tradie_review` with no
auto-sends. The routing code fails closed: `parseAutoSendJobTypes` returns an
empty list, no job_type matches the allowlist, and `decideRouting`
(`lib/routing/decide.ts`) drops every quote to `tradie_review` (the quote is
still drafted, prices hidden by the publish gate - the customer just does not
get an auto-sent quote). No code deploy is required; the env change alone
reverts behaviour.

### Companion hard-off flags

The empty allowlist is the primary revert. These remain available as defence in
depth (set with safe defaults; flipping any of them only ever makes the system
MORE conservative):

- `DETERMINISTIC_BOM` - turning this off removes the deterministic path; since
  only deterministic quotes are auto-send-eligible (R7), an opus_fallback quote
  is never auto-sent, so this also stops auto-send for affected jobs.
- `SPEC_GUARD_MODE` - leave at `enforce` for allowlisted job_types; reverting to
  `shadow` does not loosen safety because a spec mismatch still routes to
  tradie_review via the other gates.
- `SMS_ENFORCE_CLARIFYING_QUESTIONS` - dialog safety valve (R24); independent of
  auto-send.

### Kill-switch drill (verify in staging)

Before relying on the kill-switch, prove it in staging:

1. With a job_type graduated and auto-sending in staging, confirm a fresh intake
   for that job_type produces an auto-sent quote.
2. Set `AUTO_SEND_JOBTYPES=""` and redeploy/restart so the env takes effect.
3. Submit the same intake. Confirm the routing decision is now `tradie_review`,
   no customer auto-send SMS goes out, and the quote is drafted-but-held.
4. Restore the allowlist and confirm auto-send resumes.

Record the drill outcome (date, tenant, job_type, observed routing before/after)
alongside the graduation sign-off.

## What this procedure does NOT do

- It does not change any env or DB value by itself - graduation and demotion are
  operator edits to AUTO_SEND_JOBTYPES, informed by the read-only scripts.
- It does not bypass the deploy gate. Even an allowlisted job_type that later
  fails any R23 condition is forced back to `tradie_review` in code, with the
  failing condition logged. The allowlist is necessary, not sufficient.
