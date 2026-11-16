// Auth-aware nav buttons for the public marketing pages.
//
// Mounted from the pill Nav (desktop row + mobile bar), the mobile menu,
// and the hero CTA block on / (the home page). Dual-auth (Clerk↔Supabase):
// a tradie may be signed in via Clerk (new) or the legacy Supabase session.
// Signed-in tradies see "Dashboard + Sign out"; everyone else sees the
// original "Sign in + Get started" pair. While the session is being
// resolved we render a placeholder of the same height so the layout
// doesn't shift.
//
// Server-rendered pages stay server-rendered — this is the only island
// that needs hydration. Visuals are the Site Kit's pill buttons
// (site-ui.tsx), so these always render inside a `.qm-site` scope.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@clerk/nextjs'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { BtnInner, btnClass } from './_components/site-ui'

type Variant = 'nav' | 'hero' | 'mobileBar'

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
    // The hero spacer is an invisible copy of the signed-out pill: a 0-wide
    // spacer let the CTA row reflow onto two lines at 360px once it resolved.
    if (variant === 'hero') {
      return (
        <span className={`${btnClass('primary', 'md')} invisible`} aria-hidden>
          <BtnInner arrow>Get my QuoteMax</BtnInner>
        </span>
      )
    }
    return <span className={variant === 'mobileBar' ? 'block h-9' : 'block h-11'} aria-hidden />
  }

  if (variant === 'mobileBar') {
    // Single compact pill on the mobile nav bar (next to the burger), so
    // signing in doesn't require opening the menu first.
    return authed ? (
      <Link href="/dashboard" className={btnClass('secondary', 'sm')}>
        <BtnInner>Dashboard</BtnInner>
      </Link>
    ) : (
      <Link href="/sign-in" className={btnClass('secondary', 'sm')}>
        <BtnInner>Sign in</BtnInner>
      </Link>
    )
  }

  if (variant === 'hero') {
    // One primary in the hero (the page supplies the single secondary CTA).
    // Sign-in lives in the nav.
    return authed ? (
      <Link href="/dashboard" className={btnClass('primary', 'md')}>
        <BtnInner arrow>Open my dashboard</BtnInner>
      </Link>
    ) : (
      <Link href="/signup" className={btnClass('primary', 'md')}>
        <BtnInner arrow>Get my QuoteMax</BtnInner>
      </Link>
    )
  }

  // Default nav variant
  return authed ? (
    <>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        aria-busy={signingOut || undefined}
        className="qs-nav__link disabled:opacity-50"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
      <Link href="/dashboard" className={btnClass('primary', 'md')}>
        <BtnInner arrow>Dashboard</BtnInner>
      </Link>
    </>
  ) : (
    <>
      <Link href="/sign-in" className="qs-nav__link">
        Sign in
      </Link>
      <Link href="/signup" className={btnClass('primary', 'md')}>
        <BtnInner arrow>Get my QuoteMax</BtnInner>
      </Link>
    </>
  )
}
