---
active: true
iteration: 1
session_id: 00343382-cef6-4c2d-bcee-e9854eebdb71
max_iterations: 0
completion_promise: "All tests pass"
started_at: "2026-05-27T02:05:29Z"
---

Build the quote display feature in three phases. Phase A is tenant-level itemised vs summary preference on pricing_book with a migration, dashboard pricing settings toggle, customer quote page renderer branch, SMS quote template summary mode, and tests. Phase B is per-quote display_mode override on quotes table with dashboard quote-detail UI toggle, API support, customer page falls back from quote.display_mode to pricing_book.quote_display, and tests. Phase C is customer-side expand/collapse component on the customer quote page with default state from A and B, plus tests. Run vitest after each phase. Apply all migrations to prod via the existing pre-flight plus post-verify runner pattern. Do not commit or push - leave changes in the working tree for user review.
