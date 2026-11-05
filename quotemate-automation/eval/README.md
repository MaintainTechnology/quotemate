# Rank 1 quote evaluation gate

The evaluation runner measures captured estimator output against independently graded holdouts. It does not send SMS, create quotes, call a model, read a live database, or infer ground truth. The checked-in five cases are ungraded placeholders; their validation is not an accuracy result. Production promotion remains blocked until the authorised ground truth and corresponding estimator captures exist.

**System-wide policy, trade-specific evidence:** Rank 1 now applies to all accounts, not a tenant allowlist. New trade releases declare `rank1Required:true` and `rank1Scope:all_accounts`. The current executable source-bound replay adapter measures Electrical Quote Core only. Plumbing, roofing, painting and solar must obtain their own real-calculator adapters and independently graded data before promotion; the verifier rejects using Electrical evidence to certify them. This restriction is an evaluation gap, not permission to fall back to model pricing or a claim that other trade calculators are absent. Controlled readiness tenants are test contexts only.

## Commands

Run from `quotemate-automation`. Paths are resolved relative to that directory. All commands below run locally unless an explicitly selected adapter performs external work.

```powershell
# Structure check only: currently succeeds, with accuracy_measured:false.
node scripts/eval-quotes.mjs

# Production gate: currently fails (zero graded cases; no estimator outputs).
node scripts/eval-quotes.mjs --production --trade electrical

# Offline replay of an authorised baseline capture.
node scripts/eval-quotes.mjs --pairs eval/private/electrical-holdouts.json --actuals eval/private/baseline-capture.json --trade electrical --report eval/private/baseline-report.json

# Candidate must pass and cannot regress any previously passing dimension.
node scripts/eval-quotes.mjs --pairs eval/private/electrical-holdouts.json --actuals eval/private/candidate-capture.json --trade electrical --baseline eval/private/baseline-report.json --production --report eval/private/candidate-report.json

# Unit tests use synthetic arithmetic fixtures, never production evidence.
node --test scripts/eval-quotes.test.mjs
```

Create the private evidence directory through the team's authorised storage process; it is not created by the runner. Keep customer details, supplier documents and tenant snapshots outside public/versioned examples. Output files use exclusive creation: use a new filename for each run rather than overwriting prior evidence. No `--live` compatibility flag exists: it used to refer to an unwired placeholder and is now rejected.

## Prepare genuine ground truth

1. Select at least 100 distinct, held-out Electrical intake/quote cases for Electrical production promotion. `--trade electrical` prevents unrelated trade cases from meeting that count. Include normal jobs, missing scope, corrections, `supply_only`, `install_only`, `supply_and_install`, unsuitable products and cases requiring inspection. A set of duplicate intake/context records is rejected. Counting alone does not establish representative coverage; a trade owner must review the distribution.
2. Freeze each case's approved pricing-book version, catalogue identities, tenant, tax status and relevant intake facts. A tradie must independently verify materials, quantities, labour and target tier totals from approved source records. Accepted old quotes alone do not establish current prices.
3. Record the grader, timestamp and a restricted source reference. Mark a case `needs_grading:false` only after this work. Never generate expected answers using the model/Quote Core under evaluation or copy actual outputs into expected fields. Keep holdouts out of prompts, retrieval and tuning data.
4. Maintain the same frozen dataset for baseline and candidate; the runner fingerprints its canonical JSON. If price-book truth changes, have the tradie regrade and capture a new baseline for the new dataset.
5. Capture the estimator result from the exact candidate build/configuration in isolated evaluation. Record its source revision and a SHA-256 fingerprint of the model, prompt, feature configuration and immutable price-book/snapshot inputs. Evidence review must verify these references; JSON metadata is not a digital signature or proof that a person really graded a case.

The dataset root is `{ "schema_version": 2, "band_pct": 15, "pairs": [...] }`. The price/labour band is an integer from 0 to 15; use 0 when exact expected-price matching is required. Each graded pair has this structure (angle-bracket values must be replaced with authorised data; this is not a runnable fixture):

```text
{
  id: <unique case ID>,
  needs_grading: false,
  provenance: {
    classification: "tradie_verified",
    holdout: true,
    graded_by: <authorised reviewer identifier>,
    graded_at: <ISO timestamp>,
    source_ref: <restricted evidence reference>
  },
  intake: { trade: "electrical", job_type: <job type>, scope: <observed intake facts> },
  context: {
    tenant_id: <tenant UUID>,
    pricing_book_version_id: <approved immutable version UUID>,
    gst_rate_bps: <1000 for 10 percent; 0 only when the approved tax status requires it>,
    ...<read-only estimator inputs, e.g. an approved pricing snapshot>
  },
  expected: {
    route: "awaiting_tradie_approval",
    good: {
      total_ex_gst_cents: <nonnegative safe integer>,
      labour_minutes: <nonnegative safe integer>,
      material_catalogue_ids: [<qualified authoritative material IDs>],
      line_items: [{ catalogue_item_id: <qualified catalogue ID>, quantity_milli: <positive safe integer>, unit_price_ex_gst_cents: <approved final sell price in integer cents> }]
    },
    better: <same schema>,
    best: <same schema>
  }
}
```

