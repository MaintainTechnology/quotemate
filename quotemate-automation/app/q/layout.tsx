// Every customer quote surface is a PRIVATE link.
//
// The token is the capability — it is unguessable, not secret — but these
// pages carry a real person's address, the price they were quoted, and when a
// tradie is coming to their house. None of that belongs in a search index.
//
// Until now /q/* inherited the root metadata with no robots directive, so a
// quote URL pasted anywhere a crawler can reach was indexable. Adding the
// share feature makes these links travel further (into group chats, and
// through link previewers that follow redirects), so the gap is closed here
// rather than left to widen.
//
// Layout-level so it covers every current and future /q/* route without each
// page having to remember. Individual pages may still add their own metadata;
// Next merges it, and nothing below overrides robots today.

import type { Metadata } from 'next'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function QuoteLayout({ children }: { children: React.ReactNode }) {
  return children
}
