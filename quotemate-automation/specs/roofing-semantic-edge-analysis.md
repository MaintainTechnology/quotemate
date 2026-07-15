# Roofing semantic edge candidate analysis — Spec

## Status

Phase 1 is implemented locally and awaits review. Following explicit requests
to proceed with a visible roofing result, three deliberately non-live increments
are also implemented locally:

1. a server-only Google Data Layers transport seam and a dashboard-only
   **synthetic benchmark** evidence preview; and
2. a Measurement Results **footprint-candidate visual bridge**: the real saved
   property aerial is combined with an ephemeral, numbered overlay derived only
   from the already-saved footprint, roof form, segment count, and scalar edge
   estimates; and
3. a provider-independent, pure DSM-to-plane facet reconstruction core plus a
   quiet PNG renderer. These modules reproduce the useful part of the Google
   proof of concept (plane assignment, fit statistics, subtle fills, and marker
   positions) without network, storage, credentials, or semantic edge claims.

The visual bridge is not a `RoofEdgeAnalysis`, approved source evidence, or
facet detection. It is visibly labelled **FOOTPRINT CANDIDATE · REVIEW
REQUIRED** beside the image rather than stamped across it, does not persist
candidate geometry, and cannot mutate measurement, quote, PDF, or pricing
values. No live topology source is acquired by the application. Migration 172
remains unapplied.

## Goal

Deliver a default-off, source-independent Phase 1 boundary for reviewable roof
topology evidence: it must reject unapproved or expired sources, preserve the
existing roofing quote byte-for-byte, and make future source data tenant-bound,
immutable, and purgeable. The approved follow-on preview may demonstrate the
review surface only with neutral synthetic data; it must not imply a property
analysis or bypass the commercial-source gate.

Why: a roof topology feature cannot safely progress to provider data, overlays,
or pricing until its commercial, retention, and audit foundations are enforced.

## Role

Act as the principal engineer for this repository: verify integration claims
against the current roofing implementation, make the smallest Phase 1 change
that enforces this contract, and stop before a **live** Phase 2 provider run.
The current increment may add a server-only, injected-transport boundary and a
clearly labelled synthetic dashboard preview plus the narrow, ephemeral
footprint-candidate visual bridge defined below. It must not perform live source
retrieval or represent footprint guides as approved semantic geometry.

## Context

- lib/roofing/measure.ts, lib/roofing/pricing.ts, and
  lib/roofing/reprice.ts are the existing deterministic measurement/money path;
  Phase 1 must not import or change it.
- app/api/roofing/measurement/[token]/route.ts is the existing public
  capability-token reprice route; it remains out of scope for topology.
- lib/roofing/solar-api.ts contains pitch/segment enrichment only; there is no
  current Data Layers/DSM/RGB/mask adapter. lib/roofing/providers/geoscape.ts
  provides footprint/context, not typed semantic roof-edge lines.
- sql/migrations/081_roofing_measurements.sql permits legacy tenantless
  measurements, so the Phase 1 schema must reject them for topology rather
  than silently crossing a tenant boundary.

## Task

1. Ship Delivery Sequence Phase 1: a pure contract, disabled feature gate,
   source-independent fixtures, retention helpers, and unapplied SQL storage
   guardrails.
2. Require a durable, tenant-scoped written source approval record before any
   analysis can be persisted; bind every analysis, decision, and revision to
   its owning tenant and selected measurement.
3. Preserve generated evidence and decisions as immutable/append-only records,
   except for an explicit lawful redaction/purge transition.
4. The approved follow-on increment may add a non-live, dashboard-authenticated
   synthetic preview, an uninvoked server-side source-adapter seam, and the
   narrow Measurement Results footprint-candidate visual bridge defined below.
   Do not add a default provider call, property-candidate persistence,
   price/pricer edit, quote/PDF mutation, public topology analysis route, or
   production migration application.

## Constraints

- ROOFING_EDGE_ANALYSIS_ENABLED is default-off and independent of
  ROOFING_SOLAR_ENRICHMENT; a Google key or an approval string alone is not
  authority to call, store, or display source-derived topology.
- Google-derived topology is prohibited until a recorded written approval
  record is active, allows derivative geometry, and has compatible retention.
- The non-live seam has no credential lookup, default `fetch`, or application
  caller; it accepts only an injected authenticated transport and a tenant-bound
  approval context. Its fixtures are synthetic/licensed manifests only; no
  Google imagery, masks, DSM/RGB, provider URLs, signed URLs, or credentials are
  stored.
- Candidate construction is detached/read-only and must never mutate
  metrics.hips, metrics.valleys, metrics.ridge_lm, tiers, totals, or
  customer/PDF inputs.
- The public [token] reprice route is not an authorization or persistence seam
  for topology. Future dashboard routes must enforce tenant scope.

### Measurement Results footprint-candidate visual bridge

This is the one permitted property-derived display before a commercially
approved topology analysis exists. It is intentionally outside the durable
semantic-edge contract:

- Render on `/m/[measure_token]` using the existing share-token-gated static-map
  byte proxy. Keep provider keys and source URLs server-only.
- Align the overlay to the same `layoutMapView` camera and a strict 640×480
  (4:3) frame. Never crop the base image independently from the overlay.
- Use only values already present in the saved quote. Coloured roof zones are
  an illustrative footprint split; a saved Solar segment count may control how
  many zones are displayed, but never their location or identity.
