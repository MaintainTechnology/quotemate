import React from 'react';

/**
 * Mono uppercase eyebrow — the small tracked label that sits above a
 * headline or names a section. JetBrains Mono, wide tracking, dim by default.
 */
export function Eyebrow({ children, as = 'span', color = 'var(--text-dim)', ...rest }) {
  const Tag = as;
  return (
    <Tag
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-eyebrow)',
        color,
        margin: 0,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
