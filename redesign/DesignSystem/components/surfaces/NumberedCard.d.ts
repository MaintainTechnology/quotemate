import * as React from 'react';

export interface NumberedCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The big mono number, e.g. "01". */
  num: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  /** Hover sweep (default true) and interactive hover (default true). */
  sweep?: boolean;
  interactive?: boolean;
  children?: React.ReactNode;
}

/**
 * The signature step card — big accent mono number beside an all-caps title.
 *
 * @startingPoint section="Surfaces" subtitle="Numbered step card" viewport="700x220"
 */
export function NumberedCard(props: NumberedCardProps): React.ReactElement;
