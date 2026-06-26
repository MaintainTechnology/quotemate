// /dashboard/crm — CRM integration + lead-list announcement blast.
// Connect HubSpot/Zoho, import contacts, then send (or re-send) the "I'm now on
// QuoteMax" announcement to the imported list. Maintain design system, mirroring
// /dashboard/invites.
'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { BrandMark } from '@/app/_components/BrandMark'

type Connection = {
  provider: 'hubspot' | 'zoho'
  status: 'connected' | 'error' | 'disconnected'
  connected_at: string
  last_synced_at: string | null
}
type Campaign = {
  id: string
  status: string
  recipient_count: number
  sent_count: number
  failed_count: number
  last_sent_at: string | null
} | null
type Status = {
  providers_available: ('hubspot' | 'zoho')[]
  connections: Connection[]
  contact_count: number
  unsubscribe_count: number
  campaign: Campaign
  ready_to_send: boolean
  missing_for_send: string[]
}
type Preview = {
  mode: string
  total_contacts: number
  recipient_count: number
  suppressed_unsubscribed: number
  skipped_already_sent: number
  duplicates_removed: number
  invalid_removed: number
  subject?: string | null
  html?: string | null
}

const PROVIDER_LABEL: Record<string, string> = { hubspot: 'HubSpot', zoho: 'Zoho' }

const EYEBROW = 'font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim'
const PRIMARY =
  'inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-3 text-xs uppercase tracking-[0.12em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const GHOST =
  'inline-flex items-center gap-2 border border-ink-line hover:border-accent text-text-pri px-4 py-2.5 text-xs uppercase tracking-[0.12em] transition-colors disabled:opacity-40'

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getBrowserSupabase()
  const { data } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' }
}

