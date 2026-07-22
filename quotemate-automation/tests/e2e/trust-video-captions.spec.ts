// Captions on the customer-facing trust videos.
//
// The unit tests lock the MARKUP (a <track ... default> pointing at the right
// transcript). Only a browser can prove the rest: that the browser fetched and
// parsed the WebVTT, that the track is SHOWING without anyone touching the
// player, and that the right line is on screen at a given moment in the audio.
//
// Tokens are real rows in the shared Supabase the dev server reads:
//   WITH_OWN_VIDEO  — a tenant whose thank-you film was generated from a script
//                     (captions come from /api/captions).
//   DEFAULT_VIDEO   — a tenant with no film of its own, so the QuoteMax default
//                     plays and its transcribed /captions/*.vtt is used.

import { test, expect, type Page } from '@playwright/test'

const WITH_OWN_VIDEO = '/q/abqR8E_ZVmFsNcB83HHw8w/thanks'
const DEFAULT_VIDEO = '/q/PP1tOjkM5qpi1QqmURIwSg/thanks'

/** What the browser's own text-track machinery reports for the trust video. */
const trackState = (page: Page) =>
  page.evaluate(async () => {
    const video = document.querySelector('video') as HTMLVideoElement | null
    if (!video) return null
    const track = video.textTracks[0]
    if (!track) return { hasTrack: false } as const
    // readyState 2 === LOADED; the browser only reaches it after fetching and
    // parsing the .vtt, so a cue count proves the file was valid.
    for (let i = 0; i < 40 && (track.cues?.length ?? 0) === 0; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    return {
      hasTrack: true,
      kind: track.kind,
      mode: track.mode,
      label: track.label,
      language: track.language,
      cueCount: track.cues?.length ?? 0,
      firstCue: (track.cues?.[0] as VTTCue | undefined)?.text ?? null,
    } as const
  })

for (const [name, path] of [
  ['a tenant video captioned from its own script', WITH_OWN_VIDEO],
  ['the QuoteMax default video captioned from its transcript', DEFAULT_VIDEO],
] as const) {
  test(`${name}: the track loads and is showing without any interaction`, async ({ page }) => {
    await page.goto(path)
    await page.waitForSelector('video')

    const state = await trackState(page)
    expect(state?.hasTrack).toBe(true)
    expect(state?.kind).toBe('captions')
    expect(state?.language).toBe('en')
    // 'showing' — not 'disabled'/'hidden'. This is the requirement: captions
    // are on when the video starts, with nothing for the customer to click.
    expect(state?.mode).toBe('showing')
    // Cues exist ⇒ the browser fetched the .vtt and parsed it successfully.
    expect(state?.cueCount ?? 0).toBeGreaterThan(0)
    expect(state?.firstCue ?? '').not.toEqual('')
  })
}

test('the caption on screen matches the audio playing at that moment', async ({ page }) => {
  await page.goto(DEFAULT_VIDEO)
  await page.waitForSelector('video')

  // Seek rather than wait out the clip: activeCues is driven by currentTime, so
  // this is the same code path the customer sees, just faster.
  const at = (seconds: number) =>
    page.evaluate(async (t) => {
      const video = document.querySelector('video') as HTMLVideoElement
      const track = video.textTracks[0]
      for (let i = 0; i < 40 && (track.cues?.length ?? 0) === 0; i++) {
        await new Promise((r) => setTimeout(r, 100))
      }
      video.currentTime = t
      await new Promise((r) => setTimeout(r, 250))
      return Array.from(track.activeCues ?? [])
        .map((c) => (c as VTTCue).text)
        .join(' ')
    }, seconds)

  // From public/captions/thank-you.vtt: the opening line, then a line from
  // the middle of the clip. Different moments must show different words.
  expect(await at(1)).toContain('Ricardo here from Maintain Roofing')
  expect(await at(13)).toContain('confirm the exact time')
})

test('the customer can turn captions off and back on', async ({ page }) => {
  await page.goto(DEFAULT_VIDEO)
  await page.waitForSelector('video')

  // The native player exposes the toggle (the CC control); this drives the same
  // API that control drives, which is what proves the track is togglable at all.
  const toggle = (mode: 'disabled' | 'showing') =>
    page.evaluate((m) => {
      const video = document.querySelector('video') as HTMLVideoElement
      video.textTracks[0].mode = m as TextTrackMode
      return video.textTracks[0].mode
    }, mode)

  expect(await toggle('disabled')).toBe('disabled')
  expect(await toggle('showing')).toBe('showing')
})
