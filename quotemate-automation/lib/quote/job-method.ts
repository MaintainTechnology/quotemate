// "How the job runs" + "What we bring" for the customer-view Job details
// section (electrical / plumbing).
//
// WHY THIS IS AUTHORED CONTENT, NOT DATA. Nothing in the schema describes a
// work method or a tool list: shared_assemblies carries prices, hours,
// row_assumptions (pricing PRECONDITIONS) and clarifying_questions (SMS intake
// prompts) — none of which is a process. A repo-wide search for
// tools_required / method_statement / swms / job_steps returns nothing in
// lib/, app/ or sql/. So this content had to come from somewhere, and there
// were three options:
//
//   1. an LLM at render time — rejected. Every figure and claim on the
//      customer quote surface is grounded by tool-calling + the grounding
//      validator (lib/estimate/validate.ts). Generating installation claims
//      inline would put customer-facing statements about how a licensed trade
//      performs its work OUTSIDE that envelope, and make them differ between
//      two loads of the same page.
//   2. a new column across all 63 shared_assemblies rows — a migration plus
//      63 rows of authored prose to solve a presentation problem.
//   3. THIS: a pure, deterministic map keyed on data the page already loads
//      (intakes.trade + intakes.job_type), reviewed once and identical on
//      every render.
//
// The content is standard Australian practice for the job type, deliberately
// generic about method and specific about sequence — it describes how work of
// this kind runs, which is what a customer wants to know before paying a
// deposit. It is NOT a per-quote commitment: callers render it under the
// `METHOD_DISCLAIMER` below so it can never read as a bespoke promise the
// tradie did not make.
//
// Pure — no DB, no React. Unit-tested in job-method.test.ts.

export type JobMethod = {
  /** Ordered steps — how a job of this type actually runs, start to finish. */
  steps: string[]
  /** Tools + test equipment brought to a job of this type. */
  tools: string[]
  /** Standards / certification that governs this trade's work. */
  compliance: string[]
}

/** Renders beneath the method so it never reads as a bespoke commitment. */
export const METHOD_DISCLAIMER =
  'Standard method and equipment for this type of work. Your tradie confirms the final method, materials and sequence on site.'

/* ── electrical ──────────────────────────────────────────────────────── */

const ELEC_OPEN = [
  'Confirm the scope with you on arrival and agree where we need access.',
  'Isolate the affected circuits at the switchboard, lock off, and prove dead before touching any wiring.',
]

const ELEC_CLOSE = [
  'Test the work — earth continuity, insulation resistance, polarity and RCD trip times — before anything is re-energised.',
  'Energise, run a functional test with you there, and show you the finished work.',
  'Clean the work area, take away all offcuts and packaging, and issue your certificate of compliance for the electrical work.',
]

const ELEC_TOOLS = [
  'Voltage tester and proving unit',
  'Insulation resistance and RCD/loop tester',
  '1000 V insulated hand tools',
  'Cordless drill and driver set',
  'Cable rods and fish tape',
  'Crimping tool and cable strippers',
  'Drop sheets and dust vacuum',
]

const ELEC_COMPLIANCE = [
  'All work carried out to AS/NZS 3000 (the Wiring Rules) by a licensed electrician.',
  'A certificate of compliance is issued for the electrical work on completion.',
]

