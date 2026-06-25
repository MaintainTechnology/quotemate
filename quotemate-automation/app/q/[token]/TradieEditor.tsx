// Tradie-only quote editor overlay.
//
// Mounted from the public /q/<token> page on every render. On mount we
// call /api/quote/<id>/check-owner with the visitor's Supabase Bearer
// token. If the visitor is the tradie who owns the quote's tenant, the
// floating "Edit pricing" affordance appears at the top-right of the
// page. Otherwise this component renders nothing — customer flow is
// completely undisturbed.
//
// Clicking Edit opens a full-screen modal with one section per existing
// tier, each containing the line items (description, quantity,
// unit price, line total). Save POSTs to /api/quote/<id>/edit which
// recomputes subtotals + headline total, expires + re-issues Stripe
// Checkout Sessions for any tier whose subtotal changed, and persists
// the new shape. The customer-facing /q/<token> URL is unchanged —
// only what's inside (and what the deposit button links to) updates.

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import QuoteEditChat, { type ProposedTiers } from './QuoteEditChat'

type LineItem = {
  description: string
  quantity: number
  unit?: string
  unit_price_ex_gst: number
  total_ex_gst?: number
  source?: string
  // WP5 — supply-mode metadata stamped by the estimator when the
  // customer supplies the product. Preserved through the editor so a
  // tradie's price/description tweak doesn't strip the badge or safety
  // note off the customer's quote.
  supplied_by?: 'tradie' | 'customer'
  safety_note?: string
}

type Tier = {
  label?: string
  timeframe?: string
  subtotal_ex_gst?: number
  line_items?: LineItem[]
} | null

type Tiers = {
  good: Tier
  better: Tier
  best: Tier
}

type Props = {
  quoteId: string
  initialTiers: Tiers
  gstRegistered: boolean
  // Embedded mode (dashboard PDF viewer): suppress the floating "Edit pricing"
  // banner (the viewer's toolbar drives the editor instead) and expose an
  // imperative open handle + a save callback. All optional — /q/[token] mounts
  // TradieEditor with none of them and behaves exactly as before.
  hideBanner?: boolean
  onReady?: (api: EditorApi) => void
  onSaved?: () => void
}

/** Imperative handle the dashboard viewer uses to open the editor from its
 *  toolbar. `canEdit` is true only for the signed-in owner of an unpaid quote. */
export type EditorApi = {
  openEditor: (opts?: { chat?: boolean }) => void
  canEdit: boolean
}

type EditableLine = {
  description: string
  quantity: string
  unit: string
  unit_price_ex_gst: string
  // Round-tripped so an edit preserves each line's provenance: catalogue
  // anchors (`material:<id>`/`assembly:<id>`), `labour`/`callout`, and the
  // `tradie_manual` sentinel marking a tradie-entered custom line. Dropping it
  // (the old behaviour) re-stamped every line `tradie_edit` on save and
  // stripped the strict-grounding anchors.
  source?: string
  // WP5 — opaque-passthrough fields. Not edited in the dashboard today;
  // round-tripped so save() doesn't clobber them.
  supplied_by?: 'tradie' | 'customer'
  safety_note?: string
}

type EditableTier = {
  label: string
  timeframe: string
  lines: EditableLine[]
}

type OwnerCheck = {
  owner: boolean
  paid?: boolean
  tenantBusinessName?: string
}

// A grounding failure echoed back by POST /api/quote/<id>/edit (status 422)
// when an edited line doesn't derive from the tenant's catalogue. Surfaced so
// the tradie can correct the price or consciously force the save through.
type GroundingFailure = {
  tier: 'good' | 'better' | 'best'
  lineIndex: number
  description: string
  unit: string
  unit_price_ex_gst: number
  expected: string
}

const TIER_KEYS = ['good', 'better', 'best'] as const
type TierKey = (typeof TIER_KEYS)[number]

