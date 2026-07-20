'use client'

// Outer chrome for the QuoteMax quote surface (redesign).
//
// Renders the fixed top bar (logomark · "Customer quote" · single-trade
// badge · theme toggle · PDF download), the film-grain overlay, the centred
// scroll column that hosts the quote <article>, and the sticky bottom
// deposit bar. Self-contained dark/light: the palette lives on `.qm-quote`
// (globals.css) and this component flips `data-qm-theme` locally, persisted
// as `qm-quote-theme`. Defaults to LIGHT; follows the device's
// prefers-color-scheme when the customer hasn't chosen via the toggle.
//
// Client component for the theme toggle + the "PDF" button (fetches the
// Gotenberg-rendered PDF of this live page from /api/q/download). All quote
// data is passed in already-rendered (children + sticky props).

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { QuoteMaxMark, SunIcon, MoonIcon, DownloadIcon, ArrowRightIcon } from './icons'

export type StickyBar =
  | { paid: true; paidSub?: ReactNode }
  | { paid?: false; tierLabel: string; priceText: string; ctaLabel: string; ctaHref?: string | null }

export function QuoteChrome({
  trade,
  sticky,
  children,
}: {
  trade: { label: string; icon: ReactNode }
  sticky?: StickyBar | null
  children: ReactNode
}) {
  const pathname = usePathname()
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    try {
      // Precedence: ?theme= override (used by the PDF render) → the customer's
      // stored toggle choice → the device's prefers-color-scheme → light.
      const q = new URLSearchParams(window.location.search).get('theme')
      if (q === 'light' || q === 'dark') { setTheme(q); return }
      const t = localStorage.getItem('qm-quote-theme')
      if (t === 'light' || t === 'dark') { setTheme(t); return }
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) setTheme('dark')
    } catch { /* ignore */ }
  }, [])

  function toggle() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('qm-quote-theme', next) } catch { /* ignore */ }
      return next
    })
  }

  // Download the CURRENT quote page as a PDF. Gotenberg renders the live page,
  // so the file matches the on-screen design (and the current theme). Fetched
  // as a blob so we can show a "preparing" state during the few-second render.
  async function downloadPdf() {
    if (pdfBusy || !pathname) return
    setPdfBusy(true)
    try {
      const res = await fetch(`/api/q/download?path=${encodeURIComponent(pathname)}&theme=${theme}`)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `quotemax-quote-${(pathname.split('/').filter(Boolean).pop() ?? 'quote').slice(0, 12)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('Sorry — the PDF could not be generated right now. Please try again in a moment.')
    } finally {
      setPdfBusy(false)
    }
  }

  const ghost = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--ink-line)',
    borderRadius: 9,
    background: 'transparent',
    color: 'var(--text-sec)',
    cursor: 'pointer',
  } as const

  return (
    <div
      className="qm-quote"
      data-qm-theme={theme}
      style={{ minHeight: '100dvh', position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--ink-deep)', color: 'var(--text-pri)' }}
    >
      <div className="noise-overlay qm-print-hide" aria-hidden="true" />

      {/* ── top bar ─────────────────────────────────────────────────── */}
      <header
        className="qm-print-hide"
        style={{ position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, height: 56, padding: '0 20px', borderBottom: '1px solid var(--ink-line)', background: 'var(--ink-deep)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <QuoteMaxMark size={24} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Customer quote</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, border: '1px solid var(--ink-line)', background: 'var(--ink)', padding: 3, borderRadius: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 8, background: 'var(--accent)', color: 'var(--accent-ink)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>
            {trade.icon}
            <span>{trade.label}</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <button type="button" className="qm-ghost" aria-label="Toggle theme" onClick={toggle} style={{ ...ghost, width: 36, height: 36 }}>
            {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
          <button type="button" className="qm-ghost" onClick={downloadPdf} disabled={pdfBusy} aria-busy={pdfBusy} aria-label="Download quote as PDF" style={{ ...ghost, height: 36, padding: '0 14px', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', whiteSpace: 'nowrap', opacity: pdfBusy ? 0.6 : 1, cursor: pdfBusy ? 'default' : 'pointer' }}>
            <DownloadIcon size={14} />
            {pdfBusy ? 'Preparing…' : 'PDF'}
          </button>
        </div>
      </header>

      {/* ── scroll column hosting the quote sheet ───────────────────────
          No z-index here: a positive z-index makes <main> a stacking context,
          which would TRAP any position:fixed descendant (e.g. the TradieEditor
          "Edit pricing" chip) below the sticky header/grain. The header, sticky
          bar and grain are direct children with their own z-index, so main can
          stay at auto and still paint correctly beneath them. */}
      <main className="qm-scroll" style={{ position: 'relative', flex: 1, minHeight: 0, padding: '0 16px', paddingBottom: sticky ? 96 : 32 }}>
        {children}
      </main>

      {/* ── sticky deposit bar ──────────────────────────────────────── */}
      {sticky ? (
        <footer className="qm-print-hide" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 25, borderTop: '1px solid var(--ink-line)', background: 'var(--ink-card)', padding: '12px 20px' }}>
          <div style={{ maxWidth: 'var(--qm-sheet-w)', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            {sticky.paid ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span aria-hidden="true" style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, background: 'color-mix(in srgb, var(--success-bright) 18%, transparent)', color: 'var(--success-bright)', flexShrink: 0, borderRadius: 'var(--qm-r-sm)' }}>✓</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--success-bright)' }}>Deposit paid</div>
                  {sticky.paidSub ? <div style={{ fontSize: 12.5, color: 'var(--text-sec)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sticky.paidSub}</div> : null}
                </div>
              </div>
            ) : (
              <>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-dim)' }}>{sticky.tierLabel}</div>
                  <div style={{ marginTop: 3, fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 17, color: 'var(--text-pri)', fontVariantNumeric: 'tabular-nums' }}>
                    {sticky.priceText} <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)' }}>inc GST</span>
                  </div>
                </div>
                {sticky.ctaHref ? (
                  <a href={sticky.ctaHref} className="qm-cta" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, border: '1px solid transparent', background: 'var(--accent)', color: 'var(--accent-ink)', padding: '13px 20px', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                    {sticky.ctaLabel}
                    <ArrowRightIcon size={16} />
                  </a>
                ) : null}
              </>
            )}
          </div>
        </footer>
      ) : null}
    </div>
  )
}
