import { tool } from 'ai'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const lookupAssembly = tool({
  description: 'Search the electrical assembly library (e.g. "install LED downlight", "replace double GPO", "hardwire smoke alarm")',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const { data } = await supabase
      .from('shared_assemblies')
      .select('*')
      .ilike('name', `%${query}%`)
      .limit(5)
    return data ?? []
  },
})

export const lookupMaterial = tool({
  description: 'Search electrical materials (downlights, GPOs, smoke alarms, ceiling fans, RCBOs, cabling, sundries) by name or brand',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const { data } = await supabase
      .from('shared_materials')
      .select('*')
      .or(`name.ilike.%${query}%,brand.ilike.%${query}%`)
      .limit(5)
    return data ?? []
  },
})

export const applyMarkup = tool({
  description: 'Apply the tradie\'s markup percentage to a base material price. Always pass markupPct explicitly using pricingBook.default_markup_pct (default falls back to 28% — the AU electrical median — only as a safety net).',
  inputSchema: z.object({ basePrice: z.number(), markupPct: z.number().optional() }),
  execute: async ({ basePrice, markupPct }) => {
    const pct = markupPct ?? 28                                // matches pricing_book default
    return { final: +(basePrice * (1 + pct / 100)).toFixed(2), markupPct: pct }
  },
})

export const flagInspectionNeeded = tool({
  description: 'Flag that this job is too complex to quote without a site visit',
  inputSchema: z.object({ reason: z.string() }),
  execute: async ({ reason }) => ({ flagged: true, reason }),
})
