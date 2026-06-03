I now have the complete, exact pattern set. Here is the design.

---

# F45 Signage Compliance — Feature Design

A photo-driven studio-signage compliance assistant, built by mirroring QuoteMate's roofing tool 1:1. A franchisee texts/uploads guided studio photos; a Claude-vision pass scores each photo against a versioned, PDF-ingested F45 rules registry; a `validate.ts`-style backstop forces any low-confidence/ungrounded verdict to **human review required** rather than a false pass/fail; the franchisee gets a per-item pass/fail report and HQ gets a review queue. A **tenant = an F45 studio/franchisee** (same `tenant_id` scoping as roofing).

Throughout: pure decision/parse/prompt modules (unit-testable, never throw on operational error) + thin I/O routes. Migrations start at **087** (085 is the highest applied roofing migration, 086 follows).

---

## 0. The load-bearing insight that shapes everything

The supplied rule corpus is **not** uniformly photo-checkable. Each rule already carries two governing tags that map directly onto QuoteMate's existing grounding philosophy:

- **applicability** — `auto_vision` | `needs_metadata_or_context` | `needs_scale_reference` | `human_review_only`
- **confidence** — `high` | `medium` | `low`

Of the ~150 sample rules, only a minority (the `auto_vision/high` set: `wall-logo-required`, `palette-two-grays-plus-red-accent`, `workout-wall-stacking-order`, `racing-stripe-runs-all-exterior-windows`, `v-design-mandatory`, etc.) can ever return a confident machine verdict. Everything tagged `human_review_only` (legal/breach determinations, professional-installer checks) or `needs_metadata_or_context` (exact paint SKUs, HQ approval records, landlord letters) **must** route to human review by design — the vision model is explicitly forbidden from deciding them. This is the *exact same shape* as `validate.ts`: a deterministic backstop converts anything the model can't ground into the safe fallback. In roofing the safe fallback is **"$99 inspection"**; here it is **"human review required."**

That mapping is the spine of the whole tool, so it appears in every section below.

---

## 1. Rule registry / ingestion

**Mirror:** `lib/admin-loader/trade-book-extract.ts` + `trade-book-prompt.ts` → `import_staged_rows` staging→approve (migration 070), and the migration mechanics of `085_roofing_sms_receptionist.sql` (note the mandatory `notify pgrst, 'reload schema'`).

### 1a. Ingestion pipeline (copy `extractTradeBook` shape verbatim)

New module `lib/signage/rules-extract.ts` — a direct analogue of `extractTradeBook()`. The F45 Global Signage PDF is indexed into the same `mt-filestore-kb` store the trade books use (`lib/admin-loader/mt-filestore-kb.ts`, `KB_API_URL`/`KB_API_KEY` env vars — already wired). The new prompt module `lib/signage/rules-prompt.ts` mirrors `trade-book-prompt.ts`:

- `buildRuleExtractionPrompt()` — like `buildExtractionPrompt()`, but instead of pricing rows it asks Gemini to emit one JSON object per discrete requirement, **pre-tagged** with the two governing dimensions. The prompt instructs the model to set `applicability` and `confidence` using the same heuristics that already appear in the corpus (e.g. "if the rule depends on an HQ approval record, a receipt, a landlord letter, or a paint SKU → `needs_metadata_or_context`"; "if it requires an absolute inch/foot measurement → `needs_scale_reference`"; "if it is a legal/breach/awareness statement → `human_review_only`"; otherwise `auto_vision`).
- `RuleExtractionSchema` (Zod) mirrors `ExtractedServiceSchema`. Fields: `rule_key` (slug, the corpus's bracketed id), `text`, `modality` (`must`|`should`|`process`|`optional`), `applicability`, `confidence`, `rule_group` (storefront/logo_wall/v_design/paint_palette/reception/decals/window_wrap/retail/banners), `check_hint` (the corpus's `| check:` text becomes the vision instruction), `source_citation` ("Page N, Section Y") — exactly the `source_citation` field already on `ExtractedServiceSchema:49`.
- `parseRuleExtractionResponse()` reuses `unwrapModelJson()` + the per-row safeParse/error-collection loop from `trade-book-prompt.ts:163` byte-for-byte (good rows through, bad rows into `errors[]`).

