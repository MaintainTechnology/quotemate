// Temp verify (delete after): iteration-1 changes — /m restyle, queue CTA label, roof hub heading.
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const clerkKey = process.env.CLERK_SECRET_KEY
const BASE = 'http://localhost:3000'
const M = `${BASE}/m/be7a3a8afebea8de2b4b83b8aa46d360`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })

// ── /m (no auth) ──
await page.goto(M)
await page.waitForTimeout(4500)
const sheet = await page.locator('.qm-sheet').count()
const letterhead = await page.evaluate(() => document.body.innerText.includes('YOUR TRADIE') || document.body.innerText.includes('Your tradie'))
const dashLink = await page.locator('a:has-text("← Dashboard")').count()
const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.qm-quote')).backgroundColor)
console.log(`/m: qm-sheet=${sheet} letterhead=${letterhead} dashLink=${dashLink} canvas=${bg}`)
// interactivity: include-in-job checkboxes still respond
const boxes = await page.locator('input[type="checkbox"]').count()
console.log(`/m: structure checkboxes = ${boxes}`)
const actions = {}
for (const t of ['Open customer quote', 'Download PDF', 'Edit & send quote', 'Save as quote']) {
  actions[t] = await page.locator(`a:has-text("${t}"), button:has-text("${t}")`).count()
}
console.log(`/m actions: ${JSON.stringify(actions)}`)
await page.screenshot({ path: 'scripts/verify-m-1440.png', fullPage: true })
await page.setViewportSize({ width: 375, height: 812 })
await page.waitForTimeout(800)
const hs375 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await page.screenshot({ path: 'scripts/verify-m-375.png', fullPage: true })
await page.setViewportSize({ width: 768, height: 950 })
await page.waitForTimeout(500)
const hs768 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
await page.setViewportSize({ width: 1024, height: 950 })
await page.waitForTimeout(500)
const hs1024 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
console.log(`/m horizontal scroll: 375=${hs375} 768=${hs768} 1024=${hs1024}`)

// ── dashboard (authed) ──
const { data: t } = await supabase.from('tenants').select('owner_email').eq('business_name', 'Atomic Electrical').maybeSingle()
const users = await (await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(t.owner_email)}`,
  { headers: { Authorization: `Bearer ${clerkKey}` } })).json()
const tok = await (await fetch('https://api.clerk.com/v1/sign_in_tokens', {
  method: 'POST',
  headers: { Authorization: `Bearer ${clerkKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id: users[0].id, expires_in_seconds: 1800 }),
})).json()
await page.setViewportSize({ width: 1440, height: 950 })
await page.goto(`${BASE}/sign-in?__clerk_ticket=${tok.token}`)
await page.waitForTimeout(8000)

await page.goto(`${BASE}/dashboard?tab=quotes`)
await page.waitForTimeout(9000)
const roofingRow = page.locator('button:has-text("Measure tool")').filter({ hasText: 'ROOFING' }).first()
await (await roofingRow.count() ? roofingRow : page.locator('button:has-text("Measure tool")').first()).click()
await page.waitForTimeout(1500)
const mrLabel = await page.locator('a:has-text("Measurement results")').count()
console.log(`quotes detail: "Measurement results →" CTA = ${mrLabel}`)
await page.screenshot({ path: 'scripts/verify-quotes-detail.png' })

await page.goto(`${BASE}/dashboard?tab=roofing`)
await page.waitForTimeout(8000)
const roofToolsCount = await page.evaluate(() =>
  Array.from(document.querySelectorAll('h1,h2,h3')).filter(h => /roof tools/i.test(h.textContent)).length)
console.log(`roofing hub "Roof tools" headings = ${roofToolsCount}`)
await page.screenshot({ path: 'scripts/verify-roofhub.png' })

await browser.close()
console.log('ITER1 VERIFY DONE')
