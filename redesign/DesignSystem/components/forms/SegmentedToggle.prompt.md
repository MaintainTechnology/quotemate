Square segmented control for 2–3 options — the active option is a yellow fill with dark ink. The brand's Monthly/Annual switch and tier-mode pickers.

```jsx
const [v, setV] = React.useState('annual');
<SegmentedToggle ariaLabel="Billing period"
  options={[{label:'Monthly',value:'monthly'},{label:'Annual',value:'annual'}]}
  value={v} onChange={setV} />
```

- Keep to 2–3 short uppercase labels. For more/longer options use a `TextField` select instead.
