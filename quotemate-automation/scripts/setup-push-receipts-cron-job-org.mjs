// User-run, idempotent cron-job.org setup for delayed Expo receipt checks.
// This script is deliberately never run by builds or migrations.
// Run: node --env-file=.env.local scripts/setup-push-receipts-cron-job-org.mjs

const API_BASE = 'https://api.cron-job.org'
const APP_URL = (process.env.APP_URL ?? 'https://www.quotemax.com.au').replace(/\/$/, '')
const TARGET_URL = `${APP_URL}/api/cron/push-receipts`
const TITLE = 'QuoteMax — Expo push receipt sweep'
const API_KEY = process.env.CRONJOB_ORG_API_KEY
const CRON_SECRET = process.env.CRON_SECRET

if (!API_KEY || !CRON_SECRET) {
  console.error('CRONJOB_ORG_API_KEY and CRON_SECRET are required; no changes made.')
  process.exit(1)
}

const headers = { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' }
const listed = await fetch(`${API_BASE}/jobs`, { headers })
if (!listed.ok) throw new Error(`cron-job.org list failed: HTTP ${listed.status}`)
const body = await listed.json()
const existing = (body.jobs ?? []).find(job => job.url === TARGET_URL)
if (existing) {
  console.log(`Receipt sweep already exists (job ${existing.jobId}); no changes made.`)
  process.exit(0)
}

const created = await fetch(`${API_BASE}/jobs`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    job: {
      title: TITLE,
      url: TARGET_URL,
      enabled: true,
      saveResponses: true,
      requestMethod: 0,
      schedule: {
        timezone: 'UTC',
        hours: [-1],
        mdays: [-1],
        minutes: [0, 15, 30, 45],
        months: [-1],
        wdays: [-1],
      },
      extendedData: { headers: `Authorization: Bearer ${CRON_SECRET}` },
    },
  }),
})
if (!created.ok) throw new Error(`cron-job.org create failed: HTTP ${created.status}`)
const result = await created.json()
console.log(`Created ${TITLE} (job ${result.jobId}) for ${TARGET_URL}.`)
