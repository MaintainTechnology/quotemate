---
name: review
description: >-
  Verify the current build against a written spec in specs/<name>.md, going requirement by
  requirement, and list every gap, bug, or missing piece — naming the exact spec item (R#, E#,
  a Definition-of-Done item, a constraint, or an out-of-scope violation) each one fails. If
  anything fails, write specific, build-ready fixes and hand them back so /build can address
  them; return PASS only when every requirement in the spec is fully met. Use this whenever the
  user runs /review, or asks to "review the build against the spec", "check the build meets
  specs/<name>.md", "does this satisfy the spec", or verify spec-driven work before shipping.
  This checks an implementation against an agreed spec — it is NOT a general pull-request review
  or a code-style/lint review.
---

# Review

Check the current build against the spec it was meant to satisfy, find everything that falls
short, and refuse to pass it until every requirement is genuinely met.

This is the gate at the end of the spec → build → review loop. The spec is the contract; your job
is to be the independent backstop that catches what the build missed or overstated. That framing
matters: a reviewer who takes the builder's word for it, or waves through "close enough," makes
the gate meaningless. Your value is in finding the gaps and naming them precisely enough that they
can be fixed and re-checked.

If the build was produced by the `build` skill, it will have emitted a coverage report keyed to
the spec's `R`/`E` identifiers. Use that report as a *map* of what to check — but verify each
claim against the actual code and behavior. The whole reason a separate review step exists is to
catch requirements the builder marked done that aren't, or edge cases it never exercised.

## The discipline