The orchestrator `extractSignageRules()` is `extractTradeBook()` with the schema swapped — same injectable `fetchImpl`, same "never writes to DB; the route owns the inserts" contract.

### 1b. Staging → approve (reuse, do not reinvent)

Extracted rules land in the **existing** `import_staged_rows` table with a new `target_table='signage_rules'` (migration 070 already added `source_ref`/`source_document` columns — perfect for "Page 6, External Master Logo"). An operator reviews/approves on the existing `/admin/loader` UI (already has the staged-rows review surface) before anything hits the live `signage_rules` table. This is the **same trust gate** the trade-book loader uses: nothing the model extracted is live until a human approves it.

### 1c. New tables (migration 087, `087_signage_rules_registry.sql`)

```
signage_rules            -- the versioned, approved rule registry
  id uuid pk
  rule_set_version int            -- bump per PDF revision; old rows kept (audit/repro)
  rule_key text                   -- 'wall-logo-required' (the corpus slug)
  text text
  modality text                   -- must | should | process | optional
  applicability text              -- auto_vision | needs_metadata_or_context
                                  --  | needs_scale_reference | human_review_only
  confidence text                 -- high | medium | low  (the registry's prior, NOT the verdict's)
  rule_group text                 -- storefront | logo_wall | v_design | paint_palette | ...
  check_hint text                 -- becomes the per-rule vision instruction
  required_shots text[]           -- which guided shots can satisfy this rule (see §2)
  source_citation text
  active boolean default true
  unique (rule_set_version, rule_key)
  -- RLS enabled, no policy (mirrors migration 060 'enable RLS on new tables' rule);
  -- service-role reads only — this is global reference data, not tenant data.

signage_photo_submissions          -- one row per guided studio photo a franchisee sends
  id uuid pk
  tenant_id uuid not null          -- the studio/franchisee (scoping mirrors roofing)
  assessment_id uuid               -- the run this photo belongs to
  shot_slot text                   -- 'storefront' | 'logo_wall' | 'v_design' | 'reception' | 'windows'
  storage_path text                -- intake-photos/<tenant>/<...> (reuse bucket)
  has_scale_reference boolean      -- did the franchisee include a tape/door-in-frame shot?
  created_at timestamptz default now()

signage_assessments                -- one row per compliance run + its per-rule verdicts
  id uuid pk
  tenant_id uuid not null
  rule_set_version int             -- which registry version this run was scored against
  public_token text unique         -- unguessable share token (mirrors roofing public_token)
  status text                      -- gathering | scoring | report_ready | hq_review | closed
  overall text                     -- pass | fail | needs_review  (rollup)
  verdicts jsonb                    -- RuleVerdict[] (denormalised, like quotes.good/better/best)
  hq_reviewed_by text
  hq_decision text                 -- approved | rejected | needs_changes
  created_at / updated_at
```

Migration ends with `notify pgrst, 'reload schema';` and the `do $$ ... raise notice` verification block — **copied directly from `085_roofing_sms_receptionist.sql:32-48`**, because the CLAUDE.md memory note records that skipping the NOTIFY is exactly what caused the roofing receptionist's "re-ask forever" bug. Run script `scripts/run-migration-087.mjs` clones `scripts/run-migration-085.mjs`.

Storing verdicts denormalised in `signage_assessments.verdicts` jsonb mirrors the codebase's deliberate choice to denormalise line items into `quotes.good/better/best` rather than a normalised table (CLAUDE.md: `quote_line_items` is unused).

---

## 2. Franchisee photo capture

**Mirror:** `app/api/upload/[token]/route.ts` + `lib/sms/mms.ts extractAndStoreMmsPhotos()` + `lib/storage/upload.ts uploadIntakePhoto()` → the **existing `intake-photos` bucket**.

Two ingress paths, both reusing roofing's photo machinery unchanged:

- **Web:** `/studio/[token]/upload` — a clone of the `/upload/[token]` page/route. The franchisee gets a tokenised link (the `signage_assessments.public_token`) and takes the guided shots camera/gallery. Each upload calls `uploadIntakePhoto({ callId: tenantId, data, contentType, index })` (the `callId` param already doubles as any path key — see the comment at `lib/sms/mms.ts:93`) and inserts a `signage_photo_submissions` row.
- **SMS/MMS:** the franchisee texts the studio's number; `extractAndStoreMmsPhotos()` is reused verbatim to pull `MediaUrl0..N` (Basic-auth Twilio GET) into the bucket and return signed URLs. The conversation is driven by a pure state machine (see §3's `advanceSignage`, the `advanceRoofing` analogue) persisted on a new `sms_conversations.signage_state` jsonb column (migration 087, same NOTIFY caveat) — decoupled from `roofing_state` and `conversation_state` so the three flows never collide, exactly as 085 decoupled roofing from electrical/plumbing.

### Guided shots and WHY each maps to a rule group

The state machine asks for a fixed shot list; each shot is the **evidence carrier** for a `rule_group`, and `signage_rules.required_shots[]` records which rules a given shot can satisfy. This is the analogue of roofing asking for address/material/pitch before it can measure:

| Shot slot | Unlocks rule_group | Representative rules it can score (auto_vision) |
|---|---|---|
| **storefront** (wide, facing entrance) | `storefront`, `window_wrap`, `racing_stripe` | `master-logo-white-on-blue-required`, `racing-stripe-runs-all-exterior-windows`, `racing-stripe-tagline-one/two-windows` (OCR), `window-wrap-kit-paired-door-decal`, `main-door-decal-present` |
| **logo wall** (front-on, whole wall floor→ceiling) | `logo_wall`, `v_design` | `wall-logo-required`, `wall-logo-no-obstruction`, `v-design-mandatory`, `v-design-behind-logo`, `v-top-2x-bottom-width` (relative), `v-own-feature-wall-no-equipment`, `logo-wall-and-reception-wall-light-gray` |
| **V-design close** (the feature wall) | `v_design`, `paint_palette` | `v-design-paints-only` (two-tone), `v-90-degree-angle`, `v-design-top-2x-bottom` |
| **reception** (desk + wall behind) | `reception`, `paint_palette` | `reception-logo-centered-above-desk-backlit`, `reception-v-behind-desk`, `desk-signage-team-studio-name-center-front` (OCR) |
| **workout walls** (front + back) | `paint_palette`, `decals` | `palette-two-grays-plus-red-accent`, `workout-wall-stacking-order` (dark→red→light band order), `red-stripe-1point5in-above-dark-gray` (presence+order), `team-training-decal-feature-wall-workout`, `team-training-decal-white` |
| **retail area** | `retail` | `retail-area-dark-gray-floor-to-ceiling`, `retail-racks-wall-affixed`, `retail-slogan-centered-above-rack-10ft` (centering only) |
| **scale-reference shot** (tape measure OR a door in frame) — *requested only when a `needs_scale_reference` rule is in play* | unlocks the absolute-measurement tier | `racing-stripe-height-27p5in`, `wall-logo-min-width-100in`, `v-painted-28in-from-floor`, `workout-walls-dark-gray-to-28in` |

The state machine requests the **scale-reference shot conditionally**: if the franchisee's selected studio scope includes rules tagged `needs_scale_reference`, it asks "include one photo with a tape measure (or a standard door) visible against the wall." If they decline/skip, those rules **skip straight to human review** (`cannot_determine`) rather than guessing off an uncalibrated photo — directly analogous to how roofing routes to inspection when material/pitch can't be determined.

---

## 3. The assessment engine

**Mirror:** `lib/roofing/vision-verify.ts` (`buildVisionPrompt`/`parseVisionResponse`/`verifyAndClassify` — pure builder+parser, thin Claude call, **never throws**, sonnet-4-6) and the pure-state-machine shape of `lib/sms/roofing-receptionist.ts` (`advanceRoofing`).