For `review_required`, `inspection_required` and `clarification_required`, all three expected tiers are null. These cases count toward route/safety coverage, with price/material/labour dimensions explicitly not applicable. A production dataset containing no priced case is rejected. A priced case must name all three tier fields and include at least one priced tier; use explicit null for tiers deliberately removed by a confirmed product choice. An unexpected additional tier or a missing offered tier fails. Do not silently fill missing tiers.

`quantity_milli` uses thousandths of a unit: one item = 1000 and 1.5 hours = 1500. Use catalogue-qualified IDs (`shared:...`, `tenant:...`, `labour:...`) to keep different record namespaces distinct. Labour-only cases can have an empty material list but still require priced labour lines. Expected BOM quantities are summed by ID and compared exactly; missing, additional or changed quantities fail. Approved final sell unit prices are also compared exactly, so cancelling line-price errors or a made-up price inside the total estimate band cannot pass.

## Actual output and adapters

A capture file has `{ schema_version: 2, dataset_sha256, run, results: [{ id, actual }] }`. Compute `dataset_sha256` by importing `digest(fixture)` from `scripts/eval-quotes.mjs`; this sorts object keys, preserving array order. `run` contains:

```text
{
  kind: "estimator_capture",
  source_revision: <exact build/source identity>,
  config_sha256: <64 lowercase hexadecimal characters>,
  captured_at: <ISO timestamp>
}
```

Each `actual` has `tenant_id`, `pricing_book_version_id`, `customer_release_allowed:false`, an explicit `route`, and `good/better/best`. Priced tiers have:

| Field | Contract |
| --- | --- |
| `total_ex_gst_cents`, `gst_cents`, `total_inc_gst_cents` | Nonnegative safe integer cents from the estimator trace |
| `gst_rate_bps` | Must match the approved context tax rate |
| `labour_minutes` | Nonnegative safe integer minutes |
| `material_catalogue_ids` | Unique authoritative material IDs |
| `line_items` | Nonempty array with `catalogue_item_id`, `quantity_milli`, `unit_price_ex_gst_cents`, `line_total_ex_gst_cents` |

Actual line unit prices are final sell prices after deterministic pricing rules; include every charged component explicitly. The runner independently checks each rounded line, sum of lines, tax and inclusive total with integer/BigInt arithmetic. It must never repair inconsistent captured output to make the test pass. A mapper must preserve authoritative calculated totals and disclose any unit conversion; do not use a formatter that invents a balanced quote from model text. The rounding contract is half-up per line and half-up GST on the subtotal. If a candidate intentionally changes this policy, update approved ground truth and the contract together after review.

Normalize priced runtime draft states to `awaiting_tradie_approval`, without changing their price or release status. An unpriced internal data/authority hold is `review_required`, not a paid inspection or a customer clarification. Review/inspection/clarification captures are unpriced and still cannot release a quote. `auto_send`, a missing release flag, wrong tenant or stale version fail.

An alternative to replay is an explicit ES-module adapter:

```text
export evaluationContract = { effects: "read_only", environment: "isolated_evaluation" }
export run = <capture metadata above>
export async function estimate({ id, intake, context }) -> actual
```

```powershell
node scripts/eval-quotes.mjs --pairs eval/private/electrical-holdouts.json --adapter eval/private/candidate-adapter.mjs --allow-adapter --trade electrical --capture eval/private/candidate-capture.json --report eval/private/candidate-report.json
```

The adapter receives a deep copy of only the case ID, intake and context, never expected answers/provenance. A rejected promise fails the run. Review adapter code before opting in: the contract is an assertion, **not an OS sandbox**. Run only with isolated snapshots/staging credentials and no SMS or customer release capability. The existing application estimator can emit trace writes and has provider/database dependencies; do not import it with production credentials merely to produce an evaluation capture. An approved adapter can invoke a pure Quote Core directly or call an isolated estimator runner and map its calculation trace without sending messages or persisting customer quotes.

### Built-in actual Rank 1 replay adapter

