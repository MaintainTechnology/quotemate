import React from 'react';

/**
 * Avatar — a square (brand-default) or round identity tile. Shows an image
 * when `src` is given, otherwise initials derived from `name`. The default
 * look is a yellow tile with dark ink, echoing the logo mark.
 */
export function Avatar({ name = '', src, size = 40, round = false, tone = 'accent', ...rest }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const tones = {
    accent: { background: 'var(--accent)', color: 'var(--accent-ink)', border: 'transparent' },
    ink: { background: 'var(--ink)', color: 'var(--text-pri)', border: 'var(--ink-line)' },
  };
  const t = tones[tone] || tones.accent;

  return (
    <span
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: round ? 'var(--radius-pill)' : 'var(--radius-none)',
        background: t.background,
        color: t.color,
        border: `1px solid ${t.border}`,
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: Math.round(size * 0.36),
        letterSpacing: '0.02em',
        userSelect: 'none',
      }}
      {...rest}
    >
      {src ? (
        <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        initials || '?'
      )}
    </span>
  );
}
