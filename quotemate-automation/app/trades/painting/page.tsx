import type { Metadata } from "next"
import { TradePage } from "../_template"
import { TRADES } from "../_data"

const data = TRADES.painting

export const metadata: Metadata = {
  title: "Painting quoting — QuoteMax",
  description: data.intro,
}

export default function PaintingTradePage() {
  return <TradePage data={data} />
}
