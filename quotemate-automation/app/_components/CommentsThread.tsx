'use client'

// Shared, viewer-agnostic comment thread for an archived document
// (specs/files-tab.md R15/R16). The SAME component drives both surfaces — the
// tradie Files tab and the /admin files console — differing only by `apiBase`:
//   tenant: /api/tenant/files/<id>     admin: /api/admin/files/<id>
//
// The server computes each comment's author_label + is_own, so this component
// never needs to know who the viewer is. All requests carry the caller's
// Supabase bearer token. After every mutation we refetch, so the thread + its
// resolved state always reflect the latest server truth.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Check, RotateCcw, Pencil, Trash2, X } from 'lucide-react'

type CommentDto = {
  id: string
  author_role: 'tenant' | 'admin'
  author_label: string
  body: string
  created_at: string
  updated_at: string | null
  is_own: boolean
}

type ThreadResponse = {
  comments: CommentDto[]
  resolved: boolean
  resolved_at: string | null
  resolved_by: string | null
}

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-AU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function CommentsThread({
  apiBase,
  accessToken,
}: {
  apiBase: string
  accessToken: string | null
}) {
  const [data, setData] = useState<ThreadResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const authHeaders = useCallback(
    (json = false): Record<string, string> => {
      const h: Record<string, string> = {}
      if (accessToken) h.Authorization = `Bearer ${accessToken}`
      if (json) h['content-type'] = 'application/json'
      return h
    },
    [accessToken],
  )

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`${apiBase}/comments`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = (await res.json()) as ThreadResponse
      setData(json)
    } catch {
      setError('Could not load comments — try again shortly.')
    } finally {
      setLoading(false)
    }
  }, [apiBase, authHeaders])

  useEffect(() => {
    void load()
  }, [load])

  async function post(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/comments`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ body }),
      })
      if (!res.ok) throw new Error()
      setDraft('')
      await load()
    } catch {
      setError('Could not post your comment.')
    } finally {
      setPosting(false)
    }
  }

  async function saveEdit(id: string) {
    const body = editDraft.trim()
    if (!body || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/comments/${id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ body }),
      })
      if (!res.ok) throw new Error()
      setEditingId(null)
      setEditDraft('')
      await load()
    } catch {
      setError('Could not save your edit.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/comments/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      setError('Could not delete that comment.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleResolved() {
    if (!data || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/resolve`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ resolved: !data.resolved }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      setError('Could not update the thread.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header: resolved state + toggle */}
      <div className="flex items-center justify-between gap-3 border-b border-ink-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-text-dim">
            Comments
          </span>
          {data?.resolved && (
            <span className="inline-flex items-center gap-1 border border-success/50 px-2 py-0.5 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-success">
              <Check size={11} /> Resolved
            </span>
          )}
        </div>
        {data && (
          <button
            type="button"
            onClick={toggleResolved}
            disabled={busy}
            className="inline-flex items-center gap-1.5 border border-ink-line px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {data.resolved ? <RotateCcw size={12} /> : <Check size={12} />}
            {data.resolved ? 'Reopen' : 'Mark resolved'}
          </button>
        )}
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-text-dim">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : !data || data.comments.length === 0 ? (
          <p className="text-sm text-text-dim">
            No comments yet. Start the conversation below.
          </p>
        ) : (
          <ul className="grid gap-4">
            {data.comments.map((c) => (
              <li key={c.id} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        c.author_role === 'admin' ? 'text-accent' : 'text-text-pri'
                      }`}
                    >
                      {c.author_label}
                    </span>
                    <span className="font-mono text-[0.58rem] uppercase tracking-[0.1em] text-text-dim">
                      {fmtWhen(c.created_at)}
                      {c.updated_at ? ' · edited' : ''}
                    </span>
                  </div>
                  {c.is_own && editingId !== c.id && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="Edit comment"
                        onClick={() => {
                          setEditingId(c.id)
                          setEditDraft(c.body)
                        }}
                        className="text-text-dim transition-colors hover:text-accent"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete comment"
                        onClick={() => remove(c.id)}
                        disabled={busy}
                        className="text-text-dim transition-colors hover:text-danger disabled:opacity-50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {editingId === c.id ? (
                  <div className="grid gap-2">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={3}
                      className="w-full resize-y border border-ink-line bg-ink-deep px-3 py-2 text-sm text-text-pri focus:border-accent focus:outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(c.id)}
                        disabled={busy || !editDraft.trim()}
                        className="inline-flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[0.62rem] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press disabled:opacity-50"
                      >
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null)
                          setEditDraft('')
                        }}
                        className="inline-flex items-center gap-1.5 border border-ink-line px-3 py-1.5 text-[0.62rem] font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent hover:text-accent"
                      >
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-sec">
                    {c.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && <div className="mt-4 text-sm text-danger">{error}</div>}
      </div>

      {/* Composer */}
      <form onSubmit={post} className="border-t border-ink-line px-4 py-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Add a comment…"
          className="w-full resize-y border border-ink-line bg-ink-deep px-3 py-2 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={posting || !draft.trim()}
            className="inline-flex items-center gap-2 bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press disabled:opacity-50"
          >
            {posting ? <Loader2 size={14} className="animate-spin" /> : null}
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </form>
    </div>
  )
}
