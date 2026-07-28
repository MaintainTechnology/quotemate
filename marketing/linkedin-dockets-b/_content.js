/* ════════════════════════════════════════════════════════════════════
   DOCKET SET B, posts 31 to 60. Reference codes continue the series so a
   graphic from either batch is unambiguous.

   Batch A covered the fundamentals: the offer, the speed argument, the
   three-step loop, pricing, the trade list, the standard objections. None of
   that is repeated here. Batch B goes into territory A never touched:

     PER TRADE     what auto-quotes and what books a visit, trade by trade
     THE BUSINESS  the owner's problems, not the tradesman's
     THE GUARDRAILS how the model is actually constrained
     THE HARD NOS  the objections that get said out loud
     THE STANCE    what we will not do, and who shaped it

   Photography leads with the five frames batch A never used, then redistributes
   the rest against different posts and crops so the two batches do not read as
   the same set twice.

   Every figure is a real product fact. Nothing invented, no testimonials.
   ════════════════════════════════════════════════════════════════════ */
const D=[

// ── PER TRADE ─────────────────────────────────────────────────────
{n:31,tag:'EDU',kind:'list',pic:['sparky-switchboard','center 34%'],
 kick:'ELECTRICAL',head:'What auto-quotes, and {what does not}.',
 rows:[['DOWNLIGHTS, POINTS','Quoted on the spot'],['CEILING FANS, SWITCHES','Quoted on the spot'],['SWITCHBOARD UPGRADE','Books a site visit'],['FULL REWIRE','Books a site visit']],
 copy:'The line is drawn on what can be priced safely from photos and answers, not on job size.',
 foot:'ELECTRICAL, NSW CONVENTIONS'},

{n:32,tag:'PAIN',kind:'quote',pic:['plumber-repair','center 36%'],flip:true,
 kick:'NINE PM, BURST PIPE',head:'The best plumbing job of the week comes in {after hours}.',sm:true,
 by:'ON WHY THE LINE NEVER CLOSES',foot:'ANSWERED AT ANY HOUR'},

{n:33,tag:'EDU',kind:'pitch',pic:['roofer-measuring','center 32%'],
 kick:'ROOFING',head:'Some properties have {four roofs}.',
 copy:'A house, a carport, a patio and a shed do not share one measurement. QuoteMax splits the job per structure, measures each area, and prices them separately against your rate and material.',
 terms:['PER STRUCTURE','CORRUGATED OR SPANDEK','YOU CONFIRM THE NUMBERS'],
 foot:'MEASURED PER ROOF'},

{n:34,tag:'EDU',kind:'steps',pic:['solar-rooftop','center 24%'],
 kick:'SOLAR',head:'Sized from the roof {and the sun}.',
 steps:[['01','THE ADDRESS COMES IN','Roof, orientation and shading read from above.'],['02','THE ARRAY IS SIZED','kW and panel count, capped by roof and export limit.'],['03','THE REBATE IS APPLIED','Gross less STC, by your postcode zone.']],
 foot:'SOLAR, SIZED BEFORE YOU DRIVE'},

{n:35,tag:'EDU',kind:'list',pic:['painter-sprayer','center 26%'],flip:true,
 kick:'PAINTING',head:'Counted by surface, {not by feel}.',
 rows:[['WALLS','Measured room by room'],['CEILINGS','Counted separately'],['TRIM AND DOORS','Priced per item'],['PREP AND COATS','From your rate card']],
 copy:'A repaint is not one number. It is a lot of small ones, and every one comes from your card.',
 foot:'PAINTING, SURFACE BY SURFACE'},

{n:36,tag:'EDU',kind:'pitch',pic:['trade-painting','center 30%'],
 kick:'COMMERCIAL PAINTING',head:'Nothing priced goes out {until you release it}.',sm:true,
 copy:'Commercial and residential painting are review-required. The customer gets a holding message, you get the draft, and the price only reaches them when you press send.',
 terms:['REVIEW REQUIRED','NO PRICE UNTIL YOU SAY','HELD IN YOUR DASHBOARD'],
 foot:'YOU RELEASE THE PRICE'},

{n:37,tag:'EDU',kind:'pitch',pic:['hvac','center 28%'],flip:true,
 kick:'AIRCON',head:'It reads the plan {before you quote}.',
 copy:'Upload the floor plan and QuoteMax pulls room sizes, orientation and glazing out of it, then sizes the system. You get a recommendation to check, not a blank form to fill in.',
 terms:['PLANS READ','SYSTEMS SIZED','RECOMMENDATION TO CHECK'],
 foot:'AIRCON, SIZED FROM THE PLAN'},

{n:38,tag:'EDU',kind:'list',pic:['workshop','center 34%'],
 kick:'SIGNAGE',head:'Assessed against {the actual rules}.',
 rows:[['SITE PHOTOS','Read for placement'],['LOCAL RULES','Checked, not guessed'],['THE ASSESSMENT','Logged against the job']],
 copy:'Signage lives and dies on what the council allows. That gets checked before a price exists.',
 foot:'SIGNAGE, BY THE RULES'},

// ── THE BUSINESS ──────────────────────────────────────────────────
{n:39,tag:'AD',kind:'stat',pic:['carpenter-deck','center 40%'],flip:true,
 kick:'THE ADMIN MATHS',head:'Cheaper than {a day of admin}.',
 figs:[['$49','A MONTH, TO START'],['$0','COMMISSION, EVER'],['24/7','WITHOUT A ROSTER']],
 copy:'It does not take annual leave and it does not need a desk.',
 foot:'LESS THAN ONE MISSED JOB'},

{n:40,tag:'PAIN',kind:'list',pic:['home-on-the-tools','center 32%'],
 kick:'THE TWO-VAN PROBLEM',head:'The second van {doubled the paperwork}.',sm:true,
 rows:[['ONE VAN','You quote at night'],['TWO VANS','You quote at midnight'],['THREE VANS','You hire someone to quote']],
 copy:'Growth used to mean more admin. It does not have to.',
 foot:'SCALE WITHOUT THE DESK'},

{n:41,tag:'PAIN',kind:'quote',pic:['plumber-bathroom','center 24%'],
 kick:'FIRST IMPRESSION',head:'Your quote is the {only work} they have seen.',
 by:'ON WHY IT HAS TO LOOK RIGHT',foot:'A QUOTE THEY TRUST'},

{n:42,tag:'EDU',kind:'list',pic:['trade-carpentry','center 40%'],flip:true,
 kick:'CONSISTENCY',head:'Every quote looks the same. {Whoever sent it}.',sm:true,
 rows:[['THE FORMAT','Identical, every time'],['THE MATHS','GST, always right'],['YOUR LICENCE','On every one'],['THE TONE','Yours, not a template']],
 copy:'One apprentice quoting on a Friday should not look different to you on a Monday.',
 foot:'ONE STANDARD, EVERY QUOTE'},

{n:43,tag:'PAIN',kind:'stat',pic:['carpenter-level','center 22%'],
 kick:'MONDAY MORNING',head:'The weekend backlog is {already answered}.',sm:true,
 figs:[['SAT','ANSWERED'],['SUN','ANSWERED'],['MON 7AM','ALREADY QUOTED']],
 copy:'You open the dashboard to drafts to approve, not a list of people to ring back.',
 foot:'NO BACKLOG ON MONDAY'},

{n:44,tag:'PAIN',kind:'quote',pic:['landscaper-garden','center 26%'],
 kick:'SATURDAY LEADS',head:'The best enquiries come in when {you are not working}.',sm:true,
 by:'ON WEEKEND ENQUIRIES',foot:'THE LINE DOES NOT CLOCK OFF'},

{n:45,tag:'EDU',kind:'steps',pic:['plumber-manifold','center 36%'],flip:true,
 kick:'CASH FLOW',head:'Paid something {before you start}.',
 steps:[['01','THE QUOTE GOES OUT','With a deposit link attached.'],['02','THEY PAY TO BOOK','Card payment confirms the job.'],['03','YOU TURN UP PAID','The deposit is already in.']],
 foot:'DEPOSIT BEFORE THE DRIVE'},

// ── THE GUARDRAILS ────────────────────────────────────────────────
{n:46,tag:'EDU',kind:'quote',pic:['trade-electrical','center 24%'],
 kick:'THE HARD LIMIT',head:'It cannot round up. {Your rate is your rate}.',sm:true,
 by:'ON WHAT THE MODEL CANNOT DO',foot:'NO CREATIVE PRICING'},

{n:47,tag:'EDU',kind:'steps',pic:['roofer-shingles','center 28%'],
 kick:'WHEN IT IS UNSURE',head:'It stops. {It does not guess}.',
 steps:[['01','IT ASKS AGAIN','One more question, in plain English.'],['02','STILL UNCLEAR','The quote drops to a paid site visit.'],['03','YOU GET TOLD','It lands in your dashboard either way.']],
 foot:'UNSURE MEANS STOP'},

{n:48,tag:'EDU',kind:'list',pic:['painter-brush','center 22%'],flip:true,
 kick:'WHO SEES IT FIRST',head:'Some trades you check first. {By design}.',sm:true,
 rows:[['ELECTRICAL, PLUMBING','Sends, you review after'],['ROOFING','Sends, you review after'],['SOLAR','Clean ones send, flagged ones wait'],['PAINTING','Waits for you, always']],
 copy:'The gate is set per trade, because the risk of a wrong number is not the same in each.',
 foot:'THE GATE FITS THE TRADE'},

{n:49,tag:'LEAD',kind:'list',pic:['fencer','center 24%'],
 kick:'WHOSE DATA',head:'Your customers are {yours}.',
 rows:[['YOUR CUSTOMER LIST','Yours'],['WE SELL LEADS','Never'],['WE SHARE YOUR LIST','Never'],['YOU LEAVE','You take it with you']],
 copy:'You are not renting access to your own customers.',
 foot:'YOUR LIST, YOUR BUSINESS'},

{n:50,tag:'EDU',kind:'pitch',pic:['solar-securing','center 32%'],
 kick:'IT WATCHES YOUR EDITS',head:'The corrections you make {get noticed}.',sm:true,
 copy:'When you adjust the same line the same way three times, that pattern gets surfaced for you to confirm. You approve the change to your book. It never changes itself.',
 terms:['PATTERNS SURFACED','YOU CONFIRM','YOUR BOOK, YOUR CALL'],
 foot:'IT LEARNS, YOU DECIDE'},

// ── THE HARD NOS ──────────────────────────────────────────────────
{n:51,tag:'LEAD',kind:'pitch',pic:['carpenter-level','center 26%'],flip:true,
 kick:'THE CUSTOM WORK OBJECTION',head:'{My jobs are too custom} for that.',sm:true,
 copy:'Some are. Those book the paid site visit instead of a guess, which is the point. The rest, the downlights and the hot water swaps and the repaints, are the ones eating your evenings.',
 terms:['CUSTOM WORK BOOKS A VISIT','THE REST AUTO-QUOTES','YOU KEEP BOTH'],
 foot:'CUSTOM STILL GETS A LOOK'},

{n:52,tag:'LEAD',kind:'pitch',pic:['sparky-portrait','center 28%'],
 kick:'THE TRUST OBJECTION',head:'{I would not trust AI} with my prices.',sm:true,
 copy:'Nor would we. That is why it cannot set one. Every figure is looked up from the book you loaded, and a quote that cannot be priced from it does not go out at all.',
 terms:['NO INVENTED FIGURES','LOOKED UP, NOT GENERATED','YOU APPROVE'],
 foot:'IT DOES NOT SET PRICES'},

{n:53,tag:'LEAD',kind:'pitch',pic:['plumber-bathroom','center 26%'],flip:true,
 kick:'THE PHONE OBJECTION',head:'{My customers would rather talk}.',
 copy:'Then it talks. The same line answers voice calls, asks the same questions, and drafts the same quote. Some people ring, some text. Both get answered.',
 terms:['VOICE AND SMS','SAME QUESTIONS','SAME QUOTE'],
 foot:'IT PICKS UP TOO'},

{n:54,tag:'LEAD',kind:'list',pic:['trade-plumbing','center 28%'],
 kick:'THE OTHER SOFTWARE',head:'It does not replace {your job book}.',
 rows:[['SCHEDULING','Keep what you use'],['INVOICING','Keep what you use'],['QUOTING','This is the bit we do'],['YOUR CRM','We push to it']],
 copy:'We are not trying to be your whole back office. We do the part that runs late at night.',
 foot:'ONE JOB, DONE PROPERLY'},

{n:55,tag:'LEAD',kind:'pitch',pic:['trade-solar','center 30%'],
 kick:'THE SIZE OBJECTION',head:'{I am a one-man band}.',
 copy:'That is exactly who loses the most to slow quoting, because there is nobody else to answer the phone. A sole trader gets the same line, the same tiers and the same $0 commission.',
 terms:['ONE VAN OR TEN','SAME PRICE','SAME LINE'],
 foot:'BUILT FOR SOLE TRADERS TOO'},

// ── THE STANCE ────────────────────────────────────────────────────
{n:56,tag:'AD',kind:'pitch',pic:['roofer-portrait','center 26%'],flip:true,
 kick:'WHO BUILT IT',head:'Built with sparkies and plumbers. {Not at them}.',sm:true,
 copy:'The pricing model, the questions it asks, the point where it refuses to guess. All of it came out of arguments with tradies who quote for a living.',
 terms:['PILOT CREWS SHAPED IT','STILL DO','TELL US WHAT IS WRONG'],
 foot:'BUILT ON THE TOOLS'},

{n:57,tag:'AD',kind:'list',pic:['landscaper-paving','center 42%'],
 kick:'WHAT WE WILL NOT DO',head:'The things we {will never do}.',
 rows:[['TAKE A CUT','Never'],['SELL YOUR LEADS','Never'],['SELL YOUR LIST','Never'],['LOCK YOU IN','Never']],
 copy:'A quoting tool that competes with you for your own work is not a tool. It is a middleman.',
 foot:'NO MIDDLEMAN, NO CUT'},

{n:58,tag:'EDU',kind:'stat',pic:['roofer-measuring','center 36%'],flip:true,
 kick:'WHERE IT IS UP TO',head:'Live, and {still being built}.',
 figs:[['8','TRADES LIVE'],['3','CHANNELS ANSWERED'],['1','JOB, DONE PROPERLY']],
 copy:'SMS, voice and web forms, across eight trades, in Australia today.',
 foot:'LIVE IN AUSTRALIA'},

{n:59,tag:'LEAD',kind:'pitch',pic:['hvac','center 32%'],
 kick:'PASS IT ON',head:'Know a tradie {quoting at midnight}?',sm:true,
 copy:'Send them this. If they win work by quoting it and they are still typing them up after dinner, the fourteen days will pay for themselves before the trial is out.',
 act:'Send them the link  →',terms:['14-DAY FREE TRIAL','NO CARD DRAMA','ABOUT 3 MINUTES'],
 foot:'TELL A MATE'},

{n:60,tag:'AD',kind:'pitch',pic:['carpenter-deck','center 36%'],flip:true,
 kick:'LAST THING',head:'Stop quoting. {Start working}.',
 copy:'One Australian number. It answers, asks, prices from your book and drafts. You review, send, get paid, and get back on the tools.',
 act:'quotemax.com.au  →',terms:['FROM $49/MO','$0 COMMISSION','CANCEL ANY TIME'],
 foot:'YOU WILL NEVER QUOTE AGAIN'},
];
