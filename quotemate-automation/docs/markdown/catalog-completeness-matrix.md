# Catalog Completeness Matrix (R16 + R20)

> **Purpose.** Defines, column-by-column, exactly what the A-pass (data-population agents) must populate across the 9 catalog tables, and — critically — which columns are **RESERVED / UNWIRED** and must **NOT** be filled (R20).
> **Scope.** Electrical + plumbing only. Roofing / aircon / solar / painting / signage rows are explicitly excluded from every fill-state count below.
> **Method.** Schema + fill state queried **prod read-only** (`SUPABASE_DB_URL`, ref `bobvihqwhtcbxneelfns`) on 2026-06-18. Wiring confirmed by grepping the codebase for each column's consumers. jsonb `'{}'` / `'[]'` / `'null'` / `''` treated as **empty**; text-array `'{}'` treated as empty; blank/whitespace text treated as empty.
> **Fill state notation.** `filled / total` where total = electrical+plumbing rows in that table (tables without a `trade` column count all rows; noted inline).

---

## CONFIRMED DRIFT vs the spec's seed findings

| Seed claim (to confirm) | Verdict | Evidence |
|---|---|---|
| `apprentice_rate` / `senior_rate` / `after_hours_multiplier` are "not used by the estimator" (dead) | **STALE — they are WIRED.** Treat as live. | `lib/estimate/validate.ts` reads all three in the grounding check: `apprentice_rate` (L702, L863-883), `senior_rate` (L704-705, L863-883), `after_hours_multiplier` (L738-739, L44-49 — accepts `hourly_rate × after_hours_multiplier` and `call_out_minimum × after_hours_multiplier` as valid grounded rates). |
| "43 shared_assemblies (20 electrical / 23 plumbing)" (CLAUDE.md) | **STALE — catalog has grown.** | Prod: `shared_assemblies` = **65 total / 49 electrical+plumbing**; `shared_materials` = **46 total / 38 electrical+plumbing**; `pricing_book` = **7 total / 7 electrical+plumbing**. |
| `tenant_custom_assemblies` "0 rows" (CLAUDE.md) | **STALE.** | Prod: 3 electrical+plumbing rows. |
| `tenant_material_preferences` "0 rows" (CLAUDE.md) | **STALE.** | Prod: 27 rows (no `trade` column). |

---

## How to read the "MEANT-TO-CARRY-DATA-NOW vs RESERVED/UNWIRED" column

- **CARRY** = a live consumer reads this column for electrical/plumbing today; the A-pass should populate it where a real AU source or the row's own structural definition supports a value.
- **RESERVED (feature)** = the column is defined but its only consumers are a gating feature that is OFF / not-wired for electrical+plumbing, or an out-of-scope trade. **Do NOT fill these in the A-pass** (R20). The gating feature is named.
- **STRUCTURAL / SYSTEM** = id / FK / timestamp / default-bearing flag the system manages; A-pass does not hand-author these.

---

## 1. `shared_assemblies` — base assembly library (49 electrical+plumbing of 65 total)

