import * as React from 'react';

type Option = string | { label: string; value: string };

export interface SegmentedToggleProps {
  options: Option[];
  /** Currently selected value. */
  value?: string;
  onChange?: (value: string) => void;
  ariaLabel?: string;
}

/** Square segmented control — the active option is a yellow fill / dark ink. */
export function SegmentedToggle(props: SegmentedToggleProps): React.ReactElement;
