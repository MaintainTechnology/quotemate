// /dashboard/invites — Marketing: QR codes + invitation codes + landing slug.
// Styled to the Maintain design system (dark command-centre, orange accent,
// numbered cards, monospace metadata, square corners, borders not shadows).
'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { BrandMark } from "@/app/_components/BrandMark"

type Code = {
  id: string
  code: string
  tenant_id: string | null
  campaign: string | null
  description: string | null
  quota_total: number
  quota_used: number
  status: 'active' | 'paused' | 'revoked'
  expires_at: string | null
  created_at: string
}

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

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getBrowserSupabase()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/* ─── Maintain design tokens (local shorthands) ───────────────── */
const INPUT =
  'w-full bg-ink-deep border border-ink-line px-3.5 py-2.5 text-sm text-text-pri placeholder:text-text-dim/60 focus:border-accent focus:outline-none transition-colors'
const EYEBROW = 'font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim'
const PRIMARY =
  'inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-3 text-xs uppercase tracking-[0.12em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const GHOST =
  'inline-flex items-center gap-2 border border-ink-line hover:border-accent text-text-pri px-4 py-2.5 text-xs uppercase tracking-[0.12em] transition-colors disabled:opacity-40'
const TH = 'px-4 py-3 text-left font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim font-semibold'