### 3a. Per-photo vision pass — `lib/signage/vision-assess.ts`

Same three-export shape as `vision-verify.ts`:

```
RuleVerdict = {
  rule_key: string
  status: 'compliant' | 'non_compliant' | 'cannot_determine'   // mirrors VisionVerdict.match's tri-state
  confidence: 'high' | 'medium' | 'low'
  evidence: string        // one short sentence (≤240 chars, like VisionVerdict.reason)
  redFlags: string[]      // e.g. ['off-palette wall', 'logo obstructed by rack'] — capped, like vision-verify
}
```

- `buildAssessmentPrompt({ shotSlot, rules })` — pure, mirrors `buildVisionPrompt`. It is **grounded in the registry**: only the `signage_rules` whose `required_shots` include this `shotSlot` **AND** whose `applicability='auto_vision'` are injected into the prompt. Each rule's `check_hint` (the corpus `| check:` text) becomes the literal instruction. The prompt forbids the model from judging anything else and demands STRICT JSON `{ "verdicts": [ {rule_key, status, confidence, evidence, red_flags} ] }` — the same "STRICT JSON only, exactly this shape" discipline as `buildVisionPrompt:78`. Critically, the prompt instructs: *"If you cannot clearly see the feature, or the photo is ambiguous, return `cannot_determine` — never guess."* (the analogue of roofing's "if you can't tell, answer null").
- `parseAssessmentResponse()` — pure, mirrors `parseVisionResponse`: the `/\{[\s\S]*\}/` slice, tolerant JSON.parse, and **every coercion collapses to the safe value** (`coerceStatus` → `cannot_determine`, `coerceConfidence` → `low`, unknown `rule_key` dropped). Any unreadable answer yields all-`cannot_determine` so the flow never blocks on a parsing quirk — identical to the `inconclusive` fallback at `vision-verify.ts:94`.
- `assessPhoto(args)` — the thin Claude call, mirroring `verifyAndClassify:182`: `temperature: 0`, dynamic-imports `@ai-sdk/anthropic` + `ai`, attaches the photo as `{ type:'image', image:base64, mediaType }`, model defaults to `claude-sonnet-4-6` (env `SIGNAGE_VISION_MODEL`). **Never throws** — on any error (no API key, network) it returns an all-`cannot_determine` verdict set, so a vision outage degrades to "human review" not a false compliance call.

The `auto_vision` rules are the only ones ever sent to the model. The other three applicability classes are handled deterministically (§4): they are **manufactured** as `cannot_determine` verdicts with a fixed reason, never passed to vision. This keeps the model's surface area tight and its outputs auditable — the same reason `validate.ts` only checks machine-decidable price grounding.

### 3b. Reference image for the comparison rules

