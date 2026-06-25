import type { Metadata } from "next"
import { TradePage } from "../_template"
import { TRADES } from "../_data"

const data = TRADES.roofing

export const metadata: Metadata = {
  title: "Roofing quoting — QuoteMax",
  description: data.intro,
}

export default function RoofingTradePage() {
  return <TradePage data={data} />
}
