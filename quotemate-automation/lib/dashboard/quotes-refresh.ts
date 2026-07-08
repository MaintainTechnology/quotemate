// Refresh-on-return surface predicate for the dashboard quotes feed (spec
// quotes-tab-sync Task 5). The dashboard loads /api/tenant/me once on
// mount; page.tsx composes this predicate with the shared 15 s throttle
// (lib/dashboard/recent-activity.ts shouldRefresh) so a quote drafted while
// the dashboard is open (SMS pipeline, another tab's trade tool) appears on
// the next return without a hard reload.

/** Tabs whose content is fed by data.quotes: the cross-trade workspace
 *  Quotes tab and every trade hub (hub-<slug>, whose Quotes section filters
 *  the same feed). */
export function isQuotesSurface(tab: string): boolean {
  return tab === 'quotes' || tab.startsWith('hub-')
}
