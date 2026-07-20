'use client'

// Dashboard → Videos tab (spec tradie-trust-video-generation R4).
//
// The tradie's two customer-facing trust videos, side by side: the welcome
// video (customer quote page, section "Your tradie") and the thank-you video
// (post-booking page). Each slot shows the current video (the tenant's
// AI-generated/own film, else the QuoteMax default), a script box prefilled
// with the account's default line, and a Generate button that kicks Veo via
// POST /api/tenant/videos/generate. Status is polled through
// GET /api/tenant/videos, which doubles as the resume backstop for jobs cut
// off by a serverless timeout.
//
// All requests carry `Authorization: Bearer <token>` minted fresh per request
// (getAuthToken) — the same auth contract as every other tab.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Video, ImagePlus } from 'lucide-react'
import { StatusPill, type Tone } from './quote-ui'
import { getAuthToken } from '@/lib/auth/client-token'

// Mirrors MAX_SCRIPT_CHARS in lib/videos/trust-video.ts (kept local so this
// client bundle does not pull the server-side Veo module).
const MAX_SCRIPT_CHARS = 220

type SlotKey = 'welcome' | 'thankyou'

type SlotInfo = {
  url: string | null
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

type VideosPayload = {
  ok: boolean
  business_name: string | null
  contact_name: string | null
  slots: Record<SlotKey, SlotInfo>
}

const SLOT_META: Record<SlotKey, { title: string; where: string }> = {
  welcome: {
    title: 'Welcome video',
    where: 'Plays on the customer quote page, in the "Your tradie" section.',
  },
  thankyou: {
    title: 'Thank you video',
    where: 'Plays after the customer books their site visit.',
  },
}

function statusPill(slot: SlotInfo) {
  const s = slot.state.status
  if (s === 'generating') return <StatusPill label="Generating" tone="accent" dot compact />
  if (s === 'failed') return <StatusPill label="Failed" tone="danger" dot compact />
  if (!slot.using_default) return <StatusPill label="Your video" tone={'success' as Tone} dot compact />
  return <StatusPill label="QuoteMax default" tone="dim" dot compact />
}

export function VideosTab({ accessToken }: { accessToken: string | null }) {
  const [data, setData] = useState<VideosPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Editable fields — seeded from the payload once, then owned by the tradie.
  const [scripts, setScripts] = useState<Record<SlotKey, string>>({ welcome: '', thankyou: '' })
  const [contactName, setContactName] = useState('')
  const [details, setDetails] = useState('')
  const seededRef = useRef(false)

  const [submitting, setSubmitting] = useState<SlotKey | 'both' | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const ownerPhotoRef = useRef<HTMLInputElement>(null)
  const extraImagesRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!accessToken) return
    try {
      // Mint a FRESH token per request — the token captured at mount expires.
      const token = (await getAuthToken()) ?? accessToken
      const res = await fetch('/api/tenant/videos', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const json = (await res.json()) as VideosPayload
      setData(json)
      setError(null)
      if (!seededRef.current) {
        seededRef.current = true
        setScripts({
          welcome: json.slots.welcome.state.script ?? json.slots.welcome.default_script,
          thankyou: json.slots.thankyou.state.script ?? json.slots.thankyou.default_script,
        })
        setContactName(json.contact_name ?? '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your videos')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void load()
  }, [load])

  // Poll while any slot is generating — GET doubles as the resume backstop.
  const generating =
    data?.slots.welcome.state.status === 'generating' ||
    data?.slots.thankyou.state.status === 'generating'
  useEffect(() => {
    if (!generating) return
    const t = setInterval(() => void load(), 8000)
    return () => clearInterval(t)
  }, [generating, load])

  async function generate(slot: SlotKey | 'both') {
    if (!accessToken || submitting) return
    setSubmitting(slot)
    setSubmitError(null)
    try {
      const token = (await getAuthToken()) ?? accessToken
      const form = new FormData()
      form.set('slot', slot)
      const slots: SlotKey[] = slot === 'both' ? ['welcome', 'thankyou'] : [slot]
      for (const s of slots) form.set(`script_${s}`, scripts[s] ?? '')
      if (contactName.trim()) form.set('contact_name', contactName.trim())
      if (details.trim()) form.set('details', details.trim())
      const photo = ownerPhotoRef.current?.files?.[0]
      if (photo) form.set('owner_photo', photo)
      for (const f of Array.from(extraImagesRef.current?.files ?? [])) {
        form.append('extra_image', f)
      }
      const res = await fetch('/api/tenant/videos/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `status ${res.status}`)
      // Optimistic: mark the kicked slots generating so polling starts now.
      setData((prev) => {
        if (!prev) return prev
        const next = structuredClone(prev)
        for (const s of slots) next.slots[s].state = { ...next.slots[s].state, status: 'generating', error: null }
        return next
      })
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not start generation')
    } finally {
      setSubmitting(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-text-dim">
        <Loader2 size={15} className="animate-spin" /> Loading your videos…
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="max-w-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-text-pri">
        Could not load your videos right now. Refresh to try again.
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <h2 className="font-extrabold uppercase tracking-tight text-text-pri text-xl">Videos</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-sec">
        Your welcome and thank-you videos are generated with AI from your business
        name, contact name and logo, and shown to customers on your quote pages.
        Adjust the script for each video, add a photo of yourself if you like, and
        regenerate any time. Until you generate one, customers see the QuoteMax
        default.
      </p>

      {/* ── shared business details ─────────────────────────────── */}
      <div className="rounded-card mt-6 border border-ink-line bg-ink-card p-5">
        <div className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-text-dim">
          Business details used in both videos
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-text-sec">
            Your name (spoken in the intro)
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="e.g. Bob"
              className="rounded-ctl mt-1.5 w-full border border-ink-line bg-ink-deep px-3 py-2.5 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
          </label>
          <label className="text-xs text-text-sec">
            Extra details (woven into the scene)
            <input
              type="text"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="e.g. family business, 20 years in Brisbane"
              className="rounded-ctl mt-1.5 w-full border border-ink-line bg-ink-deep px-3 py-2.5 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
          </label>
          <label className="text-xs text-text-sec">
            Photo of you (optional, guides the presenter)
            <input
              ref={ownerPhotoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="mt-1.5 block w-full text-xs text-text-sec file:mr-3 file:cursor-pointer file:border file:border-ink-line file:bg-ink-deep file:px-3 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-wider file:text-text-pri"
            />
          </label>
          <label className="text-xs text-text-sec">
            Extra photos (optional, e.g. your ute or finished jobs)
            <input
              ref={extraImagesRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="mt-1.5 block w-full text-xs text-text-sec file:mr-3 file:cursor-pointer file:border file:border-ink-line file:bg-ink-deep file:px-3 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-wider file:text-text-pri"
            />
          </label>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-text-dim">
          Without a photo, your logo from the account is used so the branding on
          the vehicle and workwear matches your business.
        </p>
      </div>

      {submitError && (
        <div className="mt-4 border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-text-pri">
          {submitError}
        </div>
      )}

      {/* ── the two slots ───────────────────────────────────────── */}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {(['welcome', 'thankyou'] as const).map((key) => {
          const slot = data.slots[key]
          const meta = SLOT_META[key]
          const busy = slot.state.status === 'generating' || submitting === key || submitting === 'both'
          return (
            <section key={key} className="rounded-card border border-ink-line bg-ink-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-tight text-text-pri">
                  <Video size={15} className="text-text-dim" aria-hidden="true" />
                  {meta.title}
                </h3>
                {statusPill(slot)}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-text-dim">{meta.where}</p>

              <div className="mt-4 overflow-hidden border border-ink-line bg-ink-deep">
                <video
                  key={slot.effective_url}
                  src={slot.effective_url}
                  controls
                  preload="metadata"
                  playsInline
                  className="aspect-video w-full"
                />
              </div>

              {slot.state.status === 'generating' && (
                <div className="mt-3 flex items-center gap-2 text-xs text-text-sec">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                  Generating your video. This takes a few minutes; you can leave
                  this page and come back.
                </div>
              )}
              {slot.state.status === 'failed' && slot.state.error && (
                <div className="mt-3 border border-danger/50 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-text-pri">
                  Generation failed: {slot.state.error}
                </div>
              )}
              {slot.state.note && (
                <div className="mt-3 text-xs leading-relaxed text-text-dim">{slot.state.note}</div>
              )}

              <label className="mt-4 block text-xs text-text-sec">
                What you say in this video
                <textarea
                  value={scripts[key]}
                  onChange={(e) => setScripts((p) => ({ ...p, [key]: e.target.value }))}
                  rows={4}
                  maxLength={MAX_SCRIPT_CHARS}
                  className="rounded-ctl mt-1.5 w-full border border-ink-line bg-ink-deep px-3 py-2.5 text-sm leading-relaxed text-text-pri focus:border-accent focus:outline-none"
                />
                <span className="mt-1 block text-right font-mono text-[0.58rem] text-text-dim">
                  {scripts[key].length}/{MAX_SCRIPT_CHARS}
                </span>
              </label>

              <button
                type="button"
                onClick={() => void generate(key)}
                disabled={busy || !accessToken}
                className="rounded-ctl mt-2 inline-flex items-center gap-2 bg-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw size={13} aria-hidden="true" />
                )}
                {slot.state.status === 'failed'
                  ? 'Retry'
                  : slot.using_default
                    ? 'Generate my video'
                    : 'Regenerate'}
              </button>
            </section>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => void generate('both')}
        disabled={!!submitting || generating || !accessToken}
        className="rounded-ctl mt-5 inline-flex items-center gap-2 border border-ink-line bg-ink-card px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-accent disabled:opacity-50"
      >
        {submitting === 'both' ? (
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        ) : (
          <ImagePlus size={13} aria-hidden="true" />
        )}
        Generate both videos
      </button>
    </div>
  )
}
