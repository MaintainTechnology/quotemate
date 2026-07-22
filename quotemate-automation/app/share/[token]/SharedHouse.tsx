'use client'

// The house, as a friend sees it. View-only — no colour pickers, no material
// selector, no share button. The recipient is looking at someone else's
// choice, not editing it; controls they cannot meaningfully use would just be
// clutter (and a second share button starts a chain letter).

import { HouseViewer } from '@/app/q/_chrome/HouseViewer'

type Props = {
  modelUrl: string | null
  posterUrl: string | null
  images: { front: string | null; back: string | null }
  roofHex: string
  wallHex: string
}

export function SharedHouse({ modelUrl, posterUrl, images, roofHex, wallHex }: Props) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {modelUrl ? (
        <HouseViewer
          modelUrl={modelUrl}
          roofHex={roofHex}
          wallHex={wallHex}
          posterUrl={posterUrl}
          label="3D model of the house"
        />
      ) : null}

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        {(['front', 'back'] as const).map((view) =>
          images[view] ? (
            <figure key={view} style={{ margin: 0, border: '1px solid var(--ink-line)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={images[view]!}
                alt={`${view === 'front' ? 'Front' : 'Rear'} view of the house`}
                style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }}
              />
            </figure>
          ) : null,
        )}
      </div>
    </div>
  )
}
