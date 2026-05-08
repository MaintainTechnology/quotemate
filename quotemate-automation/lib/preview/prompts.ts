// ═══════════════════════════════════════════════════════════════════
// AI preview prompts — per job_type templates for Gemini 2.5 Flash Image.
//
// Two surfaces:
//   1. PREVIEW   — buildPreviewPrompt(intake)
//      Uses the customer's actual photo as the reference image.
//      Gemini edits THAT photo to show the proposed work.
//
//   2. SAMPLES   — buildSamplePrompts(intake)
//      Three generic AI renders showing typical examples of similar
//      work. ALL THREE share the same fictional scene so the customer
//      sees a coherent "wide / close-up / in use" narrative — not
//      three random rooms. The orchestration in samples.ts generates
//      the WIDE shot first, then feeds it as a reference image to the
//      DETAIL and IN-USE prompts so they keep the same room.
//
// Accuracy goals (both surfaces):
//   - Exact count match — the model must show N fittings, not "some"
//   - Exact spec match — colour temp, dimmable, replace-vs-new
//   - Negative constraints — explicit "do not show X" lines
//   - Lower temperature on the API side (see samples.ts / generate.ts)
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

// Best-effort room name extracted from the structured scope description.
// Fallback to "room" so prompts never read "in your null".
function detectRoom(desc?: string | null): string {
  if (!desc) return 'room'
  const m = desc.match(/\b(lounge|living\s*room|kitchen|bedroom|bathroom|dining|study|hallway|garage|deck|patio|courtyard|backyard|laundry)\b/i)
  return m ? m[1].toLowerCase().replace(/\s+/g, ' ') : 'room'
}

// Map common color-temp phrases to a Kelvin range Gemini can render reliably.
function colorTempHint(temp?: string | null): string {
  if (!temp) return '2700K-3000K (warm white)'
  if (/cool/i.test(temp)) return '4000K-5000K (cool white)'
  if (/tri/i.test(temp)) return '3000K-5000K (tri-colour, render as warm 3000K)'
  if (/daylight|natural/i.test(temp)) return '5000K-6500K (daylight)'
  return '2700K-3000K (warm white)'
}

// Universal footer applied to every prompt. The label customises one line.
function footerText(label: 'preview' | 'wide' | 'detail' | 'lit' = 'preview'): string {
  const watermark =
    label === 'preview'
      ? `WATERMARK: small semi-transparent "AI PREVIEW" in bottom-right corner.`
      : `WATERMARK: small semi-transparent "AI SAMPLE" in bottom-right corner.`
  return [
    watermark,
    `STYLE: photorealistic, modern Australian residential interior, magazine-quality.`,
    `OUTPUT: a single image, 4:3 aspect, no text overlays beyond the watermark, no captions, no logos.`,
    `NEGATIVE: do NOT include people, pets, hands, text labels, ruler-style call-outs, or annotations.`,
  ].join('\n')
}

// ─── SHARED SCENE ANCHOR ─────────────────────────────────────────────
// Same description used in all 3 sample prompts so all 3 renders share
// the same fictional room. Combined with the wide → detail/lit reference
// chain in samples.ts, this gives a visually coherent triptych.
function sharedSceneAnchor(intake: PromptIntake): string {
  const room = detectRoom(intake.scope?.description)
  const ceiling = intake.access?.ceiling_type ?? 'flat plaster'
  return [
    `SHARED SCENE — ALL THREE SAMPLE IMAGES MUST SHOW THE SAME ROOM:`,
    `  Setting: a contemporary Australian residential ${room} interior`,
    `  Ceiling: ${ceiling}, painted matte white, ~2.7m height`,
    `  Walls: warm neutral cream / off-white painted plaster`,
    `  Flooring: blonde oak engineered timber, matte finish`,
    `  Furniture: minimalist — single sofa or armchair, low coffee table, no clutter`,
    `  Window: tall, sheer linen curtains, daylight visible outside`,
    `  Camera: eye-level, slightly off-centre, 35mm prime style, shallow depth-of-field`,
    `KEEP EVERYTHING ABOVE IDENTICAL across the wide / detail / in-use shots.`,
    `Same wall colour, same furniture position, same ceiling material, same camera framing.`,
    `Only the lighting + zoom changes between shots.`,
  ].join('\n')
}

