# Solar Panel & Skylight Re-Roof Detection — Spec

> Status: ready to build. Two phases. Phase 1 (surface-and-flag) ships first; Phase 2 (auto-priced solar allowance) follows.
> App lives in `quotemate-automation/`. All paths below are relative to that directory unless noted. Verify exact symbols/line numbers against the live code before editing — paths are from prior exploration and may have drifted.

## Objective

When a roof being re-roofed has existing solar panels (or skylights) on it, the quote must account for the cost of detaching and reinstating the panels, so the tradie isn't caught out on site. Today that cost is invisible: nothing in the quote surfaces detected solar or skylights, and the existing aerial solar detector's output is dashboard-only (never persisted, never quoted, never shown to the customer). This feature makes detected roof obstacles visible to the tradie (Phase 1) and, on confirmed re-roofs, automatically prices the solar removal/reinstatement allowance into the quote (Phase 2). It is for **roofing tradies** quoting re-roof jobs, and for the **customers** who receive the resulting quote.

## Context / background

- **Roofing pricing is deterministic, not LLM-driven.** It comes from `lib/roofing/pricing.ts` (`calculateRoofingPrice` / `priceMultiRoof`) as `$/m²` math. Roofing does **not** route through the electrical/plumbing estimator in `lib/estimate/*`, so the strict grounding validator does not apply to the roofing path — provided we keep solar pricing on the deterministic add-on path.
- **A solar detector already exists but is dashboard-only.** `lib/roofing/solar.ts` holds `buildSolarDetectPrompt` (Gemini vision over a satellite aerial), the `SolarDetection` type, `computeSolarAllowance`, `solarAllowanceConfigFromCard`, an `electrician_note` template, and `SOLAR_ALLOWANCE_DEFAULTS` ($1000 base + $700/array ex-GST). `app/api/roofing/detect-solar/route.ts` returns `{ ok, detection, allowance }`. The only consumer is `app/dashboard/roofing/_components/SolarCheck.tsx`. The allowance is **never persisted** to `roofing_measurements.quote`, **never** baked into the `MultiRoofQuote` tiers, and **never** rendered on `app/q/roof/[token]/page.tsx`. Skylights are not detected at all. Detection is currently scoped to the **centre building** of the aerial only.
- **The re-roof signal already exists:** `RoofJobIntent` enum in `lib/roofing/types.ts`, value `'full_reroof'`, stored in `roofing_measurements.structures[].inputs.intent`. `computeSolarAllowance` already gates on `applies = !lowConfidence && intent === 'full_reroof'`.
- **Customer quotes are HTML pages**, not PDFs — `app/q/roof/[token]/page.tsx`. There is no PDF anywhere in this app.
- **A separate solar-install job-type flow exists** (`lib/solar/*`, gated by `SOLAR_AUTO_RELEASE` in `lib/solar/release.ts`). That flow is about *installing* solar and is unrelated to this feature (solar as an *obstacle* on a re-roof). It must not be touched or wired into this path.
- **Customer photos** can be collected via the existing `/upload/[token]` flow; tradies can attach photos in the dashboard roofing measure flow.

## Requirements

### Detection (shared by both phases)

1. Detection produces a single merged `SolarDetection` result per job by combining: (a) the existing **Gemini-on-aerial** count and (b) a new **Anthropic-vision-on-photos** pass over available roof photos. When both sources are present, the merged result carries the higher-confidence count and records which source(s) contributed.
2. Photos for the Anthropic pass are taken from **both** sources when available: customer uploads (`/upload/[token]`) and tradie-attached dashboard photos. If neither is available, detection falls back to the aerial-only result.
3. Detection runs across **every measured structure** in the job (primary roof plus sheds/garages), not only the centre building. Each structure's detection is attributed to that structure.
4. Detection extends to **skylights** as well as solar panels: the `SolarDetection` type and `buildSolarDetectPrompt` (and the new Anthropic prompt) gain skylight fields (e.g. `skylight_count_estimate`) alongside solar fields.
5. Detection produces a confidence-aware, human-readable `summary_note` string per detected feature, e.g. `"Identified 2 solar panel arrays (high confidence)"` or `"What appears to be 1 skylight (low confidence — verify on site)"`. Low/uncertain detections must use hedged wording and a verify-on-site flag.
6. Detection degrades gracefully: if a vision call returns nothing or errors, the measurement/save flow still completes — detection never throws or blocks the quote.

### Phase 1 — Surface and flag (ships first)

