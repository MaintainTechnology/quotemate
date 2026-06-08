# Signage two-stage photo assessment — design

> 2026-06-08 · Status: approved, building. Supersedes the "KB caution-only supplement"
> behaviour shipped in migration 094 / `lib/signage/kb-supplement.ts`.

## Goal

Make signage photo assessment a **two-step check** that compiles a final verdict from
both sources:

1. **Step 1 — DB rule-check** (exists today): Claude vision scores each photo against the
   brand's Supabase `signage_rules`, then the grounding backstop (`validate-verdicts.ts`)
   produces one grounded verdict per rule.
2. **Step 2 — file-store cross-check** (new): the brand's Gemini File Search store(s)
   (`brands.kb_store_ids`) are consulted to **supplement or correct** Step 1, and may also
   surface **new** brand-standard issues not in the DB rule set.
3. **Merge** (new, pure/deterministic): the two stages are compiled into the final
   per-rule verdict + overall pass/fix/review.

## Decisions (from brainstorming, 2026-06-08)

- **Conflict authority — conflicts route to HQ review.** Step 2 can challenge Step 1 in
  both directions, but any disagreement on a rule makes that rule's final verdict
  `needs_review`. **No machine ever auto-certifies a pass** (the liability shield; the
  product is an automated *pre-check*, not HQ approval).
- **Step 2 scope — re-judge DB rules + surface new issues.** Step-2-only findings have no
  DB rule behind them, so they route to HQ review (advisory group).
- **Surfacing — franchisee gets a sourced report.** The franchisee report shows the final
  per-item state plus a provenance note + brand citation where Step 2 was involved, and
  lists new advisory findings in their own group. HQ always stores the full two-stage
  breakdown.
- **Step 2 mechanism — passage-retrieve then re-look at the photo (Approach 1b).** The
  `/v1/search` API is text-only, so a text-only Step 2 would merely echo Step 1. Instead
  Step 2 (a) retrieves the brand-standard passages from the store(s) via `/v1/search`,
  then (b) makes a fresh Claude **vision** call that looks at the actual photo with those
  passages + the in-scope rules, returning structured per-rule verdicts + new findings.

## Merge truth table

