// Shared chrome for all /legal/* pages — the marketing site shell (pill nav,
// black footer), so the policies feel part of the same site. Per-page
// <title> is set by each page's own metadata export.

import type { Metadata } from 'next'
import { SiteShell } from '@/app/_components/site'

export const metadata: Metadata = {
  title: { default: 'Legal · QuoteMax', template: '%s · QuoteMax' },
  robots: { index: true, follow: true },
}

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>
}
