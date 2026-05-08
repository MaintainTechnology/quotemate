# Personal Action Blueprint - Complete Style Guide

This is the complete reference for the Personal Action Blueprint design system. Use this when implementing pages, components, and styling.

---

## Typography

### Font Families

| Usage | Font Stack |
|-------|------------|
| Serif (Headlines/Titles) | "Cormorant Garamond", "Noto Serif JP", serif |
| Body (Paragraphs/Content) | "Source Serif 4", "Noto Serif JP", serif |
| Sans-serif (UI/Labels) | "DM Sans", system-ui, -apple-system, sans-serif |
| Monospace (Time displays) | ui-monospace, monospace |

### Font Import

```html
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&family=DM+Sans:wght@400;500;600&family=Noto+Serif+JP:wght@500&display=swap" rel="stylesheet">
```

### Type Scale

| Level | Size | Line Height | Usage |
|-------|------|-------------|-------|
| Hero (h1) | clamp(40px, 5vw, 56px) | 1.05 | Page titles, hero sections |
| XXL (h2) | clamp(32px, 4vw, 42px) | 1.2 | Section headers |
| XL (h3) | clamp(24px, 3vw, 32px) | 1.2 | Subsection headers |
| Large (h4) | clamp(18px, 2.5vw, 24px) | 1.3 | Card titles, smaller headers |
| Medium | 17px | 1.5 | Emphasis text |
| Small | 15px | 1.6 | Default body text |
| Extra Small | 13px | 1.5 | Captions, meta info |

---

## Color Palette

```css
:root {
  /* Backgrounds */
  --paper: #FEFDFB;        /* Primary background */
  --paper-alt: #F5F2EC;    /* Secondary background */

  /* Text */
  --ink-900: #302C27;      /* Primary text */
  --ink-700: #4A4540;      /* Strong emphasis */
  --ink-500: #706C66;      /* Secondary text */
  --ink-400: #9C9890;      /* Tertiary text */

  /* Structural */
  --line: #E3DFD7;         /* Borders/dividers */

  /* Accents */
  --gold: #C49A6C;         /* Accent/highlights */
  --vermillion: #C07050;   /* Hover states/CTA */
}
```

### Color Usage Guidelines

| Color | Use For | Avoid |
|-------|---------|-------|
| `--paper` | Primary backgrounds | N/A |
| `--paper-alt` | Section backgrounds, cards | Small elements |
| `--ink-900` | Headings, primary text, buttons | Large background areas |
| `--ink-700` | Body text, strong emphasis | N/A |
| `--ink-500` | Secondary text, descriptions | Primary content |
| `--ink-400` | Tertiary text, meta info | Important information |
| `--line` | Borders, dividers | Text |
| `--gold` | Accents, active states, highlights | Large areas |
| `--vermillion` | Hover states, CTAs | Default states |

---

## Spacing System

```css
:root {
  --space-1: 8px;
  --space-2: 12px;
  --space-3: 20px;
  --space-4: 32px;
  --space-5: 48px;
  --space-6: 72px;
  --space-7: 96px;
}
```

| Variable | Value | Use For |
|----------|-------|---------|
| `--space-1` | 8px | Tight spacing, inline elements |
| `--space-2` | 12px | Related elements, small gaps |
| `--space-3` | 20px | Standard paragraph/element spacing |
| `--space-4` | 32px | Card padding, section breaks |
| `--space-5` | 48px | Major subsections |
| `--space-6` | 72px | Between major sections |
| `--space-7` | 96px | Hero sections, large gaps |

---

## Layout Principles

### Container

```css
.container {
  max-width: 900px;
  margin: 0 auto;
  padding: clamp(20px, 5vw, 48px);
}
```

### Section Spacing

| Context | Spacing |
|---------|---------|
| Between major sections | 72px (`--space-6`) |
| Between subsections | 48px (`--space-5`) |
| Element spacing | 20px (`--space-3`) |

---

## Base Reset

Always include this reset at the start of your styles:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Source Serif 4', 'Noto Serif JP', serif;
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink-700);
  background-color: var(--paper);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 {
  font-family: 'Cormorant Garamond', 'Noto Serif JP', serif;
  color: var(--ink-900);
  font-weight: 500;
}

h1 {
  font-size: clamp(40px, 5vw, 56px);
  line-height: 1.05;
}

h2 {
  font-size: clamp(32px, 4vw, 42px);
  line-height: 1.2;
}

h3 {
  font-size: clamp(24px, 3vw, 32px);
  line-height: 1.2;
}

h4 {
  font-size: clamp(18px, 2.5vw, 24px);
  line-height: 1.3;
}
```

---

## Component Patterns

### Header

```html
<header class="header">
  <div class="header-inner">
    <div class="wordmark">Wordmark Text</div>
    <div class="header-actions">
      <div class="language-toggle">
        <button class="lang-btn active">EN</button>
        <button class="lang-btn">JP</button>
      </div>
      <a href="#" class="back-link">Back</a>
    </div>
  </div>
