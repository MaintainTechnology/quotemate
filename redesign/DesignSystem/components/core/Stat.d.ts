import * as React from 'react';

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The big mono figure — e.g. "< 1 min", "$0", "24/7". */
  value: React.ReactNode;
  /** Mono uppercase caption under the figure. */
  label: React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

/** A big accent mono figure over a mono uppercase label — the brand's headline numbers. */
export function Stat(props: StatProps): React.ReactElement;
