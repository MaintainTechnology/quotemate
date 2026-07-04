import * as React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** `neutral` hairline (default), `accent` yellow-tinted, `solid` yellow fill. */
  tone?: 'neutral' | 'accent' | 'solid';
  /** Optional leading icon (an <img> flag, a Lucide glyph). */
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Square mono-uppercase chip for trust signals, pilot status and metadata.
 *
 * @startingPoint section="Core" subtitle="Trust / status chips" viewport="700x180"
 */
export function Badge(props: BadgeProps): React.ReactElement;
