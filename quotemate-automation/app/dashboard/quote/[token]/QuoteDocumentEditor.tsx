'use client'

// The living-document editor (spec 2026-07-06 §5, Phase 1 Tasks B+C). A TipTap
// v3 block editor over the ReportDoc model: the tradie types + styles the quote
// document (title, prose, headings, lists) with a Word-like toolbar. The
// Good/Better/Best block is a LOCKED atom node rendered by a React NodeView —
// no keystroke can change a price; the numbers come from the structured tiers,
// and "Edit prices" hands off to the grounded Pricing section (wired in Task E).
//
// Content flows ReportDoc -> TipTap (seed) and TipTap JSON -> ReportDoc (persist)
// through lib/quote/report-doc/tiptap-adapter, whose allow-list is the write-side
// sanitiser. This component holds no prices in editable text and does no I/O.

import { createContext, useContext } from 'react'
import { Node, mergeAttributes, type Editor } from '@tiptap/core'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { reportDocToTiptap, tiptapToReportDoc, PRICING_NODE } from '@/lib/quote/report-doc/tiptap-adapter'
import type { ReportDoc } from '@/lib/quote/report-doc/types'

// Minimal tier shape (kept local so the client bundle never pulls in the
// server-side report builder). Mirrors quotes.good/better/best.
type Tier = { label: string; subtotal_ex_gst: number | string } | null
export type DocEditorTiers = {
  good: Tier
  better: Tier
  best: Tier
  selectedTier: 'good' | 'better' | 'best' | null
}

/** Same inc-GST rounding the customer PDF/SMS use (Math.round(ex * 1.1)). */
function incGst(exGst: number | string): number {
  const n = typeof exGst === 'string' ? parseFloat(exGst) : exGst
  return Math.round((Number.isFinite(n) ? n : 0) * 1.1)
}

type PricingCtx = { tiers: DocEditorTiers | null; onEditPrices?: () => void }
const PricingContext = createContext<PricingCtx>({ tiers: null })

const TIER_KEYS = ['good', 'better', 'best'] as const

/** Read-only render of the locked Good/Better/Best block inside the document. */
function PricingNodeView() {
  const { tiers, onEditPrices } = useContext(PricingContext)
  return (
    <NodeViewWrapper className="qm-pricing-lock" contentEditable={false} data-testid="pricing-node">
      <div className="qm-pricing-head">
        <span className="qm-pricing-badge">Grounded prices — locked</span>
        {onEditPrices && (
          <button type="button" className="qm-pricing-edit" onClick={onEditPrices}>
            Edit prices
          </button>
        )}
      </div>
      {tiers ? (
        <div className="qm-pricing-tiers">
          {TIER_KEYS.map((k) => {
            const t = tiers[k]
            if (!t) return null
            const rec = tiers.selectedTier === k
            return (
              <div key={k} className={`qm-tier${rec ? ' is-rec' : ''}`} data-tier={k}>
                <div className="qm-tier-name">
                  {k.toUpperCase()}
                  {rec ? ' · REC' : ''}
                </div>
                <div className="qm-tier-price">${incGst(t.subtotal_ex_gst).toLocaleString('en-AU')}</div>
                <div className="qm-tier-label">{t.label}</div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="qm-pricing-empty">Good / Better / Best — set in the Pricing section</div>
      )}
    </NodeViewWrapper>
  )
}

/** The locked pricing atom node. ProseMirror treats it as one opaque unit, so it
 *  cannot be typed into or split; the price never lives in editable text. */
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
    return ['div', mergeAttributes(HTMLAttributes, { 'data-pricing': 'true' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(PricingNodeView)
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
  /** The structured tiers the locked pricing node renders (read-only). */
  tiers?: DocEditorTiers | null
  /** Called on every edit with the sanitised ReportDoc. */
  onChange: (doc: ReportDoc) => void
  /** "Edit prices" hand-off to the grounded Pricing section. */
  onEditPrices?: () => void
  editable?: boolean
}

export default function QuoteDocumentEditor({
  value,
  tiers = null,
  onChange,
  onEditPrices,
  editable = true,
}: QuoteDocumentEditorProps) {
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
    <PricingContext.Provider value={{ tiers, onEditPrices }}>
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
    </PricingContext.Provider>
  )
}