export default function TradieEditor({
  quoteId,
  initialTiers,
  gstRegistered,
  hideBanner = false,
  onReady,
  onSaved,
}: Props) {
  const router = useRouter()
  // ?edit=1 is the auto-open hint set by the "Edit first" SMS link
  // (buildTradieReviewNotification) and the approve-page Edit button.
  // When it's present we want the editor modal open the moment the
  // tradie lands, instead of forcing them to spot the small floating
  // "Edit pricing" button at the top-right.
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const wantsEdit = searchParams?.get('edit') === '1'
  const [check, setCheck] = useState<OwnerCheck | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [tiers, setTiers] = useState<Record<TierKey, EditableTier | null>>(() =>
    materialise(initialTiers),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Confirmation modal — opens when the tradie clicks "Save". They
  // pick whether the customer gets an updated-quote SMS or the edit
  // saves silently. Smart-default = notify if any tier headline
  // subtotal changed, silent if only labels/descriptions moved.
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Override modal — opens when a save returns 422 grounding_failed (an
  // existing catalogue line edited to an off-catalogue price; tradie-added
  // manual lines are exempt server-side). Lists the offending lines and lets
  // the tradie consciously force the save through. pendingNotify remembers the
  // notify choice from the confirm modal so the forced re-POST keeps it.
  const [groundingFailures, setGroundingFailures] = useState<GroundingFailure[] | null>(null)
  const [pendingNotify, setPendingNotify] = useState(false)
  // Embedded mode: when the viewer opens the editor via "Edit with AI", start
  // the in-modal chat panel expanded.
  const [chatAutoOpen, setChatAutoOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = getBrowserSupabase()
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token ?? null
      if (!token) {
        // No session at all → can't be a tradie. Render nothing.
        if (!cancelled) setCheck({ owner: false })
        return
      }
      try {
        const res = await fetch(`/api/quote/${quoteId}/check-owner`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!cancelled && res.ok) {
          const body = (await res.json()) as OwnerCheck
          setAccessToken(token)
          setCheck(body)
        }
      } catch {
        if (!cancelled) setCheck({ owner: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quoteId])

  // ?edit=1 auto-open: pop the editor modal the moment the owner check
  // resolves positively. Tracked with a one-shot flag so the modal
  // doesn't re-open after the tradie closes it.
  const [autoOpened, setAutoOpened] = useState(false)
  useEffect(() => {
    if (!autoOpened && wantsEdit && check?.owner === true && !check.paid) {
      setOpen(true)
      setAutoOpened(true)
    }
  }, [check, wantsEdit, autoOpened])

  // Embedded mode: hand the parent (dashboard viewer) an imperative open handle
  // once the owner check resolves, so its toolbar can drive Edit / Edit-with-AI.
  useEffect(() => {
    if (!onReady || !check) return
    onReady({
      openEditor: (opts) => {
        if (opts?.chat) setChatAutoOpen(true)
        setOpen(true)
      },
      canEdit: check.owner === true && !check.paid,
    })
  }, [check, onReady])

  // Reset the chat auto-open hint once the modal is closed so the next plain
  // "Edit" open doesn't inherit an expanded chat.
  useEffect(() => {
    if (!open) setChatAutoOpen(false)
  }, [open])

  // Visitor came with explicit edit intent but isn't signed in (or is
  // signed in to a different tenant) — instead of rendering nothing
  // (which left the user staring at the customer page wondering where
  // "edit" went), surface a clear sign-in CTA. The redirect param
  // preserves the edit intent across the round-trip; /signin will
  // honour it after the sign-in flow lands (see /signin redirect note).
  if (wantsEdit && check && !check.owner) {
    const returnTo =
      (pathname ?? `/q/${quoteId}`) + (wantsEdit ? '?edit=1' : '')
    return (
      <div className="fixed top-3 right-3 z-40 max-w-[95vw]">
        <div className="flex flex-wrap items-center gap-3 bg-accent text-white px-4 py-2.5 shadow-lg">
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] font-bold">
            Sign in to edit
          </span>
          <Link
            href={`/signin?redirectTo=${encodeURIComponent(returnTo)}`}
            className="font-mono text-[0.65rem] uppercase tracking-[0.14em] font-bold bg-white text-accent px-3 py-1 hover:bg-white/90 transition-colors"
          >
            Sign in →
          </Link>
        </div>
      </div>
    )
  }

  // Render nothing until we know, and nothing afterward if not the owner
  // (and there's no explicit edit intent that we should surface).
  if (!check?.owner) return null

  // Compute whether any tier's headline subtotal has actually changed
  // from the initial state. Used as the smart-default for the customer
  // notify confirmation modal — if prices moved, default to "send
  // update"; if only labels/descriptions changed, default to "save
  // quietly". The tradie can override either way.
  function anyTierPriceChanged(): boolean {
    for (const k of TIER_KEYS) {
      const t = tiers[k]
      const initial = initialTiers[k]
      if (!t && !initial) continue
      if (!t || !initial) return true
      const newSubtotal = t.lines.reduce(
        (acc, l) => acc + Number(l.quantity || 0) * Number(l.unit_price_ex_gst || 0),
        0,
      )
      const oldSubtotal = Number(initial.subtotal_ex_gst ?? 0)
      if (Math.abs(newSubtotal - oldSubtotal) > 0.001) return true
    }
    return false
  }

  // Step 1 — clicked from the main "Save" button. Opens the confirm
  // modal but doesn't yet POST anything.
  function openSaveConfirm() {
    if (!accessToken) {
      setError('Session expired — refresh and sign in again.')
      return
    }
    setError(null)
    setConfirmOpen(true)
  }

  // Step 2 — chosen from the confirm modal. POSTs the edit with
  // notify_customer flag set to the tradie's pick, then closes
  // everything and refreshes the server-rendered page.
  async function handleSave(notifyCustomer: boolean, force = false) {
    if (!accessToken) {
      setError('Session expired — refresh and sign in again.')
      return
    }
    setError(null)
    setPendingNotify(notifyCustomer)
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {}
      for (const k of TIER_KEYS) {
        const t = tiers[k]
        if (!t) continue
        payload[k] = {
          label: t.label,
          timeframe: t.timeframe,
          line_items: t.lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity || 0),
            unit: l.unit || 'item',
            unit_price_ex_gst: Number(l.unit_price_ex_gst || 0),
            // Preserve provenance so catalogue anchors (`material:<id>`) survive
            // the round-trip and tradie-added custom lines keep their
            // `tradie_manual` tag (which the edit route exempts from grounding).
            ...(l.source ? { source: l.source } : {}),
            ...(l.supplied_by ? { supplied_by: l.supplied_by } : {}),
            ...(l.safety_note ? { safety_note: l.safety_note } : {}),
          })),
        }
      }
      payload.notify_customer = notifyCustomer
      // H-2 — when the tradie has chosen to override the grounding gate, the
      // edit endpoint accepts force:true and persists the ungrounded line
      // under a tradie_edit_ungrounded audit flag.
      if (force) payload.force = true

      const res = await fetch(`/api/quote/${quoteId}/edit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      // Grounding gate (422). Surface the failing lines and let the tradie
      // either correct them or consciously force the save (spec R12 / E5).
      if (res.status === 422 && body?.error === 'grounding_failed') {
        setGroundingFailures(Array.isArray(body.failures) ? body.failures : [])
        setError(null)
        return
      }
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      // Force a server re-render so the page reflects the new tier
      // subtotals, headline total, and Stripe URLs.
      setGroundingFailures(null)
      setConfirmOpen(false)
      setOpen(false)
      router.refresh()
      // Embedded viewer: let the parent refresh the inline PDF after a save.
      onSaved?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  // Merge an AI-proposed edit into the structured editor state. Only tiers the
  // proposal actually changed are present; each replaces that tier's lines so
  // the form (the diff-review surface) reflects the proposal for the tradie to
  // review and Save.
  function applyProposal(proposed: ProposedTiers) {
    setTiers((cur) => {
      const next = { ...cur }
      for (const k of TIER_KEYS) {
        const pt = proposed[k]
        if (pt === undefined || pt === null) continue
        next[k] = {
          label: pt.label ?? cur[k]?.label ?? `${k} option`,
          timeframe: pt.timeframe ?? cur[k]?.timeframe ?? '',
          lines: (pt.line_items ?? []).map((li) => ({
            description: li.description ?? '',
            quantity: String(li.quantity ?? 1),
            unit: li.unit ?? 'hr',
            unit_price_ex_gst: String(li.unit_price_ex_gst ?? 0),
            // Carry the reconciled source so a saved AI edit preserves catalogue
            // anchors / the tradie_manual exemption through /edit.
            ...(li.source ? { source: li.source } : {}),
          })),
        }
      }
      return next
    })
  }

  function updateLine(
    tierKey: TierKey,
    idx: number,
    patch: Partial<EditableLine>,
  ) {
    setTiers((cur) => {
      const t = cur[tierKey]
      if (!t) return cur
      const nextLines = t.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l))
      return { ...cur, [tierKey]: { ...t, lines: nextLines } }
    })
  }

  function addLine(tierKey: TierKey) {
    setTiers((cur) => {
      const t = cur[tierKey]
      if (!t) return cur
      return {
        ...cur,
        [tierKey]: {
          ...t,
          lines: [
            ...t.lines,
            // Tradie-entered custom line: grounded by the human, not the
            // catalogue (source 'tradie_manual' → exempt from the edit-route
            // grounding gate). Defaults to a non-'hr' unit and $0 so removals
            // / inclusions can be added as-is.
            {
              description: '',
              quantity: '1',
              unit: 'item',
              unit_price_ex_gst: '0',
              source: 'tradie_manual',
            },
          ],
        },
      }
    })
  }

  function removeLine(tierKey: TierKey, idx: number) {
    setTiers((cur) => {
      const t = cur[tierKey]
      if (!t) return cur
      const nextLines = t.lines.filter((_, i) => i !== idx)
      if (nextLines.length === 0) return cur  // never go to zero
      return { ...cur, [tierKey]: { ...t, lines: nextLines } }
    })
  }

  function updateTierMeta(tierKey: TierKey, patch: Partial<EditableTier>) {
    setTiers((cur) => {
      const t = cur[tierKey]
      if (!t) return cur
      return { ...cur, [tierKey]: { ...t, ...patch } }
    })
  }

  return (
    <>
      {/* ─── Floating tradie-mode banner (suppressed in embedded viewer) ─── */}
      {!hideBanner && (
      <div className="fixed top-3 right-3 z-40 max-w-[90vw]">
        <div className="flex items-center gap-3 bg-accent text-white px-4 py-2.5 shadow-lg">
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] font-bold">
            Tradie · {check.tenantBusinessName ?? 'You'}
          </span>
          {check.paid ? (
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em]">
              Paid · cannot edit
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="font-mono text-[0.65rem] uppercase tracking-[0.14em] font-bold bg-white text-accent px-3 py-1 hover:bg-white/90 transition-colors"
            >
              Edit pricing
            </button>
          )}
        </div>
      </div>
      )}

      {/* ─── Edit modal ─────────────────────────────────────────── */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-ink-deep/90 backdrop-blur-sm flex items-start justify-center px-4 py-8 overflow-y-auto"
        >
          <div className="w-full max-w-3xl bg-ink-card border border-ink-line">
            <div className="flex items-center justify-between border-b border-ink-line px-5 py-4 sticky top-0 bg-ink-card">
              <div>
                <h2 className="font-extrabold uppercase text-lg tracking-[-0.02em] text-text-pri">
                  Edit quote pricing
                </h2>
                <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
                  Changes save in place · Stripe deposit links re-issue for changed tiers
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-sec hover:text-text-pri"
              >
                Close
              </button>
            </div>

            <div className="px-5 py-5 space-y-6">
              {/* ─── AI chat-edit · type a change in plain English ─── */}
              <QuoteEditChat
                quoteId={quoteId}
                accessToken={accessToken}
                getCurrentTiers={() => {
                  const out: ProposedTiers = {}
                  for (const k of TIER_KEYS) {
                    const t = tiers[k]
                    if (!t) continue
                    out[k] = {
                      label: t.label,
                      timeframe: t.timeframe || undefined,
                      line_items: t.lines.map((l) => ({
                        description: l.description,
                        quantity: Number(l.quantity || 0),
                        unit: l.unit || 'hr',
                        unit_price_ex_gst: Number(l.unit_price_ex_gst || 0),
                        // Send provenance so chat-edit can reconcile sources
                        // (keep tradie_manual exempt, validate everything else).
                        ...(l.source ? { source: l.source } : {}),
                      })),
                    }
                  }
                  return out
                }}
                onApplyProposal={applyProposal}
                defaultOpen={chatAutoOpen}
              />
              {TIER_KEYS.map((key) => {
                const t = tiers[key]
                if (!t) return null
                const subtotal = t.lines.reduce(
                  (acc, l) => acc + (Number(l.quantity) || 0) * (Number(l.unit_price_ex_gst) || 0),
                  0,
                )
                const incGst = gstRegistered ? subtotal * 1.1 : subtotal
                return (
                  <div key={key} className="border border-ink-line">
                    <div className="flex items-center justify-between px-4 py-3 bg-ink-deep/40 border-b border-ink-line">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-accent font-bold">
                          {key} tier
                        </span>
                        <input
                          type="text"
                          value={t.label}
                          onChange={(e) => updateTierMeta(key, { label: e.target.value })}
                          className="bg-ink-deep border border-ink-line px-2 py-1 text-sm font-semibold text-text-pri min-w-[260px]"
                          aria-label={`${key} tier label`}
                        />
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-text-dim">
                          Subtotal · ex GST
                        </div>
                        <div className="font-mono font-bold text-text-pri">${money(subtotal)}</div>
                        {gstRegistered && (
                          <div className="font-mono text-[0.6rem] text-text-dim mt-0.5">
                            ${money(incGst)} inc GST
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-ink-line">
                      {t.lines.map((line, idx) => {
                        const lineTotal =
                          (Number(line.quantity) || 0) * (Number(line.unit_price_ex_gst) || 0)
                        return (
                          <div key={idx} className="px-4 py-3 grid grid-cols-12 gap-2 items-end">
                            <div className="col-span-12 md:col-span-6">
                              <label className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-text-dim mb-1 flex items-center gap-2">
                                <span>Description</span>
                                {line.source === 'tradie_manual' && (
                                  <span className="bg-accent/15 text-accent px-1.5 py-0.5 text-[0.5rem] font-bold tracking-[0.12em]">
                                    Custom
                                  </span>
                                )}
                              </label>
                              <input
                                type="text"
                                value={line.description}
                                onChange={(e) => updateLine(key, idx, { description: e.target.value })}
                                className="w-full bg-ink-deep border border-ink-line px-2 py-1.5 text-sm text-text-pri"
                                aria-label="Line description"
                              />
                            </div>
                            <div className="col-span-4 md:col-span-2">
                              <label className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-text-dim block mb-1">
                                Qty
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.quantity}
                                onChange={(e) => updateLine(key, idx, { quantity: e.target.value })}
                                className="w-full bg-ink-deep border border-ink-line px-2 py-1.5 text-sm text-text-pri font-mono"
                                aria-label="Quantity"
                              />
                            </div>
                            <div className="col-span-4 md:col-span-2">
                              <label className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-text-dim block mb-1">
                                Unit price ex
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.unit_price_ex_gst}
                                onChange={(e) => updateLine(key, idx, { unit_price_ex_gst: e.target.value })}
                                className="w-full bg-ink-deep border border-ink-line px-2 py-1.5 text-sm text-text-pri font-mono"
                                aria-label="Unit price ex GST"
                              />
                            </div>
                            <div className="col-span-3 md:col-span-1 text-right">
                              <label className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-text-dim block mb-1">
                                Total
                              </label>
                              <div className="px-2 py-1.5 text-sm text-text-pri font-mono">
                                ${money(lineTotal)}
                              </div>
                            </div>
                            <div className="col-span-1 text-right">
                              <button
                                type="button"
                                onClick={() => removeLine(key, idx)}
                                disabled={t.lines.length <= 1}
                                aria-label="Remove line"
                                className="text-text-dim hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed text-xl leading-none px-2"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="px-4 py-3 border-t border-ink-line">
                      <button
                        type="button"
                        onClick={() => addLine(key)}
                        className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-accent hover:text-accent-press transition-colors"
                      >
                        + Add custom line
                      </button>
                    </div>
                  </div>
                )
              })}

              {error && (
                <div className="border border-rose-900/70 bg-rose-950/50 text-rose-200 px-4 py-3 text-sm">
                  {error}
                </div>
              )}
            </div>

            <div className="border-t border-ink-line px-5 py-4 flex items-center justify-end gap-3 sticky bottom-0 bg-ink-card">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-sec hover:text-text-pri px-4 py-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={openSaveConfirm}
                disabled={submitting}
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-5 py-2.5 text-xs uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save · Re-issue links'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Confirm modal · pick whether to notify the customer ─── */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-60 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-ink-card border border-ink-line shadow-2xl">
            {groundingFailures && groundingFailures.length > 0 ? (
              <>
                <div className="px-6 pt-6 pb-4 border-b border-ink-line">
                  <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-warning">
                    Not grounded
                  </div>
                  <h3 className="mt-2 font-extrabold uppercase tracking-tight text-lg text-text-pri">
                    Some prices aren&apos;t<br />in your catalogue
                  </h3>
                  <p className="mt-3 text-sm text-text-sec leading-relaxed">
                    These lines don&apos;t match a real price in your pricing book or catalogue. Correct them to a
                    catalogue price, or save anyway — forced lines are flagged on the quote for audit.
                  </p>
                  <ul className="mt-4 space-y-2 text-xs">
                    {groundingFailures.map((f, i) => (
                      <li key={i} className="border-l-2 border-l-warning bg-ink-deep/40 px-3 py-2">
                        <div className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-text-dim">
                          {f.tier} · line {f.lineIndex + 1}
                        </div>
                        <div className="text-text-pri mt-0.5">{f.description}</div>
                        <div className="text-text-dim mt-1">{f.expected}</div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="px-6 py-5 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => handleSave(pendingNotify, true)}
                    disabled={submitting}
                    className="w-full inline-flex items-center justify-center bg-warning/90 hover:bg-warning text-ink-deep font-bold px-4 py-3 text-xs uppercase tracking-[0.14em] transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Saving…' : 'Save anyway · ungrounded'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroundingFailures(null)}
                    disabled={submitting}
                    className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim hover:text-text-sec mt-1 disabled:opacity-50"
                  >
                    Back to fix the prices
                  </button>
                  {error && (
                    <div className="mt-2 border border-rose-900/70 bg-rose-950/50 text-rose-200 px-3 py-2 text-xs">
                      {error}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="px-6 pt-6 pb-4 border-b border-ink-line">
                  <div className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-text-dim">
                    Confirm save
                  </div>
                  <h3 className="mt-2 font-extrabold uppercase tracking-tight text-lg text-text-pri">
                    Send the updated quote<br />to the customer?
                  </h3>
                  <p className="mt-3 text-sm text-text-sec leading-relaxed">
                    {anyTierPriceChanged()
                      ? 'Prices have changed — the customer should get the new numbers as an SMS.'
                      : 'Only labels or descriptions changed. You can save quietly if you don\'t want to ping the customer.'}
                  </p>
                </div>

                <div className="px-6 py-5 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => handleSave(true)}
                    disabled={submitting}
                    className="w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-press text-white font-bold px-4 py-3 text-xs uppercase tracking-[0.14em] transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Sending…' : 'Send update · full quote SMS'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSave(false)}
                    disabled={submitting}
                    className="w-full inline-flex items-center justify-center bg-transparent border border-ink-line hover:border-text-sec text-text-pri font-mono text-[0.7rem] uppercase tracking-[0.14em] px-4 py-3 transition-colors disabled:opacity-50"
                  >
                    Save quietly · no SMS
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(false)}
                    disabled={submitting}
                    className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim hover:text-text-sec mt-1 disabled:opacity-50"
                  >
                    Back to edits
                  </button>

                  {error && (
                    <div className="mt-2 border border-rose-900/70 bg-rose-950/50 text-rose-200 px-3 py-2 text-xs">
                      {error}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* ─── helpers ───────────────────────────────────────────────────── */

function materialise(initial: Tiers): Record<TierKey, EditableTier | null> {
  const out: Record<TierKey, EditableTier | null> = {
    good: null,
    better: null,
    best: null,
  }
  for (const k of TIER_KEYS) {
    const t = initial[k]
    if (!t) continue
    out[k] = {
      label: t.label ?? `${k} option`,
      timeframe: t.timeframe ?? '',
      lines: (t.line_items ?? []).map((li) => ({
        description: li.description ?? '',
        quantity: String(li.quantity ?? 1),
        unit: li.unit ?? 'hr',
        unit_price_ex_gst: String(li.unit_price_ex_gst ?? 0),
        // Carry provenance so a save round-trips it: catalogue anchors and the
        // `tradie_manual` tag survive an edit instead of being re-stamped
        // `tradie_edit` (which stripped the strict-grounding anchors).
        ...(li.source ? { source: li.source } : {}),
        ...(li.supplied_by ? { supplied_by: li.supplied_by } : {}),
        ...(li.safety_note ? { safety_note: li.safety_note } : {}),
      })),
    }
  }
  return out
}

function money(n: number): string {
  return Number.isFinite(n)
    ? n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : '0'
}