export default function CrmPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [mode, setMode] = useState<'unsent' | 'all'>('unsent')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/crm/status', { headers: await authHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setStatus(data)
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function connect(provider: string) {
    setBusy(`connect:${provider}`)
    setError(null)
    try {
      const res = await fetch(`/api/tenant/crm/connect/${provider}`, { headers: await authHeader() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Connect failed')
      window.location.href = data.url
    } catch (e) {
      setError((e as Error)?.message ?? 'Connect failed')
      setBusy(null)
    }
  }

  async function sync(provider: string) {
    setBusy(`sync:${provider}`)
    setError(null)
    try {
      const res = await fetch('/api/tenant/crm/sync', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ provider }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Sync failed')
      await load()
    } catch (e) {
      setError((e as Error)?.message ?? 'Sync failed')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(provider: string) {
    if (!confirm(`Disconnect ${PROVIDER_LABEL[provider]}?`)) return
    // R5: optionally delete the imported contacts on disconnect.
    const deleteContacts = confirm(
      'Also delete the contacts imported from this CRM?\n\nOK = delete them · Cancel = keep them.',
    )
    setBusy(`disconnect:${provider}`)
    try {
      await fetch('/api/tenant/crm/disconnect', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ provider, deleteContacts }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function runPreview() {
    setBusy('preview')
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/tenant/campaigns/announcement', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ mode }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'missing_business_details') {
          throw new Error(`Add your ${(data.missing ?? []).join(', ')} in your profile first.`)
        }
        throw new Error(data.error ?? 'Preview failed')
      }
      setPreview(data)
    } catch (e) {
      setError((e as Error)?.message ?? 'Preview failed')
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    if (!preview) return
    if (!confirm(`Send the announcement to ${preview.recipient_count} recipient(s)?`)) return
    setBusy('send')
    setError(null)
    try {
      const res = await fetch('/api/tenant/campaigns/announcement', {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ mode, confirm: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Send failed')
      setResult({ sent: data.sent ?? 0, failed: data.failed ?? 0 })
      setPreview(null)
      await load()
    } catch (e) {
      setError((e as Error)?.message ?? 'Send failed')
    } finally {
      setBusy(null)
    }
  }

  const connectedProviders = new Set(
    (status?.connections ?? []).filter((c) => c.status !== 'disconnected').map((c) => c.provider),
  )
  const connectable = (status?.providers_available ?? []).filter((p) => !connectedProviders.has(p))

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <nav className="relative z-10 border-b border-ink-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-10" />
            <span className="font-extrabold uppercase tracking-tight">QuoteMax</span>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-text-pri"
          >
            <span aria-hidden>←</span> Dashboard
          </Link>
        </div>
      </nav>

      <div className="relative z-10 mx-auto max-w-5xl px-6 pb-24 pt-14 md:pt-20">
        <header>
          <span className={EYEBROW}>CRM &amp; Email</span>
          <h1 className="mt-4 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,5vw,3.4rem)]">
            Wake up your <span className="text-accent">old leads</span>.
          </h1>
          <p className="mt-5 max-w-xl text-text-sec leading-relaxed">
            Connect your CRM, import your contacts, and send a one-tap announcement that you&apos;re now on
            QuoteMax — with a QR code that turns a scan into an instant quote.
          </p>
        </header>

        {error && (
          <div className="mt-8 border-l-2 border-danger bg-danger/10 px-4 py-3 text-sm text-text-pri">{error}</div>
        )}

        {/* 01 · Connect CRM */}
        <Section num="01" title="Connect your CRM" blurb="HubSpot or Zoho. We only read your contacts.">
          {loading ? (
            <Panel><p className="font-mono text-xs uppercase tracking-[0.14em] text-text-dim">Loading…</p></Panel>
          ) : (
            <Panel>
              <div className="flex flex-wrap items-center gap-3">
                {connectable.length === 0 && (status?.providers_available?.length ?? 0) === 0 && (
                  <p className="text-sm text-text-dim">
                    No CRM providers are configured on the server yet. Ask your admin to set the HubSpot / Zoho
                    OAuth credentials.
                  </p>
                )}
                {connectable.map((p) => (
                  <button key={p} type="button" disabled={busy === `connect:${p}`} onClick={() => connect(p)} className={PRIMARY}>
                    {busy === `connect:${p}` ? 'Opening…' : `Connect ${PROVIDER_LABEL[p]}`} <span aria-hidden>→</span>
                  </button>
                ))}
              </div>

              {(status?.connections ?? []).filter((c) => c.status !== 'disconnected').length > 0 && (
                <div className="mt-5 space-y-3">
                  {status!.connections
                    .filter((c) => c.status !== 'disconnected')
                    .map((c) => (
                      <div key={c.provider} className="flex flex-wrap items-center justify-between gap-3 border border-ink-line bg-ink-deep px-4 py-3">
                        <div>
                          <span className="font-semibold">{PROVIDER_LABEL[c.provider]}</span>
                          <span className={`ml-3 font-mono text-[0.6rem] uppercase tracking-[0.12em] ${c.status === 'error' ? 'text-danger' : 'text-success'}`}>
                            ● {c.status}
                          </span>
                          <div className="mt-0.5 font-mono text-[0.62rem] text-text-dim">
                            Last sync: {c.last_synced_at ? new Date(c.last_synced_at).toLocaleString() : 'never'}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy === `sync:${c.provider}`} onClick={() => sync(c.provider)} className={GHOST}>
                            {busy === `sync:${c.provider}` ? 'Syncing…' : 'Sync'}
                          </button>
                          <button type="button" disabled={busy === `disconnect:${c.provider}`} onClick={() => disconnect(c.provider)} className={GHOST}>
                            Disconnect
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
                <Stat n={status?.contact_count ?? 0} label="Contacts imported" />
                <Stat n={status?.unsubscribe_count ?? 0} label="Unsubscribed" />
                <Stat n={status?.campaign?.sent_count ?? 0} label="Sent" />
              </div>
            </Panel>
          )}
        </Section>

        {/* 02 · Announcement */}
        <Section num="02" title="Announce you're on QuoteMax" blurb="Send (or re-send) the announcement email to your imported contacts. Unsubscribes are always skipped.">
          <Panel>
            {!status?.ready_to_send && !loading && (
              <div className="mb-4 border-l-2 border-warning bg-warning/10 px-4 py-3 text-sm">
                Add your {(status?.missing_for_send ?? []).join(', ').replace(/_/g, ' ')} in your profile before sending.
              </div>
            )}
            <div className="flex flex-wrap items-end gap-4">
              <label className="block">
                <span className={EYEBROW}>Who</span>
                <select
                  aria-label="Recipient mode"
                  value={mode}
                  onChange={(e) => { setMode(e.target.value as 'unsent' | 'all'); setPreview(null) }}
                  className="mt-1.5 block w-64 bg-ink-deep border border-ink-line px-3 py-2.5 text-sm text-text-pri focus:border-accent focus:outline-none"
                >
                  <option value="unsent" className="bg-ink-deep">Contacts not yet emailed</option>
                  <option value="all" className="bg-ink-deep">Everyone (re-send)</option>
                </select>
              </label>
              <button type="button" disabled={busy === 'preview'} onClick={runPreview} className={GHOST}>
                {busy === 'preview' ? 'Checking…' : 'Preview recipients'}
              </button>
            </div>

            {preview && (
              <div className="mt-5 border border-ink-line bg-ink-deep p-5">
                <p className="text-lg">
                  <span className="font-mono text-3xl font-bold text-accent">{preview.recipient_count}</span>{' '}
                  recipient(s) will receive the announcement.
                </p>
                <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-text-dim">
                  {preview.total_contacts} contacts · {preview.duplicates_removed} duplicates ·{' '}
                  {preview.suppressed_unsubscribed} unsubscribed · {preview.skipped_already_sent} already sent ·{' '}
                  {preview.invalid_removed} invalid
                </p>
                {preview.html && (
                  <div className="mt-5">
                    <span className={EYEBROW}>Email preview</span>
                    {preview.subject && (
                      <p className="mt-1.5 text-sm text-text-sec">
                        <span className="text-text-dim">Subject:</span> {preview.subject}
                      </p>
                    )}
                    <iframe
                      title="Announcement email preview"
                      srcDoc={preview.html}
                      sandbox=""
                      className="mt-2 h-[28rem] w-full max-w-md border border-ink-line bg-white"
                    />
                  </div>
                )}
                <button
                  type="button"
                  disabled={busy === 'send' || preview.recipient_count === 0}
                  onClick={send}
                  className={`mt-4 ${PRIMARY}`}
                >
                  {busy === 'send' ? 'Sending…' : `Send to ${preview.recipient_count}`} <span aria-hidden>→</span>
                </button>
              </div>
            )}

            {result && (
              <div className="mt-5 border-l-2 border-success bg-success/10 px-4 py-3 text-sm">
                Done — {result.sent} sent{result.failed > 0 ? `, ${result.failed} failed` : ''}.
              </div>
            )}
          </Panel>
        </Section>
      </div>

      <div className="relative z-10 bg-accent">
        <div className="mx-auto max-w-5xl px-6 py-4 text-center">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-white">
            Your contacts, one tap away · QuoteMax
          </span>
        </div>
      </div>
    </main>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="font-mono text-3xl font-bold leading-none text-text-pri">{n}</div>
      <div className="mt-1.5 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">{label}</div>
    </div>
  )
}

function Section({ num, title, blurb, children }: { num: string; title: string; blurb: string; children: ReactNode }) {
  return (
    <section className="mt-14">
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