Several rules are *comparison* rules (`no-alter-after-approval`, `v-design-proportionate-to-logo`, `wall-logo-larger-case-by-case`). Where a baseline reference image exists (the approved rendering on file, or the F45 design-control lockup), it is attached as the **second image** and the prompt asks "does the FIRST photo match the SECOND reference?" — this is *exactly* the two-image satellite-vs-photo match in `buildVisionPrompt:46` (`hasReferenceImage`). When no baseline is on file, those rules are forced to `cannot_determine` (the approval/baseline isn't in the photo — see corpus `| check:` notes), never guessed.

### 3c. SMS conversation engine — `lib/signage/signage-receptionist.ts`

`advanceSignage(prev, inbound)` is the `advanceRoofing` analogue: a pure per-turn decision over `SignageConversationState` (slots = which shots gathered, `last_step`, `pending_assessment_token`). Decisions: `ask` (request next missing shot) · `assess` (all required shots in → run vision) · `request_scale` (a `needs_scale_reference` rule needs the tape shot) · `report` (terminal — send the report link) · `cancel`. `nextSignageConversationState()` and `isActiveSignageFlow()` mirror the roofing equivalents exactly. The route owns the I/O (vision call, persist, SMS); this module is pure and fully unit-tested, per the roofing convention.

---

## 4. The grounding / safety backstop

**Mirror:** `lib/estimate/validate.ts` — the deterministic layer that, on **any** failure, downgrades the whole quote to the safe fallback ("$99 inspection"). Here the safe fallback is **"human review required."**

New module `lib/signage/validate-verdicts.ts`, `validateSignageAssessment(verdicts, rules, evidence)`. It runs **after** the vision pass and **before** the report is finalised, and it is the only deterministic, machine-checkable layer. It enforces four downgrade rules — each one a direct transposition of a `validate.ts` guarantee:

1. **Applicability gate (the core grounding rule).** Every `auto_vision` verdict must trace to a real `signage_rules` row of `applicability='auto_vision'` in the run's `rule_set_version`. A verdict for any other applicability class — or for a `rule_key` not in the registry — is **forced to `cannot_determine`**. This is the analogue of `validate.ts`'s "every line item must trace to a real DB row × pricing derivation": a verdict the model invented for a rule it was never allowed to judge is the signage equivalent of a fabricated price.

2. **Confidence floor → human review.** Any verdict returned `confidence:'low'`, **or** `confidence:'medium'` on a rule whose registry `confidence` is `high` (model is less sure than the rule warrants), is rewritten to `cannot_determine`. A `compliant` or `non_compliant` only survives at `high` (or `medium` where the registry itself caps at `medium`). Mirrors the `PRICE_TOLERANCE` / markup-band discipline: outside the trusted band, you don't pass it through.

3. **Metadata/scale rules are never auto-decided.** Every `needs_metadata_or_context` and `needs_scale_reference` rule is deterministically materialised as `cannot_determine` with a fixed reason ("requires HQ approval record / paint SKU / landlord letter — not photo-checkable" or "requires a scale reference in frame"). `human_review_only` likewise. These never reach the model and can never come back `compliant`. This is the structural reason the tool can claim safety: the legally-loaded determinations (`deviation-is-breach-until-remedied`, `all-signage-must-be-hq-approved`, `non-conforming-signage-blocks-opening`) are **architecturally incapable** of an automated pass/fail.

4. **Evidence-required for any negative.** A `non_compliant` verdict with an empty `evidence` string is downgraded to `cannot_determine` — you may not fail a franchisee without a stated, photo-grounded reason. (Roofing's analogue: a labour line with no recognised unit fails grounding rather than passing silently.)

`overall` rollup: `fail` if any surviving `non_compliant`; else `needs_review` if any `cannot_determine`; else `pass`. Note that because of rules 1–4 the **default gravity is toward `needs_review`**, exactly as roofing defaults toward inspection when grounding is shaky.

**Why this matters here specifically.** The document states a deviation "may constitute a breach of the Franchise Agreement." A false `compliant` could lull a franchisee into a real contractual breach; a false `non_compliant` could trigger a costly, unnecessary re-fabrication and an adversarial HQ interaction. The cost of a wrong automated verdict is materially higher than a wrong roofing price (which the tradie reviews anyway). So the backstop is deliberately **more conservative** than `validate.ts`: the model is allowed to *assert* compliance only for the narrow `auto_vision/high` set, and everything else is surfaced as "a human must look at this," with the rule text and citation attached. The tool **flags**; HQ **decides** — never the reverse.

---

## 5. Output

### 5a. Franchisee-facing compliance report — `/studio/[token]/report`

A clone of the roofing `/q/roof/[token]` public, token-gated page (`signage_assessments.public_token`), styled with the Maintain design system (the `maintain-design-system` skill). The composer `lib/signage/compose-report.ts` is the `roofing-compose.ts` analogue (pure, unit-tested). Grouped by `rule_group`, each item renders one of three states:

- ✅ **Compliant** — green, with the one-line evidence and the source citation.
- ❌ **Action needed** — red, the rule text + "what to fix" (derived from `check_hint`/`evidence`, e.g. "Your back wall is missing the red stripe between the dark-gray base and light-gray top — add a 1.5″ red stripe per p.6").
- 🔍 **Needs HQ review** — amber, the rule text + *why it can't be auto-checked* ("Exact Dulux SKU can't be verified from a photo — keep your paint receipt for HQ", "Requires HQ written approval on file").

Every report carries a fixed disclaimer mirroring roofing's "a roofer reviews every quote": **"This is an automated pre-check, not F45 HQ approval. Final signage compliance is determined by F45 HQ."** An SMS summary (the `composeEstimateMessage` analogue) sends "X compliant, Y to fix, Z need HQ review — full report: <link>" as a best-effort MMS with one annotated thumbnail, exactly as roofing sends `buildRoofPhotoMedia()` before the text.

### 5b. HQ-facing review queue — `/admin/signage/queue`

Lists `signage_assessments` where `status='hq_review'` (any surviving `non_compliant` or `cannot_determine`), scoped per studio. Each entry shows the photos, the per-rule verdicts (with the model's evidence and the deterministic downgrades clearly labelled "auto-downgraded: needs metadata"), and HQ actions writing `hq_decision`/`hq_reviewed_by`. This reuses the existing `/admin/loader` admin surface conventions and the `admin_users`/RLS posture from migration 060. The `cannot_determine` items are the queue's primary payload — the tool's job is to **route HQ's attention**, the same way roofing routes a tradie's review.

### 5c. Optional Gemini "what compliant looks like" render

**Mirror:** `lib/ig-engine/generate.ts` (Gemini 2.5 Flash Image, CAS status `idle|generating|ready|failed`, best-effort, never blocks). New `lib/signage/reference-render.ts`: for a failed `auto_vision` rule with a clear visual fix (missing red stripe, wrong wall colour, obstructed logo wall), edit the franchisee's own photo to show the compliant state ("here's what your back wall should look like"). It reuses `generate.ts`'s atomic claim (CAS flip `idle→generating`), per-photo loop, and "best-effort; any error never blocks a good report" discipline. Stored on a `signage_assessments.reference_render_paths text[]` column. Explicitly labelled "illustrative — not an approved F45 rendering" so a generated image is never mistaken for HQ sign-off.

---

## 6. Build phases

**MVP (Phase 1) — presence / layout / colour-family only.** Ships exactly the rule classes `validate.ts`-style grounding can defend:
- Ingestion (§1) into `signage_rules` via the existing staged-rows approve gate.
- Web upload (`/studio/[token]/upload`) for the five core shots (storefront, logo wall, V-design, reception, workout walls). SMS path can come in Phase 2.
- Vision pass (§3) + backstop (§4) over **only** the `auto_vision` rules: `wall-logo-required`, `wall-logo-no-obstruction`, `v-design-mandatory`, `v-design-behind-logo`, `v-top-2x-bottom-width`, `v-90-degree-angle`, `palette-two-grays-plus-red-accent`, `workout-wall-stacking-order`, `red-stripe-1point5in-above-dark-gray` (presence + band order), `team-training-decal-feature-wall-workout` + `-white`, `master-logo-white-on-blue-required`, `racing-stripe-runs-all-exterior-windows`, `racing-stripe-tagline-one/two-windows` (OCR), `window-wrap-kit-paired-door-decal`, `retail-racks-wall-affixed`. These are presence, relative-layout, band-order, OCR-tagline, and **colour-family** (not SKU) checks — the things a phone photo genuinely supports.
- Franchisee report (§5a) + HQ queue (§5b). All `needs_metadata/scale/human_review` rules render as 🔍 needs-review from day one — the backstop is fully present in MVP because it's a safety property, not a feature.

**Deferred (Phase 2+):**
- **Absolute measurements** (`needs_scale_reference`): `racing-stripe-height-27p5in`, `wall-logo-min-width-100in`, `v-painted-28in-from-floor`, `workout-walls-dark-gray-to-28in`. Requires the conditional tape-in-frame shot + a calibrated pixel→inch estimation step. Until shipped these stay `cannot_determine` (safe).
- **Metadata-gated** (`needs_metadata_or_context`): exact paint SKUs, HQ approval records, landlord letters, supplier invoices, QR-decode-vs-expected-URL. These need an HQ records integration (approval DB, receipts upload) — until then they are permanently human-review items, which is correct.
- SMS/MMS ingress (`advanceSignage`), the Gemini reference render (§5c), and reference-baseline comparison rules (§3b).

Phasing principle copied from roofing: ship the deterministic, defensible core first; everything uncertain defaults to the safe fallback and is added only when it can be made grounded.

---

## 7. Honest limits — assists, does not replace HQ approval

- **The tool can flag a spec mismatch; it cannot grant compliance.** The document is explicit that approval, breach, open-to-trade authorisation, and deviation-permission are **HQ determinations** (`all-signage-must-be-hq-approved`, `deviation-is-breach-until-remedied`, `non-conforming-signage-blocks-opening`). By design (§4 rule 3) the tool returns `cannot_determine` for every such rule. A green report means "the photo-checkable basics look right," never "HQ approves."
- **Colour is family-only, never SKU.** The model can flag an obviously off-palette wall (green/yellow) but cannot confirm Dulux 16YR 16/594 vs Taubmans Hi-C Red from an uncalibrated phone photo (corpus says so for every `red-paint-*`/`light-gray-*`/`dark-gray-*` rule). Exact-code compliance is always a metadata/receipt check → human review.
- **Absolute dimensions need a scale reference and remain estimates.** Even with a tape in frame, a pixel→inch read on `27.5"` or `100"` is an estimate; borderline cases (within ~10%) should be surfaced to HQ, not auto-failed.
- **The whole legal/awareness/process layer is out of scope by construction** — `must-language-is-requirement`, `familiarise-with-obligations`, `keep-document-confidential`, `agreement-prevails-on-inconsistency`, professional-installer rules. The tool never opines on these.
- **A wrong verdict is costlier than a wrong roofing price**, because the document ties non-compliance to a Franchise Agreement breach. That asymmetry is *why* the backstop is tuned more conservatively than `validate.ts` and why the gravity of every uncertain case is toward "a human must look," not toward an automated pass or fail.

---

## Cited files mirrored (all real, all in `quotemate-automation/`)

| New module | Mirrors |
|---|---|
| `lib/signage/rules-extract.ts` | `lib/admin-loader/trade-book-extract.ts` |
| `lib/signage/rules-prompt.ts` | `lib/admin-loader/trade-book-prompt.ts` (Zod schema, `unwrapModelJson`, defensive parser) |
| `lib/signage/vision-assess.ts` | `lib/roofing/vision-verify.ts` (pure build/parse + never-throw Claude call, sonnet-4-6) |
| `lib/signage/signage-receptionist.ts` | `lib/sms/roofing-receptionist.ts` (`advanceRoofing` pure state machine) |
| `lib/signage/validate-verdicts.ts` | `lib/estimate/validate.ts` (grounding backstop → safe fallback) |
| `lib/signage/compose-report.ts` | `lib/sms/roofing-compose.ts` (pure composer) |
| `lib/signage/reference-render.ts` | `lib/ig-engine/generate.ts` (Gemini, CAS, best-effort) |
| MMS in / storage / upload route | `lib/sms/mms.ts` + `lib/storage/upload.ts` + `app/api/upload/[token]/route.ts` (unchanged, reused) |
| `sql/migrations/087_signage_rules_registry.sql` + `scripts/run-migration-087.mjs` | `sql/migrations/085_roofing_sms_receptionist.sql` (incl. mandatory `notify pgrst, 'reload schema'`) + `scripts/run-migration-085.mjs` |
| Staging table | reuses existing `import_staged_rows` (`target_table='signage_rules'`, migration 070 `source_ref`) |

Highest applied migration is 085 (086 follows); signage starts at **087**. Bucket reused: `intake-photos`. Vision model: `claude-sonnet-4-6` (env `SIGNAGE_VISION_MODEL`). Image gen: Gemini 2.5 Flash Image. KB ingestion: existing `mt-filestore-kb` (`KB_API_URL`/`KB_API_KEY`).