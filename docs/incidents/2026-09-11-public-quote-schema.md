# Public quote database schema repair — 11 September 2026

## Failure and cause

Production deployed commit `ec30c9c8f6162749d5b14b6db6f760d19e3800e7`
before its public quote reader schema was present. The customer page returned
an unavailable state, while the HTML preview and PDF endpoint returned 503.
The reported support reference `590532d8-ea37-42e8-bb66-bfa0844cf6b1`
matched a production `public-quote` error with PostgreSQL code `42703`.
Read-only schema probes identified missing release and pricing-version columns.

## Production repair

Ran `node --env-file=.env.local scripts/repair-public-quote-schema.mjs --apply`
from `quotemate-automation`, after an independent review, an offline PostgreSQL
test suite, and a read-only production dry run.

The single transaction added these nullable columns without defaults:

- `quotes.customer_released_at` and `quotes.customer_released_by`
- `roofing_measurements.released_at`
- `plan_extractions.released_at`
- `aircon_recommendations.released_at`
- `paint_runs.released_at`

It also applied the complete existing migration
`207_quote_pricing_versions.sql`, including its table, foreign key, ownership
and immutability triggers, RLS, and restricted grants. Canonical file SHA-256:
`c93834f4c80c40a35a6bc2d85eef7ddbe03d59bb1e8f25cbd95854cd30ffdfe2`.
No quote prices or approval timestamps were backfilled. The repair did not
install the unrelated SMS work/outbox or sending routines from other pending
migrations. Future full migration rollouts must account for migration 207
already being installed; the repair runner itself safely detects this state.

## Verification

The affected customer link was checked against the current production domain:

| Surface | Result |
| --- | --- |
| Customer page | HTTP 200; complete quote visible in browser |
| HTML report preview | HTTP 200; 66,536 bytes of rendered report HTML |
| PDF download | HTTP 200; 331,139 bytes; valid `%PDF-` signature |
| Seven public-family Supabase REST projections | All HTTP 200, no errors, zero rows read |
| Subsequent repair dry run | No missing columns; migration 207 complete |

The local readiness contract now covers `applied_discount_pct`,
`pricing_book_version_id`, and `pdf_path`. A regression test compares it with
the initial projections used by the customer page, HTML preview, and PDF route.
The focused quote, pricing, release, readiness, and repair suites passed
(179 distinct tests). TypeScript passed with `--noEmit --incremental false`.

The GitNexus index refresh failed during native worker startup. The existing
index was one commit behind production, so its UNKNOWN/absent-symbol results
were not treated as a clean impact check; reader and readiness consumers were
confirmed directly in source. No commit or application redeployment was made.
The production fix is the database transaction; local diagnostic and regression
changes remain available for review.

An unapproved historical quote still requires owner approval. Missing approval
evidence must not be manufactured to make a customer quote visible.
