'use client'

// /admin/files — QuoteMax staff Files console (specs/files-tab.md R16).
//
// Admin-gated (a 403 from the API renders the "not an admin" state and never
// shows tenant data). Staff pick a tenant, see that tenant's archived
// documents, and open a document to read/post comments as role 'admin' via the
// SAME CommentsThread used on the tradie Files tab — pointed at the /api/admin
// endpoints. Maintain Technology design system (dark navy, orange accent).

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { CommentsThread } from '../../_components/CommentsThread'

type Tenant = { id: string; businessName: string | null }

type FileDoc = {
  id: string
  display_name: string | null
  source_kind: string | null
  trade: string | null
  state: string | null
  created_at: string | null
  comment_count: number
  resolved: boolean
}

type AuthState = 'loading' | 'signed-out' | 'forbidden' | 'ready'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function AdminFilesPage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [selected, setSelected] = useState<string>('')
  const [docs, setDocs] = useState<FileDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [commentsDoc, setCommentsDoc] = useState<FileDoc | null>(null)

  const loadTenants = useCallback(async (t: string) => {
    setErr(null)
    try {
      const res = await fetch('/api/admin/tenants', {
        headers: { Authorization: `Bearer ${t}` },
        cache: 'no-store',
      })
      if (res.status === 403) {
        setAuthState('forbidden')
        return
      }
      const json = (await res.json()) as { ok: boolean; tenants?: Tenant[]; error?: string }
      if (!res.ok || !json.ok) {
        setErr(json.error || `HTTP ${res.status}`)
        setAuthState('ready')
        return
      }
      setTenants(json.tenants ?? [])
      setAuthState('ready')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setAuthState('ready')
    }
  }, [])

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token
      if (!t) {
        setAuthState('signed-out')
        return
      }
      setToken(t)
      void loadTenants(t)
    })
  }, [loadTenants])

  const loadDocs = useCallback(
    async (tenantId: string) => {
      if (!token || !tenantId) {
        setDocs([])
        return
      }
      setDocsLoading(true)
      setErr(null)
      try {
        const res = await fetch(`/api/admin/files?tenantId=${encodeURIComponent(tenantId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const json = (await res.json()) as { ok: boolean; documents?: FileDoc[]; error?: string }
        if (!res.ok || !json.ok) {
          setErr(json.error || `HTTP ${res.status}`)
          setDocs([])
          return
        }
        setDocs(json.documents ?? [])
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
        setDocs([])
      } finally {
        setDocsLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    if (selected) void loadDocs(selected)
  }, [selected, loadDocs])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <header className="mx-auto max-w-7xl px-6 pt-14 pb-8 sm:px-10 md:pt-20">
        <div className="flex items-center gap-3 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
          <Link href="/admin" className="hover:text-accent">
            QuoteMax / Admin
          </Link>
          <span className="text-ink-line">/</span>
          <span className="text-text-pri">Files</span>
        </div>

        <div className="mt-8 grid gap-10 md:grid-cols-[1.5fr_1fr] md:items-end md:gap-16">
          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.5rem,5.5vw,4.75rem)]">
            <span className="text-accent">Files</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-text-sec md:text-lg">
            Every document a tradie has generated — open one to review it with
            them and leave comments as QuoteMax.
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 pb-20 sm:px-10">
        {authState === 'loading' && <Notice>Checking admin status…</Notice>}
        {authState === 'signed-out' && (
          <Notice tone="warn">Not signed in — sign in as an admin to view files.</Notice>
        )}
        {authState === 'forbidden' && (
          <Notice tone="warn">
            Your account is not an admin. This page is restricted to QuoteMax staff.
          </Notice>
        )}

        {authState === 'ready' && (
          <>
            <div className="mb-6 grid gap-3 sm:max-w-md">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim">
                  Tenant
                </span>
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value)
                    setCommentsDoc(null)
                  }}
                  className="border border-ink-line bg-ink-card px-4 py-3 text-sm text-text-pri focus:border-accent focus:outline-none"
                >
                  <option value="">Select a tenant…</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.businessName || '(unnamed)'}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {err && <Notice tone="warn">Error: {err}</Notice>}

            {selected && !err && (
              <>
                {docsLoading ? (
                  <div className="text-sm text-text-dim">Loading documents…</div>
                ) : docs.length === 0 ? (
                  <div className="border border-ink-line bg-ink-card px-6 py-16 text-center text-text-sec">
                    No documents for this tenant yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-ink-line bg-ink-card">
                    <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-ink-line font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
                          <th className="px-4 py-3 font-semibold">Document</th>
                          <th className="px-4 py-3 font-semibold">Kind</th>
                          <th className="px-4 py-3 font-semibold">Created</th>
                          <th className="px-4 py-3 font-semibold">Thread</th>
                          <th className="px-4 py-3 font-semibold">{''}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((d) => (
                          <tr
                            key={d.id}
                            className="border-b border-ink-line/60 transition-colors hover:bg-ink-deep/40"
                          >
                            <td className="px-4 py-4 font-semibold text-text-pri">
                              {d.display_name || <span className="text-text-dim">(untitled)</span>}
                            </td>
                            <td className="px-4 py-4 text-text-sec">
                              {d.source_kind === 'invoice' ? 'Invoice' : 'Quote'}
                              {d.trade ? ` · ${d.trade}` : ''}
                            </td>
                            <td className="px-4 py-4 text-text-sec">{fmtDate(d.created_at)}</td>
                            <td className="px-4 py-4">
                              <span className="text-text-sec">
                                {d.comment_count} comment{d.comment_count === 1 ? '' : 's'}
                              </span>
                              {d.resolved && (
                                <span className="ml-2 inline-block border border-success/50 px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.1em] text-success">
                                  Resolved
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-right">
                              <button
                                type="button"
                                onClick={() => setCommentsDoc(d)}
                                className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent hover:underline"
                              >
                                Comments →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>

      {/* Comments drawer */}
      {commentsDoc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={commentsDoc.display_name ?? 'Document comments'}
          onClick={() => setCommentsDoc(null)}
          className="fixed inset-0 z-[120] flex justify-end bg-black/70"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-l border-ink-line bg-ink-card shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink-line px-4 py-3">
              <span className="truncate text-sm font-semibold text-text-pri">
                {commentsDoc.display_name ?? 'Document'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setCommentsDoc(null)
                  if (selected) void loadDocs(selected)
                }}
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center border border-ink-line text-text-pri transition-colors hover:border-accent hover:text-accent"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <CommentsThread apiBase={`/api/admin/files/${commentsDoc.id}`} accessToken={token} />
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function Notice({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'warn'
}) {
  const cls = tone === 'warn' ? 'border-accent text-text-pri' : 'border-ink-line text-text-sec'
  return <div className={`border ${cls} bg-ink-card px-6 py-5 text-sm`}>{children}</div>
}
