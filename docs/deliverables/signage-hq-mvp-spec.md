# Signage Compliance — HQ (Franchisor) MVP Spec

**Status:** draft for review · 2026-06-03
**Primary customer:** F45 HQ / franchisor (chosen 2026-06-03)
**Companion artifacts:** [`wf_design.md`](wf_design.md) (full roofing-mirror design), [`signage_rules.csv`](signage_rules.csv) / [`signage_rules.json`](signage_rules.json) (174-rule registry), `signage_text.txt`, `page_*.png` (rendered specs)

---

## 1. What this is (and isn't)

A photo-driven signage-compliance **monitoring tool sold to a franchisor (F45 HQ)** to triage signage compliance across its studio network at scale. HQ runs a "sweep," each studio gets a tokenised link and uploads guided photos, an AI vision pass scores them against a versioned rule registry, and HQ gets a **review queue** ranked by severity — so a human only opens the flagged studios.

- **It is** an attention-router and audit-trail for HQ compliance staff, and an instant self-check report for the franchisee.
- **It is NOT** an automated authority. It never declares a Franchise-Agreement breach, never auto-sends an enforcement notice, and never certifies HQ approval. **AI triages; HQ decides.** This is the liability shield, because the source document ties signage non-compliance to a contractual breach — a false "compliant" is a real legal risk.

The hero surface is the **HQ fleet view + queue**, not the franchisee report. Build priority follows from that.

---

## 2. Actors & tenancy — the one net-new piece

QuoteMate today is one-tenant-per-tradie. This product needs a **franchisor-over-many-studios** roll-up, which does not exist in the codebase. The clean model:

| Actor | Authenticated? | What they do |
|---|---|---|
| **Org (franchisor = F45 HQ)** | — (owns the account) | The paying customer. Owns many studios. The unit of billing & data isolation. |
| **HQ user** | ✅ Supabase auth, `org_id`-scoped | Runs sweeps, works the review queue, takes enforcement actions. The only logged-in human. |
| **Studio (franchisee location)** | ❌ no account | A record under an org (name, address, region, contact phone/email). |
| **Franchisee** | ❌ tokenised link only | Receives a sweep request, uploads guided photos via an unguessable link. Never logs in. |

**Key simplification:** franchisees need **no accounts, no onboarding** — they interact only through a tokenised link, exactly like roofing's `public_token`. HQ is the sole authenticated actor. This removes the single biggest build cost (franchisee auth/onboarding) and matches the HQ-push model.

> Do **not** overload the existing `tenants` table (tradie businesses with Twilio/Vapi/Stripe). Add a separate `orgs` + `studios` tenancy for this product. It can live in the same DB/codebase to reuse the photo+vision infra, with its own org-scoped RLS.

---

## 3. Data model (migrations 087+)

Highest applied migration is **085**; this starts at **087**. Every migration ends with `notify pgrst, 'reload schema';` (skipping it caused the roofing re-ask bug — see CLAUDE.md memory).

