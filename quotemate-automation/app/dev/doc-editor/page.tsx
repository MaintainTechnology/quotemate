'use client'

// Dev-only harness for verifying the quote document editor in a real browser
// (no auth, no DB). Not linked from anywhere; safe to delete. Mounts
// QuoteDocumentEditor with sample content and echoes the live ReportDoc so a
// Playwright pass can assert typing/toolbar/locked-node behaviour.

import QuoteDocumentWorkspace from '../../dashboard/quote/[token]/QuoteDocumentWorkspace'
import type { ReportDoc } from '../../../lib/quote/report-doc/types'

const SAMPLE: ReportDoc = {
  version: 1,
  blocks: [
    { type: 'title', content: [{ text: 'Commercial Repaint — 148 Recommendation St' }] },
    { type: 'heading', content: [{ text: 'Scope of works' }] },
    {
      type: 'paragraph',
      content: [
        { text: 'Full interior repaint of the ground-floor office suite (approx. ' },
        { text: '320 m²', marks: ['bold'] },
        { text: '). Two coats low-sheen acrylic to walls.' },
      ],
    },
    { type: 'pricing' },
    { type: 'heading', content: [{ text: 'Notes & terms' }] },
    { type: 'bulletList', items: [[{ text: 'Quote valid for 30 days.' }], [{ text: '20% deposit secures the booking.' }]] },
  ],
}

const SAMPLE_TIERS = {
  good: { label: 'Essentials', subtotal_ex_gst: 4436, line_items: [] },
  better: { label: 'Recommended', subtotal_ex_gst: 5673, line_items: [] },
  best: { label: 'Premium', subtotal_ex_gst: 7409, line_items: [] },
  selectedTier: 'better' as const,
}

export default function DevDocEditorPage() {
  return (
    <div className="dev-wrap">
      <style>{EDITOR_CSS}</style>
      <h1 className="dev-h1">Document editor harness</h1>
      <QuoteDocumentWorkspace
        initialDoc={SAMPLE}
        initialStyle={{}}
        tiers={SAMPLE_TIERS}
        onEditPrices={() => window.alert('→ opens the grounded Pricing section (Task E dashboard wiring)')}
      />
    </div>
  )
}

const EDITOR_CSS = `
  .dev-wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 80px; font-family: system-ui, sans-serif; color: #1c2530; }
  .dev-h1 { font-size: 13px; text-transform: uppercase; letter-spacing: .12em; color: #647a8d; margin: 0 0 16px; }
  .dev-json { margin-top: 24px; font-size: 12px; }
  .dev-json pre { background: #0b1119; color: #d6e2ee; padding: 14px; border-radius: 10px; overflow: auto; }

  .qm-doc-shell { border: 1px solid #d7e0ea; border-radius: 14px; overflow: hidden; background: #fff; box-shadow: 0 18px 40px -28px rgba(0,0,0,.4); }
  .qm-doc-toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; background: linear-gradient(180deg,#20303f,#1a2735); }
  .qm-tb-btn { height: 30px; padding: 0 11px; border-radius: 7px; border: 1px solid rgba(255,255,255,.12); background: #0e1720; color: #d6e2ee; font-size: 12.5px; font-weight: 650; cursor: pointer; }
  .qm-tb-btn:hover { border-color: rgba(255,255,255,.28); }
  .qm-tb-btn.is-active { background: #ff5f00; color: #160a02; border-color: #ff5f00; }
  .qm-doc-editor { padding: 26px 30px; min-height: 260px; outline: none; font-family: Georgia, "Times New Roman", serif; font-size: 15px; line-height: 1.6; color: #2b3744; }
  .qm-doc-editor:focus { outline: none; }
  .qm-doc-editor h1 { font-family: system-ui, sans-serif; font-size: 24px; font-weight: 800; color: #0f1722; letter-spacing: -.01em; margin: 0 0 6px; }
  .qm-doc-editor h2 { font-family: system-ui, sans-serif; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; color: #ff5f00; margin: 22px 0 8px; }
  .qm-doc-editor p { margin: 0 0 10px; }
  .qm-doc-editor ul { margin: 6px 0 12px 20px; }
  .qm-doc-editor mark { background: #fff2c4; }
  .qm-pricing-lock { margin: 16px 0; border: 1.5px solid #c9d3de; border-radius: 12px; background: repeating-linear-gradient(135deg,#eef2f7,#eef2f7 10px,#e9eef4 10px,#e9eef4 20px); padding: 14px; font-family: system-ui, sans-serif; color: #5a6b7c; }
  .qm-pricing-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
  .qm-pricing-badge { font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; background: #fff; border: 1px solid #cdd7e1; border-radius: 999px; padding: 5px 10px; }
  .qm-pricing-edit { font-size: 12px; font-weight: 700; color: #160a02; background: #ff5f00; border: none; border-radius: 7px; padding: 6px 11px; cursor: pointer; }
  .qm-pricing-tiers { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
  .qm-tier { background: #fff; border: 1px solid #d7e0ea; border-radius: 9px; padding: 11px; }
  .qm-tier.is-rec { border-color: #ff5f00; box-shadow: 0 0 0 3px rgba(255,95,0,.12); }
  .qm-tier-name { font-size: 10px; font-weight: 800; letter-spacing: .08em; color: #7a8a99; }
  .qm-tier-price { font-size: 19px; font-weight: 800; color: #0f1722; margin: 4px 0 1px; }
  .qm-tier-label { font-size: 11px; color: #8b98a6; }
  .qm-pricing-empty { font-size: 12px; }

  .qm-workspace { display: flex; flex-direction: column; }
  .qm-brand-bar { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; padding: 12px 14px; background: #16202b; border: 1px solid #d7e0ea; border-bottom: none; border-radius: 14px 14px 0 0; }
  .qm-brand-field { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700; color: #93a4b6; text-transform: uppercase; letter-spacing: .06em; }
  .qm-brand-field select { font-size: 13px; padding: 5px 8px; border-radius: 7px; border: 1px solid #33404e; background: #0e1720; color: #eaf1f8; text-transform: none; }
  .qm-swatches { display: flex; gap: 6px; }
  .qm-swatch { width: 22px; height: 22px; border-radius: 6px; border: 2px solid transparent; cursor: pointer; padding: 0; }
  .qm-swatch.is-on { border-color: #fff; box-shadow: 0 0 0 2px #16202b, 0 0 0 4px #fff; }
  .qm-workspace .qm-doc-shell { border-radius: 0; box-shadow: none; }
  .qm-savebar { display: flex; align-items: center; gap: 14px; padding: 12px 14px; background: #0d141d; border: 1px solid #d7e0ea; border-top: none; border-radius: 0 0 14px 14px; }
  .qm-save-state { font-size: 12px; font-family: ui-monospace, monospace; color: #e8b44a; margin-right: auto; }
  .qm-save-saved { color: #46c08a; }
  .qm-save-error { color: #e9705a; }
  .qm-save-btn { font-size: 13px; font-weight: 800; color: #160a02; background: #ff5f00; border: none; border-radius: 9px; padding: 10px 16px; cursor: pointer; }
  .qm-save-btn:disabled { opacity: .45; cursor: default; }
`
