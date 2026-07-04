import * as React from 'react';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Full name — initials are derived from it when no `src`. */
  name?: string;
  /** Image URL; falls back to initials when absent. */
  src?: string;
  /** Pixel size of the square/disc. Default 40. */
  size?: number;
  /** Round it into a disc (the one place the brand uses a full radius). */
  round?: boolean;
  tone?: 'accent' | 'ink';
}

/** Identity tile — image or initials. Square yellow tile by default, echoing the mark. */
export function Avatar(props: AvatarProps): React.ReactElement;