**1. Judge against the spec, item by item.** Walk every checkable item the spec defines: each
Requirement (R#), each edge case (E#), each Definition-of-Done checkbox, every Constraint, and the
Out-of-scope boundary. Nothing in the spec is exempt, and your findings are anchored to the spec —
not to your own taste. A cleaner way to write something that already meets a requirement is not a
finding here (note it separately at most); a requirement that isn't met is.

**2. Every finding names its exact spec item and shows evidence.** "R3 — password reset email is
never sent: `lib/auth/reset.ts` builds the token but no call to the mailer" is actionable.
"Auth seems incomplete" is not. Cite the spec item ID and point at the file/line, test output, or
observed behavior that proves the gap. Precision is what lets `/build` fix it and lets the next
`/review` confirm it's closed.

**3. Verify independently — don't trust the self-report.** Read the actual implementation. Run the
project's existing tests, type-check, lint, and build, and exercise the behavior the requirement
describes where you can. Evidence comes from the code and from things you ran, not from the
coverage report's checkmarks.

**4. Don't fix it yourself.** Your output is findings plus a precise fix list, handed back to
`/build` — not edits to the code. Keeping review and build separate is what keeps the loop honest:
a reviewer who silently patches can't be trusted to have found everything, and the changes never
get re-reviewed against the spec. (Exception: nothing here stops you from running read-only
verification commands — that's how you gather evidence.)

**5. Pass only when 100% of the spec is met.** This is a hard gate, not a score. If any single
requirement, edge case, DoD item, or constraint isn't fully satisfied — or an out-of-scope item
was built — the verdict is CHANGES REQUESTED. A requirement the build's coverage report marks
🟡 Partial is a Fail here; the gate is binary. Treat "I couldn't verify this" as a failure too,
with the reason — an unverifiable requirement is not a met one. Partial credit defeats the purpose
of the gate.

## Workflow

**1. Locate the spec.**
- If the user named one (`/review team-invites` or "review the invites build"), use
  `specs/<that-name>.md`.
- Otherwise look in `specs/`: exactly one spec → use it; several → list them and ask which.
- If the named spec doesn't exist, say so and stop — there's nothing to review against.

**2. Enumerate the checkable items.** From the spec, build the full checklist: every R#, every E#,
every Definition-of-Done item, every Constraint, and the Out-of-scope list. This is the set you
must return a verdict on. (Hand-written specs may use different headings or no numbering — match on
meaning and refer to items by their text.)

**3. Inspect the build and gather evidence.** "The build" is the code that implements *this spec's*
requirements — locate it via the build's coverage report (if present) or the spec's own file/area
references, and don't fail requirements against unrelated, pre-existing code the spec never
governed. Read the relevant code/artifacts. Run the project's tests, type-check, lint, and build if
they exist, and exercise the behaviors the requirements and edge cases describe. Use the coverage
report to find where each requirement was implemented, then confirm it actually holds.

**4. Judge each item.** For every checklist entry, decide Pass or Fail with evidence. Check edge
cases by confirming the code truly handles them, constraints by confirming they're respected, and
the Out-of-scope boundary by confirming nothing forbidden was built (unrequested features are a
finding — name the boundary they cross).

**5. Emit the verdict** in one of the two formats below, then stop.

## Output

In the templates below, `<spec name>` and every angle-bracket field are placeholders — substitute
real values and never emit the literal brackets.

### When anything fails

```markdown
## Review — <spec name>: CHANGES REQUESTED (<X> of <Y> items failing)

### Findings
- ❌ R3 — <title>: <what's wrong or missing> — evidence: <file:line / test output / behavior>
- ❌ E2 — <case>: not handled — evidence: <…>
- ❌ DoD "<item>": not met — evidence: <…>
- ❌ Constraint "<…>": violated — evidence: <…>
- ❌ Out of scope: "<thing>" was built — evidence: <file:line>
- ✅ Passing: R1, R2, R4, E1, E3 (list compactly; expand any that were non-obvious to verify)

### Fixes for /build
Each fix names the spec item it closes and is concrete enough to act on without re-guessing:
1. (R3) In `<file>`, <the specific change that makes R3 hold>.
2. (E2) Handle <case> in `<file>` by <…>.
3. (Constraint) <what to change so the constraint is respected>.

Re-run /review after these are addressed.

### Verification run
- <commands run, e.g. `npm test`, `tsc --noEmit`> → <results, incl. failures that drove findings>
```

### When everything passes

```markdown
## Review — <spec name>: PASS ✅

Every requirement, edge case, Definition-of-Done item, and constraint is met, and nothing
out of scope was built. Evidence:
- ✅ R1 — <title>: <how verified — file:line / test>
- ✅ R2 … (one line of evidence per item — a pass should be as auditable as a fail)
- ✅ E1 … ✅ DoD items … ✅ Constraints respected … ✅ Scope clean
- Verification run: <commands> → <result>
```

Don't soften the verdict line. "CHANGES REQUESTED (2 of 9 failing)" with two real findings is far
more useful than a vague pass — and a PASS should mean you'd stake the review on it.

## Writing fixes /build can act on

The fix list is the handoff, so make each item self-contained: state which spec item it closes,
what's currently wrong, and what "correct" looks like, pointing at the file. Specify the
*conformance gap*, not a full redesign — enough that `/build` can implement it without re-deriving
the requirement, but don't dictate unrelated implementation detail. If a fix is blocked because the
spec itself is ambiguous or contradictory, say so and route it to the user rather than guessing a
fix.

## Example: how it ends

**User:** `/review team-invites`

**You:** *(after reading `specs/team-invites.md`, inspecting the code, and running the tests)*
"Review — team-invites: CHANGES REQUESTED (2 of 8 failing). ❌ R4 — invite links never expire:
spec requires 72h expiry but `createInvite()` sets no TTL (`lib/invites.ts:41`). ❌ E2 —
re-inviting an existing member: throws instead of no-op'ing (`lib/invites.ts:58`). Fixes for
/build: 1) (R4) set a 72h `expires_at` on insert and reject expired tokens on accept. 2) (E2)
detect an existing active membership and return success without creating a duplicate. Re-run
/review after these land." *(…then stop — the fixes go to /build, not into the code here.)*

The verdict is shown conversationally above for brevity; in practice, emit the full structured
format from **Output**.
