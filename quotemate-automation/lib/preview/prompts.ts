// ═══════════════════════════════════════════════════════════════════
// AI preview prompts — per job_type templates for Gemini 2.5 Flash Image.
//
// Two surfaces:
//
//   1. PREVIEW   — buildPreviewPrompt(intake)
//      ONE call per uploaded customer photo. Each call edits the
//      customer's actual photo to show the proposed work.
//
//   2. SAMPLES   — buildSamplePrompts(intake)
//      Three text-to-image renders (wide / close-up / in-use). The
//      room is a generic fictional Aussie home — Gemini is free to
//      compose the scene naturally — but the FITTINGS (count, type,
//      colour temp, layout) must match the customer's spec exactly.
//
//      We deliberately do NOT use the customer's photo as a reference
//      for samples. Constraining the model to a real room makes count
//      accuracy WORSE because the room may not have natural placement
//      slots for N fittings. Text-to-image gives the model freedom to
//      compose around the spec.
//
// Each prompt is split into two parts:
//   - system  — role + non-negotiable rules. Sent in Gemini's
//     systemInstruction field (highest priority).
//   - user    — the specific job brief for this shot. Sent in
//     contents[0].parts[0].text.
//
// Splitting them this way makes the rules feel authoritative ("you
// MUST do X") rather than mixed in with the brief, which empirically
// improves constraint adherence on Gemini Flash Image.
// ═══════════════════════════════════════════════════════════════════

export type PromptIntake = {
  job_type: string
  scope?: {
    item_count?: number | null
    description?: string | null
    color_temp?: string | null
    dimmable?: boolean | null
  } | null
  access?: {
    ceiling_type?: string | null
    wall_type?: string | null
  } | null
  caller?: { name?: string | null } | null
}

export type SystemUserPrompt = {
  system: string
  user: string
}

function detectRoom(desc?: string | null): string {
  if (!desc) return 'room'
  const m = desc.match(/\b(lounge|living\s*room|kitchen|bedroom|bathroom|dining|study|hallway|garage|deck|patio|courtyard|backyard|laundry)\b/i)
  return m ? m[1].toLowerCase().replace(/\s+/g, ' ') : 'room'
}

function colorTempHint(temp?: string | null): string {
  if (!temp) return '2700K-3000K (warm white)'
  if (/cool/i.test(temp)) return '4000K-5000K (cool white)'
  if (/tri/i.test(temp)) return '3000K-5000K (tri-colour, render as warm 3000K)'
  if (/daylight|natural/i.test(temp)) return '5000K-6500K (daylight)'
  return '2700K-3000K (warm white)'
}

function fittingNoun(jobType: string, plural: boolean): string {
  switch (jobType) {
    case 'downlights':       return plural ? 'downlights' : 'downlight'
    case 'power_points':     return plural ? 'double GPOs' : 'double GPO'
    case 'ceiling_fans':     return plural ? 'ceiling fans' : 'ceiling fan'
    case 'smoke_alarms':     return plural ? 'smoke alarms' : 'smoke alarm'
    case 'outdoor_lighting': return plural ? 'outdoor light fittings' : 'outdoor light fitting'
    default:                 return plural ? 'fittings' : 'fitting'
  }
}

