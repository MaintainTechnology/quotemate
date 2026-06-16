'use client'

// Auto-refresh while deferred estimate assets are still being produced.
//
// The Sun & shade heatmap (and, for a clean estimate, the auto-release
// confirm + the AI "panels installed" concept) are generated in the
// estimate route's after() job — they land a few seconds AFTER the row is
// created. The page is a force-dynamic server component that reads the row
// once per render, so a viewer who opens the quote during that window sees
// no heatmap until they manually reload.
//
// This mounts only while something is still pending and calls
// router.refresh() on an interval. router.refresh() re-runs the server
// component (force-dynamic → fresh DB read) WITHOUT remounting client
// components, so `attempts` survives each refresh and caps the polling.
// When the server re-renders with `pending=false`, the effect early-exits
// and the polling stops. No work happens once everything has arrived.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  /** True while an expected asset (heatmap / auto-release) is not yet on
   *  the row. Recomputed by the server on every refresh. */
  pending: boolean
  intervalMs?: number
  maxAttempts?: number
}

export function HeatmapAutoRefresh({
  pending,
  intervalMs = 4000,
  maxAttempts = 15,
}: Props) {
  const router = useRouter()
  const [attempts, setAttempts] = useState(0)

  useEffect(() => {
    if (!pending || attempts >= maxAttempts) return
    const t = setTimeout(() => {
      setAttempts((a) => a + 1)
      router.refresh()
    }, intervalMs)
    return () => clearTimeout(t)
  }, [pending, attempts, intervalMs, maxAttempts, router])

  return null
}