- Do not stamp provisional ridge/hip/valley/eave paths, tags, or bubbles over
  this fallback image. Keep their totals in compact, review-labelled cards so
  the roof remains readable. Eaves remain roof-boundary candidates and are
  never gutters.
- Use restrained plane fills and same-colour hairline seams only: current
  fallback targets 30% fill opacity, 0.6 px / 28% zone seams, a 0.7 px / 38% footprint outline,
  and small numbered badges. No multi-stroke white/dark halo is permitted in
  the default image.
- Keep the existing scalar counts/lengths visually separate from the mapped
  guide count/length so a footprint that cannot locate every reported run is
  obvious.
- The overlay is generated in memory and returned only as presentation data. It
  must not create an analysis row, decision, revision, source claim, pricing
  input, or customer/PDF output.
- When no valid footprint exists, show the property aerial with an explicit
  “candidate overlay unavailable” state. Never substitute the synthetic
  benchmark or the user's reference image.

## Acceptance criteria & gates

- The Phase 1 unit and migration tests cover default-off gating, explicit
  dwelling selection, invalid evidence rejection, quote immutability,
  retention redaction, source approval persistence requirements, append-only
  decisions, tenant-bound foreign keys, and RLS without public policies.
- Run pnpm.cmd test, pnpm.cmd run typecheck, and pnpm.cmd run build in this
  Windows workspace. The synthetic preview is browser-facing, so its component
  accessibility and visual behaviour need a later Playwright/golden-image gate
  before it can evolve into source-derived topology evidence.
- The footprint-candidate renderer has pure tests covering numbered zones,
  subtle line treatment, absence of semantic line/bubble markup, semantic
  summary colours, reported-versus-located counts, malformed geometry, and no
  embedded provider/source asset references. The Measurement Results surface
  keeps an explicit non-survey-grade disclaimer.
- The reusable facet reconstruction and PNG renderer have synthetic-array tests
  for least-residual assignment, deterministic smoothing, fit statistics,
  invalid input, transparent/composited output, and single-pixel subtle plane
  contacts. They remain uninvoked by application routes until the source gate
  and persistence lifecycle are complete.
- The migration runner remains opt-in and verifies RLS/indexes before
  committing. It is not run against production as part of Phase 1.

## Examples

<example>
ROOFING_SOLAR_ENRICHMENT=true plus a Google key still leaves
ROOFING_EDGE_ANALYSIS_ENABLED false and cannot construct an analysis.
</example>

<example>
An explicitly confirmed dwelling remains selected even when a neighbouring
shed has a larger footprint.
</example>

<example>
An expiring source-derived analysis can delete its internal assets and redact
its candidate payload, but cannot rewrite its source metadata or decisions.
</example>

## Objective

Add a tradie-reviewable **Roof topology evidence** feature to Roofing Measurement
Results. For the selected main dwelling, it combines a commercially permitted
roof-geometry source with the Geoscape building footprint and height context to
produce candidate:

- ridge runs;
- hip runs;
- valley runs; and
- eave runs.

Each run has geometry, plan and surface length, confidence, source evidence, and
a review state. Candidates may be used for an **explicitly labelled draft
estimate**, but only tradie-approved values become the quote's canonical
edge-work inputs.

This is not a survey-grade measurement product and must never be presented as
one.

## Non-negotiable commercial gate