/** job_type → the middle of the electrical sequence + any extra tools. */
const ELECTRICAL: Record<string, { steps: string[]; tools?: string[]; compliance?: string[] }> = {
  downlights: {
    steps: [
      'Set the fitting positions out with you, then check every one for joists, pipes and existing cabling before a single hole is cut.',
      'Cut the openings with a dust-extracted hole saw so the ceiling stays clean.',
      'Run and support the new cabling through the ceiling space, keeping the clearances from insulation that the Wiring Rules require.',
      'Terminate each fitting and its driver, then set the beam angle and the colour temperature you chose.',
    ],
    tools: ['Dust-extracted hole saw set', 'Joist and cable detector', 'Ceiling crawl board and head torch'],
  },
  power_points: {
    steps: [
      'Mark each outlet position with you, at the height you want it.',
      'Cut in the mounting blocks and run new cabling back to the switchboard or a suitable connection point.',
      'Terminate the outlets, fit the plates, and make good around every opening.',
    ],
    tools: ['Plasterboard saw and mounting blocks', 'Stud and cable detector'],
  },
  ceiling_fans: {
    steps: [
      'Check the mounting point carries the fan load and that the ceiling structure above it is sound.',
      'Fix the mounting bracket to structure — never to plasterboard alone.',
      'Run and terminate the fan and its speed control or wall switch.',
      'Balance the blades and check for wobble at every speed before we leave.',
    ],
    tools: ['Blade balancing kit', 'Structural fixings and bracing'],
  },
  smoke_alarms: {
    steps: [
      'Check the alarm positions against what your home requires — every bedroom, hallway and storey.',
      'Run the interconnect cabling so that every alarm sounds when any one of them triggers.',
      'Mount and terminate each alarm, then trigger-test the interconnection from every single unit.',
    ],
    tools: ['Smoke alarm test aerosol'],
    compliance: ['Photoelectric alarms supplied to AS 3786, interconnected and mains-powered.'],
  },
  outdoor_lighting: {
    steps: [
      'Walk the run with you and agree fitting positions, switching and the cable route.',
      'Run the cabling in suitable conduit or protection for an outdoor run, sealed at every entry.',
      'Mount and terminate the fittings using IP-rated enclosures and weatherproof glands.',
      'Aim each fitting after dark where the job needs it, so the light lands where you want it.',
    ],
    tools: ['Weatherproof glands and IP-rated enclosures', 'Conduit bender and cutters', 'Ladder or elevated platform as access requires'],
  },
  switchboard: {
    steps: [
      'Photograph and record the existing board, then agree the changeover window with you — the power is off for part of the day.',
      'Arrange the supply isolation, strip out the old gear and fit the new enclosure.',
      'Install and terminate the main switch and the RCBO/RCD protection, then label every circuit clearly.',
      'Verify each circuit and each RCD individually, and walk the finished board through with you.',
    ],
    tools: ['Torque screwdriver', 'Circuit label printer', 'Thermal camera'],
    compliance: ['Residual current protection installed to the current AS/NZS 3000 requirements.'],
  },
  oven_cooktop: {
    steps: [
      'Check the appliance load against the existing circuit and confirm what it needs.',
      'Install the dedicated circuit and the isolating switch the appliance requires.',
      'Connect the appliance and confirm it draws correctly under load.',
    ],
    tools: ['Clamp meter', 'Appliance connection kit'],
  },
  ev_charger: {
    steps: [
      'Assess your switchboard and supply capacity for the charger, including your maximum demand.',
      'Agree the charger position and the cable route with you.',
      'Install the dedicated circuit and its residual current protection, plus load management where your supply needs it.',
      'Mount and commission the charger, pair it to your app, and run a full charge test with your vehicle.',
    ],
    tools: ['Maximum demand logger', 'Charger commissioning app', 'Clamp meter'],
    compliance: ['Dedicated circuit and residual current protection to the EV charging requirements of AS/NZS 3000.'],
  },
  fault_finding: {
    steps: [
      'Take you through when the fault shows up and what it affects.',
      'Isolate and test circuit by circuit to narrow the fault down to its source.',
      'Confirm the cause, show you exactly what we found, and quote the repair before we carry it out.',
    ],
    tools: ['Cable tracer and fault locator', 'Clamp meter', 'Thermal camera'],
  },
  renovation: {
    steps: [
      'Set every point out with you against your plans before rough-in starts.',
      'Rough-in the cabling while the walls are open, and photograph the routes for your records.',
      'Return after the linings go on for fit-off — outlets, switches, fittings and the board work.',
      'Stage the work around the other trades so the site is never held up waiting on us.',
    ],
    tools: ['Cable rods and draw wire', 'Set-out marker and laser level'],
  },
}

