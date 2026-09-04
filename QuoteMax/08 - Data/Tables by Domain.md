---
title: Tables by Domain
type: reference
area: data
tags: [quotemax, database, schema, tables, inventory, supabase]
status: draft
updated: 2026-09-04
sources:
  - quotemate-automation/sql/init.sql
  - quotemate-automation/sql/migrations/015_tenants_onboarding.sql
  - quotemate-automation/sql/migrations/046_trades.sql
  - quotemate-automation/sql/migrations/081_roofing_measurements.sql
  - quotemate-automation/sql/migrations/089_painting_measurements.sql
  - quotemate-automation/sql/migrations/100_solar_trade_phase1.sql
  - quotemate-automation/sql/migrations/076_pipeline_traces.sql
  - quotemate-automation/sql/migrations/077_agent_findings_tables.sql
  - quotemate-automation/sql/migrations/190_trade_lead_requests.sql
---

# Tables by Domain

Every table below is evidenced by a `create table` in `quotemate-automation/sql/` **and** a
`.from('<table>')` call site in `lib/` or `app/`. The "owner" column names the module that
does most of the reading and writing — the place to look first when a column's meaning is unclear.

Reference-count figures in the notes are `.from('…')` occurrences across `lib/` + `app/`, which is a
rough proxy for how load-bearing a table is. `tenants` (129), `quotes` (125) and
`sms_conversations` (95) are the three tables the whole product is built around.

See [[Database Overview]] for how the schema is sourced, and [[Key Columns and Invariants]] for the
columns whose semantics are easy to get wrong.

---

## Trades registry

The "a trade is data, not code" layer. Adding a trade means a `trades` row plus an admin CSV load
via `/admin/loader`, not a migration. See [[Trades Registry]] and [[Admin Overview]].

| Table | Purpose | Columns that matter | Owner |
|---|---|---|---|
| `trades` | The canonical trade list. Seeded electrical + plumbing (`046_trades.sql`), then extended by `100` (solar), `149` (painting), `155` (`register_activatable_trades`), `171` (roofing). | `name` (unique slug, the value every `trade` column joins on), `display_name`, `is_job_based` (the loader only serves trades that quote a discrete job — recurring services are out of scope), `active` | `lib/trades/manageable.ts`, `lib/onboard/trade-readiness.ts` |
| `trade_prompts` | Per-trade prompt text, keyed 1:1 on `trades.id`. | `estimator_system_prompt`, `sms_scope_blurb`, `sms_trade_rules`, `voice_greeting`, `voice_system_prompt` | `lib/estimate/prompt.ts` |
| `trade_pricing_defaults` | Per-trade rate-card defaults used when a tenant has no `pricing_book` overlay. | `hourly_rate`, `call_out_minimum`, `apprentice_rate`, `senior_rate`, `default_markup_pct`, `risk_buffer_pct`, `min_labour_hours`, `licence_label` (nullable — some trades need no licence) | `lib/admin-loader/*` |
| `trade_spec_defs` | Per-`(trade, category)` spec keys the structurer is expected to fill. `hard boolean` is reserved for a must-match-or-inspection guard that is **not yet wired** (`083_trade_spec_defs.sql`). | `trade`, `category`, `spec_key`, `hard` | `lib/admin-loader/*` |
| `job_type_bounds` | The R9 gross-error band. A quote outside the band is a bug, not a price. ⚠ `trade` carries `check (trade in ('electrical','plumbing'))`, so this guard cannot be extended to another trade without a migration. | `trade`, `job_type`, `max_labour_hours`, `min_total_ex_gst`, `max_total_ex_gst`, `per_unit_labour_hours`, unique `(trade, job_type)` | `lib/estimate/run.ts` |

The EV charger row seeded in `init.sql` carries its own provenance in `notes`:
`PROVISIONAL_EV_CHARGER_BOUNDS_V1_2026-09-01` with 10h / $400–$6,000 ex-GST marked as unconfirmed.
See [[EV Charger Jobs]].

---

## Pricing and reference data

The shared, tenant-agnostic catalogue that [[Grounding Validator]] validates line items against.
If a price cannot be derived from these tables (plus the tenant overlay below), the quote is
downgraded to the inspection route.

