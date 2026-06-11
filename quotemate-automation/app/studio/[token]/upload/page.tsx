'use client'

// /studio/[token]/upload — the franchisee-facing guided photo upload.
//
// No login: the tokenised link IS the capability. The studio takes the
// requested shots and submits; HQ's AI pre-checks them. Maintain design.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  BTN_PRIMARY,
  delay,
  Notice,
  REVEAL,
  TopoBackdrop,
} from '@/app/dashboard/signage/_components/ui'

type Shot = { slot: string; label: string; instruction: string }

export default function StudioUploadPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [studioName, setStudioName] = useState<string>('')
  const [brand, setBrand] = useState<{ name: string; location_noun: string; hq_name: string } | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [files, setFiles] = useState<Record<string, File[]>>({})
  const [state, setState] = useState<'loading' | 'collect' | 'invalid' | 'done'>('loading')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/signage/request/${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (!json.ok) {
          setState('invalid')
          return
        }
        if (json.mode === 'report') {
          router.replace(`/studio/${token}/report`)
          return
        }
        setStudioName(json.studio_name)
        setBrand(json.brand ?? null)
        setShots(json.shots ?? [])
        setState('collect')
      })
      .catch(() => !cancelled && setState('invalid'))
    return () => {
      cancelled = true
    }
  }, [token, router])

  const onPick = useCallback((slot: string, list: FileList | null) => {
    setFiles((prev) => ({ ...prev, [slot]: list ? Array.from(list) : [] }))
  }, [])

  const totalFiles = useMemo(() => Object.values(files).reduce((n, f) => n + f.length, 0), [files])
  const covered = useMemo(() => shots.filter((s) => (files[s.slot]?.length ?? 0) > 0).length, [shots, files])

  const submit = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      // Re-encode every photo through a canvas before upload. This is the
      // fix for the iOS Safari "The string did not match the expected
      // pattern." crash: appending a picked File straight into FormData can
      // throw inside WebKit, and full-size iPhone photos also blow past the
      // request-size limit. Canvas downscaling hands fetch a small, fresh,
      // in-memory JPEG Blob — which sidesteps both failure modes.
      const fd = new FormData()
      for (const [slot, list] of Object.entries(files)) {
        for (const f of list) {
          const prepared = await prepareImage(f)
          fd.append(slot, prepared.blob, prepared.filename)
        }
      }

      const res = await fetch(`/api/signage/request/${token}`, { method: 'POST', body: fd })
      let json: { ok?: boolean; error?: string } | null = null
      try {
        json = await res.json()
      } catch {
        json = null
      }
      if (!res.ok || !json?.ok) {
        setErr(humanError(json?.error ?? (res.status === 413 ? 'too_large' : 'unknown')))
        return
      }
      setState('done')
      setTimeout(() => router.push(`/studio/${token}/report`), 1200)
    } catch (e) {
      // Never surface a raw WebKit message (e.g. "The string did not match
      // the expected pattern.") to a franchisee — map it to plain guidance.
      console.error('signage submit failed', e)
      setErr('We couldn’t upload those photos. Please try again, or use smaller images.')
    } finally {
      setBusy(false)
    }
  }, [files, token, router])

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <TopoBackdrop />

      <section className="relative z-10 mx-auto max-w-2xl px-6 pt-12 pb-16 sm:px-8 sm:pt-14">
        <div className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent ${REVEAL}`}>
          {brand?.name ?? 'Brand'} compliance check
        </div>
        <h1
          className={`mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.03em] text-[clamp(2rem,7vw,3rem)] ${REVEAL}`}
          style={delay(60)}
        >
          {state === 'collect' ? studioName : 'Compliance check'}
        </h1>
        <p className={`mt-4 text-base leading-relaxed text-text-sec ${REVEAL}`} style={delay(120)}>
          Take the photos below and submit. {brand?.hq_name ?? 'HQ'}&rsquo;s tool will pre-check them against the{' '}
          {brand?.name ?? 'brand'} standards and tell you what (if anything) needs fixing. This is a pre-check,
          not final {brand?.hq_name ?? 'HQ'} approval.
        </p>

        {state === 'loading' && (
          <p className={`mt-8 text-text-sec ${REVEAL}`} style={delay(180)}>
            <span className="mr-2 inline-block h-2.5 w-2.5 bg-accent motion-safe:animate-[pulse-soft_1.6s_ease-in-out_infinite]" aria-hidden="true" />
            Loading your shot list…
          </p>
        )}
        {state === 'invalid' && (
          <div className={`mt-8 ${REVEAL}`}>
            <Notice tone="warn">
              This link is invalid or has expired. Please contact {brand?.hq_name ?? 'HQ'} for a new one.
            </Notice>
          </div>
        )}
        {state === 'done' && (
          <div className={`mt-8 ${REVEAL}`}>
            <Notice tone="good">
              <span className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-teal-glow">✓ Submitted</span>
              <p className="mt-1.5">Preparing your report — you&rsquo;ll be redirected in a moment…</p>
            </Notice>
          </div>
        )}

        {state === 'collect' && (
          <>
            {/* Progress */}
            {shots.length > 0 && (
              <div className={`mt-8 border border-ink-line bg-ink-card p-5 ${REVEAL}`} style={delay(180)}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">Your progress</span>
                  <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-sec">
                    <span className="tabular-nums text-text-pri">{covered}</span>/<span className="tabular-nums">{shots.length}</span> shots covered
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={shots.length}
                  aria-valuenow={covered}
                  aria-label={`${covered} of ${shots.length} shots covered`}
                  className="mt-3 flex h-1.5 w-full gap-px overflow-hidden bg-ink-deep"
                >
                  {shots.map((s) => (
                    <div
                      key={s.slot}
                      className={`flex-1 transition-colors duration-300 ${(files[s.slot]?.length ?? 0) > 0 ? 'bg-teal-glow' : 'bg-ink-line'}`}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-4">
              {shots.map((s, i) => {
                const picked = files[s.slot] ?? []
                const has = picked.length > 0
                return (
                  <div
                    key={s.slot}
                    className={`border border-ink-line bg-ink-card p-5 ${has ? 'border-l-2 border-l-teal-glow' : ''} ${REVEAL}`}
                    style={delay(220 + Math.min(i, 8) * 50)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-2xl font-bold leading-none text-accent" aria-hidden="true">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri">{s.label}</span>
                      </div>
                      {has && (
                        <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-teal-glow">
                          <span className="tabular-nums">{picked.length}</span> ✓
                        </span>
                      )}
                    </div>
                    <p className="mt-2.5 text-sm leading-relaxed text-text-sec">{s.instruction}</p>
                    {has && <PickedThumbs files={picked} label={s.label} />}
                    {/* No `capture` attr: on mobile this lets the user EITHER
                        take a new photo OR pick one already in their gallery
                        (capture="environment" forced the live camera + blocked
                        the gallery, so phone-saved photos couldn't be chosen). */}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      aria-label={`Upload photo for ${s.label}`}
                      onChange={(e) => onPick(s.slot, e.target.files)}
                      className="mt-3 block w-full text-sm text-text-sec file:mr-4 file:cursor-pointer file:border-0 file:bg-accent file:px-4 file:py-2.5 file:font-mono file:text-xs file:font-semibold file:uppercase file:tracking-[0.12em] file:text-white"
                    />
                  </div>
                )
              })}

              {err && <p role="alert" className="text-sm text-warning-bright">{err}</p>}

              <button
                type="button"
                onClick={submit}
                disabled={busy || totalFiles === 0}
                className={`mt-2 w-full py-4 sm:w-auto ${BTN_PRIMARY}`}
              >
                {busy ? 'Uploading your photos…' : <>Submit {totalFiles} photo{totalFiles === 1 ? '' : 's'} for review <span aria-hidden="true">&rarr;</span></>}
              </button>
              {busy && (
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim" aria-live="polite">
                  <span className="mr-2 inline-block h-2 w-2 bg-accent motion-safe:animate-[pulse-soft_1.6s_ease-in-out_infinite]" aria-hidden="true" />
                  Compressing + sending — this can take a few seconds on mobile
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

/** Small previews of the photos picked for one shot. Object URLs are
 *  minted after commit (never during render, so aborted/double renders
 *  can't leak them) and revoked on cleanup. The microtask keeps the
 *  effect body itself free of synchronous setState. */
function PickedThumbs({ files, label }: { files: File[]; label: string }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    let created: string[] = []
    void Promise.resolve().then(() => {
      if (cancelled) return
      created = files.map((f) => URL.createObjectURL(f))
      setUrls(created)
    })
    return () => {
      cancelled = true
      created.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [files])
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {urls.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={u} src={u} alt={`${label} — selected photo ${i + 1}`} className="h-16 w-20 border border-ink-line object-cover" />
      ))}
    </div>
  )
}

function humanError(code: string): string {
  if (code?.endsWith('_over_5mb')) return 'One of your photos is over 5MB — please use a smaller image.'
  if (code?.endsWith('_bad_type')) return 'Only JPG, PNG or WebP images are accepted.'
  if (code === 'no_photos') return 'Add at least one photo before submitting.'
  if (code === 'too_large') return 'Those photos were too large to upload — try selecting fewer at once.'
  if (code === 'invalid_or_expired') return 'This link is invalid or has expired.'
  return 'Something went wrong — please try again.'
}

// Downscale + re-encode a picked photo to a small in-memory JPEG Blob.
// Falls back to re-buffering the original bytes if canvas decoding fails —
// that alone is enough to dodge the iOS Safari File-in-FormData bug that
// surfaces as "The string did not match the expected pattern.".
async function prepareImage(file: File): Promise<{ blob: Blob; filename: string }> {
  try {
    const blob = await downscaleToJpeg(file, 2000, 0.82)
    if (blob && blob.size > 0) {
      return { blob, filename: replaceExt(file.name || 'photo', 'jpg') }
    }
  } catch {
    // fall through to the raw re-buffer path
  }
  const buf = await file.arrayBuffer()
  return {
    blob: new Blob([buf], { type: file.type || 'image/jpeg' }),
    filename: file.name || 'photo.jpg',
  }
}

function downscaleToJpeg(file: File, maxDim: number, quality: number): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) return resolve(null)
      const scale = Math.min(1, maxDim / Math.max(w, h))
      const cw = Math.max(1, Math.round(w * scale))
      const ch = Math.max(1, Math.round(h * scale))
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.drawImage(img, 0, 0, cw, ch)
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image decode failed'))
    }
    img.src = url
  })
}

function replaceExt(name: string, ext: string): string {
  return name.replace(/\.[^.]+$/, '') + '.' + ext
}
