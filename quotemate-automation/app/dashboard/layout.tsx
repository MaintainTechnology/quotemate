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
  return (
    <>
      <DashboardTopNav />
      {children}
    </>
  )
}
