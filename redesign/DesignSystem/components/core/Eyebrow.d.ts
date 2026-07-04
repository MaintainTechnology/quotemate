import * as React from 'react';

export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render. Default `span`. */
  as?: keyof JSX.IntrinsicElements;
  /** Override the colour (defaults to `--text-dim`). */
  color?: string;
  children?: React.ReactNode;
}

/** Mono uppercase eyebrow label above a headline or naming a section. */
export function Eyebrow(props: EyebrowProps): React.ReactElement;
