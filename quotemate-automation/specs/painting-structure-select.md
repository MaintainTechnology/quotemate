# Painting structure selection + take-off explanations + retired-palette cleanup

## Goal

A tradie estimating paint at a multi-structure address can pick WHICH structure the estimate
measures (main dwelling pre-selected and clearly labelled), the Materials & labour panel explains
how every litre/dollar/hour was derived, and the two genuinely retired-palette surfaces are moved
to the canonical charcoal/yellow system. Why: secondary structures (sheds, garages) currently
pollute or mis-target the single-building estimate, the take-off numbers are unexplained, and two
customer-adjacent surfaces still render the retired orange/navy.

## Role

Principal engineer. Reason before acting; read before describing; TDD all pure logic; never touch
quoted-price computation semantics for the default (no-selection) path.

## Context (grounded 2026-07-10)

**Structure discovery already exists** — `lib/solar/buildings.ts` `detectPropertyBuildings()`
(:60-81) wraps the roofing Geoscape `measureAll()` (up to 6 buildings, primary-first, ~6 Geoscape
credits, no Google spend) and maps to `DetectedBuilding[]` (:91-125): `building_id`, `role`
('primary'|'secondary'), `label` ("Main building" / "Secondary building N" / "Outbuilding N" when
< 40 m²), `centroid`, `footprint` GeoJSON, `area_m2`, `roof_shape`, `storeys`. Returns `[]` on no
key / error (callers hide the picker; they typically hide below 2). GEOSCAPE_API_KEY is set in
dev.

**Painting's money path is a pure function of facts** — `lib/painting/area.ts`
`resolveFloorArea` (:91-159; priority manual → listing → `footprint_m2 × storeys × 0.9` →
beds) and `measurePaintableArea` (exterior perimeter reads `facts.footprint_m2` directly,
wall height prefers `facts.eave_height_m`). Substituting the chosen building's
footprint/storeys/eave changes everything downstream with zero engine changes.

**Current single-building behaviour**: base provider `lib/painting/providers/solar.ts` =
Google `findClosest` (ONE building, geocode-nearest). Enrichment
`lib/painting/providers/geoscape-enrich.ts` collapses the Geoscape list to ONE via
`pickBestSummary(pickBuildingSummaries(listBody))` (:78-79) then fetches
estimatedLevels/averageEaveHeight/zonings/area (:88-93). Merge `applyEnrichment`
(`lib/painting/enrich.ts:40-79`): geoscape storeys/footprint only FILL nulls — "the Solar
footprint is never overwritten" (:8, :50-55). User-declared `inputs.storeys` re-applied after
enrichment in `measure.ts:104-107` (always wins).

**Plug-in points**: `PaintInputsSchema` (`lib/painting/request-schema.ts:17-27`) strips unknown
keys — a structure field needs a schema addition + `PaintUserInputs` (`types.ts:54-76`).
`painting_measurements.inputs` jsonb persists whatever passes zod (`save-row.ts:101`); the full
estimate (with facts) persists verbatim — NO migration needed. Client request bodies:
`app/dashboard/painting/page.tsx` estimate (:139-150) and save (:184-197).

**Take-off** (`lib/painting/takeoff.ts`, previous spec): per-tier products
(litres/packs/cost), sundries, labour hours → crew-days, margin. Rendered in
`PaintResultView.tsx` "Materials & labour" panel (tradie surfaces only). Fixture maths:
walls 380 m² (340-420) × 2 coats ÷ 16 m²/L = 47.5 L → 3×15 L + 1×4 L = 49 L × $14/L = $686;
trim 120 lm × 2 ÷ 45 lm/L = 5.3 L → 1×10 L × $20/L = $200.

**Design-cleanup targets (audited)** — NO roofing/3D page uses the retired navy/orange design;
"Maintain / navy / orange" phrases in roofing files are stale comments over token-compliant code.
The real holdouts: (1) `app/s/[shortCode]/route.ts:89` — raw-HTML QR interstitial with
`background:#ff5a1f` button, white bg, rounded corners; (2) `lib/solar/felt-map.ts:188-275` —
Felt roof-map layer styles in `#FF5A1F` orange + `#0E1622` navy; (3) nit:
`app/m/[token]/RoofLayoutSection.tsx:111` uses `text-red-400` instead of `text-warning`.
Canonical idiom: warm charcoal `#16120F` (`--ink-deep`), Caterpillar yellow `#FFC400`
(`--accent`, dark-ink text on accent fills), teal `#14B8A6` secondary, square corners, mono
uppercase eyebrows. (`app/docs/*` module CSS also carries the old palette — internal doc pages,
explicitly out of scope.)

