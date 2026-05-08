# NGM Editorial Design System

Complete style guide for NextGeneration Medicine HTML content. Extracted from the live NGM Commons guide pages and partners landing page.

---

## Brand Identity

NextGeneration Medicine is a longevity medicine education platform targeting:
- Physicians entering the longevity space
- Health-conscious professionals
- Evidence-based practitioners

**Voice:** Authoritative yet accessible, evidence-based, clinically actionable.

**Aesthetic:** Typography-driven editorial hierarchy. Magazine-quality, not corporate. Think: The Economist, NEJM, The Atlantic. No card grids — use vertical rhythm, pull quotes, and typographic markers.

---

## Typography

Three-font stack. Never deviate from this.

```
Display: "Cormorant Garamond", Georgia, serif    — headlines, pull quotes, section markers
Body:    "Source Serif 4", Georgia, serif         — running text, lede paragraphs
UI:      "DM Sans", system-ui, sans-serif         — labels, kickers, captions, metadata, tables
```

### Google Fonts Import (Lead Magnets)
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### Type Scale
| Element | Font | Size | Weight | Line-height | Color |
|---------|------|------|--------|-------------|-------|
| H1 | Cormorant Garamond | 2.8rem | 400 | 1.15 | --ink |
| H2 | Cormorant Garamond | 2rem | 400 | 1.2 | --ink |
| H3 | Cormorant Garamond | 1.35rem | 500 | 1.3 | --ink |
| Body | Source Serif 4 | 17px | 400 | 1.8 | --ink-2 |
| Lede | Source Serif 4 | 1.15rem | 400 | 1.75 | --ink |
| Kicker | DM Sans | 11px | 700 | — | --accent |
| Deck | Cormorant Garamond | 1.25rem | 400 italic | 1.6 | --ink-3 |
| Caption | DM Sans | 13px | 400 | 1.6 | --ink-3 |
| Label | DM Sans | 10-11px | 700 | — | varies |

---

## Color Palette

### Guide Pages (Editorial / Lead Magnets)
```css
:root {
  --paper: #FEFDFB;        /* Warm off-white background */
  --paper-warm: #F5F3EE;   /* Slightly warmer for callouts */
  --ink: #1A1A1A;           /* Primary text, headings */
  --ink-2: #3A3A3A;         /* Body text */
  --ink-3: #6A6A6A;         /* Secondary text */
  --ink-4: #9A9A9A;         /* Tertiary text, captions */
  --ink-faint: #BEBEBE;     /* Very light text */
  --rule: #D4D0C8;          /* Primary dividers */
  --rule-light: #E8E5DE;    /* Light dividers */

  --accent: #8B7355;        /* Primary accent — warm brown */
  --accent-light: #A89070;  /* Lighter accent */
  --green: #4A7A5A;         /* Positive states, mechanistic notes */
  --blue: #4A6A7A;          /* Links, informational */
  --orange: #B06840;        /* Mixed/caution states */
  --purple: #6A5A7A;        /* Special, advanced */
}
```

