// Auth-aware nav buttons for the public marketing pages.
//
// Mounted from both the sticky top Nav and the hero CTA block on /
// (the home page). Dual-auth (Clerk↔Supabase): a tradie may be signed
// in via Clerk (new) or the legacy Supabase session. Signed-in tradies
// see "Dashboard + Sign out"; everyone else sees the original "Sign in +
// Get started" pair. While the session is being resolved we render a
// single-pixel placeholder of the same width so the layout doesn't shift.
//
// Server-rendered pages stay server-rendered — this is the only
// island that needs hydration.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@clerk/nextjs'
import { getBrowserSupabase } from '@/lib/supabase/client'

type Variant = 'nav' | 'hero'

export default function AuthNav({ variant = 'nav' }: { variant?: Variant }) {
  const router = useRouter()
  // Dual-auth: a Clerk-authed tradie has NO Supabase session, so reading only
  // the Supabase session (as before) left them looking signed-out on the
  // marketing pages. Read Clerk too and treat EITHER provider as signed in.
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn, signOut: clerkSignOut } = useAuth()
  const [supabaseAuthed, setSupabaseAuthed] = useState<boolean | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  // Resolve the legacy Supabase session on mount + subscribe so the buttons
  // flip immediately if the tradie signs in/out in another tab.
  useEffect(() => {
    let cancelled = false
    let unsub: (() => void) | undefined
    // iOS Safari in private / locked-storage mode can throw when the
    // Supabase client touches localStorage. Guard every access so a
    // failure resolves to the signed-out state instead of leaving
    // it stuck at null (which would hide the nav buttons forever).
    try {
      const supabase = getBrowserSupabase()
      ;(async () => {
        try {
          const { data } = await supabase.auth.getSession()
          if (!cancelled) setSupabaseAuthed(!!data.session)
        } catch {
          if (!cancelled) setSupabaseAuthed(false)
        }
      })()
      const { data: sub } = supabase.auth.onAuthStateChange(
        (_event, session) => setSupabaseAuthed(!!session),
      )
      unsub = () => sub.subscription.unsubscribe()
    } catch {
      if (!cancelled) setSupabaseAuthed(false)
    }
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    try {
      // Clear BOTH providers so sign-out is complete regardless of how the
      // tradie logged in.
      await getBrowserSupabase().auth.signOut().catch(() => {})
      try {
        await clerkSignOut()
      } catch {
        /* Supabase sign-out already ran */
      }
      setSupabaseAuthed(false)
      router.refresh()
    } finally {
      setSigningOut(false)
    }
  }

  // Signed in if EITHER provider confirms it. Unknown (spacer) until Clerk has
  // loaded AND the Supabase probe has resolved, so the buttons don't flash the
  // signed-out state before an already-authed visitor is recognised.
  const authed: boolean | null =
    !clerkLoaded || supabaseAuthed === null ? null : clerkSignedIn || supabaseAuthed

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
      'group inline-flex items-center gap-2 rounded-lg bg-accent hover:bg-accent-press text-white font-semibold px-7 py-4 text-sm uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep'
    return authed ? (
      <Link href="/dashboard" className={heroPrimary}>
        Open my dashboard
        <span className="transition-transform duration-300 group-hover:translate-x-0.5">
          <Arrow />
        </span>
      </Link>
    ) : (
      <Link href="/signup" className={heroPrimary}>
        Get my QuoteMax
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
        className="inline-flex items-center gap-2 rounded-lg bg-accent hover:bg-accent-press text-white font-semibold min-h-11 md:min-h-0 px-4 py-2.5 text-xs uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
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
        href="/sign-in"
        className="inline-flex items-center min-h-11 md:min-h-0 px-3 py-2 text-sm font-semibold uppercase tracking-wider text-text-sec hover:text-text-pri transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
      >
        Sign in
      </Link>
      <Link
        href="/signup"
        className="inline-flex items-center gap-2 rounded-lg bg-accent hover:bg-accent-press text-white font-semibold min-h-11 md:min-h-0 px-4 py-2.5 text-xs uppercase tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-ink-deep"
      >
        Get my QuoteMax
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
