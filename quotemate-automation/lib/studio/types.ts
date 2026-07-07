// QuoteMax Brand Studio — template data model + format presets.
// Phase 1 ships the LinkedIn formats + the five slide kinds proven in the
// redesign/marketing/linkedin-carousel prototype. Other channels (IG, flyer,
// deck) reuse the same slide kinds at different canvas sizes in later phases.

export type Format =
  | 'li-carousel' // 1080×1350 (4:5) swipeable document post
  | 'li-single' //   1200×627  single share image
  | 'ig-square' //   1080×1080
  | 'ig-story' //    1080×1920
  | 'flyer-a4' //    2480×3508 (A4 @300dpi)
  | 'deck-16x9' //   1920×1080

export const FORMATS: Record<Format, { w: number; h: number; label: string; channel: string }> = {
  'li-carousel': { w: 1080, h: 1350, label: 'LinkedIn carousel', channel: 'LinkedIn' },
  'li-single': { w: 1200, h: 627, label: 'LinkedIn single', channel: 'LinkedIn' },
  'ig-square': { w: 1080, h: 1080, label: 'Instagram post', channel: 'Instagram' },
  'ig-story': { w: 1080, h: 1920, label: 'Instagram story', channel: 'Instagram' },
  'flyer-a4': { w: 2480, h: 3508, label: 'Flyer A4', channel: 'Print' },
  'deck-16x9': { w: 1920, h: 1080, label: 'Deck slide', channel: 'Deck' },
}

// A pre-baked, brand-treated photo living under /public/studio/photos.
export type StudioPhoto = {
  src: string // e.g. "/studio/photos/hero-main.png"
  pos?: string // object-position, e.g. "center 28%"
  scrim?: 'top' | 'left' | 'faint' // legibility gradient over the photo
}

export type SlideKind = 'stat' | 'list' | 'steps' | 'quote' | 'cta'

// Shared chrome present on every slide.
type Base = {
  kind: SlideKind
  eyebrow?: string[] // middot-joined; first part accent, rest dim
  photo?: StudioPhoto | null
  bar?: string[] // yellow marquee items (dot-joined)
}

// `{curly}` words in any string render in the accent colour.
export type StatSlide = Base & {
  kind: 'stat'
  lines: [string, string][] // [accent number, label]
  sub?: string
  proof?: string[]
}
export type ListSlide = Base & { kind: 'list'; h: string; cards: [string, string][]; sub?: string }
export type StepsSlide = Base & { kind: 'steps'; h: string; steps: [string, string, string][] }
export type QuoteSlide = Base & { kind: 'quote'; quote: string; attrib: string[] }
export type CtaSlide = Base & { kind: 'cta'; h: string; sub?: string; btn: string; foot?: string[] }

export type Slide = StatSlide | ListSlide | StepsSlide | QuoteSlide | CtaSlide

export type RenderRequest = {
  format: Format
  slide: Slide
}