Per rule: `s1` = grounded Step-1 verdict (always present), `kb` = Step-2 verdict (may be
absent / cannot_determine when Step 2 abstained, was degraded, or didn't cover the rule).

| s1 (DB) | kb (file store) | final | provenance |
|---|---|---|---|
| compliant | compliant | compliant | agreed |
| compliant | absent / cannot_determine | compliant | db_only |
| compliant | non_compliant | needs_review | conflict (catches false pass) |
| non_compliant | non_compliant | non_compliant (fix) | agreed |
| non_compliant | absent / cannot_determine | non_compliant (fix) | db_only |
| non_compliant | compliant | needs_review | conflict |
| cannot_determine | non_compliant | needs_review | kb_only |
| cannot_determine | compliant | needs_review | kb_only (no solo pass) |
| (new finding, no rule) | non_compliant | needs_review (advisory) | kb_only |

Invariants:
- The only path to a green **pass** is `s1 compliant AND kb does not object` (kb compliant,
  absent, or cannot_determine). Step 2 only downgrades a pass when it *affirmatively*
  says non_compliant.
- The only path to **fix** is `s1 non_compliant AND kb does not dispute it`.
- Empty rule set → `needs_review` (preserve the Step-1 "never a vacuous pass" guard).
- Advisory findings push overall to at least `needs_review` and count as review.

## Components

New / changed modules (all pure cores + thin IO, mirroring the existing pipeline):

- `lib/signage/types.ts` (MODIFY) — add `KbRuleVerdict`, `AdvisoryFinding`,
  `ProvenanceStage = 'agreed'|'conflict'|'db_only'|'kb_only'`, `RuleProvenance`,
  `TwoStageDetail`, and report-item extensions (`note`, `kb_citation`).
- `lib/signage/merge.ts` (NEW, pure) — `mergeRuleVerdicts(rules, step1, kbVerdicts,
  advisory)` → `{ verdicts, provenance, advisory, overall, counts }`. The truth table.
  Calling it with empty `kbVerdicts`+`advisory` is the identity over Step 1 (single code
  path for two-stage-disabled).
- `lib/signage/kb-assess.ts` (NEW) — Step 2: pure `buildRetrievalQuery`,
  `buildKbVisionPrompt`, `parseKbAssessment`; thin IO `retrievePassages` (wraps `kbSearch`
  per store), `assessShotAgainstStores` (retrieve + one Claude vision call), and
  `runKbStage` (loops submitted shots, aggregates `kbVerdicts` + `advisory`, never throws,
  sets `degraded` on failure). Reuses `kbStoresForBrand` from `kb-supplement.ts`.
- `lib/signage/run.ts` (MODIFY) — replace the caution-only `kbSupplement` block with:
  Step 1 → `runKbStage` (gated by `twoStageEnabled()` + brand has stores + keys present) →
  `mergeRuleVerdicts` → persist merged `verdicts`/`overall`/`counts` + `two_stage` jsonb.
- `lib/signage/compose-report.ts` (MODIFY) — accept `{ provenance, advisory }`; attach
  provenance note + citation per item; append an advisory group; counts include advisory
  as review.
- `app/api/signage/request/[token]/route.ts` (MODIFY) — GET loads `two_stage`, passes
  provenance + advisory to `composeReport`.
- `app/studio/[token]/report/page.tsx` (MODIFY) — render the per-item provenance note +
  citation; the advisory group renders via the generic group list.
- `app/api/signage/assessment/[id]/route.ts` (MODIFY) — return provenance per verdict +
  advisory for the HQ panel.
- `app/dashboard/signage/queue/page.tsx` (MODIFY) — show a stage badge + kb note per
  verdict and an advisory section.
- `app/api/signage/audit/route.ts` (MODIFY) — same two-stage upgrade for the instant
  ad-hoc audit (not persisted).
- `sql/migrations/096_signage_two_stage.sql` + `scripts/run-migration-096.mjs` (NEW) —
  `signage_assessments.two_stage jsonb` (additive, idempotent), then `notify pgrst`.

## Data model

`signage_assessments`:
- `verdicts` jsonb — now the **merged** authoritative `RuleVerdict[]` (was Step-1 grounded).
- `two_stage` jsonb (NEW) — `{ step1: RuleVerdict[], kb: KbRuleVerdict[],
  provenance: RuleProvenance[], advisory: AdvisoryFinding[], stores: string[],
  kb_degraded: boolean }`.
- `kb_supplement` (migration 094) — left in place, no longer written by `run.ts`.

## Config / gating

- `twoStageEnabled()` = `process.env.SIGNAGE_TWO_STAGE !== '0'` — **default ON**, kill
  switch `SIGNAGE_TWO_STAGE=0`. (Replaces the old opt-in `SIGNAGE_KB_SUPPLEMENT=1`, which
  was never set, so Step 2 had never actually run.)
- Step 2 runs only when: enabled **and** the brand has `kb_store_ids` **and**
  `ANTHROPIC_API_KEY` + KB config are present. Otherwise the merge runs Step-1-only.

## Error handling

- Step 2 is best-effort and never throws. A KB outage / vision failure / missing keys →
  `kbVerdicts = []`, `advisory = []`, `kb_degraded = true`; the merge degrades to
  Step-1-only (does **not** block franchisees on infra; `kb_degraded` flags it for HQ).
- Step 1 is unchanged and remains the grounded, confidence-gated source of truth.

## Dependency / out of scope

- This design assumes the brand **has DB rules** (Step 1). Anytime Fitness currently has
  **0** `signage_rules`; it still needs `scripts/onboard-anytime-rules.ts --apply` run
  before either stage produces a report. That onboarding is tracked separately.

## Testing

- `merge.test.ts` — exhaustive truth-table cases incl. empty-rule-set, advisory, identity
  with empty kb.
- `kb-assess.test.ts` — `parseKbAssessment` tolerant JSON; `buildKbVisionPrompt` /
  `buildRetrievalQuery` content; `retrievePassages` + `runKbStage` with an injected fetch
  mock (never-throws / degraded paths). Port the `kbStoresForBrand` cases.
- `compose-report.test.ts` — provenance notes + advisory group + counts.
- `npx vitest run` + `npx tsc --noEmit` green before done.
