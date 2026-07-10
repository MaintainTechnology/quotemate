// app/dashboard/layout.tsx — shared chrome for every /dashboard route
// (specs/dashboard-persistent-nav.md): a persistent back-to-dashboard bar so
// no sub-view strands the tradie (the quote viewer, aircon, and signage pages
// previously had no route back). Pages keep owning their own <main> and auth;
// this layout adds nav only. Same shape as the admin shell (app/admin/
// layout.tsx), which removed per-page back links in favour of one nav.

import DashboardTopNav from './_components/DashboardTopNav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // `qm-dash` scopes the dashboard interaction layer in globals.css (hover
  // lift + press states). A plain static wrapper — no transform, no overflow
  // — so the nav's `sticky top-0` still resolves against the viewport.
  return (
    <div className="qm-dash">
      <DashboardTopNav />
      {children}
    </div>
  )
}
