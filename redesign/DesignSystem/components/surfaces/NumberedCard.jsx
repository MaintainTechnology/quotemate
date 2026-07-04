import React from 'react';
import { Card } from './Card';

/**
 * NumberedCard — the signature step card: a large JetBrains-Mono number in
 * accent beside an all-caps title and body. Built on Card, so it inherits
 * the lit edge and the optional hover sweep.
 */
export function NumberedCard({ num, title, body, children, interactive = true, sweep = true, ...rest }) {
  return (
    <Card interactive={interactive} sweep={sweep} padding={32} {...rest}>
      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            lineHeight: 0.8,
            fontSize: 'clamp(2.75rem, 5vw, 4.5rem)',
            color: 'var(--accent)',
          }}
        >
          {num}
        </span>
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--font-sans)',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '-0.02em',
              fontSize: 'var(--text-2xl)',
              color: 'var(--text-pri)',
            }}
          >
            {title}
          </h3>
          {body ? (
            <p style={{ margin: '12px 0 0', fontSize: 'var(--text-base)', lineHeight: 1.55, color: 'var(--text-sec)', maxWidth: '48ch' }}>
              {body}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </Card>
  );
}
