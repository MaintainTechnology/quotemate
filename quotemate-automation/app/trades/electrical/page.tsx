import type { Metadata } from "next"
import { TradePage } from "../_template"
import { TRADES } from "../_data"

const data = TRADES.electrical

export const metadata: Metadata = {
  title: "Electrical quoting — QuoteMax",
  description: data.intro,
}

export default function ElectricalTradePage() {
  return <TradePage data={data} />
}
