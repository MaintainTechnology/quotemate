# Roofing SMS receptionist — round-4 defects (post-quote silence + NLU gaps)

## Title
Never leave a roofing thread silent after a quote, and close the NLU gaps two live acceptance rounds surfaced (G10/R3/A4, G6, G7, R1, G1, R5).

## Goal
A live re-run shows a post-quote follow-up ALWAYS gets a reply (price objection, clarifying question, new-address request), a roof emergency engages roofing, a one-shot brief skips the pitch question, and a natural-language structure pick works. Why: post-quote silence kills the conversion moment, and an unengaged roof emergency is a lost urgent lead.

## Role
Principal engineer. The roofing gather/intake are PURE unit-tested modules; the SMS route is shared by all eight trades and the money path, so route changes must be additive and bounded — no rework of the lock election or the quote pipeline.

## Context (grounded in code opened + a live probe)
- **G10/R3/A4 root cause = lock/coalesce orphan, NOT the inflight gate.** `isQuoteInflight` (`lib/sms/inflight.ts:47`) is true ONLY for `status==='structuring'`; a quoted roofing thread persists `status='open'`, so `inflightContinuation` is false and the original hypothesis is wrong. The real cause: the leader claims the per-conversation lock (`route.ts:1664-1699`, `LOCK_DURATION_MS=60s`), reads authoritative history ~2s in (`:1811`), then spends ~90s (measure + photos + quote + notify + PDF) before releasing `processing_until` in `finally` (`:3544-3557`). A follow-up arriving in that window loses the lock claim and **bails at `:1692-1698` with no dispatch**; the leader has already read history, so the inbound is never processed — silence forever. **Probe (2026-07-25):** the identical message sent to the same quoted thread with no lock held replied in ~5s, confirming the orphan.
- **G10 second defect (found by the same probe):** the reply was "What's the property address?" — in the `quoted` branch (`roofing-receptionist.ts:556-574`) `looksLikeRoofingEnquiry("does that price include the gutters?")` is TRUE (`gutter` is in `ROOFING_KEYWORDS`), so a post-quote QUESTION falls through to the reset and restarts the gather instead of being answered.
- **G6** — `looksLikeRoofingEnquiry` (`roofing-intake.ts:132`) needs bare `roof` + a `ROOFING_WORK` (`:123`) word; emergency/damage vocabulary (collapsing, caving in, hole, sagging, storm, blown off, tree through) is absent, so "MY ROOF IS COLLAPSING" fell to the general dialog. `NOT_ROOFING` (`:115`) must keep "fan in the roof cavity" electrical.
- **R1** — the opener-harvest branch (`roofing-receptionist.ts:659-686`) parses intent/address/material/year but NOT pitch, so a complete one-shot brief re-asks pitch.
- **G7** — at `confirm_roof` a non-numeric pick ("just the big one") is not parsed by `parseStructureChoice`, so the building list is re-sent.
- **G1** — `extractStreetAddress` takes from the first digit run, so "$1 at 670 London Road…" yields "1 at 670…".
- **R5** — "warehouse roof at 670 London Rd" measured + firm-priced through the residential flow; a wrong commercial firm price is customer-facing money-path risk.
- Live harness `.scratch-audit/scenario-runner.mjs`; tests `lib/sms/*.test.ts` (vitest).

## Task (blocker first)
1. **G10/R3/A4 drain (BLOCKER)** — in the route's `after()` `finally`, BEFORE releasing the lock, re-read messages; if an inbound arrived after our last outbound (unreplied orphan) on a conversation with an active roofing state, run ONE bounded recovery pass: re-run `handleRoofingTurn` with the fresh history; if it does not handle the turn (passthrough), send ONE honest acknowledgement so the thread is never silent. Bounded to a single pass; never re-runs the quote/intake pipeline; failures are logged and never block the lock release.
2. **G10 quoted-question** — in the `quoted` branch, a message that is a QUESTION (and not a structure pick / new address / stop) must NOT restart the gather; hand it to the acknowledgement/dialog path instead of resetting slots.
3. **G6** — add roof emergency/damage vocabulary so an emergency engages roofing; keep `NOT_ROOFING`.
4. **R1** — harvest pitch in the opener-harvest branch.
5. **G7** — natural-language structure picks: "the big one"/"biggest"/"main one"/"the house" → primary; "the shed"/"the garage" → matching secondary label; ambiguous → safe re-ask.
6. **G1** — prefer the number that begins a plausible street (number followed by a street-name word); fall back to the first number. Must not regress units ("3/50") or "223 Archer St".
7. **R5** — an explicit commercial signal (warehouse, factory, industrial, commercial, strata, apartment block, shopping centre) routes to on-site inspection instead of auto-sending a residential firm price.
8. **Decide/log** — G5 (multi-trade acknowledgement), R2/G3 (fragment stitching), R6 ("same address as last time") — implement only if minimal and provably safe, else document with rationale.

