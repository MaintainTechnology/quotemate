// Build a default ReportDoc from a quote's existing structured fields, so a
// quote with no document opens as an editable document that matches today's
// rendered output (title + scope + Good/Better/Best + assumptions). Called
// lazily on first editor open in Phase 1; no bulk backfill (spec §3).

import type { ReportDoc, ReportDocBlock } from './types'

export function buildDefaultReportDoc(args: {
  title?: string | null
  scopeOfWorks?: string | null
  assumptions?: string[] | null
}): ReportDoc {
  const blocks: ReportDocBlock[] = [
    { type: 'title', content: [{ text: args.title?.trim() || 'Quotation' }] },
  ]

  if (args.scopeOfWorks && args.scopeOfWorks.trim()) {
    blocks.push({ type: 'heading', content: [{ text: 'Scope of works' }] })
    blocks.push({ type: 'paragraph', content: [{ text: args.scopeOfWorks.trim() }] })
  }

  blocks.push({ type: 'pricing' })

  const assumptions = (args.assumptions ?? []).filter((a) => a && a.trim())
  if (assumptions.length > 0) {
    blocks.push({ type: 'heading', content: [{ text: 'Assumptions' }] })
    blocks.push({ type: 'bulletList', items: assumptions.map((a) => [{ text: a.trim() }]) })
  }

  return { version: 1, blocks }
}
