'use client'

// Click-to-enlarge image. Renders an inline thumbnail; clicking opens a
// full-screen lightbox (click anywhere or Esc to close). Used for the
// Google Maps imagery (satellite / Street View) and the AI-generated
// repaint previews so tradies/customers can inspect them closely.

import { useEffect, useState } from 'react'

type Props = {
  src: string
  alt: string
  className?: string
  /** Optional caption shown under the enlarged image. */
  caption?: string
}

export function ZoomableImage({ src, alt, className, caption }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={() => setOpen(true)}
        className={`${className ?? ''} cursor-zoom-in transition-opacity hover:opacity-95`}
        title="Click to enlarge"
      />
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[120] flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-black/85 p-4 sm:p-8"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-[88vh] max-w-full object-contain shadow-2xl" />
          {caption && <p className="font-mono text-xs uppercase tracking-[0.16em] text-white/70">{caption}</p>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
            }}
            aria-label="Close"
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center border border-white/30 font-mono text-lg text-white/80 transition-colors hover:border-white hover:text-white"
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
