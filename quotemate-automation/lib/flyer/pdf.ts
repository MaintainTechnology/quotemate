// Flyer Designer — PDF page sizing (pure).
//
// The client exports the Konva stage to a PNG, then embeds it in a single-page
// PDF sized to the flyer's pixel dimensions. This helper derives the jsPDF page
// spec from the flyer canvas size; the actual jsPDF call lives in the client
// editor (jspdf is a browser module and must not be imported by node tests).

export type PdfPageSpec = {
  orientation: 'portrait' | 'landscape'
  unit: 'px'
  format: [number, number]
}

export function pdfPageSpec(widthPx: number, heightPx: number): PdfPageSpec {
  const w = Math.max(1, Math.round(widthPx))
  const h = Math.max(1, Math.round(heightPx))
  return {
    orientation: w > h ? 'landscape' : 'portrait',
    unit: 'px',
    format: [w, h],
  }
}