| column | type | nullable | CARRY vs RESERVED | fill (e+p) | intended fill source |
|---|---|---|---|---|---|
| id | uuid | NO | STRUCTURAL (gen_random_uuid) | 49/49 | system |
| trade | text | NO | CARRY (scoping key) | 49/49 | `'electrical'`/`'plumbing'` |
| name | text | NO | CARRY | 49/49 | assembly definition |
| description | text | YES | CARRY (customer-facing scope text) | 49/49 | assembly definition |
| default_unit | text | YES | CARRY | 49/49 | structural (`each`/`point`/`m` etc.) |
| default_unit_price_ex_gst | numeric | YES | CARRY (grounded price) | 49/49 | Reece/Tradelink/Bunnings list + NECA/QBCC labour |
| default_labour_hours | numeric | YES | CARRY | 49/49 | NECA/QBCC norms |
| default_exclusions | text | YES | CARRY (G/B/B framing) | 49/49 | assembly definition |
| properties | jsonb | YES | CARRY (spec-match: `color_temp`/`dimmable`/`smart`/`weatherproof`/`supplied_by`) — wired in `lib/estimate/tools.ts` L71-76 | 18/49 | structural spec of the assembly |
| default_enabled | boolean | NO | STRUCTURAL flag (default true) | 49/49 | system |
| category | text | YES | CARRY (routing/grouping) | 49/49 | category taxonomy (migrations 029/036/037) |
| clarifying_questions | jsonb | YES | CARRY (SMS/voice dialog) — wired in `lib/sms/*` | 47/49 | assembly definition |
| retired_at | timestamptz | YES | STRUCTURAL (soft-delete marker) | 0/49 | system on retirement — leave empty |
| row_assumptions | jsonb | YES | CARRY (quote assumption lines) — wired `lib/sms/assumptions.ts` (migration 067) | 5/49 | assembly definition |
| always_inspection | boolean | YES | CARRY (routing override) — wired in validator/routing | 49/49 | trade safety rules (e.g. gas HWS migration 068) |
| inspection_triggers | text[] | YES | CARRY (conditional inspection routing) | 4/49 | trade safety rules (migration 067/072) |
| price_recipe | jsonb | YES | CARRY (Phase-2 deterministic pricing) — wired `lib/estimate/merge-recipes.ts` (migration 074/084) | 1/49 | recipe authoring; **sparse by design** — only seeded rows so far |

## 2. `shared_materials` — base material library (38 electrical+plumbing of 46 total)

| column | type | nullable | CARRY vs RESERVED | fill (e+p) | intended fill source |
|---|---|---|---|---|---|
| id | uuid | NO | STRUCTURAL | 38/38 | system |
| trade | text | NO | CARRY (scoping key) | 38/38 | `electrical`/`plumbing` |
| name | text | NO | CARRY | 38/38 | material definition |
| brand | text | YES | CARRY | 30/38 | AU supplier brand (Clipsal/HPM/Reece etc.) |
| unit | text | YES | CARRY | 38/38 | structural |
| default_unit_price_ex_gst | numeric | YES | CARRY (grounded price) | 38/38 | Reece/Bunnings/Tradelink list price |
| properties | jsonb | YES | CARRY (spec-match consumed by tools) | 16/38 | structural spec (color_options, dimmable, etc.) |
| category | text | YES | CARRY (BOM `material_category` join key) | 38/38 | category taxonomy |

## 3. `shared_assembly_bom` — base bill-of-materials (3 electrical+plumbing of 3 total)

| column | type | nullable | CARRY vs RESERVED | fill (e+p) | intended fill source |
|---|---|---|---|---|---|
| id | uuid | NO | STRUCTURAL | 3/3 | system |
| assembly_id | uuid | NO | CARRY (FK → shared_assemblies) | 3/3 | join |
| trade | text | NO | CARRY (scoping key) | 3/3 | inherited from assembly |
| material_category | text | NO | CARRY (joins to shared_materials.category) | 3/3 | category taxonomy |
| description | text | YES | CARRY (BOM line label) | 0/3 | BOM authoring — **A-pass gap** |
| quantity | numeric | NO | CARRY (default 1) | 3/3 | BOM authoring |
| required | boolean | NO | STRUCTURAL flag (default true) | 3/3 | BOM authoring |
| sort | integer | NO | STRUCTURAL (display order) | 3/3 | system |
| created_at | timestamptz | NO | STRUCTURAL | 3/3 | system |

> ⚠ `shared_assembly_bom` is near-empty (3 rows total). Deterministic-BOM (`lib/estimate/deterministic-bom.ts`) consumes it; expanding it is a candidate A-pass target, but only with verified material categories — **flag, do not invent quantities**.

## 4. `pricing_book` — per-tenant per-trade rate card (7 electrical+plumbing of 7 total)