// Ordinal-listed placement: "FIRST smoke alarm: position X. SECOND: Y. THIRD: Z."
// This is empirically more effective than "EXACTLY 3 of X" because the model
// can verify against an enumerated list rather than a single number.
function ordinalPlacements(intake: PromptIntake): string[] {
  const count = intake.scope?.item_count ?? 0
  const n = Math.max(1, count)
  const ord = (i: number) =>
    ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH'][i] ?? `#${i + 1}`

  switch (intake.job_type) {
    case 'downlights': {
      // Even grid spacing across the ceiling
      const positions = Array.from({ length: n }, (_, i) => `${ord(i)} downlight: position ${i + 1} of ${n} in an even ceiling grid`)
      return positions
    }
    case 'power_points': {
      const positions = Array.from({ length: n }, (_, i) => `${ord(i)} double GPO: position ${i + 1} of ${n} along the wall, ~30cm above skirting, evenly spaced`)
      return positions
    }
    case 'ceiling_fans': {
      if (n === 1) return [`${ord(0)} ceiling fan: centred on the ceiling`]
      return Array.from({ length: n }, (_, i) => `${ord(i)} ceiling fan: position ${i + 1} of ${n}, one per room area, all visible in frame`)
    }
    case 'smoke_alarms': {
      // Per AS 3786 typical layout
      const slots = [
        'on the hallway ceiling near the bedrooms',
        'on the living/dining room ceiling',
        'on the master bedroom ceiling',
        'on the second bedroom ceiling',
        'on the third bedroom ceiling',
        'on the additional hallway / staircase ceiling',
      ]
      return Array.from({ length: n }, (_, i) => `${ord(i)} smoke alarm: ${slots[i] ?? `position ${i + 1} of ${n} on the ceiling`} — small white circular ~10cm diameter, AS 3786 compliant, mounted flush`)
    }
    case 'outdoor_lighting': {
      return Array.from({ length: n }, (_, i) => `${ord(i)} outdoor light: position ${i + 1} of ${n} along the deck/eaves/outdoor wall, evenly spaced, weatherproof IP-rated`)
    }
    default:
      return [`${n} fittings`]
  }
}

// The non-negotiable rules block — sent as systemInstruction.
function commonSystemRules(): string {
  return [
    `You are a precision interior visualisation engine for an Australian electrical contractor's customer-facing quote previews.`,
    ``,
    `RULES YOU MUST FOLLOW (NON-NEGOTIABLE):`,
    ``,
    `1. RENDER COUNT IS LITERAL. If the user brief says "3 smoke alarms" you MUST render exactly 3 smoke alarms — not 2, not 4. If you cannot fit 3 in the frame at your initial composition, WIDEN the camera angle or restructure the scene until all 3 are clearly visible and individually countable.`,
    ``,
    `2. RENDER FITTING TYPE IS LITERAL. If the brief says "smoke alarms" you render WHITE CIRCULAR PHOTOELECTRIC SMOKE ALARMS, not generic ceiling lights. If it says "downlights" you render LED downlight fittings, not pendant lights. Match the exact fitting type the customer asked for.`,
    ``,
    `3. VIEW TYPE IS LITERAL. The brief specifies one of three view modes:`,
    `   · WIDE = pull-back, full-room shot, all fittings visible at once`,
    `   · CLOSE-UP = product-photography macro, ONE fitting fills 60-80% of frame, no other fittings visible`,
    `   · IN-USE = dusk/night interior, fittings as the dominant light source, all fittings visible and powered ON`,
    `   Do NOT mix view types. A close-up is never a wide. A wide is never a tight crop.`,
    ``,
    `4. NO PEOPLE, PETS, HANDS, TEXT OVERLAYS, CAPTIONS, ANNOTATIONS, OR LOGOS in the rendered image — only the watermark specified in the brief.`,
    ``,
    `5. PHOTOREALISTIC, MAGAZINE-QUALITY interior photography style. Modern Australian residential aesthetic.`,
    ``,
    `6. VERIFY BEFORE FINALISING. Before you commit the output, count the fittings in your draft. If the count is wrong, redraft. If the framing is wrong (e.g. wide where close-up was asked), redraft.`,
  ].join('\n')
}

