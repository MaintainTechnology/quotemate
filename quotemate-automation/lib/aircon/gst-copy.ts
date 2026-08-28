export function airconPriceBasis(gstRegistered: boolean): 'inc GST' | 'no GST charged' {
  return gstRegistered ? 'inc GST' : 'no GST charged'
}

export function airconPriceBasisUpper(gstRegistered: boolean): 'INC GST' | 'NO GST CHARGED' {
  return gstRegistered ? 'INC GST' : 'NO GST CHARGED'
}

export function airconPriceBasisSentence(gstRegistered: boolean): string {
  return gstRegistered
    ? 'Prices shown include 10% GST and cover indicative supply and installation; electrical, switchboard or building works are quoted separately if required.'
    : 'No GST is charged. Prices cover indicative supply and installation; electrical, switchboard or building works are quoted separately if required.'
}
