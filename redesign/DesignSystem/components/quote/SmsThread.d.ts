import * as React from 'react';

export interface SmsMessage {
  from: 'customer' | 'quotemax';
  text: React.ReactNode;
}

export interface SmsThreadProps {
  messages?: SmsMessage[];
  /** Show a trailing 3-dot typing indicator (QuoteMax drafting). */
  typing?: boolean;
  /** A "quote drafted" drop: { label?, amount }. amount as number → AUD. */
  quote?: { label?: string; amount: number | string };
  /** Show the "Live example · SMS intake" header bar. Default true. */
  header?: boolean;
}

/**
 * The live SMS-intake demo — content bubbles on the canvas, not a phone frame.
 *
 * @startingPoint section="Quote" subtitle="Live SMS-intake demo" viewport="460x420"
 */
export function SmsThread(props: SmsThreadProps): React.ReactElement;
