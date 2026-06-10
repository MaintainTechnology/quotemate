import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl, type StaticMapInput } from '@/lib/roofing/google-maps'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userIdFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

export async function GET(req: Request) {
  const userId = await userIdFromBearer(req)
  if (!userId) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json(
      { ok: false, error: 'GOOGLE_MAPS_API_KEY not set on the server' },
      { status: 503 },
    )
  }

  const url = new URL(req.url)
  const address = url.searchParams.get('address') ?? undefined
  const latRaw = url.searchParams.get('lat')
  const lngRaw = url.searchParams.get('lng')
  const center =
    latRaw && lngRaw && Number.isFinite(Number(latRaw)) && Number.isFinite(Number(lngRaw))
      ? { lat: Number(latRaw), lng: Number(lngRaw) }
      : undefined

  if (!address && !center) {
    return Response.json(
      { ok: false, error: 'address or lat+lng is required' },
      { status: 400 },
    )
  }

  const input: StaticMapInput = {
    address,
    center,
    zoom: 19,
    size: { width: 640, height: 360 },
    maptype: 'hybrid',
    markers: center ? [{ ...center, label: 'AC', color: 'orange' }] : undefined,
  }

  let target: string
  try {
    target = buildStaticMapUrl(input, { apiKey })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  let res: Response
  try {
    res = await fetch(target, { method: 'GET' })
  } catch (e) {
    return Response.json(
      { ok: false, error: `Google Maps Static fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return Response.json(
      {
        ok: false,
        error: `Google Maps Static returned ${res.status}`,
        upstreamBody: body.slice(0, 500),
      },
      { status: 502 },
    )
  }

  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
}
