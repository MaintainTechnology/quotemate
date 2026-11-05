# QuoteMax launch video: build prompt

Run this in Claude Code, opened at the repo root (`quoteMate/`).

## Your task

Build a 60-second, 16:9 motion-graphic promo video for QuoteMax in code with Remotion (React to MP4), then render it. The video launches QuoteMax on Mac, iPhone and the web, and shows what the product does for a tradie: the AI Receptionist, instant quotes, the dashboard, paid bookings and the trade tools.

Work autonomously. Don't stop to ask for approval; make sensible calls and list your assumptions in the final report. If a Remotion skill is available (for example `ecc:remotion-video-creation`), load it before you start.

## What QuoteMax is (ground truth, don't embellish)

QuoteMax is an AI quoting platform for Australian tradies. Each tradie gets a dedicated AU number. An AI Receptionist answers it 24/7 by SMS and voice and asks the right questions for the job type. QuoteMax prices the job from the tradie's own pricing book and drafts a Good / Better / Best quote in under a minute, delivered as a mobile quote page and a PDF. The tradie reviews, tweaks and sends it from the dashboard, or lets straightforward jobs auto-send. The customer pays a $99 refundable site visit online and picks a time from the tradie's booking calendar.

Trade tools: roofs measured from satellite imagery (area, pitch, structures), solar systems sized to the roof with the STC rebate applied, wall area for painting from street view, a pricing wizard, calibration from past invoices, a CRM, and Studio for flyers, QR codes and trust videos. Eight trades are live: electrical, plumbing, roofing, solar, painting, commercial painting, air conditioning and signage.

The website's promise, which the video echoes: "Drafts your quote before they hang up." Supporting lines from the site: "Three steps. You stay on the tools." and "Setup takes about three minutes." Starter Monthly includes a 14-day free trial.

Audience: Australian tradies (sparkies, plumbers, roofers, solar installers, painters) watching on a phone or laptop between jobs. The video's job: make a busy tradie think "that gets me my evenings back", then visit quotemax.com.au.

## Launch details (edit these before running if anything differs)

- Website: quotemax.com.au
- Platforms to announce: Mac, iPhone, Web
- Mac line: "Download for Mac at quotemax.com.au"
- iPhone line: "Download on the App Store"
- App Store badge: if Apple's official badge artwork exists at `video/quotemax-promo/public/badges/app-store.svg`, show it unaltered with clear space around it. Otherwise set the iPhone line as plain text. Never draw a look-alike badge or an Apple logo.
- Closing offer: "14-day free trial. Setup takes about three minutes."
- Demo business (fictional): Ridgeline Electrical, NSW. Demo customer: Sarah K., Newtown.
- Music and voiceover: none yet. The video must work with the sound off. You'll write the VO script.

## Read these first (source of truth)

1. `DESIGN.md`: colour tokens, type scale, elevation, named rules.
2. `PRODUCT.md`: brand voice, anti-references, the honest-proof rule.
3. `quotemate-automation/app/_components/BrandMark.tsx`: the logo's exact SVG path data, and `BrandLockup` (mark beside "QUOTE" stacked over "MAX").
4. `quotemate-automation/app/page.tsx`: the hero, "How it works" and app-download sections, for copy and tone.
5. `quotemate-automation/app/dashboard/page.tsx`: grep it for real UI labels only ("Review queue", "Search quotes, customers, jobs", "Held for you", "Paid out", "Review before send"). Don't read the whole file. `app/dashboard/_components/OverviewAnalytics.tsx` has the "Quotes / week" chart.

Hard boundaries: don't modify anything under `quotemate-automation/`, don't read `.env.local`, don't query Supabase or any live API, and don't use real customer names, addresses, phone numbers or quote links. Never show a full phone number on screen.

## Brand rules (non-negotiable)

Colour (warm, never blue-black):
- Canvas `#16120F`, sunken `#1E1813`, card `#2B2422`, hairline border `#3A322C`.
- Text: primary `#F6F1EA`, secondary `#C3B8AC`, labels `#A2968A`.
- Accent: Caterpillar yellow `#FFC400` (press `#E6AC00`, soft `#FFD23D`). One accent only, roughly 10% of any frame at most, marking the one thing that matters: the key word, the price or the CTA.
- Text and icons on yellow are always `#1C1812`, never white.
- Status colours only as small chips: success `#34D27B`, warning `#F59E0B`.
- No purple, blue, teal, gradient backgrounds, glassmorphism or neon glow. The old navy `#0E1622` and orange `#FF5A1F` identity is retired.

