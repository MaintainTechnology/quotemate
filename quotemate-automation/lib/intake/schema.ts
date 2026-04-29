import { z } from 'zod'

export const IntakeSchema = z.object({
  job_type: z.enum([
    'downlights',
    'power_points',
    'ceiling_fans',
    'smoke_alarms',
    'outdoor_lighting',
    'switchboard',
    'oven_cooktop',
    'ev_charger',
    'fault_finding',
    'renovation',
    'other',
  ]),
  address: z.string(),
  suburb: z.string(),
  scope: z.object({
    item_count: z.number().optional(),                                       // e.g., # of downlights, # of GPOs
    is_new_install: z.boolean().optional(),                                  // vs replacing existing
    existing_wiring: z.boolean().optional(),                                 // is wiring already there?
    indoor_outdoor: z.enum(['indoor', 'outdoor', 'both', 'unknown']).optional(),
    description: z.string(),
  }),
  access: z.object({
    roof_access: z.boolean().optional(),
    ceiling_type: z.enum(['flat', 'raked', 'high', 'unknown']).optional(),
    wall_type: z.enum(['plaster', 'brick', 'concrete', 'tile', 'unknown']).optional(),
    notes: z.string().optional(),
  }).optional(),
  property: z.object({
    bedrooms: z.number().optional(),                                         // for smoke-alarm jobs
    levels: z.number().optional(),
    pre_1970: z.boolean().optional(),                                        // asbestos / lead risk
    has_solar: z.boolean().optional(),                                       // affects switchboard / EV-charger work
    phase: z.enum(['single', 'three', 'unknown']).optional(),
  }).optional(),
  risks: z.array(z.string()),                                                // burning smell, tripping breakers, water damage, asbestos, old switchboard
  inspection_required: z.boolean(),                                          // true for switchboard, fault_finding, ev_charger, renovation, anything with mains/underground
  caller: z.object({
    name: z.string(),
    phone: z.string(),
    email: z.string().optional(),
  }),
  timing: z.object({
    urgency: z.enum(['emergency', 'this_week', 'this_month', 'flexible']).optional(),
    preferred_date: z.string().optional(),
  }).optional(),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  confidence_reason: z.string(),
})

export type Intake = z.infer<typeof IntakeSchema>