| column | type | nullable | CARRY vs RESERVED | fill (e+p) | intended fill source |
|---|---|---|---|---|---|
| id | uuid | NO | STRUCTURAL | 7/7 | system |
| hourly_rate | numeric | YES | CARRY (grounding base rate) | 7/7 | NECA(NSW)/QBCC(QLD) award + tenant overlay |
| call_out_minimum | numeric | YES | CARRY (grounding) | 7/7 | tenant rate card |
| apprentice_rate | numeric | YES | **CARRY — WIRED** (validate.ts L702/L863-883) | 7/7 | AU apprentice award rate |
| default_markup_pct | numeric | YES | CARRY (grounding) | 7/7 | tenant rate card (elec ≈28-36%, plumb ≈15-20%) |
| risk_buffer_pct | numeric | YES | CARRY (grounding) | 7/7 | tenant rate card |
| gst_registered | boolean | YES | STRUCTURAL flag | 7/7 | tenant fact |
| licence_type | text | YES | CARRY (licence footer) | 1/7 | tenant licence — **owner input** |
| licence_number | text | YES | CARRY (licence footer) | 1/7 | tenant licence — **owner input, never fabricate** |
| licence_state | text | YES | CARRY | 6/7 | tenant fact (NSW/QLD) |
| licence_expiry | date | YES | CARRY | 1/7 | tenant licence — **owner input** |
| overlays | jsonb | YES | **RESERVED for elec/plumb (early_bird offer config)** — gating feature: `EARLY_BIRD` discount, read `app/api/estimate/draft/route.ts:439` + `lib/quote/early-bird.ts`; other overlay keys are out-of-scope trades (painting/roofing/solar/aircon rate cards). **Do NOT fill** unless an owner configures an early-bird offer. | 2/7 | owner-configured offer only |
| min_labour_hours | numeric | YES | **CARRY — WIRED** (validate.ts L709-710) | 7/7 | tenant rate card (default 2.0) |
| trade | text | NO | CARRY (scoping key) | 7/7 | `electrical`/`plumbing` |
| tenant_id | uuid | NO | CARRY (FK → tenants) | 7/7 | tenant |
| senior_rate | numeric | YES | **CARRY — WIRED** (validate.ts L704-705/L863-883) | 7/7 | AU senior/leading-hand award rate |
| after_hours_multiplier | numeric | YES | **CARRY — WIRED** (validate.ts L738-739, default 1.5) | 7/7 | AU after-hours penalty norm |
| quote_display | text | NO | STRUCTURAL config (`itemised`/...) — wired `lib/quote/display.ts` | 7/7 | tenant preference |
| review_policy | text | NO | STRUCTURAL config (`auto_send`/...) — wired `lib/quote/review-policy.ts` | 7/7 | tenant preference |
| review_threshold_inc_gst | numeric | NO | STRUCTURAL config (default 0) | 7/7 | tenant preference |
| followup_2h_enabled | boolean | NO | **RESERVED (feature: 2-hour follow-up check-in)** — gating feature wired `lib/quote/followup-2h.ts` (migration 079) but a tenant toggle, default false. **Do NOT fill** — owner toggle. | 7/7 (all false) | owner toggle |

## 5. `tenant_material_catalogue` — tenant's branded products (30 electrical+plumbing of 30 total)

