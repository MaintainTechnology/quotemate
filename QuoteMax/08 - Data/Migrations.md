---
title: Migrations
type: reference
area: data
tags: [quotemax, database, migrations, supabase, sql, ops]
status: draft
updated: 2026-09-04
sources:
  - quotemate-automation/sql/migrations
  - quotemate-automation/scripts/run-migration-194.mjs
  - quotemate-automation/sql/migrations/194_quote_chain.sql
  - quotemate-automation/sql/migrations/057_voyage3_large_1024.sql
  - quotemate-automation/sql/migrations/189_painting_quote_sent_at.sql
---

# Migrations

244 files in `quotemate-automation/sql/migrations/` — **195 forward migrations and 48 `_down.sql`
companions**, numbered `002` to `196`. They are applied directly to the production Supabase project.
There is no staging database and no migration framework: numbering, ordering and idempotency are
maintained by hand, and the discipline that makes that survivable is documented below.

## The workflow

A database change is three files plus one command:

```
quotemate-automation/sql/migrations/NNN_short_name.sql        # forward
quotemate-automation/sql/migrations/NNN_down.sql              # rollback
quotemate-automation/scripts/run-migration-NNN.mjs            # the runner
```

```
node --env-file=.env.local scripts/run-migration-NNN.mjs            # DRY RUN — prints the SQL, connects to nothing
node --env-file=.env.local scripts/run-migration-NNN.mjs --apply    # applies inside a transaction, then verifies
node --env-file=.env.local scripts/run-migration-NNN.mjs --apply --rollback   # runs NNN_down.sql, then verifies removal
```

The runner is boilerplate that is copied per migration, and every part of it is load-bearing
(`scripts/run-migration-194.mjs`):

1. **Dry run is the default.** `if (!apply)` prints the SQL and `process.exit(0)` — no DB connection
   is opened at all. You cannot fat-finger a production write.
2. **`SUPABASE_DB_URL`** is the direct Postgres connection (via the `pg` driver, `ssl: {
   rejectUnauthorized: false }`), not PostgREST. Migrations need DDL; supabase-js cannot do DDL.
3. **`begin` … `commit`, with `rollback` in the catch.** A failed verify aborts the whole thing.
4. **A post-apply verification query.** 194 asserts `chain_columns === 2`, `open_child_index === 1`,
   `kind_check === 1` and that the default contains `initial` — and throws if not. The `--rollback`
   path asserts the same three counts are `0`. This is why the migrations can be trusted without a
   staging environment: each one proves its own effect before committing.

### Rules that hold across the file set

- **Additive and idempotent.** `add column if not exists`, `create table if not exists`, `create
  index if not exists`, and CHECK constraints wrapped in `do $$ … if not exists (select 1 from
  pg_constraint where conname = …) …` (the pattern 193 established and 194 copied). Re-running a
  migration must be a no-op.
- **`notify pgrst, 'reload schema';` at the end.** Without it PostgREST's cache is stale and inserts
  fail `PGRST204` until the cache expires — named explicitly as "the cache-staleness class of bug
  that once broke the SMS roofing flow" (`089_painting_measurements.sql:63-65`).
- **RLS on, no policies.** Every new table gets `enable row level security` with zero policies —
  "the Phase-1.5 convention, mig 060". Service-role routes bypass it; the anon key sees zero rows.
  See [[Tenancy and RLS]].
- **A `do $$ … raise notice` diagnostic block** so a direct `psql` run echoes what changed.
- **The header comment is the design doc.** The migrations in this repo carry unusually long
  rationale headers — 194's is 46 lines of prose before the first `alter table`. When a column's
  meaning is unclear, the migration that added it is the primary source, ahead of the code.
- **Mirror structural changes back into `sql/init.sql`** where they are representative. 194 mirrors
  the two columns but deliberately *not* the partial index, "because it is partial on `paid_at`, a
  column `init.sql` does not have".
- **Backfill decisions are argued, not assumed.** 189 refused a backfill and spent 20 lines
  explaining why: the predicate that looked right matched exactly the 8 rows of which 3 had texted
  nobody, so stamping them would have written "delivered" onto three undelivered quotes.

### ⚠ Sharp edges in the numbering

- **`123`, `124`, `125` do not exist.** The sequence jumps `122` → `126`. Nothing in the repo
  explains the gap; treat the numbers as burnt.