</header>
```

```css
.header {
  background: var(--paper-alt);
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--line);
}

.header-inner {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 clamp(20px, 5vw, 48px);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.wordmark {
  font-family: 'Cormorant Garamond', serif;
  font-size: 18px;
  font-weight: 500;
  color: var(--ink-900);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.back-link {
  font-size: 14px;
  color: var(--ink-500);
  text-decoration: none;
  transition: color 0.2s;
}

.back-link:hover {
  color: var(--ink-900);
}
```

### Language Toggle

```html
<div class="language-toggle">
  <button class="lang-btn active">EN</button>
  <button class="lang-btn">JP</button>
</div>
```

```css
.language-toggle {
  display: flex;
  gap: 4px;
}

.lang-btn {
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--ink-500);
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.2s;
}

.lang-btn:hover {
  color: var(--ink-900);
}

.lang-btn.active {
  background: var(--gold);
  color: white;
}
```

### Profile Card

```html
<div class="profile-card">
  <div class="profile-header">
    <h2 class="profile-name">Name Here</h2>
    <span class="profile-badge">VIP MEMBER</span>
  </div>
  <div class="profile-divider"></div>
  <div class="profile-details">
    <div class="detail-item">
      <span class="detail-label">Title</span>
      <span class="detail-value">Value</span>
    </div>
  </div>
</div>
```

```css
.profile-card {
  background: var(--paper-alt);
  padding: var(--space-4);
  border-radius: 4px;
}

.profile-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.profile-name {
  font-family: 'Cormorant Garamond', serif;
  font-size: clamp(24px, 3vw, 32px);
  font-weight: 500;
  color: var(--ink-900);
}

.profile-badge {
  display: inline-block;
  background: var(--gold);
  color: white;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 6px 12px;
}

.profile-divider {
  height: 1px;
  background: var(--line);
  margin: var(--space-3) 0;
}

.profile-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.detail-item {
  display: flex;
  justify-content: space-between;
}

.detail-label {
  color: var(--ink-500);
  font-size: 14px;
}

.detail-value {
  color: var(--ink-900);
  font-weight: 500;
  font-size: 14px;
}
```

### Section Numbers

```html
<div class="section-header">
  <span class="section-number">1</span>
  <div>
    <h2 class="section-title">Section Title</h2>
    <p class="section-subtitle">Optional subtitle here</p>
  </div>
</div>
```

```css
.section-header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.section-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--ink-900);
  color: white;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
}

.section-title {
  font-family: 'Cormorant Garamond', serif;
  font-size: clamp(24px, 3vw, 32px);
  line-height: 1.2;
  color: var(--ink-900);
}

.section-subtitle {
  font-style: italic;
  color: var(--ink-500);
  font-size: 15px;
  margin-top: 4px;
}
```

### Session Items

```html
<div class="session-item">
  <div class="session-time">09:00</div>
  <div class="session-content">
    <h4 class="session-title">Session Title</h4>
    <p class="session-description">Session description goes here.</p>
    <span class="session-category">CATEGORY</span>
  </div>
</div>
```

```css
.session-item {
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--line);
}

.session-time {
  font-family: ui-monospace, monospace;
  font-size: 15px;
  color: var(--ink-500);
  font-variant-numeric: tabular-nums;
}

.session-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.session-title {
  font-family: 'Cormorant Garamond', serif;
  font-size: 18px;
  font-weight: 500;
  color: var(--ink-900);
}

.session-description {
  font-size: 14px;
  color: var(--ink-500);
  line-height: 1.5;
}

.session-category {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--gold);
}
```

### Vendor Cards

```html
<div class="vendor-card">
  <h4 class="vendor-name">Vendor Name</h4>
  <p class="vendor-description">Vendor description here.</p>
  <a href="#" class="vendor-link">Learn More</a>
</div>
```

```css
.vendor-card {
  border: 1px solid var(--line);
  padding: var(--space-3);
  transition: all 0.3s;
  cursor: pointer;
}

.vendor-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.08);
}

.vendor-name {
  font-family: 'Cormorant Garamond', serif;
  font-size: 18px;
  font-weight: 500;
  color: var(--ink-900);
  margin-bottom: var(--space-1);
}

.vendor-description {
  font-size: 14px;
  color: var(--ink-500);
  line-height: 1.5;
  margin-bottom: var(--space-2);
}

.vendor-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-900);
  text-decoration: none;
  transition: color 0.2s;
}

.vendor-link:hover {
  color: var(--vermillion);
}
```

### CTA Button

```html
<a href="#" class="cta-button">
  <span>Get Started</span>
  <span class="cta-arrow">→</span>
