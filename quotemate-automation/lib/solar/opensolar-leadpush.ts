// OpenSolar lead push for the INSTANT estimate (enrichment build
// 2026-06-13) — the round-trip the Pylon integration can't do: on first
// tradie-confirm, create a real OpenSolar CONTACT + PROJECT for the
// estimate's address (with the customer's quarterly bill pushed as
// usage), so the tradie opens OpenSolar studio with the site pre-loaded.
// If they then design it properly, the OpenSolar tab imports it back as
// the premium proposal — instant estimate in, engineered proposal out.
//
// Gated by OPENSOLAR_ENRICHMENT_ENABLED + OPENSOLAR_LEAD_PUSH_TENANTS.
// Best-effort: logged, never throws — confirm is bit-identical when off.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createOpenSolarContact,
  createOpenSolarProject,
  openSolarLeadPushEnabled,
  updateOpenSolarProjectUsage,
} from '@/lib/opensolar/client'
import { openSolarEnrichmentEnabled } from './opensolar-supplement'
import type { SolarEstimate } from './types'

export async function pushSolarLeadToOpenSolar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  row: {
    tenantId: string | null
    publicToken: string
    intakeId: string | null
    address: string | null
    state: string | null
    postcode: string | null
  },
): Promise<void> {
  try {
    if (!openSolarEnrichmentEnabled(process.env)) return
    if (!openSolarLeadPushEnabled(process.env, row.tenantId)) return

    const { data: est } = await supabase
      .from('solar_estimates')
      .select('estimate')
      .eq('public_token', row.publicToken)
      .maybeSingle()
    const estimate = (est?.estimate as SolarEstimate | null) ?? null
    // Idempotent: a re-confirm never creates a second OpenSolar project.
    if (estimate?.context.opensolar?.project?.id) return

    let caller: { name?: string; phone?: string; email?: string } | null = null
    if (row.intakeId) {
      const { data: intake } = await supabase
        .from('intakes')
        .select('caller')
        .eq('id', row.intakeId)
        .maybeSingle()
      caller = (intake?.caller as { name?: string; phone?: string; email?: string } | null) ?? null
    }

    // Contact first (best-effort — a project without a contact still helps).
    let contactUrl: string | null = null
    const name = caller?.name?.trim()
    if (name || caller?.email || caller?.phone) {
      const [firstName, ...rest] = (name ?? '').split(/\s+/).filter(Boolean)
      const contactRes = await createOpenSolarContact({
        first_name: firstName ?? null,
        family_name: rest.join(' ') || null,
        email: caller?.email?.trim() || null,
        phone: caller?.phone?.trim() || null,
      })
      if (contactRes.ok && typeof contactRes.data.url === 'string') {
        contactUrl = contactRes.data.url
      } else if (!contactRes.ok) {
        console.warn(
          `[solar/opensolar] contact create skipped (${contactRes.code}): ${contactRes.detail}`,
        )
      }
    }

    const projectRes = await createOpenSolarProject({
      address: row.address ?? undefined,
      zip: row.postcode ?? undefined,
      state: row.state ?? undefined,
      country_iso2: 'AU',
      ...(estimate?.context.location
        ? { lat: estimate.context.location.lat, lon: estimate.context.location.lng }
        : {}),
      notes: `Pushed from confirmed QuoteMate solar estimate ${row.publicToken}`,
      ...(contactUrl ? { contacts: [contactUrl] } : {}),
    })
    if (!projectRes.ok) {
      console.warn(
        `[solar/opensolar] lead push skipped (${projectRes.code}): ${projectRes.detail}`,
      )
      return
    }
    const projectId = projectRes.data.id != null ? String(projectRes.data.id) : null
    if (!projectId) {
      console.warn('[solar/opensolar] project create returned no id')
      return
    }

    // Usage push: the customer's real quarterly bill personalises
    // OpenSolar's own bill/offset modelling. Best-effort.
    const quarterlyBill = estimate?.context.quarterly_bill_aud ?? null
    if (quarterlyBill != null && quarterlyBill > 0) {
      const usageRes = await updateOpenSolarProjectUsage(projectId, {
        usage_data_source: 'bill_quarterly',
        values: [quarterlyBill, quarterlyBill, quarterlyBill, quarterlyBill],
      })
      if (!usageRes.ok) {
        console.warn(`[solar/opensolar] usage push skipped (${usageRes.code}): ${usageRes.detail}`)
      }
    }

    // Stamp the project onto the estimate so the dashboard can link it.
    if (estimate) {
      const updated: SolarEstimate = {
        ...estimate,
        context: {
          ...estimate.context,
          opensolar: {
            checked_at: estimate.context.opensolar?.checked_at ?? new Date().toISOString(),
            hardware: estimate.context.opensolar?.hardware ?? null,
            price_check: estimate.context.opensolar?.price_check ?? null,
            project: {
              id: projectId,
              url: `https://app.opensolar.com/#/projects/${projectId}`,
              pushed_at: new Date().toISOString(),
            },
          },
        },
      }
      const { error: updErr } = await supabase
        .from('solar_estimates')
        .update({ estimate: updated })
        .eq('public_token', row.publicToken)
      if (updErr) {
        console.warn('[solar/opensolar] project stamp failed', updErr.message)
      }
    }
    console.log('[solar/opensolar] lead pushed', {
      token: row.publicToken.slice(0, 8) + '…',
      projectId,
    })
  } catch (e) {
    console.warn(
      '[solar/opensolar] lead push failed (non-fatal)',
      e instanceof Error ? e.message : e,
    )
  }
}
