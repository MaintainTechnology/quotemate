// QuoteMax Brand Studio — starter content. Pure data (no JSX), so both the
// server render route and the client studio UI can import it.
import type { Slide } from './types'

// Default LinkedIn carousel (mirrors redesign/marketing/linkedin-carousel).
export const DEFAULT_CAROUSEL: Slide[] = [
  { kind: 'stat', photo: { src: '/studio/photos/hero-main.png', pos: 'center 28%', scrim: 'top' }, eyebrow: ['AI QUOTING', 'BUILT FOR AUSTRALIAN TRADIES'], lines: [['<1 MIN', 'QUOTES'], ['24/7', 'ANSWERED'], ['$0', 'COMMISSION']], sub: 'A customer texts your number. QuoteMax drafts the {quote} before they hang up.', proof: ['ELECTRICAL · NSW', 'PLUMBING · QLD', 'SOLAR + ROOFING ROLLING OUT'], bar: ['QUOTEMAX', 'YOU REVIEW, TWEAK, SEND', 'MAINTAIN.COM.AU'] },
  { kind: 'list', photo: { src: '/studio/photos/tools-flatlay.png', scrim: 'faint' }, eyebrow: ['WHY SPEED WINS'], h: 'The job goes to whoever {quotes first}.', cards: [['SAME-DAY QUOTE', 'You are in the running.'], ['NEXT-DAY QUOTE', 'They have already booked someone.'], ['NO QUOTE', 'You never hear back.']], sub: 'QuoteMax answers 24/7 and drafts the quote in {under a minute}.', bar: ['QUOTEMAX', 'SPEED IS THE JOB', 'MAINTAIN.COM.AU'] },
  { kind: 'steps', photo: null, eyebrow: ['HOW IT WORKS'], h: 'Three steps. {under a minute}.', steps: [['01', 'CUSTOMER TEXTS YOUR NUMBER', 'QuoteMax asks the right questions.'], ['02', 'IT DRAFTS THE QUOTE', 'Your pricing book. Good, Better, Best.'], ['03', 'YOU REVIEW AND SEND', 'Tweak if you want. Send. Get paid.']], bar: ['QUOTEMAX', 'YOUR PRICING BOOK, EVERY TIME', 'MAINTAIN.COM.AU'] },
  { kind: 'quote', photo: { src: '/studio/photos/sparky-yellow.png', pos: 'right 20%', scrim: 'left' }, eyebrow: ['ON THE TOOLS', 'CLIENT QUOTE'], quote: 'It quoted the job while I was still {on the ladder}.', attrib: ['{name}', '{trade} · {region}'], bar: ['QUOTEMAX', 'REAL TRADIES, REAL JOBS', 'MAINTAIN.COM.AU'] },
  { kind: 'cta', photo: { src: '/studio/photos/team-crew.png', pos: 'center 36%', scrim: 'top' }, eyebrow: ['GET STARTED'], h: 'Get your own {QuoteMax} number.', sub: 'Your dedicated line answers every customer and drafts the quote. You review, send, get paid.', btn: 'Get my QuoteMax  →', foot: ['$0 CUT OF YOUR JOBS', '$99 SITE VISIT', 'CANCEL ANYTIME'], bar: ['QUOTEMAX', 'DRAFTS YOUR QUOTE BEFORE THEY HANG UP', 'MAINTAIN.COM.AU'] },
]

// Photos available to the picker (pre-baked duotone under /public/studio/photos).
export const STUDIO_PHOTOS = [
  'hero-main', 'team-crew', 'sparky-yellow', 'tools-flatlay', 'ute-tablet',
  'electrician', 'plumber', 'plumber2', 'roofer', 'roofer2', 'solar', 'painter', 'carpenter',
] as const
