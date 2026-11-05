# SMS dashboard recovery — 11 September 2026

## Cause

Production commit `e3872b0e6e804afe6bfe10c1be3238d2f1d6f742` queried
`sms_outbox`, `sms_work_jobs`, and `sms_human_tasks`, but these tables had not
been installed. Supabase returned `PGRST205`; both authenticated dashboard
endpoints returned 503. The SMS work cron also returned 500 (`PGRST202`,
missing `claim_sms_work`) and the outbox cron returned 503.

The enquiry page independently displayed empty-success messages while loading
failed. Both pages now track loading, loaded, and error states. A failed refresh
preserves previously loaded records with a visible stale-data notice, and no
empty-success message is displayed until a load succeeds.

## Database repair applied

Ran from `quotemate-automation`:

```powershell
node --env-file=.env.local scripts/repair-sms-dashboard-schema.mjs --apply
```

The runner applies canonical migrations 198 and 199 plus only the human-task
table, RLS, grant, and work-guard block from migration 201. It intentionally
does not install migration 201's quote-release functions. An outer transaction,
timeouts, partial-schema rejection, exact function-body verification, and
postflight checks protect the repair. Explicit grants restrict browser roles
despite production's broad default table permissions.

Canonical migration 199 classified 2,263 historical outbound records with a
provider SID as accepted, and 1,533 without one as unknown. It did not infer
delivery, create outbox rows, or replay historical messages. All three new
durable tables were verified empty before commit and again after application.
Existing message history remains in `sms_messages`.

| Applied source | SHA-256 |
| --- | --- |
| Migration 198 | `61fa08fd34d3a308bf983d87571d4e4a527159b03d548c083213fa500d500410` |
| Migration 199 | `4692464f2e96a84066c06bf38ced1fec1a0b8a3ea40aaebe849921fc4e482e40` |
| Migration 201 task block | `745687bccb733f323c6cbe9296e4cc4e0fe7d5122b9331b32475a93b8d4f4ed5` |

## Verification

- All three SMS dashboard Supabase REST projections passed with HTTP 200.
- All seven public quote REST projections still passed with HTTP 200.
- Read-only rerun reported no installation required and verified function
  definitions, tenant retry restrictions, RLS, grants, and active guards.
- Passive production logs showed both SMS work and outbox crons return 200.
- 36 database/repair/API tests and four real React/Chromium UI tests passed.
- Focused UI and repair-script ESLint passed.
- The whole-project type check identified two untyped PGlite query results in
  the previous public-quote repair test. Explicit result types fix both errors;
  all six tests in that file passed again. The full type-check rerun passed.

No send, retry, resume, or resolve action was exercised against customer data.
Provider delivery certification and older receptionist deployments are outside
this dashboard repair.

## Application release

Production deployment `dpl_J66kFRAa7amGk9LxjkVv2mMiusJf` is READY and assigned
to `quotemax.com.au` and `www.quotemax.com.au`:
<https://quote-mate-lyt0bx8k0-maintain-technology.vercel.app>.

The remote build passed TypeScript and generated all 84 static pages. Deployment
completed at 00:05:22 UTC. Passive scheduled requests on this deployment returned
200 for both SMS work and SMS outbox; both schedules remain active every minute.

Release staging starts from the exact production commit above and overlays only
`app/dashboard/sms-delivery/page.tsx` and
`app/dashboard/sms-recovery/page.tsx`, plus the two type annotations in the
existing `tests/public-quote-schema-repair.test.ts`. Unrelated `.claude-flow`
changes and local credentials are excluded. The new SMS repair runner and its
tests remain workspace assets.

Live production HTML for both pages returned 200 with the new loading state.
The recovery page no longer renders either empty-success message before its
request succeeds. Both unauthenticated tenant APIs retain 401 responses. A
signed-in browser session was not available for the interactive account check;
the authenticated query projections were verified directly against production.

Released file SHA-256 values:

- Delivery page: `da9e33e97e2bbe5c27f7dd1dfb3475e7110be4e3b1736333e4373c150567af48`
- Recovery page: `b8bddd0eca1b51975287472f6c94a12f6109d8b0830dfbe542ab6a9e697dc7f4`
- Existing quote repair test: `c1617292d7e5b3fbdf365cd62648f7a740ad1580f16aad9066ac4e63936905f3`

GitNexus returned UNKNOWN for the two page symbols in its stale index. Their
App Router exports and dashboard navigation consumers were confirmed directly.
A Node 22 refresh with two workers was stopped after more than 12 minutes
without completion; the old graph was not represented as a clean impact check.
