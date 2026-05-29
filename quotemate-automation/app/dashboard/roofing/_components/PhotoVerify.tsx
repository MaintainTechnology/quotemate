'use client'

// Roof photo upload + Claude vision verification.
//
// Flow:
//   1. Tradie / customer drops a JPEG/PNG of the property
//   2. Browser uploads it straight to the intake-photos Supabase bucket
//      (no through-Next bandwidth wasted) via a signed write
//   3. We call /api/roofing/verify-photo with the storage path + the
//      current address
//   4. Server fetches the photo + a Google Maps satellite snapshot +
//      asks Claude vision the two questions ("is this the same
//      building?" + "what material is the roof?")
//   5. Verdict renders inline; when material confidence is high we
//      fire `onMaterialDetected` so the parent can auto-fill the
//      material dropdown
//
// Upload pattern matches the rest of the app — see lib/storage/upload
// for the canonical helper.

import { useCallback, useRef, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import type { RoofMaterial } from '@/lib/roofing/types'

export type VisionVerdict = {
  match: boolean | null
  reason: string
  material: RoofMaterial
  materialConfidence: 'high' | 'medium' | 'low'
  redFlags: string[]
}

type VerifyResponse =
  | { ok: true; verdict: VisionVerdict; hadReference: boolean }
  | { ok: false; error: string }

type Props = {
  accessToken: string | null
  address: string
  /** Called when Claude classified the material with high confidence. */
  onMaterialDetected?: (material: RoofMaterial) => void
}

const BUCKET = 'intake-photos'
const MAX_BYTES = 12 * 1024 * 1024 // 12MB — phone photos are usually 3-8MB

export function PhotoVerify({ accessToken, address, onMaterialDetected }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [stage, setStage] = useState<'idle' | 'uploading' | 'verifying' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<VisionVerdict | null>(null)
  const [hadReference, setHadReference] = useState(false)

  const reset = useCallback(() => {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setPhotoUrl(null)
    setVerdict(null)
    setErrMsg(null)
    setStage('idle')
    if (fileRef.current) fileRef.current.value = ''
  }, [photoUrl])

  const handleFile = useCallback(
    async (file: File) => {
      if (!accessToken) {
        setErrMsg('Sign in to upload a verification photo.')
        setStage('error')
        return
      }
      if (!file.type.startsWith('image/')) {
        setErrMsg('Upload an image file (JPEG / PNG / HEIC).')
        setStage('error')
        return
      }
      if (file.size > MAX_BYTES) {
        setErrMsg(`Photo is too large (${Math.round(file.size / 1024 / 1024)}MB). Limit is 12MB.`)
        setStage('error')
        return
      }
      if (!address.trim()) {
        setErrMsg('Type an address first — the AI needs to know which property to compare against.')
        setStage('error')
        return
      }

      // Local preview
      const preview = URL.createObjectURL(file)
      setPhotoUrl(preview)
      setStage('uploading')
      setErrMsg(null)
      setVerdict(null)

      try {
        const sb = getBrowserSupabase()
        const path = `roofing-verify/${Date.now()}-${slugify(file.name)}`
        const { error: upErr } = await sb.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false })
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

        setStage('verifying')
        const res = await fetch('/api/roofing/verify-photo', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ photoPath: path, address }),
        })
        const json = (await res.json()) as VerifyResponse
        if (!('ok' in json) || json.ok !== true) {
          throw new Error('error' in json ? json.error : 'Vision check failed.')
        }
        setVerdict(json.verdict)
        setHadReference(json.hadReference)
        setStage('done')
        if (
          json.verdict.materialConfidence === 'high' &&
          json.verdict.material !== 'unknown'
        ) {
          onMaterialDetected?.(json.verdict.material)
        }
      } catch (e) {
        setErrMsg(e instanceof Error ? e.message : String(e))
        setStage('error')
      }
    },
    [accessToken, address, onMaterialDetected],
  )

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      if (f) void handleFile(f)
    },
    [handleFile],
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const f = e.dataTransfer.files?.[0]
      if (f) void handleFile(f)
    },
    [handleFile],
  )

  return (
    <div className="border border-ink-line bg-ink-card p-7 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            AI photo verification
          </div>
          <h3 className="mt-2 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri sm:text-2xl">
            Upload a photo of the property
          </h3>
        </div>
        {stage === 'done' && (
          <button
            type="button"
            onClick={reset}
            className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim hover:text-accent"
          >
            Replace photo
          </button>
        )}
      </div>
      <p className="mt-3 text-base leading-relaxed text-text-sec">
        Claude vision compares your photo to Google&apos;s satellite view of
        the address, confirms it&apos;s the right building, and classifies
        the roof material. High-confidence materials auto-fill the
        dropdown above.
      </p>

      {/* Upload area */}
      {stage === 'idle' || stage === 'error' ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className="mt-6 cursor-pointer border border-dashed border-ink-line bg-ink-deep p-8 text-center transition-colors hover:border-accent"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            className="hidden"
          />
          <div className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri">
            Drop a photo here · or click to pick
          </div>
          <div className="mt-2 font-mono text-xs uppercase tracking-[0.14em] text-text-dim">
            JPEG / PNG / HEIC · up to 12 MB
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1fr]">
          {/* Preview */}
          <div className="border border-ink-line bg-ink-deep">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Uploaded property photo"
                className="h-72 w-full object-cover"
              />
            ) : null}
          </div>
          {/* Verdict / status */}
          <VerdictPanel
            stage={stage}
            verdict={verdict}
            hadReference={hadReference}
            errMsg={errMsg}
          />
        </div>
      )}
    </div>
  )
}

