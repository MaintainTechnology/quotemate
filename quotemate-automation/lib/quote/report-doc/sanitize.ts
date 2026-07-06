// Server-side allow-list for a ReportDoc arriving from the client. The editor's
// tiptap-adapter already sanitises on the way out of TipTap, but the server must
// never trust the request body: sanitizeReportDoc re-applies the SAME allow-list
// (known block types + allow-listed inline marks only, text coerced to string
// and length-clamped) and always returns a structurally valid ReportDoc. Junk in
// → an empty (or partially kept) doc out; it never throws.

import {
  ALLOWED_MARKS,
  REPORT_DOC_VERSION,
  type ReportDoc,
  type ReportDocBlock,
  type ReportDocMark,
  type ReportDocText,
} from './types'

const MAX_TEXT = 5000
const MAX_BLOCKS = 300

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

function cleanInline(content: unknown): ReportDocText[] {
  if (!Array.isArray(content)) return []
  const out: ReportDocText[] = []
  for (const run of content) {
    if (!isObj(run) || typeof run.text !== 'string' || run.text.length === 0) continue
    const marks = Array.isArray(run.marks)
      ? run.marks.filter((m): m is ReportDocMark => ALLOWED_MARKS.includes(m as ReportDocMark))
      : []
    const text = run.text.slice(0, MAX_TEXT)
    out.push(marks.length ? { text, marks } : { text })
  }
  return out
}

export function sanitizeReportDoc(input: unknown): ReportDoc {
  const blocksRaw = isObj(input) && Array.isArray(input.blocks) ? input.blocks : []
  const blocks: ReportDocBlock[] = []
  for (const b of blocksRaw.slice(0, MAX_BLOCKS)) {
    if (!isObj(b)) continue
    switch (b.type) {
      case 'title':
        blocks.push({ type: 'title', content: cleanInline(b.content) })
        break
      case 'heading':
        blocks.push({ type: 'heading', content: cleanInline(b.content) })
        break
      case 'paragraph':
        blocks.push({ type: 'paragraph', content: cleanInline(b.content) })
        break
      case 'bulletList':
        blocks.push({
          type: 'bulletList',
          items: Array.isArray(b.items) ? b.items.map(cleanInline) : [],
        })
        break
      case 'pricing':
        blocks.push({ type: 'pricing' })
        break
      // unknown block types are dropped (allow-list)
    }
  }
  return { version: REPORT_DOC_VERSION, blocks }
}