- **Duplicated numbers in the early set.** `004`, `005`, `006` and `007` each have **two** unrelated
  forward migrations (e.g. `004_calls_photo_request_sent_at.sql` and `004_sms_messages_unique_sid.sql`).
  Filename order is not application order for these.
- **`073_quotes_display_mode_override.sql` and `077_agent_findings_tables.sql` both open with
  "Migration 072" / "Migration 074"** in their header comments — copy-paste from the previous file.
  Trust the filename, not the comment.
- **A number can be taken while you write.** 194's header records exactly this: the spec called it
  193, `193_quotes_inspection_cause.sql` landed first, so the chain took the next free number.
- **Only 48 of 195 forward migrations have a `_down.sql`.** Down files became routine from ~118
  onward; almost nothing before that is reversible by script.

---

## The list, newest first

One line each. Where a migration's own header states its purpose, that phrasing is used.

### 190s — EV charger, the money chain, push

| # | File | Purpose |
|---|---|---|
| 196 | `ev_charger_clarifying_questions` | Bring the SMS receptionist's EV charger questions up to the dashboard form's five. |
| 195 | `quotes_estimate_number` | `quotes.estimate_number` + `quote_estimate_number_seq` + `next_quote_estimate_number()` — human-readable EST-%04d on the EV charger estimate document. |
| 194 | `quote_chain` | **`quotes.parent_quote_id` + `quote_kind`** (`initial`→`final`→`balance`) and the `quotes_open_child_uniq` partial unique index. See [[The Post-Visit Quote Ladder]]. |
| 193 | `quotes_inspection_cause` | **`quotes.inspection_cause`** (`site_conditions`\|`model_declared`\|`grounding_failed`) — WHY a quote is inspection-routed, gating the customer copy. |
| 192 | `ev_charger_bounds` | Provisional EV charger sanity bounds in `job_type_bounds`. A gross-error guard, not a pricing source. |
| 191 | `push_tokens` | Seat-scoped Expo push tokens + delayed receipt tracking (`push_tokens`, `push_tickets`, `push_events`, `push_event_deliveries`). |
| 190 | `trade_lead_requests` | One self-serve quote-request form table for **every** trade, replacing per-trade tables. |

### 180s — painting auto-send, recipes, videos

| # | File | Purpose |
|---|---|---|
| 189 | `painting_quote_sent_at` | **`painting_measurements.quote_sent_at`** — evidence a carrier accepted the SMS, distinct from `released_at`. Deliberately no backfill. |
| 188 | `task_conditions` | A task step can depend on the chosen product (Phase 4 R9). |
| 187 | `bom_custom_assembly_parent` | A recipe line can hang off a tenant's own assembly, not just a shared one. |
| 186 | `shared_bom_conditions_ratios` | Phase 4 R7/R8 on the shared recipe table (`include_when`, `quantity_per`). |
| 185 | `bom_conditions_ratios_pins` | A recipe line can be conditional, ratio-scaled, and pinned to an exact product. |
| 184 | `assembly_tasks` | `shared_assembly_tasks` + `tenant_assembly_tasks` — an ordered task checklist per job. |
| 183 | `tradie_send_log` | Let `sms_messages` hold a **tradie alert**, not just customer turns. |
| 182 | `measure_token_default` | `roofing_measurements.measure_token` gets a column default + backfill. |
| 181 | `trade_paid_amount` | ⚠ Adds the **column** `paid_amount_cents` to `roofing_measurements` and `painting_measurements`. Not a table. |
| 180 | `tenant_photo` | `tenants.photo_url` / `photo_path` — the tradie's own photo for the quote's "Your tradie" section. |

### 170s — roofing 3D, trust videos, quote restructure

| # | File | Purpose |
|---|---|---|
| 179 | `tenant_trade_videos` | ⚠ Adds the **column** `tenants.trade_videos` jsonb (trade → welcome/thankyou → video state). Not a table. |
| 178 | `tenant_trust_video_state` | `tenants.trust_video_state` — per-slot AI trust-video generation state. |
| 177 | `tenant_videos_bucket` | The public `tenant-videos` storage bucket. |
| 176 | `tenants_owner_mobile_optional` | `tenants.owner_mobile` becomes nullable (onboarding wizard refresh). |
| 175 | `customer_quote_five_sections` | The five-section customer quote restructure — `quotes.report_doc` / `report_style`, tenant video columns. |
| 174 | `roofing_model3d_anatomy` | Gemini roof-anatomy annotation overlays on the 3D flyover path. |
| 173 | `roofing_model3d` | Tripo 3D-model cache columns (`model3d_status`, `model3d_task_id`). |
| 172 | `roofing_semantic_edge_analysis` | `roof_edge_analyses` / `roof_edge_decisions` / `roof_topology_source_approvals`. |
| 171 | `register_roofing_trade` | Register roofing in the `trades` registry — fixes a tradie hitting the final onboarding step. |
| 170 | `roofing_layout_plan` | AI roof layout-plan cache on `roofing_measurements`. |