| column | type | nullable | CARRY vs RESERVED | fill (e+p) | intended fill source |
|---|---|---|---|---|---|
| id | uuid | NO | STRUCTURAL | 30/30 | system |
| tenant_id | uuid | NO | CARRY (FK) | 30/30 | tenant |
| trade | text | NO | CARRY (scoping key) | 30/30 | `electrical`/`plumbing` |
| category | text | NO | CARRY (match key) | 30/30 | category taxonomy |
| name | text | NO | CARRY | 30/30 | product definition |
| brand | text | YES | CARRY (tier resolution + label) — wired `lib/estimate/catalogue.ts` | 30/30 | AU supplier brand |
| range_series | text | YES | CARRY (tier resolution L177-178) | 30/30 | product range |
| supplier | text | YES | CARRY | 28/30 | Reece/Bunnings/etc. |
| unit | text | YES | CARRY (default `each`) | 30/30 | structural |
| unit_price_ex_gst | numeric | NO | CARRY (grounded price) | 30/30 | supplier list price |
| customer_supply_price_ex_gst | numeric | YES | **RESERVED-ish (feature: customer-supply pricing)** — read `lib/estimate/catalogue.ts:364` but sparsely used; per-product alternative-supply price. **Do NOT bulk-fill** — only where the tenant offers customer-supply on that line. | 5/30 | owner input per product |
| tier_hint | text | YES | **RESERVED override (feature: explicit tier pin)** — wired `lib/estimate/catalogue.ts` L79/L177-184 but it is an *operator escape hatch* (pin Good/Better/Best); tier normally derives from brand/range. **Do NOT mass-fill** — owner pins only. | 29/30 | owner input (escape hatch) |
| image_path | text | YES | **RESERVED (feature: WP4 product-image render)** — render-only metadata, "never affects price" per `lib/sms/product-options.ts:258-272`. Populated by the image pipeline, **not** the pricing A-pass. **Do NOT fill.** | 5/30 | image-gen / upload pipeline |
| properties | jsonb | YES | CARRY (spec-match) | 10/30 | structural product spec |
| active | boolean | NO | STRUCTURAL flag (default true) | 30/30 | system/owner |
| created_at | timestamptz | NO | STRUCTURAL | 30/30 | system |
| updated_at | timestamptz | NO | STRUCTURAL | 30/30 | system |
| cost_price_ex_gst | numeric | YES | **RESERVED (feature: margin display)** — dashboard-only margin reference (`app/dashboard/page.tsx` L7905, tenant catalogue API); NOT a pricing-engine input. **Do NOT fill** in the pricing A-pass — owner enters their own cost. | 5/30 | owner input |
| description | text | YES | CARRY (product blurb, render) | 4/30 | product definition |
| is_preferred | boolean | NO | STRUCTURAL flag (tie-break, default false) — wired `lib/sms/product-options.ts` L147 | 30/30 | owner preference |
| supplier_catalogue_id | uuid | YES | STRUCTURAL FK → supplier_catalogue (provenance, migration 042/045) | 23/30 | loader linkage |

## 6. `tenant_custom_assemblies` — tenant-owned assemblies (3 electrical+plumbing of 3 total)

| column | type | nullable | CARRY vs RESERVED | fill (e+p) | intended fill source |
|---|---|---|---|---|---|
| id | uuid | NO | STRUCTURAL | 3/3 | system |
| tenant_id | uuid | NO | CARRY (FK) | 3/3 | tenant |
| trade | text | NO | CARRY (scoping key) | 3/3 | `electrical`/`plumbing` |
| name | text | NO | CARRY | 3/3 | tenant definition |
| description | text | YES | CARRY | 3/3 | tenant definition |
| default_unit | text | YES | CARRY (default `each`) | 3/3 | structural |
| default_unit_price_ex_gst | numeric | NO | CARRY (grounded price) | 3/3 | tenant pricing |
| default_labour_hours | numeric | NO | CARRY (default 0) | 3/3 | tenant definition |
| default_exclusions | text | YES | CARRY | 2/3 | tenant definition |
| properties | jsonb | YES | CARRY (spec-match) | 0/3 | tenant spec |
| always_inspection | boolean | NO | CARRY (routing) | 3/3 | tenant safety rule |
| inspection_triggers | text[] | NO | CARRY (routing) | 0/3 | tenant safety rule |
| enabled | boolean | NO | STRUCTURAL flag (default true) | 3/3 | system/owner |
| created_at | timestamptz | NO | STRUCTURAL | 3/3 | system |
| updated_at | timestamptz | NO | STRUCTURAL | 3/3 | system |
| category | text | YES | CARRY | 1/3 | category taxonomy |
| clarifying_questions | jsonb | YES | CARRY (dialog) | 0/3 | tenant definition |
| row_assumptions | jsonb | YES | CARRY (assumption lines) | 0/3 | tenant definition |
| price_recipe | jsonb | YES | CARRY (Phase-2 deterministic pricing) | 0/3 | recipe authoring — **sparse by design** |

> Tenant-owned table: A-pass populates only via the tenant's own data, **not** from generic AU sources. Hand-authored gaps here are owner input.

