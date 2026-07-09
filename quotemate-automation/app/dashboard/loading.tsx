// Route-level boot fallback (specs/dashboard-performance.md R2): paints the
// branded banner during the RSC transition + client-chunk download — the
// window that used to render nothing at all.

import { BootBanner } from './_components/BootBanner'

export default function DashboardLoading() {
  return <BootBanner />
}
