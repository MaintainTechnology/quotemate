'use client'

// Dashboard → Videos tab (spec tradie-trust-video-generation R4).
//
// A production studio for the two customer-facing trust videos. Layout: the
// shared brand direction sits in a full-width panel on top; the two scenes
// (welcome + thank-you) render side by side beneath it so the tradie sees
// both at once. Data/generation contract stays small — GET polls and resumes
// jobs; POST starts one or both scenes with the shared inputs.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Building2,
  Clapperboard,
  Clock3,
  Images,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  Upload,
  UserRound,
  Video,
} from 'lucide-react'
import { StatusPill } from './quote-ui'
import { getAuthToken } from '@/lib/auth/client-token'

// Mirrors MAX_SCRIPT_CHARS in lib/videos/trust-video.ts (kept local so this
// client bundle does not pull the server-side Veo module).
const MAX_SCRIPT_CHARS = 220

type SlotKey = 'welcome' | 'thankyou'

type SlotInfo = {
  effective_url: string
  using_default: boolean
  default_script: string
  state: {
    status: 'idle' | 'generating' | 'ready' | 'failed'
    script?: string | null
    error?: string | null
    note?: string | null
    updated_at?: string
  }
}

type TradeOption = { slug: string; label: string }

type VideosPayload = {
  ok: boolean
  business_name: string | null
  contact_name: string | null
  /** The trade this payload describes (null = the legacy tenant-wide pair). */
  trade: string | null
  /** Trades the tenant has switched on — one sub-tab each. */
  trades: TradeOption[]
  slots: Record<SlotKey, SlotInfo>
}

const SLOT_META: Record<
  SlotKey,
  { scene: string; title: string; placement: string; where: string }
> = {
  welcome: {
    scene: 'Scene 01',
    title: 'Welcome Video',
    placement: 'Customer quote page',
    where: 'Appears in the “Your tradie” section while customers review your quote.',
  },
  thankyou: {
    scene: 'Scene 02',
    title: 'Thank-You Video',
    placement: 'Booking confirmation',
    where: 'Appears after a customer books their site visit.',
  },
}

const UPDATED_AT = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatUpdatedAt(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : UPDATED_AT.format(date)
}

/** Veo's safety filter blocks scripts that speak a real person's name
 *  (observed live). Warn before the tradie spends a generation on it. */
function nameInScript(script: string, contactName: string): string | null {
  const name = contactName.trim()
  if (!name) return null
  for (const token of name.split(/\s+/)) {
    if (token.length < 2) continue
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (re.test(script)) return name
  }
  return null
}

function statusPill(slot: SlotInfo) {
  const status = slot.state.status
  if (status === 'generating') return <StatusPill label="Generating" tone="accent" dot compact />
  if (status === 'failed') return <StatusPill label="Failed" tone="danger" dot compact />
  if (!slot.using_default) return <StatusPill label="Your Video" tone="success" dot compact />
  return <StatusPill label="QuoteMax Default" tone="dim" dot compact />
}

