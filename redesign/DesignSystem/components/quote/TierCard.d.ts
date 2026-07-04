import * as React from 'react';

export interface TierCardProps extends React.HTMLAttributes<HTMLElement> {
  /** Tier label — "Good" / "Better" / "Best", or a trade-specific label. */
  tier?: React.ReactNode;
  blurb?: React.ReactNode;
  /** Price including GST — a number is formatted as AUD, or pass a string. */
  priceIncGst: number | string;
  /** Deposit-to-book amount (number formatted as AUD). Omit to hide the line. */
  depositAmount?: number | string;
  depositPct?: number;
  /** Accent border + "Recommended" badge. */
  recommended?: boolean;
  /** Paid state — shows the green "Deposit paid" block. */
  paid?: boolean;
  /** Dim + lock (a sibling tier was paid, or not yet confirmed). */
  disabled?: boolean;
  ctaLabel?: string;
  href?: string;
  onPay?: React.MouseEventHandler<HTMLAnchorElement>;
  children?: React.ReactNode;
}

/**
 * A Good / Better / Best option on the customer quote page — price inc GST,
 * deposit line, deposit CTA.
 *
 * @startingPoint section="Quote" subtitle="Good / Better / Best tier card" viewport="380x440"
 */
export function TierCard(props: TierCardProps): React.ReactElement;
