// Caption track for a tenant's generated trust video.
//
// Stateless by design: the spoken script rides in the query string. It is the
// video's own audio — public by definition — so there is nothing to look up,
// nothing to authorise, and the answer is a pure function of the input, which
// is why it caches immutably.
//
// Same-origin on purpose: a cross-origin <track> needs CORS plus crossorigin
// on the <video>, and a data: URI track is unreliable in Safari.

import { scriptCues, toVtt } from '@/lib/videos/captions'

/** Generous next to MAX_SCRIPT_CHARS (220) — anything past this is not a
 *  trust-video script, it is someone poking at a public endpoint. */
const MAX_QUERY_SCRIPT_CHARS = 600

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('s') ?? ''
  const script = raw.replace(/\s+/g, ' ').trim()
  if (!script || script.length > MAX_QUERY_SCRIPT_CHARS) {
    return new Response('script required', { status: 400 })
  }
  return new Response(toVtt(scriptCues(script)), {
    headers: {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
