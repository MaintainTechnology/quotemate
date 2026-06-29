// Canva flyer studio — curated "suggested template" starting points (pure data).
//
// Canva Connect (non-Enterprise) can't inject a layout into a design via the
// API — Brand Templates/Autofill are Enterprise-only. So a "suggested template"
// here is a curated jump-off into Canva's own template gallery for that flyer
// style. Each entry links to a STABLE Canva template-search URL (no fabricated
// template ids that could 404) and carries a `layout` that drives an on-brand
// SVG thumbnail rendered in the inline Canva studio. Pure module — unit-tested.

export type FlyerTemplateLayout =
  | 'services'
  | 'promo'
  | 'beforeafter'
  | 'contact'
  | 'seasonal'
  | 'hiring'

export interface FlyerTemplateSuggestion {
  id: string
  name: string
  /** One-line, AU English, what this flyer is for. */
  description: string
  /** Short category chip label. */
  category: string
  /** Drives the SVG thumbnail variant in the gallery. */
  layout: FlyerTemplateLayout
  /** Accent token used in the thumbnail ('accent' = orange, 'teal' = teal-glow). */
  accent: 'accent' | 'teal'
  /** Stable Canva template-gallery search URL (opens in a new tab). */
  canvaUrl: string
}

const CANVA_TEMPLATES = 'https://www.canva.com/templates/'

/** Build a guaranteed-valid Canva template-search URL for a query. */
function canvaSearch(query: string): string {
  return `${CANVA_TEMPLATES}?query=${encodeURIComponent(query)}`
}

export const FLYER_TEMPLATE_SUGGESTIONS: FlyerTemplateSuggestion[] = [
  {
    id: 'services-rundown',
    name: 'Services Rundown',
    description: 'List what you do, your service area and a clear call to action.',
    category: 'Services',
    layout: 'services',
    accent: 'accent',
    canvaUrl: canvaSearch('tradie services flyer'),
  },
  {
    id: 'limited-offer',
    name: 'Limited-Time Offer',
    description: 'Headline a discount or seasonal deal to drive quick enquiries.',
    category: 'Promotion',
    layout: 'promo',
    accent: 'accent',
    canvaUrl: canvaSearch('special offer discount flyer'),
  },
  {
    id: 'before-after',
    name: 'Before & After',
    description: 'Show a job transformation — the strongest proof you can print.',
    category: 'Showcase',
    layout: 'beforeafter',
    accent: 'teal',
    canvaUrl: canvaSearch('before and after renovation flyer'),
  },
  {
    id: 'contact-card',
    name: 'Contact Card',
    description: 'A compact leave-behind: name, trade, phone and a QR code.',
    category: 'Contact',
    layout: 'contact',
    accent: 'accent',
    canvaUrl: canvaSearch('business contact card flyer'),
  },
  {
    id: 'seasonal-special',
    name: 'Seasonal Special',
    description: 'Tie a campaign to the season — winter heating, summer cooling.',
    category: 'Seasonal',
    layout: 'seasonal',
    accent: 'teal',
    canvaUrl: canvaSearch('seasonal sale service flyer'),
  },
  {
    id: 'now-hiring',
    name: 'Now Hiring',
    description: 'Put the word out for an apprentice or a qualified tradie.',
    category: 'Recruitment',
    layout: 'hiring',
    accent: 'accent',
    canvaUrl: canvaSearch('now hiring recruitment flyer'),
  },
]

/** Look up a suggestion by id (null when unknown). */
export function getTemplateSuggestion(id: string): FlyerTemplateSuggestion | null {
  return FLYER_TEMPLATE_SUGGESTIONS.find((t) => t.id === id) ?? null
}
