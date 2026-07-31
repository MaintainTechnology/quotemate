// Does the SMS route's self-call to /api/intake/structure actually reach the app?
// Uses a NON-EXISTENT conversationId so the pipeline cannot run and no customer is texted.
//   401 -> auth guard rejected us
//   403 -> host/WAF blocked us before the app saw it   <-- the suspected cause
//   400/404/422 -> auth + routing fine, only the payload is bad (the path WORKS)
//   node --env-file=.env.local .scratch-audit/probe-selfcall.mjs
//
// Never prints CRON_SECRET. Presence only.
const SECRET = process.env.CRON_SECRET
console.log('APP_URL           =', process.env.APP_URL ?? '(unset)')
console.log('CRON_SECRET set?  =', SECRET ? `yes (${SECRET.length} chars)` : 'NO — fail-closed in production')
console.log('VERCEL_URL        =', process.env.VERCEL_URL ?? '(unset)')

const HOSTS = [
  process.env.APP_URL,                          // what the running code actually uses
  'https://www.quotemax.com.au',
  'https://quote-mate-rho.vercel.app',
].filter(Boolean)

const FAKE = '00000000-0000-0000-0000-000000000000'

for (const host of [...new Set(HOSTS)]) {
  for (const withAuth of [true, false]) {
    const label = `${host}  auth=${withAuth ? 'yes' : 'no '}`
    try {
      const res = await fetch(`${host}/api/intake/structure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(withAuth && SECRET ? { Authorization: `Bearer ${SECRET}` } : {}),
        },
        body: JSON.stringify({ conversationId: FAKE, sourceChannel: 'sms' }),
        signal: AbortSignal.timeout(25000),
      })
      const body = (await res.text()).slice(0, 180).replace(/\s+/g, ' ')
      console.log(`${label} -> HTTP ${res.status}  ${body}`)
    } catch (e) {
      console.log(`${label} -> THREW  ${e.name}: ${String(e.message).slice(0, 160)}`)
    }
  }
}
