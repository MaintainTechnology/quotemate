import type { Metadata } from "next"
import { TradePage } from "../_template"
import { TRADES } from "../_data"

const data = TRADES.plumbing

export const metadata: Metadata = {
  title: "Plumbing quoting — QuoteMax",
  description: data.intro,
}

export default function PlumbingTradePage() {
  return <TradePage data={data} />
}