</a>
```

```css
.cta-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 28px;
  background: var(--ink-900);
  color: white;
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
  transition: all 0.3s;
}

.cta-button:hover {
  background: var(--vermillion);
  transform: translateY(-2px);
}

.cta-arrow {
  transition: transform 0.3s;
}

.cta-button:hover .cta-arrow {
  transform: translateX(4px);
}
```

### Highlight Box

```html
<div class="highlight-box">
  <span class="highlight-label">INTELLIGENCE</span>
  <p class="highlight-text">Important insight or highlight text here.</p>
</div>
```

```css
.highlight-box {
  background: var(--paper-alt);
  padding: var(--space-4);
  border-left: 4px solid var(--gold);
}

.highlight-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--gold);
  margin-bottom: var(--space-1);
  display: block;
}

.highlight-text {
  font-size: 15px;
  color: var(--ink-700);
  line-height: 1.6;
}

/* Intelligence highlights within text */
.intelligence-highlight {
  color: var(--gold);
  font-weight: 600;
}
```

---

## Special Elements

### Profile Badge

```css
.profile-badge {
  display: inline-block;
  background: var(--gold);
  color: white;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 6px 12px;
}
```

### Category Headers

```css
.category-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--gold);
}
```

### Intelligence Highlights

```css
.intelligence {
  color: var(--gold);
  font-weight: 600;
}
```

### Monospace Time Display

```css
.time {
  font-family: ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  color: var(--ink-500);
}
```

---

## Design Characteristics Summary

| Characteristic | Implementation |
|----------------|----------------|
| Editorial Typography | Cormorant Garamond serif for headlines, Source Serif 4 for body, DM Sans for UI/labels |
| Warm Linen Backgrounds | Warm paper #FEFDFB primary, #F5F2EC for sections |
| Minimal Borders | Thin #E3DFD7 lines for separation |
| Gold Accents | #C49A6C for highlights and active states |
| Monospace Times | Tabular time displays in monospace |
| Hover Elevations | Cards lift with shadow on hover |
| Responsive Typography | Using clamp() for fluid type scales |

---

## Complete HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Personal Action Blueprint</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&family=DM+Sans:wght@400;500;600&family=Noto+Serif+JP:wght@500&display=swap" rel="stylesheet">
  <style>
    :root {
      /* Backgrounds */
      --paper: #FEFDFB;
      --paper-alt: #F5F2EC;

      /* Text */
      --ink-900: #302C27;
      --ink-700: #4A4540;
      --ink-500: #706C66;
      --ink-400: #9C9890;

      /* Structural */
      --line: #E3DFD7;

      /* Accents */
      --gold: #C49A6C;
      --vermillion: #C07050;

      /* Spacing */
      --space-1: 8px;
      --space-2: 12px;
      --space-3: 20px;
      --space-4: 32px;
      --space-5: 48px;
      --space-6: 72px;
      --space-7: 96px;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Source Serif 4', 'Noto Serif JP', serif;
      font-size: 15px;
      line-height: 1.6;
      color: var(--ink-700);
      background-color: var(--paper);
      -webkit-font-smoothing: antialiased;
    }

    h1, h2, h3, h4 {
      font-family: 'Cormorant Garamond', 'Noto Serif JP', serif;
      color: var(--ink-900);
      font-weight: 500;
    }

    h1 {
      font-size: clamp(40px, 5vw, 56px);
      line-height: 1.05;
    }

    h2 {
      font-size: clamp(32px, 4vw, 42px);
      line-height: 1.2;
    }

    h3 {
      font-size: clamp(24px, 3vw, 32px);
      line-height: 1.2;
    }

    h4 {
      font-size: clamp(18px, 2.5vw, 24px);
      line-height: 1.3;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: clamp(20px, 5vw, 48px);
    }

    /* Add component styles here */
  </style>
</head>
<body>
  <!-- Header -->
  <header class="header">
    <div class="header-inner">
      <div class="wordmark">Personal Action Blueprint</div>
      <div class="header-actions">
        <div class="language-toggle">
          <button class="lang-btn active">EN</button>
          <button class="lang-btn">JP</button>
        </div>
        <a href="#" class="back-link">Back</a>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="container">
    <!-- Add sections and content here -->
  </main>
</body>
</html>
```

---

## Responsive Breakpoints

While the system primarily uses fluid typography with `clamp()`, here are suggested breakpoints for layout adjustments:

```css
/* Mobile */
@media (max-width: 640px) {
  .session-item {
    grid-template-columns: 50px 1fr;
    gap: var(--space-2);
  }

  .profile-header {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* Tablet */
@media (max-width: 900px) {
  .header-inner {
    padding: 0 var(--space-3);
  }
}
```
