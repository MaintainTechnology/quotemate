// The plan takeoff a measurement was saved from (TKO-16 saves it with
// `source_request_key = 'takeoff:' + run id`), so /m can link its Roof Wizard
// export (TKO-18). The id only names the run: every takeoff route needs the
// tradie signed in, so it opens nothing on its own.

import { isPlanMeasurement } from '@/lib/roofing/types'

const TAKEOFF_KEY = /^takeoff:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** The run id of a plan measurement's takeoff, or null for any other row. */
export function takeoffRunOf(provider: string | null, sourceRequestKey: string | null): string | null {
  if (!isPlanMeasurement(provider)) return null
  return TAKEOFF_KEY.exec(sourceRequestKey ?? '')?.[1] ?? null
}
