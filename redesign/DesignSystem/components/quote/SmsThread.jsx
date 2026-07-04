import React from 'react';

function aud(n) {
  if (typeof n !== 'number') return n;
  return '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

function Bubble({ from, text }) {
  const inbound = from === 'customer';
  return (
    <div style={{ display: 'flex', justifyContent: inbound ? 'flex-start' : 'flex-end' }}>
      <div
        style={{
          maxWidth: '86%',
          border: '1px solid',
          borderColor: inbound ? 'var(--ink-line)' : 'color-mix(in srgb, var(--accent) 35%, transparent)',
          background: inbound ? 'var(--ink-deep)' : 'color-mix(in srgb, var(--accent) 10%, transparent)',
          color: inbound ? 'var(--text-sec)' : 'var(--text-pri)',
          padding: '10px 14px',
          fontSize: 'var(--text-sm)',
          lineHeight: 1.45,
        }}
      >
        {!inbound ? (
          <span style={{ display: 'block', marginBottom: 4, fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--accent)' }}>
            QuoteMax
          </span>
        ) : null}
        {text}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div
        role="status"
        aria-label="QuoteMax is drafting the quote"
        style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', padding: '12px 14px' }}
      >
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            aria-hidden="true"
            style={{ width: 6, height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--accent-soft)', animation: 'qm-typing-bounce 1.3s ease-in-out infinite', animationDelay: `${d * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * SmsThread — the live SMS-intake demo, rendered as content bubbles on the
 * canvas (deliberately NOT a fake phone frame). Inbound = customer; outbound
 * = QuoteMax (accent-tinted, labelled). Optional trailing typing indicator
 * and a "quote drafted" drop with the price.
 */
export function SmsThread({ messages = [], typing = false, quote, header = true }) {
  return (
    <div style={{ border: '1px solid var(--ink-line)', background: 'var(--ink-card)', boxShadow: 'var(--lift)' }}>
      {header ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--ink-line)', padding: '12px 16px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--text-dim)' }}>
            Live example · SMS intake
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--success-bright)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--success-bright)', animation: 'qm-pulse-soft 2.4s ease-in-out infinite' }} />
            Online
          </span>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 12, padding: '20px 16px' }}>
        {messages.map((m, i) => (
          <Bubble key={i} from={m.from} text={m.text} />
        ))}
        {typing ? <Typing /> : null}
      </div>

      {quote ? (
        <div style={{ borderTop: '1px solid var(--ink-line)', background: 'color-mix(in srgb, var(--ink-deep) 50%, transparent)', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'var(--accent)' }}>
              {quote.label || 'Quote drafted · under a minute'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-dim)' }}>Sample</span>
          </div>
          <div style={{ marginTop: 12, position: 'relative', border: '1px solid var(--ink-line)', background: 'var(--ink-card)', padding: '16px', textAlign: 'center' }}>
            <span aria-hidden="true" style={{ position: 'absolute', insetInline: 0, top: 0, height: 2, background: 'var(--accent)' }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '22px', color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
              {aud(quote.amount)}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
