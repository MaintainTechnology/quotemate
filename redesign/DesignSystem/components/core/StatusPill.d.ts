import * as React from 'react';

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Colour intent for the dot + label. */
  tone?: 'live' | 'paid' | 'review' | 'error' | 'neutral';
  /** Pulse the dot — reserve for a genuinely live signal. */
  pulse?: boolean;
  children?: React.ReactNode;
}

/** A dot + mono label reporting live state (account active, awaiting review, paid). */
export function StatusPill(props: StatusPillProps): React.ReactElement;