/* ── plumbing ────────────────────────────────────────────────────────── */

const PLUMB_OPEN = [
  'Confirm the scope with you on arrival and locate your water meter and isolation valve.',
  'Isolate the supply and protect the work area before anything is opened up.',
]

const PLUMB_CLOSE = [
  'Pressure-test the work and check every joint for leaks before anything is closed up.',
  'Restore the supply, run each fixture with you, and check both flow and drainage.',
  'Clean down, take the old fittings and rubbish away, and hand over the warranty paperwork and any compliance certificate the work requires.',
]

const PLUMB_TOOLS = [
  'Pipe wrenches and multigrips',
  'Press-fit crimping tool',
  'Pipe cutter and deburrer',
  'Pressure test and leak detection gear',
  'Wet vacuum and drop sheets',
]

const PLUMB_COMPLIANCE = [
  'All work carried out to AS/NZS 3500 by a licensed plumber.',
  'A compliance certificate is issued where the work requires one.',
]

const PLUMBING: Record<string, { steps: string[]; tools?: string[]; compliance?: string[] }> = {
  blocked_drain: {
    steps: [
      'Locate the blockage from the nearest access point rather than guessing at it.',
      'Clear the line mechanically or with a high-pressure jetter, whichever suits the blockage and the pipe.',
      'Camera the line afterwards to confirm it is clear and to show you the cause.',
      'Report on the pipe condition, so you know whether it is a one-off or a recurring problem.',
    ],
    tools: ['Drain camera', 'High-pressure jetter', 'Electric eel / drain machine', 'Pipe locator'],
  },
  hot_water: {
    steps: [
      'Confirm the unit size and type against your household use and the available space.',
      'Isolate and drain the old unit, then disconnect and remove it.',
      'Set the new unit, connect water and the tempering valve, and fit the relief drain.',
      'Commission the unit, set the delivered temperature, and check every hot outlet in the house.',
    ],
    tools: ['Tempering valve kit', 'Thermometer', 'Appliance trolley'],
    compliance: ['Delivered hot water tempered to the required maximum temperature at sanitary fixtures.'],
  },
  tap_repair: {
    steps: ['Isolate and strip the tap down to identify the worn component.', 'Reseat or re-washer as the fault requires and reassemble.'],
    tools: ['Tap reseating tool', 'Spanner and seat kit'],
  },
  tap_replace: {
    steps: [
      'Confirm the replacement tapware suits the existing holes and spacing.',
      'Remove the old tapware and clean the mounting surface up.',
      'Fit and seal the new tapware, then check the flow and aerator.',
    ],
    tools: ['Basin spanner', 'Silicone and sealing tape'],
  },
  toilet_repair: {
    steps: ['Isolate and diagnose whether the fault is in the inlet valve, the outlet valve or the seal.', 'Replace the failed component and adjust the flush volume.'],
    tools: ['Cistern service kit'],
  },
  toilet_replace: {
    steps: [
      'Check the new pan matches your existing set-out and waste position.',
      'Isolate, remove the old pan and cistern, and clean the floor and waste up.',
      'Set, seal and fix the new pan, connect the cistern, and adjust the flush.',
    ],
    tools: ['Pan collar and sealant', 'Set-out gauge'],
  },
  gas_fitting: {
    steps: [
      'Confirm the appliance load against the existing gas supply and meter capacity.',
      'Run or modify the gas line in approved materials, supported and sleeved where required.',
      'Pressure-test the line and leak-test every joint.',
      'Commission the appliance, check combustion and flueing, and confirm it operates safely.',
    ],
    tools: ['Gas manometer', 'Leak detection solution', 'Combustion analyser'],
    compliance: ['Gas work carried out by a licensed gasfitter and certified on completion.'],
  },
  burst_pipe: {
    steps: [
      'Isolate the supply and stop the water loss first.',
      'Expose and locate the burst, protecting the surrounding area.',
      'Cut out the failed section and repair or replace it in matching material.',
      'Pressure-test the repair, then make good the opening.',
    ],
    tools: ['Pipe locator', 'Wet vacuum', 'Repair couplings'],
  },
  bathroom_renovation: {
    steps: [
      'Set the fixture positions out with you against your plans before anything is opened up.',
      'Rough-in the water and waste while the walls and floor are open, and photograph the routes for your records.',
      'Return after waterproofing and tiling for fit-off of every fixture and tapware.',
      'Commission the room, check every fall and drain, and stage around the other trades.',
    ],
    tools: ['Set-out gauge and laser level', 'Core drill', 'Fall gauge'],
  },
  cctv_inspection: {
    steps: [
      'Access the line at the nearest inspection opening.',
      'Camera the full run, recording as we go.',
      'Locate and mark the depth and position of any defect from the surface.',
      'Walk you through the footage and give you the recording.',
    ],
    tools: ['Drain camera with recorder', 'Sonde and pipe locator'],
  },
  prv_install: {
    steps: [
      'Measure your incoming mains pressure to size the valve correctly.',
      'Fit the valve on the incoming main with isolation either side of it.',
      'Set the downstream pressure and confirm it at the fixtures.',
    ],
    tools: ['Pressure test gauge', 'Isolation valves'],
  },
}

