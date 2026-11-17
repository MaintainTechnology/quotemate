// app/dashboard/layout.tsx — shared chrome for every /dashboard route
// (specs/dashboard-persistent-nav.md): a persistent back-to-dashboard bar so
// no sub-view strands the tradie (the quote viewer, aircon, and signage pages
// previously had no route back). Pages keep owning their own <main> and auth;
// this layout adds nav only. Same shape as the admin shell (app/admin/
// layout.tsx), which removed per-page back links in favour of one nav.

import DashboardTopNav from './_components/DashboardTopNav'
import { inter } from '../fonts/inter'
import './dash-kit.css'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // `qm-dash` scopes the Dashboard Kit (dash-kit.css — the Atomos-derived
  // design language: tokens, type, shape, pills) and the interaction layer
  // in globals.css (hover lift + press states). `inter.variable` defines
  // --font-qs for the kit's type stack. A plain static wrapper — no
  // transform, no overflow — so the nav's `sticky top-0` still resolves
  // against the viewport.
  return (
    <div className={`qm-dash ${inter.variable}`}>
      <DashboardTopNav />
      {children}
    </div>
  )
}
