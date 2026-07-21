// lib/videos/trade-script.ts
//
// PURE — the per-trade half of a trust video.
//
// Only two things vary by trade: the spoken NOUN (so an electrical customer
// hears "quality electrical work" and a roofer's hears "quality roofing") and
// the visual SCENE (a sparky at a switchboard, a roofer on a rooftop). The
// branding stays identical across trades by design: same logo, same business
// name, same presenter. Keeping the variation this small is what lets one
// script template serve every trade.

import { normaliseVideoTrade } from './trade-videos'
import type { TrustVideoSlot } from './trust-video'

/** Noun that reads naturally in "just quality ___ built to last".
 *  Kept short: the default script is capped at MAX_SCRIPT_CHARS. */
const WORK_NOUN: Record<string, string> = {
  electrical: 'electrical work',
  plumbing: 'plumbing',
  roofing: 'roofing',
  signage: 'signage',
  painting: 'painting',
  commercial_painting: 'commercial painting',
  aircon: 'air conditioning',
  solar: 'solar',
}

/** Where the presenter stands. Uncapped (prompt text, not spoken), but kept
 *  to one clause so Veo does not lose the branding instruction after it. */
const SCENE: Record<string, Record<TrustVideoSlot, string>> = {
  electrical: {
    welcome: 'standing beside their branded work van outside an Australian suburban home, tidy switchboard visible behind them',
    thankyou: 'standing in a bright Australian home beside a finished switchboard, giving a warm nod of thanks',
  },
  plumbing: {
    welcome: 'standing beside their branded work van outside an Australian suburban home, holding a pipe wrench',
    thankyou: 'standing beside a newly installed hot water system in an Australian home, giving a warm nod of thanks',
  },
  roofing: {
    welcome: 'standing in front of their branded work vehicle outside an Australian suburban home with a tiled roof on a sunny day',
    thankyou: 'standing outside an Australian suburban home with a freshly finished roof behind them, giving a warm nod of thanks',
  },
  signage: {
    welcome: 'standing beside a freshly installed shopfront sign on an Australian street',
    thankyou: 'standing beside a finished illuminated sign at an Australian business, giving a warm nod of thanks',
  },
  painting: {
    welcome: 'standing in front of a freshly painted Australian weatherboard home, drop sheets tidy behind them',
    thankyou: 'standing in front of a freshly painted Australian home, giving a warm nod of thanks',
  },
  commercial_painting: {
    welcome: 'standing in front of a large Australian commercial building with fresh paintwork and scaffolding behind them',
    thankyou: 'standing in front of a finished Australian commercial building, giving a warm nod of thanks',
  },
  aircon: {
    welcome: 'standing beside a wall-mounted split system air conditioner in a bright Australian home',
    thankyou: 'standing in a cool bright Australian living room beside a new split system, giving a warm nod of thanks',
  },
  solar: {
    welcome: 'standing outside an Australian home with solar panels on the roof behind them on a clear sunny day',
    thankyou: 'standing outside an Australian home with a finished solar array behind them, giving a warm nod of thanks',
  },
}

const FALLBACK_SCENE: Record<TrustVideoSlot, string> = {
  welcome: 'standing in front of their branded work vehicle outside an Australian suburban home on a sunny day',
  thankyou: 'standing outside an Australian suburban home, giving a warm nod of thanks',
}

/** The spoken trade noun, or a neutral 'work' for an unknown/missing trade. */
export function tradeWorkNoun(trade: string | null | undefined): string {
  const key = normaliseVideoTrade(trade)
  return (key && WORK_NOUN[key]) || 'work'
}

/** The visual scene for this trade + slot, falling back to a generic
 *  Australian suburban scene so an unhubbed trade still films sensibly. */
export function tradeScene(trade: string | null | undefined, slot: TrustVideoSlot): string {
  const key = normaliseVideoTrade(trade)
  return (key && SCENE[key]?.[slot]) || FALLBACK_SCENE[slot]
}
