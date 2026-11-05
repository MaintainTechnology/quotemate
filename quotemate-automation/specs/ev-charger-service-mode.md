# EV charger service mode

Date: 15 September 2026

## Problem

`supplied_by` records who provides an EV charger, but it cannot distinguish a
supply-only sale from a supply-and-install job. The SMS receptionist therefore
treated a customer's question, "can you supply?", as permission to quote an
installation as well. The resulting quote could also describe supply and
installation while pricing installation only.

This specification supersedes the EV service-intent parts of
`ev-charger-sms-auto-quote.md` and `ev-charger-job-quoter.md`. Existing pricing,
grounding, photo, inspection and human-review controls remain in force unless a
requirement below narrows them for supply-only work.

## Canonical state

Every resolved EV charger intake has one explicit
`scope.specs.service_mode` value:

- `supply_only`: the tradie supplies the charger; installation is excluded.
- `install_only`: the customer supplies the charger; the tradie installs it.
- `supply_and_install`: the tradie supplies and installs the charger.

Before the customer has unambiguously chosen one of those three values, the
field is absent. That absence is the canonical `unknown` state; `unknown` is
not stored as a fourth enum value, so it cannot accidentally pass a resolved-
mode schema check.

`supplied_by` remains for backwards compatibility and product filtering. It is
derived as `tradie` for `supply_only` and `supply_and_install`, `customer` for
`install_only`, and unset for `unknown`. It must never be used by itself to
infer `supply_only` versus `supply_and_install`.

Legacy dashboard values map as follows: `customer already has the charger` to
`install_only`, `we supply the charger` to `supply_and_install`, and `not sure`
to `unknown`. A legacy SMS intake with only `supplied_by=tradie` remains
`unknown`; `supplied_by=customer` may safely map to `install_only`.

## R1 — explicit receptionist question

Before any installation question, photo request, product choice or quote
handoff, the receptionist asks:

> Do you need the charger supplied only, installation only for a charger you
> already have, or both supply and installation?

"Can you supply?" proves supply interest but not a service mode. A short
affirmation establishes a mode only when the immediately preceding receptionist
message is an unambiguous single-mode recap. Otherwise the mode remains
`unknown` and the explicit question is asked.

## R2 — mode-specific intake

`supply_only` requires vehicle/compatibility and a selected, priced charger
product. It does not require an installation location, switchboard distance,
phase/capacity, a site photo or a site inspection.

`install_only` requires the existing EV installation questions and photo. It
must not offer or retain a charger product choice.

`supply_and_install` requires the existing EV installation questions and photo,
plus a selected, priced charger product.

`unknown` is never quote-ready. It cannot trigger a product offer, photo request,
site-visit offer, estimator handoff or customer release.

## R3 — deterministic quote consistency

A supplied charger is proven only by a positive-quantity, finite-price EV
charger material row anchored to the current tenant's catalogue, or by an
authenticated tradie-authorised manual charger-unit line. Assembly, labour,
cabling, RCBO, brackets, sundries and descriptions containing "charger" are not
charger-unit evidence.

Before customer release:

- `supply_only` must contain a proven charger-unit line and no installation
  assembly/labour. Scope says supply only and excludes installation/electrical
  work.
- `install_only` must contain grounded installation work and no charger-unit
  line. Scope says installation only and that the customer supplies the unit.
- `supply_and_install` must contain both a proven charger-unit line and grounded
  installation work. Scope must not exclude or defer the charger unit.
- `unknown` is blocked.

Missing product pricing is a tradie-review/product-selection requirement, not a
reason to turn supply-only work into a `$99` inspection. A combined quote must
also be held until the charger product is priced.

## R4 — customer surfaces

SMS, public quote, HTML/PDF and dashboard use the same canonical mode and
priced-line evidence. Supply-only output contains no installation labour/time,
photo prompt, certification wording or `$99` site-visit CTA. Existing issued
quote totals remain immutable; presentation may be reconciled but never repriced
by a renderer.

## R5 — correction and stale state

Changing the mode clears an incompatible product choice before recalculation.
Changing to `install_only` removes/rejects charger-unit lines. Changing from
`install_only` to a tradie-supply mode requires a new valid product choice; an
installation-only total cannot be reused as a combined total.

## Definition of done

- The supplied-only, install-only, supply-and-install and unresolved paths have
  deterministic unit tests at extraction/readiness, dashboard API, estimator
  consistency and release/render boundaries.
- The reported Steve transcript asks the explicit mode question after "can you
  supply?"; an affirmed install-and-supply recap resolves to
  `supply_and_install` but cannot release without a priced charger unit.
- All existing non-EV focused suites still pass.
- The canonical receptionist is exported to the standalone receptionist and the
  standalone typecheck/build checks pass.
- GitNexus changed-impact analysis and an independent requirements review are
  complete before handoff.
