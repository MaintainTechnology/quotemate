// QuoteMax Brand Studio — render endpoint.
// GET /api/studio/render?format=li-carousel&slide=0
//   or ?d=<base64(JSON Slide)> for custom copy.
// Returns a PNG rendered from the DS templates via next/og (satori).
import { ImageResponse } from 'next/og'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FORMATS, type Format, type Slide } from '@/lib/studio/types'
import { studioFonts } from '@/lib/studio/fonts'
import { renderSlide, DEFAULT_CAROUSEL } from '@/lib/studio/templates'

export const runtime = 'nodejs'

// Inline the pre-baked photo as a data URI so satori doesn't network-fetch it.
function inlinePhoto(slide: Slide): Slide {
  if (!slide.photo) return slide
  try {
    const abs = join(process.cwd(), 'public', slide.photo.src.replace(/^\/+/, ''))
    const b64 = readFileSync(abs).toString('base64')
    return { ...slide, photo: { ...slide.photo, src: `data:image/png;base64,${b64}` } }
  } catch {
    return { ...slide, photo: null } // missing photo → render without it, never 500
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const format = (url.searchParams.get('format') as Format) in FORMATS ? (url.searchParams.get('format') as Format) : 'li-carousel'
  const size = FORMATS[format]

  let slide: Slide
  const d = url.searchParams.get('d')
  if (d) {
    try {
      slide = JSON.parse(Buffer.from(d, 'base64').toString('utf8')) as Slide
    } catch {
      return new Response('bad slide data', { status: 400 })
    }
  } else {
    const i = Number.parseInt(url.searchParams.get('slide') ?? '0', 10)
    slide = DEFAULT_CAROUSEL[i] ?? DEFAULT_CAROUSEL[0]
  }

  return new ImageResponse(renderSlide(inlinePhoto(slide), format), {
    width: size.w,
    height: size.h,
    fonts: studioFonts() as never,
  })
}
