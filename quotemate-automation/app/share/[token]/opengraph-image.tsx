// Social preview for a shared house link.
//
// Without this, a link pasted into Messages or WhatsApp is a bare URL, and the
// whole point of the feature is that someone shows their new roof off. With
// it, the recipient sees the house before they tap.
//
// Same next/og pipeline the brand studio already uses
// (app/api/studio/render/route.ts), including its font loader.
//
// PRIVACY: this image carries the house and the chosen colours only — no
// price, no address, no tradie name. Link previewers are fetched by third
// parties (Apple, Meta, Google) and cached on their infrastructure, so
// anything rendered here effectively leaves our control. The page itself is
// noindex; this keeps the preview to the same standard.

import { ImageResponse } from 'next/og'
import { createClient } from '@supabase/supabase-js'
import {
  resolveShowcasePayload,
  resolveRoofColour,
  resolveWallColour,
  resolveShowcaseMaterial,
  SHOWCASE_MATERIAL_LABELS,
} from '@/lib/roofing/showcase'
import { signedShowcaseAssets } from '@/lib/roofing/showcase-assets'

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'A house with a new roof'

// Command-centre tokens, inlined: satori resolves no CSS custom properties.
const INK = '#16120F'
const ACCENT = '#FFC400'
const TEXT = '#F5F1EA'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function Image({
  params,
  searchParams,
}: {
  params: { token: string }
  searchParams?: { roof?: string; wall?: string; mat?: string }
}) {
  const roof = resolveRoofColour(searchParams?.roof)
  const wall = resolveWallColour(searchParams?.wall)

  let photo: string | null = null
  let material = resolveShowcaseMaterial(searchParams?.mat, null)

  // Best-effort: a preview that fails to fetch must still render something,
  // never a broken image or a 500 in someone's chat app.
  try {
    const { data: row } = await supabase
      .from('roofing_measurements')
      .select('address, quote, paid_at, scheduled_at, model3d_status, model3d_glb_path')
      .eq('public_token', params.token)
      .maybeSingle()
    if (row) {
      const payload = resolveShowcasePayload(row)
      if (payload.status === 'ready') {
        material = resolveShowcaseMaterial(searchParams?.mat, payload.material)
        const assets = await signedShowcaseAssets({
          glbPath: payload.glbPath,
          address: (row.address as string | null) ?? null,
        })
        photo = (assets.materialImages[material] ?? assets.images).front
      }
    }
  } catch {
    // fall through to the typographic card
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: INK,
          color: TEXT,
          fontFamily: 'sans-serif',
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            width={700}
            height={630}
            style={{ width: 700, height: 630, objectFit: 'cover' }}
          />
        ) : null}

        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: 56,
            gap: 18,
          }}
        >
          <div style={{ fontSize: 20, letterSpacing: 4, color: ACCENT, textTransform: 'uppercase' }}>
            Shared with you
          </div>
          <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
            A new roof
          </div>
          <div style={{ fontSize: 26, lineHeight: 1.35, color: '#C3B8AC' }}>
            {SHOWCASE_MATERIAL_LABELS[material]} in {roof.name}
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <div style={{ width: 56, height: 56, background: roof.hex, border: `2px solid ${TEXT}` }} />
            <div style={{ width: 56, height: 56, background: wall.hex, border: `2px solid ${TEXT}` }} />
          </div>

          <div style={{ marginTop: 20, fontSize: 18, letterSpacing: 3, color: '#A2968A', textTransform: 'uppercase' }}>
            QuoteMax
          </div>
        </div>
      </div>
    ),
    size,
  )
}
