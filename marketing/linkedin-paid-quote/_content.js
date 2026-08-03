/* ════════════════════════════════════════════════════════════════════
   QUOTING IS WORK, refs 80 to 84.

   The argument: three tradies quote the same job and two of them work for
   free. Every other profession charges for the assessment. QuoteMax drafts
   most quotes without a visit at all, and when a visit is genuinely needed the
   customer pays $99, refundable and credited to the final quote.

   PHOTOGRAPHY. One source, split into two. The supplied frame is a composite:
   a tradie crammed in a roof cavity above, an operator holding a tablet
   reading "PAID BOOKING: $99" below. Split at the white band it becomes the
   whole argument in two pictures, the problem above and the answer below, and
   it drops straight into the frames this project already uses.

   TWO CONSTRAINTS THE SOURCE IMPOSES, both handled in split.mjs and here:
     1. The lower panel's tablet interface is AI-garbled ("Search
        fropdiecales", "40,25 mm" for a roof area). It is never used above
        622px wide, where it scales to about 43% and reads as interface rather
        than as words. "PAID BOOKING: $99" is large enough to survive that.
        It is NEVER used full-bleed. The hero frame uses the roof cavity,
        which carries no text at all.
     2. A "RELIA-ROOFING" wall logo was cropped out at x 0.78. It is an
        invented company and beside QuoteMax claims it would read as a named
        customer, which there is no basis to imply.

   CLAIMS. Every product claim here is real: the $99 site visit exists, it is
   credited back off the work, quotes draft in under a minute, roofs measure
   off satellite imagery, pricing comes from the tradie's own rate book. What
   is NOT claimed anywhere on these graphics is volume or traction, because
   the money path is running in test and not collecting at scale. That caveat
   belongs in the caption, in the poster's own voice, and it is there.

   "2 IN 3" is arithmetic off the post's own premise, not a survey, and the
   source line on 80 says so in as many words.
   ════════════════════════════════════════════════════════════════════ */
const D=[

/* ── 80 · THE HOOK. The flagship, and the one to post. ─────────────
   Roof cavity above, paid booking below, slashed apart, with the whole
   argument in one column beside them. */
{n:80,tag:'VIEW',kind:'stack',
 up:['roof-cavity','center center'],dn:['paid-booking','center center'],
 kick:'THE MATHS OF QUOTING',head:'Two of the three {worked for free}.',
 big:'2 IN 3',src:'[ARITHMETIC, NOT A SURVEY] &middot; three tradies quote the same job, one wins it, and the other two are paid nothing for the drive, the roof cavity or the write-up.',
 body:[
  'Drive out, park, measure up, get in the roof cavity, drive back, write it up that night at the kitchen table. Then wait. Then hear nothing.',
  'So we built the opposite. Most jobs never need a visit. When one does, the customer pays [$99] to book it.'],
 foot:'QUOTING IS WORK'},

/* ── 81 · Who else charges. The columns carry the shape, the copy carries
   the detail, and the shorter right-hand column is the whole point. */
/* Roof cavity, not the tablet. A 540px column crops the tablet frame to 39% of
   its width, which means it is DISPLAYED at about 86% of source size, not
   shrunk. The garbled interface text came out fully legible, along with the
   name badge. Cropping harder scales up, not down. The roof cavity carries no
   text at all, so it is safe at any size. */
{n:81,tag:'VIEW',kind:'versus',pic:['roof-cavity','center center'],
 kick:'EVERY OTHER PROFESSION',head:'Only trades give away {the diagnosis}.',
 vs:[
   ['THEY CHARGE FOR IT',['A VET','AN INSPECTOR','A CONVEYANCER']],
   ['WE GIVE IT AWAY',['-A TRADIE'],true]],
 copy:'A vet charges a consult. A building inspector charges hundreds before they say a word. A conveyancer bills to read a contract.',
 foot:'THE ASSESSMENT IS THE PRODUCT'},

/* ── 82 · The mechanism. Hero frame, so the photograph is full bleed, which
   is why it has to be the roof cavity: the tablet frame carries garbled
   interface text that only survives at small sizes. */
{n:82,tag:'EDU',kind:'figure',pic:['roof-cavity','center 62%'],
 src:'THE SITE VISIT <i>&middot; WHEN A JOB GENUINELY NEEDS EYES ON IT</i>',
 big:'$99',
 claim:'refundable, and credited to {the final quote}.',
 note:'Nobody serious blinks at $99. The ones who do blink were never going to sign. Either way the tradie is paid for the trip.',
 foot:'PAID FOR THE TRIP, EITHER WAY'},

/* ── 83 · The part people miss. The $99 is the exception, not the rule. */
{n:83,tag:'EDU',kind:'stack',
 up:['roof-cavity','center center'],dn:['paid-booking','center center'],
 kick:'BEFORE THE $99',head:'Most jobs {never need a visit}.',
 big:'<1 MIN',src:'[FROM THE CUSTOMER&rsquo;S TEXT] &middot; or the roof measured off satellite imagery, priced from the tradie&rsquo;s own rate book.',
 body:[
  'The quote is drafted and back with the customer before anyone has left the yard.',
  'The [$99] is for the jobs that genuinely need eyes on them. Not for the ones that do not.'],
 foot:'NO TRIP, NO CHARGE'},

/* ── 84 · The position, and the question. */
{n:84,tag:'VIEW',kind:'pair',
 left:{pic:['roof-cavity','center center'],label:'THE OLD DEAL',line:'Free, then silence.'},
 right:{pic:['paid-booking','center center'],label:'THE NEW DEAL',line:'Paid, then booked.'},
 src:'QUOTEMAX <i>&middot; THE SITE VISIT</i>',
 figs:[['$99','REFUNDABLE, CREDITED TO THE QUOTE']],
 claim:'Quoting is work. {Work gets paid for}.',cs:30,
 foot:'WOULD YOU CHARGE FOR A QUOTE'},
];