// ─── JOB BRIEF (the customer-specific spec, used in the user message) ───
function jobBrief(intake: PromptIntake): string | null {
  const count = intake.scope?.item_count ?? 0
  const room = detectRoom(intake.scope?.description)
  const ceiling = intake.access?.ceiling_type ?? 'flat plaster'
  const tempK = colorTempHint(intake.scope?.color_temp)
  const dimmable = intake.scope?.dimmable === true ? 'dimmable' : 'non-dimmable'
  const desc = (intake.scope?.description ?? '').trim()
  const placements = ordinalPlacements(intake)

  let lines: string[] = []

  switch (intake.job_type) {
    case 'downlights':
      lines = [
        `JOB BRIEF — what the customer ordered:`,
        `  · Job type:           downlight installation`,
        `  · Total count:        ${count || 6} downlights (this is the literal number to render)`,
        `  · Customer's room:    ${room}`,
        `  · Ceiling type:       ${ceiling}`,
        `  · Colour temperature: ${tempK}`,
        `  · Dimming:            ${dimmable}`,
        `  · Status:             lights ON, beam visible from each fitting`,
      ]
      break
    case 'power_points':
      lines = [
        `JOB BRIEF — what the customer ordered:`,
        `  · Job type:           GPO (general purpose outlet) installation`,
        `  · Total count:        ${count || 4} double GPOs (this is the literal number to render)`,
        `  · Customer's room:    ${room}`,
        `  · Faceplate:          white, AS/NZS 3112 standard Australian 3-pin double socket`,
        `  · Mounting height:    ~30cm above skirting`,
      ]
      break
    case 'ceiling_fans':
      lines = [
        `JOB BRIEF — what the customer ordered:`,
        `  · Job type:           ceiling fan installation`,
        `  · Total count:        ${count || 1} ceiling fan${count > 1 ? 's' : ''} (this is the literal number to render)`,
        `  · Customer's room:    ${room}`,
        `  · Ceiling type:       ${ceiling}`,
        `  · Style:               modern 3-blade fan, matte white or brushed nickel`,
        `  · Light kit:          integrated LED downlight in the centre of the fan`,
      ]
      break
    case 'smoke_alarms':
      lines = [
        `JOB BRIEF — what the customer ordered:`,
        `  · Job type:           hardwired photoelectric smoke alarm installation`,
        `  · Total count:        ${count || 3} smoke alarms (this is the literal number to render)`,
        `  · Distribution:       across the home per AS 3786 (multi-room)`,
        `  · Fitting style:      small white circular, ~10cm diameter, AS 3786 compliant`,
        `  · Mounting:           flush on the ${ceiling} ceiling, central per Australian standard`,
      ]
      break
    case 'outdoor_lighting':
      lines = [
        `JOB BRIEF — what the customer ordered:`,
        `  · Job type:           outdoor LED light installation`,
        `  · Total count:        ${count || 4} weatherproof IP-rated fittings (this is the literal number to render)`,
        `  · Mounting area:      deck / eaves / outdoor wall`,
        `  · Colour temperature: ${tempK}`,
        `  · Status:             lights ON, warm welcoming glow at dusk`,
      ]
      break
    default:
      return null
  }

  if (desc) lines.push(`  · Customer's exact words: "${desc.slice(0, 240)}"`)

  // Add the ordinal placement checklist
  lines.push(``)
  lines.push(`PLACEMENT CHECKLIST — render each item in the list below. Tick them off as you compose:`)
  for (const p of placements) lines.push(`  ☐ ${p}`)

  // Repeat the count one more time
  const noun = fittingNoun(intake.job_type, true)
  lines.push(``)
  lines.push(`COUNT VERIFICATION: the final image MUST contain exactly ${count || placements.length} ${noun}. Count them: 1, 2, 3${count > 3 ? `… up to ${count}` : ''}. If short, redraft.`)

  return lines.join('\n')
}

// ════════════════════════════════════════════════════════════════════
// PREVIEW prompt — edits the customer's photo
// ════════════════════════════════════════════════════════════════════