### Usage Rules
- Accent color max 5-10% of visual area
- Prefer ink tones for most elements
- Use warm paper (#FEFDFB) not pure white
- Borders are warm-toned (#D4D0C8), not cool gray

---

## Lead Magnet HTML Template

Lead magnets use the editorial guide design with CSS `<style>` blocks (not inline styles) for clean, maintainable code.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title} | NGM Commons</title>
  <meta name="description" content="{description}">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    :root {
      --font-display: "Cormorant Garamond", Georgia, serif;
      --font-body: "Source Serif 4", Georgia, serif;
      --font-ui: "DM Sans", system-ui, sans-serif;

      --paper: #FEFDFB;
      --paper-warm: #F5F3EE;
      --ink: #1A1A1A;
      --ink-2: #3A3A3A;
      --ink-3: #6A6A6A;
      --ink-4: #9A9A9A;
      --ink-faint: #BEBEBE;
      --rule: #D4D0C8;
      --rule-light: #E8E5DE;

      --accent: #8B7355;
      --accent-light: #A89070;
      --green: #4A7A5A;
      --blue: #4A6A7A;
      --orange: #B06840;
      --purple: #6A5A7A;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-body);
      font-size: 17px;
      line-height: 1.8;
      color: var(--ink-2);
      background: var(--paper);
      max-width: 820px;
      margin: 0 auto;
      padding: 48px 24px 80px;
      -webkit-font-smoothing: antialiased;
    }

    h1 { font-family: var(--font-display); font-size: 2.8rem; font-weight: 400; line-height: 1.15; color: var(--ink); letter-spacing: -0.01em; margin-bottom: 16px; }
    h2 { font-family: var(--font-display); font-size: 2rem; font-weight: 400; color: var(--ink); line-height: 1.2; margin: 0; }
    h3 { font-family: var(--font-display); font-size: 1.35rem; font-weight: 500; color: var(--ink); margin: 40px 0 12px; line-height: 1.3; }
    p { margin-bottom: 20px; }
    strong { color: var(--ink); font-weight: 600; }

    .breadcrumb { font-family: var(--font-ui); font-size: 13px; color: var(--ink-4); margin-bottom: 48px; }
    .breadcrumb a { color: var(--blue); text-decoration: none; }
    .kicker { font-family: var(--font-ui); font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--accent); display: block; margin-bottom: 16px; }
    .deck { font-family: var(--font-display); font-size: 1.25rem; font-style: italic; color: var(--ink-3); line-height: 1.6; max-width: 620px; margin-bottom: 20px; }
    .byline { font-family: var(--font-ui); font-size: 13px; color: var(--ink-4); display: flex; gap: 8px; flex-wrap: wrap; padding-bottom: 48px; border-bottom: 1px solid var(--rule); }

    .bottom-line { margin: 48px 0 64px; padding-left: 24px; border-left: 2px solid var(--accent); }
    .bottom-line-label { font-family: var(--font-ui); font-size: 10px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--accent); display: block; margin-bottom: 12px; }
    .bottom-line p { font-size: 18px; line-height: 1.75; color: var(--ink-2); margin: 0; }

    .section-marker { margin-bottom: 32px; }
    .section-num { font-family: var(--font-display); font-size: 13px; font-weight: 400; letter-spacing: 0.2em; color: var(--accent); display: block; margin-bottom: 6px; }
    section { margin-top: 80px; }

    .lede { font-size: 1.15rem; line-height: 1.75; color: var(--ink); max-width: 660px; margin-bottom: 24px; }
    .pull-quote { margin: 48px auto; padding: 32px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); font-family: var(--font-display); font-size: 1.4rem; font-style: italic; line-height: 1.55; color: var(--ink); text-align: center; max-width: 600px; }

    .figure { margin: 48px 0; }
    .figure svg { width: 100%; height: auto; display: block; }
    .figure-caption { margin-top: 12px; font-family: var(--font-ui); font-size: 13px; line-height: 1.6; color: var(--ink-3); }
    .figure-caption strong { color: var(--ink-2); font-weight: 600; }

    .mechanistic-note { margin: 40px 0; padding-left: 20px; border-left: 2px solid var(--green); }
    .mechanistic-note-label { font-family: var(--font-ui); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--green); margin-bottom: 8px; }
    .mechanistic-note p { font-size: 15px; line-height: 1.75; color: var(--ink-3); margin: 0; }

    table { width: 100%; border-collapse: collapse; font-family: var(--font-ui); font-size: 13px; line-height: 1.6; margin: 32px 0; }
    thead th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-3); padding: 10px 14px; border-bottom: 2px solid var(--ink); }
    tbody td { padding: 10px 14px; border-bottom: 1px solid var(--rule-light); color: var(--ink-2); vertical-align: top; }
    tbody td strong { font-weight: 600; color: var(--ink); }
    tbody tr:last-child td { border-bottom: 1px solid var(--rule); }

    .ev-strong { color: var(--green); font-weight: 600; }
    .ev-moderate { color: var(--blue); font-weight: 600; }
    .ev-emerging { color: var(--orange); font-weight: 600; }
    .ev-preliminary { color: var(--ink-4); font-weight: 600; }

    .sources-section { margin-top: 80px; padding-top: 40px; border-top: 1px solid var(--rule); }
    .sources-section h2 { font-size: 1.2rem; margin-bottom: 20px; }
    .source-item { font-family: var(--font-ui); font-size: 12px; line-height: 1.6; color: var(--ink-3); margin-bottom: 8px; }
    .source-item a { color: var(--blue); text-decoration: none; }

    .partner-cta { margin: 64px 0 0; padding: 40px; background: var(--paper-warm); text-align: center; }
    .partner-cta h3 { font-family: var(--font-display); font-size: 1.5rem; font-weight: 400; color: var(--ink); margin: 0 0 12px; }
    .partner-cta p { font-family: var(--font-ui); font-size: 14px; color: var(--ink-3); max-width: 520px; margin: 0 auto 20px; line-height: 1.7; }
    .partner-cta a.cta-btn { display: inline-block; font-family: var(--font-ui); font-size: 13px; font-weight: 600; letter-spacing: 0.04em; padding: 10px 28px; background: var(--ink); color: var(--paper); text-decoration: none; }

    @media (max-width: 640px) {
      body { padding: 32px 16px 60px; }
      h1 { font-size: 2rem; }
      h2 { font-size: 1.6rem; }
      .deck { font-size: 1.1rem; }
      .bottom-line p { font-size: 16px; }
      .pull-quote { font-size: 1.2rem; padding: 24px 0; }
      table { font-size: 12px; }
      thead th, tbody td { padding: 8px 10px; }
    }
  </style>
