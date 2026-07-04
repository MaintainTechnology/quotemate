The signature live SMS-intake demo — content bubbles on the canvas (never a fake phone frame). Inbound = customer; outbound = QuoteMax (accent-tinted, labelled). Optional typing indicator and a "quote drafted" price drop.

```jsx
<SmsThread
  messages={[
    { from: 'customer', text: "Hey mate, need 6 downlights in the lounge. What's it cost?" },
    { from: 'quotemax', text: "All new fittings, or swapping existing? Is there roof-space access?" },
    { from: 'customer', text: "All new. Roof access is easy." },
  ]}
  typing
  quote={{ amount: 890 }}
/>
```

- Use it to show the product working (marketing hero, explainers). Keep the conversation short and real — plumbing/electrical jobs in Australian English. The price drop is a `Sample`.
