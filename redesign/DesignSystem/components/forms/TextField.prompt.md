Square, hairline-bordered field on the sunken surface, with a mono uppercase label. Border warms to accent on focus.

```jsx
<TextField label="Business name" placeholder="Sparky Co" required />
<TextField label="Trade" as="select" options={["Electrical", "Plumbing"]} />
<TextField label="Scope notes" as="textarea" hint="Optional" />
<TextField label="ABN" error="Enter a valid 11-digit ABN" />
```

- `as` switches between input / textarea / select. `error` turns the border red and shows the message; otherwise `hint` shows.
- Labels are mono uppercase; the required marker is a yellow asterisk. Keep it controlled (`value` + `onChange`) or uncontrolled (`defaultValue`).