### 160s — Connect, Clerk, acceptance, booking

| # | File | Purpose |
|---|---|---|
| 169 | `painting_preview_image` | AI "after repaint" preview cache on `painting_measurements`. |
| 168 | `roofing_measurement_quote_link` | Link a promoted roofing measurement to its `quotes` row (`quote_id`, `quote_share_token`). |
| 167 | `trade_visit_booking` | Self-serve visit booking for roofing + painting (`scheduled_at`, `scheduled_window` on both measurement tables). |
| 166 | `crm_connection_dc` | Zoho multi-datacentre metadata on `crm_connections`. |
| 165 | `roofing_sitevisit_and_acceptance` | On-page site-visit payment + customer acceptance on the two dedicated trade pages. |
| 164 | `quote_customer_acceptance` | Record the customer's **explicit** acceptance before payment. |
| 163 | `tenants_clerk_user_id` | **`tenants.clerk_user_id`** — link accounts to Clerk. See [[Auth and Identity]]. |
| 162 | `solar_requested_size_max_100` | Realign the solar requested-size ceiling to 100 kW. |
| 161 | `full_quote_document` | Living-document quote editor — `quotes.report_doc` / `report_style`. |
| 160 | `connect_payouts` | **Stripe Connect funds flow.** `paid_amount_cents`, `platform_fee_cents`, `stripe_connect_destination`, `completed_at`, `stripe_payout_id`, `payout_amount_cents`, `payout_created_at`. See [[Stripe Connect]]. |

### 150s — painting as a trade, Canva, follow-ups

| # | File | Purpose |
|---|---|---|
| 159 | `conversation_followup_2h` | Extend the 2-hour check-in from quote level to **mid-conversation**. |
| 158 | `canva` | Canva Connect — per-tenant OAuth (`canva_connections`, `canva_designs`, `canva_oauth_states`). |
| 157 | `painting_release_gate` | **`painting_measurements.released_at`** — the price-visibility gate. Backfills every existing row to `created_at`. |
| 156 | `painting_stripe_deposit` | Per-tier Stripe links on painting. ⚠ Superseded — painting now charges only the flat $99. |
| 155 | `register_activatable_trades` | Register every dashboard-activatable trade in the registry. |
| 154 | `painting_sms_receptionist` | `sms_conversations.painting_state` + `painting_lead_requests`. |
| 153 | `tenants_welcome_email` | Welcome-email idempotency stamp. |
| 152 | `crm_integration` | `crm_connections` + `crm_contacts` — HubSpot / Zoho connect and lead import. |
| 151 | `painting_estimate_token` | `painting_measurements.estimate_token` — the tradie-facing link. |
| 150 | `flyers` | Flyer Designer: saved flyers + asset bucket. |

### 140s — tier mode, PDFs, identity, per-trade pages

| # | File | Purpose |
|---|---|---|
| 149 | `register_painting_trade` | Register residential painting in the `trades` registry. |
| 148 | `roofing_pdf_tier_mode_refresh` | Invalidate cached roofing PDFs after the tier-mode fix. |
| 147 | `tenants_default_availability` | Tradie default schedule availability + booking-window tag. |
| 146 | `quotes_pdf_signature` | **`quotes.pdf_signature`** — fingerprints what a cached PDF was rendered from, so a tier-mode change self-heals the cache. |
| 145 | `tenants_twilio_number_sid` | `tenants.twilio_number_sid` — the authoritative real-vs-stub signal (BUG-15: a real AU number can look like a stub). |
| 144 | `aircon_recommendations` | Persist the AC recommender output so it has a customer page. |
| 143 | `paint_runs_public_token` | `public_token` on `paint_runs` (commercial painting). |
| 142 | `pricing_book_quote_tier_mode` | **`pricing_book.quote_tier_mode`** — per-tenant, per-trade tier presentation. |
| 141 | `tradie_identity_fields` | `contact_name`, `website_url`, `business_address`, `logo_url` on `tenants` for the quote letterhead. |
| 140 | `roofing_measurement_selection` | `roofing_measurements.included_indices` + own share link. |