export function buildPreviewPrompt(intake: PromptIntake): SystemUserPrompt {
  const brief = jobBrief(intake)
  const room = detectRoom(intake.scope?.description)

  const system = [
    commonSystemRules(),
    ``,
    `THIS TASK IS A PHOTO EDIT. The user message will include a reference photo of the customer's actual room. You must EDIT THAT PHOTO to show the proposed work installed. Do NOT generate a new room — modify the attached one. Keep walls, floor, furniture, decor, lighting, perspective, and camera angle identical. Only the relevant fixture area changes.`,
  ].join('\n')

  const userParts: string[] = []
  if (brief) userParts.push(brief)
  userParts.push('')
  userParts.push(`TASK — edit the attached customer photo of their ${room}:`)
  userParts.push(`  · Insert the fittings per the placement checklist above`)
  userParts.push(`  · Keep everything else in the photo unchanged (walls, floor, furniture, lighting)`)
  userParts.push(`  · Match the photo's existing colour grading + lighting style`)
  userParts.push('')
  userParts.push(`OUTPUT: a single edited image, same aspect ratio + resolution as the attached photo. Small "AI PREVIEW" watermark in the bottom-right corner.`)

  return {
    system,
    user: userParts.join('\n'),
  }
}

// ════════════════════════════════════════════════════════════════════
// SAMPLE prompts — three text-to-image renders, generic Aussie home
// ════════════════════════════════════════════════════════════════════

export type SamplePromptSet = {
  wide: SystemUserPrompt
  detail: SystemUserPrompt
  lit: SystemUserPrompt
}