/* ── resolution ──────────────────────────────────────────────────────── */

type TradeMethod = {
  open: string[]
  close: string[]
  tools: string[]
  compliance: string[]
  jobs: Record<string, { steps: string[]; tools?: string[]; compliance?: string[] }>
  /** Middle steps when the job_type is unknown or missing. */
  fallback: string[]
}

const TRADES: Record<string, TradeMethod> = {
  electrical: {
    open: ELEC_OPEN,
    close: ELEC_CLOSE,
    tools: ELEC_TOOLS,
    compliance: ELEC_COMPLIANCE,
    jobs: ELECTRICAL,
    fallback: [
      'Carry out the work described in your quote, protecting the surrounding surfaces as we go.',
      'Run, support and terminate all new cabling to the Wiring Rules.',
    ],
  },
  plumbing: {
    open: PLUMB_OPEN,
    close: PLUMB_CLOSE,
    tools: PLUMB_TOOLS,
    compliance: PLUMB_COMPLIANCE,
    jobs: PLUMBING,
    fallback: [
      'Carry out the work described in your quote, protecting the surrounding surfaces as we go.',
      'Install and connect in approved materials, supported and sealed as required.',
    ],
  },
}

/** Unique, order-preserving. */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of items) {
    const k = s.trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/**
 * The method for a job, or null when this trade has no authored method.
 *
 * Returning null (rather than a vague generic list) is deliberate: roofing,
 * solar, painting and the rest are measured and quoted by entirely different
 * pipelines, and inventing a plausible-sounding electrical-shaped process for
 * them would be worse than showing nothing.
 */
export function jobMethod(
  trade: string | null | undefined,
  jobType?: string | null,
): JobMethod | null {
  const t = TRADES[(trade ?? '').trim().toLowerCase()]
  if (!t) return null

  const job = jobType ? t.jobs[jobType.trim().toLowerCase()] : undefined
  const middle = job?.steps ?? t.fallback

  return {
    steps: dedupe([...t.open, ...middle, ...t.close]),
    tools: dedupe([...t.tools, ...(job?.tools ?? [])]),
    compliance: dedupe([...t.compliance, ...(job?.compliance ?? [])]),
  }
}

/** True when this trade has an authored method (cheap gate for callers). */
export function hasJobMethod(trade: string | null | undefined): boolean {
  return Object.hasOwn(TRADES, (trade ?? '').trim().toLowerCase())
}