function VideoStudioSkeleton() {
  return (
    <div className="max-w-[80rem]" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading Video Studio…</span>
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="qm-shimmer h-3 w-40 rounded-full" />
          <div className="qm-shimmer mt-4 h-9 w-72 max-w-full rounded-ctl" />
          <div className="qm-shimmer mt-3 h-4 w-[34rem] max-w-full rounded-full" />
        </div>
        <div className="qm-shimmer h-11 w-40 rounded-ctl" />
      </div>
      <div className="rounded-card edge-lit border border-ink-line bg-ink-card p-5 sm:p-6">
        <div className="qm-shimmer h-4 w-40 rounded-full" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="qm-shimmer h-11 rounded-ctl" />
          <div className="qm-shimmer h-11 rounded-ctl" />
          <div className="qm-shimmer h-11 rounded-ctl" />
          <div className="qm-shimmer h-11 rounded-ctl" />
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {(['welcome', 'thankyou'] as const).map((key) => (
          <div
            key={key}
            className="overflow-hidden rounded-card edge-lit border border-ink-line bg-ink-card"
          >
            <div className="p-5">
              <div className="qm-shimmer h-4 w-24 rounded-full" />
              <div className="qm-shimmer mt-3 h-6 w-48 rounded-full" />
              <div className="qm-shimmer mt-5 aspect-video w-full rounded-ctl" />
              <div className="qm-shimmer mt-5 h-28 rounded-ctl" />
              <div className="qm-shimmer mt-4 h-11 rounded-ctl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function VideosTab({ accessToken }: { accessToken: string | null }) {
  const [data, setData] = useState<VideosPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Editable fields are seeded from the payload once, then owned locally so
  // background status polling cannot overwrite work in progress.
  const [scripts, setScripts] = useState<Record<SlotKey, string>>({ welcome: '', thankyou: '' })
  const [contactName, setContactName] = useState('')
  const [details, setDetails] = useState('')
  const [ownerPhotoName, setOwnerPhotoName] = useState<string | null>(null)
  const [extraImageNames, setExtraImageNames] = useState<string[]>([])
  // Which trade's pair is being edited. null = let the server pick the first.
  const [trade, setTrade] = useState<string | null>(null)
  // Scripts are seeded per TRADE (not once): switching tabs must load that
  // trade's scripts, but polling within a tab must never clobber typing.
  const seededTradeRef = useRef<string | null | undefined>(undefined)

  const [submitting, setSubmitting] = useState<SlotKey | 'both' | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const ownerPhotoRef = useRef<HTMLInputElement>(null)
  const extraImagesRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!accessToken) {
      // No token = the skeleton would spin forever; surface the retry card.
      setLoading(false)
      setError('Your session is not ready. Refresh the page and sign in again.')
      return
    }
    try {
      // Mint a fresh token per request because the token captured at mount expires.
      const token = (await getAuthToken()) ?? accessToken
      const res = await fetch(
        trade ? `/api/tenant/videos?trade=${encodeURIComponent(trade)}` : '/api/tenant/videos',
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`The server returned HTTP ${res.status}.`)
      const json = (await res.json()) as VideosPayload
      setData(json)
      setError(null)
      // Adopt the server's choice on first load so the tab highlights.
      if (trade === null && json.trade) setTrade(json.trade)
      if (seededTradeRef.current !== json.trade) {
        seededTradeRef.current = json.trade
        setScripts({
          welcome: json.slots.welcome.state.script ?? json.slots.welcome.default_script,
          thankyou: json.slots.thankyou.state.script ?? json.slots.thankyou.default_script,
        })
        setContactName(json.contact_name ?? '')
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The request could not be completed.')
    } finally {
      setLoading(false)
    }
  }, [accessToken, trade])

  useEffect(() => {
    // Defer the first request to the subscription callback so the effect does
    // not synchronously cascade state updates during React's commit phase.
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  // GET also resumes any Veo operation interrupted by a serverless timeout.
  const generating =
    data?.slots.welcome.state.status === 'generating' ||
    data?.slots.thankyou.state.status === 'generating'
  const studioBusy = Boolean(submitting || generating)

  useEffect(() => {
    if (!generating) return
    const timer = setInterval(() => void load(), 8000)
    return () => clearInterval(timer)
  }, [generating, load])

  async function generate(slot: SlotKey | 'both') {
    // A whole-tenant lock mirrors the backend's one-generation-at-a-time cost
    // discipline and prevents the second scene starting in another click.
    if (!accessToken || studioBusy) return
    setSubmitting(slot)
    setSubmitError(null)
    try {
      const token = (await getAuthToken()) ?? accessToken
      const form = new FormData()
      form.set('slot', slot)
      if (trade) form.set('trade', trade)
      const slots: SlotKey[] = slot === 'both' ? ['welcome', 'thankyou'] : [slot]
      for (const scene of slots) form.set(`script_${scene}`, scripts[scene] ?? '')
      if (contactName.trim()) form.set('contact_name', contactName.trim())
      if (details.trim()) form.set('details', details.trim())
      const photo = ownerPhotoRef.current?.files?.[0]
      if (photo) form.set('owner_photo', photo)
      for (const file of Array.from(extraImagesRef.current?.files ?? [])) {
        form.append('extra_image', file)
      }
      const res = await fetch('/api/tenant/videos/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `The server returned HTTP ${res.status}.`)
      // The kick-off consumed the photos — clear the inputs so a later
      // regeneration doesn't silently re-send stale files.
      if (ownerPhotoRef.current) ownerPhotoRef.current.value = ''
      if (extraImagesRef.current) extraImagesRef.current.value = ''
      setOwnerPhotoName(null)
      setExtraImageNames([])
      // Optimistic state starts polling immediately while the deferred job runs.
      setData((previous) => {
        if (!previous) return previous
        const next = structuredClone(previous)
        for (const scene of slots) {
          next.slots[scene].state = {
            ...next.slots[scene].state,
            status: 'generating',
            error: null,
          }
        }
        return next
      })
    } catch (generationError) {
      setSubmitError(
        generationError instanceof Error
          ? generationError.message
          : 'Generation could not be started. Try again.',
      )
    } finally {
      setSubmitting(null)
    }
  }

  function retryLoad() {
    setError(null)
    setLoading(true)
    void load()
  }

  if (loading) return <VideoStudioSkeleton />

  // Full-screen failure only when there is nothing to show — a transient
  // polling error on loaded data renders as an inline notice instead.
  if (!data) {
    return (
      <div className="max-w-[80rem]">
        <header className="mb-7">
          <div className="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-accent">
            <Clapperboard size={15} strokeWidth={1.8} aria-hidden="true" />
            QuoteMax · Video Studio
          </div>
          <h1 className="mt-3 text-balance text-[clamp(1.75rem,3vw,2.4rem)] font-extrabold leading-[1.08] tracking-[-0.035em] text-text-pri">
            Customer Video Studio
          </h1>
        </header>
        <section
          className="max-w-2xl rounded-card edge-lit border border-danger/50 bg-danger/10 p-5 sm:p-6"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 shrink-0 text-danger-bright" size={20} aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-text-pri">Video Studio Couldn’t Load</h2>
              <p className="mt-1 max-w-[65ch] break-words text-sm leading-relaxed text-text-sec">
                {error ?? 'The video data was unavailable.'} Check your connection, then try again.
              </p>
              <button
                type="button"
                onClick={retryLoad}
                disabled={!accessToken}
                className="mt-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-ctl border border-ink-line bg-ink-card px-4 py-2.5 text-sm font-bold text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw size={16} aria-hidden="true" />
                Retry
              </button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  const customSceneCount = (['welcome', 'thankyou'] as const).filter(
    (key) => !data.slots[key].using_default,
  ).length
  const extraImagesLabel =
    extraImageNames.length === 0
      ? 'Choose Job Photos'
      : extraImageNames.length === 1
        ? extraImageNames[0]
        : `${extraImageNames.length} photos selected`
  const extraImagesDetail =
    extraImageNames.length > 1
      ? `${extraImageNames[0]} + ${extraImageNames.length - 1} more`
      : extraImageNames[0] ?? null

  return (
    <div className="max-w-[80rem]">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {submitting
          ? 'Starting video generation…'
          : generating
            ? 'Video generation is in progress…'
            : 'Video Studio is ready.'}
      </div>

      <header className="mb-7 flex flex-col gap-5 motion-safe:animate-[fade-up_260ms_ease-out_both] sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-accent">
            <Clapperboard size={15} strokeWidth={1.8} aria-hidden="true" />
            QuoteMax · Video Studio
          </div>
          <h1 className="mt-3 text-balance text-[clamp(1.75rem,3vw,2.4rem)] font-extrabold leading-[1.08] tracking-[-0.035em] text-text-pri">
            Customer Video Studio
          </h1>
          <p className="mt-3 max-w-[65ch] text-pretty text-sm leading-relaxed text-text-sec sm:text-base">
            Create the two branded scenes customers see while they review and book your quote.
            Set the shared direction once, then generate either scene.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
          <div className="inline-flex min-h-11 items-center gap-2 rounded-ctl border border-ink-line bg-ink-card px-3.5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.1em] text-text-sec">
            <span
              className={`h-2 w-2 rounded-full ${studioBusy ? 'bg-accent motion-safe:animate-pulse' : 'bg-success-bright'}`}
              aria-hidden="true"
            />
            {studioBusy ? 'Studio Busy' : `${customSceneCount} of 2 Live`}
          </div>
          <button
            type="button"
            onClick={() => void generate('both')}
            disabled={studioBusy || !accessToken}
            aria-busy={submitting === 'both' || generating}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-ctl bg-accent px-5 py-2.5 text-sm font-extrabold text-accent-ink transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting === 'both' || generating ? (
              <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles size={16} aria-hidden="true" />
            )}
            {submitting === 'both'
              ? 'Starting Both…'
              : generating
                ? 'Generation in Progress'
                : 'Generate Both'}
          </button>
        </div>
      </header>

      {submitError && (
        <div
          className="mb-6 flex items-start gap-3 rounded-ctl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-text-pri"
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle className="mt-0.5 shrink-0 text-danger-bright" size={18} aria-hidden="true" />
          <p className="max-w-[65ch] break-words leading-relaxed">
            Generation couldn’t start. {submitError} Check the inputs, then try again.
          </p>
        </div>
      )}

      {/* ── Trade sub-tabs — one per trade the tradie has switched on ───────
          Each trade keeps its OWN welcome + thank-you pair; the cards below
          always edit the selected trade. Hidden for a single-trade tradie,
          who has nothing to switch between. ── */}
      {data.trades.length > 1 && (
        <div
          className="mb-6 flex flex-wrap gap-2"
          role="tablist"
          aria-label="Choose a trade"
        >
          {data.trades.map((t) => {
            const active = t.slug === data.trade
            return (
              <button
                key={t.slug}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={studioBusy && !active}
                onClick={() => {
                  if (t.slug === trade) return
                  setTrade(t.slug)
                  setLoading(true)
                }}
                className={`rounded-ctl border px-4 py-2 text-sm font-bold tracking-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active
                    ? 'border-accent bg-accent text-ink-deep'
                    : 'border-ink-line bg-ink-card text-text-sec hover:border-accent/60'
                } ${studioBusy && !active ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Shared direction — full-width, applied to both scenes ────────── */}
      <section
        className="rounded-card edge-lit border border-ink-line bg-ink-card p-5 sm:p-6 motion-safe:animate-[fade-up_300ms_ease-out_both]"
        aria-labelledby="brand-inputs-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl border border-ink-line bg-ink-deep text-accent">
              <Building2 size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="brand-inputs-heading" className="text-base font-bold text-text-pri">
                Shared Direction
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-text-dim">Applied to both scenes below.</p>
            </div>
          </div>
          <dl className="rounded-ctl border border-ink-line bg-ink-deep px-3.5 py-2">
            <dt className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-text-dim">
              Business
            </dt>
            <dd className="mt-0.5 break-words text-sm font-bold text-text-pri" translate="no">
              {data.business_name?.trim() || 'Not set'}
            </dd>
          </dl>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {/* Presenter name */}
          <div>
            <label htmlFor="video-contact-name" className="block text-sm font-semibold text-text-pri">
              Presenter Name
            </label>
            <p id="video-contact-name-help" className="mt-1 text-xs leading-relaxed text-text-dim">
              Used to shape the presenter and default script.
            </p>
            <input
              id="video-contact-name"
              name="contact_name"
              type="text"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              placeholder="e.g. Bob…"
              autoComplete="name"
              aria-describedby="video-contact-name-help"
              className="mt-2 min-h-11 w-full rounded-ctl border border-ink-line bg-ink-deep px-3 py-2.5 text-base text-text-pri placeholder:text-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 sm:text-sm"
            />
          </div>

          {/* Business context */}
          <div>
            <label htmlFor="video-business-details" className="block text-sm font-semibold text-text-pri">
              Business Context
            </label>
            <p id="video-business-details-help" className="mt-1 text-xs leading-relaxed text-text-dim">
              A short detail the AI can weave into the scene.
            </p>
            <input
              id="video-business-details"
              name="video_details"
              type="text"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="e.g. Family business, 20 years in Brisbane…"
              autoComplete="off"
              aria-describedby="video-business-details-help"
              className="mt-2 min-h-11 w-full rounded-ctl border border-ink-line bg-ink-deep px-3 py-2.5 text-base text-text-pri placeholder:text-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 sm:text-sm"
            />
          </div>

          {/* Presenter portrait */}
          <div>
            <div className="flex items-center gap-2">
              <UserRound size={16} className="text-text-dim" aria-hidden="true" />
              <span className="text-sm font-semibold text-text-pri">Presenter Portrait</span>
            </div>
            <p id="owner-photo-help" className="mt-1 text-xs leading-relaxed text-text-dim">
              Optional · PNG, JPEG or WebP · 7&nbsp;MB max. Your account logo is the fallback.
            </p>
            <input
              ref={ownerPhotoRef}
              id="video-owner-photo"
              name="owner_photo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-describedby="owner-photo-help owner-photo-selection"
              onChange={(event) => setOwnerPhotoName(event.currentTarget.files?.[0]?.name ?? null)}
              className="peer sr-only"
            />
            <label
              htmlFor="video-owner-photo"
              className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-ctl border border-dashed border-ink-line bg-ink-deep px-3 py-2.5 transition-colors hover:border-accent hover:bg-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent-soft peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ink-card"
            >
              <Upload size={16} className="shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-pri">
                {ownerPhotoName ?? 'Choose Portrait'}
              </span>
              <span className="shrink-0 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-text-dim">
                {ownerPhotoName ? '1 Selected' : 'Browse'}
              </span>
            </label>
            <p id="owner-photo-selection" className="mt-1.5 truncate text-xs text-text-dim" aria-live="polite">
              {ownerPhotoName ?? 'Optional. Your account logo is the fallback.'}
            </p>
          </div>

          {/* Reference photos */}
          <div>
            <div className="flex items-center gap-2">
              <Images size={16} className="text-text-dim" aria-hidden="true" />
              <span className="text-sm font-semibold text-text-pri">Reference Photos</span>
            </div>
            <p id="extra-images-help" className="mt-1 text-xs leading-relaxed text-text-dim">
              Ute or finished-job photos · 7&nbsp;MB each.
            </p>
            <input
              ref={extraImagesRef}
              id="video-extra-images"
              name="extra_image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              aria-describedby="extra-images-help extra-images-selection"
              onChange={(event) =>
                setExtraImageNames(Array.from(event.currentTarget.files ?? []).map((file) => file.name))
              }
              className="peer sr-only"
            />
            <label
              htmlFor="video-extra-images"
              className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-ctl border border-dashed border-ink-line bg-ink-deep px-3 py-2.5 transition-colors hover:border-accent hover:bg-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent-soft peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ink-card"
            >
              <Upload size={16} className="shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-pri">
                {extraImagesLabel}
              </span>
              <span className="shrink-0 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-text-dim">
                {extraImageNames.length > 0 ? `${extraImageNames.length} Selected` : 'Browse'}
              </span>
            </label>
            <p id="extra-images-selection" className="mt-1.5 truncate text-xs text-text-dim" aria-live="polite">
              {extraImagesDetail ?? 'Optional. Select one or more references.'}
            </p>
          </div>
        </div>

        <p className="mt-5 border-t border-ink-line pt-4 text-xs leading-relaxed text-text-dim">
          Without a portrait, QuoteMax uses your account logo to guide the vehicle and workwear branding.
          The AI cannot speak real people’s names — videos speak as your business.
        </p>
      </section>

      {/* ── The two scenes, side by side ───────────────────────────────── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {(['welcome', 'thankyou'] as const).map((key) => {
          const slot = data.slots[key]
          const meta = SLOT_META[key]
          const sceneBusy =
            slot.state.status === 'generating' || submitting === key || submitting === 'both'
          const namedPerson = nameInScript(scripts[key], contactName)
          const updatedAt = formatUpdatedAt(slot.state.updated_at)
          const counterWarning = scripts[key].length >= MAX_SCRIPT_CHARS * 0.9
          const actionLabel = sceneBusy
            ? slot.state.status === 'generating'
              ? 'Generating…'
              : 'Starting…'
            : slot.state.status === 'failed'
              ? 'Retry Scene'
              : slot.using_default
                ? 'Generate Scene'
                : 'Regenerate Scene'

          return (
            <article
              key={key}
              className="min-w-0 overflow-hidden rounded-card edge-lit border border-ink-line bg-ink-card motion-safe:animate-[fade-up_340ms_ease-out_both]"
              aria-labelledby={`${key}-scene-title`}
              aria-busy={sceneBusy}
            >
              <header className="border-b border-ink-line px-4 py-4 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-accent">
                      {meta.scene}
                    </div>
                    <h3
                      id={`${key}-scene-title`}
                      className="mt-1 text-lg font-extrabold tracking-[-0.02em] text-text-pri"
                    >
                      {meta.title}
                    </h3>
                  </div>
                  <div className="shrink-0">
                    {statusPill(slot)}
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-2 text-sm text-text-sec">
                  <MapPin size={15} className="mt-0.5 shrink-0 text-text-dim" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="font-semibold text-text-pri">{meta.placement}</span>
                    <span className="text-text-dim"> · {meta.where}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 font-mono text-[0.62rem] tabular-nums text-text-dim">
                  <Clock3 size={13} aria-hidden="true" />
                  {updatedAt ? (
                    <time dateTime={slot.state.updated_at}>Updated {updatedAt}</time>
                  ) : (
                    <span>No generation yet</span>
                  )}
                </div>
              </header>

              <div className="p-4 sm:p-5">
                <div className="overflow-hidden rounded-ctl border border-ink-line bg-black">
                  {slot.effective_url ? (
                    <video
                      key={slot.effective_url}
                      src={slot.effective_url}
                      controls
                      preload="metadata"
                      playsInline
                      aria-label={`${meta.title} preview`}
                      aria-describedby={`${key}-video-context`}
                      className="aspect-video w-full bg-black object-contain"
                    />
                  ) : (
                    <div className="grid aspect-video place-items-center px-6 text-center">
                      <div>
                        <Video className="mx-auto text-text-dim" size={28} aria-hidden="true" />
                        <p className="mt-3 text-sm font-semibold text-text-sec">Preview unavailable</p>
                      </div>
                    </div>
                  )}
                </div>
                <p id={`${key}-video-context`} className="sr-only">
                  Preview for {meta.placement}. The script used for the current generation is available in the disclosure below.
                </p>

                {slot.effective_url && (
                  <details className="mt-3 rounded-ctl border border-ink-line bg-ink-deep">
                    <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-text-sec transition-colors hover:text-text-pri">
                      Script used for this generation
                    </summary>
                    <p className="border-t border-ink-line px-3 py-3 text-sm leading-relaxed text-text-sec">
                      {slot.state.script ?? slot.default_script}
                    </p>
                  </details>
                )}

                <div className="min-h-[2.75rem]">
                  {slot.state.status === 'generating' && (
                    <div className="mt-3 flex items-start gap-2 rounded-ctl border border-accent/30 bg-accent/10 px-3 py-2.5 text-sm text-text-sec">
                      <Loader2 size={15} className="mt-0.5 shrink-0 motion-safe:animate-spin text-accent" aria-hidden="true" />
                      <span>Generating this scene. It usually takes a few minutes.</span>
                    </div>
                  )}
                  {slot.state.status === 'failed' && slot.state.error && (
                    <div className="mt-3 flex items-start gap-2 rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2.5 text-sm leading-relaxed text-text-pri" role="alert">
                      <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger-bright" aria-hidden="true" />
                      <span className="min-w-0 break-words">Generation failed. {slot.state.error}</span>
                    </div>
                  )}
                  {slot.state.note && (
                    <p className="mt-3 rounded-ctl border border-ink-line bg-ink-deep px-3 py-2.5 text-sm leading-relaxed text-text-dim">
                      {slot.state.note}
                    </p>
                  )}
                </div>

                <div className="mt-4">
                  <div className="flex items-end justify-between gap-3">
                    <label htmlFor={`${key}-video-script`} className="text-sm font-bold text-text-pri">
                      Spoken Script
                    </label>
                    <span
                      id={`${key}-script-count`}
                      className={`font-mono text-[0.64rem] tabular-nums ${counterWarning ? 'text-accent' : 'text-text-dim'}`}
                    >
                      {scripts[key].length} / {MAX_SCRIPT_CHARS}
                    </span>
                  </div>
                  <textarea
                    id={`${key}-video-script`}
                    name={`script_${key}`}
                    value={scripts[key]}
                    onChange={(event) =>
                      setScripts((previous) => ({ ...previous, [key]: event.target.value }))
                    }
                    rows={4}
                    maxLength={MAX_SCRIPT_CHARS}
                    autoComplete="off"
                    aria-describedby={`${key}-script-help ${key}-script-count`}
                    placeholder="Write the spoken line for this scene…"
                    className="mt-2 min-h-28 w-full resize-y rounded-ctl border border-ink-line bg-ink-deep px-3 py-3 text-base leading-relaxed text-text-pri placeholder:text-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 sm:text-sm"
                  />
                  <p id={`${key}-script-help`} className="mt-1.5 text-xs leading-relaxed text-text-dim">
                    Keep it natural and concise. The spoken section is approximately 8 seconds.
                  </p>
                </div>

                {namedPerson && (
                  <p
                    className="mt-3 rounded-ctl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm leading-relaxed text-text-sec"
                    role="status"
                    aria-live="polite"
                  >
                    The AI may block a spoken personal name. Remove “{namedPerson}” for a more reliable generation.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void generate(key)}
                  disabled={studioBusy || !accessToken}
                  aria-busy={sceneBusy}
                  title={studioBusy && !sceneBusy ? 'Wait for the current generation to finish' : undefined}
                  className="mt-4 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-ctl border border-ink-line bg-ink-deep px-5 py-2.5 text-sm font-extrabold text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sceneBusy ? (
                    <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw size={16} aria-hidden="true" />
                  )}
                  {actionLabel}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