| Table | Purpose | Columns that matter | Owner |
|---|---|---|---|
| `shared_assemblies` | The base labour+scope library, ~63 rows. One row = one quotable unit of work. | `trade`, `name`, `default_unit`, `default_unit_price_ex_gst`, `default_labour_hours`, `default_exclusions`, `category` (explicit grounding category, mig 029 — NULL falls back to a name regex), `clarifying_questions` jsonb (mig 032 — the MUST-ASK script; NULL means universal name+suburb+scope only) | `lib/estimate/tools.ts`, `lib/estimate/run.ts` |
| `shared_materials` | The base material catalogue, ~46 rows. | `trade`, `name`, `brand`, `unit`, `default_unit_price_ex_gst` | `lib/estimate/tools.ts` |
| `shared_assembly_bom` | Bill of materials linking an assembly to its materials (mig 118 seed, `185`/`186` added conditions/ratios). | assembly ref, material ref, ratio/condition columns | `lib/estimate/run.ts` |
| `shared_assembly_tasks` | Task decomposition per shared assembly (mig 184, conditions in 188). | task rows + conditions | `lib/estimate/run.ts` |
| `pricing_book` | The tenant's rate card. Per `(tenant_id, trade)` (unique index from mig 015/024/025). ~6 rows. | `hourly_rate`, `call_out_minimum`, `apprentice_rate`, `senior_rate`, `after_hours_multiplier`, `default_markup_pct`, `risk_buffer_pct`, `gst_registered`, licence fields, `overlays` jsonb (the tenant's per-item price overrides), `quote_tier_mode` (mig 142 — `single` \| `good_better_best` \| `good` \| `better` \| `best`, resolved by `lib/quote/tier-visibility.ts`) | `lib/estimate/run.ts`, `lib/quote/pdf.ts`, per-trade `pricing-context.ts` |
| `supplier_catalogue` | Supplier SKU + price reference for calibration (mig 041, provenance in 045). | supplier, sku, description, price, provenance | `lib/catalogue/*` |
| `supplier_price_refs` | Price references behind `supplier_catalogue` (mig 129). ⚠ RLS **off** and no `.from()` call sites found — reference data only. | — | (none found) |
| `paint_rates` | Commercial painting rate table — a separate stack from residential painting. | rate rows keyed by system/substrate | `lib/commercial-painting/rates.ts` |
| `signage_rules` | 882 rows of council/compliance rules the vision assessor scores against. | rule text + scoping columns (brand scoping added mig 095) | `lib/signage/run.ts` |
| `categories` | Category taxonomy for the loader (mig 047). | `name` | `lib/admin-loader/*` |
| `brands` | Brand records for signage/material scoping (mig 091). | `name`, org link | `lib/signage/brand.ts` |
| `pricing_suggestions` | Calibration suggestions surfaced to the tradie. | suggestion payload + status | `lib/estimate/*`, dashboard pricing wizard |

---

## Tenancy and onboarding

`tenants` is the root of every tenancy chain. See [[Tenancy Model]], [[Tenancy and RLS]] and
[[Tradie Onboarding]].

