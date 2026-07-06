'use client'

// The living-document editor (spec 2026-07-06 §5, Phase 1 Task B). A TipTap v3
// block editor over the ReportDoc model: the tradie types + styles the quote
// document (title, prose, headings, lists) with a Word-like toolbar. The
// Good/Better/Best block is a LOCKED atom node — no keystroke can change a price;
// pricing is edited only through the grounded Pricing section (wired in Task C/E).
//
// Content flows ReportDoc -> TipTap (seed) and TipTap JSON -> ReportDoc (persist)
// through lib/quote/report-doc/tiptap-adapter, whose allow-list is the write-side
// sanitiser. This component holds no prices and performs no network I/O.

import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { reportDocToTiptap, tiptapToReportDoc, PRICING_NODE } from '@/lib/quote/report-doc/tiptap-adapter'
import type { ReportDoc } from '@/lib/quote/report-doc/types'

/**
 * The locked Good/Better/Best node. A block-level atom: ProseMirror treats it as
 * a single opaque unit, so it cannot be typed into or split. Task C replaces the
 * static placeholder with a React NodeView that renders the live tiers read-only
 * and opens the existing grounded TradieEditor on activation.
 */
const PricingBlock = Node.create({
  name: PRICING_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  parseHTML() {
    return [{ tag: 'div[data-pricing]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-pricing': 'true',
        contenteditable: 'false',
        class: 'qm-pricing-lock',
      }),
      'Good / Better / Best — grounded prices (edit in the Pricing section below)',
    ]
  },
})

const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2] } }), // v3 StarterKit includes Underline
  Highlight,
  PricingBlock,
]

type ToolbarButton = {
  label: string
  title: string
  isActive: (e: Editor) => boolean
  run: (e: Editor) => void
}

const BUTTONS: ToolbarButton[] = [
  { label: 'Title', title: 'Document title', isActive: (e) => e.isActive('heading', { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: 'Heading', title: 'Section heading', isActive: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'Bold', title: 'Bold', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'Italic', title: 'Italic', isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: 'Underline', title: 'Underline', isActive: (e) => e.isActive('underline'), run: (e) => e.chain().focus().toggleUnderline().run() },
  { label: 'Highlight', title: 'Highlight', isActive: (e) => e.isActive('highlight'), run: (e) => e.chain().focus().toggleHighlight().run() },
  { label: 'Bullets', title: 'Bullet list', isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
]

export type QuoteDocumentEditorProps = {
  /** Initial document (seed the editor). */
  value: ReportDoc
  /** Called on every edit with the sanitised ReportDoc. */
  onChange: (doc: ReportDoc) => void
  editable?: boolean
}

export default function QuoteDocumentEditor({ value, onChange, editable = true }: QuoteDocumentEditorProps) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: reportDocToTiptap(value),
    editable,
    // Required for Next.js SSR (TipTap v3): defer first render to the client so
    // server and client markup match.
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'qm-doc-editor', 'aria-label': 'Quote document' },
    },
    onUpdate: ({ editor }) => onChange(tiptapToReportDoc(editor.getJSON())),
  })

  if (!editor) return null

  return (
    <div className="qm-doc-shell">
      {editable && (
        <div className="qm-doc-toolbar" role="toolbar" aria-label="Formatting">
          {BUTTONS.map((b) => {
            const active = b.isActive(editor)
            return (
              <button
                key={b.label}
                type="button"
                title={b.title}
                onClick={() => b.run(editor)}
                className={`qm-tb-btn${active ? ' is-active' : ''}`}
              >
                {b.label}
              </button>
            )
          })}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