## 7. `tenant_assembly_bom` — tenant BOM overlay (5 electrical+plumbing of 5 total)

| column | type | nullable | CARRY vs RESERVED | fill (e+p) | intended fill source |
|---|---|---|---|---|---|
| id | uuid | NO | STRUCTURAL | 5/5 | system |
| tenant_id | uuid | NO | CARRY (FK) | 5/5 | tenant |
| assembly_id | uuid | NO | CARRY (FK) | 5/5 | join |
| trade | text | NO | CARRY (scoping key) | 5/5 | `electrical`/`plumbing` |
| material_category | text | NO | CARRY | 5/5 | category taxonomy |
| description | text | YES | CARRY (BOM line label) | 1/5 | BOM authoring — **A-pass gap** |
| quantity | numeric | NO | CARRY (default 1) | 5/5 | BOM authoring |
| required | boolean | NO | STRUCTURAL flag (default true) | 5/5 | BOM authoring |
| sort | integer | NO | STRUCTURAL | 5/5 | system |
| created_at | timestamptz | NO | STRUCTURAL | 5/5 | system |
| updated_at | timestamptz | NO | STRUCTURAL | 5/5 | system |

## 8. `tenant_material_preferences` — soft brand hints (27 rows; NO `trade` column)

| column | type | nullable | CARRY vs RESERVED | fill | intended fill source |
|---|---|---|---|---|---|
| tenant_id | uuid | NO | CARRY (FK, composite PK) | 27/27 | tenant |
| category | text | NO | CARRY (composite PK) | 27/27 | category taxonomy |
| preferred_brand | text | NO | CARRY (soft hint) | 27/27 | owner preference |
| updated_at | timestamptz | NO | STRUCTURAL | 27/27 | system |

> No `trade` column — counts are all rows. Fully populated (NOT NULL PK columns). No A-pass gap; this table is owner-driven brand preference, not a pricing source.

## 9. `tenant_assembly_overrides` — per-tenant assembly tweaks (0 rows; NO `trade` column)

| column | type | nullable | CARRY vs RESERVED | fill | intended fill source |
|---|---|---|---|---|---|
| tenant_id | uuid | NO | CARRY (FK, composite PK) | 0/0 | tenant |
| assembly_id | uuid | NO | CARRY (composite PK) | 0/0 | join |
| enabled | boolean | NO | STRUCTURAL flag (default true) | 0/0 | owner toggle |
| labour_hours_override | numeric | YES | CARRY (override) — wired `lib/estimate/catalogue.ts` L236 | 0/0 | owner input |
| markup_pct_override | numeric | YES | CARRY (override) — wired `lib/estimate/catalogue.ts` L237 | 0/0 | owner input |
| notes | text | YES | CARRY | 0/0 | owner input |
| updated_at | timestamptz | NO | STRUCTURAL | 0/0 | system |

> **Empty table (0 rows), but WIRED** — `lib/estimate/catalogue.ts` reads `labour_hours_override` / `markup_pct_override` to override base assemblies. It is empty by design (no tenant has tweaked a base assembly yet). The A-pass should **not** seed this — it is purely owner-driven override data. Not a reserved/dead table; an empty-but-live one.

---

## R20 — RESERVED / UNWIRED columns (do NOT fill in the A-pass)

These are intentionally empty (or owner/feature/system-driven) for electrical+plumbing. Each is named with its gating feature:

