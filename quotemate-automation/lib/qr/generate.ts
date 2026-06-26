// QR code generation for the announcement email. The `qrcode` package is
// already a dependency. We render to a PNG data URI so the QR can be embedded
// directly in the HTML email (<img src="data:image/png;base64,...">) without
// needing a hosted asset.

import * as QRCode from 'qrcode'

/**
 * Render `data` (which must be an absolute http(s) URL) to a base64 PNG data
 * URI suitable for an <img src>. High error-correction so a printed/scaled QR
 * stays scannable.
 */
export async function generateQrDataUrl(
  data: string,
  opts?: { width?: number },
): Promise<string> {
  if (!data || !/^https?:\/\//i.test(data)) {
    throw new Error('QR data must be an absolute http(s) URL')
  }
  return QRCode.toDataURL(data, {
    errorCorrectionLevel: 'H',
    width: opts?.width ?? 320,
    margin: 1,
  })
}
