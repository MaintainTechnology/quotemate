// Flyer Designer — ready-made template definitions (pure data).
//
// Each template is a fixed-size canvas with an ordered element list. Text
// elements may carry a `binding` that resolves to a tenant brand field at
// build time (see document.ts). Every template carries exactly one `image`
// element with role 'qr' — the slot a QR code drops into.
//
// Canvas is A-series portrait at print-ish resolution (800 × 1131 ≈ √2).

import type { FlyerTemplate } from './schema'

const W = 800
const H = 1131

/** Reusable QR slot — bottom-right, square. src is filled when a QR is added. */
function qrSlot(x: number, y: number, size = 150): FlyerTemplate['elements'][number] {
  return { id: 'qr', kind: 'image', src: null, role: 'qr', x, y, width: size, height: size }
}

export const FLYER_TEMPLATES: FlyerTemplate[] = [
  {
    id: 'bold-promo',
    name: 'Bold promo',
    description: 'High-contrast headline banner — best for a special offer or callout.',
    width: W,
    height: H,
    background: '#0B1220',
    elements: [
      { id: 'band', kind: 'rect', x: 0, y: 0, width: W, height: 280, fill: '#F25C26' },
      { id: 'logo', kind: 'image', src: null, role: 'logo', x: 48, y: 56, width: 168, height: 168 },
      { id: 'business', kind: 'text', binding: 'business_name', text: 'Your Business', x: 240, y: 96, width: 512, height: 70, fontFamily: 'Impact', fontSize: 56, fontStyle: 'bold', fill: '#0B1220', align: 'left' },
      { id: 'headline', kind: 'text', binding: 'headline', text: 'Quality Trade Services', x: 48, y: 360, width: 704, height: 140, fontFamily: 'Inter', fontSize: 60, fontStyle: 'bold', fill: '#FFFFFF', align: 'left' },
      { id: 'tagline', kind: 'text', binding: 'tagline', text: 'Fast, reliable, fully licensed — book your job today.', x: 48, y: 520, width: 704, height: 120, fontFamily: 'Inter', fontSize: 30, fill: '#C7D0DB', align: 'left' },
      { id: 'phone', kind: 'text', binding: 'phone', text: '00 0000 0000', x: 48, y: 940, width: 460, height: 50, fontFamily: 'Inter', fontSize: 34, fontStyle: 'bold', fill: '#F25C26', align: 'left' },
      { id: 'email', kind: 'text', binding: 'email', text: 'you@business.com.au', x: 48, y: 1000, width: 460, height: 44, fontFamily: 'Inter', fontSize: 26, fill: '#C7D0DB', align: 'left' },
      { id: 'scan', kind: 'text', text: 'Scan to get a quote', x: 560, y: 920, width: 200, height: 36, fontFamily: 'Inter', fontSize: 20, fill: '#C7D0DB', align: 'center' },
      qrSlot(585, 960, 150),
    ],
  },
  {
    id: 'clean-services',
    name: 'Clean services',
    description: 'Bright, minimal layout — logo up top, services and contact below.',
    width: W,
    height: H,
    background: '#FFFFFF',
    elements: [
      { id: 'logo', kind: 'image', src: null, role: 'logo', x: 316, y: 64, width: 168, height: 168 },
      { id: 'business', kind: 'text', binding: 'business_name', text: 'Your Business', x: 48, y: 256, width: 704, height: 64, fontFamily: 'Georgia', fontSize: 52, fontStyle: 'bold', fill: '#0B1220', align: 'center' },
      { id: 'rule', kind: 'rect', x: 300, y: 340, width: 200, height: 6, fill: '#F25C26' },
      { id: 'headline', kind: 'text', binding: 'headline', text: 'Quality Trade Services', x: 48, y: 380, width: 704, height: 60, fontFamily: 'Inter', fontSize: 36, fill: '#3A4654', align: 'center' },
      { id: 'tagline', kind: 'text', binding: 'tagline', text: 'Honest pricing. Workmanship guaranteed.', x: 48, y: 460, width: 704, height: 80, fontFamily: 'Inter', fontSize: 26, fill: '#5A6675', align: 'center' },
      { id: 'phone', kind: 'text', binding: 'phone', text: '00 0000 0000', x: 48, y: 980, width: 704, height: 50, fontFamily: 'Inter', fontSize: 34, fontStyle: 'bold', fill: '#0B1220', align: 'center' },
      { id: 'email', kind: 'text', binding: 'email', text: 'you@business.com.au', x: 48, y: 1040, width: 704, height: 44, fontFamily: 'Inter', fontSize: 24, fill: '#5A6675', align: 'center' },
      { id: 'scan', kind: 'text', text: 'Scan to get a quote', x: 325, y: 720, width: 150, height: 30, fontFamily: 'Inter', fontSize: 18, fill: '#5A6675', align: 'center' },
      qrSlot(325, 760, 150),
    ],
  },
  {
    id: 'contact-card',
    name: 'Contact card',
    description: 'Dark, card-style layout that puts your phone, email and QR front and centre.',
    width: W,
    height: H,
    background: '#10182A',
    elements: [
      { id: 'panel', kind: 'rect', x: 48, y: 48, width: W - 96, height: H - 96, fill: '#0B1220', cornerRadius: 18 },
      { id: 'logo', kind: 'image', src: null, role: 'logo', x: 96, y: 104, width: 140, height: 140 },
      { id: 'business', kind: 'text', binding: 'business_name', text: 'Your Business', x: 260, y: 136, width: 444, height: 70, fontFamily: 'Trebuchet MS', fontSize: 48, fontStyle: 'bold', fill: '#FFFFFF', align: 'left' },
      { id: 'headline', kind: 'text', binding: 'headline', text: 'Quality Trade Services', x: 96, y: 300, width: 608, height: 56, fontFamily: 'Inter', fontSize: 34, fill: '#F25C26', align: 'left' },
      { id: 'tagline', kind: 'text', binding: 'tagline', text: 'Need a job done right? Get in touch.', x: 96, y: 380, width: 608, height: 90, fontFamily: 'Inter', fontSize: 28, fill: '#C7D0DB', align: 'left' },
      { id: 'phone', kind: 'text', binding: 'phone', text: '00 0000 0000', x: 96, y: 560, width: 480, height: 56, fontFamily: 'Inter', fontSize: 40, fontStyle: 'bold', fill: '#FFFFFF', align: 'left' },
      { id: 'email', kind: 'text', binding: 'email', text: 'you@business.com.au', x: 96, y: 640, width: 480, height: 44, fontFamily: 'Inter', fontSize: 26, fill: '#C7D0DB', align: 'left' },
      { id: 'scan', kind: 'text', text: 'Scan to get a quote', x: 96, y: 920, width: 220, height: 32, fontFamily: 'Inter', fontSize: 20, fill: '#C7D0DB', align: 'left' },
      qrSlot(96, 956, 160),
    ],
  },
]

export function getTemplate(id: string): FlyerTemplate | null {
  return FLYER_TEMPLATES.find((t) => t.id === id) ?? null
}

export const FLYER_TEMPLATE_IDS = FLYER_TEMPLATES.map((t) => t.id)