</head>
<body>
  <article>
    <nav class="breadcrumb">
      <a href="/commons">NGM Commons</a> &rarr; {topic}
    </nav>

    <header>
      <span class="kicker">NGM Commons &middot; {type_label}</span>
      <h1>{title}</h1>
      <p class="deck">{deck}</p>
      <div class="byline">
        <span>Dr. Anant Vinjamoori</span>
        <span>&middot;</span>
        <span>{month} {year}</span>
        <span>&middot;</span>
        <span>{source_count} peer-reviewed sources</span>
      </div>
    </header>

    <aside class="bottom-line">
      <span class="bottom-line-label">The Bottom Line</span>
      <p>{bottom_line_text}</p>
    </aside>

    <section>
      <div class="section-marker">
        <span class="section-num">I</span>
        <h2>{section_title}</h2>
      </div>
      <p class="lede">{lede_paragraph}</p>
      <p>{body_text}</p>
      <p class="pull-quote">{pull_quote}</p>
    </section>

    <section class="sources-section">
      <h2>Sources</h2>
      <div class="source-item">[1] {reference}</div>
    </section>

    <div class="partner-cta">
      <h3>Learn More at NGM</h3>
      <p>Evidence-based longevity education for clinicians.</p>
      <a href="https://nextgenmed.io" class="cta-btn">Explore NGM</a>
    </div>
  </article>
