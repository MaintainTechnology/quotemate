import React from 'react';

function aud(n) {
  if (typeof n !== 'number') return n;
  return '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

/**
 * TierCard — a Good / Better / Best option on the customer quote page. Big
 * mono price (inc GST), a deposit-to-book line, and a deposit CTA. The
 * recommended tier takes an accent border + badge; a paid tier shows the
 * success state; sibling tiers dim once one is paid.
 */
export function TierCard({
  tier = 'Better',
  blurb,
  priceIncGst,
  depositAmount,
  depositPct = 30,
  recommended = false,
  paid = false,
  disabled = false,
  ctaLabel = 'Pay deposit',
  href,
  onPay,
  children,
  ...rest
}) {
  return (
    <article
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--ink-card)',
        border: '1px solid',
        borderColor: recommended ? 'var(--accent)' : 'var(--ink-line)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--lift)',
        padding: 28,
        opacity: disabled ? 0.5 : 1,
        transition: 'opacity var(--dur-base) ease',
      }}
      {...rest}
    >
      {recommended ? (
        <span
          style={{
            position: 'absolute',
            top: -1,
            left: 0,
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.16em',
            padding: '4px 10px',
          }}
        >
          Recommended
        </span>
      ) : null}

      <div
        style={{
          marginTop: recommended ? 14 : 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-label)',
          color: 'var(--accent)',
        }}
      >
        {tier}
      </div>

      {blurb ? (
        <p style={{ margin: '10px 0 0', fontSize: 'var(--text-sm)', lineHeight: 1.55, color: 'var(--text-sec)' }}>{blurb}</p>
      ) : null}

      {children}

      <div style={{ marginTop: 20, borderTop: '1px solid var(--ink-line)', paddingTop: 18 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '30px',
            letterSpacing: '-0.01em',
            color: 'var(--text-pri)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {aud(priceIncGst)}
        </div>
        <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)', color: 'var(--text-dim)' }}>
          inc GST
        </div>
        {depositAmount != null ? (
          <div style={{ marginTop: 6, fontSize: 'var(--text-sm)', color: 'var(--text-sec)' }}>
            Deposit to book: <span style={{ fontWeight: 700, color: 'var(--text-pri)' }}>{aud(depositAmount)}</span>
            <span style={{ color: 'var(--text-dim)' }}> · {depositPct}%</span>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 22 }}>
        {paid ? (
          <div
            style={{
              border: '1px solid color-mix(in srgb, var(--success-bright) 45%, transparent)',
              background: 'color-mix(in srgb, var(--success-bright) 12%, transparent)',
              color: 'var(--success-bright)',
              padding: '13px 16px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-label)',
            }}
          >
            Deposit paid
          </div>
        ) : disabled ? (
          <div
            style={{
              border: '1px solid var(--ink-line)',
              color: 'var(--text-dim)',
              padding: '13px 16px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-label)',
            }}
          >
            Confirm to unlock
          </div>
        ) : (
          <a
            href={href || '#'}
            onClick={onPay}
            style={{
              display: 'block',
              background: 'var(--accent)',
              color: 'var(--accent-ink)',
              padding: '14px 16px',
              textAlign: 'center',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 'var(--tracking-label)',
            }}
          >
            {ctaLabel}
          </a>
        )}
      </div>
    </article>
  );
}
