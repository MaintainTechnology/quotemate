---
name: uiux-prompt-polish
description: >-
  Transform any raw UI/UX request into this repo's engineered design prompt — the fixed
  Role/Context/Beautiful/Routing/Task/Constraints template with the request slotted into its
  RAW REQUEST block. Use this whenever the user wants a design brief turned into an executable
  prompt before running it: "polish this page", "make the dashboard feel premium", "improve the
  quote page UI", "build a new landing page / feature UI", "redesign X", or any rough/dictated
  UI-UX request the user wants "engineered", "formatted", "wrapped", or "prompted up" — even if
  they don't say the word "prompt". Also trigger on /uiux-prompt-polish. The deliverable is the
  assembled prompt text, NOT the UI work itself.
user-invocable: true
---

# uiux-prompt-polish

Turn a rough UI/UX request into the engineered design prompt this repo runs on. The template
is fixed instruction; the raw request is the only variable. Consistency across uses is the
whole point — every assembled prompt must be byte-identical except for the RAW REQUEST block.

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
  the template itself needs changing (different skills, different design system), edit
  `references/template.md` once — never emit a per-request variant.
- Do NOT execute the assembled prompt (no spec writing, no ralph-loop, no file edits) unless
  the user explicitly asks to run it. This skill produces the prompt; a separate invocation
  runs it.

## Example

Input: `/uiux-prompt-polish the saved jobs section feels cramped on mobile`
Output: the full template as a fenced block, ending with:

```
RAW REQUEST:
the saved jobs section feels cramped on mobile
```
