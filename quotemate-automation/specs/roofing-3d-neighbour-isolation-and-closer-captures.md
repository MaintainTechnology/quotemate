# Roofing 3D model — isolate the subject house and frame captures closer

## Title
Generated 3D models contain only the subject property, built from captures framed noticeably closer.

## Goal
A 3D model generated for an address reconstructs the subject house only — neighbouring buildings are
removed at the Gemini-polish step before Tripo ever sees the captures — and every auto-orbit capture
frames the house at least ~20% closer than today (orbit range strictly smaller for every footprint).
Why: neighbours baked into the model are unwanted structures the tradie can't remove, and the current
framing makes the house too small in the polished captures, anatomy overlays and the model itself.

## Role
Principal engineer for this repo. Reason before acting; make real edits with tools; independent tool
calls in parallel, dependent in sequence; never pass a guessed parameter — read the file or run the
check first.

## Context (grounded in code opened this session)
- Pipeline: `app/m/[token]/Roof3DModelSection.tsx` orbits CesiumJS over Google Photorealistic 3D
  tiles through 4 stops (`VIEWS`, pitch −32°, range = `captureRangeM` prop), screenshots each stop
  (`cropCenterDataUrl` centre-crops to 4:3), POSTs to `app/api/roofing/model3d/[token]/route.ts`,
  which fast-acks and runs `startModel3d` (`lib/roofing/model3d.ts`) in `after()`: per view it
  polishes via Gemini (`enhanceCapture`, prompts `ENHANCE_SYSTEM`/`ENHANCE_USER` at
  lib/roofing/model3d.ts:200–208), caches the polished image per address+view
  (`lib/roofing/capture-cache.ts`, bucket `roof-models`, path `{kind}/{addressKey}/{view}`), then
  uploads the polished views to Tripo3D multiview-to-model. **The polished captures are exactly what
  Tripo reconstructs** — whatever is in them ends up in the GLB.
- Neighbour root cause: the current enhance prompt explicitly preserves everything —
  "You never invent, add, remove, or move structures" / "Preserve the exact building geometry, roof
  shape, colours **and surroundings**". Neighbours in frame are therefore polished and reconstructed.
- Framing root cause: `app/m/[token]/page.tsx:166–175` computes
  `captureRangeM = bbox ? Math.max(26, bboxDiagonalM + 10) : 45` from the primary structure's
  footprint (`polygonBBox`/`edgeLengthM` from `lib/roofing/map-utils.ts`). The adjacent comment
  ("diagonal × 1.3 + 10, floored at 30") has drifted from the code. `captureRangeM` is used by both
  the auto orbit (`generate`) and the manual-capture initial camera (`openManual`).
- Cache poisoning risk: polished captures are cached cross-tenant per address
  (`enhanced/{addressKey}/{view}`, `anatomy/{addressKey}/{view}`; `cachePathFor` at
  lib/roofing/capture-cache.ts:60). After the prompt change, previously-cached polished images still
  contain neighbours and would be reused by `getCachedEnhanced` and displayed by `signedPolished`
  (lib/roofing/model3d.ts:431–443, which reads the same `cachePathFor` paths). The cache paths must
  be versioned so stale pre-fix images are never reused or displayed. Do NOT delete old objects.
- Existing tests to extend (repo pattern: pure helpers unit-tested with vitest):
  `lib/roofing/model3d.test.ts`, `lib/roofing/capture-cache.test.ts`.
- Gates (from package.json): `npm test` = `vitest run --testTimeout=20000`;
  `npm run typecheck` = `tsc --noEmit` (this repo has NO `npm run check` script);
  `npm run lint` = eslint; `npm run test:e2e` = playwright (needs a dev server + live data — see
  Acceptance for what /verify covers instead).
- The model never feeds measurements/pricing (Track B, visual only) — nothing here touches money
  paths, `roofing_measurements` geometry, or the grounding validator.

## Task
1. **R1 — neighbour removal at the polish step** (`lib/roofing/model3d.ts`):
   rewrite `ENHANCE_SYSTEM` and `ENHANCE_USER` (and export both constants for the contract test) so
   Gemini: (a) keeps the single property at the centre of the frame pixel-faithful — geometry, roof
   shape, colours, proportions, camera angle unchanged, including structures on the same lot
   (garage, shed, pool, deck); (b) REMOVES neighbouring houses and buildings that are not part of
   the central property, filling their space with plausible neutral ground (lawn/driveway/
   vegetation) consistent with the surroundings; (c) still upscales/sharpens as before. Update the
   stale file-header and function comments that describe the old "never remove structures" contract.
