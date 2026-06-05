---
active: true
iteration: 1
session_id: b50f49fe-9fee-417f-a37d-8a841e25e7b6
max_iterations: 0
completion_promise: "All tests pass"
started_at: "2026-06-05T08:25:14Z"
---

Build multi-brand F45 and Anytime Fitness tabs for the QuoteMate signage compliance dashboard. Make brand a UI tab that scopes studios sweeps audit queue and shots, each tab using its own rules shots and Gemini file store. Add a brand_slug column to studios signage_sweeps signage_requests and signage_assessments via a new migration applied to prod. Resolve brand from the request not the org so the assessment uses the right file store. Fix the manage-studio bug where region matching is case sensitive so a studio saved as Au-Qld never matched a sweep filter AU-QLD by making region matching case insensitive and matching state too. Remove the dummy test studios and test sweeps for a clean slate via a cleanup script, keep orgs brands and rules, deactivate the stray gelatissimo brand. Add vitest unit tests for the region matching brand store resolution and brand param validation. Run vitest and tsc and make all tests pass with no type errors. Commit directly to main with no branches and push. Read AGENTS.md and the Next.js 16 docs before writing code.
