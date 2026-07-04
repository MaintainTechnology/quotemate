import React from 'react';

/**
 * Badge / chip — a small mono-uppercase label in a square hairline box.
 * Use for trust signals, pilot status, metadata. `icon` renders before the
 * label (e.g. an AU flag <img> or a Lucide glyph).
 */
export function Badge({ children, tone = 'neutral', icon, ...rest }) {
  const tones = {
    neutral: { color: 'var(--text-dim)', borderColor: 'var(--ink-line)', background: 'transparent' },
    accent: {
      color: 'var(--accent)',
      borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
      background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
    },
    solid: { color: 'var(--accent-ink)', borderColor: 'transparent', background: 'var(--accent)' },
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        border: '1px solid',
        borderRadius: 'var(--radius-none)',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        fontWeight: tone === 'solid' ? 700 : 500,
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-label)',
        ...tones[tone],
      }}
      {...rest}
    >
      {icon ? <span style={{ display: 'inline-flex', alignItems: 'center' }} aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}
