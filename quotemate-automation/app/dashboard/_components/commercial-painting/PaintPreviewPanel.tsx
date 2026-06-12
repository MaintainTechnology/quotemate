'use client'

// Gemini "after repaint" preview panel (spec §6). Renders from the
// run's site photo; one preview at a time, refine-able with a single
// free-text instruction per pass. Failure is non-blocking — the quote
// stands without a preview, the panel just offers retry.

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

const API = '/api/tenant/commercial-painting'

export function PaintPreviewPanel({
  accessToken,
  paintRunId,
  hasSitePhoto,
}: {
  accessToken: string | null
  paintRunId: string
  hasSitePhoto: boolean
}) {
  const [colour, setColour] = useState('')
  const [instruction, setInstruction] = useState('')
  const [before, setBefore] = useState<string | null>(null)
  const [after, setAfter] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function call(payload: Record<string, unknown>) {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`${API}/preview`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ paintRunId, ...payload }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setErr(
          body?.error === 'no_site_photo'
            ? 'Upload a site photo (and mark it as one) to generate a preview.'
            : 'Preview failed — the quote is unaffected. Try again.',
        )
        return
      }
      if (body.before) setBefore(body.before as string)
      setAfter(body.after as string)
      setInstruction('')
    } catch {
      setErr('Preview failed — the quote is unaffected. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'border border-ink-line bg-ink-deep px-3.5 py-2.5 text-sm text-text-pri placeholder:text-text-dim outline-none transition-colors focus:border-accent'

  return (
    <div className="mt-7 border-t border-ink-line pt-5">
      <div className="flex items-center gap-3">
        <h4 className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.16em] text-accent">
          Repaint preview
        </h4>
        <span className="h-px flex-1 bg-ink-line" aria-hidden />
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-text-dim">
          AI concept · not a colour spec
        </span>
      </div>

      {!hasSitePhoto && !after && (
        <p className="mt-3 text-sm text-text-dim">
          Upload a site photo in step 01 to render this job repainted.
        </p>
      )}

      {hasSitePhoto && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            placeholder="Colour scheme, e.g. Dulux Lexicon Quarter walls"
            aria-label="Colour scheme"
            className={`${inputClass} min-w-72 flex-1`}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void call({ colour })}
            className="inline-flex cursor-pointer items-center gap-2 bg-accent px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && !after ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {after ? 'Re-render' : 'Generate preview'}
          </button>
        </div>
      )}

      {err && (
        <p role="alert" className="mt-3 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-2.5 text-sm text-text-sec">
          {err}
        </p>
      )}

      {(before || after) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {before && (
            <figure className="border border-ink-line bg-ink-deep">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={before} alt="Site photo before repaint" className="w-full" />
              <figcaption className="px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-text-dim">
                Before · site photo
              </figcaption>
            </figure>
          )}
          {after && (
            <figure className="border border-ink-line bg-ink-deep">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={after} alt="AI-generated repaint concept" className="w-full" />
              <figcaption className="px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-accent">
                After · AI-generated concept — illustrative only
              </figcaption>
            </figure>
          )}
        </div>
      )}

      {after && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Refine, e.g. make the fascia charcoal"
            aria-label="Refinement instruction"
            className={`${inputClass} min-w-72 flex-1`}
          />
          <button
            type="button"
            disabled={busy || !instruction.trim()}
            onClick={() => void call({ refine: { image: after, instruction } })}
            className="inline-flex cursor-pointer items-center gap-2 border border-ink-line bg-ink-deep px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.14em] text-text-sec transition-colors hover:border-accent hover:text-text-pri disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Refine
          </button>
        </div>
      )}
    </div>
  )
}