### 130s — file store, historical quotes, billing, admin

| # | File | Purpose |
|---|---|---|
| 139 | `qr_signup_destination` | A third `destination_type` on `marketing_qrs` so a QR can point at signup. |
| 138 | `tenant_feature_sources` | Provenance for a per-tenant feature toggle (`manual`\|`plan`\|`onboarding`). |
| 137 | `tenant_historical_quotes` | `tenant_historical_quotes` + `tenant_historical_import_batches` — import the tradie's quote history. |
| 136 | `tenant_file_comments` | Two-party comment thread per archived document. |
| 135 | `admin_audit_log` | Append-only trail for the admin customer console. |
| 134 | `tenant_file_store` | `tenant_file_documents` + `tenants.file_store_id`. |
| 133 | `tenants_billing_exempt` | Grandfather flag for billing enforcement. |
| 132 | `tenants_subscription` | Stripe Billing subscription columns on `tenants`. |
| 131 | `pricing_book_rate_flag` | `rate_review_flag` — tenant rates outside a sane band get flagged (R13). |
| 130 | `catalogue_integrity` | Structural catalogue integrity constraints (R11). |

### 100s–120s — solar, commercial painting, plan intake, PDFs, deterministic pricing

| # | File | Purpose |
|---|---|---|
| 129 | `supplier_price_refs` | AU price-calibration provenance for `shared_materials` prices (R12). |
| 128 | `tenants_pricing_confirmed_at` | Cold-start gate: a tenant with unconfirmed rates must not auto-quote (R14). |
| 127 | `quotes_pricing_path` | Observability columns recording HOW a quote was priced (R7 + R27). |
| 126 | `job_type_bounds` | **The R9 gross-error guard** — per-line grounding cannot see a grossly wrong total. |
| — | *(123, 124, 125 do not exist)* | ⚠ Gap in the sequence. |
| 122 | `sms_conversation_active_unique` | First-message conversation-create race backstop (R43). |
| 121 | `clarifying_questions_backfill` | Backfill `clarifying_questions` across the catalogue (R23). |
| 120 | `material_brand_category` | `shared_materials` brand A-pass for electrical + plumbing (R17). |
| 119 | `pricing_book_audit` | Read-only audit of all 7 prod `pricing_book` rows (R19). |
| 118 | `shared_assembly_bom_seed` | Seed `shared_assembly_bom` for the core electrical + plumbing assemblies (R18). |
| 117 | `solar_unknown_phase` | Preserve "Not sure" solar supply-phase answers instead of coercing to single. |
| 116 | `solar_phase_and_requested_size` | Solar phase + customer/tradie-requested system size. |
| 115 | `painting_quote_pdf` | `painting_measurements.pdf_path`. |
| 114 | `solar_multi_building` | One `solar_estimates` row acts as the property record for a multi-roof picker. |
| 113 | `qr_marketing` | `marketing_qrs` + `qr_scans` + per-tenant landing page. |
| 112 | `invitation_codes` | `onboarding_codes` + `code_redemptions` — onboarding allowlist and attribution. |
| 111 | `solar_felt_maps` | The Felt map path into ordinary `solar_estimates` rows. |
| 110 | `opensolar_proposals` | OpenSolar sub-tab persistence. |
| 109 | `pylon_settings` | Tenant hardware SKUs for Pylon supplements. |
| 108 | `pylon_proposals` | Pylon sub-tab persistence. |
| 107 | `commercial_painting` | `paint_rates` + `paint_runs` — the commercial painting stack. |
| 106 | `solar_quote_pdfs` | Solar PDF parity with electrical/plumbing. |
| 105 | `quote_pdfs` | **Gotenberg quote PDFs** — `quotes.pdf_path`. See [[Quote PDFs and Reports]]. |
| 104 | `sms_plan_estimator` | SMS electrical-plan estimator (`plan_upload_requests` over SMS). |
| 103 | `solar_panels_preview` | Gemini "panels installed" concept preview. |
| 102 | `plan_extraction_pricing` | Persist the priced BOM on a plan extraction. |
| 101 | `solar_estimates_app_contract` | The app-contract columns migration 100 missed. |
| 100 | `solar_trade_phase1` | **`solar_estimates` + `solar_config`** and the `solar` trades row. See [[Solar]]. |

