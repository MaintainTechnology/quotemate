'use client'

// Dashboard → Files tab (per-tenant file store, spec 2026-06-19, Phase 2).
//
// Two halves:
//   (a) the tradie's archived documents (quotes + uploaded invoices), each
//       with a "View" button that previews the doc inline on the site (PDF in
//       an <iframe>, images in an <img>) and a "Download". Both stream the FULL
//       doc from /api/tenant/files/[id]/download, fetched as a blob so the
//       bearer token can be attached; the viewer renders that blob's object URL.
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

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { FileText, ReceiptText, Download, Eye, Search, Loader2, X, MessageSquare } from 'lucide-react'
import { CommentsThread } from '../../_components/CommentsThread'

type FileDoc = {
  id: string
  display_name: string | null
  source_kind: 'quote' | 'invoice' | string
  trade: string | null
  state: 'pending' | 'active' | 'failed' | 'skipped' | string
  created_at: string
  bytes: number | null
  comment_count?: number
  resolved?: boolean
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

  // Inline viewer state — see the viewer effects + modal below.
  const [viewerDoc, setViewerDoc] = useState<FileDoc | null>(null)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [viewerType, setViewerType] = useState<string>('')
  const [viewerState, setViewerState] = useState<'loading' | 'ready' | 'error'>('loading')
  const viewerUrlRef = useRef<string | null>(null)
  // Monotonic token: a fetch only applies if it's still the latest request,
  // so a slow doc that resolves after the user switched docs (or closed) is
  // dropped instead of clobbering the current view / leaking an object URL.
  const viewReqRef = useRef(0)

  // Chat state
  const [query, setQuery] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<ChatAnswer | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)

  // Comments drawer state
  const [commentsDoc, setCommentsDoc] = useState<FileDoc | null>(null)

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

  // Re-fetch the list (best-effort) so the comment indicators stay current
  // after the comments drawer closes.
  const refreshDocs = useCallback(async () => {
    if (!accessToken) return
    try {
      const res = await fetch('/api/tenant/files', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      if (!res.ok) return
      const json = (await res.json()) as { documents: FileDoc[] }
      setDocs(json.documents ?? [])
    } catch {
      /* best-effort */
    }
  }, [accessToken])

  const closeComments = useCallback(() => {
    setCommentsDoc(null)
    void refreshDocs()
  }, [refreshDocs])

  // Close the inline viewer and revoke its object URL exactly once.
  const closeViewer = useCallback(() => {
    viewReqRef.current += 1 // invalidate any in-flight fetch
    if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current)
    viewerUrlRef.current = null
    setViewerUrl(null)
    setViewerType('')
    setViewerState('loading')
    setViewerDoc(null)
  }, [])

  // While the viewer is open: Esc closes it and the body scroll is locked.
  useEffect(() => {
    if (!viewerDoc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeViewer()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [viewerDoc, closeViewer])

  // Revoke any outstanding object URL if we unmount mid-view.
  useEffect(
    () => () => {
      if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current)
    },
    [],
  )

  // Fetch the full document as a blob (bearer-authenticated). Shared by both
  // the download and the inline viewer so the auth contract stays in one place.
  async function fetchDocBlob(doc: FileDoc): Promise<Blob> {
    const res = await fetch(`/api/tenant/files/${doc.id}/download`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    return res.blob()
  }

  // Save the full document to the device. We fetch as a blob (rather than
  // navigating to a plain href) so the bearer token can be sent on the request.
  async function download(doc: FileDoc) {
    if (!accessToken) return
    setDownloading(doc.id)
    try {
      const blob = await fetchDocBlob(doc)
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

  // Preview the document inline, without leaving the dashboard. The modal
  // opens immediately (showing a spinner) and fills in once the blob loads;
  // PDFs render in an <iframe>, images in an <img>. Anything else falls back
  // to a download. The object URL is tracked in viewerUrlRef so it is revoked
  // exactly once (on close, on switching docs, or on unmount).
  async function view(doc: FileDoc) {
    if (!accessToken) return
    const req = ++viewReqRef.current
    // Drop any URL from a previously-open doc before fetching the next one.
    if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current)
    viewerUrlRef.current = null
    setViewerUrl(null)
    setViewerType('')
    setViewerState('loading')
    setViewerDoc(doc)
    try {
      const blob = await fetchDocBlob(doc)
      if (viewReqRef.current !== req) return // superseded by a newer view/close
      const url = URL.createObjectURL(blob)
      viewerUrlRef.current = url
      setViewerUrl(url)
      setViewerType(blob.type || '')
      setViewerState('ready')
    } catch {
      if (viewReqRef.current !== req) return
      setViewerState('error')
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
    <>
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
                  <div className="flex shrink-0 items-center gap-2">
                    <StatePill state={doc.state} />
                    <button
                      type="button"
                      onClick={() => view(doc)}
                      className="inline-flex items-center gap-1.5 border border-ink-line px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
                    >
                      <Eye size={13} />
                      View
                    </button>
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
                    <button
                      type="button"
                      onClick={() => setCommentsDoc(doc)}
                      className="inline-flex items-center gap-1.5 border border-ink-line px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
                    >
                      <MessageSquare size={13} />
                      Comments{doc.comment_count ? ` (${doc.comment_count})` : ''}
                      {doc.resolved ? (
                        <span
                          className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-success"
                          aria-label="resolved"
                        />
                      ) : null}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>

      {/* ── Inline document viewer (preview on the site itself) ──── */}
      {viewerDoc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={viewerDoc.display_name ?? 'Document'}
          onClick={closeViewer}
          className="fixed inset-0 z-[120] flex flex-col bg-black/85 p-4 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="mx-auto flex h-full w-full max-w-5xl flex-col border border-ink-line bg-ink-card shadow-2xl"
          >
            {/* Header: title + download + close */}
            <div className="flex items-center justify-between gap-3 border-b border-ink-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {viewerDoc.source_kind === 'invoice' ? (
                  <ReceiptText size={16} className="shrink-0 text-text-dim" aria-hidden="true" />
                ) : (
                  <FileText size={16} className="shrink-0 text-text-dim" aria-hidden="true" />
                )}
                <span className="truncate text-sm font-semibold text-text-pri">
                  {viewerDoc.display_name ?? 'Untitled document'}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => download(viewerDoc)}
                  disabled={downloading === viewerDoc.id}
                  className="inline-flex items-center gap-1.5 border border-ink-line px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {downloading === viewerDoc.id ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  Download
                </button>
                <button
                  type="button"
                  onClick={closeViewer}
                  aria-label="Close"
                  className="inline-flex h-8 w-8 items-center justify-center border border-ink-line text-text-pri transition-colors hover:border-accent hover:text-accent"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body: spinner → content → graceful fallback.
                flex-col + min-h-0 so the child can own the full remaining
                height; the PDF iframe grows via flex-1 (not height:100%, which
                collapses for replaced elements in a centered flex parent) so
                its built-in scroll works. */}
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ink-card">
              {viewerState === 'loading' && (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2
                    size={22}
                    className="animate-spin text-text-dim"
                    aria-label="Loading document"
                  />
                </div>
              )}

              {viewerState === 'error' && (
                <div className="flex flex-1 items-center justify-center">
                  <div className="flex flex-col items-center gap-4 p-8 text-center">
                    <p className="text-sm text-text-sec">
                      This document can&apos;t be previewed right now.
                    </p>
                    <button
                      type="button"
                      onClick={() => download(viewerDoc)}
                      className="inline-flex items-center gap-1.5 bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press"
                    >
                      <Download size={13} /> Download instead
                    </button>
                  </div>
                </div>
              )}

              {viewerState === 'ready' &&
                viewerUrl &&
                (viewerType.startsWith('image/') ? (
                  // Tall images scroll within their own scrollable, padded box.
                  <div className="flex flex-1 items-center justify-center overflow-auto p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={viewerUrl}
                      alt={viewerDoc.display_name ?? 'Document'}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : viewerType === 'application/pdf' ||
                  viewerType === '' ||
                  viewerDoc.source_kind === 'quote' ? (
                  <iframe
                    src={viewerUrl}
                    title={viewerDoc.display_name ?? 'Document'}
                    className="min-h-0 w-full flex-1 border-0"
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center">
                    <div className="flex flex-col items-center gap-4 p-8 text-center">
                      <p className="text-sm text-text-sec">
                        Preview isn&apos;t available for this file type.
                      </p>
                      <button
                        type="button"
                        onClick={() => download(viewerDoc)}
                        className="inline-flex items-center gap-1.5 bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press"
                      >
                        <Download size={13} /> Download instead
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Comments drawer ───────────────────────────────────────── */}
      {commentsDoc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Comments — ${commentsDoc.display_name ?? 'document'}`}
          onClick={closeComments}
          className="fixed inset-0 z-[130] flex justify-end bg-black/70"
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
                onClick={closeComments}
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center border border-ink-line text-text-pri transition-colors hover:border-accent hover:text-accent"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <CommentsThread
                apiBase={`/api/tenant/files/${commentsDoc.id}`}
                accessToken={accessToken}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