7. The merged detection result and its `summary_note`(s) are surfaced to the **tradie** in the dashboard roofing flow (`app/dashboard/roofing/_components/SolarCheck.tsx` and wherever the measure/quote review lives), per structure.
8. Phase 1 makes **no** automatic price change to any tier, auto-adds **no** line, and triggers **no** quote downgrade. The tradie prices any solar/skylight work themselves via the existing "add line item" flow.
9. Whenever **solar** is detected, the existing `electrician_note` disclaimer (a licensed electrician must disconnect/reconnect the panels) is shown to **both** the tradie and on the customer-facing quote.
10. **Skylights are surface-only in both phases**: always detected and flagged to the tradie, but never auto-priced. The tradie adds any skylight line manually.
11. If the intake-structurer channel is used for the Anthropic pass, it must **not** add a new top-level optional field to `IntakeSchema` (it is at the 24-optional-field cap for `generateObject`). Reuse the existing `risks[]` array or `scope.description`. The prompt's strict-grounding rule (extract only what is visibly present, never infer) is preserved.

### Phase 2 — Auto-price solar removal/reinstatement (follows Phase 1)

12. On a job where `intent === 'full_reroof'` **and** solar is detected with **medium/high** confidence, a "Removal + reinstatement of solar panels" line is auto-added to the quote.
13. The line amount is computed by the existing `computeSolarAllowance`: **$1000 base + $700 per array** ex-GST (`SOLAR_ALLOWANCE_DEFAULTS`), honouring tenant overrides at `pricing_book.overlays.roofing_rate_card.{solar_detach_reinstate_base_ex_gst, solar_detach_reinstate_per_array_ex_gst}` via `solarAllowanceConfigFromCard`. Pricing is by **array count**, not panel count.
14. The auto-added line appears in **all three tiers** (Good, Better, Best).
15. GST: amount computed ex-GST; multiply by 1.1 only when the tenant is `gst_registered = true`, consistent with the rest of the roofing quote.
16. The allowance stays on the **deterministic roofing add-on path** — it is computed and persisted directly into the `MultiRoofQuote` / `roofing_measurements.quote`, and never routed through `lib/estimate/*`, so the grounding validator never sees it and the quote is never downgraded to the $99 inspection route.
17. The computed allowance is **persisted** at save time: `app/api/roofing/save/route.ts` threads the detection + allowance into the saved payload, and it is bundled into the `MultiRoofQuote` tiers (via `buildTierObjects` in `lib/roofing/save-as-quote-helpers.ts`).
18. The persisted allowance is **rendered** on the customer HTML quote page `app/q/roof/[token]/page.tsx` as a distinct line, e.g. `"Solar panel detach & reinstate · {N} arrays · ${amount}"`, accompanied by the electrician disclaimer.
19. On non-`full_reroof` intents (patch/repair/leak-trace/etc.) detected solar is still surfaced (Phase 1 behaviour) but **no charge** is auto-added (`applies = false`).
20. Low-confidence solar on a re-roof flags the tradie but does **not** auto-add the charge.

## Non-goals

- Phase 2 auto-pricing of **skylights** — skylights are surface-only in this version (requirement 10).
- The solar-**install** job-type flow (`lib/solar/*`, `SOLAR_AUTO_RELEASE`) — out of scope and untouched.
- Routing roofing quotes through the electrical/plumbing estimator (`lib/estimate/*`) or seeding solar assemblies into `shared_assemblies` — the deterministic add-on path is used instead.
- Actual scheduling/booking of an electrician, panel-disconnect workflow, or electrical compliance certificates — only the disclaimer line is in scope.
- Per-panel (vs per-array) pricing.
- Fine-tuning / training a vision model — "train the AI" here means prompt-engineering the vision step and extending the schema.

## Constraints

