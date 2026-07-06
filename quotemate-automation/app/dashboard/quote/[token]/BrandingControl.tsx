'use client'

// Per-quote branding control (spec 2026-07-06 §3.1, Phase 1 Task D). Produces a
// report_style override — font, accent colour, heading style — from a bounded
// allow-list (never arbitrary CSS). The values map 1:1 to the server-side
// validateReportStyle allow-list, so anything selectable here is accepted on
// save; the accent swatches ARE the palette. This edit is Tier-1 "free" content
// (per-quote only) — it never touches pricing.

import { ALLOWED_ACCENTS, type ReportStyle } from '@/lib/quote/report-doc/style'

const FONTS: NonNullable<ReportStyle['fontFamily']>[] = ['system', 'serif', 'sans', 'mono']
const HEADINGS: NonNullable<ReportStyle['headingStyle']>[] = ['plain', 'underline', 'bar']

export type BrandingControlProps = {
  value: ReportStyle
  onChange: (style: ReportStyle) => void
}

export default function BrandingControl({ value, onChange }: BrandingControlProps) {
  const set = (patch: Partial<ReportStyle>) => onChange({ ...value, ...patch })

  return (
    <div className="qm-brand-bar" role="group" aria-label="Branding">
      <label className="qm-brand-field">
        <span>Font</span>
        <select
          value={value.fontFamily ?? 'system'}
          onChange={(e) => set({ fontFamily: e.target.value as ReportStyle['fontFamily'] })}
        >
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <div className="qm-brand-field">
        <span>Accent</span>
        <div className="qm-swatches">
          {ALLOWED_ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={`Accent ${c}`}
              className={`qm-swatch${value.accentColor === c ? ' is-on' : ''}`}
              style={{ background: c }}
              onClick={() => set({ accentColor: c })}
            />
          ))}
        </div>
      </div>

      <label className="qm-brand-field">
        <span>Headings</span>
        <select
          value={value.headingStyle ?? 'plain'}
          onChange={(e) => set({ headingStyle: e.target.value as ReportStyle['headingStyle'] })}
        >
          {HEADINGS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
