// /dashboard/crm — CRM integration + lead-list announcement blast.
// Connect HubSpot/Zoho, import contacts, then send (or re-send) the "I'm now on
// QuoteMax" announcement. Maintain design system: dark navy canvas, orange
// accent, mono metadata, numbered sections, big-number KPI cards, borders not
// shadows. The page has two faces: a connect-first state, and a command-centre
// dashboard once a CRM is connected.
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
  'inline-flex items-center gap-2 border border-ink-line hover:border-accent text-text-pri px-4 py-2.5 text-xs uppercase tracking-[0.12em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getBrowserSupabase()
  const { data } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${data.session?.access_token ?? ''}`, 'Content-Type': 'application/json' }
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'never'
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
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
      setPreview(null)
      setResult(null)
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

  const liveConnections = (status?.connections ?? []).filter((c) => c.status !== 'disconnected')
  const isConnected = liveConnections.length > 0
  const connectedProviders = new Set(liveConnections.map((c) => c.provider))
  const connectable = (status?.providers_available ?? []).filter((p) => !connectedProviders.has(p))
  const campaign = status?.campaign ?? null

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      {/* atmosphere — faint orange glow + hairline grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full opacity-[0.10] blur-3xl"
          style={{ background: 'radial-gradient(circle, #FFC400 0%, transparent 70%)' }}
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(#3A322C 1px, transparent 1px), linear-gradient(90deg, #3A322C 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      {/* nav */}
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
        {/* header */}
        <header>
          <div className="flex flex-wrap items-center gap-3">
            <span className={EYEBROW}>CRM &amp; Email</span>
            {isConnected && (
              <span className="inline-flex items-center gap-1.5 border border-success/40 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Connected
              </span>
            )}
          </div>
          <h1 className="mt-4 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,5vw,3.4rem)]">
            {isConnected ? (
              <>Your <span className="text-accent">lead engine</span>.</>
            ) : (
              <>Wake up your <span className="text-accent">old leads</span>.</>
            )}
          </h1>
          <p className="mt-5 max-w-xl leading-relaxed text-text-sec">
            {isConnected
              ? 'Your CRM is connected. Sync your contacts, preview the announcement, and send it — unsubscribes are always skipped.'
              : "Connect your CRM, import your contacts, and send a one-tap announcement that you're now on QuoteMax — with a QR code that turns a scan into an instant quote."}
          </p>
        </header>

        {error && (
          <div className="mt-8 border-l-2 border-danger bg-danger/10 px-4 py-3 text-sm text-text-pri">{error}</div>
        )}

        {loading ? (
          <div className="mt-12 border border-ink-line bg-ink-card p-6">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-text-dim">Loading…</p>
          </div>
        ) : isConnected ? (
          <>
            {/* ── KPI strip ── */}
            <div className="mt-10 grid grid-cols-2 gap-px border border-ink-line bg-ink-line md:grid-cols-4">
              <Kpi n={status?.contact_count ?? 0} label="Contacts" />
              <Kpi n={campaign?.sent_count ?? 0} label="Emails sent" accent />
              <Kpi n={campaign?.failed_count ?? 0} label="Failed" />
              <Kpi n={status?.unsubscribe_count ?? 0} label="Unsubscribed" />
            </div>

            {/* ── 01 · Connections ── */}
            <Section num="01" title="Connections" blurb="Your linked CRM accounts. Sync to pull in new contacts.">
              <div className="space-y-3">
                {liveConnections.map((c) => (
                  <div key={c.provider} className="border border-ink-line bg-ink-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center bg-accent font-mono text-lg font-bold text-white">
                          {PROVIDER_LABEL[c.provider][0]}
                        </span>
                        <div>
                          <div className="flex items-center gap-2.5">
                            <span className="font-extrabold uppercase tracking-tight">{PROVIDER_LABEL[c.provider]}</span>
                            <StatusPill status={c.status} />
                          </div>
                          <div className="mt-1 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-text-dim">
                            Linked {fmtDate(c.connected_at)} · Last sync {fmtDate(c.last_synced_at)}
                          </div>
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
                    {c.status === 'error' && (
                      <p className="mt-3 border-l-2 border-danger bg-danger/10 px-3 py-2 text-xs text-text-sec">
                        Last sync failed. Try Sync again, or disconnect and reconnect this CRM.
                      </p>
                    )}
                  </div>
                ))}

                {connectable.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 border border-dashed border-ink-line px-5 py-4">
                    <span className="text-sm text-text-dim">Connect another:</span>
                    {connectable.map((p) => (
                      <button key={p} type="button" disabled={busy === `connect:${p}`} onClick={() => connect(p)} className={GHOST}>
                        {busy === `connect:${p}` ? 'Opening…' : `Connect ${PROVIDER_LABEL[p]}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            {/* ── 02 · Announcement ── */}
            <Section
              num="02"
              title="Announcement"
              blurb="Send (or re-send) the “I'm now on QuoteMax” email to your imported contacts."
            >
              <div className="border border-ink-line bg-ink-card p-6">
                {!status?.ready_to_send && (
                  <div className="mb-5 border-l-2 border-warning bg-warning/10 px-4 py-3 text-sm">
                    Add your {(status?.missing_for_send ?? []).join(', ').replace(/_/g, ' ')} in your profile before
                    sending — the email needs them.
                  </div>
                )}

                <div className="flex flex-wrap items-end gap-4">
                  <label className="block">
                    <span className={EYEBROW}>Send to</span>
                    <select
                      aria-label="Recipient mode"
                      value={mode}
                      onChange={(e) => {
                        setMode(e.target.value as 'unsent' | 'all')
                        setPreview(null)
                      }}
                      className="mt-1.5 block w-72 max-w-full border border-ink-line bg-ink-deep px-3 py-2.5 text-sm text-text-pri focus:border-accent focus:outline-none"
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
                  <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto]">
                    <div>
                      <p className="text-lg leading-snug">
                        <span className="font-mono text-4xl font-bold text-accent">{preview.recipient_count}</span>
                        <br />
                        recipient(s) will receive the announcement.
                      </p>
                      <ul className="mt-4 space-y-1.5 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-text-dim">
                        <li>{preview.total_contacts} total contacts</li>
                        <li>− {preview.duplicates_removed} duplicates</li>
                        <li>− {preview.suppressed_unsubscribed} unsubscribed</li>
                        <li>− {preview.skipped_already_sent} already sent</li>
                        <li>− {preview.invalid_removed} invalid</li>
                      </ul>
                      <button
                        type="button"
                        disabled={busy === 'send' || preview.recipient_count === 0}
                        onClick={send}
                        className={`mt-6 ${PRIMARY}`}
                      >
                        {busy === 'send' ? 'Sending…' : `Send to ${preview.recipient_count}`} <span aria-hidden>→</span>
                      </button>
                    </div>

                    {preview.html && (
                      <div className="md:w-[340px]">
                        <span className={EYEBROW}>Email preview</span>
                        {preview.subject && (
                          <p className="mt-1.5 truncate text-xs text-text-sec">
                            <span className="text-text-dim">Subject:</span> {preview.subject}
                          </p>
                        )}
                        <iframe
                          title="Announcement email preview"
                          srcDoc={preview.html}
                          sandbox=""
                          className="mt-2 h-[26rem] w-full border border-ink-line bg-white"
                        />
                      </div>
                    )}
                  </div>
                )}

                {result && (
                  <div className="mt-5 border-l-2 border-success bg-success/10 px-4 py-3 text-sm">
                    Done — {result.sent} sent{result.failed > 0 ? `, ${result.failed} failed` : ''}.
                  </div>
                )}

                {campaign?.last_sent_at && !preview && !result && (
                  <p className="mt-5 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-text-dim">
                    Last sent {fmtDate(campaign.last_sent_at)} · {campaign.sent_count} delivered
                  </p>
                )}
              </div>
            </Section>
          </>
        ) : (
          /* ── Not connected: connect-first ── */
          <Section num="01" title="Connect your CRM" blurb="HubSpot or Zoho. We only read your contacts.">
            {(status?.providers_available?.length ?? 0) === 0 ? (
              <div className="border border-ink-line bg-ink-card p-6">
                <p className="text-sm text-text-dim">
                  No CRM providers are configured on the server yet. Ask your admin to set the HubSpot / Zoho OAuth
                  credentials.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {status!.providers_available.map((p, i) => (
                  <div key={p} className="flex flex-col border border-ink-line bg-ink-card p-7">
                    <div className="flex items-center gap-4">
                      <span className="flex h-12 w-12 items-center justify-center bg-accent font-mono text-xl font-bold text-white">
                        {PROVIDER_LABEL[p][0]}
                      </span>
                      <div>
                        <span className="font-mono text-2xl font-bold leading-none text-accent">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <h3 className="mt-1 font-extrabold uppercase tracking-tight">{PROVIDER_LABEL[p]}</h3>
                      </div>
                    </div>
                    <p className="mt-4 flex-1 text-sm leading-relaxed text-text-sec">
                      Connect your {PROVIDER_LABEL[p]} account to import your contact list. You stay in control — we
                      read contacts only.
                    </p>
                    <button
                      type="button"
                      disabled={busy === `connect:${p}`}
                      onClick={() => connect(p)}
                      className={`mt-5 ${PRIMARY}`}
                    >
                      {busy === `connect:${p}` ? 'Opening…' : `Connect ${PROVIDER_LABEL[p]}`} <span aria-hidden>→</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </div>

      {/* closing accent bar */}
      <div className="relative z-10 bg-accent">
        <div className="mx-auto max-w-5xl px-6 py-4 text-center">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-accent-ink">
            Your contacts, one tap away · QuoteMax
          </span>
        </div>
      </div>
    </main>
  )
}

/* ─── primitives ─────────────────────────────────────────────── */

function Kpi({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="bg-ink-card p-5 md:p-6">
      <div className={`font-mono text-3xl font-bold leading-none md:text-4xl ${accent ? 'text-accent' : 'text-text-pri'}`}>
        {n}
      </div>
      <div className="mt-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">{label}</div>
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
      <div className="mt-6">{children}</div>
    </section>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'connected'
      ? 'text-success border-success/40'
      : status === 'error'
        ? 'text-danger border-danger/40'
        : 'text-text-dim border-ink-line'
  return (
    <span className={`inline-flex border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] ${tone}`}>
      {status}
    </span>
  )
}