### 080s–090s — roofing, painting, signage, aircon

| # | File | Purpose |
|---|---|---|
| 99 | `plan_uploads_extractions` | `plan_uploads`, `plan_upload_requests`, `plan_extractions` — the Estimator (Beta) tab. |
| 98 | `kb_sync_state` | `kb_sync_state` + dirty-tracking triggers on all public tables for the DB→KB CSV sync. |
| 97 | `aircon_trade_phase1` | Aircon trade seed. |
| 96 | `signage_two_stage` | Two-stage signage assessment. |
| 95 | `signage_brand_scoping` | Multi-brand signage tabs. |
| 94 | `brand_kb_stores` | Brand → Gemini file-search store routing. |
| 93 | `studios_geo` | Studio geo coordinates + Google place id. |
| 92 | `studios_location` | Real-location fields on `studios`. |
| 91 | `brands` | `brands` — make the compliance platform brand-agnostic (was hardcoded F45). |
| 90 | `signage_verdict_mode` | Per-rule `verdict_mode` controlling how the AI may act. |
| 89 | `painting_measurements` | **`painting_measurements`** — mirrors roofing's 081. |
| 88 | `painting_trade_phase1` | Painting trade seed. |
| 87 | `signage_compliance` | `signage_requests` / `_assessments` / `_sweeps` / `_photo_submissions` / `signage_rules`. |
| 86 | `roofing_confirm_and_preview` | Roofing customer confirmation + AI "after" preview. |
| 85 | `roofing_sms_receptionist` | **`sms_conversations.roofing_state`** + roofing `public_token`. |
| 84 | `seed_shared_gpo_recipe` | Seed the shared baseline GPO recipe for `loadDeterministicInputs`. |
| 83 | `trade_spec_defs` | Spec-aware pricing data layer — `trade_spec_defs`. |
| 82 | `catalogue_properties_index` | GIN index on `tenant_material_catalogue.properties` (fixes agreed-spec → wrong-material lock). |
| 81 | `roofing_measurements` | **`roofing_measurements`** — one row per measured job, N structures in jsonb. |
| 80 | `roofing_trade_phase1` | Roofing trade seed (the third trade). |

### 060s–070s — cleanup, observability, review policy, inspection routing