// ─── JOB SPEC BLOCK ──────────────────────────────────────────────────
// A structured, bullet-style summary of EXACTLY what the customer
// requested. Surfaced near the top of every prompt so Gemini treats
// it as the dominant constraint, not a footnote. Returns null when
// the job_type isn't an easy-5 (no meaningful "after" to render).
function jobSpec(intake: PromptIntake): string | null {
  const count = intake.scope?.item_count ?? 0
  const room = detectRoom(intake.scope?.description)
  const ceiling = intake.access?.ceiling_type ?? 'flat plaster'
  const tempK = colorTempHint(intake.scope?.color_temp)
  const dimmable = intake.scope?.dimmable === true ? 'dimmable' : 'non-dimmable'
  const desc = (intake.scope?.description ?? '').trim()

  switch (intake.job_type) {
    case 'downlights':
      return [
        `JOB SPEC — RENDER MUST MATCH EXACTLY:`,
        `  · Job type: downlight installation`,
        `  · Count: EXACTLY ${count || 6} downlight fittings — count them, no more, no fewer`,
        `  · Room: ${room}`,
        `  · Ceiling: ${ceiling}`,
        `  · Colour temperature: ${tempK}`,
        `  · Dimming: ${dimmable}`,
        `  · Layout: evenly spaced grid pattern across the ceiling`,
        `  · Status: lights ON, beam visible from each fitting`,
        desc ? `  · Customer description: "${desc.slice(0, 200)}"` : '',
      ].filter(Boolean).join('\n')

    case 'power_points':
      return [
        `JOB SPEC — RENDER MUST MATCH EXACTLY:`,
        `  · Job type: GPO (general purpose outlet) installation`,
        `  · Count: EXACTLY ${count || 4} double GPOs — count them, no more, no fewer`,
        `  · Room: ${room}`,
        `  · Faceplate: white, AS/NZS 3112 standard Australian 3-pin double socket`,
        `  · Mounting height: standard ~30cm above skirting`,
        `  · Spacing: evenly distributed along the wall(s)`,
        desc ? `  · Customer description: "${desc.slice(0, 200)}"` : '',
      ].filter(Boolean).join('\n')

    case 'ceiling_fans':
      return [
        `JOB SPEC — RENDER MUST MATCH EXACTLY:`,
        `  · Job type: ceiling fan installation`,
        `  · Count: EXACTLY ${count || 1} ceiling fan${count > 1 ? 's' : ''}`,
        `  · Room: ${room}`,
        `  · Ceiling: ${ceiling}`,
        `  · Style: modern 3-blade, matte white or brushed nickel finish`,
        `  · Light kit: integrated LED downlight in the centre of the fan`,
        desc ? `  · Customer description: "${desc.slice(0, 200)}"` : '',
      ].filter(Boolean).join('\n')

    case 'smoke_alarms':
      return [
        `JOB SPEC — RENDER MUST MATCH EXACTLY:`,
        `  · Job type: hardwired photoelectric smoke alarm installation`,
        `  · Count: EXACTLY ${count || 4} smoke alarms`,
        `  · Room: ${room} / hallway`,
        `  · Fitting: small white circular, ~10cm diameter, AS 3786 compliant`,
        `  · Mounting: ${ceiling} ceiling, central position per Australian standard`,
        desc ? `  · Customer description: "${desc.slice(0, 200)}"` : '',
      ].filter(Boolean).join('\n')

    case 'outdoor_lighting':
      return [
        `JOB SPEC — RENDER MUST MATCH EXACTLY:`,
        `  · Job type: outdoor LED light installation`,
        `  · Count: EXACTLY ${count || 4} weatherproof IP-rated fittings`,
        `  · Mounting area: deck / eaves / outdoor wall`,
        `  · Colour temperature: ${tempK}`,
        `  · Status: lights ON, warm welcoming glow at dusk`,
        desc ? `  · Customer description: "${desc.slice(0, 200)}"` : '',
      ].filter(Boolean).join('\n')

    default:
      return null
  }
}

// ════════════════════════════════════════════════════════════════════
// PREVIEW prompt (single image, edits the customer's photo)
// ════════════════════════════════════════════════════════════════════