export default function MarketingPage() {
  const [error, setError] = useState<string | null>(null)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  // ── Invitation codes ──────────────────────────────────────────
  const [codes, setCodes] = useState<Code[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [campaign, setCampaign] = useState('')
  const [quota, setQuota] = useState('100')
  const [scope, setScope] = useState<'tenant' | 'platform'>('tenant')
  const [generating, setGenerating] = useState(false)
  const [justMade, setJustMade] = useState<string | null>(null)

  const loadCodes = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/invites/codes', { headers: await authHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load codes')
      setCodes(data.codes ?? [])
      setIsAdmin(!!data.is_platform_admin)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load codes')
    }
  }, [])

  async function generate() {
    if (!campaign.trim()) { setError('Campaign name required'); return }
    setGenerating(true); setError(null); setJustMade(null)
    try {
      const res = await fetch('/api/dashboard/invites/codes', {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ scope, campaign: campaign.trim(), quota_total: Number(quota) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Generate failed')
      setJustMade(data.code); setCampaign(''); await loadCodes()
    } catch (e: any) {
      setError(e?.message ?? 'Generate failed')
    } finally { setGenerating(false) }
  }

  async function patchCode(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/dashboard/invites/codes/${id}`, {
      method: 'PATCH', headers: await authHeader(), body: JSON.stringify(body),
    })
    if (res.ok) loadCodes()
    else { const d = await res.json().catch(() => ({})); setError(d.message ?? d.error ?? 'Update failed') }
  }

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

  // ── Signup QRs (03 · Onboard as a tradie) ─────────────────────
  const [signupLabel, setSignupLabel] = useState('')
  const [signupGenerating, setSignupGenerating] = useState(false)

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
    ;(async () => { await Promise.all([loadCodes(), loadQrs()]); setLoading(false) })()
  }, [loadCodes, loadQrs])

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

  async function generateSignupQr() {
    if (!signupLabel.trim()) { setError('Signup QR label required'); return }
    setSignupGenerating(true); setError(null)
    try {
      const res = await fetch('/api/dashboard/marketing/qr', {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ label: signupLabel.trim(), destination_type: 'signup' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Generate failed')
      setSignupLabel(''); await loadQrs()
    } catch (e: any) {
      setError(e?.message ?? 'Generate failed')
    } finally { setSignupGenerating(false) }
  }

  // Section 01 shows customer-facing QRs; section 03 shows signup QRs.
  const customerQrs = qrs.filter((q) => q.destination_type !== 'signup')
  const signupQrs = qrs.filter((q) => q.destination_type === 'signup')
  const activeQrScans = qrs.reduce((n, q) => n + q.scan_count, 0)
  const signupScans = signupQrs.reduce((n, q) => n + q.scan_count, 0)

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
            Invitation codes control who can onboard.
          </p>
          {/* stat strip */}
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            <Stat n={qrs.length} label="QR codes" />
            <Stat n={activeQrScans} label="Total scans" />
            <Stat n={signupScans} label="Tradie scans" />
            <Stat n={codes.length} label="Invite codes" />
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

        {/* ───────── 02 · INVITATION CODES ───────── */}
        <Section num="02" title="Invitation codes" blurb="Gate who can onboard as a tradie. Each code carries a sign-up quota." delay={160}>
          <Panel>
            <span className={EYEBROW}>New code</span>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <Field label="Campaign"><input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="june_flyers" className={INPUT} /></Field>
              <Field label="Quota"><input aria-label="Sign-up quota" type="number" min="1" value={quota} onChange={(e) => setQuota(e.target.value)} className={INPUT} /></Field>
              {isAdmin && (
                <Field label="Scope">
                  <select aria-label="Invitation code scope" value={scope} onChange={(e) => setScope(e.target.value as 'tenant' | 'platform')} className={INPUT}>
                    <option value="tenant" className="bg-ink-deep">My campaign</option>
                    <option value="platform" className="bg-ink-deep">Platform-wide</option>
                  </select>
                </Field>
              )}
            </div>
            <button type="button" onClick={generate} disabled={generating} className={`mt-5 ${PRIMARY}`}>
              {generating ? 'Generating…' : 'Generate code'} <span aria-hidden>→</span>
            </button>
            {justMade && (
              <p className="mt-4 text-sm text-text-sec">New code:{' '}
                <span className="font-mono text-accent">{justMade}</span>{' '}
                <ActionBtn onClick={() => navigator.clipboard.writeText(justMade)}>Copy</ActionBtn>
              </p>
            )}
          </Panel>

          <TableShell
            loading={loading}
            empty={codes.length === 0}
            emptyText="No codes yet. Generate one above."
            head={<tr>{['Code', 'Campaign', 'Used', 'Status', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>}
          >
            {codes.map((c) => (
              <tr key={c.id} className="border-b border-ink-line/50 align-top last:border-0">
                <td className="px-4 py-3.5 font-mono text-text-pri">{c.code}{c.tenant_id === null && <span className="ml-2 bg-accent px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wide text-white">platform</span>}</td>
                <td className="px-4 py-3.5 text-text-sec">{c.campaign ?? '—'}</td>
                <td className="px-4 py-3.5 font-mono text-text-sec">{c.quota_used}/{c.quota_total}</td>
                <td className="px-4 py-3.5"><StatusPill status={c.status} /></td>
                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
                    <ActionBtn onClick={() => navigator.clipboard.writeText(c.code)}>Copy</ActionBtn>
                    {c.status === 'active' ? <ActionBtn onClick={() => patchCode(c.id, { status: 'paused' })}>Pause</ActionBtn>
                      : c.status === 'paused' ? <ActionBtn onClick={() => patchCode(c.id, { status: 'active' })}>Resume</ActionBtn> : null}
                    {c.status !== 'revoked' && <ActionBtn danger onClick={() => patchCode(c.id, { status: 'revoked' })}>Revoke</ActionBtn>}
                  </div>
                </td>
              </tr>
            ))}
          </TableShell>
        </Section>

        {/* ───────── 03 · ONBOARD AS A TRADIE ───────── */}
        <Section num="03" title="Onboard as a tradie" blurb="A recruitment QR. Print it on your van, job-site signage, or socials — a scan opens the QuoteMax signup page so another tradie can onboard. Every scan is tracked here." delay={240}>
          <Panel>
            <span className={EYEBROW}>New signup QR</span>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <Field label="Label">
                <input value={signupLabel} onChange={(e) => setSignupLabel(e.target.value)} placeholder="Van decal · QR" className={INPUT} />
              </Field>
            </div>
            <button type="button" onClick={generateSignupQr} disabled={signupGenerating} className={`mt-5 ${PRIMARY}`}>
              {signupGenerating ? 'Generating…' : 'Generate signup QR'} <span aria-hidden>→</span>
            </button>
            <p className="mt-2.5 text-xs text-text-dim">Scans open your QuoteMax signup page with a referral tag for attribution.</p>
          </Panel>

          <TableShell
            loading={loading}
            empty={signupQrs.length === 0}
            emptyText="No signup QR codes yet. Generate one above."
            head={<tr>{['Label', 'Scans', 'Status', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>}
          >
            {signupQrs.map((q) => (
              <tr key={q.id} className="border-b border-ink-line/50 align-top last:border-0">
                <td className="px-4 py-3.5 text-text-pri">{q.label}<div className="mt-0.5 font-mono text-[0.62rem] text-text-dim">/s/{q.short_code}</div></td>
                <td className="px-4 py-3.5"><span className="font-mono text-base font-bold text-accent">{q.scan_count}</span></td>
                <td className="px-4 py-3.5"><StatusPill status={q.status} /></td>
                <td className="px-4 py-3.5">
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
                    <a href={`/api/dashboard/marketing/qr/${q.id}/image?format=png`} download className="text-accent hover:text-accent-soft">PNG</a>
                    <a href={`/api/dashboard/marketing/qr/${q.id}/image?format=svg`} download className="text-accent hover:text-accent-soft">SVG</a>
                    <ActionBtn onClick={() => navigator.clipboard.writeText(`${origin}/s/${q.short_code}`)}>Copy link</ActionBtn>
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

/* ─── Primitives ──────────────────────────────────────────────── */

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="font-mono text-3xl font-bold leading-none text-text-pri">{n}</div>
      <div className="mt-1.5 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">{label}</div>
    </div>
  )
}

function Section({ num, title, blurb, delay, children }: { num: string; title: string; blurb: string; delay: number; children: ReactNode }) {
  return (
    <section className="mt-up mt-14" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start gap-5 md:gap-7">
        <span className="shrink-0 font-mono text-5xl font-bold leading-none text-accent md:text-6xl">{num}</span>
        <div className="pt-1">
          <h2 className="font-extrabold uppercase leading-none tracking-[-0.02em] text-2xl md:text-[1.7rem]">{title}</h2>
          <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-text-sec">{blurb}</p>
        </div>
      </div>
      <div className="mt-6 space-y-4">{children}</div>
    </section>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="border border-ink-line bg-ink-card p-6">{children}</div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

function TableShell({ loading, empty, emptyText, head, children }: { loading: boolean; empty: boolean; emptyText: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="border border-ink-line bg-ink-card">
      {loading ? <p className="p-6 font-mono text-xs uppercase tracking-[0.14em] text-text-dim">Loading…</p>
        : empty ? <p className="p-6 text-sm text-text-dim">{emptyText}</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-line">{head}</thead>
              <tbody>{children}</tbody>
            </table>
          </div>
        )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'active' ? 'text-success border-success/40'
      : status === 'paused' ? 'text-warning border-warning/40'
      : 'text-text-dim border-ink-line'
  return <span className={`inline-flex border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] ${tone}`}>{status}</span>
}

function ActionBtn({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`uppercase tracking-[0.08em] transition-colors ${danger ? 'text-danger hover:text-red-400' : 'text-text-sec hover:text-text-pri'}`}>
      {children}
    </button>
  )
}
