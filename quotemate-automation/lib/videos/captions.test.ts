// Captions for the two customer-facing trust videos (welcome + thank-you).
//
// The words are NEVER guessed: they are the script the video was generated
// from (tenants.trade_videos[trade][slot].script, or the legacy
// trust_video_state[slot].script). The QuoteMax default videos are not
// script-generated, so they ship a transcribed .vtt in public/captions and are
// matched by URL here.

import { describe, it, expect } from 'vitest'
import { scriptCues, toVtt, captionTrackSrc, CAPTION_LINE_CHARS } from './captions'

const SCRIPT =
  "G'day, we're Ric Electrical. Thanks for the opportunity to quote. No shortcuts and no surprises, just quality electrical work built to last."

describe('scriptCues — the spoken script, chunked across the clip', () => {
  it('covers the whole clip: starts at zero, ends on the last frame of speech', () => {
    const cues = scriptCues(SCRIPT, 8)
    expect(cues.length).toBeGreaterThan(1)
    expect(cues[0].start).toBe(0)
    expect(cues[cues.length - 1].end).toBe(8)
  })

  it('runs in order and never overlaps, so two cues are never on screen at once', () => {
    const cues = scriptCues(SCRIPT, 8)
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end)
      expect(cues[i].end).toBeGreaterThan(cues[i].start)
    }
  })

  it('keeps every cue to a readable line and never splits a word', () => {
    const cues = scriptCues(SCRIPT, 8)
    for (const cue of cues) expect(cue.text.length).toBeLessThanOrEqual(CAPTION_LINE_CHARS)
    expect(cues.map((c) => c.text).join(' ')).toBe(SCRIPT.replace(/\s+/g, ' ').trim())
  })

  it('gives longer chunks more time on screen than shorter ones', () => {
    const cues = scriptCues('Aaaa bbbb cccc dddd eeee ffff gggg hhhh. Hi.', 10)
    const durations = cues.map((c) => c.end - c.start)
    expect(durations[0]).toBeGreaterThan(durations[durations.length - 1])
  })

  it('has nothing to say when there is no script', () => {
    expect(scriptCues('', 8)).toEqual([])
    expect(scriptCues(null, 8)).toEqual([])
    expect(scriptCues('   ', 8)).toEqual([])
  })
})

describe('toVtt', () => {
  it('emits a WebVTT file the browser will accept', () => {
    const vtt = toVtt([{ start: 0, end: 2.5, text: 'Hello there' }])
    expect(vtt.startsWith('WEBVTT\n')).toBe(true)
    expect(vtt).toContain('00:00:00.000 --> 00:00:02.500')
    expect(vtt).toContain('Hello there')
  })

  it('formats past a minute correctly', () => {
    const vtt = toVtt([{ start: 61.25, end: 65, text: 'Later' }])
    expect(vtt).toContain('00:01:01.250 --> 00:01:05.000')
  })

  it('is still a valid (empty) WebVTT file when there are no cues', () => {
    expect(toVtt([]).trim()).toBe('WEBVTT')
  })
})

describe('captionTrackSrc — where the <track> points', () => {
  const DEFAULT_WELCOME =
    'https://proj.supabase.co/storage/v1/object/public/tenant-videos/defaults/welcome.mp4'
  const DEFAULT_THANKYOU =
    'https://proj.supabase.co/storage/v1/object/public/tenant-videos/defaults/thank-you.mp4'

  it('points the QuoteMax default welcome video at its shipped transcript', () => {
    expect(captionTrackSrc(DEFAULT_WELCOME, null)).toBe('/captions/welcome.vtt')
  })

  it('points the QuoteMax default thank-you video at its shipped transcript', () => {
    expect(captionTrackSrc(DEFAULT_THANKYOU, null)).toBe('/captions/thank-you.vtt')
  })

  it("prefers the tenant's own script over everything else", () => {
    const src = captionTrackSrc('https://proj.supabase.co/x/tenant/welcome-1.mp4', 'Hi there.')
    expect(src).toBe(`/api/captions?s=${encodeURIComponent('Hi there.')}`)
  })

  it('renders no track at all rather than captions that do not match the audio', () => {
    expect(captionTrackSrc('https://cdn.example.com/filmed-by-hand.mp4', null)).toBeNull()
    expect(captionTrackSrc(null, 'Hi there.')).toBeNull()
  })
})
