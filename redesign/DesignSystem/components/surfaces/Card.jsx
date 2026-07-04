import React, { useState } from 'react';

/**
 * Card — the structural surface: a palette-charcoal panel held by a warm
 * hairline, lifted by the inner "lit edge" (not a drop shadow). Square
 * corners. Optional accent top rule, hover-driven accent sweep, and an
 * interactive hover state (border warms to accent, surface lifts a step).
 */
export function Card({
  children,
  as = 'div',
  padding = 28,
  lit = true,
  sweep = false,
  interactive = false,
  accentTop = false,
  href,
  style = {},
  className = '',
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const Tag = href ? 'a' : as;

  const cls = ['qm-card', lit && 'qm-edge-lit', sweep && 'qm-card-sweep', className]
    .filter(Boolean)
    .join(' ');

  const merged = {
    position: 'relative',
    display: 'block',
    background: interactive && hover ? 'var(--ink)' : 'var(--ink-card)',
    border: '1px solid',
    borderColor:
      interactive && hover ? 'color-mix(in srgb, var(--accent) 45%, var(--ink-line))' : 'var(--ink-line)',
    borderRadius: 'var(--radius-card)',
    padding,
    textDecoration: 'none',
    color: 'inherit',
    transition: 'background-color var(--dur-base) ease, border-color var(--dur-base) ease',
    ...style,
  };

  return (
    <Tag
      href={href}
      className={cls}
      style={merged}
      onMouseEnter={interactive ? () => setHover(true) : undefined}
      onMouseLeave={interactive ? () => setHover(false) : undefined}
      {...rest}
    >
      {accentTop ? (
        <span
          aria-hidden="true"
          style={{ position: 'absolute', insetInline: 0, top: 0, height: 2, background: 'var(--accent)' }}
        />
      ) : null}
      {children}
    </Tag>
  );
}
