import { createClient } from '@supabase/supabase-js'
import { structureIntake } from '@/lib/intake/structure'
import { embedIntake } from '@/lib/intake/embed'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const { callId } = await req.json()

  // 1. Load the call transcript
  const { data: call } = await supabase.from('calls').select('*').eq('id', callId).single()
  if (!call) return Response.json({ error: 'call not found' }, { status: 404 })

  // 2. Structure it
  const intake = await structureIntake(call.transcript, call.photo_urls)

  // 3. Embed it for similarity search
  const embedding = await embedIntake(intake)

  // 4. Save it
  const { data: intakeRow } = await supabase.from('intakes').insert({
    call_id: callId,
    job_type: intake.job_type,
    address: intake.address,
    suburb: intake.suburb,
    scope: intake.scope,
    access: intake.access,
    property: intake.property,
    risks: intake.risks,
    inspection_required: intake.inspection_required,
    caller: intake.caller,
    timing: intake.timing,
    confidence: intake.confidence,
    confidence_reason: intake.confidence_reason,
    embedding,
  }).select().single()

  // 5. Hand off to Stage 05 — the Estimation Engine
  fetch(`${process.env.APP_URL}/api/estimate/draft`, {
    method: 'POST',
    body: JSON.stringify({ intakeId: intakeRow!.id }),
  })

  return Response.json({ ok: true, intakeId: intakeRow!.id })
}
