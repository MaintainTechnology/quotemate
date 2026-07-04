import * as React from 'react';

export interface ButtonProps extends React.HTMLAttributes<HTMLElement> {
  /** Visual weight. `primary` = yellow fill / dark ink (the headline action). */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** `md` is the default; `lg` is the marketing hero CTA. */
  size?: 'sm' | 'md' | 'lg';
  /** When set, renders as an <a> instead of a <button>. */
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Append the brand forward-arrow that nudges right on hover. */
  withArrow?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  children?: React.ReactNode;
}

/**
 * The QuoteMax button. Square corners, uppercase, tracked. Text on the
 * yellow fill is always dark ink — never white.
 *
 * @startingPoint section="Core" subtitle="Primary / secondary / ghost actions" viewport="700x220"
 */
export function Button(props: ButtonProps): React.ReactElement;