| Table | Purpose | Columns that matter | Owner |
|---|---|---|---|
| `tenants` | One row per tradie business. 129 `.from()` sites — the most-referenced table in the codebase. | `business_name`, `owner_email` (unique), `owner_mobile` (made optional by mig 176), `trade` (⚠ legacy scalar, still `check (trade in ('electrical','plumbing'))` from mig 015), **`trades text[]`** (mig 017, GIN-indexed — the real runtime gate), `slug`, `status` (`onboarding`\|`active`\|`suspended`), `twilio_sms_number`, `twilio_voice_number`, `twilio_number_sid` (mig 145 — the authoritative real-vs-stub signal, since a real AU number can *look* like a stub), `vapi_assistant_id`, `vapi_voice_persona`, `clerk_user_id` (mig 163), `owner_user_id` (legacy Supabase auth), `stripe_connect_account_id` + `stripe_connect_charges_enabled`/`_payouts_enabled`/`_details_submitted`/`_onboarded_at` (mig 056/160), `available_slots` jsonb (mig 062), `file_store_id`, `logo_path`/`logo_url`, `photo_path`/`photo_url`, `intro_video_*`/`thankyou_video_*` (mig 175), `trust_video_state` (178), `trade_videos` jsonb (179) | `lib/tenant/current.ts`, `lib/tenant/lookup.ts` |
| `tenant_service_offerings` | Which shared assemblies a tenant offers. 221 rows. Composite PK `(tenant_id, assembly_id)`. | `enabled` | `lib/onboard/seed-tenant-defaults.ts`, `lib/vapi/tenant-services.ts` |
| `tenant_custom_assemblies` | The tenant's own assemblies, on top of `shared_assemblies` (mig 023). A valid grounding source. | trade, name, price, labour | `lib/estimate/tools.ts`, `lib/historical-quotes/repo.ts` |
| `tenant_assembly_overrides` / `tenant_assembly_bom` / `tenant_assembly_tasks` | Per-tenant overrides of a shared assembly's price, BOM and tasks (mig 028/031/184/187). | override values keyed to the shared row | `lib/estimate/run.ts` |
| `tenant_material_catalogue` | The tenant's material list, optionally linked to `supplier_catalogue` (mig 042). 28 `.from()` sites. | name, brand, unit, price, supplier link | `lib/estimate/run.ts`, `lib/quote/quote-materials.ts` |
| `tenant_material_preferences` | Which material a tenant prefers for a given slot (mig 022). | preference mapping | `lib/estimate/run.ts` |
| `tenant_tier_ladder` | Per-tenant Good/Better/Best construction rules (mig 043). | ladder definition | `lib/estimate/run.ts` |
| `tenant_licences` | Licence records rendered on the quote letterhead. | licence type/number/state/expiry | `lib/pdf/branding.ts`, `lib/onboard/health.ts` |
| `tenant_feature_sources` | **Provenance** for a feature toggle: `manual` \| `plan` \| `onboarding`. `tenants.trades[]` is the runtime gate; this records *why* a slug is on so a plan downgrade strips only its own `plan` grants (`init.sql:404-419`). PK `(tenant_id, feature)`. | `feature`, `source`, `updated_by` | `lib/features/access.ts` |
| `tenant_file_documents` | The per-tenant file store — archived quotes, invoices, historical quote docs, synced to a KB. Unique `(tenant_id, display_name)`. | `source_kind` (`quote`\|`invoice`\|`historical_quote`), `source_id`, `storage_path`, `kb_document_id`, `state` (`pending`\|`active`\|`failed`\|`skipped`), `skip_reason`, `attempts`, `content_hash`, `comments_resolved_at`/`_by` | `lib/filestore/*` |
| `tenant_file_comments` | Flat two-party (tenant ↔ QuoteMax staff) thread per archived document. | `author_role` (`tenant`\|`admin`), `author_user_id`, `body`, `deleted_at` (soft delete) | `lib/filestore/comments.ts` |
| `tenant_historical_import_batches` | A CSV/PDF import run of the tradie's existing quote history. | `source_kind` (`csv`\|`pdf`), `status` (`parsing`→`categorizing`→`awaiting_review`→`committed`\|`failed`), `column_mapping` jsonb, `row_count` | `lib/historical-quotes/repo.ts` |
| `tenant_historical_quotes` | One historical quote row, categorised against the canonical job-type taxonomy. Deduped by unique `(tenant_id, content_hash)`. | `job_type` + `job_type_confidence` (`high`\|`medium`\|`low`), `price_ex_gst`/`price_inc_gst`, **`gst_basis`** (`inc`\|`ex`\|`unknown` — you cannot compare prices without it), `status` (`pending_review`\|`confirmed`\|`rejected`), `raw_row` jsonb | `lib/historical-quotes/repo.ts` |
| `onboarding_codes` / `code_redemptions` | Invitation codes and their redemptions (mig 112). | code, limits, redeemed-by | `lib/onboard/invitation-codes.ts` |
| `tradie_signup_intents` | A pre-account signup intent, token-addressed, so a tradie who starts from an SMS/QR resumes with context. | token, intent payload, conversation link | `lib/onboard/intent-tokens.ts` |
| `tradie_edit_patterns` | What the tradie changed on drafted quotes — feedback for prompt/pricing calibration. | pattern payload | dashboard |
| `admin_users` | QuoteMax staff accounts for `/admin/*`. | user ref, role | `lib/admin-loader/auth.ts` |
| `admin_audit_log` | Append-only trail of admin actions. Deliberately **no FKs** so it survives the tables it mirrors. | `action` (`suspend`\|`reactivate`\|`set_billing_exempt`\|`update_trades`\|`change_plan`\|`start_subscription`), `before`/`after` jsonb | `lib/admin/audit.ts` |
| `orgs` | Signage brand-org grouping above tenants (mig 094/095). | org identity, brand link | `lib/signage/org.ts` |
| `import_batches` / `import_staged_rows` | The admin CSV loader's staging area — parse, review, then commit (mig 049/052/053/054/070). | batch status, staged row payload, `source_ref` | `lib/admin-loader/store.ts` |