- **Stack:** Next.js 16 App Router, React 19. Read `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guide before writing Next code (Next 16 breaking changes).
- **No PDF:** the customer surface is the HTML page `app/q/roof/[token]/page.tsx`; the tradie surface is the dashboard. "Add to the PDF" from the original ask means these.
- **Grounding validator backstop:** any priced line that flows through `lib/estimate/*` must derive from a seeded, trade-scoped assembly or the **entire** quote downgrades to the $99 inspection route (`validateQuoteGrounding` in `lib/estimate/validate.ts`). This is avoided entirely by keeping solar pricing on the deterministic roofing path (requirement 16).
- **24-field schema cap:** `IntakeSchema` (`lib/intake/schema.ts`) is at exactly 24 optional fields; `generateObject` breaks if a new top-level optional field is added (requirement 11).
- **Multi-tenant:** honour tenant rate-card overrides and `gst_registered`; respect existing `tenant_id` scoping.
- **DB changes** (if any rate-card field is added): a new `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs`, applied to prod Supabase, keeping `sql/init.sql` representative. The existing `SOLAR_ALLOWANCE_DEFAULTS` + `roofing_rate_card` overlay already cover the chosen pricing model, so a migration may not be needed — confirm during build.
- **Roofing review posture:** roofing is a review-required override (per CLAUDE.md v10/v11) and does not auto-release. The auto-added line must respect roofing's forced-confirm posture; do not wire `SOLAR_AUTO_RELEASE` into this path.
- Changes are surgical and scoped to this feature; no unrelated refactors; match surrounding conventions.

## Edge cases to handle

- **No photos available (aerial only)** → detection falls back to the aerial result; still surfaces a note if solar/skylights are seen.
- **No aerial available (photos only)** → detection runs on photos alone; merged result reflects photo source only.
- **Aerial and photo counts disagree** → take the higher-confidence count, record both contributing sources, and surface the uncertainty in the note (hedged wording).
- **Low / uncertain detection** → hedged "what appears to be…" copy + verify-on-site flag; never auto-price (Phase 2 charge withheld).
- **Solar detected on a non-re-roof job** (patch/repair) → surface the note, no auto-charge.
- **Solar detected on a re-roof but low confidence** → flag the tradie, no auto-charge.
- **Skylight detected (any job)** → surface note only, never auto-priced.
- **Multiple structures, solar on a secondary shed/garage** → detected and attributed to that structure (all-structures requirement); allowance reflects total arrays across structures.
- **Vision call errors or times out** → caught; measurement/save completes; detection treated as "none found" without blocking.
- **Tenant has rate-card overrides** → allowance uses the override values, not the defaults.
- **Tenant not GST-registered** → allowance shown ex-GST (no ×1.1).
- **Detection re-run after a quote was already saved** → persisted allowance and rendered line update consistently on re-save (no duplicate solar lines).

## Definition of done

### Phase 1
- [ ] Merged detection (Gemini aerial + Anthropic photos) returns solar **and** skylight findings with per-structure attribution across all measured structures.
- [ ] Photos are sourced from both customer uploads and tradie dashboard attachments, with graceful aerial-only fallback.
- [ ] A confidence-aware `summary_note` is produced and **visible to the tradie** in the dashboard (e.g. `"Identified 2 solar panel arrays (high confidence)"`).
- [ ] When solar is detected, the electrician disclaimer is shown to the tradie and on the customer quote.
- [ ] No tier price changes, no auto-added line, no quote downgrade, no change to existing quote numbers in Phase 1.
- [ ] Detection failure does not break the measurement/save flow (verified by simulating a vision error).
- [ ] If the intake channel is touched, `IntakeSchema` stays at ≤24 optional fields and `generateObject` still succeeds.
- [ ] Skylights are surfaced but never auto-priced.

### Phase 2
- [ ] On `intent === 'full_reroof'` + medium/high-confidence solar, a "Removal + reinstatement of solar panels" line is auto-added to **all three** tiers.
- [ ] The amount equals `computeSolarAllowance` output ($1000 base + $700/array ex-GST), honouring `roofing_rate_card` overrides and falling back to `SOLAR_ALLOWANCE_DEFAULTS`.
- [ ] GST applied (×1.1) only when the tenant is GST-registered.
- [ ] The allowance is **persisted** to `roofing_measurements.quote` and **renders** as a distinct line on `app/q/roof/[token]/page.tsx`, with the electrician disclaimer.
- [ ] On non-`full_reroof` intents, detected solar is surfaced but no charge is added.
- [ ] Low-confidence solar on a re-roof flags the tradie but adds no charge.
- [ ] The solar line never routes through `lib/estimate/*`; no quote is downgraded to the $99 inspection route by this feature.
- [ ] Re-saving a measurement does not produce duplicate solar lines.
- [ ] `SOLAR_AUTO_RELEASE` / `lib/solar/*` is untouched.

## Open questions

- **Skylight rate-card / Phase 3:** skylights are surface-only now. If they later need auto-pricing (reflash/reinstate), that's a separate rate-card entry and a future phase — confirm there's no near-term need.
- **Anthropic-on-photos cost/latency:** running an extra vision pass per structure on a fast-ack webhook path may need `maxDuration` headroom (Vercel Hobby 10s limit). Confirm where the detection runs (sync at measure-time vs deferred in `after()`).
- **Merge tie-breaking:** confirm the exact rule when aerial and photo counts differ but have equal confidence (current spec: surface uncertainty, prefer the higher count — confirm with stakeholder if a more conservative "lower count" default is preferred for pricing).
- **Customer-photo availability for roofing:** roofing jobs don't currently request customer photos via `/upload/[token]` — confirm whether that request step needs to be added to the roofing flow, or whether tradie-attached photos are the realistic primary source in v1.
