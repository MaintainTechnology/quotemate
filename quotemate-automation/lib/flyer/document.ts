// Flyer Designer — binding resolution + document assembly (pure).
//
// buildInitialDocument: template + tenant brand → the starting editable
//   document, with every text binding and the logo slot resolved. Missing
//   brand fields fall back to the template's placeholder copy / a null image
//   src — never throws (spec edge case E1).
// applyOverrides: template + a saved document → the element list to render,
//   with saved elements winning and document-only elements (uploaded images,
//   an inserted QR) appended.

import type { FlyerDocument, FlyerElement, FlyerTemplate, TextBinding } from './schema'

export type FlyerTenantBrand = {
  business_name?: string | null
  logo_url?: string | null
  owner_email?: string | null
  owner_mobile?: string | null
  trade?: string | null
}

/** A customer-facing headline derived from the tenant's primary trade. */
export function headlineForTrade(trade?: string | null): string {
  switch ((trade ?? '').toLowerCase()) {
    case 'electrical':
      return 'Licensed Electrical Services'
    case 'plumbing':
      return 'Licensed Plumbing Services'
    case 'painting':
      return 'Professional Painting Services'
    case 'roofing':
      return 'Roofing & Gutters Specialists'
    default:
      return 'Quality Trade Services'
  }
}

/** Resolve a text binding against tenant brand data. Returns '' when the
 *  underlying field is missing so the caller can fall back to placeholder. */
export function resolveBinding(binding: TextBinding, tenant: FlyerTenantBrand): string {
  switch (binding) {
    case 'business_name':
      return (tenant.business_name ?? '').trim()
    case 'email':
      return (tenant.owner_email ?? '').trim()
    case 'phone':
      return (tenant.owner_mobile ?? '').trim()
    case 'headline':
      return headlineForTrade(tenant.trade)
    case 'tagline':
      // tagline has no tenant field — keep the template's copy.
      return ''
    default:
      return ''
  }
}

export function buildInitialDocument(template: FlyerTemplate, tenant: FlyerTenantBrand): FlyerDocument {
  const elements: FlyerElement[] = template.elements.map((el) => {
    if (el.kind === 'text' && el.binding) {
      const resolved = resolveBinding(el.binding, tenant)
      return { ...el, text: resolved || el.text }
    }
    if (el.kind === 'image' && el.role === 'logo') {
      return { ...el, src: tenant.logo_url ?? el.src ?? null }
    }
    return el
  })
  return {
    templateId: template.id,
    width: template.width,
    height: template.height,
    background: template.background,
    elements,
  }
}

/** Merge a saved document over its template: saved elements win by id, and
 *  any document-only elements (uploads / inserted QR) are appended. */
export function applyOverrides(template: FlyerTemplate, document: FlyerDocument): FlyerElement[] {
  const byId = new Map(document.elements.map((e) => [e.id, e]))
  const merged: FlyerElement[] = template.elements.map((t) => byId.get(t.id) ?? t)
  const templateIds = new Set(template.elements.map((t) => t.id))
  for (const e of document.elements) {
    if (!templateIds.has(e.id)) merged.push(e)
  }
  return merged
}