| # | File | Purpose |
|---|---|---|
| 79 | `followup_2h_checkin` | Customer 2-hour follow-up check-in. |
| 78 | `review_policy` | Two `pricing_book` columns: per-tenant review-before-send policy. |
| 77 | `agent_findings_tables` | **`eval_runs`, `eval_run_items`, `catalogue_findings`.** |
| 76 | `pipeline_traces` | **`pipeline_traces`** — Phase 7 observability. |
| 75 | `invoice_calibration_tables` | `invoice_uploads`, `invoice_extractions` and friends. |
| 74 | `price_recipes_phase_2` | Phase 2 of the price-bands recipe framework. |
| 73 | `quotes_display_mode_override` | Per-quote `display_mode` override (⚠ header says "Migration 072"). |
| 72 | `relax_inspection_triggers` | Relax three overly-broad `inspection_triggers` on assemblies. |
| 71 | `pricing_book_quote_display` | Quote display preference (summary vs itemised). |
| 70 | `import_staged_rows_source_ref` | `source_ref` + `source_document` on staged loader rows. |
| 69 | `new_install_catalogue_rows` | "New install" catalogue rows (Jon's downlight gap). |
| 68 | `gas_hws_always_inspection` | Mark "Install gas HWS" as always-inspection. |
| 67 | `row_assumptions_and_inspection_flags` | Row-level assumption + inspection flags on assemblies. |
| 66 | `outdoor_assembly_properties` | Weatherproof/outdoor properties on two electrical assemblies. |
| 65 | `easy5_clarifying_questions` | Lift the easy-5 mustAsk script into row-level `clarifying_questions`. |
| 64 | `purge_orphan_rows` | Heal + purge 520 `tenant_id IS NULL` rows found in the 2026-05-26 audit. |
| 63 | `drop_tradies` | **Drop `tradies`.** |
| 62 | `tenants_available_slots` | Move `available_slots` from `tradies` → `tenants`. |
| 61 | `drop_unused_tables` | **Drop `payments` and `quote_line_items`** (both 0 rows). |
| 60 | `rls_phase_1_extension` | RLS on the 10 tables that landed after 040. |

### 040s–050s — RLS, catalogue keystone, the trades registry, Connect state

| # | File | Purpose |
|---|---|---|
| 59 | `drop_plumbing_for_sparky` | Remove plumbing from one tenant. |
| 58 | `drop_pilot_seed_tenants` | Drop the v5 seed tenants Pilot Sparky + Pilot Plumber. |
| 57 | `voyage3_large_1024` | **Collapse `intakes.embedding` to `vector(1024)`** for voyage-3-large, NULLing every existing vector and recreating `match_intakes`. |
| 56 | `stripe_connect_state` | Connected-account readiness state on `tenants`. |
| 55 | `activate_trade_for_tenant` | `activate_trade_for_tenant()` — atomic trade activation. |
| 54 | `loader_commit_trade_defaults_prompts` | Loader commit/rollback for `trade_pricing_defaults` + `trade_prompts`. |
| 53 | `loader_commit_trades_categories` | Loader commit/rollback for `trades` + `categories`. |
| 52 | `loader_commit` | `commit_import_batch()` + rollback — atomic admin bulk loader. |
| 51 | `trade_fk_swap` | Trade CHECK → FK swap + `shared_assemblies.retired_at`. The one Phase-0 migration that ALTERs existing tables. |
| 50 | `admin_users` | The admin-auth gate. |
| 49 | `import_batches` | `import_batches` + `import_staged_rows`. |
| 48 | `trade_prompts_and_pricing_defaults` | The per-trade prompt pack and rate-card defaults. |
| 47 | `categories` | Replaces the hardcoded `Category` set in `lib/estimate/validate.ts`. |
| 46 | `trades` | **The `trades` registry.** See [[Trades Registry]]. |
| 45 | `supplier_catalogue_provenance` | CSV bulk-upload provenance. |
| 44 | `early_bird_discount` | Per-quote early-booking discount columns. See [[Pay-First Booking Funnel]]. |
| 43 | `tenant_tier_ladder` | The explicit Good/Better/Best ladder per tenant per category. |
| 42 | `tenant_material_catalogue_supplier_link` | `supplier_catalogue_id` link. |
| 41 | `supplier_catalogue` | The master library tradies browse-and-tick from. |
| 40 | `rls_phase_1` | **RLS Phase 1 — close the public-anon-key leak.** See [[Tenancy and RLS]]. |

### 002–039 — the original pipeline, SMS, multi-tenancy, the catalogue

| # | File | Purpose |
|---|---|---|
| 39 | `quote_followup_events` | CRM-style touch log. |
| 38 | `drop_stub_sparky_tenant` | Drop a stub tenant + partial unique guard on `tenants(owner_email)`. |
| 37 | `remaining_assembly_categories` | Backfill the last 11 NULL-category assemblies. |
| 36 | `core_assembly_categories` | Explicit category on the easy-5 core assemblies. |
| 35 | `sms_conversation_product_choice` | Durable mid-conversation product choice (WP9). |
| 34 | `catalogue_cost_desc_preferred` | Cost price, product description, preferred-product flag. |
| 33 | `electrical_clarifying_questions` | Electrical clarifying questions. |
| 32 | `assembly_clarifying_questions` | **`shared_assemblies.clarifying_questions`** — the per-assembly MUST-ASK script. |
| 31 | `tenant_assembly_bom` | Tenant-owned bills of materials (WP3). |
| 30 | `sms_conversations_followup_quote` | Pin WHICH quote a manual follow-up text was about. |
| 29 | `assembly_category` | **`shared_assemblies.category`** — explicit validator category. |
| 28 | `tenant_catalogue_and_bom` | Operator materials catalogue + brand/range pricing (WP2). |
| 27 | `quote_lifecycle` | Reliable quote lifecycle + follow-up support (WP7). |
| 26 | `quote_hold_and_booking` | **`quotes.price_hold_until` + `booking_state`** (WP6). |
| 25 | `pricing_book_tenant_required` | Make `pricing_book.tenant_id` REQUIRED (WP1). |
| 24 | `pricing_book_unique_full` | Make the `(tenant_id, trade)` unique index NON-partial so PostgREST upserts can infer it. |
| 23 | `tenant_custom_assemblies` | **`tenant_custom_assemblies`** — a tenant can own services the shared library lacks. |
| 22 | `tenant_material_preferences` | Preferred brands per category. |
| 21 | `services_catalogue_extras` | Services-tab catalogue extras. |
| 20 | `catalogue_gap_fills` | AU residential variants (stress test BUG H). |
| 19 | `plumbing_disposal_assembly` | Seed "Disposal and site cleanup" for plumbing. |
| 18 | `tenant_licences` | Per-trade licence storage for multi-trade tradies. |
| 17 | `multi_trade_tenants` | **`tenants.trades text[]`** + GIN index — one tradie, many trades. |
| 16 | `sms_onboarding` | SMS-initiated tradie onboarding (`sms_conversations.conversation_type`). |
| 15 | `tenants_onboarding` | **`tenants` + `tenant_service_offerings`, and `tenant_id` onto `intakes`/`quotes`/`calls`/`sms_conversations`/`customers`.** The multi-tenancy foundation. |
| — | *(014 does not exist)* | ⚠ Gap. |
| 13 | `plumbing_expansion` | Multi-trade expansion: plumbing alongside electrical (strategy v5). |
| 12 | `sms_conversation_state` | **`sms_conversations.conversation_state`** — the slot machine. |
| 11 | `preview_image_paths` | Multi-photo AI preview paths. |
| 10 | `quote_samples` | AI sample-gallery columns on `quotes`. |
| 9 | `quote_preview` | Gemini "what your job will look like" preview columns. |
| 8 | `customers` | **`customers`** — persistent customer memory keyed by phone across voice and SMS. |
| 7 | `sms_conversation_locking` | **`sms_conversations.processing_until`** — the per-conversation inflight lock. |
| 7 | `library_properties` | `properties` jsonb on `shared_materials` + `shared_assemblies`. |
| 6 | `match_intakes_job_type` | Optional `job_type_filter` on `match_intakes()`. |
| 6 | `intakes_photo_paths` | Persist storage paths, not signed URLs (signed URLs expire in 24h). |
| 5 | `sms_conversations_photos` | SMS photo parity with the voice agent. |
| 5 | `library_expansion` | Catalogue rows so the model can build meaningful Better/Best tiers. |
| 4 | `sms_messages_unique_sid` | **Unique `twilio_message_sid`** — prevents duplicate rows from webhook retries. |
| 4 | `calls_photo_request_sent_at` | Dedupe in-call vs post-call photo-request SMS. |
| 3 | `sms_messages_photos` | MMS support on `sms_messages`. |
| 2 | `sms_conversations` | **`sms_conversations` + `sms_messages`** — the SMS channel. |

---

## Migrations worth reading in full

If you only read five, read these — each one is a design document as much as a schema change:

1. **194** (`quote_chain`) — why one charge per row is structural, and why the partial unique index
   *is* the idempotency guarantee for a double-tapped button on flaky site reception.
2. **189** (`painting_quote_sent_at`) — the asymmetry argument for refusing a backfill.
3. **193** (`quotes_inspection_cause`) — a live incident (quote `7zNJCjsaxBOL_N3cATDNvQ`) turned
   into a column.
4. **057** (`voyage3_large_1024`) — the only migration that knowingly degrades a feature (RAG
   returns zero matches) until a backfill script runs, and says so.
5. **061/062/063** — how to delete a table safely: delete the readers first, prove zero call sites,
   record the row contents in the comment, then drop.

## Open questions

- Whether `intakes.embedding` in production is `vector(1024)` (post-057) while `init.sql` and the
  `match_intakes` signature there still say `vector(1536)`. The migration recreates the function at
  1024; `init.sql` was not updated. Needs a live schema check.
- Why `014` and `123`–`125` are missing. No abandoned files or comments explain the gaps.
- Migrations `123`–`125` aside, there is no ledger table recording which migrations have been
  applied to prod. Applied-state is tracked only by the runner's verification query and by whoever
  ran it.

## Related

- [[Database Overview]]
- [[Tables by Domain]]
- [[Key Columns and Invariants]]
- [[Tenancy and RLS]]
- [[The Post-Visit Quote Ladder]]
- [[Operations Overview]]
- [[Decision Log]]
