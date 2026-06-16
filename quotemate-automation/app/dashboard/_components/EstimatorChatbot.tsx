'use client'

// EstimatorChatbot — a flexible, grounded chat panel rendered on the paint and
// electrical estimators. It asks POST /api/filestore/chat, which answers from
// the session's dedicated File Search store (the uploaded files + the estimate
// result PDF) using Gemini 2.5. The customer/tradie can ask "why is this value
// here?", "what does my uploaded plan show?", etc., and gets a grounded,
// cited answer. Surface-agnostic: pass the estimator kind + session id + the
// Bearer token the parent already holds.

import { useCallback, useEffect, useRef, useState } from 'react'

type Citation = { title?: string; page?: number; snippet?: string }
type ChatMessage = {
  role: 'user' | 'assistant'
  text: string
  citations?: Citation[]
  pending?: boolean
}

const ACCENT = '#FF5F00'
const PANEL = '#16202b'
const PANEL_2 = '#0f1722'
const BORDER = '#243140'
const TEXT = '#e6ebf0'
const MUTED = '#94a3b8'
const MONO = "'Courier New', ui-monospace, monospace"

const SUGGESTIONS: Record<'paint' | 'electrical', string[]> = {
  paint: [
    'Why is this the price?',
    'Which surfaces did you measure?',
    'What does my uploaded plan show?',
    'What assumptions were made?',
  ],
  electrical: [
    'Why is this the count?',
    'How was each item priced?',
    'What does my uploaded plan show?',
    'Which items need a closer look?',
  ],
}

export default function EstimatorChatbot({
  estimator,
  sessionId,
  accessToken,
  jobLabel,
}: {
  estimator: 'paint' | 'electrical'
  sessionId: string | null | undefined
  accessToken: string | null | undefined
  jobLabel?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const threadRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Auto-scroll the thread to the latest message.
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, open])

  const send = useCallback(
    async (question: string) => {
      const q = question.trim()
      if (!q || loading || !sessionId) return
      if (!accessToken) {
        setMessages((m) => [
          ...m,
          { role: 'user', text: q },
          { role: 'assistant', text: 'Please sign in to ask about this estimate.' },
        ])
        return
      }
      setInput('')
      setMessages((m) => [
        ...m,
        { role: 'user', text: q },
        { role: 'assistant', text: 'Looking through this job…', pending: true },
      ])
      setLoading(true)
      try {
        const res = await fetch('/api/filestore/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ estimator, sessionId, query: q }),
        })
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; answer?: string; citations?: Citation[]; error?: string }
          | null
        const answer =
          (data && typeof data.answer === 'string' && data.answer) ||
          (res.ok
            ? 'I couldn’t find an answer to that in this job’s documents.'
            : 'Sorry — something went wrong. Please try again.')
        const citations = Array.isArray(data?.citations) ? data!.citations! : []
        setMessages((m) => replaceLastPending(m, { role: 'assistant', text: answer, citations }))
      } catch {
        setMessages((m) =>
          replaceLastPending(m, {
            role: 'assistant',
            text: 'Sorry — I couldn’t reach the assistant just now. Please try again.',
          }),
        )
      } finally {
        setLoading(false)
      }
    },
    [accessToken, estimator, loading, sessionId],
  )

  // No session yet → nothing to ask about.
  if (!sessionId) return null

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        background: PANEL,
        color: TEXT,
        overflow: 'hidden',
        marginTop: 16,
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
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: ACCENT,
            boxShadow: `0 0 10px ${ACCENT}`,
            flex: 'none',
          }}
        />
        <span style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>Ask about this estimate</span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: MUTED,
          }}
        >
          {jobLabel ? `· ${jobLabel}` : '· AI assistant'}
        </span>
        <span style={{ marginLeft: 'auto', color: MUTED, fontSize: 13 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          <div
            ref={threadRef}
            style={{ maxHeight: 320, overflowY: 'auto', padding: 16, display: 'grid', gap: 12 }}
          >
            {messages.length === 0 && (
              <p style={{ color: MUTED, fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                I can answer questions about this estimate using the files you uploaded and the
                result. Ask why a number is what it is, or anything about your documents.
              </p>
            )}
            {messages.map((m, i) => (
              <Bubble key={i} message={m} />
            ))}
          </div>

          {messages.length === 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 16px 12px' }}>
              {SUGGESTIONS[estimator].map((s) => (
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
            style={{
              display: 'flex',
              gap: 8,
              padding: 12,
              borderTop: `1px solid ${BORDER}`,
              background: PANEL_2,
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this estimate…"
              aria-label="Ask about this estimate"
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
              {loading ? '…' : 'Ask'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth: '88%' }}>
        <div
          style={{
            background: isUser ? ACCENT : PANEL_2,
            color: isUser ? '#0b0f14' : TEXT,
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
        {message.citations && message.citations.length > 0 && (
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            {message.citations.slice(0, 4).map((c, i) => (
              <div
                key={i}
                style={{
                  borderLeft: `2px solid ${ACCENT}`,
                  background: PANEL_2,
                  padding: '6px 10px',
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 9.5,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: MUTED,
                  }}
                >
                  {(c.title || 'Source').slice(0, 60)}
                  {typeof c.page === 'number' ? ` · p${c.page}` : ''}
                </div>
                {c.snippet && (
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 1.5 }}>
                    {c.snippet.slice(0, 220)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function replaceLastPending(messages: ChatMessage[], replacement: ChatMessage): ChatMessage[] {
  const idx = [...messages].reverse().findIndex((m) => m.pending)
  if (idx === -1) return [...messages, replacement]
  const realIdx = messages.length - 1 - idx
  const next = messages.slice()
  next[realIdx] = replacement
  return next
}
