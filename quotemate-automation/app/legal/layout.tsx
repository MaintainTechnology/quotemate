// Shared chrome for all /legal/* pages — the marketing Nav + Footer on the
// Maintain canvas, so the policies feel part of the same site. Per-page
// <title> is set by each page's own metadata export.

import type { Metadata } from 'next'
import { Nav, Footer, MarqueeBar } from '@/app/_components/site'

export const metadata: Metadata = {
  title: { default: 'Legal — QuoteMate', template: '%s — QuoteMate' },
  robots: { index: true, follow: true },
}

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-canvas">
      <div className="noise-overlay" aria-hidden="true" />
      <Nav />
      <main>{children}</main>
      <Footer />
      <MarqueeBar />
    </div>
  )
}
