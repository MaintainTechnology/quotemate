'use client'

// ════════════════════════════════════════════════════════════════════
// AI preview + sample gallery on the public quote page.
// Maintain Technology brand styling — dark canvas, orange accent,
// numbered card pattern, JetBrains Mono labels.
//
// Two visual surfaces:
//   1. PREVIEW — One Gemini-edited image PER uploaded customer photo
//                (1 photo = 1 preview, 2 photos = 2 previews, 3 = 3).
//                Adaptive grid: 1-up / 2-up / 3-up.
//   2. SAMPLES — 3 generic Gemini renders showing wide / close-up /
//                in-use views of similar work. When customer photos
//                exist, samples are tailored to the customer's room
//                (visually consistent with the preview).
//
// Every image is wrapped in a click-to-enlarge link that opens the
// full-size signed URL in a new browser tab.
//
// Polling: /api/q/[token]/preview-status every 5s while either surface
// is still generating, up to 90s total.
//
// `nested` (five-section layout): both surfaces become SUB-BLOCKS of the
// numbered "Overview" section instead of numbered cards 03 and 04 of their own
// — no hard-coded digits, no card border, headings demoted to sub-headings.
// The polling, the skeletons and the timeout copy are identical in both modes:
// the numbering was the only thing tying this component to its old position.
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'

type PreviewStatus = 'idle' | 'no_photos' | 'generating' | 'ready' | 'partial' | 'failed'
type SamplesStatus = 'idle' | 'generating' | 'ready' | 'partial' | 'failed'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 90_000

type StatusResponse = {
  preview: { status: PreviewStatus; image_urls: string[] }
  samples: { status: SamplesStatus; image_urls: string[] }
}

export function PreviewSection({
  shareToken,
  initialPreviewStatus,
  initialPreviewImageUrls,
  initialSamplesStatus,
  initialSampleImageUrls,
  nested = false,
}: {
  shareToken: string
  initialPreviewStatus: PreviewStatus
  initialPreviewImageUrls: string[]
  initialSamplesStatus: SamplesStatus
  initialSampleImageUrls: string[]
  /** Render both surfaces as sub-blocks of the numbered Overview section. */
  nested?: boolean
}) {
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>(initialPreviewStatus)
  const [previewImageUrls, setPreviewImageUrls] = useState<string[]>(initialPreviewImageUrls)
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
        if (json.preview.image_urls.length > 0) setPreviewImageUrls(json.preview.image_urls)
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

  // Adaptive grid for the preview images — 1 photo = full width, 2 = 2-up,
  // 3+ = 3-up on desktop / 2-up on mobile.
  const previewCount = previewImageUrls.length || 1
  const previewCols =
    previewCount === 1 ? 'grid-cols-1' :
    previewCount === 2 ? 'grid-cols-1 sm:grid-cols-2' :
    'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════════
          AI PREVIEW — one image per uploaded customer photo
          ═══════════════════════════════════════════════════════════════ */}
      {showPreviewSection ? (
        <Block nested={nested} number="03" title="AI preview · your room">
          <p className="mt-1 text-xs text-text-dim">
            {previewImageUrls.length > 0
              ? `Generated from the ${previewImageUrls.length === 1 ? 'photo' : `${previewImageUrls.length} photos`} you sent.`
              : 'Generated from the photo you sent.'}
          </p>

          <div className={`mt-4 grid gap-4 ${previewCols}`}>
            {/* If we have any URLs, show one image per URL. Otherwise
                show ONE skeleton placeholder during generation. */}
            {previewImageUrls.length > 0 ? (
              previewImageUrls.map((url, i) => (
                <ClickableImage
                  key={i}
                  src={url}
                  alt={`AI preview ${i + 1} of your room`}
                  label={previewImageUrls.length > 1 ? String(i + 1).padStart(2, '0') : null}
                />
              ))
            ) : (
              <SkeletonTile
                title={isTimeout && previewLoading ? 'Preview taking longer than usual…' : 'Generating your preview…'}
                subtitle={
                  isTimeout && previewLoading
                    ? "We'll have it ready next time you open this page."
                    : 'Editing your photo with the proposed work — usually 15-30s.'
                }
              />
            )}
          </div>

          <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-widest text-text-dim">
            Indicative only · actual install may vary based on access and on-site conditions
          </p>
        </Block>
      ) : null}

      {/* ═══════════════════════════════════════════════════════════════
          SAMPLE GALLERY — wide / close-up / in-use
          ═══════════════════════════════════════════════════════════════ */}
      {showSamplesSection ? (
        <Block
          nested={nested}
          number={showPreviewSection ? '04' : '03'}
          title="Expected sample images"
          // Card mode stacks two sections; nested mode gets its gap from the
          // Overview grid, so the margin would double the spacing.
          sectionClass="mt-6"
        >
          <p className="mt-1 text-xs text-text-dim">
            Three views of the proposed install — wide, close-up, and in-use.
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map(i => {
              const url = sampleImageUrls[i]
              const labels = ['Wide view', 'Close-up', 'In use']
              return (
                <figure key={i} className="m-0">
                  {url ? (
                    <ClickableImage
                      src={url}
                      alt={`AI sample — ${labels[i].toLowerCase()}`}
                    />
                  ) : (
                    <div className="relative aspect-4/3 w-full overflow-hidden border border-ink-line bg-ink-deep">
                      <SkeletonTile
                        title={isTimeout && samplesLoading ? 'Sample pending…' : `Generating ${labels[i].toLowerCase()}…`}
                        subtitle={null}
                        small
                      />
                    </div>
                  )}
                  <figcaption className="mt-2 text-center font-mono text-[0.65rem] uppercase tracking-widest text-text-sec">
                    {labels[i]}
                  </figcaption>
                </figure>
              )
            })}
          </div>

          <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-widest text-text-dim">
            AI-generated · illustrative · final install matched to your space
          </p>
        </Block>
      ) : null}
    </>
  )
}

