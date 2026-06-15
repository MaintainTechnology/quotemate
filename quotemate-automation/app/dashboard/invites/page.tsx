// /dashboard/invites — Marketing: invitation codes + QR codes + landing slug.
'use client'

import { useEffect, useState, useCallback } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'

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
  destination_type: 'sms' | 'landing'
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

const FIELD = 'mt-1 w-full bg-ink-deep border border-ink-line px-3 py-2.5 text-text-pri focus:border-accent focus:outline-none'
const LABEL = 'font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim'
const BTN = 'bg-accent hover:bg-accent-press text-white font-semibold px-6 py-3 text-sm uppercase tracking-wider disabled:opacity-50'

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

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-extrabold uppercase tracking-tight text-2xl text-text-pri">Marketing</h1>
      <p className="mt-2 text-text-sec">Invite codes gate who can onboard. QR codes turn flyers into quotes.</p>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {/* ───────────── QR codes ───────────── */}
      <h2 className="mt-10 font-extrabold uppercase tracking-tight text-lg text-text-pri">QR codes</h2>

      {/* Landing link */}
      <div className="mt-4 bg-ink-card border border-ink-line p-6">
        <span className={LABEL}>Your landing link</span>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-text-dim text-sm font-mono">{origin}/t/</span>
          <input value={slugInput} onChange={(e) => setSlugInput(e.target.value)} placeholder="atomic-electrical"
            className="bg-ink-deep border border-ink-line px-3 py-2 text-text-pri font-mono focus:border-accent focus:outline-none" />
          <button onClick={saveSlug} disabled={slugSaving}
            className="border border-ink-line hover:border-accent text-text-pri px-4 py-2 text-sm">
            {slugSaving ? 'Saving…' : 'Save'}
          </button>
          {slug && <span className="text-emerald-400 text-xs">live</span>}
        </div>
        <p className="mt-2 text-xs text-text-dim">This is where the “landing page” QR sends customers. Auto-set from your business name; edit to taste.</p>
      </div>

      {/* Generate QR */}
      <div className="mt-4 bg-ink-card border border-ink-line p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className={LABEL}>Label</span>
            <input value={qrLabel} onChange={(e) => setQrLabel(e.target.value)} placeholder="June letterbox drop" className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>Sends to</span>
            <select value={qrDest} onChange={(e) => setQrDest(e.target.value as 'sms' | 'landing')} className={FIELD}>
              <option value="sms" className="bg-ink-deep">Text me a quote (SMS)</option>
              <option value="landing" className="bg-ink-deep">My landing page</option>
            </select>
          </label>
          {qrDest === 'sms' && (
            <label className="block">
              <span className={LABEL}>Pre-filled text</span>
              <input value={qrPrefill} onChange={(e) => setQrPrefill(e.target.value)} className={FIELD} />
            </label>
          )}
        </div>
        <button onClick={generateQr} disabled={qrGenerating} className={`mt-4 ${BTN}`}>
          {qrGenerating ? 'Generating…' : 'Generate QR'}
        </button>
      </div>

      {/* QR list */}
      <div className="mt-4 bg-ink-card border border-ink-line">
        {loading ? <p className="p-6 text-text-dim">Loading…</p>
          : qrs.length === 0 ? <p className="p-6 text-text-dim">No QR codes yet. Generate one above.</p>
          : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-line text-left font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
                <th className="px-4 py-3">Label</th><th className="px-4 py-3">Sends to</th>
                <th className="px-4 py-3">Scans</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {qrs.map((q) => (
                <tr key={q.id} className="border-b border-ink-line/60 align-top">
                  <td className="px-4 py-3 text-text-pri">{q.label}<div className="text-text-dim font-mono text-[0.65rem]">/s/{q.short_code}</div></td>
                  <td className="px-4 py-3 text-text-sec">{q.destination_type === 'sms' ? 'SMS' : 'Landing page'}</td>
                  <td className="px-4 py-3 text-text-sec">{q.scan_count}</td>
                  <td className="px-4 py-3"><span className={q.status === 'active' ? 'text-emerald-400' : 'text-text-dim'}>{q.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      <a href={`/api/dashboard/marketing/qr/${q.id}/image?format=png`} download className="text-accent hover:text-accent-press underline">PNG</a>
                      <a href={`/api/dashboard/marketing/qr/${q.id}/image?format=svg`} download className="text-accent hover:text-accent-press underline">SVG</a>
                      <button onClick={() => navigator.clipboard.writeText(`${origin}/s/${q.short_code}`)} className="text-text-sec hover:text-text-pri underline">Copy link</button>
                      <button onClick={() => patchQr(q.id, { destination_type: q.destination_type === 'sms' ? 'landing' : 'sms' })} className="text-text-sec hover:text-text-pri underline">Repoint→{q.destination_type === 'sms' ? 'page' : 'SMS'}</button>
                      {q.status === 'active' ? <button onClick={() => patchQr(q.id, { status: 'paused' })} className="text-text-sec hover:text-text-pri underline">Pause</button>
                        : q.status === 'paused' ? <button onClick={() => patchQr(q.id, { status: 'active' })} className="text-text-sec hover:text-text-pri underline">Resume</button> : null}
                      {q.status !== 'archived' && <button onClick={() => patchQr(q.id, { status: 'archived' })} className="text-red-400 hover:text-red-300 underline">Archive</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ───────────── Invitation codes ───────────── */}
      <h2 className="mt-12 font-extrabold uppercase tracking-tight text-lg text-text-pri">Invitation codes</h2>
      <p className="mt-1 text-sm text-text-sec">Gate who can onboard as a tradie. Each code carries a sign-up quota.</p>

      <div className="mt-4 bg-ink-card border border-ink-line p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className={LABEL}>Campaign</span>
            <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="june_flyers" className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>Quota</span>
            <input type="number" min="1" value={quota} onChange={(e) => setQuota(e.target.value)} className={FIELD} />
          </label>
          {isAdmin && (
            <label className="block">
              <span className={LABEL}>Scope</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as 'tenant' | 'platform')} className={FIELD}>
                <option value="tenant" className="bg-ink-deep">My campaign</option>
                <option value="platform" className="bg-ink-deep">Platform-wide</option>
              </select>
            </label>
          )}
        </div>
        <button onClick={generate} disabled={generating} className={`mt-4 ${BTN}`}>{generating ? 'Generating…' : 'Generate code'}</button>
        {justMade && (
          <p className="mt-4 text-sm text-text-pri">New code: <span className="font-mono text-accent">{justMade}</span>{' '}
            <button onClick={() => navigator.clipboard.writeText(justMade)} className="underline ml-2">Copy</button></p>
        )}
      </div>

      <div className="mt-4 bg-ink-card border border-ink-line">
        {loading ? <p className="p-6 text-text-dim">Loading…</p>
          : codes.length === 0 ? <p className="p-6 text-text-dim">No codes yet. Generate one above.</p>
          : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-line text-left font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
                <th className="px-4 py-3">Code</th><th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Used</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-b border-ink-line/60">
                  <td className="px-4 py-3 font-mono text-text-pri">{c.code}{c.tenant_id === null && <span className="ml-2 text-[0.6rem] text-accent uppercase">platform</span>}</td>
                  <td className="px-4 py-3 text-text-sec">{c.campaign ?? '—'}</td>
                  <td className="px-4 py-3 text-text-sec">{c.quota_used}/{c.quota_total}</td>
                  <td className="px-4 py-3"><span className={c.status === 'active' ? 'text-emerald-400' : 'text-text-dim'}>{c.status}</span></td>
                  <td className="px-4 py-3 flex gap-3">
                    <button onClick={() => navigator.clipboard.writeText(c.code)} className="text-text-sec hover:text-text-pri underline">Copy</button>
                    {c.status === 'active' ? <button onClick={() => patchCode(c.id, { status: 'paused' })} className="text-text-sec hover:text-text-pri underline">Pause</button>
                      : c.status === 'paused' ? <button onClick={() => patchCode(c.id, { status: 'active' })} className="text-text-sec hover:text-text-pri underline">Resume</button> : null}
                    {c.status !== 'revoked' && <button onClick={() => patchCode(c.id, { status: 'revoked' })} className="text-red-400 hover:text-red-300 underline">Revoke</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
