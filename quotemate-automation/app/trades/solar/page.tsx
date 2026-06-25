import type { Metadata } from "next"
import { TradePage } from "../_template"
import { TRADES } from "../_data"

const data = TRADES.solar

export const metadata: Metadata = {
  title: "Solar quoting — QuoteMax",
  description: data.intro,
}

export default function SolarTradePage() {
  return <TradePage data={data} />
}
