# Roofing Measurement Review — Spec

## Objective
When a tradie runs a roof estimate on `/dashboard/roofing/measure` and clicks **MEASURE ALL STRUCTURES**, the measurement must become a first-class, reviewable entity with its own shareable link — not just inline results the tradie has to eyeball and manually save. The same measurement record must also drive a correct, selection-aware customer quote and PDF. This fixes two real problems: (1) the measurement isn't presented as its own openable page, and (2) the include/exclude structure checkboxes don't actually flow into the priced quote or the downloaded PDF, so the PDF sums *all* detected structures regardless of what was checked.

Audience: roofing tradies (measurement review) and their customers (the priced quote + PDF).

## Context / background
- App lives in `quotemate-automation/` (Next.js 16 App Router). **Read `quotemate-automation/AGENTS.md` before writing any Next.js code.**
- A measurement already persists today: clicking MEASURE ALL STRUCTURES on `app/dashboard/roofing/measure/page.tsx` calls `POST /api/roofing/measure-all` (read-only), and an auto-fired `POST /api/roofing/save` writes a `roofing_measurements` row with an unguessable `public_token` and builds a `/q/roof/[token]?s=1,2,3` link.
- The `roofing_measurements` row stores `structures` (jsonb — currently only the *included* structures), `quote` (jsonb — the **full** `MultiRoofQuote`, all structures), plus denormalized `combined_area_m2`, `combined_better_inc_gst`, `structure_count`, and customer-confirm fields (`confirmed_at`, `confirmed_structure`).
- The customer quote page is `app/q/roof/[token]/page.tsx`; the PDF is `app/api/q/roof/[token]/pdf/route.ts`. Both narrow structures via `narrowQuoteToStructures(fullQuote, effectiveIndices)` where `effectiveIndices` comes from the `?s=` query param **or** `confirmed_structure` **or** falls back to **all** structures. The `?s=` param is the only carrier of the tradie's checkbox selection and is easily lost — that fallback-to-all is the PDF bug.
- Structure index convention is **1-based** (matches `?s=1,2,3` and the "1-based" `confirmed_structure`); `narrowQuoteToStructures` expects 1-based indices.
- Token pattern to mirror: `randomBytes(16).toString('hex')` (Node `crypto`).
- DB changes follow the repo convention: a new `sql/migrations/NNN_*.sql` + a `scripts/run-migration-NNN.mjs`, applied to the prod Supabase, with `sql/init.sql` kept representative.

## Requirements

### A. Persisted, authoritative structure selection (fixes the PDF/pricing bug)
1. Add an authoritative selection column to `roofing_measurements`: `included_indices int[]` (1-based structure indices), defaulting to "all structures" for a freshly measured record.
2. The `quote` jsonb continues to hold the **full** `MultiRoofQuote` (all measured structures) so selection can be changed later without re-measuring; the *effective/priced* quote is always derived by narrowing the full quote to `included_indices`.
3. The customer quote page (`/q/roof/[token]`) must derive its priced structures from `included_indices` as the source of truth (not from the `?s=` param). A customer SMS single-pick (`confirmed_structure`) may further-narrow the **customer view only** and must never widen the set beyond `included_indices`.
4. The PDF route (`/api/q/roof/[token]/pdf`) must compute its structure list and totals from the same `included_indices` (intersected with any `confirmed_structure`), never falling back to "all structures" when a selection exists.
5. Denormalized columns (`combined_area_m2`, `combined_better_inc_gst`, `structure_count`) must always reflect the **included** set, and must be recomputed whenever `included_indices` changes.

### B. Measurement Results page (its own link)
6. Add a public, token-addressed Measurement Results page at route `/m/[token]`, keyed by a new `measure_token` column on `roofing_measurements` (distinct from the customer `public_token`). `measure_token` is generated with `randomBytes(16).toString('hex')` at save time and backfilled for existing rows.
7. The Measurement Results page renders the raw measured data for the record: address, satellite/aerial imagery if present, and one card per measured structure showing its role (primary/secondary), area, pitch, key metrics, and per-structure price, plus the combined total of currently-included structures.
8. Each structure card has an include/exclude toggle reflecting `included_indices`. Toggling persists the change to the row (updates `included_indices` and recomputes the denormalized totals) so the customer quote and PDF immediately reflect it. At least one structure must remain included (the last included structure cannot be unchecked).
9. The page is reachable by anyone holding the link (no dashboard auth required), consistent with the customer quote page.

### C. Measure flow UX
10. After the tradie clicks MEASURE ALL STRUCTURES, show a loading state until measuring + persistence complete, then automatically navigate the tradie to the new Measurement Results page (`/m/[measure_token]`).
11. Persistence on measure must initialize `included_indices` to all measured structures (so nothing is silently dropped) — the tradie then narrows on the Measurement Results page.