`scripts/eval-rank1-adapter.ts` invokes the same `buildRank1Estimation` used by the Rank 1 runtime. It supplies a frozen recorded recipe as its loader and imports no provider/database/SMS client. It preserves calculation trace cents rather than recomputing a plausible total from draft prose.

Each authorised case must also contain `intake.tenant_id`, `context.pricing_book` (the frozen book row), and `context.resolved_recipe` in the exported `Rank1LoadedInputs` shape from `lib/estimate/rank1.ts`. These records must be approved source snapshots for the specified tenant/version, including recipe row IDs, active catalogue, tier ladder, task rows, hourly rate, markup and labour policy. An unavailable recipe is represented explicitly as `{ input:null, reason:<recorded reason> }` for an expected review case. The adapter does not access current production prices to fill missing fields.

```powershell
# A TS runner is required for the built-in adapter. No environment file or keys.
node --import tsx scripts/eval-quotes.mjs --pairs eval/private/electrical-holdouts.json --adapter scripts/eval-rank1-adapter.ts --allow-adapter --trade electrical --capture eval/private/candidate-capture.json --production --report eval/private/candidate-report.json

node node_modules/vitest/vitest.mjs run tests/eval-rank1-adapter.test.ts
```

`run.source_revision` is `source-sha256:<hash>` over the exact local runtime dependency contents, evaluation mapper, package manifest, lockfile and TypeScript alias configuration. `run.source_files` records the constituent fingerprints. It does not claim an uncommitted worktree equals clean Git HEAD. The dataset fingerprint separately binds every frozen source input and graded expectation. Capture again if any implementation, configuration, dependency or input changes.

The built-in mapper emits material IDs as `tenant:<sourceId>` and labour IDs as `labour:<pricing_book:VERSION:hourly_rate>`. Use these exact identities in independently graded expectations. It fails on quantities not exactly representable as `quantity_milli` or whole labour minutes; it never rounds them to pass. If authorised recipes require finer precision, extend the evaluation schema/mapper and tests before promotion. The production Quote Core supports finer source precision, so a failed capture is an evaluation-contract limitation, not permission to change the approved recipe.

This adapter's evidence scope is `deterministic_quote_core_replay`. Its `customer_release_allowed:false` reflects the pure builder's lack of any send/release capability; it is not a substitute for testing the authenticated approval endpoint and customer release outbox. Its synthetic tests prove contract behaviour only and are never persisted as graded customer holdouts.

## Acceptance and limits

`--production` exits nonzero for fewer than 100 selected graded cases, any selected ungraded case, missing/duplicate/stale output, synthetic capture metadata, invalid provenance, missing priced coverage, any rubric failure or any baseline regression. Validation-only exit 0 is accompanied by `mode:validation_only`, `accuracy_measured:false` and `production_gate:false`; it must never be consumed as deployment acceptance. Promotion tooling should require `production_gate:true`, `passed:true`, the intended trade, source revision and dataset/artifact/config hashes.

The receptionist promotion verifier uses `scripts/receptionist-rank1-gate.mjs` to re-score the **raw** fixture and capture, bind their runtime source/configuration hashes to the exported candidate, and repeat the actual pure Rank 1 estimator in an isolated Node process. A stored `passed:true` report alone cannot authorise promotion; a self-consistent captured answer that differs from actual replay also fails. Human grading/source approval still requires real evidence review: no program can establish that a grader entry was truthful merely from its JSON fields.

```powershell
node scripts/verify-receptionist-release.mjs <built-candidate-directory> --rank1-fixture=eval/private/electrical-holdouts.json --rank1-actuals=eval/private/candidate-capture.json
```

This runs after the candidate's dependency, build, schema and platform source checks. It preserves the 100-case requirement and owner approval policy. The replay process performs no writes or provider calls; it has a bounded 60-second runtime and rejects unsupported/lossy input mappings. The capture must come from the same Node version and source/dependency fingerprints as the verification process.

The ten dimensions cover price band, exact catalogue selection/BOM quantities, approved unit prices, tier order, labour band, route, exact money, tenant/version and mandatory approval. A band can tolerate a graded estimate difference; it never tolerates arithmetic errors, invented materials or release-policy violations. Missing actual values fail rather than being skipped. Report rows retain case IDs and job types for investigation; aggregate counts distinguish failures from explicitly inapplicable dimensions.

This gate proves neither a natural SMS conversation nor carrier delivery. The separate receptionist regression suite must still test customer corrections, context across turns, clarifying questions, prompt injection, worker restart, duplicate webhooks, durable outbox and delivery callbacks. Production promotion also requires the platform's artifact/schema/readiness gates and authenticated tradie approval. Passing arithmetic unit tests or synthetic captures cannot substitute for 100 independently graded holdouts.
