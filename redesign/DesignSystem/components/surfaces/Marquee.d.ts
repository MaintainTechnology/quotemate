import * as React from 'react';

export interface MarqueeProps {
  /** The strings to tick across (separated by a middot). */
  items?: React.ReactNode[];
  /** Loop duration in seconds. Default 36. */
  speed?: number;
  /** Font size in px. Default 22. */
  fontSize?: number;
}

/** The signature yellow CTA ticker — dark ink on yellow, seamless loop. */
export function Marquee(props: MarqueeProps): React.ReactElement;
