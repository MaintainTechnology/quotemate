import * as React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  as?: keyof JSX.IntrinsicElements;
  /** Inner padding in px. Default 28. */
  padding?: number;
  /** Inner "lit edge" highlight. Default true. */
  lit?: boolean;
  /** Draw the 2px accent sweep across the top edge on hover/focus-within. */
  sweep?: boolean;
  /** Warm the border to accent and lift the surface a step on hover. */
  interactive?: boolean;
  /** A persistent 2px accent rule along the top edge (e.g. the featured tier). */
  accentTop?: boolean;
  /** Render as an <a>. */
  href?: string;
  children?: React.ReactNode;
}

/**
 * The structural surface — palette-charcoal panel, warm hairline, lit edge.
 *
 * @startingPoint section="Surfaces" subtitle="Bordered panel with lit edge" viewport="700x240"
 */
export function Card(props: CardProps): React.ReactElement;
