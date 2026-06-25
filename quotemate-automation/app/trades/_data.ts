// Content for the four trade pages (/trades/[trade]). One data object per
// trade drives the shared TradePage template, so the pages stay on-brand
// and never drift. Copy rules: QuoteMax is the actor everywhere; no
// tiered-options wording, no payment-vendor name, Australian English.

export type TradeStep = { n: string; title: string; body: string }

export type TradeData = {
  slug: string
  name: string
  eyebrow: string
  /** Headline split so one phrase renders in the brand accent. */
  headline: { lead: string; accent: string; tail: string }
  intro: string
  heroImage: string
  detailImage?: string
  detailCaption?: string
  scopeBody: string
  scopeTags: string[]
  steps: TradeStep[]
  note: string
}

export const TRADE_ORDER = ["electrical", "plumbing", "roofing", "solar"] as const

export const TRADES: Record<string, TradeData> = {
  electrical: {
    slug: "electrical",
    name: "Electrical",
    eyebrow: "Electrical · NSW",
    headline: { lead: "Quote the job while you're still on ", accent: "the tools", tail: "." },
    intro:
      "Downlights to switchboard upgrades — a customer texts the job and QuoteMax drafts a clean, itemised quote against your own rates before you've packed up the ute.",
    heroImage: "/trades/electrical.jpg",
    scopeBody:
      "Standard jobs quote on the spot. Anything that needs eyes on site books a $99 inspection instead — credited straight back to the work.",
    scopeTags: [
      "Downlights",
      "Power points",
      "Ceiling fans",
      "Switchboard upgrades",
      "Safety switches",
      "EV chargers",
      "Rewires",
    ],
    steps: [
      {
        n: "01",
        title: "Capture the job",
        body: "The customer texts or calls your number with photos. QuoteMax asks the right questions for the job type — circuit count, access, switchboard age.",
      },
      {
        n: "02",
        title: "Apply your rates",
        body: "Every line is priced against your pricing book — hourly rate, call-out minimum and your electrical assemblies. Never a made-up number.",
      },
      {
        n: "03",
        title: "Itemised quote in under a minute",
        body: "A clean quote lands in your dashboard with labour, materials and GST broken out. Approve as-is or tweak the lines.",
      },
      {
        n: "04",
        title: "Deposit and booked",
        body: "The customer pays a deposit on the quote page and the job drops onto your calendar.",
      },
    ],
    note: "Priced to NSW and NECA conventions. Your licence details print on every quote.",
  },

  plumbing: {
    slug: "plumbing",
    name: "Plumbing",
    eyebrow: "Plumbing · QLD",
    headline: { lead: "Quote the call you couldn't ", accent: "answer", tail: "." },
    intro:
      "Blocked drains, hot-water swaps, leak repairs — the customer texts the problem and QuoteMax drafts a priced quote against your rates while you're under a sink somewhere else.",
    heroImage: "/trades/plumbing.jpg",
    scopeBody:
      "Clear jobs quote instantly. The messy ones book a $99 site visit with the deposit already paid, so you only drive out to work that's locked in.",
    scopeTags: [
      "Blocked drains",
      "Hot-water systems",
      "Burst pipes",
      "Tap & toilet repairs",
      "Gas",
      "Rough-ins",
    ],
    steps: [
      {
        n: "01",
        title: "Capture the job",
        body: "The customer texts the symptoms and a photo. QuoteMax asks about fixtures, access and the property — the questions you'd ask on the phone.",
      },
      {
        n: "02",
        title: "Apply your rates",
        body: "Each line is priced against your pricing book and your plumbing assemblies, to QLD and QBCC conventions. Never a guess.",
      },
      {
        n: "03",
        title: "Itemised quote in under a minute",
        body: "Labour, materials and GST broken out in your dashboard. Approve it or adjust before it goes out.",
      },
      {
        n: "04",
        title: "Deposit and booked",
        body: "A deposit on the quote page confirms the job and books it in.",
      },
    ],
    note: "Priced to QLD and QBCC conventions. Your licence details print on every quote.",
  },

  roofing: {
    slug: "roofing",
    name: "Roofing",
    eyebrow: "Roofing",
    headline: { lead: "Quote the roof from the ", accent: "ground", tail: "." },
    intro:
      "Re-roofs, repairs, gutters and Colorbond — QuoteMax reads the structure, measures the area and drafts a quote against your rates without a second trip up the ladder.",
    heroImage: "/trades/roofing.jpg",
    detailImage: "/trades/roofing-2.jpg",
    detailCaption: "Multi-structure jobs are measured per roof.",
    scopeBody:
      "Every roofing quote lands in your dashboard for a quick check before it goes out — the numbers are yours to confirm.",
    scopeTags: [
      "Metal re-roofs",
      "Tile repairs",
      "Corrugated Colorbond",
      "Spandek",
      "Gutters & downpipes",
      "Leak repairs",
    ],
    steps: [
      {
        n: "01",
        title: "Read the roof",
        body: "Photos and the address come in. QuoteMax reads the structure, pitch and access — and splits a job across multiple roofs where it needs to.",
      },
      {
        n: "02",
        title: "Measure and apply your rates",
        body: "Area is measured per structure, then priced against your roofing rates and material — Corrugated or Spandek Colorbond.",
      },
      {
        n: "03",
        title: "Itemised quote",
        body: "A per-structure breakdown with labour, materials and GST. You review every line before it leaves your dashboard.",
      },
      {
        n: "04",
        title: "Deposit and booked",
        body: "A deposit on the quote page confirms the job and books it in.",
      },
    ],
    note: "Roofing quotes are review-first: nothing reaches the customer until you've checked it.",
  },

  solar: {
    slug: "solar",
    name: "Solar",
    eyebrow: "Solar",
    headline: { lead: "Quote a rooftop you've never ", accent: "seen", tail: "." },
    intro:
      "QuoteMax reads the address, checks the roof and the sun, sizes the system and drafts a quote against your rates and panel preferences — before you've driven out.",
    heroImage: "/trades/solar.jpg",
    detailImage: "/trades/solar-2.jpg",
    detailCaption: "Roof, orientation and shading read from the address.",
    scopeBody:
      "Clean estimates quote on the spot. Anything flagged routes to a site visit, so the easy ones move fast and the rest get a proper look.",
    scopeTags: [
      "Residential PV",
      "Panel & inverter selection",
      "Roof & shading checks",
      "Network & export limits",
      "Rebates noted",
    ],
    steps: [
      {
        n: "01",
        title: "Read the address",
        body: "Roof, orientation and shading are read from aerial imagery and sun data — no first visit needed.",
      },
      {
        n: "02",
        title: "Size the system",
        body: "QuoteMax sizes the array — kW, panel count and inverter — against your hardware preferences.",
      },
      {
        n: "03",
        title: "Itemised quote",
        body: "Hardware, install and GST broken out, with rebates noted. Yours to review before it sends.",
      },
      {
        n: "04",
        title: "Deposit and booked",
        body: "A deposit on the quote page confirms the job and books it in.",
      },
    ],
    note: "Clean estimates can release automatically; flagged jobs route to a site visit first.",
  },
}
