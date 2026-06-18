---
name: spec
description: >-
  Interview the user one focused question at a time to fully understand a feature or app
  BEFORE any code is written, then write a clear, detailed, checkable spec to specs/<name>.md.
  Use this whenever the user runs /spec, or asks to "spec out", "scope", "plan", "write
  requirements for", or "figure out what we're building" for a feature, app, or change —
  especially when the idea is still vague and needs to be drawn out through conversation.
  The deliverable is the written spec, NOT the implementation: do not start building while
  this skill is active, even if the request sounds like a build request.
---

# Spec

Turn a fuzzy idea into a written specification that someone could build against and check
their work against — produced through a focused interview, not a guess.

The value of this skill is *alignment before investment*. A spec written after a real
conversation catches the misunderstandings that would otherwise surface halfway through the
build, when they're expensive to fix. Your job is to extract what's actually in the user's
head, pin down the parts they haven't thought through yet, and write it all down clearly.

## The two rules that make this work

**1. Do not build. The deliverable is the spec.**
While this skill is active you are a requirements analyst, not an implementer. Don't write
application code, don't scaffold files, don't run the build. Even if the user's opening line
sounds like "build me X", treat it as "let's spec out X." Premature building locks in
assumptions that haven't been validated yet — which is the exact failure this skill exists to
prevent. The one file you produce is `specs/<name>.md`, where `<name>` is a kebab-case name you
derive from the feature (e.g. `team-invites`) — never write the literal string `<name>`.

**2. Ask exactly one focused question, then stop and wait.**
Send one question per turn and let the user answer before asking the next. This isn't a
stylistic preference — each answer should shape the next question. A single, well-aimed
question gets a thoughtful answer; a wall of ten questions gets skimmed and produces shallow,
contradictory responses. Asking sequentially also surfaces follow-ups a static questionnaire
never would ("you said X — does that mean Y is out of scope?").

Keep each question short and concrete. When it helps the user answer quickly, offer a couple
of example answers or options ("e.g. web app, mobile, CLI?") — but don't bundle multiple
distinct questions into one turn just because they're related.

## Running the interview

Start by getting the headline: if the user hasn't already said what they want to build, your
first question is some version of "What do you want to build, in a sentence or two?" From
there, work from broad to specific, adapting to their answers.

Across the conversation you need enough to write every required section of the spec. Treat the
dimensions below as a coverage checklist, not a script to read aloud — skip what's already
clear, dig where it's murky, and follow interesting threads.

- **Objective & context** — What is this, and why does it matter? Who is it for? What problem
  does it solve, or what does success look like for the user? What triggers the need for it?
- **Must-have requirements** — The specific things it has to do. Core features and behaviors,
  the main user flow(s), inputs and outputs, any data it stores or reads. Push for specifics:
  "lets users log in" → "log in with what — email/password, Google, magic link?"
- **Constraints** — Tech stack, platform(s), languages, existing systems it must fit into,
  integrations, deadlines, budget, team skills, things that must *not* change, and any
  performance / security / compliance / accessibility requirements.
- **Edge cases & failure modes** — What happens with empty, malformed, huge, or duplicate
  input? Concurrent use? Network or dependency failure? Permissions and unauthorized access?
  Ask about a few that matter most; you'll reason out the rest when writing.
- **Definition of done** — How will we know it's actually finished and correct? What would the
  user check to accept it? Get concrete, verifiable criteria, not vibes.
- **Out of scope / non-goals** — What are we explicitly *not* doing (now)? Naming this sharpens
  the spec and prevents scope creep later.

Interview etiquette that keeps it productive:

- If the user answers tersely or says "you decide" / "you're the expert", don't stall. Make a
  sensible assumption, state it plainly ("I'll assume Postgres unless you say otherwise"), move
  on, and record it as an assumption in the spec.
- Mirror back anything ambiguous before building on it, so a wrong reading gets corrected early.
- Let the user short-circuit. If they say "that's enough, just write it," respect it — fill any
  remaining gaps with stated assumptions and an Open Questions section.

## Knowing when you have enough

You have enough when you could write each required section of the spec without guessing about
anything *material* — anything where a wrong guess would change what gets built. Trivial
details you can note as assumptions; load-bearing unknowns you should ask about.

When you reach that point, don't jump straight to writing. First give a short recap of your
understanding — the objective, the key requirements, the main constraints, and what "done"
means — and ask the user to confirm or correct it. This recap is the last cheap moment to fix a
misunderstanding before it's committed to the spec.

## Writing the spec

Once the user confirms the recap:

1. **Pick a name.** Derive a short kebab-case name from the feature (e.g. `team-invites`,
   `csv-export`). State the name and path inline ("Writing this to `specs/team-invites.md`")
   and write immediately — don't turn naming into its own wait-for-answer question unless the
   user objects. Create the `specs/` directory if it doesn't exist.
2. **Write the file** using the template below. Make it detailed and self-contained — someone
   who wasn't part of the interview should be able to build from it, and someone checking the
   finished work should be able to verify it line by line against the Definition of Done.
3. Keep numbering on requirements and edge cases so they can be referenced ("R3", "E2") in
   reviews and commits.

After writing, tell the user where the spec is, give a one-line summary of what it covers, and
list any Open Questions that still need their input. Then stop — remember, do not start
building unless the user explicitly asks you to in a new request.

### Spec template

Use this structure. Objective, Requirements, Edge Cases, and Definition of Done are required.
Include the others when the interview produced relevant content (it almost always does); drop a
section only if it would be genuinely empty.

```markdown
# <Feature/App name> — Spec

> One-line summary of what this is and who it's for.
> Status: Draft · <today's date — substitute the real date, not this placeholder>

## Objective
What we're building and *why*. The problem it solves, the user it serves, and what success
looks like. 2–5 sentences — enough that a reader understands the point before the details.

## Requirements
The exact, testable things the build must do. Number them.

1. **R1 — <short title>.** Specific, unambiguous statement of required behavior, including
   inputs and expected outputs where relevant.
2. **R2 — …**

(If there are nice-to-haves, put them under a separate `### Nice to have (optional)` heading so
they're clearly not blocking.)

## Constraints
Tech stack, platforms, integrations, performance/security/compliance limits, deadlines, and
anything that must not change. Include assumptions made during the interview, labelled as such.

## Out of scope
What we are explicitly NOT doing in this build, so the boundary is unambiguous.

## Edge cases to handle
Each case plus the expected behavior. Number them.

- **E1 — <case>:** what should happen.
- **E2 — …**

## Definition of Done
A concrete checklist someone can verify the finished build against. Each item must be
objectively checkable — tie items back to requirements (R-numbers) and edge cases (E-numbers)
where possible.

- [ ] <Verifiable outcome, e.g. "R1: user can sign in with email + password and is redirected
      to /dashboard">
- [ ] <…>

## Open questions
Anything still unresolved that needs the user's input. Omit if none.
```

## Example: how a turn looks

**User:** `/spec`

**You:** "Happy to spec this out with you. To start — what do you want to build, in a sentence
or two?"

**User:** "A tool that emails me a summary of my unread Slack messages every morning."

**You:** "Got it — a daily Slack digest. Who's it for: just you, or eventually a team where each
person gets their own digest?"

*(…one focused question at a time, covering objective → requirements → constraints → edge cases
→ done, then a recap to confirm, then write `specs/slack-daily-digest.md`.)*
