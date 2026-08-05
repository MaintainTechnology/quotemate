# Painting SMS parity + form address autocomplete

Date: 2026-08-05
Status: ready to build

## Objective

Two deliverables, both scoped to the painting funnel:

1. **The painting SMS receptionist offers two genuine paths — form or
   conversation — consistently**, whichever engine (LLM or deterministic)
   drives the turn, and the SMS questions cover the same inputs as the
   `/paint-request/[token]` form.
2. **The public painting request form gets Geoscape address autocomplete**
   (the same Predictive API the roofing dashboard already uses), with
   postcode + state auto-filled from the picked suggestion.

## Background — what recon established (do not re-litigate)

- The deterministic painting state machine (`lib/sms/painting-intake.ts`,
  `lib/sms/painting-receptionist.ts`) ALREADY implements the full dual-path
  flow: `offer_form` opener → `await_form` on a form cue, else question-by-
  question gather (address → confirm → location → scopes → coats → condition
  → ceiling_height → storeys → colour_change) → estimate/inspection.
- The **LLM receptionist path (`SMS_LLM_RECEPTIONIST_ENABLED` default ON) has
  no form concept**: `mapPaintingTool` (lib/sms/llm-receptionist.ts) never
  produces `offer_form` or `await_form`. Consequences:
  - A fresh painting enquiry only gets the form offer when the LLM errors out
    and the turn falls back to the deterministic machine. Otherwise the LLM
    jumps straight into Q&A and the form is never offered.
  - After a form offer, a customer who says "I'll use the form" cannot be
    parked at `await_form` by the LLM path — they get asked the address.
- The form field `manual_floor_area_m2` (optional override) is NEVER
  capturable over SMS: no question asks it and `applyPaintingAnswer` never
  sets it. Every other form field maps 1:1 to an SMS slot.
- Geoscape Predictive is wrapped in `lib/roofing/providers/predictive.ts`
  (`PredictiveProvider.suggest(query, state)` → suggestions with parsed
  state/postcode) and served to the **tradie-authed** dashboard by
  `POST /api/roofing/suggest-address` + the
  `app/dashboard/roofing/_components/AddressAutocomplete.tsx` typeahead.
  The paint-request form is PUBLIC (capability = the per-request token in
  the URL), so it cannot call the tradie-authed route.
- `app/_components/AddressAutocomplete.tsx` is a DIFFERENT component
  (Google Places via `/api/solar/places`) — not the Geoscape one. Leave it
  alone; the user specified Geoscape.

## Requirements

### R1 — the opener always offers both paths

