import React, { useState } from 'react';

/**
 * QuoteMax Button — square, heavy, uppercase-tracked.
 * Primary is a Caterpillar-yellow FILL with dark ink (never white text);
 * secondary is a hairline-bordered button; ghost is borderless. Renders as
 * <button> or, when `href` is set, as <a>.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  href,
  type = 'button',
  disabled = false,
  fullWidth = false,
  withArrow = false,
  onClick,
  ...rest
}) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);

  const sizes = {
    sm: { padding: '8px 16px', fontSize: '11px', minHeight: 36 },
    md: { padding: '13px 26px', fontSize: '13px', minHeight: 44 },
    lg: { padding: '17px 30px', fontSize: '14px', minHeight: 56 },
  };

  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: fullWidth ? '100%' : 'auto',
    border: '1px solid transparent',
    borderRadius: 'var(--radius-control)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    lineHeight: 1,
    textDecoration: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    transition: 'background-color var(--dur-fast) ease, border-color var(--dur-fast) ease, color var(--dur-fast) ease',
    ...sizes[size],
  };

  const variants = {
    primary: {
      background: hover && !disabled ? 'var(--accent-press)' : 'var(--accent)',
      color: 'var(--accent-ink)',
      borderColor: 'transparent',
    },
    secondary: {
      background: hover && !disabled ? 'var(--ink-card)' : 'transparent',
      color: 'var(--text-pri)',
      borderColor: hover && !disabled ? 'var(--text-dim)' : 'var(--ink-line)',
    },
    ghost: {
      background: hover && !disabled ? 'var(--ink-card)' : 'transparent',
      color: 'var(--text-sec)',
      borderColor: 'transparent',
    },
    danger: {
      background: hover && !disabled ? '#a11717' : 'var(--danger)',
      color: '#fff',
      borderColor: 'transparent',
    },
  };

  const style = {
    ...base,
    ...variants[variant],
    transform: active && !disabled ? 'translateY(1px)' : 'none',
  };

  const arrow = withArrow ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true"
      style={{ transform: hover && !disabled ? 'translateX(2px)' : 'none', transition: 'transform var(--dur-base) var(--ease-out-expo)' }}>
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  ) : null;

  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => { setHover(false); setActive(false); },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    onClick: disabled ? undefined : onClick,
  };

  if (href && !disabled) {
    return (
      <a href={href} style={style} {...handlers} {...rest}>
        {children}{arrow}
      </a>
    );
  }
  return (
    <button type={type} disabled={disabled} style={style} {...handlers} {...rest}>
      {children}{arrow}
    </button>
  );
}