**Gates**: `npm test` (vitest), `npm run typecheck`, `npm run test:e2e`
(`PLAYWRIGHT_PORT=3000`, dev server on 3000, pre-warm routes to avoid recompile flake). Verify
skill for authed surfaces. A concurrent workstream may edit shared files — reconcile, don't
revert.

## Task

### A — Structure selection (painting)

1. `lib/painting/structures.ts` (PURE) + test: `PaintStructureOption = {building_id, label,
   role, area_m2, storeys}`; `toPaintStructureOptions(buildings: DetectedBuilding[])` maps and
   keeps only options with a `building_id` and positive `area_m2`. Types: add optional
   `structure?: {building_id: string, label?: string, role?: 'primary'|'secondary'}` to
   `PaintUserInputs`, and optional `structure_label?: string|null`, `structure_role?:
   'primary'|'secondary'|null` to `PropertyFacts` (display provenance, mirrors `eave_height_m`'s
   optionality).
2. `POST /api/painting/structures` (dual-auth bearer like `/api/painting/estimate`; zod body =
   `PaintAddressSchema`): calls `detectPropertyBuildings()` →
   `{ok:true, structures: toPaintStructureOptions(...)}`; `[]` stays `ok:true` (client hides
   the picker). No caching table — the client calls once per address.
3. Targeted enrichment: extend `GeoscapeEnrichOpts` with `buildingId?: string`; in
   `geoscape-enrich.ts` select the summary whose `buildingId` matches (PURE helper
   `pickSummaryById(summaries, buildingId)` + unit test; falls back to `pickBestSummary` when
   absent/not found — note the miss). Extend `applyEnrichment(base, sources, opts?: {targeted?:
   boolean}` + test): when `targeted` (a structure was explicitly chosen), the geoscape patch's
   `footprint_m2` and `storeys` OVERRIDE the base (Solar's findClosest footprint is the wrong
   building for a chosen secondary); untargeted behaviour byte-identical. Hierarchy stays:
   user-declared `inputs.storeys` still wins (re-applied in measure.ts after enrichment).
4. Wire through `measure.ts` `estimatePainting`: when `inputs.structure?.building_id` is set,
   pass `{buildingId}` into the geoscape enrich opts, set `targeted: true` for the merge, stamp
   `facts.structure_label/structure_role` from `inputs.structure`, and push a note
   (`Estimating the selected structure: <label>.`) into the capture-note pipeline. Schema:
   add `structure` to `PaintInputsSchema` (object, building_id 1-80 chars, label ≤ 80 optional,
   role enum optional) + request-schema test.
5. Dashboard UI (`app/dashboard/painting/page.tsx`): when the address is ready (same gate as
   FrontOfHouse), debounce-call `/api/painting/structures`; when ≥2 options render a
   "Structures at this address" ink-card section — radio rows: label (primary row eyebrow
   "Main dwelling"), `area_m2` m², storeys when known; primary pre-selected; selection stored
   and sent as `inputs.structure` on estimate + save. <2 options → render nothing (today's
   behaviour). Re-detect when the address changes.
6. Display: `PaintResultView` "Property details" adds a `Stat label="Structure"` when
   `facts.structure_label` is present (value = label, hint = role words). Old estimates (no
   field) render unchanged.

### B — Take-off explanations

