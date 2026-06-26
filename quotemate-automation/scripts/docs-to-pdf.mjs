// ════════════════════════════════════════════════════════════════════
// Render branded HTML docs in public/docs/ → print-quality PDFs that KEEP
// the dark Caterpillar look (yellow #FFC400 on warm-black #16120F).
//
// Unlike the customer-quote PDFs (lib/pdf/report-chrome.ts → light "warm
// paper" via Gotenberg), these are dark-theme leave-behinds rendered with
// printBackground:true so the brand survives the print pipeline.
//
// Usage (no env needed):
//   node scripts/docs-to-pdf.mjs                         # default doc(s)
//   node scripts/docs-to-pdf.mjs quotemate-feature-overview.html
//   node scripts/docs-to-pdf.mjs --all                   # every .html in docs
//
// Output: <name>.pdf written next to each <name>.html.
// ════════════════════════════════════════════════════════════════════
import { chromium } from 'playwright'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DOCS_DIR = path.resolve(SCRIPT_DIR, '..', 'public', 'docs')

// Injected at render time so PDFs stay small + crisp regardless of each doc's
// decoration. Full-page feTurbulence "noise", radial-gradient canvases and
// blur glows rasterise into tens of MB at print DPI — flatten them to the solid
// warm-black canvas and drop expensive filters. Keeps the dark Caterpillar look.
const PRINT_HARDEN = `
@media print {
  html, body { background:#16120F !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  /* hide PURE-DECORATION overlay layers only — never content containers like .canvas */
  .noise,.grain,.topo,.glow,.aurora,.orb,
  [class*="noise"],[class*="grain"],[class*="topo"],[class*="glow"] { display:none !important; }
  /* feTurbulence noise + blur glows are filters — dropping them is what shrinks the PDF */
  *{ filter:none !important; backdrop-filter:none !important; -webkit-backdrop-filter:none !important; }
  /* hide on-screen-only controls (download bar, theme toggles) */
  .doc-actions,[class*="toggle"],#themeBtn,button[aria-label*="theme"]{ display:none !important; }
  /* guarantee headings / transparent-fill text stay visible on the dark page */
  .hero h1{ color:#F6F1EA !important; }
  [style*="color:transparent"],[style*="text-fill-color:transparent"]{ -webkit-text-fill-color:#F6F1EA !important; color:#F6F1EA !important; }
}`

// Docs that get a PDF by default (extend as the rollout grows).
const DEFAULT_TARGETS = ['quotemate-feature-overview.html']

function resolveTargets(argv) {
  const args = argv.slice(2)
  if (args.includes('--all')) {
    return readdirSync(DOCS_DIR).filter((f) => f.endsWith('.html'))
  }
  const named = args.filter((a) => !a.startsWith('--'))
  return named.length ? named.map((n) => (n.endsWith('.html') ? n : `${n}.html`)) : DEFAULT_TARGETS
}

async function main() {
  const targets = resolveTargets(process.argv)
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const results = []

  for (const file of targets) {
    const htmlPath = path.join(DOCS_DIR, file)
    try {
      statSync(htmlPath)
    } catch {
      console.warn(`✗ skip (not found): ${file}`)
      continue
    }
    const pdfPath = htmlPath.replace(/\.html$/i, '.pdf')

    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' })
    // Make sure web fonts have actually loaded before snapshotting to PDF.
    await page.evaluate(() => document.fonts && document.fonts.ready)
    // Force dark color-scheme so theme-switchable docs resolve their DARK tokens
    // (else prefers-color-scheme defaults to light → dark text on the dark canvas).
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    await page.addStyleTag({ content: PRINT_HARDEN })

    await page.pdf({
      path: pdfPath,
      printBackground: true,
      preferCSSPageSize: true,
      format: 'A4',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    })

    const kb = Math.round(statSync(pdfPath).size / 1024)
    console.log(`✓ ${path.basename(pdfPath)} (${kb} KB)`)
    results.push(file)
  }

  await browser.close()
  console.log(`\nDone — ${results.length} PDF(s) in ${path.relative(process.cwd(), DOCS_DIR)}/`)
}

main().catch((err) => {
  console.error('PDF render failed:', err)
  process.exit(1)
})
