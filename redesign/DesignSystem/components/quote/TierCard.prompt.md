A Good / Better / Best option on the customer quote page: big mono price (inc GST), a deposit-to-book line, and a deposit CTA.

```jsx
<TierCard tier="Better" recommended
  blurb="The recommended balance of quality and value."
  priceIncGst={890} depositAmount={267} depositPct={30} ctaLabel="Pay deposit" />
<TierCard tier="Good" priceIncGst={640} depositAmount={192} />
<TierCard tier="Best" priceIncGst={1180} paid />
```

- `recommended` gives the accent border + badge. `paid` shows the green paid block; `disabled` dims a sibling once one tier is paid.
- Lay three in a responsive grid. Prices are mono `tabular-nums`; all prices are inc GST and deposits are a % of the tier.
