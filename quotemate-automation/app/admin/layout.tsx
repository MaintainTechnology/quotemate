'use client'

// app/admin/layout.tsx — Admin shell.
//
// Wraps EVERY /admin/* surface (the command centre + metrics, loader,
// agents, customers, docs, tenants, invites, files…) in one place so they
// all share:
//   1. a persistent top navbar — matches the dashboard's nav language
//      (brand mark + "QuoteMax / Admin") — with a "Back to dashboard"
//      button that returns the admin to /dashboard from any admin page, and
//   2. an admin-only gate. Non-admins never see admin content: signed-out
//      users are bounced to /signin, signed-in non-admins to /dashboard.
//
// The gate is UX + defense-in-depth, NOT the security boundary — every
// /api/admin/* route still re-checks admin server-side via
// resolveAdminUserId (admin_users allow-list). See lib/admin-loader/auth.ts.
//
// Client component because admin status is a Bearer-token/whoami probe
// (the app authenticates via Supabase PKCE in the browser, mirroring the
// dashboard's own lazy is_admin check). No metadata export here.
//
// Design system: Maintain Technology (dark navy command-centre, orange
// accent, mono all-caps). See .claude/skills/maintain-design-system.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, LogOut } from 'lucide-react'
import { useClerk } from '@clerk/nextjs'
import { BrandMark } from '@/app/_components/BrandMark'
import { getAuthToken } from '@/lib/auth/client-token'
import { getBrowserSupabase } from '@/lib/supabase/client'

type Gate = 'checking' | 'allowed'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const { signOut: clerkSignOut } = useClerk()
  // Fails CLOSED: content renders only after whoami confirms is_admin.
  // Any signed-out / non-admin / network outcome redirects away and never
  // mounts the admin children.
  const [gate, setGate] = useState<Gate>('checking')

  useEffect(() => {
    let cancelled = false

    getAuthToken().then(async (token) => {
      if (cancelled) return
      if (!token) {
        router.replace('/signin')
        return
      }
      try {
        const res = await fetch('/api/admin/whoami', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const json = (await res.json()) as {
          ok?: boolean
          is_admin?: boolean
        }
        if (cancelled) return
        if (json?.is_admin === true) {
          setGate('allowed')
        } else {
          // Signed in, but not an admin — this section is admin-only.
          router.replace('/dashboard')
        }
      } catch {
        // Never leave a non-admin looking at admin chrome on an error.
        if (!cancelled) router.replace('/dashboard')
      }
    })

    return () => {
      cancelled = true
    }
  }, [router])

  async function signOut() {
    // Dual-auth: clear BOTH sessions so sign-out is complete regardless of
    // which provider the admin logged in with (a Clerk admin has no Supabase
    // session, so the Supabase-only sign-out used to leave them signed in).
    await getBrowserSupabase().auth.signOut().catch(() => {})
    try {
      await clerkSignOut()
    } catch {
      /* Supabase sign-out already ran */
    }
    router.replace('/signin')
  }

  return (
    <div className="min-h-screen app-canvas text-text-pri flex flex-col">
      <AdminNav onSignOut={signOut} />
      {gate === 'checking' ? <GateChecking /> : children}
    </div>
  )
}

// ─── Nav ────────────────────────────────────────────────────────────
//
// Mirrors the dashboard's top nav (border-b, sticky, backdrop-blur, brand
// mark + wordmark on the left, action cluster on the right) so moving
// between the dashboard and admin feels like one product. The primary
// action here is "Back to dashboard" — the return path the admin was
// missing. Sticky at z-30 so it clears any sub-page sticky controls.

function AdminNav({ onSignOut }: { onSignOut: () => void }) {
  return (
    <nav className="sticky top-0 z-30 border-b border-ink-line bg-ink-deep/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[96rem] items-center justify-between gap-2 px-4 py-4 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center gap-2 sm:gap-3"
          >
            <BrandMark className="h-10 w-auto" />
            <span className="hidden shrink-0 font-extrabold uppercase tracking-tight text-text-pri sm:inline">
              QuoteMax
            </span>
          </Link>
          <span className="hidden shrink-0 text-text-dim sm:inline">/</span>
          {/* Links to the admin hub (/admin) so every sub-page has a
              one-click path back to the command centre — the per-page
              "← Admin" links were removed in favour of this. */}
          <Link
            href="/admin"
            className="truncate font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent transition-colors hover:text-accent-soft"
          >
            Admin
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 self-stretch border border-ink-line px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-sec transition-colors hover:border-accent hover:bg-ink-card hover:text-text-pri"
          >
            <ArrowLeft
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className="shrink-0"
            />
            <span className="hidden sm:inline">Back to dashboard</span>
            <span className="sm:hidden">Dashboard</span>
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            className="inline-flex cursor-pointer items-center gap-2 self-stretch border border-ink-line px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-sec transition-colors hover:border-text-dim hover:bg-ink-card hover:text-text-pri"
          >
            <LogOut
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className="shrink-0"
            />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </nav>
  )
}

// While the admin check is in flight we still show the nav (so "Back to
// dashboard" works immediately) but withhold all admin content.
function GateChecking() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="inline-flex items-center gap-3 border border-ink-line bg-ink-card px-5 py-3">
        <span
          className="h-2.5 w-2.5 bg-accent motion-safe:animate-pulse"
          aria-hidden="true"
        />
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec">
          Verifying admin access…
        </span>
      </div>
    </div>
  )
}
