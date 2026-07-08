// Render decision for the persistent dashboard top nav
// (specs/dashboard-persistent-nav.md): show the back-to-dashboard bar on
// every /dashboard sub-route; hide it on the root /dashboard page, which
// renders its own full topbar.

export function showDashboardNav(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return pathname.startsWith('/dashboard/') && pathname.length > '/dashboard/'.length
}