export function buildSamplePrompts(intake: PromptIntake): SamplePromptSet | null {
  const brief = jobBrief(intake)
  if (!brief) return null

  const tempK = colorTempHint(intake.scope?.color_temp)
  const room = detectRoom(intake.scope?.description)
  const count = intake.scope?.item_count ?? 0
  const noun = fittingNoun(intake.job_type, true)
  const single = fittingNoun(intake.job_type, false)

  // Shared scene anchor used in all 3 prompts
  const sceneAnchor = [
    `SCENE — generic fictional Australian residential interior:`,
    `  · Setting:    a contemporary ${room} (no specific real customer)`,
    `  · Walls:      neutral cream / off-white painted plaster`,
    `  · Ceiling:    flat plaster, painted matte white`,
    `  · Flooring:   blonde oak engineered timber, matte finish`,
    `  · Furniture:  minimal — single sofa or armchair, low coffee table`,
    `  · Window:     daylight visible outside (unless the brief says otherwise)`,
    `Random/generic backgrounds are acceptable — but the FITTINGS in the foreground must follow the JOB BRIEF exactly.`,
  ].join('\n')

  // ─── WIDE ───
  const wideSystem = [
    commonSystemRules(),
    ``,
    `THIS TASK IS THE WIDE-SHOT IMAGE (1 of 3 in a series). Render a wide-angle interior scene that shows the proposed install at full room scale. ALL fittings from the brief must be visible and individually countable. Camera ~3-4 metres back, eye-level, slightly off-centre.`,
    ``,
    `EXPECTED FRAMING: the entire room — ceiling, walls, floor, all major furniture — visible in one frame. NOT a close-up. NOT a tight crop. PULL BACK until everything fits.`,
  ].join('\n')

  const wideUser = [
    brief,
    ``,
    sceneAnchor,
    ``,
    `THIS SHOT IS A WIDE-ANGLE OVERVIEW:`,
    `  · Camera: ~3-4 metres back, eye-level, daylight ambient lighting`,
    `  · ALL ${count || placementCountFromBrief(brief)} ${noun} visible in this single frame, individually countable`,
    `  · Fittings powered ON, beams or status indicators visible`,
    ``,
    `BEFORE YOU FINALISE: count the ${noun} you've drawn. Must be exactly ${count || 'as specified'}. If fewer, widen the angle and add more until correct.`,
    ``,
    `OUTPUT: 4:3 aspect, photorealistic. Small "AI SAMPLE" watermark in the bottom-right corner.`,
  ].join('\n')

  // ─── CLOSE-UP ───
  const detailSystem = [
    commonSystemRules(),
    ``,
    `THIS TASK IS A MACRO PRODUCT-PHOTOGRAPHY CLOSE-UP (2 of 3 in a series). You are NOT producing a room shot. You are producing a tight, intimate close-up of a SINGLE fitting from the brief — like a product-detail shot in a catalogue.`,
    ``,
    `EXPECTED FRAMING:`,
    `  · ONE single ${single} fills 60-80% of the frame`,
    `  · Camera ~30-50 centimetres from the fitting`,
    `  · Background: just enough context to tell where it is, but BLURRED in shallow depth-of-field`,
    `  · NO other fittings visible in the frame`,
    `  · NO wide-angle composition under any circumstances`,
    ``,
    `IF YOU PRODUCE A WIDE SHOT, A ROOM SHOT, OR MORE THAN ONE ${single.toUpperCase()} IN FRAME, THE OUTPUT IS WRONG. Redraft as a tight macro close-up.`,
  ].join('\n')

  const detailUser = [
    brief,
    ``,
    sceneAnchor,
    ``,
    `THIS SHOT IS A MACRO CLOSE-UP OF ONE ${single.toUpperCase()}:`,
    `  · Show ONLY ONE ${single} — the customer's chosen product type`,
    `  · The single ${single} fills 60-80% of the frame`,
    `  · Show its face plate, trim, finish, and surface texture in detail`,
    `  · ${tempK} colour temperature visible in any emitted light`,
    `  · Background: blurred ${room} ceiling/wall, soft bokeh — provides context only`,
    ``,
    `FORBIDDEN — DO NOT PRODUCE:`,
    `  ✗ A wide-angle room view`,
    `  ✗ Multiple ${noun} in the frame`,
    `  ✗ The ${single} smaller than 50% of the image`,
    ``,
    `OUTPUT: 4:3 aspect, photorealistic macro photography. Small "AI SAMPLE" watermark in the bottom-right corner.`,
  ].join('\n')

  // ─── IN-USE / DUSK ───
  const litSystem = [
    commonSystemRules(),
    ``,
    `THIS TASK IS AN IN-USE / DUSK INTERIOR (3 of 3 in a series). Render the same kind of room as the wide shot but at DUSK or EARLY NIGHT — the new fittings are now the dominant light source. ALL fittings from the brief must be visible and powered ON, just like the wide shot, but the time of day must be visibly different (dim / dusk through the windows).`,
    ``,
    `EXPECTED FRAMING: wide-angle, similar framing to the WIDE shot but at a different time of day. NOT a close-up.`,
  ].join('\n')

  const litUser = [
    brief,
    ``,
    sceneAnchor,
    ``,
    `THIS SHOT IS A DUSK / IN-USE INTERIOR:`,
    `  · Camera: ~3-4 metres back, similar framing to a wide shot`,
    `  · Time of day: DUSK or early night — windows show deep blue / purple twilight outside`,
    `  · Interior is dimmer than daytime; the new fittings provide the dominant light`,
    `  · Warm cosy ambient glow from the fittings, gentle reflections on floor + furniture`,
    `  · ALL ${count || placementCountFromBrief(brief)} ${noun} visible in this single frame, powered ON`,
    ``,
    `BEFORE YOU FINALISE: count the ${noun} powered on in the frame. Must be exactly ${count || 'as specified'}.`,
    ``,
    `OUTPUT: 4:3 aspect, photorealistic. Small "AI SAMPLE" watermark in the bottom-right corner.`,
  ].join('\n')

  return {
    wide: { system: wideSystem, user: wideUser },
    detail: { system: detailSystem, user: detailUser },
    lit: { system: litSystem, user: litUser },
  }
}

// Helper used in fallback messaging when intake.scope.item_count is null/0.
function placementCountFromBrief(brief: string): number {
  const m = brief.match(/Total count:\s+(\d+)/)
  return m ? parseInt(m[1], 10) : 1
}