</body>
</html>
```

---

## Newsletter HTML (Editorial Email)

Newsletters use table-based layout with inline styles for email client compatibility. Same editorial font families as lead magnets — Cormorant Garamond for display, DM Sans for UI — with Georgia as the serif fallback for email clients that strip web fonts.

### Email Container
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
  <style>
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; padding: 20px !important; }
      h1 { font-size: 26px !important; }
      h2 { font-size: 20px !important; }
      p, li { font-size: 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F5F3EE; font-family: 'DM Sans', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F5F3EE;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" class="email-container" cellspacing="0" cellpadding="0" style="background-color: #FEFDFB; width: 100%; max-width: 600px;">
          <tr>
            <td style="padding: 40px;">
              {content}
            </td>
          </tr>
        </table>
        <!-- Footer -->
        <table role="presentation" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 32px 40px; text-align: center;">
              <p style="margin: 0 0 8px 0; font-family: 'Cormorant Garamond', Georgia, serif; font-size: 14px; color: #1A1A1A;">Next Generation Medicine</p>
              <p style="margin: 0; font-family: 'DM Sans', Arial, sans-serif; font-size: 12px; color: #9A9A9A;">nextgenerationmedicine.co</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

### Email Typography (Inline Styles)

Uses the same editorial palette and font families as lead magnets. Georgia appears only as a fallback — never as primary.

**Kicker:**
```html
<p style="font-family: 'DM Sans', Arial, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #8B7355; margin: 0 0 16px 0;">NGM COMMONS</p>
```

**Title:**
```html
<h1 style="font-family: 'Cormorant Garamond', Georgia, serif; font-size: 32px; line-height: 1.15; font-weight: 400; color: #1A1A1A; margin: 0 0 12px 0; letter-spacing: -0.01em;">{title}</h1>
```

**Deck/Subtitle:**
```html
<p style="font-family: 'Cormorant Garamond', Georgia, serif; font-size: 18px; line-height: 1.6; font-style: italic; color: #6A6A6A; margin: 0 0 20px 0;">{deck}</p>
```

**Byline:**
```html
<p style="font-family: 'DM Sans', Arial, sans-serif; font-size: 13px; color: #9A9A9A; margin: 0 0 48px 0; padding-bottom: 48px; border-bottom: 1px solid #D4D0C8;">Dr. Anant Vinjamoori &middot; {month} {year}</p>
```

**Section Header:**
```html
<h2 style="font-family: 'Cormorant Garamond', Georgia, serif; font-size: 24px; line-height: 1.2; font-weight: 400; color: #1A1A1A; margin: 48px 0 16px 0;">{heading}</h2>
```

**Body Paragraph:**
```html
<p style="font-family: 'Source Serif 4', Georgia, serif; font-size: 17px; line-height: 1.8; color: #3A3A3A; margin: 0 0 20px 0;">{text}</p>
```

**Bottom Line (accent left border):**
```html
<table role="presentation" cellspacing="0" cellpadding="0" style="margin: 32px 0; width: 100%;">
  <tr>
    <td style="border-left: 2px solid #8B7355; padding-left: 20px;">
      <p style="font-family: 'DM Sans', Arial, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #8B7355; margin: 0 0 8px 0;">THE BOTTOM LINE</p>
      <p style="font-family: 'Source Serif 4', Georgia, serif; font-size: 17px; line-height: 1.75; color: #3A3A3A; margin: 0;">{bottom_line}</p>
    </td>
  </tr>
</table>
```

**Mechanistic Note (green accent):**
```html
<table role="presentation" cellspacing="0" cellpadding="0" style="margin: 32px 0; width: 100%;">
  <tr>
    <td style="border-left: 2px solid #4A7A5A; padding-left: 20px;">
      <p style="font-family: 'DM Sans', Arial, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #4A7A5A; margin: 0 0 8px 0;">MECHANISTIC NOTE</p>
      <p style="font-family: 'Source Serif 4', Georgia, serif; font-size: 15px; line-height: 1.75; color: #6A6A6A; margin: 0;">{note}</p>
    </td>
  </tr>
</table>
```

---

## Design Anti-Patterns (NEVER DO)

1. **No dark table headers** — Use typographic hierarchy (uppercase labels + 2px bottom border), not dark backgrounds
2. **No card grids** — Use vertical list with borders for evaluation criteria
3. **No Inter** — Always Cormorant Garamond + Source Serif 4 + DM Sans
4. **No pure white backgrounds** — Use warm paper (#FEFDFB)
5. **No cool gray borders** — Use warm-toned rules (#D4D0C8)
6. **No rounded corners on editorial elements** — Sharp edges for the editorial aesthetic
7. **No boxed callouts** — Use left-border accent strips (2px solid) instead
8. **No inline styles on lead magnets** — Use CSS `<style>` blocks with CSS variables
9. **No generic sans-serif body text** — Body text is always serif (Source Serif 4 / Georgia)

---

## SVG Diagram Color Palette

When creating inline SVG diagrams, use these colors:
```
Background: #FEFDFB (paper) or #F5F3EE (warm)
Primary shapes: #1A1A1A (ink)
Secondary shapes: #3A3A3A (ink-2)
Accent fills: #8B7355 (accent) — use sparingly
Green fills: #4A7A5A
Blue fills: #4A6A7A
Text on light: #3A3A3A
Text on dark: #FEFDFB
Connectors/lines: #D4D0C8 (rule)
Labels on SVG: font-family DM Sans, 11px uppercase
```
