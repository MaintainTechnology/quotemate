import React from 'react';

/**
 * Stat — a big JetBrains-Mono figure in accent over a mono uppercase label.
 * The brand's headline numbers ("< 1 min", "$0", "24/7"). Fluid size.
 */
export function Stat({ value, label, align = 'left', ...rest }) {
  return (
    <div style={{ textAlign: align }} {...rest}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.01em',
          color: 'var(--accent)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 'clamp(2.5rem, 5vw, 4.25rem)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          marginTop: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-label)',
          color: 'var(--text-dim)',
        }}
      >
        {label}
      </div>
    </div>
  );
}