/**
 * One surface's chrome. Card mode is the legacy long-scroll layout (its own
 * numbered card); nested mode is a sub-block of the numbered Overview section,
 * where the digits belong to the parent <Scope> and repeating them here would
 * give the page two "03"s.
 */
function Block({
  nested,
  number,
  title,
  sectionClass = '',
  children,
}: {
  nested: boolean
  number: string
  title: string
  sectionClass?: string
  children: React.ReactNode
}) {
  if (nested) {
    return (
      <div>
        <h3 className="font-mono text-[0.7rem] font-bold uppercase tracking-[0.14em] text-text-pri">
          {title}
        </h3>
        {children}
      </div>
    )
  }
  return (
    <section className={`bg-ink-card border border-ink-line p-6 sm:p-8 ${sectionClass}`}>
      <div className="flex items-start gap-5 sm:gap-6">
        <span className="font-mono text-3xl sm:text-4xl font-bold text-accent leading-none shrink-0">
          {number}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-text-pri font-extrabold uppercase tracking-tight text-base sm:text-lg">
            {title}
          </h2>
          {children}
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════
   Components
   ═══════════════════════════════════════════════════════════════════ */

function ClickableImage({
  src,
  alt,
  label,
}: {
  src: string
  alt: string
  label?: string | null
}) {
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="group relative block aspect-4/3 w-full overflow-hidden border border-ink-line bg-ink-deep transition-all hover:border-accent/60"
      aria-label={`${alt} — tap to view full size`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
      />

      {/* Optional numeric chip in the corner */}
      {label ? (
        <span className="absolute top-2 right-2 font-mono text-[0.55rem] uppercase tracking-widest bg-ink-deep/90 text-text-pri px-1.5 py-0.5 rounded-sm border border-ink-line">
          {label}
        </span>
      ) : null}

      {/* Hover hint — "tap to expand" */}
      <span className="absolute bottom-2 right-2 flex items-center gap-1 font-mono text-[0.55rem] uppercase tracking-widest bg-ink-deep/90 text-text-pri px-1.5 py-1 rounded-sm border border-ink-line opacity-0 group-hover:opacity-100 transition-opacity">
        <ExpandIcon className="w-3 h-3" />
        View full
      </span>
    </a>
  )
}

function SkeletonTile({
  title,
  subtitle,
  small = false,
}: {
  title: string
  subtitle: string | null
  small?: boolean
}) {
  return (
    <div className={`relative ${small ? '' : 'aspect-4/3'} w-full overflow-hidden border border-ink-line bg-ink-deep`}>
      <div className="absolute inset-0 animate-pulse bg-linear-to-br from-ink-deep via-ink to-ink-card" aria-hidden />
      <div className="relative flex min-h-32 h-full flex-col items-center justify-center gap-3 px-4 text-text-sec">
        <SparkleIcon size={small ? 24 : 36} className="text-accent" />
        <span className={`${small ? 'text-xs' : 'text-sm'} font-medium text-center text-text-pri`}>{title}</span>
        {subtitle ? <span className="text-xs text-text-dim text-center max-w-xs">{subtitle}</span> : null}
      </div>
    </div>
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

function ExpandIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}
