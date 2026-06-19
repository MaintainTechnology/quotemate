'use client'

// Dashboard → Files tab (per-tenant file store, spec 2026-06-19, Phase 2).
//
// Two halves:
//   (a) the tradie's archived documents (quotes + uploaded invoices), each
//       with a download that streams the FULL doc from /api/tenant/files/[id]/download
//   (b) an "Ask your documents" chat box → /api/tenant/files/chat, which
//       renders the grounded answer plus its citations. Each citation
//       deep-links to the matching document's download where the cited
//       document title resolves to one of the listed display_names.
//
// All requests carry `Authorization: Bearer <accessToken>` — the same auth
// contract as every other tab (BillingTab/CatalogueTab/etc). The server
// resolves the tenant; the client never sends a tenant id, store id, or
// kb document id. Downloads are fetched as blobs (not plain <a href>) so the
// bearer token can be attached.

import { useEffect, useState, type FormEvent } from 'react'
import { FileText, ReceiptText, Download, Search, Loader2 } from 'lucide-react'

type FileDoc = {
  id: string
  display_name: string | null
  source_kind: 'quote' | 'invoice' | string
  trade: string | null
  state: 'pending' | 'active' | 'failed' | 'skipped' | string
  created_at: string
  bytes: number | null
}

type Citation = { title: string | null; snippet: string | null }
type ChatAnswer = { answer: string; citations: Citation[] }

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