---

## Pipeline — shared across trades

| Table | Purpose | Columns that matter | Owner |
|---|---|---|---|
| `calls` | One row per Vapi voice call. | `vapi_call_id` (unique), `caller_number`, `transcript`, `recording_url`, `photo_urls` jsonb, `photo_request_token` (unique) + `photos_completed_at` (`sql/03_photo_capture.sql`), `photo_request_sent_at`, `tenant_id` | `lib/vapi/*`, [[Voice Channel (Vapi)]] |
| `intakes` | The structured job, whatever channel it arrived on. ~241 rows. | `job_type`, `address`, `suburb`, `scope`/`access`/`property`/`risks` jsonb, `inspection_required`, `caller`, `timing`, `confidence` + `confidence_reason`, **`embedding vector(1536)`** (the RAG key), `trade`, `tenant_id`, `call_id` | `lib/intake/structure.ts`, [[Intake Structuring]] |
| `quotes` | **The money row for every trade.** ~228 rows, ~40 columns. Full column semantics in [[Key Columns and Invariants]]. | `intake_id`, `tenant_id`, `good`/`better`/`best` jsonb (line items live here — `quote_line_items` was dropped), `needs_inspection` + `inspection_reason` + `inspection_cause` (mig 193), `selected_tier`, `subtotal_ex_gst`/`gst`/`total_inc_gst`, `share_token` (unique), `routing_decision`, `price_hold_until`, `booking_state`, `paid_at`/`paid_tier`/`paid_stripe_session_id`/`paid_amount_cents`, `platform_fee_cents`, `stripe_connect_destination`, `completed_at`/`stripe_payout_id`/`payout_amount_cents`/`payout_created_at` (mig 160), `parent_quote_id` + `quote_kind` (mig 194), `pdf_path` + `pdf_signature` (mig 105/146), `estimate_number` (mig 195), `report_doc`/`report_style` (mig 161/175), `scope_short`, `viewed_at`, `accepted_tier`, `accepted_at`, `scheduled_at` | `lib/quote/*`, `lib/estimate/run.ts` |
| `customers` | Deduplicated customer identities across channels (mig 008). 6 rows. | phone, name, `tenant_id` | `lib/customers/lookup.ts` |
| `crm_contacts` / `crm_connections` | Outbound CRM push and its per-tenant connection state (mig 152, `166_crm_connection_dc`). | connection credentials/state, contact sync status | `lib/crm/sync-runner.ts` |
| `quote_followup_events` | Follow-up sends against a quote (mig 039). | quote ref, event kind, sent-at | `lib/quote/followup-contact.ts` |
| `trade_lead_requests` | **One self-serve quote-request form table for every trade** (mig 190). Token-addressed at `/quote-request/[token]`. | `token` (PK, 32 hex from `crypto.randomBytes(16)`), `trade` (deliberately **no** check constraint — a new trade must never need a migration), `tenant_id`, `conversation_id`, `customer_phone`, `status` (`pending`\|`submitted`\|`expired`, **checked** — `painting_lead_requests` left it unconstrained and drifted), `quote_token` | `lib/sms/*`, `app/api/*` |
| `painting_lead_requests` | The painting-only predecessor (mig 154). ⚠ Deliberately untouched by 190; a follow-up spec retires it. RLS **off**. | token, tenant, status (unconstrained) | painting form routes |
| `push_tokens` / `push_tickets` / `push_events` / `push_event_deliveries` | Mobile push registration and delivery receipts (mig 191). | device token, ticket id, event payload, delivery state | `lib/push/*` |

