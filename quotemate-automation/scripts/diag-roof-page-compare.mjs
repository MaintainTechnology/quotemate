// Fetch roofing customer pages and report what each one actually RENDERS —
// prices, structure rows, CTAs. Used to prove whether two tenants' links
// differ because of code/deployment or only because of the ?s= selection.
// Usage: node scripts/diag-roof-page-compare.mjs <label=url> [<label=url> ...]

const targets = process.argv.slice(2).map((a) => {
  const i = a.indexOf('=')
  return { label: a.slice(0, i), url: a.slice(i + 1) }
})

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

for (const { label, url } of targets) {
  const t0 = Date.now()
  const res = await fetch(url, { redirect: 'follow' })
  const html = await res.text()
  const ms = Date.now() - t0
  const text = strip(html)

  const prices = [...new Set(html.match(/\$\s?[0-9]{1,3}(?:,[0-9]{3})+/g) ?? [])]
  const marker = (re) => (re.test(text) ? 'yes' : 'no ')

  console.log('─'.repeat(72))
  console.log(`${label}\n  ${url}`)
  console.log(`  http=${res.status} ${ms}ms  bytes=${html.length}`)
  console.log(`  prices rendered: ${prices.length ? prices.join('  ') : '(none)'}`)
  console.log(`  "Main dwelling"      ${marker(/Main dwelling/i)}`)
  console.log(`  "Secondary structure" ${marker(/Secondary structure/i)}`)
  console.log(`  deposit / pay CTA    ${marker(/deposit|pay|secure your/i)}`)
  console.log(`  booking CTA          ${marker(/book|choose a time|calendar/i)}`)
  console.log(`  inspection wording   ${marker(/inspection|look on site|on-site/i)}`)
  console.log(`  tier labels (G/B/B)  ${marker(/good|better|best/i)}`)
  console.log(`  first 260 chars: ${text.slice(0, 260)}`)
}
