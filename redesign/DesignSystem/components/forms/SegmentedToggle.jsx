import React from 'react';

/**
 * SegmentedToggle — a square bordered group of options where the active one
 * is a yellow fill with dark ink. The brand's Monthly/Annual switch and any
 * 2–3 option mode picker.
 */
export function SegmentedToggle({ options = [], value, onChange, ariaLabel }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        border: '1px solid var(--ink-line)',
        background: 'var(--ink-card)',
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((o) => {
        const opt = typeof o === 'string' ? { label: o, value: o } : o;
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange && onChange(opt.value)}
            style={{
              border: 0,
              cursor: 'pointer',
              padding: '8px 18px',
              fontFamily: 'var(--font-sans)',
              fontSize: '12px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--accent-ink)' : 'var(--text-sec)',
              transition: 'background-color var(--dur-fast) ease, color var(--dur-fast) ease',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
