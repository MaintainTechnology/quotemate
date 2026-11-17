'use client'

// Persistent back-to-dashboard bar for every /dashboard sub-route
// (specs/dashboard-persistent-nav.md). Mirrors the admin shell's nav language
// (app/admin/layout.tsx) at slim height. Sub-page sticky chrome sticks at
// top-11, directly below this h-11 bar, so on sub-routes it stays EXACTLY
// 44px tall.
//
// On the root /dashboard page there is no back link (showDashboardNav), and
// the page renders its own floating pill topbar. There the bar is a quiet,
// non-sticky utility row: it used to be `sticky top-0` there too, which left
// it parked over the top 44px of the pill bar once the page scrolled.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { showDashboardNav } from './dashboard-nav'

export default function DashboardTopNav() {
  const pathname = usePathname()
  const showBack = showDashboardNav(pathname)

  return (
    <nav
      aria-label="Dashboard"
      // Height and border on ONE border-box element so the sub-route bar is
      // exactly 44px — the top-11 offsets on sub-page sticky chrome depend
      // on it.
      className={
        showBack
          ? 'sticky top-0 z-40 flex h-11 items-center border-b border-ink-line bg-(--qd-nav-bg) px-4 backdrop-blur-md sm:px-5'
          : 'flex h-9 items-center px-4 pt-2 sm:px-6'
      }
    >
      {showBack && <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-line bg-ink-card px-3 py-1 text-[13px] font-medium text-text-pri transition-colors hover:bg-ink-deep"
      >
        <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        Dashboard
      </Link>}
      <div className="ml-auto flex items-center gap-5 text-[13px] text-text-dim">
        <Link className="transition-colors hover:text-text-pri" href="/dashboard/sms-recovery">Enquiry recovery</Link>
        <Link className="transition-colors hover:text-text-pri" href="/dashboard/sms-delivery">SMS delivery</Link>
      </div>
    </nav>
  )
}
