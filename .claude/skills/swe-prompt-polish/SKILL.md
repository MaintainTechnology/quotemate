---
name: swe-prompt-polish
description: >-
  Transform any raw software-engineering request into this repo's engineered TDD prompt — the
  fixed Role/Context/Task/Constraints template (spec → TDD → build → verify → review →
  ralph-loop) with the request slotted into its RAW REQUEST block. Use this whenever the user
  wants a coding brief turned into an executable prompt before running it: "fix this bug",
  "there's a race in the PATCH handler", "add an endpoint", "refactor X", "build this feature",
  or any rough/dictated engineering request the user wants "engineered", "formatted",
  "wrapped", or "prompted up" — even if they don't say the word "prompt". Also trigger on
  /swe-prompt-polish. For pure UI/UX design briefs (visual polish, redesign, landing pages)
  prefer uiux-prompt-polish instead. The deliverable is the assembled prompt text, NOT the
  engineering work itself.
user-invocable: true
---

# swe-prompt-polish

Turn a rough engineering request into the engineered TDD prompt this repo runs on. The
template is fixed instruction; the raw request is the only variable. Consistency across uses
is the whole point — every assembled prompt must be byte-identical except for the RAW REQUEST
block.

## Steps

1. Take the raw request from the skill arguments (or the user's message). If there is none,
   ask for it — never invent one.
2. Read [references/template.md](references/template.md) in full.
3. Replace the single `{{REQUEST}}` placeholder with the raw request, verbatim. Do not clean
   up, expand, or interpret the dictation — the template's own instructions tell the executing
   agent to treat it as a rushed brief and fill the gaps; editing it here would
   double-interpret the user's intent.
4. Output the assembled prompt as one fenced markdown block, ready to copy. No commentary
   inside the block, nothing omitted, nothing summarised — a truncated template silently drops
   quality gates downstream. (The fence is chat presentation only — if asked to save the
   prompt to a file, write the raw prompt without fence markers.)

## Rules

- The template is canon. Don't reorder, trim, or "improve" its sections while assembling. If
  the template itself needs changing (different skills, different gates), edit
  `references/template.md` once — never emit a per-request variant.
- Do NOT execute the assembled prompt (no spec writing, no tests, no ralph-loop, no file
  edits) unless the user explicitly asks to run it. This skill produces the prompt; a separate
  invocation runs it.
- If the request is a pure UI/UX design brief, point the user at `uiux-prompt-polish` instead
  of wrapping it here — the two templates enforce different workflows.

## Example

Input: `/swe-prompt-polish toggling is-active fast sometimes lands on the wrong state, probably a race, make the patch handler safe`
Output: the full template as a fenced block, ending with:

```
RAW REQUEST:
toggling is-active fast sometimes lands on the wrong state, probably a race, make the patch handler safe
```