---

## Pipeline — per trade

Each trade owns a measurement/estimate table. The pattern is identical: denormalised summary
columns for fast list views, plus the full engine payload in jsonb — "mirroring how quotes embed
good/better/best rather than normalising line items" (`081_roofing_measurements.sql:8-9`).

### Roofing — `lib/roofing/*`, [[Roofing]]

| Table | Purpose | Columns that matter |
|---|---|---|
| `roofing_measurements` | One row per measured job, N structures in jsonb. 66 `.from()` sites. | `address`, `provider` (`geoscape`\|`lidar`\|`mock`\|`manual`), `structure_count`, `combined_area_m2`, `combined_better_inc_gst`, `routing`, `structures` jsonb (`[{buildingId, role, label, metrics, inputs, price}]`), `quote` jsonb (the full MultiRoofQuote), **`public_token`** (customer `/q/roof/…`) and **`measure_token`** (tradie `/m/…`, default added mig 182), `included_indices int[]` + `confirmed_structure`/`confirmed_at` (mig 086/140), `quote_id` + `quote_share_token` (mig 168), `paid_at`/`paid_tier`/`paid_amount_cents` (mig 165/181), `scheduled_at`/`scheduled_window` (mig 167), `pdf_path`, `layout_plan` jsonb + `layout_status` (mig 170), `model3d_status`/`model3d_task_id`/`model3d_anatomy` (mig 173/174 — Tripo) |
| `roof_edge_analyses` / `roof_edge_decisions` / `roof_topology_source_approvals` | Semantic edge analysis and its human decisions (mig 172). | analysis payload, decision, approval |
| `roofing_quote_revisions` | Revision history on a roofing quote. | revision payload |

### Solar — `lib/solar/*`, [[Solar]]

| Table | Purpose | Columns that matter |
|---|---|---|
| `solar_estimates` | The deterministic engine's output. 44 `.from()` sites. | `public_token` (**not null unique**), `intake_id`, `quote_id` (the twin `quotes` row for the generic funnel), `network` (DNSP, drives FiT + export limit), `coverage_source` (`google`\|`manual`), `imagery_quality`/`imagery_date`, `confidence_band` (`tight`\|`wide`), `roof`/`sizing`/`production`/`price`/`economics` jsonb, `guardrail_flags` jsonb, `routing` (`tradie_review`\|`inspection_required`\|`auto_quote`), `config_version` (which `solar_config` row priced it), `confirmed_at` (the release gate — ⚠ see [[Known Debt Register]]: token routes check `routing` but not this) |
| `solar_config` | Versioned pricing/economics constants, `version text primary key` and stamped onto every estimate. | `deeming_schedule`, `zone_table` (postcode→STC zone rating), `stc_price_aud`, `feed_in`, `export_limits`, `default_rate_card`, `derate_factor`, `self_consumption_pct`, `retail_rate_aud_per_kwh`, `active` |
| `solar_building_cache` | Cached Google Solar building-insights responses (mig 114). | address/building key, payload |
| `opensolar_proposals` / `pylon_proposals` | Background third-party cross-check results that can add guardrail flags (mig 108/110). | proposal payload, status |

### Painting — `lib/painting/*`, [[Painting]]

| Table | Purpose | Columns that matter |
|---|---|---|
| `painting_measurements` | One row per saved/drafted painting estimate. 37 `.from()` sites. | `scopes text[]` (`walls`\|`ceilings`\|`trim`\|`exterior`), `floor_area_m2`, `total_area_m2`, `confidence`, `better_inc_gst`, `routing`, `inputs`/`estimate` jsonb, `source` (`rea`\|`solar`\|`geoscape`\|`domain`\|`mock`\|`manual`), `public_token` (unique partial index), `estimate_token` (mig 151), **`released_at`** (mig 157 — may the customer see prices) and **`quote_sent_at`** (mig 189 — did a carrier accept the message; **these answer different questions**), `stripe_links` jsonb (⚠ dead writes — nothing reads them since [[What the Customer Pays by Trade]] went flat-$99), `customer_accepted_at`/`_tier` (mig 164), `paid_at`/`paid_amount_cents`, `scheduled_at`/`scheduled_window`, `pdf_path`, `preview_image_path`/`preview_status` (mig 169) |
| `paint_runs` | Commercial painting runs — a **separate stack** from residential (mig 107, public token mig 143). 21 `.from()` sites. | run payload, `public_token` |

