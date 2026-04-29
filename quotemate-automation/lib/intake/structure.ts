import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { IntakeSchema } from './schema'

export async function structureIntake(transcript: string, photoUrls: string[] = []) {
  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-6'),
    schema: IntakeSchema,
    system: `You extract structured intake data from electrical quoting calls.
Be conservative — if unsure, leave fields blank and lower confidence.

Surface real risks:
- burning smell, buzzing, sparks → mark inspection_required=true, urgency=emergency
- tripping breakers, recurring faults → mark inspection_required=true
- water damage near electrical fixtures → add to risks + inspection_required=true
- pre-1970 properties → flag asbestos / lead-paint risk on cabling work
- unknown switchboard age or ceramic fuses → recommend inspection
- difficult access (high ceilings, raked ceilings, no roof access, brick/concrete walls)
- mains, underground cabling, three-phase work → always inspection_required=true

Auto-quote candidates (inspection_required=false) when scope is clear and photos look clean:
downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting.

Always inspection_required=true: switchboard, ev_charger, fault_finding, renovation, and
any oven_cooktop / power_points / outdoor_lighting job that mentions new circuits, mains,
or switchboard work.`,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Transcript:\n${transcript}` },
        ...photoUrls.map(url => ({ type: 'image' as const, image: url })),
      ],
    }],
  })
  return object
}
