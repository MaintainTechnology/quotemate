# SMS AI Receptionist — Inspection Root-Cause Inventory (R1–R4)

> Phase 0 deliverable for [specs/sms-quote-accuracy-revamp.md](../../../specs/sms-quote-accuracy-revamp.md).
> Produced 2026-06-18 from a 6-agent code-and-SQL map of the live pipeline + a read-only prod DB audit.
> Goal: **quote everything possible**; keep the $99 inspection only where a price genuinely can't be grounded.
> Full machine output: workflow `wf_9ca0c01c-693` (90 findings: 54 avoidable / 9 legitimate / 27 unclear).

## How a job becomes a $99 inspection (the real model)

`decideRouting()` (`lib/routing/decide.ts`) is a pass-through: it returns `inspection_required` **iff** `intake.inspection_required || quote.needs_inspection`, else `tradie_review`. (`auto_send` is dead — `V3_AUTOSEND_ENABLED=false` — so `pricing_book.review_policy`/`review_threshold_inc_gst` are largely inert in v1.) All real downgrade logic is in the two upstream signals:

**`quote.needs_inspection` becomes true via:**
1. **Grounding validator** rejects *any single line* in *any tier* → `run.ts:786-811` nulls **all three tiers** (dominant code-side cause).
2. Opus self-reports `needs_inspection:true` (`run.ts:261`).
3. **WP1 pricing_book resolution failure** — no tenant `pricing_book` row resolves → inspection-only draft (`app/api/estimate/draft/route.ts:201-222`).
4. `always_inspection=true` rows filtered out of candidates (`tools.ts`) → Opus can't ground them.

**`intake.inspection_required` becomes true via:**
1. Intake structurer prompt rules (`lib/intake/structure.ts`) — blanket job_type classes.
2. SMS dialog returning `escalate_inspection` (`lib/sms/dialog.ts`) — universal + per-job triggers, and **Rule 4/6 "job type outside the hardcoded easy lists."**
3. Universal/row-level trigger keyword lists (`lib/sms/assumptions.ts`). NB `inspection_triggers` *columns* are LLM-prompt-only, never matched in code.

**Key facts that shape fixes:**
- Disabled **shared** assemblies still ground (validator/Opus load without the enabled filter; only `always_inspection` + trade scope exclude). Only `tenant_custom_assemblies.enabled=false` excludes (a deactivation race).
- `intake.confidence=LOW` does **not** directly force inspection, but the **quality gate** (`quality.ts`) blocks the quote entirely (recovery SMS) when LOW + missing name OR scope < 10 chars.
- Intake `job_type` ≠ assembly `category` naming (e.g. `downlights`/`downlight`, `power_points`/`gpo`, `blocked_drain`/`drain`, `gas_fitting`/`gas`). The bridge is `categorise()` + `JOB_TYPE_CATEGORY` maps, not exact equality.

## Avoidable themes → fix plan (priority order)

| # | Theme | Findings | Layer | Planned fix |
|---|---|---|---|---|
| T1 | **All-or-nothing tier nulling**: one ungrounded line in any tier nulls all 3 → full inspection | A11, U1, U25, L2 | flow | Per-tier salvage: ship the tier(s) that fully ground, drop only the failing tier; inspection only if **all** tiers fail. Each shipped tier still 100% grounded (integrity preserved). Gate behind `SMS_PER_TIER_SALVAGE` (default on). |
| T2 | **False grounding rejection — category**: a correctly-priced line whose category isn't in the closed regex/data set fails the loose-path category-overlap check | A1, A12, A20, A48 | both | (a) Expand `categorise()` keyword coverage to all live job types/categories; (b) backfill `category` on every `shared_*`/`tenant_*` row (additive fold-in guarantees the tag); (c) strengthen prompts to always emit `source=material:<id>`/`assembly:<id>` (strict UUID path bypasses category match). **Not** weakening: a line still must price-match a real candidate row. |
| T3 | **Dialog over-escalation**: any job_type outside hardcoded "easy" lists → $99; over-broad universal triggers | A36, A43, A52, A53 | flow | Broaden the quotable job-type scope to match the live enabled catalogue; trim over-broad universal triggers (keep genuine safety ones). |
| T4 | **Confidence forced LOW by non-pricing fields** → quality gate blocks quote | A18, A28, A29, A30, A32 | flow | Confidence rubric must not force LOW for missing `caller.name`/`suburb` (CRM, not pricing); deterministic recompute after customer backfill so a rescued intake isn't stuck LOW. |
| T5 | **Grounding band tightness — markup/unit/min-labour** | A2, A4, A5, A8, A13, A21, A47, A51 | both | Ensure `pricing_book.default_markup_pct` reflects real working markup so Opus lands in-band; ensure `after_hours_multiplier` set; recognise valid units; keep min-labour floor mitigation ordering correct. |
| T6 | **Migration-069 new-install inspection_triggers** too aggressive (raked/two-storey/no-roof self-reported on routine jobs) | A49, U21 | both | Make the dialog ask the disambiguating question (storey/ceiling/access) before escalation; narrow trigger phrasing in prompts. |
| T7 | **WP5 customer-supply** with no install-only price → inspection | A24, A50 | both | Provide install-only price path so "I'll supply the fixture" still quotes. |
| T8 | **pricing_book data hygiene** | A23 + audit | data | Fix the suspicious `min_labour_hours == after_hours_multiplier == 1.70` row; ensure every active tenant resolves a pricing_book row; surface (don't silently change) outliers (Oakcrest $200/hr + 42.8%, Atomic 14%) for owner sign-off. |

## Legitimate inspections (keep — do NOT make these quote)

- **L1/L7** `always_inspection=true` rows excluded from lookups (currently only plumbing **gas HWS**).
- **L3** Gas hot_water keyword override → inspection (AS/NZS 5601).
- **L4** Emergency/safety keywords (gas leak, burst pipe, sewage, sparks) → emergency + inspection.
- **L5** Wrong-trade request to a single-trade tenant → polite end (no quote).
- **L6** Tradie-declined (toggled-off) services → polite decline.
- **L8** GPO wet-area-clearance unmet → inspection (electrical safety).
- **L9** Plumbing `burst_pipe`/`bathroom_renovation`/gas-leak → inspection.

These stay inspection-routed; the publish gate's price-hiding for them is preserved.

## Verification approach (R14/R15)

Prod can't be written by the build; dev DB is an older snapshot. So:
- **R15 (durable):** vitest unit tests per fix + extend `scripts/test-sms-parity.mjs`.
- **R14 (real-data):** read-only dry-run harness that loads prod data, applies the proposed corrections in-memory, and re-runs the deterministic matching/grounding functions on the representative job set (no prod writes).
