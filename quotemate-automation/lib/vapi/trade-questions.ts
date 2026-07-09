// Voice receptionist — spoken question blocks for the trades that DON'T have a
// lib/sms/assumptions.ts entry (roofing, painting, solar, aircon, commercial
// painting). electrical + plumbing questions are sourced straight from
// ASSUMPTION_RULES/mustAskLines in lib/sms/assumptions.ts by voice-prompt.ts,
// so voice and SMS can never drift — do NOT duplicate those here.
//
// Why these live as literal spoken strings and not imported from the SMS
// receptionists: roofing/painting are deterministic step-machines whose reply
// text is SMS-typed and coupled to their state enums; solar/aircon/commercial
// have no customer SMS conversation at all (web-form / dashboard / plan-upload).
// So there is no single SMS "question array" to import — these are derived
// faithfully from those flows' required inputs, reworded for the phone.
//
// PIPELINE REALITY (verified 2026-07-09): the Vapi post-call webhook only feeds
// /api/intake/structure, whose IntakeSchema.trade enum is ['electrical',
// 'plumbing']. Roofing/painting/solar/aircon/commercial each have their OWN
// measure/estimate pipelines the voice path never reaches. So for those trades
// voice can only QUALIFY + capture the lead — it must never imply an instant
// quote. The `mode` + `closing` below encode exactly that expectation.

export type VoiceTradeMode =
  | 'auto_quote' // electrical/plumbing — real quote drafts after the call
  | 'lead_qualify' // roofing/painting/solar — capture, hand to the trade pipeline
  | 'assessment' // aircon — always a site assessment; indicative only
  | 'tender_lead' // commercial painting — priced off an uploaded plan set

export type VoiceTradeBlock = {
  mode: VoiceTradeMode
  /** Spoken, ordered questions (phone-appropriate). One per turn. */
  questions: string[]
  /** What forces an on-site inspection / stops the auto-flow for this trade. */
  inspectionNote: string
  /** How the call CLOSES for this trade — sets the caller's expectation.
   *  Never promises an on-call price for a non-auto-quote trade. */
  closing: string
}

export const VOICE_TRADE_QUESTIONS: Record<string, VoiceTradeBlock> = {
  roofing: {
    mode: 'lead_qualify',
    questions: [
      "What's the property address — street, suburb and postcode?",
      'Read the address back and get a yes before moving on.',
      'What do you need done — a full re-roof, a repair or patch, a leak traced, or gutters and downpipes?',
      "What's the roof made of — Colorbond or metal, concrete or terracotta tiles, or fibro / cement sheet?",
      'Roughly how steep is it — flat, standard pitch, or steep?',
    ],
    inspectionNote:
      'Fibro / cement / asbestos sheet, a very steep or unknown pitch, or a leak trace all need a roofer on site — stop the questions and offer to book a site visit. Never ask the year the house was built.',
    closing:
      "We can't price a roof over the phone — I'll get a roofer to confirm the measurements off the satellite imagery and we'll send the quote through. No price on the call.",
  },

  painting: {
    mode: 'lead_qualify',
    questions: [
      "What's the property address, with suburb and postcode?",
      'Read the address back and get a yes.',
      'Which surfaces are we painting — interior walls, ceilings, trim, or exterior? (any combination)',
      'How many coats — one to refresh, two standard, or three for a premium finish?',
      'What condition are the surfaces in — sound, minor patching, bare, or poor with flaking or damage?',
      'How high are the ceilings — standard around 2.4 metres, high around 2.7, or raked / cathedral?',
      'How many storeys — single, double, or three or more?',
      'Are you changing the colour, say light to dark?',
    ],
    inspectionNote:
      'Poor / flaking surfaces, raked or extra-high ceilings, or 3+ storeys need an on-site measure — offer to book it instead of promising a figure.',
    closing:
      "We'll confirm the measure and get your painting quote across — no price on the call.",
  },

  solar: {
    mode: 'lead_qualify',
    questions: [
      "What's the property address?",
      'And the postcode?',
      'Which state?',
      "Roughly what's your quarterly power bill? (optional — skip if they don't know)",
      'Any panel-grade preference — standard, premium, or not sure?',
      'Is the property single-phase or three-phase power, or not sure?',
      'Any system size in mind, in kilowatts? (optional)',
    ],
    inspectionNote:
      "Address, postcode and state are the only ones you must get. 'Not sure' is a perfectly good answer on grade and phase — accept it and move on, don't push.",
    closing:
      "We can't size a solar system over the phone — our installer confirms the roof from satellite imagery and we'll send the design and quote through.",
  },

  aircon: {
    mode: 'assessment',
    questions: [
      "What's the property address?",
      'Postcode?',
      'Which state?',
      'What are the ceilings like — standard, high, or raked?',
      "How's the insulation — good, average, poor, or not sure?",
      'Are you after a brand-new system, replacing an old one, or adding to what you have?',
      'Which rooms are we cooling — how many bedrooms and how many living areas?',
    ],
    inspectionNote:
      'Address, postcode, state, ceiling height, insulation, the situation, and at least one room count are the minimum. Sizing always needs a site assessment — keep it indicative.',
    closing:
      "I'll get us out for a quick site assessment so we can size it properly — I can't give a firm price on the call, but we'll have it across straight after.",
  },

  commercial_painting: {
    mode: 'tender_lead',
    questions: [
      "What's the project name or the business?",
      "What's the site address?",
      "Do you have architectural plans or a scope you can send through? I'll text you an upload link and our estimator takes it from there.",
    ],
    inspectionNote:
      'Commercial painting is priced off the plan set — there is no surface-by-surface Q&A over the phone. Capture the project, the site and get the plans sent through.',
    closing:
      'Send the plans through on that link and our estimator will put the tender together — no price on the call.',
  },
}
