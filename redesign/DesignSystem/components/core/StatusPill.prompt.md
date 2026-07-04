A dot + mono label that reports live state.

```jsx
<StatusPill tone="live" pulse>Account active</StatusPill>
<StatusPill tone="review">Awaiting review</StatusPill>
<StatusPill tone="paid">Deposit paid</StatusPill>
```

- **Tones:** `live`/`paid` (green), `review` (amber), `error` (red), `neutral` (dim). Border + text share the tone; the dot is a filled circle.
- Set `pulse` only for a truly live signal — not for static states.
