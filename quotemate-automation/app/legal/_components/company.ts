// Single source of truth for the company-specific details that appear
// across the legal pages. These are TEMPLATE PLACEHOLDERS — fill them in
// (and have a lawyer review the copy) before relying on these pages.
//
// Keeping them here means go-live is a one-file edit, and every policy stays
// consistent (same entity name, ABN, contact email everywhere).

export const COMPANY = {
  /** Registered legal entity that operates QuoteMax. */
  legalName: '[LEGAL ENTITY NAME] Pty Ltd',
  /** Customer-facing product/brand name. */
  product: 'QuoteMax',
  /** Australian Business Number. */
  abn: '[ABN — e.g. 00 000 000 000]',
  /** Registered business address. */
  address: '[REGISTERED BUSINESS ADDRESS, Australia]',
  /** Where privacy enquiries and access/correction requests go. */
  privacyEmail: '[privacy@yourdomain.com.au]',
  /** General support contact. */
  supportEmail: '[support@yourdomain.com.au]',
  /** Governing jurisdiction for the Terms. */
  governingState: 'New South Wales, Australia',
  /** Shown as the "last updated" stamp on every policy. */
  lastUpdated: '26 June 2026',
} as const