function fmtBytes(b: number | null): string {
  if (!b || b <= 0) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

function StatePill({ state }: { state: string }) {
  const tone =
    state === 'active'
      ? 'border-success/50 text-success'
      : state === 'pending'
        ? 'border-accent/50 text-accent'
        : state === 'failed'
          ? 'border-danger/50 text-danger'
          : 'border-ink-line text-text-dim'
  const label =
    state === 'active'
      ? 'Indexed'
      : state === 'pending'
        ? 'Indexing'
        : state === 'failed'
          ? 'Failed'
          : state === 'skipped'
            ? 'Skipped'
            : state
  return (
    <span
      className={`border px-2 py-0.5 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.12em] ${tone}`}
    >
      {label}
    </span>
  )
}

export function FilesTab({ accessToken }: { accessToken: string | null }) {
  const [docs, setDocs] = useState<FileDoc[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  // Chat state
  const [query, setQuery] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<ChatAnswer | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/tenant/files', {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const json = (await res.json()) as { documents: FileDoc[] }
        if (cancelled) return
        setDocs(json.documents ?? [])
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load your documents')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accessToken])

  // Stream a full document. We fetch as a blob (rather than navigating to a
  // plain href) so the bearer token can be sent on the request.
  async function download(doc: FileDoc) {
    if (!accessToken) return
    setDownloading(doc.id)
    try {
      const res = await fetch(`/api/tenant/files/${doc.id}/download`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.display_name ?? 'document'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not download that document — try again shortly.')
    } finally {
      setDownloading(null)
    }
  }

  // Resolve a citation title to a listed document so we can deep-link its
  // download. Match on display_name (case-insensitive, exact then prefix).
  function docForTitle(title: string | null): FileDoc | null {
    if (!title || !docs) return null
    const t = title.trim().toLowerCase()
    if (!t) return null
    const exact = docs.find((d) => (d.display_name ?? '').trim().toLowerCase() === t)
    if (exact) return exact
    return (
      docs.find((d) => {
        const n = (d.display_name ?? '').trim().toLowerCase()
        return n && (n.startsWith(t) || t.startsWith(n))
      }) ?? null
    )
  }

  async function ask(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q || !accessToken) return
    setAsking(true)
    setChatError(null)
    setAnswer(null)
    try {
      const res = await fetch('/api/tenant/files/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ query: q }),
      })
      const json = (await res.json()) as ChatAnswer & { error?: string }
      // The chat route returns a friendly answer even on the 502 path, so
      // prefer rendering its answer over a generic error.
      if (json.answer) {
        setAnswer({ answer: json.answer, citations: json.citations ?? [] })
      } else if (!res.ok) {
        setChatError('Could not search your documents right now — try again shortly.')
      } else {
        setAnswer({ answer: 'No answer found in your documents.', citations: [] })
      }
    } catch {
      setChatError('Could not search your documents right now — try again shortly.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="max-w-4xl">
      {/* ── Ask your documents ──────────────────────────────────── */}
      <section>
        <h2 className="font-extrabold uppercase tracking-tight text-text-pri text-xl">
          Ask your documents
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-sec">
          Search across your past quotes and uploaded invoices. Answers are
          grounded in your own documents and cite where each figure came from.
        </p>

        <form onSubmit={ask} className="mt-5 flex flex-wrap items-stretch gap-3">
          <div className="relative flex-1 min-w-[16rem]">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. What did I charge for a hot water system?"
              className="w-full border border-ink-line bg-ink-card py-2.5 pl-9 pr-3 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={asking || !query.trim()}
            className="inline-flex items-center gap-2 bg-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press disabled:opacity-50"
          >
            {asking ? <Loader2 size={14} className="animate-spin" /> : null}
            {asking ? 'Searching…' : 'Ask'}
          </button>
        </form>

        {chatError && (
          <div className="mt-4 border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-text-pri">
            {chatError}
          </div>
        )}

        {answer && (
          <div className="mt-5 border border-ink-line bg-ink-card p-5">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-pri">
              {answer.answer}
            </p>
            {answer.citations.length > 0 && (
              <div className="mt-4 border-t border-ink-line pt-4">
                <div className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-text-dim">
                  Sources
                </div>
                <ul className="mt-2.5 grid gap-2.5">
                  {answer.citations.map((c, i) => {
                    const doc = docForTitle(c.title)
                    return (
                      <li key={i} className="text-xs leading-relaxed">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-accent" aria-hidden="true">
                            →
                          </span>
                          {doc ? (
                            <button
                              type="button"
                              onClick={() => download(doc)}
                              disabled={downloading === doc.id}
                              className="font-semibold text-accent underline-offset-2 hover:underline disabled:opacity-50"
                            >
                              {c.title ?? doc.display_name ?? 'Document'}
                            </button>
                          ) : (
                            <span className="font-semibold text-text-pri">
                              {c.title ?? 'Document'}
                            </span>
                          )}
                        </div>
                        {c.snippet && (
                          <p className="mt-1 pl-5 text-text-sec">{c.snippet}</p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Document list ───────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="font-extrabold uppercase tracking-tight text-text-pri text-xl">
          Your documents
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-sec">
          Every quote your AI receptionist drafted and every invoice you
          uploaded, archived securely. Download the full document any time.
        </p>

        {error && (
          <div className="mt-6 border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-text-pri">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-8 text-sm text-text-dim">Loading…</div>
        ) : !docs || docs.length === 0 ? (
          <div className="mt-8 border border-ink-line bg-ink-card p-8 text-center">
            <FileText size={24} className="mx-auto text-text-dim" aria-hidden="true" />
            <p className="mt-3 text-sm text-text-sec">
              No documents yet. Quotes are archived automatically as your AI
              drafts them; uploaded invoices show up here too.
            </p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-ink-line border border-ink-line bg-ink-card">
            {docs.map((doc) => {
              const Icon = doc.source_kind === 'invoice' ? ReceiptText : FileText
              const size = fmtBytes(doc.bytes)
              return (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon
                      size={18}
                      className="shrink-0 text-text-dim"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text-pri">
                        {doc.display_name ?? 'Untitled document'}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim">
                        <span>{doc.source_kind === 'invoice' ? 'Invoice' : 'Quote'}</span>
                        {doc.trade && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{doc.trade}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{fmtDate(doc.created_at)}</span>
                        {size && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{size}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatePill state={doc.state} />
                    <button
                      type="button"
                      onClick={() => download(doc)}
                      disabled={downloading === doc.id}
                      className="inline-flex items-center gap-1.5 border border-ink-line px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {downloading === doc.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      {downloading === doc.id ? 'Getting…' : 'Download'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
