// The tradie's welcome / thank-you trust videos must PLAY ON ARRIVAL, with no
// tap, on every customer-facing surface: /q/[token] (welcome), /q/[token]/paid
// (thank-you), /q/roof/[token] (welcome) and /q/roof/[token]/book (thank-you).
// All four render the one shared <TrustVideo>, so the behaviour is locked here
// once rather than four times.
//
// Autoplay is only permitted by browsers when the video is MUTED — an unmuted
// autoplay is rejected by Chrome/Safari/Firefox policy and the video would sit
// frozen on frame 0. So `muted` is not cosmetic: drop it and autoplay silently
// stops working. `playsinline` is the iOS Safari counterpart — without it iOS
// hijacks the video into its fullscreen player instead of playing in place.
//
// The SSR markup is what matters: these are server components, so the very
// first HTML the browser parses has to carry the attributes. React does not
// reflect every media prop into server markup, which is exactly why this
// asserts on renderToStaticMarkup output rather than on the props.
//
// createElement rather than JSX so the file stays .test.ts and matches the
// node-only vitest include glob (vitest.config.ts).

import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TrustVideo } from './parts'

const render = (props: Parameters<typeof TrustVideo>[0]) =>
  renderToStaticMarkup(createElement(TrustVideo, props))

const SRC = 'https://cdn.example.com/welcome.mp4'

// React serialises some media props in camelCase (`playsInline=""`). HTML
// attribute names are case-insensitive to a parser, so the assertion is on the
// attribute being present, not on how React spelt it.
//
// Quoted values are blanked before matching, so the assertion can only ever be
// satisfied by an attribute NAME. Without that, a src URL or style value that
// happened to contain "muted" would make these tests pass while the attribute
// was gone — a green test for a broken feature.
const videoTag = (html: string) => html.match(/<video[^>]*>/)?.[0] ?? ''
const hasAttr = (html: string, attr: string) =>
  new RegExp(`\\b${attr}\\b`, 'i').test(videoTag(html).replace(/"[^"]*"/g, '""'))

describe('TrustVideo — plays on arrival, no tap required', () => {
  it('autoplays', () => {
    expect(hasAttr(render({ src: SRC, title: 'Welcome' }), 'autoplay')).toBe(true)
  })

  it('is muted in the server markup, without which browsers block the autoplay', () => {
    expect(hasAttr(render({ src: SRC, title: 'Welcome' }), 'muted')).toBe(true)
  })

  it('plays inline so iOS Safari does not take over the screen', () => {
    expect(hasAttr(render({ src: SRC, title: 'Welcome' }), 'playsinline')).toBe(true)
  })

  it('keeps controls so the customer can unmute and replay', () => {
    expect(hasAttr(render({ src: SRC, title: 'Welcome' }), 'controls')).toBe(true)
  })

  it('still renders the static placeholder — never a player — when the tenant has no video', () => {
    const html = render({ src: null, title: 'Welcome' })
    expect(html).not.toContain('<video')
    expect(html).toContain('Video coming soon')
  })
})

// The video autoplays MUTED (above), so for the first seconds of every quote
// page the captions ARE the message. They must therefore be on by default, not
// behind the controls menu — that is what `default` on the <track> buys.
describe('TrustVideo — captions', () => {
  const DEFAULT_WELCOME =
    'https://proj.supabase.co/storage/v1/object/public/tenant-videos/defaults/welcome.mp4'
  const trackTag = (html: string) => html.match(/<track[^>]*>/)?.[0] ?? ''

  it('captions the QuoteMax default video from its shipped transcript', () => {
    const tag = trackTag(render({ src: DEFAULT_WELCOME, title: 'Welcome' }))
    expect(tag).toContain('src="/captions/welcome.vtt"')
    expect(tag).toContain('kind="captions"')
  })

  it('is showing from the first frame, without the customer touching anything', () => {
    const tag = trackTag(render({ src: DEFAULT_WELCOME, title: 'Welcome' }))
    expect(/\bdefault\b/.test(tag.replace(/"[^"]*"/g, '""'))).toBe(true)
  })

  it('is labelled so the native CC control can name (and toggle) it', () => {
    const tag = trackTag(render({ src: DEFAULT_WELCOME, title: 'Welcome' }))
    // React spells it srcLang="en"; an HTML parser lower-cases it (same quirk
    // as playsInline above), so assert case-insensitively.
    expect(tag).toMatch(/srclang="en"/i)
    expect(tag).toContain('label=')
  })

  it("captions a tenant's own video from the script it was generated from", () => {
    const html = render({ src: SRC, title: 'Welcome', script: 'Hi, we are Ric Electrical.' })
    expect(trackTag(html)).toContain(
      `src="/api/captions?s=${encodeURIComponent('Hi, we are Ric Electrical.')}"`,
    )
  })

  it('renders no track when the spoken words are unknown — never captions that lie', () => {
    expect(render({ src: SRC, title: 'Welcome' })).not.toContain('<track')
  })
})
