'use client'

// CustomerPhotosBlock — the customer-facing "Step 02 · Photos" block on
// /q/[token]. Renders three states from a single component so the
// numbered section is ALWAYS visible:
//
//   A · empty      — "no photos yet" + on-page multi-select upload button
//                    + the same /upload/<token> link that was SMS'd.
//   B · fulfilled  — thumbnail grid + "Photos received" badge.
//   C · transient  — spinner while the POST is in flight, then a brief
//                    "generating preview" hint while Gemini fires in the
//                    background via the upload route's after() callback.
//
// All three states share the same numbered card chrome so a returning
// customer always sees "02 · Photos" — never the disorienting jump from
// 01 to 03 that the old conditional-render had.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const MAX_FILES = 5
const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

type Phase = 'idle' | 'uploading' | 'generating' | 'error'

export function CustomerPhotosBlock({
  urls,
  uploadToken,
}: {
  urls: string[]
  uploadToken: string | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const hasPhotos = urls.length > 0
  const canUpload = !!uploadToken && phase !== 'uploading' && phase !== 'generating'

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !uploadToken) return
    setErrorMessage(null)

    const picked = Array.from(fileList).slice(0, MAX_FILES)
    for (const f of picked) {
      if (!ALLOWED_MIME.has(f.type)) {
        setErrorMessage(`${f.name} is not a JPEG, PNG, or WebP.`)
        return
      }
      if (f.size > MAX_SIZE) {
        setErrorMessage(`${f.name} is over 5MB.`)
        return
      }
    }

    setPhase('uploading')
    try {
      const fd = new FormData()
      for (const f of picked) fd.append('photos', f)
      const res = await fetch(`/api/upload/${uploadToken}`, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({ ok: false, error: 'Upload failed' }))
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? 'Upload failed')
      }

      // Gemini preview generation fires in the upload route's after()
      // callback. We show the "generating" hint while the server settles,
      // then refresh so the next render picks up the new photos.
      setPhase('generating')
      // Small delay so the user sees the state change before the page
      // refresh wipes it. The actual Gemini run continues server-side.
      await new Promise((r) => setTimeout(r, 600))
      router.refresh()
      // After refresh the parent re-renders with urls.length > 0 →
      // component swaps to fulfilled state, phase reset back to idle
      // happens automatically via the next mount cycle.
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setErrorMessage(msg)
      setPhase('error')
    }
  }

  return (
    <section className="mt-6 border border-ink-line bg-ink-card p-6 sm:p-8">
      {/* Header — numbered card chrome, always visible */}
      <div className="flex items-start gap-5 sm:gap-6">
        <span className="font-mono text-3xl sm:text-4xl font-bold text-accent leading-none shrink-0">
          02
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-text-pri font-extrabold uppercase tracking-tight text-base sm:text-lg">
              {hasPhotos ? 'Photos you sent' : 'Photos for your quote'}
            </h2>
            {hasPhotos ? (
              <span className="inline-flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                Received
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-text-sec sm:text-base">
            {hasPhotos
              ? 'Your tradie reviewed these to draft the quote below. Tap any photo to view full-size.'
              : 'No photos uploaded yet. Add one or two so your tradie can sense-check the job and your tier preview can render.'}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="mt-5 sm:mt-6">
        {hasPhotos ? (
          <PhotoGrid urls={urls} />
        ) : (
          <EmptyState
            phase={phase}
            errorMessage={errorMessage}
            canUpload={canUpload}
            uploadToken={uploadToken}
            inputRef={inputRef}
            onPickClick={() => inputRef.current?.click()}
            onFiles={handleFiles}
          />
        )}
      </div>
    </section>
  )
}

// ─── Empty state · upload prompt ─────────────────────────────────────
function EmptyState({
  phase,
  errorMessage,
  canUpload,
  uploadToken,
  inputRef,
  onPickClick,
  onFiles,
}: {
  phase: Phase
  errorMessage: string | null
  canUpload: boolean
  uploadToken: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onPickClick: () => void
  onFiles: (files: FileList | null) => void
}) {
  const busy = phase === 'uploading' || phase === 'generating'

  return (
    <div className="border border-dashed border-ink-line bg-ink-deep p-5 sm:p-6">
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-text-dim">
            Step 02 · Photos
          </p>
          <p className="mt-2 text-sm leading-relaxed text-text-sec sm:text-[0.95rem]">
            {phase === 'uploading'
              ? 'Uploading your photos…'
              : phase === 'generating'
              ? 'Photos received — generating your tier preview…'
              : 'Tap to pick a few photos from your phone. JPEG, PNG, or WebP — up to 5 photos, max 5MB each.'}
          </p>
        </div>

        {/* Hidden multi-select input + visible button */}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={onPickClick}
          disabled={!canUpload}
          className="inline-flex items-center justify-center gap-2 bg-accent px-5 py-3 font-mono text-xs font-bold uppercase tracking-[0.12em] text-white transition-all hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50 sm:py-3.5"
        >
          {busy ? (
            <>
              <Spinner />
              {phase === 'uploading' ? 'Uploading…' : 'Generating…'}
            </>
          ) : (
            <>Upload photos</>
          )}
        </button>
      </div>

      {/* Error */}
      {errorMessage ? (
        <p className="mt-4 border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {errorMessage}
        </p>
      ) : null}

      {/* Fallback — same SMS link, in case the on-page picker fails on
          their browser. Only renders if we actually have a token. */}
      {uploadToken ? (
        <p className="mt-4 font-mono text-[0.7rem] text-text-dim">
          Or open the upload link on your phone:{' '}
          <a
            href={`/upload/${uploadToken}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline-offset-2 hover:underline"
          >
            /upload/{uploadToken.slice(0, 6)}…
          </a>
        </p>
      ) : null}
    </div>
  )
}

// ─── Fulfilled state · thumbnail grid ────────────────────────────────
function PhotoGrid({ urls }: { urls: string[] }) {
  const cols =
    urls.length === 1
      ? 'grid-cols-1'
      : urls.length === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'

  return (
    <div className={`grid gap-3 sm:gap-4 ${cols}`}>
      {urls.map((url, i) => (
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block aspect-4/3 overflow-hidden border border-ink-line bg-ink-deep transition-all hover:border-accent/60 hover:scale-[1.01]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Customer photo ${i + 1}`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </a>
      ))}
    </div>
  )
}

// ─── Spinner ─────────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