On a fresh painting enquiry (no active painting flow), the receptionist MUST
send the form-offer opener (`buildPaintingFormOffer`: form link + "or just
reply here and I'll ask a few quick questions") **regardless of the LLM
flag**. Implementation: `handlePaintingTurn` in `app/api/sms/inbound/route.ts`
pre-empts the LLM and uses the deterministic decision for that turn.

The pre-empt condition MUST live as a pure, exported, unit-tested helper in
`lib/sms/painting-receptionist.ts` (route stays thin):

```
paintingTurnIsDeterministic(prev, inbound): boolean
  = !isActivePaintingFlow(prev)                       // opener turn
  || (prev.last_step === 'offer_form' && customerWantsForm(inbound))  // R2
```

### R2 — choosing the form works on the LLM path

When the thread is parked at `offer_form` and the inbound message is an
explicit form cue (`customerWantsForm`), the turn MUST resolve to
`await_form` with the existing acknowledgement — again regardless of the LLM
flag (covered by the same pre-empt; `advancePainting` already produces it).

A non-form reply after the offer keeps its current behaviour on both paths
(Q&A starts; address captured opportunistically when present).

### R3 — floor-area parity with the form

Add an optional `floor_area` step to the SMS gather:

- Asked ONCE, positioned after `storeys` and before `colour_change`
  (so "Last one —" on colour_change stays true).
- Wording must make clear it is optional and skippable, e.g.: "If you know
  the approximate floor area in square metres, reply with the number —
  or say 'not sure' and I'll measure it from the property footprint."
- Parsing (`applyPaintingAnswer`, step `floor_area`):
  - a number 1–2000 (accepting "180", "180m2", "180 sqm", "about 180") →
    `manual_floor_area_m2 = number`
  - anything else (including "not sure") → `manual_floor_area_m2 = null`
    (asked-and-skipped; the address lookup supplies the area as today).
  - Asked-once semantics (like `colour_change`): the step never re-asks.
- Tri-state on the slot: `undefined` = not yet asked (existing persisted
  states resume into the new question mid-gather — acceptable and intended),
  `null` = asked and skipped, number = provided.
- `paintingReadiness` and `nextPaintingStep` treat `undefined` as
  `need_more` / ask; `toPaintingRequest` passes the number through
  (already does via `?? null`).
- `ANSWERABLE_STEPS` in painting-receptionist.ts gains `floor_area`.
- LLM path: `PaintingSlotPatch` gains
  `manual_floor_area_m2: z.number().min(1).max(2000).nullish()` so a
  volunteered area ("it's about 180sqm") lands in the slots; if the system
  prompt enumerates the painting gather steps/questions anywhere, the list
  is updated to include the optional floor-area question.
- All existing tests that walk the gather to `ready` are updated for the
  new step; new unit tests cover the parser, the ordering, readiness, and
  the asked-once/skip behaviour.

### R4 — both paths converge (verify, no build expected)

The form POST (`/api/paint-request/[token]`) and the SMS `estimate` action
must produce the same painting estimate request shape (`EstimateRequest`)
into the same pipeline. Recon says they already do (`toPaintingRequest`
mirrors the form body). The review pass MUST verify this and fail the build
if the shapes have drifted.

### R5 — Geoscape autocomplete on the public painting form

- New route: `POST /api/paint-request/[token]/suggest-address`.
  - Token-gated: the `painting_lead_requests` row for `[token]` must exist
    with status `pending`; otherwise 404/410-equivalent JSON error.
  - Body `{ query: string (3–200 chars), state?: AU state }`, zod-validated.
  - Proxies `PredictiveProvider.suggest(query, state)` — GEOSCAPE_API_KEY
    stays server-side. Returns the provider's `SuggestResult` as JSON.
  - No new auth mechanism; no Clerk. The token IS the capability, matching
    the repo's existing token-gated public routes.
- `app/dashboard/roofing/_components/AddressAutocomplete.tsx` is
  generalised **backward-compatibly** (all existing importers unchanged):
  - optional `endpoint?: string` (default `/api/roofing/suggest-address`),
  - optional `auth?: boolean` (default `true`); when `false` the component
    sends no Authorization header and does not call `getAuthToken`.
- `PaintRequestForm.tsx` replaces the plain address `<input>` with the
  generalised component pointed at the token route with `auth: false`;
  picking a suggestion fills address AND auto-fills postcode + state when
  the suggestion carries them.
- Failure behaviour: provider down / no key / no results → the field
  behaves exactly like the current plain input (silent, submit still works).
- Tests: route handler test (token gating + happy path with a stubbed
  provider) following the repo's existing route-test pattern if one exists
  for token routes; component behaviour is covered by typecheck + existing
  patterns (no new e2e required).

### R6 — non-goals

- No changes to the roofing / electrical / solar SMS flows (beyond the
  backward-compatible component props).
- No dashboard painting page changes; no `/api/solar/places` changes.
- No backfill of existing conversations; live mid-gather states simply see
  the new floor-area question.
- Vision/detect models untouched.
- No new npm dependencies.

## Definition of done

1. `npx tsc --noEmit` clean.
2. Full `npx vitest run` green (existing + new tests).
3. New unit tests exist for: `paintingTurnIsDeterministic`, the floor-area
   parser + step ordering + readiness, and the suggest-address route gate.
4. The review pass (specs → build verification) confirms every requirement
   R1–R5 with file:line evidence and R6 non-goals unviolated.
