// Pylon proposal → customer SMS body (sent on tradie-confirm when the
// project carried a customer mobile). PURE — mirrors buildSolarCustomerSms.

export function buildPylonCustomerSms(args: {
  businessName: string
  customerName?: string | null
  title: string | null
  totalFormatted: string | null
  quoteUrl: string
  pdfUrl?: string | null
}): string {
  const hi = args.customerName ? `Hi ${args.customerName}, ` : 'Hi, '
  const what = args.title ? `${args.title}` : 'your solar proposal'
  const price = args.totalFormatted ? ` — ${args.totalFormatted} inc GST` : ''
  const pdf = args.pdfUrl ? ` · PDF copy: ${args.pdfUrl}` : ''
  return (
    `${hi}your solar proposal from ${args.businessName} is ready: ` +
    `${what}${price}. View it: ${args.quoteUrl}${pdf}`
  )
}