function VerdictPanel({
  stage,
  verdict,
  hadReference,
  errMsg,
}: {
  stage: 'uploading' | 'verifying' | 'done' | 'error' | 'idle'
  verdict: VisionVerdict | null
  hadReference: boolean
  errMsg: string | null
}) {
  if (stage === 'error') {
    return (
      <div className="space-y-2 font-mono text-sm">
        <div className="text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-warning">
          Verification failed
        </div>
        <p className="text-base text-text-sec">{errMsg ?? 'Unknown error.'}</p>
      </div>
    )
  }
  if (stage === 'uploading') {
    return (
      <StatusLine label="Uploading photo…" tone="accent" />
    )
  }
  if (stage === 'verifying') {
    return (
      <StatusLine label="Running Claude vision check…" tone="accent" />
    )
  }
  if (stage === 'done' && verdict) {
    const matchTone: 'good' | 'warn' | 'idle' =
      verdict.match === true ? 'good' : verdict.match === false ? 'warn' : 'idle'
    return (
      <div className="space-y-4">
        <div>
          <div
            className={`font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${
              matchTone === 'good' ? 'text-teal-glow' :
              matchTone === 'warn' ? 'text-warning' :
              'text-text-dim'
            }`}
          >
            {!hadReference
              ? 'Single-image classification'
              : verdict.match === true
                ? '✓ Photo matches Google satellite view'
                : verdict.match === false
                  ? '✗ Photo does NOT match the address'
                  : '? Inconclusive — confirm manually'}
          </div>
          <p className="mt-1 text-base text-text-sec">{verdict.reason}</p>
        </div>
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
            Roof material · {verdict.materialConfidence} confidence
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-text-pri">
            {materialLabel(verdict.material)}
          </div>
        </div>
        {verdict.redFlags.length > 0 && (
          <div>
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-warning">
              Flags Claude raised
            </div>
            <ul className="mt-1 space-y-1 text-base text-text-sec">
              {verdict.redFlags.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-warning">!</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }
  return null
}

function StatusLine({ label, tone }: { label: string; tone: 'accent' }) {
  return (
    <div className="flex items-center gap-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-accent">
      <span className="inline-block h-3.5 w-3.5 animate-spin border-2 border-accent/40 border-t-accent" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

function materialLabel(m: RoofMaterial): string {
  switch (m) {
    case 'colorbond_trimdek': return 'Colorbond Trimdek (corrugated metal)'
    case 'colorbond_kliplok': return 'Colorbond Klip-Lok 700'
    case 'concrete_tile':     return 'Concrete tile'
    case 'terracotta_tile':   return 'Terracotta tile'
    case 'cement_sheet':      return 'Cement sheet (asbestos-suspect)'
    case 'unknown':           return 'Unknown / inconclusive'
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
