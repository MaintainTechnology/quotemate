---
active: true
iteration: 1
session_id: 0b7f7b5b-aff3-4087-a117-58f9612e47fa
max_iterations: 40
completion_promise: "All-tests-pass"
started_at: "2026-05-22T05:06:32Z"
---

Improve QuoteMate AI image-generation accuracy in the quotemate-automation lib preview folder. Five work items. One, promote and prune the V2 Gemini prompt to a tight 400 to 600 word instruction set removing text-LLM cargo-culting. Two, build an expanded verify-to-retry loop with a structured JSON judge checking count, product, positioning and existing-fixture removal. Three, add two-pass editing for replacement jobs. Four, pass imageConfig aspect ratio derived from the source photo. Five, audit product-photo data coverage. Keep all changes in-repo and async. All vitest tests must pass before completion.