**Do not use Google Solar in production for a reroof-measurement or reroof-quote
feature unless Google gives written permission covering this use.** The published
[Google Maps Platform Service Specific Terms, section 20](https://cloud.google.com/maps-platform/terms/maps-service-terms)
limit Solar API use to energy-system feasibility, design/installation, or
downstream energy transactions. A general roofing take-off does not clearly fit
that permitted-use definition. The same terms limit Solar Data caching to 30
days, with a fixed-media exception limited to an energy-system downstream
transaction.

Before implementation begins, choose one of these source modes:

1. **Approved Google mode** — Legal/commercial owner obtains written Google
   approval for the proposed roofing use and records the approved retention,
   display, attribution, and derivative-data rules.
2. **Licensed roof-geometry mode** — Procure a source whose contract permits
   rooftop topology/measurement in Australian roofing estimates, such as
   licensed aerial DSM/3D or LiDAR data. Geoscape remains the footprint/context
   source where its terms allow.

Until one mode is approved, the existing Google proof of concept is
prototype-only. It must not be exposed to customers, used in a production quote,
or persisted beyond the provider's permitted retention window.

## Product decision

This is a feature-flagged, human-in-the-loop bridge between the current
Geoscape/form estimate and the later LiDAR pipeline:

1. It supplements, rather than replaces, the current deterministic Roofing
   measurement and pricing flow.
2. It applies to the **main dwelling only** unless the tradie deliberately runs
   it for a secondary structure.
3. It creates a visible candidate evidence layer; it does not silently replace
   hip or valley counts.
4. Candidate values can populate an internal indicative draft only after an
   explicit tradie action. Roofing remains review-required and never auto-sends.
5. Eave candidates are roof-boundary measurements. They are not automatically
   called gutters and do not create gutter/box-gutter pricing.

## Why the existing result is insufficient

The current product already has:

- form and 2D-footprint-derived hip/valley estimates;
- editable hip, valley, and box-gutter controls on Measurement Results;
- deterministic repricing; and
- a coloured footprint map.

Those colours are visual heuristics. A 2D building footprint cannot identify
internal ridges, hips, or valleys. A permitted geometry source may expose plane
statistics, DSM, RGB, and a roof mask, but the semantic topology must still be
reconstructed. Geoscape supplies the current building boundary and context; it
does not supply typed roof-edge lines.

The existing Google prototype has a **locally reconstructed** 22-facet
assignment. Google Data Layers does not provide facet pixels or facet polygons:
the mask is rooftop/not-rooftop and Building Insights provides per-segment
metadata. Plane number and fill colour are reconstruction identity only, not a
hip, valley, ridge, or eave classification.

## Integration surface (existing code — grounded)

This feature is additive over the deterministic roofing pipeline already in the
repo. Reuse these seams; do not fork the money path or public capability model:

- **Measurement + provenance.** `lib/roofing/measure.ts` (`measureAndPriceRoofs`,
  `perBuildingEdges` + `applyEdgeOverride`) produces per-structure `RoofMetrics`;
  `lib/roofing/providers/geoscape.ts` (`buildingDetailsToMetrics`) supplies the
  footprint + geometry-first hip/valley counts. `RoofMetrics.field_sources`
  (`lib/roofing/types.ts`, `RoofFieldSource = 'google_solar' | 'geoscape' |
  'declared' | 'derived'`) is the existing "measured beats derived beats
  declared" provenance model only covers existing scalar roof measurements; it
  has no semantic-edge fields. Phase 1 keeps topology provenance, candidates,
  and decisions in their own additive contract and tables. It must not stamp or
  mutate `metrics` provenance.
- **The 2D-footprint heuristic being superseded (main dwelling only).**
  `lib/roofing/geometry-edges.ts` (`polygonCornerCounts`, `edgesFromGeometry`) is
  exactly the footprint-corner guess this feature replaces with real topology for
  the selected dwelling. Leave it as the fallback for every un-analysed structure.
- **Pure deterministic pricer (the ONE money-path integration).**
  `lib/roofing/pricing.ts`: `perEdgeLength()` = `√footprint / 2 × 1/cos(pitch)`,
  clamped to [3, 20] m, IS the "count × sqrt(footprint)" form fallback the pricing
  contract refers to. `deriveEdgeWorks()` → `RoofingEdgeWorks`; `buildTier()`
  emits the `lm` hip/valley/box-gutter line items under `edgeChargedForTier()`
  with the invariant `Σ line_items.total_ex_gst === tier.ex_gst`.
  `RoofingRateCard` already carries `ridge_hip_repoint_rate_per_lm`,
  `valley_flashing_rate_per_lm`, and `box_gutter_rate_per_lm`. The approved
  surface length must flow through `deriveEdgeWorks`/`buildTier` (preferring
  measured `surface_lm` over `perEdgeLength × count`) so that invariant and the
  double-count rules hold unchanged.
- **Human-in-the-loop reprice seam already shipped — reuse only its pure
  function.** The tradie
  `Confirm counts` inputs in `app/m/[token]/MeasurementReview.tsx` →
  `PATCH /api/roofing/measurement/[token]` (`edges`) → `lib/roofing/reprice.ts`
  `repriceWithEdgeOverrides()` → `priceMultiRoof()` is the existing
  edit-then-reprice loop. That route is link-shareable capability-token flow
  and mutates `roofing_measurements.quote` in place; it is **not** an
  authorization or persistence model for topology. A later
  dashboard-authenticated topology route may call the pure reprice helper
  internally after extending it with an explicit `surface_lm` override. It
  must create an internal revision, not extend the public `[token]` route.
- **Main-dwelling selection is a separate contract.**
  `measureAndPriceRoofs` deliberately orders structures by size and labels the
  largest `primary` (`roofSizeOrder`). That existing pricing behaviour and its
  tests remain unchanged in Phase 1. Topology instead requires an explicit,
  confirmed `{ measurement_id, structure_index, building_id }` selection; a
  larger shed must never silently win.
- **No current topology provider adapter exists.** `lib/roofing/solar-api.ts`
  only parses Google Building Insights pitch/segment data. It does not fetch
  Solar Data Layers, DSM, RGB, or roof-mask assets. Geoscape currently supplies
  a footprint/form plus optional height/tree attributes, but no typed roof-edge
  lines and no guaranteed capture date in the live flow. Phase 2 starts with a
  new legally approved, source-specific geometry adapter; Phase 1 remains
  source-independent.
- **Rate-card snapshotting is a new requirement.** `measure-all` and the
  existing public reprice route resolve a live `pricing_book.overlays` rate
  card; the current schema has no immutable pricing-book version. A later
  topology revision must persist an exact rate-card JSON snapshot. A legacy
  measurement without one is unavailable for topology pricing until a tradie
  explicitly creates a new-current-rate revision.
- **Promotion + customer surfaces.** `lib/roofing/save-as-quote-helpers.ts`
  (`buildSaveAsQuoteRequest`, `buildTierObjects`) and `/q/roof/[token]` +
  `/q/[token]` (`TradeTiers`) render the priced tiers; a candidate/approved
  revision must never mutate a released quote.

## Scope

### In scope

- Main-dwelling selection and source-alignment checks.
- Server-side processing of data from the selected, commercially permitted
  geometry source.
- Geoscape footprint and roof/height context enrichment.
- Deterministic candidate edge generation and confidence scoring.
- A data-driven semantic-line overlay with numbered coloured labels.
- Review, edit, accept, reject, and manually draw actions for a tradie.
- Explicit candidate-draft and approved-pricing hand-off.
- Tests, evaluation fixtures, attribution, and source-date warnings.

### Out of scope

- A claim of exact or survey-grade measurement.
- Automatic detection or pricing of box gutters.
- Customer-facing editing of topology evidence.
- Replacing the Phase 2 LiDAR decision.
- Reusing an LLM to calculate money or edge lengths.
- Automatic quote release or customer SMS sending.

## Terms

| Term | Meaning |
|---|---|
| Facet | A locally reconstructed roof-plane assignment, labelled Plane 00 through Plane 21 in the current prototype image. It is not vendor-supplied pixel truth. |
| Candidate edge | An algorithmic line with a proposed type, geometry, length, and confidence. |
| Logical run | One merged roof feature, rather than several short raster contacts. Counts are counts of logical runs. |
| Approved edge | A candidate accepted or edited by the tradie. Only approved values can become the canonical edge-work input. |
| Candidate draft | An explicitly selected, clearly marked estimate based on unapproved candidates. It cannot auto-release. |
| Eave candidate | Exterior roof boundary aligned to the roof mask and Geoscape footprint. It is not a guaranteed physical gutter measurement. |

## Source and selection workflow

1. Resolve the address and candidate buildings.
2. Select the main dwelling using the matched Geoscape building identifier,
   footprint position, and an explicit tradie confirmation. Do not select by
   largest polygon alone.
3. Fetch the approved geometry source for the selected location. In an approved
   Google mode, request Building Insights plus Data Layers and download DSM, RGB,
   and roof mask on the server; never expose provider keys or signed URLs to the
   browser. In licensed roof-geometry mode, follow that provider's permitted
   request, storage, and display rules.
4. Fetch Geoscape building geometry and available roof/height context:
   footprint, capture date/resolution, roof/eave height, roof material, and tree
   overhang.
5. Project both sources into the same local metre coordinate system and score:
   centroid agreement, footprint overlap, mask-component overlap, source dates,
   tree cover, and image quality.
6. Continue only when the main roof component is unambiguous. Otherwise store
   an analysis with status **needs_review** and no candidate-derived price.

For this Chandler example, Google imagery is older than the Geoscape footprint.
The UI must display the source dates and an alignment/review warning before a
tradie uses the result.

## Candidate-generation algorithm

All geometry calculations are deterministic and server-side.

1. Clip the approved source's roof mask to the confirmed main-dwelling extent.
   Keep the connected component that best overlaps the Geoscape footprint.
2. When the source lacks facet pixels, derive facet assignments from its DSM and
   plane metadata, then vectorise the **local reconstruction**. Remove tiny
   islands, simplify safely, snap nearby boundaries, and merge collinear
   fragments. Retain ambiguous assignment as unknown.
3. Fit a robust plane to each facet's DSM cells. Retain plane residual and
   sample count as evidence.
4. For every materially shared boundary between adjacent fitted planes:
   - calculate a 3D line candidate from the plane intersection;
   - sample either side of the line to determine whether it is a crest or
     trough;
   - classify a trough as a valley candidate;
   - classify a crest as a ridge or hip candidate only after positive
     eave-versus-rake classification; a crest that reaches a sloping eave is a
     hip candidate, while a top/internal run is a ridge candidate. A line ending
     at a gable rake stays unknown; and
   - leave uncertain boundaries as **unknown**, never force a type.
5. Derive exterior eave candidates from the selected roof-mask boundary,
   constrained against the Geoscape footprint. Keep eave and gutter terminology
   distinct.
6. Merge compatible fragments into logical runs before counting or summing
   length.
7. Calculate:
   - plan length in metres;
   - 3D/on-roof length in metres when plane support is sufficient; and
   - confidence from fit residual, support pixels, dihedral strength, continuity,
     footprint agreement, obstruction flags, and source-date agreement.

The first version must preserve unknown candidates. A better result with fewer,
well-supported lines is preferable to a complete-looking but fabricated roof
graph.

## Data contract

Use additive, versioned persistence:

- **roof_topology_source_approvals** holds the tenant-scoped written
  approval/licence record, derivative-geometry permission, and retention
  limit that authorises any later source-derived analysis;
- **roof_edge_analyses** holds the immutable generated candidate payload,
  source/retention metadata, and algorithm version;
- **roof_edge_decisions** is append-only and records approve, reject, retype,
  geometry edit, length edit, and manual-line actions; and
- **roofing_quote_revisions** holds an internal candidate or approved draft
  without mutating a customer-visible quote.

This separation preserves the original analysis evidence while making edits and
approval auditable. It also supports mandatory expiry/purge for sources whose
licence does not permit permanent retention.

### Phase 1 boundary

Phase 1 creates only the source-independent contract, synthetic/licensed
benchmark manifests, disabled feature gate, retention rules, and database
tables. It does not retrieve, process, display, or persist provider imagery,
DSM, masks, or provider-derived candidate geometry. The in-memory contract can
validate synthetic/licensed candidate objects for tests, but has no provider
adapter or persistence route. In particular, a Google API key, the
existing `ROOFING_SOLAR_ENRICHMENT` flag, or an approval reference by itself
must never cause a topology provider call.

The new `ROOFING_EDGE_ANALYSIS_ENABLED` server-only flag defaults to false and
is independent of `ROOFING_SOLAR_ENRICHMENT`. A future invocation additionally
requires a recorded source mode, a written commercial approval reference where
applicable, and retention terms that have not expired. No topology endpoint is
introduced in Phase 1.

### Phase 1 implementation record

The completed Phase 1 implementation is deliberately local and read-only:

- lib/roofing/edge-analysis-config.ts resolves only the edge-analysis flag; it
  does not inspect a Google key or the Solar enrichment flag. Its access
  decision additionally requires a source mode, approval/licence reference,
  and valid retention window. The pure preflight is not a substitute for the
  durable approval record required by persistence.
- lib/roofing/edge-analysis.ts validates an explicit confirmed dwelling
  selection, builds a detached immutable candidate envelope, rejects provider
  URLs/credential-shaped values and unsupported/invalid edges, binds direct or
  fused evidence to the one approved geometry source, invokes the default-off
  access gate before construction, and keeps every Phase 1 envelope in
  needs_review pending calibration and tradie review. Geoscape remains context
  only and cannot independently support a semantic edge. It neither calls a
  provider nor imports pricing code.
- lib/roofing/edge-analysis-retention.ts makes expired/purged analyses
  unreadable, also requires a current active source approval on reads, and
  models object-key deletion before payload redaction.
- lib/roofing/edge-analysis-fixtures.ts contains the seven synthetic/licensed
  benchmark manifests only; it contains no imagery, URLs, masks, or
  Google-derived bytes.
- sql/migrations/172_roofing_semantic_edge_analysis.sql and its explicit opt-in
  runner create a RLS-enabled, tenant-scoped source-approval table plus the
  three evidence tables. A row must reference an active recorded written
  approval/licence with derivative-geometry permission and compatible retention
  before it can persist. Composite foreign keys bind an internal revision to
  the same tenant, measurement, analysis, and optional decision cutoff;
  source-derived revision retention can never outlast the parent analysis.
  Approval terms become immutable once referenced; an auditable revocation or
  recorded expiry queues associated evidence for purge, while a finite
  approval-validity date caps the row expiry. Generated payload is
  database-immutable except for the lawful completed-purge transition;
  decisions are database append-only and may retain geometry only when it is
  explicitly manual; candidate geometry remains solely in the purgeable
  analysis payload, and source metadata is a flat allowlisted audit projection
  rather than a second evidence store. Expiring or revoked revisions redact topology/price
  payloads while retaining their rate-card audit snapshot. The runner keeps
  its transaction open until its RLS, no-policy, index, and trigger
  verification passes. The migration is not applied by this implementation.

The TypeScript contract uses conventional camelCase fields. The persistence
schema preserves SQL snake_case fields and stores a versioned JSON candidate
envelope. No mapping or persistence route exists yet, by design.

### Non-live Phase 2/3 preview increment

This increment is intentionally **not** a live topology analysis implementation:

- `lib/roofing/topology/google-solar-data-layers.server.ts` is a server-only,
  injected-transport seam for Google's `IMAGERY_LAYERS` metadata plus DSM/RGB/
  roof-mask bytes. It has no API-key lookup, default network transport, route,
  or application caller. Before the injected transport can be used it requires
  the global and Google-specific flags plus a tenant-bound, active,
  derivative-geometry source-approval context with valid retention terms. That
  context must be loaded from the durable approval record by a future live
  orchestrator; a Maps/Solar API activation is not authority to create it.
- `GET /api/dashboard/roofing/measurements/[id]/topology` is authenticated and
  tenant-scoped. It returns a minimal, sanitised measurement-selection projection
  and a non-authorizing approval-record status only. It does not call Google,
  Geoscape, the transport seam, or a candidate engine; it returns no quote,
  price, token, raw building identifier, provider URL, or approval document.
- `/dashboard/roofing/measurements/[id]/topology` renders a fixed neutral SVG
  benchmark after explicit local main-dwelling confirmation. The ridge, hip,
  valley, eave, and unknown labels/colours and summary frames demonstrate the
  review model only. They are marked synthetic, candidate-only, and
  review-required; they are never selected from the saved roof form or treated
  as this property's measurements.

This increment formally sits after the Phase 1 boundary and before the live
candidate engine. It does not change that boundary: live retrieval, semantic
reconstruction, persistence, tradie decision actions, pricing hand-off,
customer display, and source-provider approval remain subsequent work.

~~~ts
type RoofEdgeKind = 'ridge' | 'hip' | 'valley' | 'eave' | 'unknown'

type RoofEdgeCandidate = {
  id: string
  kind: RoofEdgeKind
  geometry: GeoJSON.LineString
  plan_length_m: number
  surface_length_m: number | null
  confidence: number // 0–100
  facet_ids: number[]
  reasons: string[]
  evidence: {
    source: 'approved_google_solar' | 'licensed_aerial_dsm' | 'licensed_lidar' | 'geoscape_footprint' | 'fused'
    geometry_source: 'approved_google_solar' | 'licensed_aerial_dsm' | 'licensed_lidar' | null
    support_pixels: number | null
    plane_residual_m: number | null
    dihedral_deg: number | null
  }
}

type RoofEdgeDecision = {
  analysis_id: string
  candidate_id: string | null // null only for a tradie-drawn manual run
  action: 'approve' | 'reject' | 'retype' | 'edit' | 'add_manual'
  kind?: RoofEdgeKind
  geometry?: GeoJSON.LineString
  surface_length_m?: number | null
  actor_id: string
  created_at: string
  note: string | null
}

type RoofEdgeSummary = {
  count: number
  plan_lm: number
  surface_lm: number | null
}

type RoofEdgeAnalysis = {
  id: string
  measurement_id: string
  structure_index: number
  building_id: string | null
  status: 'available' | 'needs_review' | 'unavailable'
  analysis_version: string
  generated_at: string
  source_metadata: {
    geometry_source: 'approved_google_solar' | 'licensed_aerial_dsm' | 'licensed_lidar'
    commercial_approval_reference: string | null
    retention_expires_at: string | null
    google_imagery_date: string | null
    google_imagery_quality: string | null
    geoscape_capture_date: string | null
    geoscape_building_id: string | null
    footprint_alignment_m: number | null
    temporal_review_required: boolean
  }
  candidates: RoofEdgeCandidate[]
  candidate_summary: Record<RoofEdgeKind, RoofEdgeSummary>
  overlay: {
    render_version: string
    width_px: number
    height_px: number
    attribution_required: boolean
    cache_expires_at: string | null
  } | null
}

type RoofEdgeReviewView = {
  analysis: RoofEdgeAnalysis
  decisions: RoofEdgeDecision[]
  candidate_status_by_id: Record<string, 'candidate' | 'approved' | 'rejected' | 'edited'>
  approved_summary: Record<RoofEdgeKind, RoofEdgeSummary>
}
~~~

Raw provider URLs must never be stored. In approved Google mode, every cached
Solar-derived input, reconstruction, and evidence render must expire no later
than the written approval/terms allow. Until written approval explicitly permits
the intended roofer workflow and retention model, do not store or serve
Google-derived candidate geometry or evidence in production. Persistent analysis
and evidence storage is reserved for a source whose licence permits it.

When a recorded approval has a finite valid-until timestamp, it may produce
only no-retention or expiring analysis records, and the analysis expiry must be
at or before that timestamp. Perpetual retained topology therefore requires an
approval with no finite validity cutoff.

Only internal object-storage keys may be retained; provider URLs, signed URLs,
and raw credentials are invalid contract data. Reads must treat a purged record
or an expired `retention_mode = 'expires'` record as unavailable before a
purge worker finishes. A later purge worker deletes retained objects by key,
clears candidate payload and retained keys, then records the purge state. It
does not mutate append-only decisions.

Decision rows never copy candidate geometry: a stored line is explicitly
manual tradie input. Read callers must join the durable source-approval record
and treat a revoked, expired, or out-of-window approval as unavailable even
before the purge worker completes.

## Pricing contract

The feature introduces three separate values:

1. **Form fallback** — the existing inferred counts/derived lengths.
2. **Candidate topology** — unapproved geometry; visible and optionally usable
   for an internal indicative draft.
3. **Approved topology** — tradie-approved values; the only topology measurement
   eligible to become canonical pricing input.

Generation alone must not mutate **metrics.hips**, **metrics.valleys**,
**metrics.ridge_lm**, tier totals, or the customer PDF.

For hip and valley pricing, the authoritative quantity is the approved
**surface/on-roof length**, not a count multiplied by the current per-edge
fallback (`perEdgeLength()` in `lib/roofing/pricing.ts` = √footprint/2 ×
1/cos(pitch), clamped [3, 20] m). Counts remain display/audit values. Add an explicit
measurement override shape:

~~~ts
type ApprovedEdgeMeasurement = {
  hips: { count: number; surface_lm: number; plan_lm: number }
  valleys: { count: number; surface_lm: number; plan_lm: number }
  analysis_id: string
  decision_cutoff_at: string
}
~~~

Extend the pure pricer so it prefers this validated explicit length for the
corresponding hip/valley work. The existing count-to-average-length derivation
remains the form fallback only. A candidate draft can use the same shape, but
only within an internal **candidate_draft** revision.

A candidate with no valid surface length is visible but not priceable. The
tradie must provide/approve a valid surface length, or revert that type to the
form fallback, before it can appear in an indicative or approved revision.

An explicit **Use candidates for draft** action may create an internal quote
revision using the candidate hip/valley surface totals. It must:

- write a **candidate_draft** audit marker;
- display an Indicative — topology candidates awaiting review warning;
- never overwrite or publish the existing customer-visible quote;
- keep release blocked until tradie confirmation; and
- let the tradie revert to the form fallback or approve/edit candidates.

When a tradie approves or edits candidates, aggregate the approved logical runs:

- approved hips and valleys feed the new explicit-length override path, which
  preserves the measured surface lm rather than regenerating an average length;
- approved ridges remain separately visible and feed capping/material quantities
  where supported;
- approved eaves remain evidence/measurement only unless a separate, explicit
  gutter scope is selected; and
- box gutters remain manual until a distinct reliable method exists.

Existing tier double-count protection remains unchanged: work already included in
a full re-roof scope must not be added again as a charge.

The current measurement flow does not yet pin a rate-card snapshot. Before any
candidate or approved topology revision can price, add an exact rate-card JSON
snapshot for new measurements/revisions and use that same snapshot. A legacy
measurement without one is unavailable for topology pricing until the tradie
deliberately creates a clearly labelled new-current-rate revision; never
silently reload a live tenant rate card while approving an edge later.

## API and authorization

Add an authenticated dashboard-only topology-analysis action:

~~~text
POST /api/dashboard/roofing/measurements/[id]/edge-analysis
~~~

It performs source retrieval, alignment, candidate generation, and snapshot
persistence. It must require an authenticated user, tenant membership, ownership
of the measurement, enabled feature flag, and an approved source mode. The
public measurement capability token alone must not authorize an expensive
re-analysis, candidate decision, or pricing-affecting mutation.

Add authenticated, audited internal actions:

~~~text
PATCH /api/dashboard/roofing/measurements/[id]/edge-decisions
  analysis_id: string
  edge_decisions: [{ candidate_id, action, kind?, geometry?, surface_length_m?, note? }]

POST /api/dashboard/roofing/measurements/[id]/topology-draft
  analysis_id: string
  mode: 'candidate_draft' | 'approved_topology'
~~~

The original public Measurement Results link may show only a source-permitted
read-only result. All candidate changes and draft/approval pricing actions stay
behind dashboard authentication.

The APIs must reject:

- candidate IDs outside the selected main dwelling;
- an analysis whose measurement, structure index, or building identifier does
  not match the selected main dwelling;
- non-finite or negative lengths;
- an unsupported kind;
- geometry outside a modest tolerance of the selected roof; and
- a caller without tradie tenant authority;
- a request before the source-use commercial gate is approved; and
- an attempt to mutate a released/customer-visible quote in place.

## Measurement Results UI

Add a **Roof topology evidence — Main dwelling** section above the existing
manual edge-count controls.

The current footprint-candidate bridge implements the placement and visual
language now: real property aerial, restrained numbered illustrative zones,
hairline low-opacity seams, compact coloured total cards, and an unavoidable
review-required/non-survey-grade warning. Provisional R/H/V/E paths and bubbles
are deliberately absent from the image. The bridge has no confidence, approval,
or semantic source-evidence claim. The richer layers below remain the future
source-approved mode.

### Future source-approved evidence layers

Render two clearly separate layers:

1. **Facet assignment evidence**
   - uses the locally reconstructed facet fills and numbered Plane 00–21 badges;
   - caption: “Derived facet reconstruction — candidate evidence, not source
     truth or edge types”; and
   - is never used as the semantic-line legend.

2. **Topology candidate overlay**
   - ridge: magenta **#FF375F**, label **R-01**;
   - hip: orange **#FF9F0A**, label **H-01**;
   - valley: blue **#0A84FF**, label **V-01**;
   - eave: green **#30D158**, label **E-01**;
   - unresolved: purple **#BF5AF2**, dashed label **U-01**.

The default result image shows facet evidence only. Semantic lines are revealed
on demand for one selected type or candidate, use a thin low-opacity stroke, and
do not receive permanent map bubbles or a multi-stroke halo. The selected line's
identifier, length, and confidence — for example **V-02 · 4.8 m · 84%** —
belongs in the adjacent evidence panel. Candidate lines are dashed; approved and
edited lines are solid. Colour is never the only distinguishing signal.

### Matching result frames

Use four matching coloured cards beside/below the image:

- Ridges — logical-run count, candidate lm, approved lm;
- Hips — logical-run count, candidate lm, approved lm;
- Valleys — logical-run count, candidate lm, approved lm; and
- Eaves — logical-run count, candidate lm, approved lm, labelled “not a gutter
  quote”.

Selecting a card temporarily reveals only that type's lines. Selecting a line
opens its evidence, confidence reasons, source facets, and review actions:
approve, reject, relabel, edit length/geometry, or draw a missing line.

Show the geometry-source date/quality, Geoscape capture date, selected building,
alignment state, source/retention status, and required attribution below the
image. Keep topology evidence separate from AI work-plan zones so scope labels
cannot be mistaken for measurements.

## Confidence and release gates

Mark the full analysis **needs_review** when any of the following applies:

- uncertain main-dwelling selection;
- poor geometry-source-mask/Geoscape-footprint overlap;
- excessive footprint offset;
- material source-date conflict;
- high tree-overhang/occlusion signal;
- low imagery quality;
- too few supported DSM samples;
- high plane-fit residual; or
- a large unresolved-boundary proportion.

Thresholds start configurable and are calibrated against labelled roofs. Before
calibration, all generated candidates are review-required.

Candidate creation must not make a roofing quote eligible for auto-send. The
existing roofing human-review requirement remains the final safety gate.

## Test and evaluation plan

Gate commands (this repo uses **pnpm**): `pnpm test` (vitest — node-only, no
jsdom/testing-library, so `.test.tsx` component tests are not the harness),
`pnpm run typecheck` (`tsc --noEmit`), `pnpm test:e2e` (playwright, the vehicle
for the golden-image/overlay visual tests). New tables follow the repo
convention: a `sql/migrations/NNN_*.sql` + a `scripts/run-migration-NNN.mjs`
with RLS enabled (migration-040 baseline), server routes on the service-role key
with app-layer `tenant_id` filtering. Phase 1 validates the migration only on a
disposable database when one is available; it does not apply a topology migration
to production. On this Windows workspace, use `pnpm.cmd` for command execution.

### Phase 1 acceptance tests

- `ROOFING_EDGE_ANALYSIS_ENABLED` is default-off and independent of
  `ROOFING_SOLAR_ENRICHMENT`; a Google key alone cannot enable analysis.
- Source access requires the feature flag, recorded source mode, applicable
  written approval reference, and valid retention window.
- The immutable envelope rejects provider URLs, unsupported kinds (including
  `gutter`), duplicate candidate ids, invalid geometry, and negative or
  non-finite lengths.
- An explicit confirmed main-dwelling selection wins over a larger shed.
- A material source-date mismatch yields `needs_review`.
- Before the benchmark/calibration gate exists, every Phase 1 envelope remains
  needs_review even when source dates align.
- Creating a Phase 1 analysis leaves the input quote, metrics, tiers, totals,
  and customer/PDF inputs byte-for-byte unchanged.
- Benchmark manifests cover gable, hip, L-valley, dormer, tree-covered,
  solar-covered, and multi-structure cases without Google-derived bytes.
- Migration inspection proves the recorded source-approval table plus all
  three evidence tables exist with RLS enabled, tenant-bound foreign keys,
  retention indexes, database append-only decisions, and immutable/redactable
  evidence; no public-token topology route or pricing edit is added.
- The opt-in migration runner fails before commit if an expected trigger or
  index is absent, RLS is disabled, or any public policy is present.

### Unit tests

- vectorisation, snapping, fragment merging, and logical-run counts;
- plane fit and 3D length calculations;
- convex/concave classification;
- ridge-versus-hip endpoint classification;
- eave alignment and no-gutter-pricing guarantee;
- candidate/approved summary arithmetic; and
- invalid review payload rejection.

### Integration tests

- analysis is unavailable until the commercial-source gate is recorded;
- main dwelling selected while nearby shed/carport is excluded;
- materially different geometry-source and Geoscape capture dates produce a
  visible warning;
- generation alone leaves quote and PDF totals unchanged;
- explicit candidate draft is labelled and cannot release;
- approved candidates reprice only through the canonical deterministic path;
- a measured 4.8 m approved valley stays 4.8 m in pricing rather than reverting
  to a count-derived average;
- a topology revision retains the original pricing-book/rate-card snapshot;
- rejected/edited candidates persist and recompute the correct totals; and
- existing multi-structure selection and inspection routing remain intact.

### Visual tests

- golden-image test for facet labels and semantic-line overlay;
- legend, text labels, and low-confidence dashed state remain accessible; and
- a selected card highlights the correct geometry.

### Evaluation set

Build a consented, roofer-labelled benchmark of simple gable, hip, L-shaped
valley, dormer, tree-covered, solar-covered, and multi-structure roofs. Track:

- count precision/recall by type;
- exact-count rate per roof;
- median absolute plan and surface-length error;
- main-dwelling selection accuracy;
- confidence calibration; and
- candidate-to-approved edit/reject rate.

Do not widen the tenant feature flag until the benchmark is reviewed with a
roofer and the confidence thresholds are calibrated.

## Delivery sequence

1. **Data contract, fixtures, and storage guardrails (Phase 1; stop for
   review).** Add the source-independent data contract, synthetic/licensed
   benchmark fixtures, source-date/alignment policy, retention/purge policy,
   a recorded source-approval table, immutable/append-only persistence tables,
   and a NEW default-off server flag
   (`ROOFING_EDGE_ANALYSIS_ENABLED`) distinct from the existing
   `ROOFING_SOLAR_ENRICHMENT` pitch-enrichment flag. No provider calls, UI,
   public route, price/pricer edit, quote/PDF mutation, or production migration
   application. Solar imagery must not be reused for topology without written
   approval.
2. **Guarded source-adapter seam (partial implementation)** — the current
   server-only Google Data Layers seam accepts only an injected transport and
   tenant-bound approval context, and no application code invokes it. After the
   commercial-source gate passes, replace that seam with a live orchestrator
   which chooses one approved source row, retrieves source data, and produces
   purgeable main-dwelling topology snapshots.
3. **Evidence review UI (synthetic-preview partial implementation)** — the
   current dashboard-only page renders a fixed neutral SVG benchmark, coloured
   numbered frames, and candidate summary cards. It does not represent a saved
   property. Once a real analysis exists, replace its fixture-only payload with
   source-permitted candidate data and add audited review actions.
4. **Controlled draft pricing** — add explicit candidate-draft use and clear
   warning/revert behaviour.
5. **Approved-pricing hand-off** — wire approved aggregate values through the
   existing deterministic reprice path; preserve customer/PDF parity.
6. **Pilot and calibration** — run the evaluation set with a roofing tradie,
   tune thresholds, then enable by tenant.

## Full source-approved feature definition of done

The footprint-candidate visual bridge does not, by itself, satisfy this full
definition of done.

- The main dwelling is explicitly selected and detached structures do not affect
  its candidate totals.
- Measurement Results shows a real, data-derived semantic overlay plus the
  locally reconstructed numbered facet evidence, with no colour/label ambiguity.
- Every immutable candidate records geometry, lengths, confidence, evidence, and
  source dates; append-only review decisions determine its current review state.
- Candidate generation alone never changes stored quote/PDF totals.
- A tradie can approve, edit, reject, and manually add candidates; approved
  totals feed the existing deterministic pricing path correctly.
- Candidate-derived drafts are visibly indicative and cannot auto-release.
- Eave results are never silently represented as gutter length.
- Provider credentials stay server-side, source use/retention/display complies
  with the applicable contract, and no Google Solar roofing workflow ships
  without written approval.
- Unit, integration, and golden-image tests cover the defined failure modes.
- A roofer-reviewed benchmark documents the accuracy and confidence gate before
  tenant rollout.

## Implementation handoff

Build a server-side, deterministic roof-topology candidate engine for the
selected main dwelling **only after an approved commercial geometry source is
available**. Fuse its DSM/RGB/mask/plane metadata with the Geoscape footprint
only to constrain and validate the exterior roof boundary. When facet pixels are
not source-supplied, label the local facet reconstruction as candidate evidence.
Infer, merge, and measure logical ridge, hip, valley, eave, and unknown runs;
persist immutable analysis and append-only decisions according to source
retention rights. Add a separate Measurement Results evidence panel with
numbered reconstructed facet evidence, opt-in semantic candidate lines,
type-prefixed details in the review panel, and matching compact summary cards.
Do not alter a customer-visible
quote on generation. Candidate drafts and approved topology must be internal
quote revisions pinned to the original pricing-book snapshot. Maintain roofing's
review-required release gate, source-date warnings, provider attribution, and
the current form-based fallback.
