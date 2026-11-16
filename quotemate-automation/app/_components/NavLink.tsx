"use client"

// A nav link that knows when it is the current page (aria-current="page"),
// so the pill nav can mark where you are — the one wayfinding cue the rest
// of the server-rendered Nav cannot compute. Hash links (/#faq) never
// count as current: they point into the home page, not at a page.

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

export function NavLink({
  href,
  children,
  className = "qs-nav__link",
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  const pathname = usePathname()
  const current = !href.includes("#") && (pathname === href || pathname.startsWith(`${href}/`))
  return (
    <Link href={href} className={className} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  )
}
