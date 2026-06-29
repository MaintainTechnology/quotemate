// /admin/invites — Invites & recruitment.
//
// Platform/access surface, moved here from the tradie Marketing page
// (/dashboard/invites): invitation codes that gate who can onboard, and
// the recruitment "Onboard as a tradie" signup QR. Both call the same
// tenant-scoped endpoints as before (/api/dashboard/invites/codes and
// /api/dashboard/marketing/qr) — an admin is a tenant-owner, so the
// requests resolve their tenant unchanged; platform-wide invite scope is
// unlocked for PLATFORM_ADMIN_USER_IDS.
//
// Design system: Maintain (dark navy command-centre, orange accent,
// numbered sections, monospace metadata, square corners, borders).
'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import Link from 'next/link'
import { BrandMark } from '@/app/_components/BrandMark'
import {
  INPUT, EYEBROW, PRIMARY, GHOST, TH,
  authHeader, Stat, Section, Panel, Field, TableShell, StatusPill, ActionBtn,
} from '@/app/_components/console-ui'

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

export default function AdminInvitesPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  // ── Invitation codes ──────────────────────────────────────────
  const [codes, setCodes] = useState<Code[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [campaign, setCampaign] = useState('')
  const [quota, setQuota] = useState('100')
  const [scope, setScope] = useState<'tenant' | 'platform'>('tenant')
  const [customCode, setCustomCode] = useState('')
  const [generating, setGenerating] = useState(false)
  const [justMade, setJustMade] = useState<string | null>(null)

  // ── Send a code (email / SMS) ─────────────────────────────────
  const [sendFor, setSendFor] = useState<{ id: string; channel: 'email' | 'sms' } | null>(null)
  const [sendTo, setSendTo] = useState('')
  const [sendBusy, setSendBusy] = useState(false)
  const [sendMsg, setSendMsg] = useState<string | null>(null)

  // ── Signup QRs (Onboard as a tradie) ──────────────────────────
  const [qrs, setQrs] = useState<Qr[]>([])
  const [signupLabel, setSignupLabel] = useState('')
  const [signupGenerating, setSignupGenerating] = useState(false)

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

  const loadQrs = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/marketing/qr', { headers: await authHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load QR codes')
      setQrs(data.qrs ?? [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load QR codes')
    }
  }, [])

  useEffect(() => {
    ;(async () => { await Promise.all([loadCodes(), loadQrs()]); setLoading(false) })()
  }, [loadCodes, loadQrs])

  async function generate() {
    if (!campaign.trim()) { setError('Campaign name required'); return }
    setGenerating(true); setError(null); setJustMade(null)
    try {
      const res = await fetch('/api/dashboard/invites/codes', {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({
          scope,
          campaign: campaign.trim(),
          quota_total: Number(quota),
          ...(customCode.trim() ? { custom_code: customCode.trim() } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Generate failed')
      setJustMade(data.code); setCampaign(''); setCustomCode(''); await loadCodes()
    } catch (e: any) {
      setError(e?.message ?? 'Generate failed')
    } finally { setGenerating(false) }
  }

  async function sendCode(id: string, channel: 'email' | 'sms', to: string) {
    if (!to.trim()) { setError(channel === 'email' ? 'Enter an email address' : 'Enter a mobile number'); return }
    setSendBusy(true); setError(null); setSendMsg(null)
    try {
      const res = await fetch(`/api/dashboard/invites/codes/${id}/send`, {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ channel, to: to.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Send failed')
      setSendMsg(`Invite sent by ${channel === 'email' ? 'email' : 'SMS'} to ${data.to ?? to.trim()}.`)
      setSendFor(null); setSendTo('')
    } catch (e: any) {
      setError(e?.message ?? 'Send failed')
    } finally { setSendBusy(false) }
  }

  async function patchCode(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/dashboard/invites/codes/${id}`, {
      method: 'PATCH', headers: await authHeader(), body: JSON.stringify(body),
    })
    if (res.ok) loadCodes()
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

  async function patchQr(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/dashboard/marketing/qr/${id}`, {
      method: 'PATCH', headers: await authHeader(), body: JSON.stringify(body),
    })
    if (res.ok) loadQrs()
    else { const d = await res.json().catch(() => ({})); setError(d.message ?? d.error ?? 'Update failed') }
  }

  const signupQrs = qrs.filter((q) => q.destination_type === 'signup')
  const signupScans = signupQrs.reduce((n, q) => n + q.scan_count, 0)

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <style>{`
        @keyframes mtUp { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
        .mt-up { animation: mtUp .55s cubic-bezier(.22,1,.36,1) both }
        @media (prefers-reduced-motion: reduce) { .mt-up { animation: none } }
      `}</style>

      {/* atmosphere — faint orange glow + hairline grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full opacity-[0.10] blur-3xl"
             style={{ background: 'radial-gradient(circle, #FFC400 0%, transparent 70%)' }} />
        <div className="absolute inset-0 opacity-[0.04]"
             style={{ backgroundImage: 'linear-gradient(#2D3A4F 1px, transparent 1px), linear-gradient(90deg, #2D3A4F 1px, transparent 1px)', backgroundSize: '64px 64px' }} />
      </div>

      {/* nav */}
      <nav className="relative z-10 border-b border-ink-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
            <BrandMark className="h-10 w-10" />
            <span>QuoteMax</span>
            <span className="text-ink-line">/</span>
            <span className="text-text-pri">Admin</span>
          </div>
          <Link href="/admin" className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-text-pri">
            <span aria-hidden>←</span> Admin
          </Link>
        </div>
      </nav>

      <div className="relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-14 md:pt-20">
        {/* hero header */}
        <header className="mt-up" style={{ animationDelay: '0ms' }}>
          <span className={EYEBROW}>Access &amp; recruitment</span>
          <h1 className="mt-4 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.25rem,6vw,4rem)]">
            Invites &amp; <span className="text-accent">onboarding</span>.
          </h1>
          <p className="mt-5 max-w-xl text-text-sec leading-relaxed">
            Gate who can onboard as a tradie with quota-bound invitation codes, and grow the
            roster with a recruitment QR that opens the QuoteMax signup page.
          </p>
          {/* stat strip */}
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            <Stat n={codes.length} label="Invite codes" />
            <Stat n={signupQrs.length} label="Signup QRs" />
            <Stat n={signupScans} label="Tradie scans" />
          </div>
        </header>

        {error && (
          <div className="mt-8 border-l-2 border-danger bg-danger/10 px-4 py-3 text-sm text-text-pri">{error}</div>
        )}

        {/* ───────── 01 · INVITATION CODES ───────── */}
        <Section num="01" title="Invitation codes" blurb="Gate who can onboard as a tradie. Each code carries a sign-up quota." delay={80}>
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
              <Field label="Custom code (optional)">
                <input value={customCode} onChange={(e) => setCustomCode(e.target.value)} placeholder="MATE2026" className={`${INPUT} font-mono uppercase`} />
              </Field>
            </div>
            <p className="mt-2.5 text-xs text-text-dim">Leave Custom code blank to auto-generate a unique code, or set your own memorable one (e.g. MATE2026) to print on flyers.</p>
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

          {sendMsg && <p className="text-sm text-success">{sendMsg}</p>}

          <TableShell
            loading={loading}
            empty={codes.length === 0}
            emptyText="No codes yet. Generate one above."
            head={<tr>{['Code', 'Campaign', 'Used', 'Status', 'Actions'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr>}
          >
            {codes.map((c) => (
              <Fragment key={c.id}>
                <tr className="border-b border-ink-line/50 align-top last:border-0">
                  <td className="px-4 py-3.5 font-mono text-text-pri">{c.code}{c.tenant_id === null && <span className="ml-2 bg-accent px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wide text-white">platform</span>}</td>
                  <td className="px-4 py-3.5 text-text-sec">{c.campaign ?? '—'}</td>
                  <td className="px-4 py-3.5 font-mono text-text-sec">{c.quota_used}/{c.quota_total}</td>
                  <td className="px-4 py-3.5"><StatusPill status={c.status} /></td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
                      <ActionBtn onClick={() => navigator.clipboard.writeText(c.code)}>Copy</ActionBtn>
                      {c.status !== 'revoked' && <ActionBtn onClick={() => { setSendFor({ id: c.id, channel: 'email' }); setSendTo(''); setSendMsg(null); setError(null) }}>Email</ActionBtn>}
                      {c.status !== 'revoked' && <ActionBtn onClick={() => { setSendFor({ id: c.id, channel: 'sms' }); setSendTo(''); setSendMsg(null); setError(null) }}>SMS</ActionBtn>}
                      {c.status === 'active' ? <ActionBtn onClick={() => patchCode(c.id, { status: 'paused' })}>Pause</ActionBtn>
                        : c.status === 'paused' ? <ActionBtn onClick={() => patchCode(c.id, { status: 'active' })}>Resume</ActionBtn> : null}
                      {c.status !== 'revoked' && <ActionBtn danger onClick={() => patchCode(c.id, { status: 'revoked' })}>Revoke</ActionBtn>}
                    </div>
                  </td>
                </tr>
                {sendFor?.id === c.id && (
                  <tr className="border-b border-ink-line/50 bg-ink-deep/40">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={EYEBROW}>Send {sendFor.channel === 'email' ? 'by email' : 'by SMS'}</span>
                        <input
                          type={sendFor.channel === 'email' ? 'email' : 'tel'}
                          aria-label={sendFor.channel === 'email' ? 'Recipient email' : 'Recipient mobile'}
                          value={sendTo}
                          onChange={(e) => setSendTo(e.target.value)}
                          placeholder={sendFor.channel === 'email' ? 'tradie@example.com' : '0400 000 000'}
                          className={`${INPUT} max-w-xs`}
                        />
                        <button type="button" disabled={sendBusy} onClick={() => sendCode(c.id, sendFor.channel, sendTo)} className={GHOST}>
                          {sendBusy ? 'Sending…' : 'Send'} <span aria-hidden>→</span>
                        </button>
                        <ActionBtn onClick={() => { setSendFor(null); setSendTo('') }}>Cancel</ActionBtn>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </TableShell>
        </Section>

        {/* ───────── 02 · ONBOARD AS A TRADIE ───────── */}
        <Section num="02" title="Onboard as a tradie" blurb="A recruitment QR. Print it on a van, job-site signage, or socials — a scan opens the QuoteMax signup page so another tradie can onboard. Every scan is tracked here." delay={160}>
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
            <p className="mt-2.5 text-xs text-text-dim">Scans open the QuoteMax signup page with a referral tag for attribution.</p>
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
            Gate the door · grow the roster · QuoteMax
          </span>
        </div>
      </div>
    </main>
  )
}