### Aircon and plan intake — `lib/aircon/*`, `lib/estimation/*`, [[Aircon]]

| Table | Purpose | Columns that matter |
|---|---|---|
| `aircon_recommendations` | Sizing/design output per job (mig 144). | recommendation payload, tenant/intake link |
| `plan_upload_requests` | A request for the customer to upload a floor plan (mig 099). | token, status, conversation link |
| `plan_uploads` | The uploaded plan file. | storage path, request link |
| `plan_extractions` | The extracted + priced result of a plan (mig 099/102). 21 `.from()` sites. | extraction jsonb, pricing |

### Signage — `lib/signage/*`, [[Signage]]

| Table | Purpose |
|---|---|
| `signage_requests` | One assessment request (mig 087). |
| `signage_assessments` | The vision verdict against `signage_rules` (verdict mode mig 090, two-stage mig 096). |
| `signage_sweeps` | A batch sweep across many sites. |
| `signage_photo_submissions` | Customer photo submissions feeding an assessment. |

---

## SMS

The busiest surface in the product: 2597 `sms_messages` across 210 conversations. See
[[SMS Channel Overview]] and [[SMS Inbound Route]].

| Table | Purpose | Columns that matter | Owner |
|---|---|---|---|
| `sms_conversations` | One thread per customer number. 95 `.from()` sites. | `from_number`/`to_number` (E.164), `status` (`open`\|`structuring`\|`done`\|`abandoned`), `turn_count`, `intake_id` (set at handoff to `structureIntake`), `assumptions_made` jsonb, `tenant_id`, `customer_id`, **`conversation_type`** (default `customer_quote`, mig 016 — a tradie-onboarding thread is not a quote thread), **`conversation_state`** jsonb (mig 012 — the electrical/plumbing slot machine), **`roofing_state`** jsonb (mig 085) and **`painting_state`** jsonb (mig 154) — the three are separate columns, not one polymorphic blob, `processing_until` (the inflight lock, mig 007 — ⚠ 60s vs a ~200–300s worst-case turn), `photo_paths text[]`, `photo_request_token`/`_sent_at`, `product_choice` jsonb (mig 035), `followup_quote` jsonb (mig 030), `followup_2h_sent_at` (mig 159), `lead_push_sent_at` | `lib/sms/*` |
| `sms_messages` | Every inbound and outbound message. | `conversation_id`, `direction` (`inbound`\|`outbound`), `body`, `twilio_message_sid` (**unique**, mig 004 — this is the Twilio webhook idempotency key) | `lib/sms/*` |
| `lead_throttle` | Rate-limit state for outbound lead pushes. ⚠ No `.from()` call sites found in `lib/` or `app/` — possibly dead. | throttle key + window | (none found) |

The unique index on `twilio_message_sid` is the whole retry story: Twilio re-delivers webhooks, and
the insert conflicting is how a duplicate turn is detected. Migration 122 added an active-conversation
unique constraint on top.

---

## Integrations and assets

Marketing, studio and third-party surfaces. See [[Studio and Marketing Assets]] and
[[External Services and Integrations]].

| Table | Purpose | Owner |
|---|---|---|
| `canva_connections` / `canva_designs` / `canva_oauth_states` | Canva OAuth tokens, the designs generated, and the CSRF state for the OAuth dance (mig 158). | `lib/canva/tokens.ts` |
| `flyers` | Generated flyer assets (mig 150). | `lib/flyer/*` |
| `marketing_qrs` / `qr_scans` | Marketing QR codes and their scan events (mig 113, signup destination mig 139). | `lib/marketing/*` |
| `studios` | Studio records with geo (mig 092/093). | `lib/studio/*` |
| `email_campaigns` / `email_sends` / `email_unsubscribes` | Resend campaign definitions, per-recipient sends, and the suppression list. | `lib/email/*` |
| `invoice_uploads` / `invoice_extractions` | Supplier invoice upload → extraction, feeding pricing calibration (mig 075). | `lib/invoice/*`, `lib/filestore/source-doc.ts` |
| `kb_sync_state` | Sync cursor for the knowledge-base export (mig 098). ⚠ RLS **off**. | `lib/kb-sync/*` |
| `catalogue_findings` | Agent-detected catalogue problems awaiting review: `price_drift`, `description_mismatch`, `sku_missing`, `category_mismatch`, scoped to one of four `source_table` values, `status` `pending`→`approved`\|`rejected`\|`applied`. | `lib/agents/*` |

