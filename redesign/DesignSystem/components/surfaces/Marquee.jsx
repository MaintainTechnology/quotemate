import React from 'react';

/**
 * Marquee — the signature yellow CTA ticker. Dark ink on yellow (never
 * white). The track holds the items twice so the -50% loop is seamless;
 * reduced-motion users see the static leading set. Items are separated by
 * a middot.
 */
export function Marquee({ items = [], speed = 36, fontSize = 22 }) {
  const Run = ({ hidden }) => (
    <span
      aria-hidden={hidden || undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize,
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-label)',
      }}
    >
      {items.map((it, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ padding: '0 24px' }}>{it}</span>
          <span aria-hidden="true">·</span>
        </span>
      ))}
    </span>
  );

  return (
    <div className="qm-marquee" style={{ padding: '18px 0' }}>
      <div className="qm-marquee__track" style={{ animationDuration: `${speed}s` }}>
        <Run />
        <Run hidden />
      </div>
    </div>
  );
}