| table.column | why reserved | gating feature |
|---|---|---|
| `pricing_book.overlays` | only the `early_bird` key applies to elec/plumb; all other keys are out-of-scope trades | **EARLY_BIRD** offer config (owner-configured) |
| `pricing_book.followup_2h_enabled` | tenant toggle, default false, off for all 7 | **2-hour follow-up check-in** (migration 079) |
| `tenant_material_catalogue.tier_hint` | operator escape-hatch to pin a tier; tier normally derives from brand/range | **explicit tier pin** override |
| `tenant_material_catalogue.image_path` | render-only metadata, "never affects price" | **WP4 product-image render** pipeline |
| `tenant_material_catalogue.cost_price_ex_gst` | dashboard margin-display only, not a pricing input | **margin display** (owner cost) |
| `tenant_material_catalogue.customer_supply_price_ex_gst` | per-line customer-supply price, owner-specific, sparse by design | **customer-supply pricing** |
| `shared_assemblies.retired_at` / `tenant_custom_assemblies` timestamps / `created_at`/`updated_at` everywhere | system-managed soft-delete / audit timestamps | system lifecycle |
| `shared_assemblies.price_recipe`, `tenant_custom_assemblies.price_recipe` | sparse by design (Phase-2 deterministic pricing; only seeded rows) — populate only with a verified recipe, never invented | **Phase-2 price recipes** (migration 074/084) |
| **whole table** `tenant_assembly_overrides` | empty-but-wired; owner-driven override data only | per-tenant assembly override (owner input) |

**Important nuance:** `apprentice_rate`, `senior_rate`, `after_hours_multiplier`, `min_labour_hours` are **NOT** reserved — they are WIRED into the grounding validator (confirmed drift above). They belong in the MEANT-TO-CARRY list.

---

## R16 — MEANT-TO-CARRY-DATA-NOW columns (the A-pass target set)

Columns the A-pass should populate from verified AU sources or the row's own structural definition (never fabricated):

**Grounded prices / rates (Reece/Bunnings/Tradelink lists + NECA/QBCC/AU award):**
`shared_assemblies.default_unit_price_ex_gst`, `shared_assemblies.default_labour_hours`, `shared_materials.default_unit_price_ex_gst`, `tenant_material_catalogue.unit_price_ex_gst`, `tenant_custom_assemblies.default_unit_price_ex_gst`, `tenant_custom_assemblies.default_labour_hours`, `pricing_book.hourly_rate`, `pricing_book.call_out_minimum`, `pricing_book.apprentice_rate`, `pricing_book.senior_rate`, `pricing_book.after_hours_multiplier`, `pricing_book.min_labour_hours`, `pricing_book.default_markup_pct`, `pricing_book.risk_buffer_pct`.

**Definitional / structural text & spec (from the row's own definition):**
`name`, `description`, `default_unit`/`unit`, `default_exclusions`, `category`, `brand`, `range_series`, `supplier`, `properties` (color_temp/dimmable/smart/weatherproof/supplied_by), `clarifying_questions`, `row_assumptions`, `always_inspection`, `inspection_triggers`, `material_category`, BOM `description`/`quantity`/`required`, `trade` (scoping key on every trade-scoped table).

**Owner-input (flag, never fabricate):**
`pricing_book.licence_type`/`licence_number`/`licence_state`/`licence_expiry`, `tenant_material_preferences.preferred_brand`, `tenant_assembly_overrides.*`, `tenant_custom_assemblies.*` (tenant-owned).

---

## Highest-value A-pass gaps for electrical+plumbing (sorted)

| gap | table.column | state | note |
|---|---|---|---|
| Base BOM almost empty | `shared_assembly_bom` (whole table) | 3 rows total | only 3 base BOMs exist; deterministic-BOM is consumed but starved. Expand only with verified material categories. |
| BOM line labels missing | `shared_assembly_bom.description` / `tenant_assembly_bom.description` | 0/3, 1/5 | descriptive labels for BOM lines |
| Licence fields blank | `pricing_book.licence_type/number/expiry` | 1/7 each | **owner input — flag, do not fabricate** |
| Sparse `properties` specs | `shared_assemblies.properties` 18/49, `shared_materials.properties` 16/38, `tenant_material_catalogue.properties` 10/30, `tenant_custom_assemblies.properties` 0/3 | partial | spec-match quality depends on this |
| Sparse `row_assumptions` | `shared_assemblies.row_assumptions` 5/49 | partial | improves quote assumption lines |
| Sparse `inspection_triggers` | `shared_assemblies.inspection_triggers` 4/49 | partial | conditional-inspection routing coverage |

> `price_recipe` (1/49 shared, 0/3 custom) is sparse **by design** (Phase-2) — listed for awareness, not as a fill mandate. Populate only with a verified recipe.
