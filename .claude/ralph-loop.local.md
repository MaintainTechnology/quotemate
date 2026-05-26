---
active: true
iteration: 1
session_id: 00343382-cef6-4c2d-bcee-e9854eebdb71
max_iterations: 0
completion_promise: "All tests pass"
started_at: "2026-05-26T06:09:30Z"
---

Execute three workstreams for QuoteMate pricing data accuracy. PHASE C catalogue authoring: add new shared_assemblies rows. First a downlight new-install row at 1.5 to 2 hours per fitting. Second a smoke alarm first-install whole-house compliance row at 1.0 hours per alarm plus 0.5 base. Third where it makes sense an outdoor light new-circuit row and a ceiling fan new-wiring row. PHASE D engineering: add a row_assumptions jsonb column to shared_assemblies and tenant_custom_assemblies so new rows can carry structured rules such as switch_within_metres and max_storeys and roof_access_required. Also fix Install gas HWS auto-quote risk by setting always_inspection true on that row per the project memory project_plumbing_routing_rules where gas HWS equals inspection per AS NZS 5601. PHASE E spike: draft a one-page HTML proposal in public/docs/ for the trade-book-to-cookbook pipeline using mt-filestore-kb covering target document format extraction prompt schema sample extracted CSV output review UI tweaks and time cost estimate. Pair each migration with a runner script with pre-flight and post-verify safety gates following the migration 061 to 066 pattern. Run vitest after each phase. Completion: all SMS tests plus new tests pass.