```
orgs                              -- the franchisor (F45 HQ); the billing + isolation unit
  id uuid pk
  name text                       -- 'F45 Global'
  brand_slug text                 -- 'f45'  (white-label hook for later, multi-brand)
  created_at

studios                           -- a franchisee location under an org (no auth)
  id uuid pk
  org_id uuid not null            -- RLS scope
  name text                       -- 'F45 Bondi'
  region text                     -- 'APAC' / 'AU-NSW'  (for fleet filtering & roll-ups)
  contact_phone text              -- where the sweep link is sent (Twilio)
  contact_email text
  status text                     -- prospect | open | closed
  created_at

signage_rules                     -- the versioned, approved rule registry (global ref data)
  id uuid pk
  rule_set_version int            -- bump per PDF revision; old rows kept for audit/repro
  brand_slug text                 -- 'f45' (rules are per-brand)
  rule_key text                   -- 'wall-logo-required'  (the registry slug)
  rule_text text
  modality text                   -- must | should | process | optional
  applicability text              -- auto_vision | needs_scale_reference
                                  --  | needs_metadata_or_context | human_review_only
  confidence text                 -- the registry prior (high|medium|low), NOT the verdict
  rule_group text                 -- logo_wall | v_design | paint_palette | storefront | ...
  required_shots text[]           -- which guided shots can satisfy this rule
  check_hint text                 -- becomes the per-rule vision instruction
  mvp_tier text                   -- mvp_core | phase2_ref | phase2_measure | human_queue*
  source_citation text            -- 'Page 12, Internal Signage'
  active boolean default true
  unique (brand_slug, rule_set_version, rule_key)

signage_sweeps                    -- an HQ-initiated compliance campaign
  id uuid pk
  org_id uuid not null
  rule_set_version int            -- which registry version this sweep scores against
  name text                       -- 'APAC Q3 storefront audit'
  studio_filter jsonb             -- {region:'APAC', status:'open'}
  status text                     -- draft | sent | collecting | review | closed
  created_by uuid                 -- HQ user
  created_at

signage_requests                  -- one per (sweep × studio): the tokenised ask
  id uuid pk
  sweep_id uuid not null
  studio_id uuid not null
  org_id uuid not null            -- denormalised for RLS
  public_token text unique        -- the unguessable franchisee link (roofing public_token)
  state text                      -- pending | reminded | submitted | assessed | expired
  required_shots text[]           -- the shot list this studio must provide
  reminded_count int default 0
  submitted_at timestamptz
  created_at

signage_photo_submissions         -- one row per guided photo
  id uuid pk
  request_id uuid not null
  studio_id uuid not null
  org_id uuid not null
  shot_slot text                  -- storefront | logo_wall | v_design_close | reception | workout_walls
  storage_path text               -- intake-photos/<org>/<studio>/...  (reuse bucket)
  captured_meta jsonb             -- {ts, geo?} for the phase-2 integrity layer
  created_at

signage_assessments               -- one per request: the run + its per-rule verdicts
  id uuid pk
  request_id uuid not null
  studio_id uuid not null
  org_id uuid not null
  rule_set_version int
  status text                     -- scoring | report_ready | hq_review | resolved
  overall text                    -- pass | fix_needed | needs_review  (rollup)
  verdicts jsonb                  -- RuleVerdict[] denormalised (like quotes.good/better/best)
  hq_decision text                -- approved | needs_changes | escalated
  hq_reviewed_by uuid
  hq_note text
  reference_render_paths text[]   -- optional Gemini 'what compliant looks like'
  created_at / updated_at
```

