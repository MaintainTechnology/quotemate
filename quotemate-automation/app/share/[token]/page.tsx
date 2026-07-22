// /share/[token] — the page a customer's friend opens.
//
// DELIBERATELY NOT the thank-you page. /q/roof/<token>/thanks carries the
// amount paid, the property address, the tradie's contact details and the
// booked time. A link forwarded into a group chat must not leak any of that,
// so this page renders the house and the chosen colours and NOTHING else.
//
// The colour/material choice rides in the query string so the friend opens
// exactly what was shared. Every value is re-validated server-side against the
// swatch and material lists — the URL is user-editable by definition.
//
// noindex: this is a private link. It is not secret (the token is the
// capability), but it must never turn up in a search result.

import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import {
  resolveShowcasePayload,
  resolveRoofColour,
  resolveWallColour,
  resolveShowcaseMaterial,
  SHOWCASE_MATERIAL_LABELS,
} from '@/lib/roofing/showcase'
import { signedShowcaseAssets } from '@/lib/roofing/showcase-assets'
import { SharedHouse } from './SharedHouse'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'A new roof',
  description: 'Have a look at this place with a new roof on it.',
  robots: { index: false, follow: false },
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function SharePage(props: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ roof?: string; wall?: string; mat?: string }>
}) {
  const { token } = await props.params
  const sp = await props.searchParams

  // Same narrow select as the showcase API — no address, no price, no tenant
  // contact. `address` is read ONLY to key the render cache; it is never
  // rendered on this page.
  const { data: row } = await supabase
    .from('roofing_measurements')
    .select('address, quote, paid_at, scheduled_at, model3d_status, model3d_glb_path')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) notFound()

  const payload = resolveShowcasePayload(row)
  if (payload.status !== 'ready') notFound()

  const assets = await signedShowcaseAssets({
    glbPath: payload.glbPath,
    address: (row.address as string | null) ?? null,
  })

  const roof = resolveRoofColour(sp.roof)
  const wall = resolveWallColour(sp.wall)
  const material = resolveShowcaseMaterial(sp.mat, payload.material)

  return (
    // .qm-quote is the contained dark customer surface (globals.css:879) — it
    // re-declares the whole palette, so this page inherits the real design
    // tokens instead of hardcoding hex fallbacks for them.
    <main
      className="qm-quote"
      data-qm-theme="dark"
      style={{
        minHeight: '100vh',
        background: 'var(--ink-deep)',
        color: 'var(--text-pri)',
        padding: '32px 20px 56px',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: 24 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              fontSize: 9.5,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              color: 'var(--accent, #FFC400)',
            }}
          >
            Shared with you
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(1.6rem, 4vw, 2.4rem)',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              textTransform: 'uppercase',
              lineHeight: 1.05,
            }}
          >
            A new roof, in {roof.name.toLowerCase()}
          </h1>
          <p style={{ margin: 0, maxWidth: '56ch', fontSize: 14, lineHeight: 1.55, color: 'var(--text-sec)' }}>
            {SHOWCASE_MATERIAL_LABELS[material]} roof in {roof.name}, walls in{' '}
            {wall.name}. Spin it around and have a look.
          </p>
        </header>

        <SharedHouse
          modelUrl={assets.modelUrl}
          posterUrl={assets.images.front}
          images={assets.images}
          roofHex={roof.hex}
          wallHex={wall.hex}
        />

        <footer
          style={{
            borderTop: '1px solid var(--ink-line)',
            paddingTop: 16,
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--text-dim)',
          }}
        >
          Made with QuoteMax
        </footer>
      </div>
    </main>
  )
}
