---
active: false
completed_at: "2026-06-12T08:40:00Z"
completion_note: "All tests pass — 2882 vitest green, next build green. Spec executed phases 1–4; committed aa81124 (+ phase 1–2 files swept into 4c899b4)."
iteration: 1
session_id: 6535e54c-2165-46fd-b9fa-c50414074505
max_iterations: 0
completion_promise: "All tests pass"
started_at: "2026-06-12T06:58:18Z"
---

Execute the approved spec at quotemate-automation/docs/superpowers/specs/2026-06-12-solar-premium-quote-design.md - the Solar Premium Quote upgrade. Read the spec fully first, and read quotemate-automation/AGENTS.md before writing any Next.js code. Work phase by phase per spec section 5: phase 1 Data layer - parse and persist solarPanels geometry, panel_size_m, per-plane panelsCount, carbonOffsetFactorKgPerMwh, wholeRoofStats cross-check guardrail, optional quarterly_bill_aud through schema, form, route, economics. Phase 2 Visuals - pure SVG layout-overlay.ts, string-overlay.ts, charts.ts in lib/solar shared by page and PDF. Phase 3 Financials and restructure - financial-summary.ts with NPV, ROI, IRR, 20-year projection, environmental section, compliance copy, 10-section reorder of the q/solar/token page and report-html.ts PDF. Phase 4 Pylon light - lib/pylon/client.ts, STC cross-check guardrail flag, tenant-flagged lead push behind PYLON_ENABLED env flag. Hard constraints: deterministic engine stays the source of truth for all dollar figures. Confirm gate unchanged - money sections only after confirmed_at. Graceful degradation per spec section 4.6 matrix. No DB migration. Unit tests for every new pure module and all existing suites stay green. Tests run from the quotemate-automation directory with npx vitest run.
