// Auth-aware nav buttons for the public marketing pages.
//
// Mounted from both the sticky top Nav and the hero CTA block on /
// (the home page). On mount we read the Supabase session from
// localStorage (PKCE persist). Signed-in tradies see "Dashboard +
// Sign out"; everyone else sees the original "Sign in + Get started"
// pair. While the session is being resolved we render a single-pixel
// placeholder of the same width so the layout doesn't shift.
//
// Server-rendered pages stay server-rendered — this is the only
// island that needs hydration.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'

type Variant = 'nav' | 'hero'

export default function AuthNav({ variant = 'nav' }: { variant?: Variant }) {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  // Resolve the session on mount + subscribe so the buttons flip
  // immediately if the tradie signs in/out in another tab.
  useEffect(() => {
    let cancelled = false
    const supabase = getBrowserSupabase()
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!cancelled) setAuthed(!!data.session)
    })()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    try {
      const supabase = getBrowserSupabase()
      await supabase.auth.signOut()
      setAuthed(false)
      router.refresh()
    } finally {
      setSigningOut(false)
    }
  }

  // While we don't yet know, render an invisible spacer so the nav
  // height stays stable — avoids the "Sign in" flashing before the
  // dashboard buttons appear for an already-authed visitor.
  if (authed === null) {
    return <span className={variant === 'hero' ? 'h-11 block' : 'h-11 md:h-9 block'} aria-hidden />
  }

  if (variant === 'hero') {
    // One primary in the hero (the page supplies the single secondary CTA).
    // Sign-in lives in the nav. Square, focus-ringed, with an arrow that
    // nudges forward on hover.
    const heroPrimary =
      'group inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-7 py-4 text-sm uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep'
    return authed ? (
      <Link href="/dashboard" className={heroPrimary}>
        Open my dashboard
        <span className="transition-transform duration-300 group-hover:translate-x-0.5">
          <Arrow />
        </span>
      </Link>
    ) : (
      <Link href="/signup" className={heroPrimary}>
        Get my QuoteMate
        <span className="transition-transform duration-300 group-hover:translate-x-0.5">
          <Arrow />
        </span>
      </Link>
    )
  }

  // Default nav variant
  return authed ? (
    <>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold min-h-11 md:min-h-0 px-4 py-2.5 text-xs uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
      >
        Dashboard
        <Arrow />
      </Link>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="inline-flex items-center min-h-11 md:min-h-0 px-3 py-2 text-sm font-semibold uppercase tracking-wider text-text-sec hover:text-text-pri transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </>
  ) : (
    <>
      <Link
        href="/signin"
        className="inline-flex items-center min-h-11 md:min-h-0 px-3 py-2 text-sm font-semibold uppercase tracking-wider text-text-sec hover:text-text-pri transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
      >
        Sign in
      </Link>
      <Link
        href="/signup"
        className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold min-h-11 md:min-h-0 px-4 py-2.5 text-xs uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
      >
        Get started
        <Arrow />
      </Link>
    </>
  )
}

function Arrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}