2. **R1 — cache versioning** (`lib/roofing/capture-cache.ts`): version the cache path so pre-fix
   polished/anatomy images are never reused or shown: `cachePathFor` returns
   `{kind}/v2/{addressKey}/{view}` (a single exported or module-level version constant; bump once,
   both kinds). No deletions of old objects; they are simply orphaned. Update the file-header path
   doc. (`getCachedEnhanced`/`putCachedEnhanced`/`signedPolished` all route through `cachePathFor`,
   so no other call-site changes.)
3. **R2 — closer capture framing**: add a pure exported helper `captureOrbitRangeM(diagonalM:
   number | null): number` to `lib/roofing/model3d.ts` (with the other pure helpers):
   `null`/non-finite/≤0 → `36`; else `Math.max(21, diagonalM * 0.8 + 8)`. This is strictly smaller
   than the current `max(26, d + 10)` / `45` for every input (≈20% closer across the domain) while
   keeping headroom for building height at pitch −32°. Replace the inline formula in
   `app/m/[token]/page.tsx:166–175` with a call to the helper (page still computes the bbox diagonal
   via `edgeLengthM`), and fix the drifted comment to describe the helper.
4. TDD (Red before Green) — extend the existing test files:
   - `lib/roofing/model3d.test.ts`: `captureOrbitRangeM` — floor of 21 for small diagonals; linear
     value for representative diagonals (e.g. 20 → 24, 30 → 32); 36 fallback for null/NaN/0; and a
     "strictly closer than the old formula" property across a sweep of diagonals
     (`captureOrbitRangeM(d) < Math.max(26, d + 10)` and fallback `36 < 45`).
   - `lib/roofing/model3d.test.ts`: prompt contract — `ENHANCE_USER`/`ENHANCE_SYSTEM` instruct
     removing neighbouring buildings AND preserving the central house unchanged (assert on the
     stable key phrases, e.g. /remov/i + /neighbour/i present, and central-house preservation
     language present).
   - `lib/roofing/capture-cache.test.ts`: `cachePathFor` builds `enhanced/v2/{key}/{view}` and
     `anatomy/v2/{key}/{view}`.
5. /verify — run the dev server and load a roofing measurement page (`/m/[token]`) with Playwright:
   confirm the page renders the 3D-model section without errors and the server-computed
   `captureRangeM` reaching the client matches the new helper for that measurement's footprint.
   Do NOT run a paid Tripo build or Gemini calls as part of the gate (a full generation costs real
   money and needs live keys); the unit tests own the prompt/cache/range contracts.

## Constraints
- Touch only: `lib/roofing/model3d.ts`, `lib/roofing/capture-cache.ts`, their two test files, and
  `app/m/[token]/page.tsx`. No new files besides this spec. Do not modify
  `Roof3DModelSection.tsx` (pitch −32°, crop, orbit stops stay), the API route, Tripo request
  parameters, or the anatomy prompts.
- Never delete or overwrite existing storage objects; versioning orphans them deliberately.
- Do not refactor unrelated code; the working tree has unrelated in-progress changes (onboard
  schema, PDF chrome, `lib/brand/`) — leave them untouched and do not commit them with this work.
- The 4:3 crop and manual/upload flows keep working unchanged; manual mode simply starts its camera
  closer (tradie can still zoom freely).
- No hard-coded test workarounds; the range helper must be a correct general formula.

## Acceptance criteria & gates
- `npm test` passes, including the new Red-first tests listed in Task 4.
- `npm run typecheck` passes.
- `npm run lint` passes on the touched files.
- /verify (Playwright against the dev server): `/m/[token]` renders the 3D-model section
  error-free and the client receives the new, smaller `captureRangeM`.
- /review confirms every numbered Task item requirement-by-requirement; /code-review reports no
  blocker/major findings on the diff.

## Examples
<example>
Closest pattern for the pure-helper + test extraction: `buildMultiviewTaskBody` /
`parseTripoTask` in lib/roofing/model3d.ts (the "pure helpers (unit-tested)" section) and their
tests in lib/roofing/model3d.test.ts — `captureOrbitRangeM` follows the same shape.
</example>
<example>
Closest pattern for the cache-path change: `cachePathFor` tests in
lib/roofing/capture-cache.test.ts ("builds enhanced/{key}/{view}", "separates anatomy overlays") —
the v2 change updates these expectations in place.
</example>
<example>
Prompt-contract precedent: ANATOMY_LEGEND in Roof3DModelSection.tsx is kept in sync with
ANATOMY_USER's colour instructions by comment ("must match the colours ANATOMY_USER asks Gemini to
draw") — the new ENHANCE_* contract test makes the same kind of coupling checkable instead of
comment-only.
</example>
