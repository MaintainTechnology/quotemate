// Shared after()-body for the Pylon supplements on the INSTANT estimate
// (STC cross-check spec §4.5 + hardware supplements build 2026-06-13),
// used by the estimate route AND the re-draft route. Runs:
//
//   1. The STC cross-check (mismatch ⇒ guardrail flag) + zone facts.
//   2. The tenant-SKU hardware enrichment (datasheet cards for the
//      quote page) + the hardware-floor guardrail (tradie's own Pylon
//      hardware prices exceeding a tier's net price ⇒ flag).
//
// Everything merges into ONE row update (guardrail_flags column + the
// estimate jsonb context). Error-checked + logged; never throws —
// Pylon being down leaves the row bit-identical.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SolarEstimate } from './types'
import { runPylonStcCrossCheck } from './stc-crosscheck'
import { hardwareFloorFlags, runPylonHardwareSupplement } from './pylon-hardware'

export async function applyPylonStcCrossCheck(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  estimate: SolarEstimate,
  /** Tenant id — unlocks the hardware supplement (nominated SKUs). */
  tenantId?: string | null,
): Promise<void> {
  try {
    // 1. STC cross-check (existing behaviour, now also carrying zone facts).
    const stc = await runPylonStcCrossCheck({ estimate })

    // 2. Hardware supplement from the tenant's nominated SKUs.
    let components: Awaited<ReturnType<typeof runPylonHardwareSupplement>> = null
    if (tenantId) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('pylon_settings')
        .eq('id', tenantId)
        .maybeSingle()
      if (tenant) {
        components = await runPylonHardwareSupplement({ settings: tenant.pylon_settings })
      }
    }
    const floorFlags = components
      ? hardwareFloorFlags({
          components,
          priceTiers: estimate.price.tiers,
          sizingTiers: estimate.sizing.tiers,
        })
      : []

    if (!stc && !components) return

    const newFlags = [...(stc?.flags ?? []), ...floorFlags]
    const mergedFlags = [...estimate.guardrail_flags, ...newFlags]
    const updatedEstimate: SolarEstimate = {
      ...estimate,
      guardrail_flags: mergedFlags,
      context: {
        ...estimate.context,
        ...(stc ? { pylon_stc_check: stc.check } : {}),
        ...(components ? { pylon_components: components } : {}),
      },
    }
    const { error } = await supabase
      .from('solar_estimates')
      .update({ guardrail_flags: mergedFlags, estimate: updatedEstimate })
      .eq('public_token', estimate.token)
    if (error) {
      console.error('[solar/pylon] supplements row update FAILED', {
        token: estimate.token.slice(0, 8) + '…',
        message: error.message,
      })
      return
    }
    if (newFlags.length > 0) {
      console.warn('[solar/pylon] supplement flags raised', newFlags)
    } else {
      console.log('[solar/pylon] supplements applied', {
        token: estimate.token.slice(0, 8) + '…',
        stcVerified: stc?.check.verified ?? false,
        hardwareComponents: components?.length ?? 0,
      })
    }
  } catch (e) {
    console.warn(
      '[solar/pylon] supplements skipped (non-fatal)',
      e instanceof Error ? e.message : e,
    )
  }
}
