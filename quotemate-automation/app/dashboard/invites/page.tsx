// /dashboard/invites — generate + manage invitation codes.
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

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getBrowserSupabase()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export default function InvitesPage() {
  const [codes, setCodes] = useState<Code[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Generate form state.
  const [campaign, setCampaign] = useState('')
  const [quota, setQuota] = useState('100')
  const [scope, setScope] = useState<'tenant' | 'platform'>('tenant')
  const [generating, setGenerating] = useState(false)
  const [justMade, setJustMade] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/invites/codes', { headers: await authHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load codes')
      setCodes(data.codes ?? [])
      setIsAdmin(!!data.is_platform_admin)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function generate() {
    if (!campaign.trim()) { setError('Campaign name required'); return }
    setGenerating(true)
    setError(null)
    setJustMade(null)
    try {
      const res = await fetch('/api/dashboard/invites/codes', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ scope, campaign: campaign.trim(), quota_total: Number(quota) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Generate failed')
      setJustMade(data.code)
      setCampaign('')
      await load()
    } catch (e: any) {
      setError(e?.message ?? 'Generate failed')
    } finally {
      setGenerating(false)
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/dashboard/invites/codes/${id}`, {
      method: 'PATCH', headers: await authHeader(), body: JSON.stringify(body),
    })
    if (res.ok) load()
    else {
      const d = await res.json().catch(() => ({}))
      setError(d.message ?? d.error ?? 'Update failed')
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-extrabold uppercase tracking-tight text-2xl text-text-pri">Invitation codes</h1>
      <p className="mt-2 text-text-sec">Generate codes for flyers, ads, and referrals. Each code carries a sign-up quota.</p>

      {/* Generate */}
      <div className="mt-8 bg-ink-card border border-ink-line p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">Campaign</span>
            <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="june_flyers"
              className="mt-1 w-full bg-ink-deep border border-ink-line px-3 py-2.5 text-text-pri focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">Quota</span>
            <input type="number" min="1" value={quota} onChange={(e) => setQuota(e.target.value)}
              className="mt-1 w-full bg-ink-deep border border-ink-line px-3 py-2.5 text-text-pri focus:border-accent focus:outline-none" />
          </label>
          {isAdmin && (
            <label className="block">
              <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">Scope</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as 'tenant' | 'platform')}
                className="mt-1 w-full bg-ink-deep border border-ink-line px-3 py-2.5 text-text-pri focus:border-accent focus:outline-none">
                <option value="tenant" className="bg-ink-deep">My campaign</option>
                <option value="platform" className="bg-ink-deep">Platform-wide</option>
              </select>
            </label>
          )}
        </div>
        <button onClick={generate} disabled={generating}
          className="mt-4 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-3 text-sm uppercase tracking-wider disabled:opacity-50">
          {generating ? 'Generating…' : 'Generate code'}
        </button>
        {justMade && (
          <p className="mt-4 text-sm text-text-pri">
            New code: <span className="font-mono text-accent">{justMade}</span>{' '}
            <button onClick={() => navigator.clipboard.writeText(justMade)} className="underline ml-2">Copy</button>
          </p>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {/* List */}
      <div className="mt-8 bg-ink-card border border-ink-line">
        {loading ? (
          <p className="p-6 text-text-dim">Loading…</p>
        ) : codes.length === 0 ? (
          <p className="p-6 text-text-dim">No codes yet. Generate one above.</p>
        ) : (
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
                  <td className="px-4 py-3 font-mono text-text-pri">
                    {c.code}{c.tenant_id === null && <span className="ml-2 text-[0.6rem] text-accent uppercase">platform</span>}
                  </td>
                  <td className="px-4 py-3 text-text-sec">{c.campaign ?? '—'}</td>
                  <td className="px-4 py-3 text-text-sec">{c.quota_used}/{c.quota_total}</td>
                  <td className="px-4 py-3">
                    <span className={c.status === 'active' ? 'text-emerald-400' : 'text-text-dim'}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3 flex gap-3">
                    <button onClick={() => navigator.clipboard.writeText(c.code)} className="text-text-sec hover:text-text-pri underline">Copy</button>
                    {c.status === 'active' ? (
                      <button onClick={() => patch(c.id, { status: 'paused' })} className="text-text-sec hover:text-text-pri underline">Pause</button>
                    ) : c.status === 'paused' ? (
                      <button onClick={() => patch(c.id, { status: 'active' })} className="text-text-sec hover:text-text-pri underline">Resume</button>
                    ) : null}
                    {c.status !== 'revoked' && (
                      <button onClick={() => patch(c.id, { status: 'revoked' })} className="text-red-400 hover:text-red-300 underline">Revoke</button>
                    )}
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