RLS: every table enabled, **org-scoped** policies for HQ users (an HQ user sees only their org's studios/sweeps/assessments). `signage_rules` is global reference data — service-role read, RLS-on-no-policy (mirrors migration 060). Service-role still bypasses for the assessment pipeline.

---

## 4. The end-to-end HQ flow

```
  HQ builds a sweep ──► system creates one signage_request per matching studio
        │                        │  (tokenised link)
        │                        ▼
        │              Twilio SMS / email to each studio: "F45 HQ needs photos of
        │              your signage — tap to upload: <link>"   (+ auto reminders)
        │                        ▼
        │              Franchisee opens link, takes guided shots ──► intake-photos bucket
        │                        ▼
        │              Vision pass (auto_vision rules for each shot) ──► verdicts
        │                        ▼
        │              GROUNDING BACKSTOP: low-confidence / metadata / scale / legal
        │              ──► forced to 'needs_review'  (never a false pass/fail)
        │                        ▼
        ▼                Assessment rollup ──► HQ REVIEW QUEUE (ranked by severity)
  Fleet dashboard ◄──────────────┘                 │
  (compliance rate by                               ▼
   region/rule/studio)              HQ opens flagged studio, sees photos + per-rule
                                    verdicts + evidence + citations, decides:
                                    approve / needs-changes / escalate
                                                    │
                                                    ▼
                                    Franchisee gets remediation report (what to fix);
                                    HQ can re-request after fix  ──► loop closes
```

The two things that make this an **HQ product** and not the roofing flow:
1. **HQ-initiated sweeps** with a studio filter + automatic reminder/escalation for non-responders (a non-response is itself a compliance signal HQ wants surfaced).
2. **The fleet roll-up** — "37% of APAC studios are missing the racing stripe" — the analytics an enforcement team pays for.

---

## 5. The vision + backstop pipeline (reused almost wholesale)

Mirrors `lib/roofing/vision-verify.ts` (pure build/parse + never-throw Claude call, `claude-sonnet-4-6`) and `lib/estimate/validate.ts` (grounding → safe fallback).

- **`lib/signage/vision-assess.ts`** — per shot, inject only the `signage_rules` whose `required_shots` include that slot **and** `applicability='auto_vision'`. Each rule's `check_hint` becomes the literal instruction. Returns `RuleVerdict { rule_key, status: compliant|non_compliant|cannot_determine, confidence, evidence, red_flags }`. Prompt rule: *"if you cannot clearly see the feature or the photo is ambiguous, return `cannot_determine` — never guess."* Never throws (vision outage → all `cannot_determine`).
- **`lib/signage/validate-verdicts.ts`** — the deterministic backstop, run after vision, before the queue. Four downgrades, each a transposition of a `validate.ts` guarantee:
  1. **Applicability gate** — a verdict for any rule not `auto_vision` in this `rule_set_version`, or an invented `rule_key`, is forced to `cannot_determine`.
  2. **Confidence floor** — `low` (or `medium` where the rule's registry prior is `high`) → `cannot_determine`. A `compliant`/`non_compliant` only survives at high confidence.
  3. **Metadata / scale / legal never auto-decided** — materialised as `needs_review` with a fixed reason. (This is why `deviation-is-breach`, `all-signage-hq-approved`, exact paint SKUs are *architecturally incapable* of an automated pass/fail.)
  4. **Evidence-required for any negative** — a `non_compliant` with empty `evidence` → `cannot_determine`. You can't fail a franchisee without a photo-grounded reason.
- **Rollup gravity** defaults toward `needs_review`, exactly as roofing defaults toward inspection when grounding is shaky.

---

## 6. The MVP rule slice (15 core, from the registry)

These are the `auto_vision` rules the adversarial stress-test confirmed (or rated high-confidence) — presence, layout, band-order, OCR-tagline, and **colour-family** checks a phone photo genuinely supports. **Curation note:** before locking the MVP, filter to `modality='must'` (a couple below are `should`/`optional` guidance — keep them informational, don't gate enforcement on them) and hand-verify the `required_shots` (the auto-assignment is category-based and slightly rough).

| rule_key | shot | what the AI checks |
|---|---|---|
| `wall-logo-required` | logo_wall | the internal wall logo is present |
| `wall-logo-no-obstruction` | logo_wall | nothing blocks the logo wall |
| `v-design-mandatory` | logo_wall / v_design_close | the painted V is present |
| `v-design-behind-logo` | logo_wall / v_design_close | the V sits behind the logo |
| `workout-wall-stacking-order` | workout_walls | dark-gray → red stripe → light-gray band order |
| `team-training-decal-feature-wall-workout` | workout_walls | 'Team Training' decal present on a feature wall |
| `invest-in-yourself-decal-present` | workout_walls | 'Invest In Yourself' decal present |
| `main-door-decal-present` | storefront | door decal present on the entrance |
| `logo-lockup-on-glass-present` | storefront | external logo lockup on the glass |
| `wrap-one-window-copyline-qr-logo` | storefront | a window panel carries the copyline + QR + logo (OCR) |
| `desk-signage-team-studio-name-center-front` | reception | 'Team [Studio]' desk signage present (OCR) |
| `retail-racks-wall-affixed` | reception/retail | retail racks affixed to the wall |
| `preopen-door-covering-qr-and-details` *(should)* | storefront | pre-open door covering has QR + details |
| `best-workout-decal-optional` *(optional)* | workout_walls | informational presence check only |
| `google-review-cling-placement-visibility` *(should)* | reception | review cling placed/visible |

Everything else in the 174 (the 87 metadata, 18 measurement, 15 reference-object, 15 legal, 24 other) renders as 🔍 **needs HQ review** from day one — the backstop is a safety property present in MVP, not a feature added later.

---

## 7. Surfaces

**HQ (authenticated, `/admin/signage/*` or a dedicated `/hq/*`):**
- **Fleet dashboard** — studios × compliance status, filter by region/status, top violations roll-up.
- **Sweep builder** — name + studio filter + shot list → "send." Tracks response rate.
- **Review queue** — assessments in `hq_review`, ranked by severity; per-studio: photos + per-rule verdicts (with deterministic downgrades clearly labelled "auto-downgraded: needs metadata") + actions writing `hq_decision`. The `needs_review` items are the queue's primary payload — routing HQ's attention *is* the product.

**Franchisee (tokenised, no auth):**
- **`/studio/[token]/upload`** — clone of `/upload/[token]`; guided camera/gallery for the shot list.
- **`/studio/[token]/report`** — ✅ compliant / ❌ fix-this / 🔍 needs-HQ-review per item, grouped by area, with a fixed disclaimer: *"Automated pre-check, not F45 HQ approval."*

---

## 8. Build phases

**MVP (Phase 1) — the defensible core:**
1. Migrations 087 (`orgs`/`studios`/`signage_rules`/`signage_sweeps`/`signage_requests`/`signage_photo_submissions`/`signage_assessments`) + run-script.
2. Load the registry (curated MVP slice + the rest as `human_queue`) via the existing admin-loader staging→approve gate (`import_staged_rows`, `target_table='signage_rules'`).
3. Sweep builder + tokenised request send (Twilio reuse) + reminders.
4. `/studio/[token]/upload` (reuse `upload/[token]` + `intake-photos`).
5. `vision-assess.ts` + `validate-verdicts.ts` over the 15 `auto_vision` rules.
6. HQ review queue + fleet dashboard + franchisee report.

**Phase 2 — widen coverage:**
- `phase2_ref` (15 rules): request a tape/known-object/grey-card shot; score with an in-frame reference.
- `phase2_measure` (18): pixel→inch estimation off the reference shot; borderline → queue, never auto-fail.
- SMS/MMS franchisee ingress (`advanceSignage` state machine) as an alternative to web.
- Gemini "what compliant looks like" render (`lib/ig-engine/generate.ts` pattern).

**Phase 3 — enforcement-grade:**
- Photo-integrity layer (timestamp/geo, random re-checks) — franchisees will game it once they know it's automated.
- HQ metadata integration (approval records, paint receipts) to start clearing `human_queue_metadata` rules.
- Multi-brand / white-label (the `brand_slug` is already in place).

---

## 9. Honest limits (carry into any HQ sales conversation)

- **Flags, never certifies.** A green report = "the photo-checkable basics look right," never "HQ approves."
- **Colour is family-only, never SKU.** Can flag a green/yellow wall; cannot confirm Dulux 16YR 16/594 from a phone photo. Exact code = receipt/metadata = human.
- **Absolute dimensions need a reference and stay estimates.** Even with a tape in frame, borderline (within ~10%) goes to a human, not an auto-fail.
- **The whole legal/process layer is out of scope by construction** (breach, approval, awareness, professional-installer quality).
- **A wrong verdict is costlier than a wrong roofing price** because of the breach linkage — which is why the backstop is tuned more conservatively than `validate.ts`.

---

## 10. Open decisions for you

1. **Studio identity source** — does HQ already hold a studio list (CSV import) or do we build studio CRUD? (Affects sweep targeting on day one.)
2. **Request channel** — SMS (Twilio, like roofing) vs email vs both for the sweep link?
3. **Same codebase or new repo** — reuse QuoteMate's DB/photo/vision infra in-place, or fork a standalone product? (Recommend in-place for MVP speed; the `orgs`/`studios` tenancy keeps it isolated.)
4. **Who curates the registry** — you/HQ approve the MVP-slice `must`-filter + shot mapping before first sweep (one short pass on `signage_rules.csv`).
```
