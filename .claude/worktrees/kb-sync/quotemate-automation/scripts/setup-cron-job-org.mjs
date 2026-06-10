// Idempotent setup for the cron-job.org schedule that fires the 2-hour
// customer follow-up sweep every 15 minutes.
//
// We use cron-job.org as an external trigger because Vercel Hobby caps
// cron frequency at once per day — see vercel.json + the header comment
// on app/api/cron/followup-2h/route.ts.
//
// Run with:  node --env-file=.env.local scripts/setup-cron-job-org.mjs
//
// Idempotent: if a job already exists pointing at the same URL, the
// script skips creation. Safe to re-run after env changes.

const API_BASE = 'https://api.cron-job.org'
const TARGET_URL = 'https://quote-mate-rho.vercel.app/api/cron/followup-2h'
const TITLE = 'QuoteMate — 2h customer follow-up'

const API_KEY = process.env.CRONJOB_ORG_API_KEY
const CRON_SECRET = process.env.CRON_SECRET

if (!API_KEY) { console.error('✗ CRONJOB_ORG_API_KEY not set in env'); process.exit(1) }
if (!CRON_SECRET) { console.error('✗ CRON_SECRET not set in env'); process.exit(1) }

const apiHeaders = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

// 1. List existing jobs — skip create if one already points at our URL
const listResp = await fetch(`${API_BASE}/jobs`, { headers: apiHeaders })
if (!listResp.ok) {
  console.error('✗ list jobs failed', listResp.status, await listResp.text())
  process.exit(1)
}
const listBody = await listResp.json()
const existing = (listBody.jobs ?? []).find(j => j.url === TARGET_URL)
if (existing) {
  console.log(`✓ Job already exists for ${TARGET_URL}`)
  console.log(`  jobId    : ${existing.jobId}`)
  console.log(`  enabled  : ${existing.enabled}`)
  console.log(`  title    : ${existing.title}`)
  console.log(`  schedule : every 15 minutes (UTC)`)
  console.log(`  dashboard: https://console.cron-job.org/jobs/${existing.jobId}`)
  process.exit(0)
}

// 2. Create the job
// requestMethod 0 = GET. extendedData.headers is a multiline string in
// HTTP-header format. Schedule fields use -1 for "every value".
const payload = {
  job: {
    title: TITLE,
    url: TARGET_URL,
    enabled: true,
    saveResponses: true,
    schedule: {
      timezone: 'UTC',
      hours:   [-1],
      mdays:   [-1],
      minutes: [0, 15, 30, 45],
      months:  [-1],
      wdays:   [-1],
    },
    requestMethod: 0,
    extendedData: {
      headers: `Authorization: Bearer ${CRON_SECRET}`,
    },
  },
}

const createResp = await fetch(`${API_BASE}/jobs`, {
  method: 'PUT',
  headers: apiHeaders,
  body: JSON.stringify(payload),
})

if (!createResp.ok) {
  console.error('✗ create job failed', createResp.status)
  console.error(await createResp.text())
  process.exit(1)
}

const createBody = await createResp.json()
console.log(`✓ Created cron-job.org job`)
console.log(`  jobId    : ${createBody.jobId}`)
console.log(`  title    : ${TITLE}`)
console.log(`  url      : ${TARGET_URL}`)
console.log(`  schedule : every 15 minutes (UTC)`)
console.log(`  method   : GET`)
console.log(`  header   : Authorization: Bearer <CRON_SECRET>`)
console.log(`  dashboard: https://console.cron-job.org/jobs/${createBody.jobId}`)
console.log()
console.log(`NOTE: The first executions will only succeed once the latest`)
console.log(`Vercel deploy lands (vercel.json fix needs to be pushed).`)
