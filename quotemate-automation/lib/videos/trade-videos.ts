// lib/videos/trade-videos.ts
//
// PURE — per-trade trust videos.
//
// A tenant keeps ONE welcome + ONE thank-you video PER TRADE they have switched
// on, stored in the `tenants.trade_videos` jsonb keyed trade -> slot -> entry.
// This replaces the single tenant-wide pair (tenants.intro_video_url /
// thankyou_video_url, mig 175), which stays as a back-compat fallback so an
// existing tenant keeps a working video until their per-trade ones generate.
//
// Trade keys are stored as the canonical KNOWN_TRADES slug (underscored, e.g.
// `commercial_painting`). Customer surfaces speak TradeKey (hyphenated, e.g.
// `commercial-painting`), so everything goes through normaliseVideoTrade().

import { isKnownTrade, type TradeSlug } from '@/lib/admin/trades'
import type { TrustVideoSlot } from './trust-video'

export interface TradeVideoEntry {
  url?: string | null
  status?: 'idle' | 'generating' | 'ready' | 'failed'
  operation?: string | null
  script?: string | null
  error?: string | null
  updated_at?: string
  source?: 'auto' | 'dashboard'
  note?: string | null
}

/** trade slug -> slot -> entry. Shape of `tenants.trade_videos`. */
export type TradeVideoMap = Record<string, Partial<Record<TrustVideoSlot, TradeVideoEntry>>>

// Spellings that are not themselves KNOWN_TRADES slugs. Keys are already
// lower-cased and hyphen-normalised to underscores before lookup.
const TRADE_ALIASES: Record<string, TradeSlug> = {
  roof: 'roofing',
  paint: 'painting',
  painter: 'painting',
  hvac: 'aircon',
  air_con: 'aircon',
  air_conditioning: 'aircon',
  electrical_estimation: 'electrical',
  sparky: 'electrical',
  plumber: 'plumbing',
}

/** Collapse any trade spelling onto the canonical storage slug, else null. */
export function normaliseVideoTrade(trade: string | null | undefined): TradeSlug | null {
  if (typeof trade !== 'string') return null
  const key = trade.trim().toLowerCase().replace(/-/g, '_')
  if (!key) return null
  if (isKnownTrade(key)) return key
  return TRADE_ALIASES[key] ?? null
}

/** The stored entry for one (trade, slot), or {} when nothing is stored. */
export function readTradeSlot(
  map: TradeVideoMap | null | undefined,
  trade: string | null | undefined,
  slot: TrustVideoSlot,
): TradeVideoEntry {
  const key = normaliseVideoTrade(trade)
  if (!key || !map || typeof map !== 'object') return {}
  return map[key]?.[slot] ?? {}
}

/** Merge a patch into one (trade, slot), leaving every other entry intact.
 *  An unknown trade is a no-op so a bad slug can never poison the map. */
export function withTradeSlot(
  map: TradeVideoMap | null | undefined,
  trade: string | null | undefined,
  slot: TrustVideoSlot,
  patch: TradeVideoEntry,
): TradeVideoMap {
  const base: TradeVideoMap = map && typeof map === 'object' ? { ...map } : {}
  const key = normaliseVideoTrade(trade)
  if (!key) return base
  const forTrade = { ...(base[key] ?? {}) }
  forTrade[slot] = { ...(forTrade[slot] ?? {}), ...patch, updated_at: new Date().toISOString() }
  base[key] = forTrade
  return base
}

/** The stored video url for one (trade, slot), or null when there is none. */
export function tradeVideoUrl(
  map: TradeVideoMap | null | undefined,
  trade: string | null | undefined,
  slot: TrustVideoSlot,
): string | null {
  return readTradeSlot(map, trade, slot).url?.trim() || null
}

/** Should auto-generation run for this (trade, slot)? False once a real video
 *  exists or a job is in flight/ready; TRUE for idle or failed so a retry can
 *  recover. Mirrors shouldAutoGenerate() for the legacy tenant-wide pair. */
export function shouldAutoGenerateTrade(
  map: TradeVideoMap | null | undefined,
  trade: string | null | undefined,
  slot: TrustVideoSlot,
): boolean {
  const e = readTradeSlot(map, trade, slot)
  if (e.url?.trim()) return false
  return e.status !== 'generating' && e.status !== 'ready'
}
