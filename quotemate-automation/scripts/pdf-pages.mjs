// List a PDF's pages with a text snippet from each — find which page is which
// sheet. Usage: node scripts/pdf-pages.mjs "<pdf path>"
import { readFileSync } from 'node:fs'
import * as mupdf from 'mupdf'

const doc = mupdf.Document.openDocument(readFileSync(process.argv[2]), 'application/pdf')
const n = doc.countPages()
console.log(`${n} page(s)`)
for (let i = 0; i < n; i++) {
  const page = doc.loadPage(i)
  const text = JSON.parse(page.toStructuredText().asJSON())
  const lines = []
  for (const block of text.blocks ?? []) {
    for (const line of block.lines ?? []) if (line.text) lines.push(line.text)
  }
  const joined = lines.join(' ')
  // Sheet numbers / titles usually live in the title block — show matches first.
  const m = joined.match(/\b1\d{2}[A-Z]?\b[^|]{0,60}/g)
  console.log(`p${i + 1}: ${(m ? m.slice(0, 6).join(' · ') : joined.slice(0, 120)) || '(no text)'}`)
  page.destroy()
}
doc.destroy()