export function buildPreviewPrompt(intake: PromptIntake): string {
  const spec = jobSpec(intake)
  const room = detectRoom(intake.scope?.description)

  const header = [
    `You are an interior visualisation assistant for an Australian electrical contractor's customer preview.`,
    ``,
    `THE ATTACHED IMAGE IS THE CUSTOMER'S ACTUAL ROOM — taken before any electrical work has been done. Your job is to EDIT THAT IMAGE to show what it would look like with the proposed work completed. Treat it as the base scene, not as inspiration. Keep everything else identical.`,
  ].join('\n')

  const constraint = [
    `KEEP UNCHANGED: room layout, walls, floor, furniture, decor, ambient lighting, perspective, camera angle.`,
    `MODIFY ONLY: the specific fixture area for this job (ceiling for downlights/fans/smoke alarms, wall for GPOs, exterior surface for outdoor lighting).`,
    `STYLE: photorealistic, match the lighting + colour grading of the input photo.`,
    `WATERMARK: small semi-transparent "AI PREVIEW" in bottom-right.`,
    `OUTPUT: same aspect ratio + resolution as the input photo, no text overlays, no captions.`,
    `NEGATIVE: do NOT include people, pets, hands, text labels, annotations.`,
  ].join('\n')

  if (!spec) {
    // Out-of-scope job — caller should normally skip preview, but render
    // a generic prompt as a defensive fallback.
    return [
      header,
      ``,
      `PROPOSED WORK: ${intake.scope?.description ?? '(unspecified electrical work)'}`,
      ``,
      constraint,
    ].join('\n')
  }

  return [
    header,
    ``,
    spec,
    ``,
    `Modify the customer's ${room} photo so it shows the work above completed cleanly. The customer must be able to recognise their own room while seeing the proposed change.`,
    ``,
    constraint,
  ].join('\n')
}

// ════════════════════════════════════════════════════════════════════
// SAMPLE prompts (3 renders sharing one fictional scene)
// ════════════════════════════════════════════════════════════════════

export type SamplePromptSet = {
  // Generated FIRST. Text-only prompt, no reference image.
  // The wide shot becomes the visual anchor for the other two.
  wide: string
  // Generated SECOND, with the wide image attached as a reference.
  // Same room, zoomed in on a single fitting.
  detail: string
  // Generated SECOND (parallel with detail), with the wide image as reference.
  // Same room, dusk lighting, fittings illuminated.
  lit: string
}

export function buildSamplePrompts(intake: PromptIntake): SamplePromptSet | null {
  const spec = jobSpec(intake)
  if (!spec) return null

  const anchor = sharedSceneAnchor(intake)
  const room = detectRoom(intake.scope?.description)
  const tempK = colorTempHint(intake.scope?.color_temp)

  // ─── WIDE — anchor image (text-to-image) ───
  const wide = [
    `You are producing a series of three coherent sample images of an electrical install for a customer preview. THIS IS IMAGE 1 OF 3 — the WIDE SHOT.`,
    ``,
    spec,
    ``,
    anchor,
    ``,
    `THIS SHOT (WIDE):`,
    `  · Wide-angle view of the entire ${room} from ~2 metres back`,
    `  · All ${intake.scope?.item_count ?? 'requested'} fittings clearly visible in frame`,
    `  · Daytime ambient lighting through the window, fittings powered ON`,
    ``,
    footerText('wide'),
  ].join('\n')

  // ─── DETAIL — close-up using wide as reference ───
  const detail = [
    `THE ATTACHED IMAGE IS THE WIDE SHOT YOU JUST GENERATED. Now produce IMAGE 2 OF 3 — a CLOSE-UP DETAIL of one of the fittings from that exact same scene.`,
    ``,
    `KEEP IDENTICAL TO THE REFERENCE IMAGE:`,
    `  · Same ceiling material + colour`,
    `  · Same wall colour and texture`,
    `  · Same general lighting + colour grading`,
    `  · Same fitting style, same finish`,
    ``,
    `THIS SHOT (DETAIL):`,
    `  · Tight close-up of ONE fitting (one downlight / one GPO / one fan motor / one smoke alarm / one outdoor light)`,
    `  · Crisp focus on the fitting; rest of the scene falls into shallow bokeh`,
    `  · Beam pattern or face plate clearly visible`,
    `  · ${tempK} colour temperature visible in any emitted light`,
    ``,
    footerText('detail'),
  ].join('\n')

  // ─── LIT — same room, dusk, lights on ───
  const lit = [
    `THE ATTACHED IMAGE IS THE WIDE SHOT YOU JUST GENERATED. Now produce IMAGE 3 OF 3 — the SAME ROOM AT DUSK with the new fittings illuminating it.`,
    ``,
    `KEEP IDENTICAL TO THE REFERENCE IMAGE:`,
    `  · Exact same room — same furniture position, same wall colour, same ceiling, same camera angle`,
    `  · Same fittings, same count, same placement`,
    ``,
    `CHANGE ONLY:`,
    `  · Time of day: dusk through the window (deep blue / purple twilight outside)`,
    `  · Interior lighting: ${tempK} glow from the new fittings, cosy ambient atmosphere`,
    `  · Subtle warm reflections on the timber floor + furniture`,
    ``,
    footerText('lit'),
  ].join('\n')

  return { wide, detail, lit }
}
