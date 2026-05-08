'use client'

// ════════════════════════════════════════════════════════════════════
// AI preview + sample gallery on the public quote page.
// Restyled to the Maintain Technology brand (dark canvas, orange accent,
// numbered card pattern, JetBrains Mono labels).
//
// Two visual surfaces:
//   1. PREVIEW — Gemini edits the customer's own uploaded photo
//      (single image, 4:3 aspect, full-width)
//   2. SAMPLES — 3 generic Gemini text-to-image renders showing
//      typical examples of similar work (3 images, 4:3 each, stacked
//      on mobile / 3-up on desktop)
//
// Polls /api/q/[token]/preview-status every 5s while either is
// generating, up to 90s total. Each section hides silently on
// permanent failure / no_photos.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'

type PreviewStatus = 'idle' | 'no_photos' | 'generating' | 'ready' | 'failed'
type SamplesStatus = 'idle' | 'generating' | 'ready' | 'partial' | 'failed'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 90_000

type StatusResponse = {
  preview: { status: PreviewStatus; image_url: string | null }
  samples: { status: SamplesStatus; image_urls: string[] }
}

export function PreviewSection({
  shareToken,
  initialPreviewStatus,
  initialPreviewImageUrl,
  initialSamplesStatus,
  initialSampleImageUrls,
}: {
  shareToken: string
  initialPreviewStatus: PreviewStatus
  initialPreviewImageUrl: string | null
  initialSamplesStatus: SamplesStatus
  initialSampleImageUrls: string[]
}) {
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>(initialPreviewStatus)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(initialPreviewImageUrl)
  const [samplesStatus, setSamplesStatus] = useState<SamplesStatus>(initialSamplesStatus)
  const [sampleImageUrls, setSampleImageUrls] = useState<string[]>(initialSampleImageUrls)
  const [polledForMs, setPolledForMs] = useState(0)

  const previewLoading = previewStatus === 'idle' || previewStatus === 'generating'
  const samplesLoading = samplesStatus === 'idle' || samplesStatus === 'generating'

  useEffect(() => {
    if (!previewLoading && !samplesLoading) return
    if (polledForMs >= POLL_TIMEOUT_MS) return

    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/q/${shareToken}/preview-status`, { cache: 'no-store' })
        if (!res.ok) {
          setPolledForMs(p => p + POLL_INTERVAL_MS)
          return
        }
        const json = await res.json() as StatusResponse
        setPreviewStatus(json.preview.status)
        if (json.preview.image_url) setPreviewImageUrl(json.preview.image_url)
        setSamplesStatus(json.samples.status)
        if (json.samples.image_urls.length > 0) setSampleImageUrls(json.samples.image_urls)
        setPolledForMs(p => p + POLL_INTERVAL_MS)
      } catch {
        setPolledForMs(p => p + POLL_INTERVAL_MS)
      }
    }, POLL_INTERVAL_MS)

    return () => clearTimeout(id)
  }, [previewLoading, samplesLoading, polledForMs, shareToken])

  const showPreviewSection = previewStatus !== 'no_photos' && previewStatus !== 'failed'
  const showSamplesSection = samplesStatus !== 'failed' || sampleImageUrls.length > 0

  if (!showPreviewSection && !showSamplesSection) return null

  const isTimeout = polledForMs >= POLL_TIMEOUT_MS

  return (
    <>
      {/* ─── AI PREVIEW (room-specific edit of customer's photo) ─── */}
      {showPreviewSection ? (
        <section className="mt-6 bg-ink-card border border-ink-line p-6 sm:p-8">
          <div className="flex items-start gap-5 sm:gap-6">
            <span className="font-mono text-3xl sm:text-4xl font-bold text-accent leading-none shrink-0">
              03
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-text-pri font-extrabold uppercase tracking-tight text-base sm:text-lg">
                AI preview · your room
              </h2>
              <p className="mt-1 text-xs text-text-dim">
                Generated from the photo you sent.
              </p>

              <div className="mt-4 relative aspect-4/3 w-full overflow-hidden border border-ink-line bg-ink-deep">
                {previewStatus === 'ready' && previewImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewImageUrl}
                    alt="AI-generated preview of the proposed work in your room"
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <LoadingSkeleton
                    title={isTimeout && previewLoading ? 'Preview taking longer than usual…' : 'Generating your preview…'}
                    subtitle={
                      isTimeout && previewLoading
                        ? "We'll have it ready next time you open this page."
                        : 'Editing your photo with the proposed work — usually 15-30s.'
                    }
                  />
                )}
              </div>

              <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
                Indicative only · actual install may vary based on access and on-site conditions
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {/* ─── SAMPLE GALLERY (3 generic examples of similar work) ─── */}
      {showSamplesSection ? (
        <section className="mt-6 bg-ink-card border border-ink-line p-6 sm:p-8">
          <div className="flex items-start gap-5 sm:gap-6">
            <span className="font-mono text-3xl sm:text-4xl font-bold text-accent leading-none shrink-0">
              {showPreviewSection ? '04' : '03'}
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-text-pri font-extrabold uppercase tracking-tight text-base sm:text-lg">
                Expected sample images
              </h2>
              <p className="mt-1 text-xs text-text-dim">
                Generic AI examples to give you a feel for the finished install. Not your room.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[0, 1, 2].map(i => {
                  const url = sampleImageUrls[i]
                  const labels = ['Wide view', 'Close-up', 'In use']
                  return (
                    <figure key={i} className="m-0">
                      <div className="relative aspect-4/3 w-full overflow-hidden border border-ink-line bg-ink-deep">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={url}
                            alt={`AI-generated ${labels[i].toLowerCase()} sample`}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <LoadingSkeleton
                            title={isTimeout && samplesLoading ? 'Sample pending…' : `Generating ${labels[i].toLowerCase()}…`}
                            subtitle={null}
                            small
                          />
                        )}
                      </div>
                      <figcaption className="mt-2 text-center font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-sec">
                        {labels[i]}
                      </figcaption>
                    </figure>
                  )
                })}
              </div>

              <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-text-dim">
                AI-generated · illustrative · final install matched to your space
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </>
  )
}

function LoadingSkeleton({
  title,
  subtitle,
  small = false,
}: {
  title: string
  subtitle: string | null
  small?: boolean
}) {
  return (
    <>
      <div className="absolute inset-0 animate-pulse bg-linear-to-br from-ink-deep via-ink to-ink-card" aria-hidden />
      <div className="relative flex h-full flex-col items-center justify-center gap-3 px-4 text-text-sec">
        <SparkleIcon size={small ? 24 : 36} className="text-accent" />
        <span className={`${small ? 'text-xs' : 'text-sm'} font-medium text-center text-text-pri`}>{title}</span>
        {subtitle ? <span className="text-xs text-text-dim text-center max-w-xs">{subtitle}</span> : null}
      </div>
    </>
  )
}

function SparkleIcon({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
