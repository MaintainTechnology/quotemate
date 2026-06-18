---
name: build
description: >-
  Read a written specification in specs/<name>.md and implement EXACTLY what it describes —
  no extra features, no unrelated refactors, no invented requirements — then report which spec
  requirements were covered so a reviewer can check the build against the spec. Use this
  whenever the user runs /build, or asks to "build the spec", "implement specs/<name>.md",
  "build what's in the spec", or otherwise turns an agreed spec into working code. This is
  spec-driven implementation: the spec is the contract. It is NOT for running a project's build
  command (npm/yarn/make build) — that's an unrelated task.
---

# Build

Implement exactly what a written spec describes — no more, no less — and then report coverage so
the work can be checked against the spec it came from.

This is the second half of a spec → build → review loop. The spec is the contract: it was agreed
deliberately, and a reviewer will check the finished work against it line by line. Anything you
build that *isn't* in the spec is unaccounted for — it can't be reviewed against an agreed
requirement, it enlarges the diff and the test surface, and it can quietly conflict with what was
actually asked for. So fidelity to the spec isn't bureaucracy; it's what makes the build
reviewable and trustworthy.

Specs produced by the `spec` skill number their requirements (R1, R2…) and edge cases (E1, E2…)
and end with a checkable Definition of Done. Lean on those identifiers — they make your coverage
report line up exactly with what the reviewer checks. If the spec isn't numbered, enumerate its
requirements as written and reference them consistently.

## The discipline

These four guardrails are the whole point of the skill. Each has a reason — internalize the
reason, not just the rule.

**1. Build exactly what the spec describes.** Every requirement in the spec, and only those
requirements. The spec's Objective tells you the intent behind the requirements; use it to
resolve *how* to satisfy a requirement well, never as license to add things the requirements
don't list.

**2. Don't add features.** A feature that isn't in the spec wasn't agreed, designed, or budgeted,
and it expands what has to be tested and reviewed. If you notice something genuinely valuable
that's missing, don't build it — note it at the end as a suggestion for a future spec, and let
the user decide.

**3. Don't refactor unrelated code.** Touch only what a requirement forces you to touch.
Opportunistic cleanup ("while I'm here…") bloats the diff, buries the requirement-driven changes
the reviewer actually needs to see, and risks breaking code the spec never asked you to change.
Refactoring that is genuinely *necessary* to implement a requirement is fine — call it out in the
report so it's not mistaken for scope creep.

**4. Don't invent requirements.** If the spec is silent or ambiguous on something that changes
what you build, you cannot fill the gap by guessing — that means building to a contract nobody
agreed to. Don't guess — surface the gap; *Handling gaps and ambiguity* below is the single
source of truth on when to ask versus when a trivial default is fine.

Also: honor the spec's **Out of scope** section as a hard boundary, and follow the project's
existing conventions and any `AGENTS.md` / `CLAUDE.md` instructions — building "exactly the spec"
still means building it the way this codebase expects.

## Workflow

**1. Locate the spec.**
- If the user named one (e.g. `/build team-invites` or "build the invites spec"), use
  `specs/<that-name>.md`.
- If they didn't, look in `specs/`. If there's exactly one spec, use it. If there are several,
  list them and ask which one — don't guess.
- If the named spec doesn't exist, say so and stop rather than building from memory.

**2. Read the whole spec before writing anything.** Take in the Objective, every Requirement,
the Constraints, Out of scope, the Edge cases to handle, and the Definition of Done. Note the R-
and E-numbers. If the spec has Open questions still unresolved, raise those before building
anything that depends on them. (Hand-written specs may use slightly different headings — match on
meaning, not exact wording.)

**3. Build it.** Implement the requirements, following existing patterns in the codebase. For a
multi-requirement spec it's fine to briefly state the order you'll work in, but don't turn this
into a planning interview — the spec already is the plan. Keep the change set scoped to what the
requirements need.

**4. Verify against the Definition of Done.** Work through the DoD checklist and confirm each
item actually holds. Run the project's existing tests, type-check, lint, or build if they exist —
verifying that what you built works is part of building it, not added scope. Report what you ran
and the result. Don't invent a new test framework or CI if the project has none; just exercise
the change the best way available.

**5. Report coverage** using the format below, then stop. Don't continue into unrequested work.

## Handling gaps and ambiguity

The spec won't always be airtight. When you hit something underspecified, sort it by whether it
changes what gets built:

- **Material gap** (a wrong guess would change behavior, data, or interfaces): pause and ask the
  user, or if you can't, flag it prominently and implement the safest minimal interpretation,
  clearly marked as an assumption in the report.
- **Trivial gap** (naming, formatting, an obvious default): make the reasonable choice, keep
  moving, and note it under Assumptions.

If a requirement is contradictory, impossible, or conflicts with the codebase or project rules,
don't quietly "fix" it by building something else — surface the conflict and let the user
resolve it. Flagging a problem is in scope; silently redefining the requirement is not.

## Coverage report

End every build with this report. It's the handoff to the review step, so make each line
checkable against the spec.

```markdown
## Build coverage — <spec name>

**Requirements**
- R1 — <title>: ✅ Done — <where: file(s)/symbol> — <one-line note if useful>
- R2 — <title>: 🟡 Partial — <what's done vs. not, and why> — <where>
- R3 — <title>: ⛔ Not done — <reason / what's blocking>

**Edge cases**
- E1 — <case>: ✅ Handled — <where>
- E2 — <case>: ⛔ Not handled — <reason>

**Definition of done**
- [x] <DoD item> — verified by <how>
- [ ] <DoD item> — not met because <reason>

**Scope**
- Out-of-scope items left untouched: <list them, or "yes — none built">
- Constraints honored: <note any constraint that drove a decision, or "yes">

**Verification run**
- <command(s) run, e.g. `npm test`, `tsc --noEmit`> → <result>

**Assumptions made** (only material/notable ones)
- <gap> → <choice you made and why>

**Flagged for the user** (omit if none)
- Spec conflicts/ambiguities you couldn't resolve, or out-of-spec improvements worth a future spec.
```

Use ✅ / 🟡 / ⛔ honestly — a half-finished requirement marked Done defeats the entire point of
the report. If you couldn't complete everything, that's a legitimate outcome to report, not
something to paper over by building around it.

## Example: how it starts

**User:** `/build team-invites`

**You:** "Building from `specs/team-invites.md`. It has 5 requirements (R1–R5) and 3 edge cases
(E1–E3); I'll implement them against the existing auth and email modules and run the test suite
to check them off." *(…then implement, verify against the Definition of Done, and finish with the
coverage report — without adding anything the spec doesn't ask for.)*