## Constraints
- Route change is ADDITIVE and bounded (one recovery pass, in `finally`, never blocking the lock release); do NOT rework the lock election, debounce, or the quote/intake pipeline; never re-draft a quote.
- Minimal, correct, general fixes; reuse existing helpers; no unrelated refactors. No em dashes in customer SMS; AU/NZ. Verification is a net, not a gate.
- Do not break F1-F15, U1/U2/U3, B1, P1-P3, the F4 recovery net, the F12 unit fix, or the cross-step work.

## Decided: logged, not implemented (rationale)
- **G5 (multi-trade acknowledgement)** — deferred. The roofing composer is pure and per-trade; making it name other trades needs cross-trade coordination in the shared route and risks promising work the tenant may not offer. One trade per SMS thread stays the design; the general dialog already handles a multi-trade opener when roofing does not engage.
- **R2/G3 (fragment stitching)** — deferred. Stitching "670 London" + "Road Chandler QLD 4155" cannot be made provably safe: the same shape stitches unrelated fragments (a postcode from an earlier property, a phone number) into a wrong address on the money path. The safe re-ask stands; the F4 recovery net already covers a COMPLETE address that was dropped.
- **R5 `commercial` is write-once** — accepted. Once set it is never cleared within a gather, so "my neighbour's warehouse blew off, quote my house at …" stays on the inspection route. The bias is toward a human looking at it, which is the safe direction on the money path; it resets on the normal quoted/closed reset.
- **Drain is acknowledgement-only** — accepted, by design. It never re-runs the state machine: doing so would re-enter the measure/quote pipeline outside the `roofingEnabled`/inflight guards and, since a ~90s run outlives the 60s lock, could produce a duplicate measurement, a duplicate priced SMS and a second mintable quote link. The ack invites the customer to resend; that turn is then processed normally under a fresh lock.
- **R6 ("same address as last time")** — deferred. Resolving it re-introduces exactly the stale/cross-tenant address risk the U1/P1 audits closed (a phone-keyed row can hold another tenant's or an old job's address). Re-asking is one extra turn and always correct.

## Acceptance criteria & gates
- **Drain**: unit — the pure "is there an unreplied inbound after our last outbound?" predicate is true for `[…, outbound, inbound]` and false for `[…, inbound, outbound]` / no-inbound. Live: R3 (price objection), G10 (clarifying question) and A4 (new-address second quote) each receive a reply.
- **G10 question**: unit — at `quoted`, "does that price include the gutters?" does NOT return an `ask address` reset; a structure follow-up still re-serves and a new full address still reopens.
- **G6**: unit — `looksLikeRoofingEnquiry` true for "my roof is collapsing", "roof caving in", "hole in my roof", "roof blew off in the storm"; false for "the fan in the roof cavity needs replacing".
- **R1**: unit — advanceRoofing on "full reroof at 670 London Rd Chandler QLD 4155, colorbond corrugated, standard pitch" harvests pitch (next step is not `pitch`).
- **G7**: unit — "just the big one" → structure 1; "the shed" → the shed's index; ambiguous → null (re-ask).
- **G1**: unit — `extractStreetAddress('$1 at 670 London Road Chandler QLD 4155')` starts at "670"; "3/50 Connor St" and "223 Archer St" unchanged.
- **R5**: unit — a commercial signal routes to inspection (no firm auto-send).
- **Gates each iteration**: `npx vitest run lib/sms lib/customers` green; `npx tsc --noEmit` clean; /review + /code-review no blocker/major (each finding adversarially verified); after deploy a live scenario-runner re-run with no regression to F11/F15c/F14/F4/F12/A1/A2.

## Examples
<example>
Drain mirrors the existing `finally` lock-release block (route.ts:3544) — same fail-soft shape (try/catch, log, never throw), added just before the release so the orphan is served while we still own the lock.
</example>
<example>
G6 mirrors the existing ROOFING_WORK stem list (roofing-intake.ts:123) — add damage/emergency stems (collaps\w*, caving, cave in, sagging, blown off, storm\w*) alongside quot\w*/leak\w*, keeping the NOT_ROOFING pre-check that already protects "roof cavity".
</example>
<example>
G7 mirrors parseStructureChoice's existing bare-"main" handling — extend the same function with label/size synonyms rather than adding a new parser.
</example>
