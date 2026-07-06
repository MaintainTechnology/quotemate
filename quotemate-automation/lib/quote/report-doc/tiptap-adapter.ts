// The boundary between the TipTap editor and our stored ReportDoc model.
//
// tiptapToReportDoc is the WRITE-SIDE sanitizer: it walks the editor's
// ProseMirror JSON and keeps ONLY allow-listed block types and inline marks —
// anything else (a pasted table, an image, a script mark, a foreign node) is
// dropped, never stored. reportDocToTiptap is the inverse, producing valid
// ProseMirror JSON to seed the editor. Together with esc() in the serializer,
// this means no raw/untrusted HTML is ever stored or rendered — the allow-list
// here is the sanitiser on the way IN, esc() is the guard on the way OUT.
//
// Mapping decisions (Phase 1):
//   ReportDoc 'title'   <-> heading level 1 (the document's one big heading)
//   ReportDoc 'heading' <-> heading level >= 2 (section headings)
//   'paragraph'/'bulletList'/'pricing' map 1:1.

import { ALLOWED_MARKS, type ReportDoc, type ReportDocMark, type ReportDocText } from './types'

export type TiptapMark = { type: string }
export type TiptapNode = {
  type: string
  text?: string
  marks?: TiptapMark[]
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
}
export type TiptapDoc = { type: 'doc'; content: TiptapNode[] }

/** Custom ProseMirror node name for the locked Good/Better/Best block. */
export const PRICING_NODE = 'pricing'

// ---------- ReportDoc -> TipTap (seed the editor) ----------

function inlineToTiptap(content: ReportDocText[]): TiptapNode[] {
  // ProseMirror forbids empty text nodes — drop empties.
  return content
    .filter((run) => typeof run.text === 'string' && run.text.length > 0)
    .map((run) => {
      const marks = (run.marks ?? []).filter((m) => ALLOWED_MARKS.includes(m))
      const node: TiptapNode = { type: 'text', text: run.text }
      if (marks.length) node.marks = marks.map((m) => ({ type: m }))
      return node
    })
}

/** Wrap inline content in a node, omitting an empty `content` array (PM allows
 *  an empty paragraph/heading node, but not an empty text child). */
function withInline(type: string, attrs: Record<string, unknown> | null, inline: TiptapNode[]): TiptapNode {
  const node: TiptapNode = { type }
  if (attrs) node.attrs = attrs
  if (inline.length) node.content = inline
  return node
}

export function reportDocToTiptap(doc: ReportDoc): TiptapDoc {
  const content: TiptapNode[] = []
  for (const block of doc.blocks) {
    switch (block.type) {
      case 'title':
        content.push(withInline('heading', { level: 1 }, inlineToTiptap(block.content)))
        break
      case 'heading':
        content.push(withInline('heading', { level: 2 }, inlineToTiptap(block.content)))
        break
      case 'paragraph':
        content.push(withInline('paragraph', null, inlineToTiptap(block.content)))
        break
      case 'bulletList': {
        const items = block.items
          .map((item) => withInline('paragraph', null, inlineToTiptap(item)))
          .map((para) => ({ type: 'listItem', content: [para] }))
        if (items.length) content.push({ type: 'bulletList', content: items })
        break
      }
      case 'pricing':
        content.push({ type: PRICING_NODE })
        break
    }
  }
  // ProseMirror docs must have at least one block; fall back to an empty paragraph.
  if (content.length === 0) content.push({ type: 'paragraph' })
  return { type: 'doc', content }
}

// ---------- TipTap -> ReportDoc (persist edits) ----------

function inlineFromTiptap(content: TiptapNode[] | undefined): ReportDocText[] {
  if (!Array.isArray(content)) return []
  const out: ReportDocText[] = []
  for (const n of content) {
    if (n?.type !== 'text' || typeof n.text !== 'string' || n.text.length === 0) continue
    const marks = Array.isArray(n.marks)
      ? n.marks
          .map((m) => m?.type)
          .filter((t): t is ReportDocMark => ALLOWED_MARKS.includes(t as ReportDocMark))
      : []
    out.push(marks.length ? { text: n.text, marks } : { text: n.text })
  }
  return out
}

export function tiptapToReportDoc(json: unknown): ReportDoc {
  const doc = json as TiptapDoc | null
  const nodes = doc && typeof doc === 'object' && Array.isArray(doc.content) ? doc.content : []
  const blocks: ReportDoc['blocks'] = []
  for (const node of nodes) {
    switch (node?.type) {
      case 'heading': {
        const level = node.attrs?.level
        const inline = inlineFromTiptap(node.content)
        blocks.push(level === 1 ? { type: 'title', content: inline } : { type: 'heading', content: inline })
        break
      }
      case 'paragraph':
        blocks.push({ type: 'paragraph', content: inlineFromTiptap(node.content) })
        break
      case 'bulletList': {
        const items = (node.content ?? [])
          .filter((li) => li?.type === 'listItem')
          .map((li) => {
            const para = (li.content ?? []).find((c) => c?.type === 'paragraph')
            return inlineFromTiptap(para?.content)
          })
        blocks.push({ type: 'bulletList', items })
        break
      }
      case PRICING_NODE:
        blocks.push({ type: 'pricing' })
        break
      // any other node type is dropped (allow-list)
    }
  }
  return { version: 1, blocks }
}
