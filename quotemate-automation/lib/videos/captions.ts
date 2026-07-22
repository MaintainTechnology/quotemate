// lib/videos/captions.ts
//
// PURE — caption cues for the two customer-facing trust videos.
//
// The words are never invented. Every tenant video is generated FROM a script
// (lib/videos/trust-video), and that script is persisted next to the video —
// tenants.trade_videos[trade][slot].script, or the legacy
// trust_video_state[slot].script. So captions are the script, chunked.
//
// The two QuoteMax DEFAULT videos are not script-generated (they are produced
// clips, 37s + 26s), so they ship a transcribed track in public/captions and
// are matched here by URL. Anything else — a video whose spoken words we do
// not know — gets NO track: silence beats captions that contradict the audio.

import { TRUST_VIDEO_DEFAULT_PATHS } from '@/lib/quote/tenant-identity'

export type CaptionCue = { start: number; end: number; text: string }

/** One readable line. ~42 chars is the BBC/Netflix subtitle line length. */
export const CAPTION_LINE_CHARS = 42

/** Veo 3.1 clips are 8 seconds — the whole reason scripts are capped at 220
 *  chars (MAX_SCRIPT_CHARS). ponytail: the cue timings below are spread
 *  proportionally across this window rather than measured from the audio; if a
 *  future engine emits variable-length clips, transcribe at generation time
 *  and store real timings instead. */
export const TRUST_VIDEO_CLIP_SECONDS = 8

const round = (n: number) => Math.round(n * 1000) / 1000

/** The spoken script, chunked into cues spread across the clip. Longer chunks
 *  get proportionally more time on screen, which tracks speech rate closely
 *  enough for an 8-second read. */
export function scriptCues(
  script: string | null | undefined,
  durationSec: number = TRUST_VIDEO_CLIP_SECONDS,
): CaptionCue[] {
  const clean = (script ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return []

  const chunks: string[] = []
  let line = ''
  for (const word of clean.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && next.length > CAPTION_LINE_CHARS) {
      chunks.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) chunks.push(line)

  const chars = chunks.reduce((n, c) => n + c.length, 0)
  let start = 0
  return chunks.map((text, i) => {
    const end = i === chunks.length - 1 ? durationSec : round(start + (durationSec * text.length) / chars)
    const cue = { start, end, text }
    start = end
    return cue
  })
}

const stamp = (s: number) => {
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  const ms = String(Math.round((s % 1) * 1000)).padStart(3, '0')
  return `${h}:${m}:${sec}.${ms}`
}

export function toVtt(cues: CaptionCue[]): string {
  const body = cues.map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n')
  return `WEBVTT\n\n${body}\n`
}

/** The shipped transcript for a QuoteMax default video, else null. */
function defaultTrackSrc(videoUrl: string): string | null {
  for (const path of Object.values(TRUST_VIDEO_DEFAULT_PATHS)) {
    if (videoUrl.endsWith(path)) return `/captions/${path.split('/').pop()!.replace(/\.mp4$/, '.vtt')}`
  }
  return null
}

/**
 * Where the `<track>` on a trust video points, or null when we do not know
 * what the video says. Same-origin in both cases: a cross-origin track needs
 * CORS + crossorigin on the <video>, and a data: URI track is unreliable in
 * Safari — which is most of this audience.
 */
export function captionTrackSrc(
  videoUrl: string | null | undefined,
  script: string | null | undefined,
): string | null {
  if (!videoUrl?.trim()) return null
  const spoken = (script ?? '').replace(/\s+/g, ' ').trim()
  if (spoken) return `/api/captions?s=${encodeURIComponent(spoken)}`
  return defaultTrackSrc(videoUrl.trim())
}
