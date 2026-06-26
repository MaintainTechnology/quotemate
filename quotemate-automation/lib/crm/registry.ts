// Concrete CRM provider factory. Kept separate from provider.ts so the type +
// helper module has no dependency on the concrete implementations (which depend
// back on it) — no import cycle.

import {
  SUPPORTED_PROVIDERS,
  type CrmProvider,
  type CrmProviderId,
} from '@/lib/crm/provider'
import { HubspotProvider } from '@/lib/crm/hubspot'
import { ZohoProvider } from '@/lib/crm/zoho'

export function getProvider(id: string): CrmProvider {
  if (id === 'hubspot') return new HubspotProvider()
  if (id === 'zoho') return new ZohoProvider()
  throw new Error(`unsupported CRM provider: ${id}`)
}

/** Providers that are both supported and currently configured (for the UI). */
export function configuredProviders(): CrmProviderId[] {
  return SUPPORTED_PROVIDERS.filter((id) => {
    try {
      return getProvider(id).isConfigured()
    } catch {
      return false
    }
  })
}
