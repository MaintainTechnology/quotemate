'use client'

// QuoteEditChat — the AI chat box mounted INSIDE the TradieEditor modal on the
// /q/<token> quote page (owner-only). The tradie types a plain-English change
// ("add a second downlight to Better", "drop the smoke-alarm line"); the panel
// POSTs it to /api/quote/<id>/chat-edit (propose-only), renders the proposed
// change as a reviewable diff, and on "Apply to editor" merges the proposal
// into the structured editor state. The tradie then reviews and Saves through
// the existing edit flow — this component never persists anything itself.
//
// Types are declared locally (not imported from lib/quote/chat-edit) so the
// server-only AI/Supabase modules never get pulled into the client bundle.

import { useCallback, useEffect, useRef, useState } from 'react'

type TierKey = 'good' | 'better' | 'best'

type ChatLine = {
  description: string
  quantity: number
  unit?: string
  unit_price_ex_gst: number
  source?: string
}
type ChatTier = { label: string; timeframe?: string; line_items: ChatLine[] } | null
export type ProposedTiers = { good?: ChatTier; better?: ChatTier; best?: ChatTier }

type DiffEntry = {
  tier: TierKey
  op: 'add' | 'remove' | 'change'
  description: string
  oldQuantity?: number
  newQuantity?: number
  oldUnitPriceExGst?: number
  newUnitPriceExGst?: number
  grounded: boolean
  reason?: string
}

type ProposeResponse = {
  ok?: boolean
  assistantMessage?: string
  proposedTiers?: ProposedTiers
  diff?: DiffEntry[]
  anyUngrounded?: boolean
  error?: string
  hint?: string
}

type Proposal = {
  proposedTiers: ProposedTiers
  diff: DiffEntry[]
  anyUngrounded: boolean
  applied: boolean
}

type ChatMessage = {
  role: 'user' | 'assistant'
  text: string
  proposal?: Proposal
  pending?: boolean
  error?: boolean
}

const ACCENT = '#FF5F00'
const PANEL = '#16202b'
const PANEL_2 = '#0f1722'
const BORDER = '#243140'
const TEXT = '#e6ebf0'
const MUTED = '#94a3b8'
const WARN = '#fbbf24'
const MONO = "'Courier New', ui-monospace, monospace"

const SUGGESTIONS = [
  'Add a second downlight to Better',
  'Bump labour by an hour on Best',
  'Drop the smoke-alarm line',
  'Make the Good option cheaper',
]

