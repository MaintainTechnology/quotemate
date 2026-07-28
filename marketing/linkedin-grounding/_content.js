/* ════════════════════════════════════════════════════════════════════
   "THE MODEL IS NOT ALLOWED TO WRITE A PRICE", 6 slides.

   One argument, made properly. Every competitor in this space will claim
   speed, so speed is not a position. The defensible one is the opposite of
   what people expect from an AI product: the model cannot produce a number.

   The mechanism described here is real, not marketing. From the codebase:
   estimation runs tool-calling only (lib/estimate/tools.ts), every line item
   must derive from pricing_book + shared_assemblies + the tenant's own
   assemblies scoped to the trade, and lib/estimate/validate.ts downgrades the
   entire quote to the $99 inspection route if any line fails that check. The
   roofing, solar and painting pricers are pure functions with no model in the
   money path at all.

   Nothing here overstates it. "Cannot" is accurate: the model is given tools,
   not a calculator, and the validator is a hard gate rather than a nudge.
   ════════════════════════════════════════════════════════════════════ */
const SLIDES = [

{ n:1, kind:'bigtype', plate:['peaks-glow','center 80%'],
  kick:['THE PART NOBODY ADVERTISES'],
  head:'Our AI is not allowed to {write a price}.',
  hsize:78,
  copy:'That sounds like a missing feature. It is the whole design. Here is what happens instead, and why it is the only version of this we were willing to ship.' },

{ n:2, kind:'grid', plate:['geo-wire','center 78%'],
  kick:['THE DIFFERENCE'],
  head:'Two things get called {AI quoting}.',
  hsize:60,
  cells:[['THE COMMON ONE','A model writes a number','It has read a lot of quotes, so it produces something that looks like one. Nobody can tell you where the figure came from.'],
         ['THIS ONE','A model looks a number up','It runs the conversation, then calls your rate book for every line. It has no way to invent one.']],
  note:'A number that looks right and a number that {is} right are not the same product.' },

{ n:3, kind:'steps', plate:['wire-site-a','center 80%'],
  kick:['WHERE THE FIGURE COMES FROM'],
  head:'Every line, {looked up}.',
  steps:[['01','IT WORKS OUT THE JOB','Reads the photos and the answers, decides what the job actually is.'],
         ['02','IT CALLS YOUR BOOK','Your rate, your call-out minimum, your assemblies. A lookup, not a guess.'],
         ['03','IT WRITES THE WORDS AROUND IT','The model does the sentence. The number was already decided.']] },

{ n:4, kind:'grid', plate:['node-net','center 76%'],
  kick:['THE CHECK ON EVERY QUOTE'],
  head:'One bad line kills {the whole quote}.',
  hsize:58,
  cells:[['WHAT IS CHECKED','Every single line','Each one has to trace back to your book, for that trade.'],
         ['IF ONE FAILS','The quote is void','Not the line. The quote. It does not go out at all.'],
         ['WHAT YOU SEE','It in your dashboard','Flagged, with the reason, before any customer sees anything.'],
         ['WHAT THEY SEE','Nothing','A wrong price never reaches them, because it never exists.']] },

{ n:5, kind:'bigtype', plate:['peaks-wire','center 80%'],
  kick:['THE FALLBACK'],
  head:'When it cannot price it, {nobody guesses}.',
  hsize:70,
  copy:'The job books a $99 site visit instead, and the $99 comes straight back off the work when you win it. A paid look beats a made-up number, for you and for them.' },

{ n:6, kind:'close',
  kick:['THE POINT'],
  head:'Trust the number, because {the model never chose it}.',
  copy:'QuoteMax is live in Australia across eight trades. The conversation is AI. The money is not.',
  cta:'quotemax.com.au  →',
  terms:['NO INVENTED FIGURES','YOUR BOOK, EVERY LINE','$0 COMMISSION','14-DAY FREE TRIAL'] },
];
