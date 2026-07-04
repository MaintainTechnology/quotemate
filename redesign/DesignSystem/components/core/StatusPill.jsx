import React from 'react';

/**
 * StatusPill — a small dot + mono label that reports live state. The dot
 * can pulse for a genuinely live signal (an active account, an open line).
 */
export function StatusPill({ children, tone = 'neutral', pulse = false, ...rest }) {
  const tones = {
    live: 'var(--success-bright)',
    paid: 'var(--success-bright)',
    review: 'var(--warning-bright)',
    error: 'var(--danger-bright)',
    neutral: 'var(--text-dim)',
  };
  const c = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 11px',
        border: `1px solid color-mix(in srgb, ${c} 45%, transparent)`,
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-label)',
        color: c,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: 'var(--radius-pill)',
          background: c,
          animation: pulse ? 'qm-pulse-soft 2.4s ease-in-out infinite' : 'none',
        }}
      />
      {children}
    </span>
  );
}