function money(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export default function QuoteEditChat({
  quoteId,
  accessToken,
  getCurrentTiers,
  onApplyProposal,
}: {
  quoteId: string
  accessToken: string | null
  /** Live editor tiers in the chat-edit API shape (so follow-ups build on the working set). */
  getCurrentTiers: () => ProposedTiers
  /** Merge an accepted proposal into the structured editor state. */
  onApplyProposal: (proposed: ProposedTiers) => void
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, open])

  const send = useCallback(
    async (question: string) => {
      const q = question.trim()
      if (!q || loading) return
      if (!accessToken) {
        setMessages((m) => [
          ...m,
          { role: 'user', text: q },
          { role: 'assistant', text: 'Session expired — refresh and sign in again.', error: true },
        ])
        return
      }
      setInput('')
      setMessages((m) => [
        ...m,
        { role: 'user', text: q },
        { role: 'assistant', text: 'Working out the change…', pending: true },
      ])
      setLoading(true)
      try {
        const res = await fetch(`/api/quote/${quoteId}/chat-edit`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ instruction: q, currentTiers: getCurrentTiers() }),
        })
        const data = (await res.json().catch(() => null)) as ProposeResponse | null
        if (!res.ok || !data || data.ok === false) {
          const msg =
            data?.hint ||
            (data?.error === 'quote_already_paid'
              ? 'This quote is already paid and can’t be edited.'
              : data?.error === 'cannot_edit_inspection_quote'
                ? 'This is a $99 inspection quote — there are no tiers to edit.'
                : data?.error === 'pricing_book_misconfigured'
                  ? 'Your pricing book is missing required fields — fix the Pricing tab first.'
                  : 'Sorry — something went wrong drafting that change. Try rephrasing.')
          setMessages((m) => replaceLastPending(m, { role: 'assistant', text: msg, error: true }))
          return
        }
        const diff = Array.isArray(data.diff) ? data.diff : []
        const proposedTiers = data.proposedTiers ?? {}
        const hasChange = diff.length > 0 || Object.keys(proposedTiers).length > 0
        setMessages((m) =>
          replaceLastPending(m, {
            role: 'assistant',
            text: data.assistantMessage || (hasChange ? 'Proposed the change below.' : 'No change proposed.'),
            proposal: hasChange
              ? {
                  proposedTiers,
                  diff,
                  anyUngrounded: !!data.anyUngrounded,
                  applied: false,
                }
              : undefined,
          }),
        )
      } catch {
        setMessages((m) =>
          replaceLastPending(m, {
            role: 'assistant',
            text: 'Couldn’t reach the assistant just now. Please try again.',
            error: true,
          }),
        )
      } finally {
        setLoading(false)
      }
    },
    [accessToken, getCurrentTiers, loading, quoteId],
  )

  const apply = useCallback(
    (idx: number) => {
      setMessages((m) => {
        const msg = m[idx]
        if (!msg?.proposal) return m
        onApplyProposal(msg.proposal.proposedTiers)
        const next = m.slice()
        next[idx] = { ...msg, proposal: { ...msg.proposal, applied: true } }
        return next
      })
    },
    [onApplyProposal],
  )

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        background: PANEL,
        color: TEXT,
        overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          color: TEXT,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 999, background: ACCENT, boxShadow: `0 0 10px ${ACCENT}`, flex: 'none' }}
        />
        <span style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>Edit with AI</span>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: MUTED }}>
          · type a change
        </span>
        <span style={{ marginLeft: 'auto', color: MUTED, fontSize: 13 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          <div ref={threadRef} style={{ maxHeight: 320, overflowY: 'auto', padding: 16, display: 'grid', gap: 12 }}>
            {messages.length === 0 && (
              <p style={{ color: MUTED, fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                Tell me how to change this quote in plain English. I’ll propose the edit and show you exactly what
                moves — you review it and Save. Prices always come from your catalogue.
              </p>
            )}
            {messages.map((m, i) => (
              <Bubble key={i} message={m} onApply={() => apply(i)} loading={loading} />
            ))}
          </div>

          {messages.length === 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 16px 12px' }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={loading}
                  style={{
                    fontSize: 12,
                    color: TEXT,
                    background: PANEL_2,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 999,
                    padding: '6px 12px',
                    cursor: loading ? 'default' : 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send(input)
            }}
            style={{ display: 'flex', gap: 8, padding: 12, borderTop: `1px solid ${BORDER}`, background: PANEL_2 }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. add a second downlight to Better"
              aria-label="Describe a change to this quote"
              style={{
                flex: 1,
                background: PANEL,
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                color: TEXT,
                padding: '10px 12px',
                fontSize: 14,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              style={{
                background: ACCENT,
                color: '#0b0f14',
                fontWeight: 700,
                border: 'none',
                borderRadius: 8,
                padding: '0 16px',
                cursor: loading || !input.trim() ? 'default' : 'pointer',
                opacity: loading || !input.trim() ? 0.6 : 1,
              }}
            >
              {loading ? '…' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function Bubble({
  message,
  onApply,
  loading,
}: {
  message: ChatMessage
  onApply: () => void
  loading: boolean
}) {
  const isUser = message.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth: '92%' }}>
        <div
          style={{
            background: isUser ? ACCENT : PANEL_2,
            color: isUser ? '#0b0f14' : message.error ? WARN : TEXT,
            border: isUser ? 'none' : `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: '9px 12px',
            fontSize: 14,
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            opacity: message.pending ? 0.6 : 1,
          }}
        >
          {message.text}
        </div>
        {message.proposal && <ProposalCard proposal={message.proposal} onApply={onApply} loading={loading} />}
      </div>
    </div>
  )
}

function ProposalCard({
  proposal,
  onApply,
  loading,
}: {
  proposal: Proposal
  onApply: () => void
  loading: boolean
}) {
  const { diff, anyUngrounded, applied } = proposal
  return (
    <div style={{ marginTop: 8, border: `1px solid ${BORDER}`, borderRadius: 8, background: PANEL_2, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gap: 6, padding: '10px 12px' }}>
        {diff.length === 0 ? (
          <div style={{ fontSize: 12.5, color: MUTED }}>No line changes.</div>
        ) : (
          diff.map((d, i) => <DiffRow key={i} d={d} />)
        )}
      </div>

      {anyUngrounded && (
        <div
          style={{
            borderTop: `1px solid ${BORDER}`,
            background: 'rgba(251,191,36,0.08)',
            color: WARN,
            padding: '8px 12px',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          One or more prices aren’t in your catalogue. You can still apply and review, but saving an ungrounded line
          needs you to confirm it explicitly.
        </div>
      )}

      <div style={{ borderTop: `1px solid ${BORDER}`, padding: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {applied ? (
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, alignSelf: 'center' }}>
            ✓ Applied to editor — review &amp; Save below
          </span>
        ) : (
          <button
            type="button"
            onClick={onApply}
            disabled={loading}
            style={{
              background: ACCENT,
              color: '#0b0f14',
              fontWeight: 700,
              border: 'none',
              borderRadius: 8,
              padding: '7px 14px',
              fontSize: 12.5,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            Apply to editor
          </button>
        )}
      </div>
    </div>
  )
}

function DiffRow({ d }: { d: DiffEntry }) {
  const tierTag = d.tier.toUpperCase()
  const opColor = d.op === 'add' ? '#34d399' : d.op === 'remove' ? '#f87171' : ACCENT
  const opLabel = d.op === 'add' ? '+ add' : d.op === 'remove' ? '− remove' : '~ change'
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5 }}>
      <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', color: MUTED, flex: 'none', width: 44 }}>
        {tierTag}
      </span>
      <span style={{ color: opColor, fontWeight: 700, fontSize: 11, flex: 'none', width: 60 }}>{opLabel}</span>
      <span style={{ color: TEXT, flex: 1 }}>
        {d.description}
        {d.op === 'change' && (
          <span style={{ color: MUTED }}>
            {' '}
            ({fmtQtyPrice(d.oldQuantity, d.oldUnitPriceExGst)} → {fmtQtyPrice(d.newQuantity, d.newUnitPriceExGst)})
          </span>
        )}
        {d.op === 'add' && (
          <span style={{ color: MUTED }}> ({fmtQtyPrice(d.newQuantity, d.newUnitPriceExGst)})</span>
        )}
        {!d.grounded && (
          <span
            title={d.reason ?? 'Price not found in catalogue'}
            style={{
              marginLeft: 6,
              fontFamily: MONO,
              fontSize: 9,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: WARN,
              border: `1px solid ${WARN}`,
              borderRadius: 4,
              padding: '1px 4px',
            }}
          >
            ungrounded
          </span>
        )}
      </span>
    </div>
  )
}

function fmtQtyPrice(qty: number | undefined, price: number | undefined): string {
  const q = qty === undefined || !Number.isFinite(qty) ? '?' : String(qty)
  return `${q} × $${money(price)}`
}

function replaceLastPending(messages: ChatMessage[], replacement: ChatMessage): ChatMessage[] {
  const idx = [...messages].reverse().findIndex((m) => m.pending)
  if (idx === -1) return [...messages, replacement]
  const realIdx = messages.length - 1 - idx
  const next = messages.slice()
  next[realIdx] = replacement
  return next
}