### D. Dashboard Roofing tab
12. On the dashboard Roofing tab, each saved roofing job shows **two cards/links**: a **Saved Roofing Job** card (opens the customer quote `/q/roof/[public_token]` and offers the PDF) and a **Measurement Results** card (opens `/m/[measure_token]`).
13. The Measurement Results card surfaces enough to identify the job (address, structure count, combined total of included structures).

## Non-goals
- No change to the underlying measurement/geometry provider, pricing assemblies, or the roofing rate card.
- No change to the SMS customer-confirmation flow beyond making it respect `included_indices` as the upper bound.
- No new authentication/permission model — the Measurement Results page is link-shareable like the customer quote.
- Not building re-measure/versioning (one measurement record per measure; re-measuring creates a new record as it does today).
- No redesign of the customer quote page's visual layout beyond the selection-source fix.

## Constraints
- Next.js 16 App Router; follow `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guidance.
- Server routes use the Supabase service-role key; multi-tenant scoping stays app-layer (`tenant_id`).
- Money-touching values come from the stored `MultiRoofQuote` (already tool-grounded at measure time) narrowed by `included_indices` — do not recompute prices free-form; only sum/narrow existing line items.
- Index convention is 1-based throughout (`included_indices`, `confirmed_structure`, `narrowQuoteToStructures`).
- DB change = new `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs`; keep `sql/init.sql` representative. Migration must be additive and backfill-safe for existing rows.
- Currency stored ex-GST, displayed inc-GST (existing convention).

## Edge cases to handle
- Existing `roofing_measurements` rows (no `measure_token`, no `included_indices`) → migration backfills `measure_token` for every row and sets `included_indices` to all structures in `quote` (or to the previously-saved `structures` set if that is the better representation of "what was included").
- Tradie unchecks every structure → block; keep the last one included and surface a gentle message.
- PDF requested when a selection exists → uses `included_indices` (∩ `confirmed_structure` if set), never "all".
- `?s=` query param present on a link → it must not override the stored `included_indices` in a way that widens the set; stored selection is the source of truth (legacy `?s=` links should still render sensibly by intersecting, not by replacing).
- Measurement persistence fails after a successful measure → surface an error and do not silently leave the tradie on a blank page; the inline results may remain as a fallback.
- A structure index in `included_indices` that no longer exists in `quote.structures` → ignore it safely (no crash).
- Inspection-routed measurement (`routing === 'inspection_required'`) → existing PDF/inspection gates still apply; selection changes must not bypass them.

## Definition of done
- [ ] Migration `sql/migrations/NNN_roofing_measurement_selection.sql` adds `measure_token` (unique) and `included_indices int[]` to `roofing_measurements`, backfills both for existing rows, and is additive/non-destructive; `scripts/run-migration-NNN.mjs` exists and `sql/init.sql` is updated to match.
- [ ] Clicking MEASURE ALL STRUCTURES shows a loading state, persists a record (with `measure_token` and `included_indices` = all structures), then auto-navigates to `/m/[measure_token]`.
- [ ] `/m/[token]` renders measured structures (role, area, pitch, metrics, per-structure price), the included combined total, and a working include/exclude toggle per structure; toggling persists and updates totals; the last included structure cannot be unchecked.
- [ ] The customer quote page `/q/roof/[public_token]` derives priced structures from `included_indices`, and a `confirmed_structure` only further-narrows the customer view.
- [ ] The PDF at `/api/q/roof/[public_token]/pdf` lists and totals only the `included_indices` structures (∩ `confirmed_structure` if present) — verified by unchecking a structure and confirming it disappears from the PDF and the total drops accordingly.
- [ ] The dashboard Roofing tab shows two cards per job (Saved Roofing Job → `/q/roof/[public_token]` + PDF; Measurement Results → `/m/[measure_token]`).
- [ ] Denormalized `combined_area_m2`, `combined_better_inc_gst`, `structure_count` reflect the included set after any toggle.
- [ ] `included_indices` referencing a missing structure, an all-unchecked attempt, and a legacy `?s=` link are all handled without crashing, per the edge cases.
- [ ] `npm run build`/typecheck passes for the touched files; no money value is computed free-form (only narrowing/summing of the stored `MultiRoofQuote`).

## Open questions
- Should the customer quote `public_token` and the new `measure_token` ever be unified into one token with two routes? (Current decision: keep two tokens on one record to match the two-different-hash examples.) — defaulted to two tokens; revisit only if it complicates sharing.
- Should backfill of `included_indices` for legacy rows use `quote.structures` (all) or the saved `structures` array (previously-included)? — default to the saved `structures` set when it is a strict subset, else all.
