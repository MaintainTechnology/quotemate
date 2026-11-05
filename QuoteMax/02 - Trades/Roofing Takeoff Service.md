---
title: Roofing Takeoff Service
type: service
area: trade
tags: [quotemax, roofing, takeoff, railway, fleet]
status: staging
updated: 2026-11-05
sources:
  - qm-roofing-takeoff (GitHub MaintainTechnology/qm-roofing-takeoff)
  - quotemate-automation/scripts/export-receptionist.mjs
---

# Roofing Takeoff Service

**qm-roofing-takeoff** is the seventh service in the Railway fleet, beside `qm-front-desk` and the five trade receptionists. It reads builders' plan sets and produces a checked roofing takeoff, delivered as a Roof Wizard pack for a supplier or as a priced quote from the tradie's rate card.

## How it fits

- Generated from this monorepo by `export-receptionist.mjs`, like the receptionists; `src/lib/` is copied byte-identical.
- Not behind the Front Desk: it takes no SMS. Tradies call it from the dashboard.
- Reuses `plan_uploads`, `plan_extractions`, [[Roofing]] pricing (`priceMultiRoof`), the durable queue `sms_work_jobs` (kind `plan`), and saves to `roofing_measurements`, so the [[Measurement Results Page]] works unchanged.
- Existing roofs can still be measured by the aerial providers in [[Roof Measurement Providers]].
- The live [[Roofing Receptionist]] and the Front Desk are not changed.

## Where the documents are

The full set (PRD, TRD, app flow, design brief, backend schema, implementation plan, service spec, build checklist) lives in the takeoff repo's own vault: `qm-roofing-takeoff/Roofing Takeoff/`, with Word copies in `Docs/docx/`.

## Status

As of 5 November 2026: phases P1 to P5 are built and running on Railway staging (runs, the durable worker, the operator surface, the priced builder quote, and TAG email intake through Resend, proven on a real email). The website's side (the `/dashboard/roofing/takeoffs` pages and the roofing tab's card) ships with the monorepo's takeoff PR and stays hidden until `NEXT_PUBLIC_TAKEOFF_API_URL` is set (TKO-19). First pilot: TAG jobs for Raven Roofing.
