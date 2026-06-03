'use client'

// /studio/[token]/upload — the franchisee-facing guided photo upload.
//
// No login: the tokenised link IS the capability. The studio takes the
// requested shots and submits; HQ's AI pre-checks them. Maintain design.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

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

  const submit = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      const fd = new FormData()
      for (const [slot, list] of Object.entries(files)) {
        for (const f of list) fd.append(slot, f)
      }
      const res = await fetch(`/api/signage/request/${token}`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.ok) {
        setErr(humanError(json.error))
        return
      }
      setState('done')
      setTimeout(() => router.push(`/studio/${token}/report`), 1200)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [files, token, router])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="mx-auto max-w-2xl px-6 pt-14 pb-10 sm:px-8">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
          {brand?.name ?? 'Brand'} compliance check
        </div>
        <h1 className="mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.03em] text-[clamp(2rem,7vw,3rem)]">
          {state === 'collect' ? studioName : 'Compliance check'}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-text-sec">
          Take the photos below and submit. {brand?.hq_name ?? 'HQ'}&rsquo;s tool will pre-check them against the{' '}
          {brand?.name ?? 'brand'} standards and tell you what (if anything) needs fixing. This is a pre-check,
          not final {brand?.hq_name ?? 'HQ'} approval.
        </p>

        {state === 'loading' && <p className="mt-8 text-text-sec">Loading…</p>}
        {state === 'invalid' && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-warning bg-ink-card p-6">
            <p className="text-text-sec">This link is invalid or has expired. Please contact {brand?.hq_name ?? 'HQ'} for a new one.</p>
          </div>
        )}
        {state === 'done' && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-teal-glow bg-ink-card p-6">
            <p className="text-teal-glow">Submitted — preparing your report…</p>
          </div>
        )}

        {state === 'collect' && (
          <div className="mt-8 grid gap-5">
            {shots.map((s) => {
              const picked = files[s.slot]?.length ?? 0
              return (
                <div key={s.slot} className="border border-ink-line bg-ink-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-accent">{s.label}</div>
                    {picked > 0 && <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-teal-glow">{picked} ✓</span>}
                  </div>
                  <p className="mt-2 text-sm text-text-sec">{s.instruction}</p>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={(e) => onPick(s.slot, e.target.files)}
                    className="mt-3 block w-full text-sm text-text-sec file:mr-4 file:border-0 file:bg-accent file:px-4 file:py-2.5 file:font-mono file:text-xs file:font-semibold file:uppercase file:tracking-[0.12em] file:text-white"
                  />
                </div>
              )
            })}

            {err && <p className="text-warning">{err}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={busy || totalFiles === 0}
              className="mt-2 inline-flex items-center justify-center gap-2 bg-accent px-6 py-4 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Submitting…' : <>Submit {totalFiles} photo{totalFiles === 1 ? '' : 's'} for review <span aria-hidden="true">&rarr;</span></>}
            </button>
          </div>
        )}
      </section>
    </main>
  )
}

function humanError(code: string): string {
  if (code?.endsWith('_over_5mb')) return 'One of your photos is over 5MB — please use a smaller image.'
  if (code?.endsWith('_bad_type')) return 'Only JPG, PNG or WebP images are accepted.'
  if (code === 'no_photos') return 'Add at least one photo before submitting.'
  if (code === 'invalid_or_expired') return 'This link is invalid or has expired.'
  return 'Something went wrong — please try again.'
}