Type:
- Manrope for display and body, JetBrains Mono for labels, prices, timestamps and numbers. Load both with `@remotion/google-fonts` (Manrope 400 to 800, JetBrains Mono 400 to 700).
- Display and headlines: Manrope 800, ALL CAPS, left-aligned (never centred), letter-spacing -0.04em, line-height 0.95. Highlight one or two words in yellow.
- Labels: JetBrains Mono 600, uppercase, letter-spacing 0.18em, colour `#A2968A`.
- Every price and number: JetBrains Mono with tabular figures.
- Sizes at 1920x1080: display 120 to 150px, headline 88 to 110px, title 40 to 48px, body 32 to 36px (Manrope 500), labels 22 to 26px. Nothing the viewer must read goes below 22px.

Surfaces: depth comes from 1px hairline borders, a lit top edge (`inset 0 1px 0 rgba(255,255,255,0.06)`), about 4.5% film grain and slow topographic contour lines in `#6E6354` / `#4A4136`. No drop shadows except on floating overlays, and those are warm-tinted. Corners: buttons 8px, cards 14 to 16px, no pill buttons.

Logo: rebuild the mark from the `BrandMark.tsx` path data as an SVG component. On the dark canvas the body is `#FFFFFF` and the notch is `#E3C13C`. Keep that exact gold; don't "correct" it to `#FFC400`. The wordmark is "QUOTE" stacked over "MAX" in Manrope 800, white, leading 0.82. Don't use `public/brand/quotemax-logo-horizontal-*.svg`; it carries the old mark.

Copy, for every on-screen string and the VO:
- Australian English. Plain, present tense, dry and confident. It should sound like a licensed tradie, not a marketer.
- No exclamation marks, no emoji, no em-dashes (use full stops or " · ").
- Banned words: leverage, seamless, revolutionary, supercharge, game-changer, unlock, effortless, cutting-edge.
- No invented stats, testimonials, star ratings, customer counts or time-saved figures. Numbers inside UI mockups are demo data. Headline claims are limited to: 24/7, under a minute, eight trades, $99 refundable site visit, 14-day free trial, setup in about three minutes.
- Don't mention Android, percentage deposits or "no tradie involvement" (the tradie reviews, or chooses auto-send). No vendor or partner logos (Stripe, Twilio, Google, Anthropic, Apple) apart from the official App Store badge if it is supplied.
- Keep "iPhone" and "Mac" in their correct casing everywhere, even inside all-caps layouts; set them in a non-uppercase style.
- Put every on-screen string in `src/copy.ts` so copy can be linted and edited in one place.

## Technical spec

