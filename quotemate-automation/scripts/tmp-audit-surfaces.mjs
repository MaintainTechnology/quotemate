// Temp audit (delete after): current state of Quotes tab, roofing hub, /m page.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const clerkKey = process.env.CLERK_SECRET_KEY
const BASE = 'http://localhost:3000'
const M_TOKEN = 'be7a3a8afebea8de2b4b83b8aa46d360'

const { data: t } = await supabase.from('tenants').select('owner_email').eq('business_name', 'Atomic Electrical').maybeSingle()
const users = await (await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(t.owner_email)}`,
  { headers: { Authorization: `Bearer ${clerkKey}` } })).json()
const tok = await (await fetch('https://api.clerk.com/v1/sign_in_tokens', {
  method: 'POST',
  headers: { Authorization: `Bearer ${clerkKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id: users[0].id, expires_in_seconds: 1800 }),
})).json()

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
await page.goto(`${BASE}/sign-in?__clerk_ticket=${tok.token}`)
await page.waitForTimeout(8000)

// ── Quotes tab ──
await page.goto(`${BASE}/dashboard?tab=quotes`)
await page.waitForTimeout(9000) // trade-jobs fetch is lazy
const bodyText = await page.evaluate(() => document.body.innerText)
const jobRowCount = await page.locator('button:has-text("Measure tool")').count()
console.log(`quotes tab: "Measure tool" job rows = ${jobRowCount}`)
console.log(`quotes tab mentions Measurement: ${bodyText.includes('Measurement')}`)
await page.screenshot({ path: 'scripts/audit-quotes-1440.png' })
if (jobRowCount > 0) {
  await page.locator('button:has-text("Measure tool")').first().click()
  await page.waitForTimeout(1500)
  for (const label of ['Review & edit', 'Customer page', 'Measurement']) {
    const n = await page.locator(`a:has-text("${label}")`).count()
    console.log(`  detail CTA "${label}": ${n}`)
  }
  await page.screenshot({ path: 'scripts/audit-quotes-detail.png' })
}

// ── Roofing hub ──
await page.goto(`${BASE}/dashboard?tab=roofing`)
await page.waitForTimeout(9000)
const roofText = await page.evaluate(() => document.body.innerText)
const mLinks = await page.locator('a[href^="/m/"]').count()
console.log(`roofing hub: links to /m/* = ${mLinks}; mentions "Measurement results": ${roofText.includes('Measurement results')}; mentions "Tools": ${roofText.includes('Tools')}`)
// what sections exist? dump headings
const headings = await page.evaluate(() =>
  Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.textContent.trim()).filter(Boolean).slice(0, 25))
console.log('roofing hub headings:', JSON.stringify(headings))
await page.screenshot({ path: 'scripts/audit-roofhub-1440.png', fullPage: true })

// ── /m page (no auth needed, but session fine) ──
await page.goto(`${BASE}/m/${M_TOKEN}`)
await page.waitForTimeout(4000)
await page.screenshot({ path: 'scripts/audit-m-1440.png', fullPage: true })
await page.setViewportSize({ width: 375, height: 812 })
await page.waitForTimeout(1000)
const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
console.log(`/m at 375: horizontal scroll = ${hscroll}`)
await page.screenshot({ path: 'scripts/audit-m-375.png', fullPage: true })

await browser.close()
console.log('AUDIT CAPTURED')
