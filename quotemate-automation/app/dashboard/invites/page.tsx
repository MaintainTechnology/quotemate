// /dashboard/invites — Marketing: customer-facing QR codes + landing slug.
//
// Invitation codes and the "Onboard as a tradie" recruitment QR moved to
// the admin surface (/admin/invites); this page is now just the tradie's
// customer-marketing QRs (flyer → SMS / landing page).
//
// Styled to the Maintain design system (dark command-centre, orange accent,
// numbered cards, monospace metadata, square corners, borders not shadows).
'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { BrandMark } from '@/app/_components/BrandMark'
import {
  INPUT, EYEBROW, PRIMARY, GHOST, TH,
  authHeader, Stat, Section, Panel, Field, TableShell, StatusPill, ActionBtn,
} from '@/app/_components/console-ui'

type Qr = {
  id: string
  short_code: string
  label: string
  campaign: string | null
  destination_type: 'sms' | 'landing' | 'signup'
  destination_config: { prefill_body?: string }
  status: 'active' | 'paused' | 'archived'
  scan_count: number
  created_at: string
}

export default function MarketingPage() {
  const [error, setError] = useState<string | null>(null)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  // ── Landing slug ──────────────────────────────────────────────
  const [slug, setSlug] = useState<string | null>(null)
  const [slugInput, setSlugInput] = useState('')
  const [slugSaving, setSlugSaving] = useState(false)

  // ── QR codes ──────────────────────────────────────────────────
  const [qrs, setQrs] = useState<Qr[]>([])
  const [qrLabel, setQrLabel] = useState('')
  const [qrDest, setQrDest] = useState<'sms' | 'landing'>('sms')
  const [qrPrefill, setQrPrefill] = useState('Hi, I’d like a quote')
  const [qrGenerating, setQrGenerating] = useState(false)

  const loadQrs = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/marketing/qr', { headers: await authHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load QR codes')
      setQrs(data.qrs ?? [])
      setSlug(data.slug ?? null)
      setSlugInput(data.slug ?? '')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load QR codes')
    }
  }, [])

  const [loading, setLoading] = useState(true)
  useEffect(() => {
    ;(async () => { await loadQrs(); setLoading(false) })()
  }, [loadQrs])

  async function saveSlug() {
    if (!slugInput.trim()) { setError('Enter a landing link'); return }
    setSlugSaving(true); setError(null)
    try {
      const res = await fetch('/api/dashboard/marketing/slug', {
        method: 'PATCH', headers: await authHeader(), body: JSON.stringify({ slug: slugInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not save link')
      setSlug(data.slug); setSlugInput(data.slug)
    } catch (e: any) {
      setError(e?.message ?? 'Could not save link')
    } finally { setSlugSaving(false) }
  }

  async function generateQr() {
    if (!qrLabel.trim()) { setError('QR label required'); return }
    setQrGenerating(true); setError(null)
    try {
      const res = await fetch('/api/dashboard/marketing/qr', {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({
          label: qrLabel.trim(),
          destination_type: qrDest,
          prefill_body: qrDest === 'sms' ? qrPrefill : '',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Generate failed')
      setQrLabel(''); await loadQrs()
    } catch (e: any) {
      setError(e?.message ?? 'Generate failed')
    } finally { setQrGenerating(false) }
  }

  async function patchQr(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/dashboard/marketing/qr/${id}`, {
      method: 'PATCH', headers: await authHeader(), body: JSON.stringify(body),
    })
    if (res.ok) loadQrs()
    else { const d = await res.json().catch(() => ({})); setError(d.message ?? d.error ?? 'Update failed') }
  }

  // Only customer-facing QRs live here; signup QRs are managed in /admin/invites.
  const customerQrs = qrs.filter((q) => q.destination_type !== 'signup')
  const totalScans = customerQrs.reduce((n, q) => n + q.scan_count, 0)

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <style>{`
        @keyframes mtUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
        .mt-up { animation: mtUp .55s cubic-bezier(.22,1,.36,1) both }
        @media (prefers-reduced-motion: reduce) { .mt-up { animation: none } }
      `}</style>

      {/* atmosphere — faint orange glow + hairline grid, not a solid flat fill */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full opacity-[0.10] blur-3xl"
             style={{ background: 'radial-gradient(circle, #FFC400 0%, transparent 70%)' }} />
        <div className="absolute inset-0 opacity-[0.04]"
             style={{ backgroundImage: 'linear-gradient(#2D3A4F 1px, transparent 1px), linear-gradient(90deg, #2D3A4F 1px, transparent 1px)', backgroundSize: '64px 64px' }} />
      </div>

      {/* nav */}
      <nav className="relative z-10 border-b border-ink-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-10" />
            <span className="font-extrabold uppercase tracking-tight">QuoteMax</span>
          </div>
          <Link href="/dashboard" className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-text-pri">
            <span aria-hidden>←</span> Dashboard
          </Link>
        </div>
      </nav>

      <div className="relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-14 md:pt-20">
        {/* hero header */}
        <header className="mt-up" style={{ animationDelay: '0ms' }}>
          <span className={EYEBROW}>Marketing</span>
          <h1 className="mt-4 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.25rem,6vw,4rem)]">
            Turn flyers<br />into <span className="text-accent">quotes</span>.
          </h1>
          <p className="mt-5 max-w-xl text-text-sec leading-relaxed">
            Print a QR on your flyers — a scan becomes an AI-drafted quote, texted back in minutes.
          </p>
          {/* stat strip */}
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            <Stat n={customerQrs.length} label="QR codes" />
            <Stat n={totalScans} label="Total scans" />
          </div>
        </header>

        {error && (
          <div className="mt-8 border-l-2 border-danger bg-danger/10 px-4 py-3 text-sm text-text-pri">{error}</div>
        )}

        {/* ───────── 01 · QR CODES ───────── */}
        <Section num="01" title="QR codes" blurb="Where a scanned flyer sends a customer — your SMS line or your branded landing page." delay={80}>
          {/* landing link */}
          <Panel>
            <span className={EYEBROW}>Your landing link</span>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-text-dim">{origin}/t/</span>
              <input value={slugInput} onChange={(e) => setSlugInput(e.target.value)} placeholder="atomic-electrical"
                className="bg-ink-deep border border-ink-line px-3 py-2 font-mono text-sm text-text-pri focus:border-accent focus:outline-none" />
              <button type="button" onClick={saveSlug} disabled={slugSaving} className={GHOST}>
                {slugSaving ? 'Saving…' : 'Save'}
              </button>
              {slug && <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-success">● Live</span>}
            </div>
            <p className="mt-2.5 text-xs text-text-dim">Auto-set from your business name. This is where the “landing page” QR sends customers.</p>
          </Panel>

          {/* generate QR */}
          <Panel>
            <span className={EYEBROW}>New QR code</span>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <Field label="Label">
                <input value={qrLabel} onChange={(e) => setQrLabel(e.target.value)} placeholder="June letterbox drop" className={INPUT} />
              </Field>
              <Field label="Sends to">
                <select aria-label="Where the QR sends customers" value={qrDest} onChange={(e) => setQrDest(e.target.value as 'sms' | 'landing')} className={INPUT}>
                  <option value="sms" className="bg-ink-deep">Text me a quote (SMS)</option>
                  <option value="landing" className="bg-ink-deep">My landing page</option>
                </select>
              </Field>
              {qrDest === 'sms' && (
                <Field label="Pre-filled text">
                  <input aria-label="Pre-filled SMS text" value={qrPrefill} onChange={(e) => setQrPrefill(e.target.value)} className={INPUT} />
                </Field>
              )}
            </div>
            <button type="button" onClick={generateQr} disabled={qrGenerating} className={`mt-5 ${PRIMARY}`}>
              {qrGenerating ? 'Generating…' : 'Generate QR'} <span aria-hidden>→</span>
            </button>
          </Panel>

          {/* QR list */}
          <TableShell
            loading={loading}
            empty={customerQrs.length === 0}
            emptyText="No QR codes yet. Generate one above."
            head={<tr>{['Label', 'Sends to', 'Scans', 'Status', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>}
          >
            {customerQrs.map((q) => (
              <tr key={q.id} className="border-b border-ink-line/50 align-top last:border-0">
                <td className="px-4 py-3.5 text-text-pri">{q.label}<div className="mt-0.5 font-mono text-[0.62rem] text-text-dim">/s/{q.short_code}</div></td>
                <td className="px-4 py-3.5 text-text-sec">{q.destination_type === 'sms' ? 'SMS' : 'Landing page'}</td>
                <td className="px-4 py-3.5"><span className="font-mono text-base font-bold text-accent">{q.scan_count}</span></td>
                <td className="px-4 py-3.5"><StatusPill status={q.status} /></td>
                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
                    <a href={`/api/dashboard/marketing/qr/${q.id}/image?format=png`} download className="text-accent hover:text-accent-soft">PNG</a>
                    <a href={`/api/dashboard/marketing/qr/${q.id}/image?format=svg`} download className="text-accent hover:text-accent-soft">SVG</a>
                    <ActionBtn onClick={() => navigator.clipboard.writeText(`${origin}/s/${q.short_code}`)}>Copy link</ActionBtn>
                    <ActionBtn onClick={() => patchQr(q.id, { destination_type: q.destination_type === 'sms' ? 'landing' : 'sms' })}>Repoint→{q.destination_type === 'sms' ? 'page' : 'SMS'}</ActionBtn>
                    {q.status === 'active' ? <ActionBtn onClick={() => patchQr(q.id, { status: 'paused' })}>Pause</ActionBtn>
                      : q.status === 'paused' ? <ActionBtn onClick={() => patchQr(q.id, { status: 'active' })}>Resume</ActionBtn> : null}
                    {q.status !== 'archived' && <ActionBtn danger onClick={() => patchQr(q.id, { status: 'archived' })}>Archive</ActionBtn>}
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        </Section>
      </div>

      {/* closing orange accent bar */}
      <div className="relative z-10 bg-accent">
        <div className="mx-auto max-w-5xl px-6 py-4 text-center">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-white">
            Every scan is a lead · QuoteMax
          </span>
        </div>
      </div>
    </main>
  )
}
