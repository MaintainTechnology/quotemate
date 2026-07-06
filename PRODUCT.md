# Product

## Register

brand

## Users

**Primary customer the design must convert — Australian homeowners** receiving a quote. They get an SMS with a link, open the mobile quote page on their phone, and decide whether to trust this tradie and pay a deposit. Context: on a phone, often comparing tradies, wary of being overcharged, deciding in minutes. They are not logged in and will not read documentation — the page has one shot to read as legitimate, clear, and fair.

**Primary product user the tools serve — Australian tradies.** Electricians (NSW) and plumbers (QLD) today, with solar, roofing and painting rolling out. A customer texts or calls the tradie's dedicated QuoteMax number; QuoteMax asks the right questions, applies the tradie's own pricing book, and drafts a Good / Better / Best quote in under a minute. The tradie reviews, tweaks and sends from the dashboard. Context: on the tools, on a phone or laptop between jobs, no patience for admin. Secondary audiences: prospective tradies during self-serve onboarding, and investors/operators viewing the marketing site.

**The job to be done:** turn an inbound enquiry into a sent, trusted, paid quote with near-zero tradie effort — and make the customer-facing quote look premium enough that the homeowner pays a deposit on the spot.

> Register note: `brand` is the default because the two most-crafted surfaces (the marketing landing `/` and the customer quote page `/q/[token]`) are where design *is* the product and drives conversion. The larger tradie/admin tool layer (`/dashboard`, `/admin`, `/onboard`, auth) is a **secondary `product` register** — override per task when working those surfaces.

## Product Purpose

QuoteMax is an AI quoting assistant for Australian tradies. It answers the tradie's line 24/7 (SMS + voice), interviews the customer, prices the job against the tradie's own pricing book, and drafts a clean Good/Better/Best quote in under a minute. The tradie reviews and sends; the customer views a mobile quote page and pays a per-tier deposit. Success is the customer-facing quote converting (deposit paid) while the tradie's effort drops to a quick review. The design's core job: make an automatically-drafted quote feel *more* premium and trustworthy than one the tradie would have hand-typed.

## Brand Personality

**Premium · Technical · Command-centre.** The voice is a licensed Australian tradie who respects your time — direct, plain, present-tense, a little dry. Never a Silicon Valley marketer. Declarative and imperative: state what happens, in order ("Customer texts your number. QuoteMax drafts the quote. You review, send, get paid."). Australian English always (colour, organise, licence/license, "tradie", "sparky", "on the tools"). Restrained punctuation: **no exclamation marks, no em-dashes in customer copy, no emoji**, no marketing fluff ("leverage", "seamless", "revolutionary", "supercharge" are banned). Proof is honest — real pilot status, the real stack, concrete defensible numbers. The emotional goal is confidence and trust, not delight or hype.

## Anti-references

- **Generic SaaS.** No soft gradients, pill buttons, centered heroes, purple/violet accents, or glassmorphism. The brief is "command-centre, not SaaS".
- **Consumer-cutesy / playful.** No rounded, illustrated, emoji-heavy or toy-like treatments. Zero emoji, ever.
- **Cheap template / builder look.** Nothing that reads as assembled from Wix / Squarespace / Framer stock blocks. Bespoke structure, honest proof, one disciplined accent.
- **The retired identity.** The old navy `#0E1622` + orange `#FF5A1F` "Maintain" palette (and the vendored `maintain-design-system` skill) are deprecated — superseded by warm charcoal + Caterpillar yellow. Do not reintroduce it.
- Also avoid: fabricated stats, invented reviews, fake logos, and future-tense hedging ("will be able to") where a plain statement will do.

## Design Principles

1. **The quote is the pitch.** The customer-facing quote page is where trust becomes a paid deposit. Design every element to answer the homeowner's silent questions — is this tradie legit, is this price fair, can I pay now — before any decorative goal.
2. **Command-centre, not SaaS.** Premium technical confidence, built from structure: borders and lit edges over drop shadows, film grain and a topographic field over flat fills, heavy all-caps display. Depth is earned, not decorated.
3. **Restraint reads as premium.** One accent (Caterpillar yellow), square corners, nothing on the page that isn't earning its place. What's left out signals as much as what's put in.
4. **Honest proof, tradie voice.** Real numbers, real pilot status, real stack — never fabricated. Copy sounds like a licensed Aussie tradie who respects your time: present-tense, plain, Australian English, no fluff, no exclamation marks, no emoji.
5. **Fast and frictionless.** Customers decide on a phone in minutes; tradies work between jobs. Mobile-first, quick to scan, quick to act — clarity and speed beat cleverness.

## Accessibility & Inclusion

- **Target: WCAG 2.1 AA.** Body text ≥ 4.5:1, large text ≥ 3:1. The palette is engineered for it — text on a yellow fill is always dark charcoal `#1C1812` (never white, which fails on yellow ~1.4:1); `text-dim` is tuned to ≥ 4.5:1 on cards.
- **Keyboard & focus:** a visible 2px `accent-soft` focus ring at 2px offset is always present and never removed.
- **Motion:** `prefers-reduced-motion` collapses all animation to instant; motion is motivated, never required to read content.
- **Themes:** dark ("command-centre") is primary; a light ("warm paper") theme ships for device preference / manual pin. Yellow-as-text falls back to charcoal on cream, so emphasis survives via weight in light mode.
- **Mobile-first:** 44px minimum hit targets; the customer quote page is designed phone-first.