- A standalone Remotion project at `video/quotemax-promo/`, outside the Next app so the app's package.json is untouched. Scaffold it by hand (`package.json`, `src/index.ts`, `src/Root.tsx`) instead of using an interactive CLI. Use the latest stable Remotion, with every `remotion` and `@remotion/*` package on the same exact version. Add a `.gitignore` for `node_modules/` and `out/`.
- One composition, id `QuoteMaxPromo`: 1920x1080, 30 fps, exactly 1800 frames (60.0 s).
- Structure: `src/theme.ts` (tokens), `src/config.ts` (launch details and optional audio paths), `src/copy.ts` (all strings), `src/components/` (BrandMark, Lockup, Eyebrow, Headline, MonoNumber, Chip, Grain, TopoField, PhoneFrame, LaptopFrame, BrowserFrame, Cursor), `src/scenes/S01Hook.tsx` to `S09EndCard.tsx`, and `src/Video.tsx`.
- Drive all motion from `useCurrentFrame()` with `interpolate`, `spring` and `Easing`. No CSS transitions or keyframes, no `setTimeout`, no `Math.random()` (use Remotion's `random(seed)`). Anything else renders non-deterministically.
- Scene changes: hard cuts on the beat, plus the in-scene transitions described below. If you use `@remotion/transitions`, lengthen the scenes to compensate so the total stays exactly 1800 frames.
- Assets: copy what you use into `video/quotemax-promo/public/` and load it with `staticFile()`. Trade photos come from `quotemate-automation/public/marketing/*.jpg`. Treat them as a warm duotone (greyscale, tinted toward the canvas, 15 to 30% opacity, blurred wherever text sits on top). Optional background plates: `redesign/DesignSystem/assets/graphics/` (darkened, low opacity).
- Grain: a static noise SVG (feTurbulence) used as an image and shifted every 2 frames. Don't re-render a full-frame filter every frame; it's slow.
- Rebuild the UI as simplified React components with demo data, not screenshots. Device frames are generic and minimal (thin bezel, rounded corners), with no Apple logos and no copied iOS or macOS system UI.
- Maps and roofs are stylised vector drawings. Never use Google Maps or satellite imagery, or any real address.
- Audio: if `config.musicSrc` or `config.voiceoverSrc` is set, add `<Audio>`. Music fades in over 15 frames and out over the last 30, and ducks to 0.25 under the VO. With both unset, the video stands on its own.

## Motion language

- 120 BPM grid: 1 beat = 15 frames, 1 bar = 60 frames. Every scene boundary and key hit lands on a multiple of 15.
- Entrances take 12 to 18 frames with `Easing.bezier(0.16, 1, 0.3, 1)` or `spring({ damping: 200 })`, with no overshoot. Exits take 8 to 10 frames, or are a hard cut on the beat.
- Headlines assemble word by word: each word rises 24px and fades in, with a 3-frame stagger, top line first.
- Numbers count up over 18 to 24 frames and settle exactly on a beat.
- Camera: slow push-ins (scale 1.00 to 1.04 across a scene). Device reveals may tilt up to 6 degrees in 3D, then settle flat.
- Recurring motif, "the signal": a 2px `#FFC400` hairline that wipes across the frame at key moments (the logo reveal, some scene changes, the end card).
- Not allowed: bounce or elastic easing, spins, glitch, RGB split, lens flares, particles, confetti. Restraint reads as premium.

## Storyboard: one job, from text to booked

The spine of the video is a single job moving through the product. Sarah texts Ridgeline Electrical, QuoteMax drafts the quote, the tradie approves it on the dashboard, and Sarah pays and books. Timings are frames at 30 fps.

### S1 · Hook (frames 0 to 150, 0:00 to 0:05)
- Visual: canvas and grain, with the duotone `home-on-the-tools.jpg` at about 20% on a slow push-in. Missed-call and message cards (card surface, hairline, lit edge) stack in from the right with a 2px buzz: "MISSED CALL · 7:42 AM", "MISSED CALL · 10:15 AM", "NEW MESSAGE · Can you quote a hot water…", "MISSED CALL · 1:03 PM".
- On screen, left-aligned: "ON THE TOOLS ALL DAY." from frame 15, then "QUOTING ALL NIGHT." from frame 60, with "ALL NIGHT." in yellow.
- Out: the cards collapse into the yellow signal line at frame 135, then a hard cut at 150.
- VO: "On the tools all day. Quoting all night."

### S2 · The promise (frames 150 to 270, 0:05 to 0:09)
- Visual: the signal line draws across. The mark resolves (scale 0.94 to 1, with the notch arriving 6 frames after the body), and "QUOTE / MAX" wipes in beside it.
- Eyebrow: "AI QUOTING FOR AUSTRALIAN TRADIES"
- Headline: "DRAFTS YOUR QUOTE BEFORE THEY HANG UP.", with "QUOTE" and "HANG UP." in yellow as on the website.
- VO: "QuoteMax drafts your quote before they hang up."

### S3 · AI Receptionist (frames 270 to 600, 0:09 to 0:20)
- Eyebrow: "01 · AI RECEPTIONIST". Headline (left): "ANSWERS EVERY CALL AND TEXT." Label: "SMS · VOICE · 24/7".
- Right: a phone frame with an SMS thread. The contact is "Ridgeline Electrical" and the time is 7:42 PM. Typing indicators, then these bubbles:
  1. Sarah: "Hi, can I get a quote to swap 3 downlights to LED and add a power point in the kitchen?"
  2. QuoteMax: "Sure can. What suburb is it in, and is it single or double storey?"
  3. Sarah: "Newtown. Single storey." Then a small "PHOTO RECEIVED" card with a stylised ceiling thumbnail (a drawing, not a photo of a real home).
  4. QuoteMax: "Thanks Sarah. Drafting your quote now."
- Around frame 480 a voice card slides over: "INCOMING CALL · 11:48 PM", a live waveform and a two-line transcript: "The hot water's leaking from the bottom of the tank." / "Got it. Is it gas or electric, and roughly how old is it?" This covers voice and after-hours in one beat.
- VO: "Your AI receptionist answers every call and text, day or night, and asks the right questions for the job."

### S4 · Instant quote (frames 600 to 810, 0:20 to 0:27)
- Eyebrow: "02 · INSTANT QUOTES". Headline: "PRICED FROM YOUR BOOK." Sub: "Good, better, best. Drafted in under a minute."
- Three cards rise with a stagger: GOOD $385, BETTER $520, BEST $695, each with "INC GST" in mono. Line items type in, for example "3 × dimmable LED downlights", "Double power point with USB-C", "Safety test + compliance certificate". BETTER gets a yellow top rule and a "RECOMMENDED" tag (charcoal on yellow).
- Chips: "EVERY PRICE FROM YOUR PRICING BOOK" and "MOBILE QUOTE PAGE + PDF". A mono draft timer ticks to 00:48 and stops.
- Match cut out: in the last 15 frames the BETTER card shrinks and flies toward the spot where S5's review-queue row appears.
- VO: "It prices the job from your own pricing book. Good, better, best. Drafted in under a minute."

### S5 · Dashboard (frames 810 to 1080, 0:27 to 0:36)
- Eyebrow: "03 · YOUR DASHBOARD". Headline: "YOUR COMMAND CENTRE." Sub: "Review it. Tweak it. Send it. Or let it auto-send."
- A laptop frame reveals (the tilt settles flat, with a slow push-in). The dashboard UI has:
  - a left nav (Overview, Review queue, Quotes, CRM, Roofing, Painting, Solar, Studio, Pricing), matching the real labels where they exist;
  - the search field "Search quotes, customers, jobs";
  - KPI tiles counting up: NEW LEADS 31, QUOTES SENT 23, BOOKED 11, HELD FOR YOU $1,089;
  - a "Quotes / week" bar chart that grows;
  - review-queue rows: "Sarah K. · Newtown · Electrical · Better $520" (arriving from S4), "Mick T. · Penrith · Roofing · $14,850", "Priya S. · Ryde · Painting · $6,420".
- A cursor clicks "Approve & send", the frame's one yellow button, and a small green "Sent to customer" toast appears.
- VO: "Everything lands in your dashboard. Review it, tweak it, send it. Or let it send itself."

### S6 · Paid and booked (frames 1080 to 1230, 0:36 to 0:41)
- Eyebrow: "04 · PAID AND BOOKED". Headline: "THEY PAY. THEY BOOK."
- Phone frame, step by step:
  1. Sarah's quote page: Ridgeline Electrical header, tier summary, and a yellow CTA "Book site visit · $99 refundable".
  2. A tap opens a neutral "Secure checkout · $99.00" sheet, with no Stripe or card-network logos.
  3. The calendar picks Thursday 8:00 AM.
  4. A "BOOKED" stamp.
- A notification lands on the laptop: "Sarah K. paid $99 · Site visit Thu 8:00 AM".
- VO: "The customer pays, picks a time, and you're booked."

### S7 · Built for your trade (frames 1230 to 1500, 0:41 to 0:50)
- Eyebrow: "05 · TRADE TOOLS". Headline: "BUILT FOR YOUR TRADE."
- A five-tile bento grid (ROOFING wide on the top row beside SOLAR; PAINTING, PRICING BOOK and STUDIO on the bottom row). One tile lands every 30 frames, each with a stylised vector visual and mono readouts:
  - ROOFING · "Measured from satellite imagery": a top-down roof outline traced in yellow hairlines. ROOF AREA 186.4 m² · PITCH 22.5° · 2 STRUCTURES
  - SOLAR · "Sized to the roof": a panel grid snaps onto the roof. 6.6 kW SYSTEM · STC REBATE APPLIED
  - PAINTING · "Wall area from street view": a house elevation wireframe with the walls highlighting. WALL AREA 212 m²
  - PRICING BOOK · "Your rates, your markup": HOURLY $110 · MARKUP 25% · CALIBRATE FROM PAST INVOICES
  - STUDIO · "Flyers, QR codes, trust videos"
- Frames 1380 to 1500: a yellow marquee bar with charcoal text scrolls ELECTRICAL · PLUMBING · ROOFING · SOLAR · PAINTING · COMMERCIAL PAINTING · AIR CONDITIONING · SIGNAGE, under the headline "EIGHT TRADES. ONE PLATFORM."
- VO: "Roofs measured from satellite. Solar sized to the roof. Walls measured for paint. Eight trades, one platform."

### S8 · Now on Mac, iPhone and the web (frames 1500 to 1680, 0:50 to 0:56)
- Eyebrow chip: "NOW AVAILABLE". Headline: "YOUR QUOTING LINE, IN YOUR POCKET.", with "IN YOUR POCKET." in yellow. Sub: "Now on Mac, iPhone and the web."
- Three devices glide in on consecutive beats and lock into a row: a laptop (the dashboard), a phone (the receptionist inbox) and a browser window (quotemax.com.au). Each has a label beneath it in correct casing: "Mac", "iPhone", "Web".
- Below them, the App Store line or badge (per Launch details) and "Download for Mac at quotemax.com.au".
- VO: "Now on Mac, iPhone and the web. Your quoting line, in your pocket."

### S9 · End card (frames 1680 to 1800, 0:56 to 1:00)
- Left-aligned: the lockup, then the headline "GET YOUR QUOTEMAX." with "QUOTEMAX." in yellow. Below it the sub "14-day free trial. Setup takes about three minutes.", the URL "quotemax.com.au" large in JetBrains Mono, and a small line "Mac · iPhone · Web" in Manrope 600 (not uppercase).
- The signal line sweeps once, then everything holds still for the final 30 frames, giving a clean last frame for thumbnails and loops.
- VO: "QuoteMax. Try it free for fourteen days."

## Also produce

- `video/quotemax-promo/voiceover.md`: the full VO script with timecodes (about 115 words, calm Australian delivery), ready for a voice actor or TTS.
- `video/quotemax-promo/out/captions.srt`: captions timed to the VO.
- `video/quotemax-promo/README.md`: how to preview (`npx remotion studio`), render, edit copy in `src/copy.ts` and `src/config.ts`, and add music or a VO file.

## Build loop and QA

1. Read the source-of-truth files. Then scaffold the project and build `theme.ts`, the fonts and the shared components.
2. Build the scenes in order. After each scene, render 2 or 3 stills (for example `npx remotion still src/index.ts QuoteMaxPromo out/stills/s03-f0450.png --frame=450`). Open them, look at them properly and fix anything off before moving on.
3. Render a half-scale draft first (`--scale=0.5`) to check timing. Then do the full render: `npx remotion render src/index.ts QuoteMaxPromo out/quotemax-promo-1080p.mp4 --codec=h264 --crf=18`. If it's slow, run it in the background.
4. Verify before you report done:
   - Duration is exactly 1800 frames, 60.0 s (check with `npx remotion ffprobe` or the render log).
   - Check one still per scene for: no clipped or overflowing text; all text inside 96px side margins and 80px top and bottom margins; yellow is the only accent and stays near 10% of the frame or less; text on yellow is charcoal; the fonts are really Manrope and JetBrains Mono, not a fallback.
   - Copy lint over `src/copy.ts` and `voiceover.md`: no "!", no em-dash, no emoji, no banned words, "iPhone" and "Mac" cased correctly, Australian spelling.
   - The logo matches the `BrandMark.tsx` path data and the notch is `#E3C13C`.
5. Final report: the output paths, one line per scene on what it shows, any assumptions or deviations, and the 3 stills that best represent the video.