7. Extend types: `PaintingTakeoffProduct.note: string`; `PaintingTakeoffTier.sundries_note:
   string`, `labour_note: string`, `margin_note: string`. In `takeoff.ts` build them from the
   ACTUAL numbers (pure, deterministic, AU units) + exact-string tests on the fixture:
   - paint: `380 m² × 2 coats ÷ 16 m²/L = 47.5 L → packed 49 L × $14/L`
     (Best paint lines append ` (premium +25%)`)
   - trim: `120 lm × 2 coats ÷ 45 lm/L = 5.3 L → packed 10 L × $20/L`
   - primer: `Bare substrate — 1 sealing coat: 380 m² ÷ 12 m²/L = 31.7 L → packed 34 L × $12/L`
   - sundries: `8% of product cost — filler, caulk, tape, drop sheets`
   - labour: `walls 380 m² ÷ 3 m²/hr + trim 120 lm ÷ 7 lm/hr = 143.8 h × 1 (coats · prep ·
     colour) @ $85/hr · 2 painters × 7.6 h/day ≈ 10 days` (multiplier shown to 2 dp when ≠ 1;
     the double-storey exterior loading, when applied, appends ` · exterior +50% access`)
   - margin: `Better $14,879 ex GST − materials $1,078 − labour $12,223` (illustrative shape —
     use the tier's real numbers)
8. UI (`PaintResultView` tier cards): a `<details>` per tier — mono summary line
   `How these numbers were built`, body lists each product note, sundries, labour, margin notes
   (font-mono text-[11px] text-text-dim, one per line). Notes absent (old rows) → no details
   block. The e2e asserts the summary line renders on /p and NOT on /q/paint.

### C — Retired-palette cleanup (design alignment)

9. `app/s/[shortCode]/route.ts` interstitial: restyle the inline HTML to the canonical system —
   `background:#16120F`, card `#211B15` with `1px solid #372E24`, text `#F5EFE6`/`#A89880`,
   button `background:#FFC400; color:#1C1812; border-radius:0` (square), mono uppercase
   eyebrow, system font stack stays. Same copy/links; ONLY presentation changes.
10. `lib/solar/felt-map.ts`: replace retired colours — `#FF5A1F` → `#FFC400`, `#0E1622` →
    `#16120F` (strokes/halos), update the "brand accent" comment. Keep every other value.
11. `app/m/[token]/RoofLayoutSection.tsx:111` `text-red-400` → `text-warning`.
12. Honest report note: the roofing/3D pages the request named are ALREADY on the current
    design (stale comments only); state this in the final report and name the three surfaces
    actually fixed, inviting a URL if a different page was meant.

## Constraints

- The no-selection path must be byte-identical: no `structure` in inputs ⇒ identical facts,
  identical estimate, identical takeoff (regression guard: existing tests already lock this;
  do not change `applyEnrichment` untargeted semantics).
- Money path stays deterministic and server-fetched: the client sends only `building_id`
  (+ display label/role); footprint/storeys/eave always come from the server's Geoscape fetch,
  never from the client.
- Geoscape spend: structure detection is one extra call per address (client-triggered, ~6
  credits, debounced); the estimate's enrichment fan-out cost is unchanged (same sub-resource
  calls, different target building).
- Notes are display strings — no parsing of them anywhere, ever.
- No migrations. No new deps. Customer surfaces (`/q/paint`, PDF, SMS) untouched by A and B.
- Do not modify roofing/solar libs beyond `GeoscapeEnrichOpts`… (none needed — buildings.ts is
  imported, not changed). felt-map/interstitial/RoofLayoutSection changes are colour-token-only.
- Don't touch `app/docs/*` module CSS (internal, out of scope).

## Acceptance criteria & gates

1. `npm test` — new tests pass: structures mapper, `pickSummaryById`, targeted
   `applyEnrichment` override + untargeted-unchanged, request-schema `structure` field,
   take-off note exact strings (incl. premium and double-storey variants), plus the whole
   existing suite.
2. `npm run typecheck` clean (scope: this diff).
3. `npm run test:e2e` — painting spec extended: seeded row's estimate carries
   `facts.structure_label: 'Main building'` + takeoff notes; assert /p shows the Structure stat
   and the "How these numbers were built" details; assert /q/paint shows neither.
4. /verify (verify skill): real dashboard run on an address — if Geoscape returns ≥2 structures
   the picker renders with "Main dwelling" pre-selected and the estimate reflects the chosen
   structure's footprint (screenshot); with a single-structure address the page is unchanged.
   Screenshot the notes `<details>` open on /p. Screenshot the restyled /s interstitial
   (create a short-code row or hit an existing one; if none exists, render check via curl HTML
   inspection is acceptable).
5. `/review` per item; `/code-review` no blocker/major.

## Examples

<example>
Structure picker data shape to reuse: lib/solar/buildings.ts detectPropertyBuildings +
mapMeasuredBuildings/labelForBuilding (:91-144). Painting maps DetectedBuilding →
PaintStructureOption; centroid/footprint polygons are dropped (no map UI in v1 — list rows).
</example>

<example>
Targeted-override merge to mirror: applyEnrichment (lib/painting/enrich.ts:40-79). Add the
opts.targeted branch: `if (targeted && p.footprint_m2 != null) f.footprint_m2 = p.footprint_m2`
(same for storeys), keeping the fill-null-only branch verbatim for untargeted.
</example>

<example>
Dashboard picker card to imitate: the FrontOfHouse section idiom in
app/dashboard/painting/page.tsx (ink-card section, mono accent eyebrow, debounced address-ready
fetch) + roofing StructureCard's role eyebrow ("Main dwelling"/"Secondary structure").
</example>

<example>
Interstitial restyle reference: the canonical tokens from app/globals.css (--ink-deep #16120F,
--accent #FFC400, accent-ink dark text on yellow) applied as literal hex in the route's inline
CSS (the raw-HTML route has no Tailwind).
</example>