---

## Eval and observability

There is no Sentry and no PostHog. These two tables plus platform logs are the whole story —
see [[Observability and Tracing]].

| Table | Purpose | Columns that matter | Owner |
|---|---|---|---|
| `pipeline_traces` | One row per pipeline step, ~1661 rows. Fire-and-forget writes that **never block the request**. FKs are `on delete set null`, deliberately: "CASCADE would silently wipe the evidence of bugs we may want to audit weeks later" (`076_pipeline_traces.sql:6-8`). | `step` (`sms_inbound`, `extract_slots`, `dialog`, `intake_structurer`, `estimate`, `dispatch`) + `substep` — both free text so a new stage needs no migration, `status` (`ok`\|`warn`\|`err`), `message`, `inputs`/`outputs`/**`decisions`** jsonb ("not the data, the reasoning"), `duration_ms`, `intake_id`/`sms_conversation_id`/`tenant_id` | `lib/log/trace.ts`, `lib/log/pipeline.ts` |
| `eval_runs` | One scoring run of the estimator against fixtures. | `prompt_version`, `catalogue_version`, `total_score`, `per_category` jsonb, `started_at`/`completed_at` | `/admin/agents/eval-fixture` |
| `eval_run_items` | One fixture's result, scored on five dimensions. 55 rows. | `intake_fixture_id`, `expected`/`actual` jsonb, `dim_price`, `dim_material`, `dim_tier`, `dim_scope`, `dim_routing`, `notes` | `/admin/agents/eval-fixture` |

⚠ The five-dimension rubric exists in the schema; the 100-pair hold-out set does not. See
[[Known Debt Register]].

---

## Backup and staging tables

Created by migrations that rewrote a table's shape, kept for rollback. Named `*_backup_mig*` and
carrying RLS **off**: `painting_measurements_backup_mig`, `shared_assembly_bom_backup_mig`,
`shared_assembly_tasks_backup_mig`, `tenant_assembly_bom_backup_mig`,
`tenant_assembly_tasks_backup_mig`, `trade_lead_requests_backup_mig`. No application code reads
them. Do not treat them as current.

---

## ⚠ Drift against CLAUDE.md

`quoteMate/CLAUDE.md` lists two entries under "Pipeline (per trade)" and "Tenancy" that are
**columns, not tables**:

| CLAUDE.md says | Reality | Evidence |
|---|---|---|
| `trade_paid_amount` (a table, "mig 181") | Migration 181 adds a **column** `paid_amount_cents` to `roofing_measurements` **and** `painting_measurements`. There is no `trade_paid_amount` table and no code references the name. | `sql/migrations/181_trade_paid_amount.sql:13-17` |
| `tenant_trade_videos` (a table) | Migration 179 adds a **column** `tenants.trade_videos jsonb`, keyed trade → `welcome`/`thankyou` → `{url, status, operation, script, error, updated_at, source}`. | `sql/migrations/179_tenant_trade_videos.sql:33` |

Both names are the migration *filename*, which is where the confusion comes from.

## Open questions

- `lead_throttle` and `supplier_price_refs` have DDL but no `.from()` call sites in `lib/` or
  `app/`. Dead, or written only from `scripts/`? Worth a grep over `scripts/` before removing.
- Exact live row counts are quoted from CLAUDE.md's snapshot, not verified here.

## Related

- [[Database Overview]]
- [[Key Columns and Invariants]]
- [[Migrations]]
- [[Tenancy and RLS]]
- [[Trades Registry]]
- [[The Four Pipelines]]
- [[Observability and Tracing]]
