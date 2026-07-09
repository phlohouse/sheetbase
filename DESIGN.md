# Design

## Direction

Sheetbase should look and feel close to Attio's product UI: quiet, dense, modern, and highly structured. The reference is the feel of the workspace, navigation, toolbar, table, pills, and subtle state system, not Attio's brand identity.

Physical scene: a data operations lead is working in a bright office on a large monitor, moving quickly between a sidebar of forms, a table of records, and API-facing configuration. The UI needs to stay calm under repeated use.

Color strategy: restrained Attio-style product palette. Use white and near-neutral surfaces, cool gray borders, near-black ink, Attio-blue action/focus/link states, and soft blue/cyan/green/violet/amber/red pills for high-signal metadata.

## Palette

Use OKLCH tokens.

Palette source: derived from Attio's public CSS bundles shared during planning, converted to OKLCH and renamed for Sheetbase.

```css
:root {
  --bg: oklch(1 0 0);
  --app: oklch(0.975 0.001 197.1);
  --sidebar: oklch(0.975 0.001 197.1);
  --surface: oklch(1.000 0.000 89.9);
  --surface-raised: oklch(0.988 0.000 89.9);
  --surface-muted: oklch(0.961 0.002 247.8);
  --surface-selected: oklch(0.947 0.025 263.3);
  --line: oklch(0.952 0.003 264.5);
  --line-strong: oklch(0.928 0.004 271.4);
  --line-stronger: oklch(0.889 0.006 275.0);
  --ink: oklch(0.177 0.003 248.0);
  --muted: oklch(0.634 0.005 271.3);
  --subtle: oklch(0.718 0.005 258.3);
  --primary: oklch(0.570 0.210 261.4);
  --primary-hover: oklch(0.497 0.175 261.1);
  --primary-soft: oklch(0.947 0.025 263.3);
  --focus: oklch(0.570 0.210 261.4);
  --pill-blue: oklch(0.947 0.025 263.3);
  --pill-blue-strong: oklch(0.919 0.039 261.5);
  --pill-blue-ink: oklch(0.497 0.175 261.1);
  --pill-cyan: oklch(0.960 0.029 218.2);
  --pill-cyan-ink: oklch(0.634 0.116 222.7);
  --pill-green: oklch(0.967 0.035 162.4);
  --pill-green-strong: oklch(0.939 0.054 163.5);
  --pill-green-ink: oklch(0.521 0.116 161.2);
  --pill-violet: oklch(0.963 0.021 301.1);
  --pill-violet-ink: oklch(0.465 0.186 293.2);
  --pill-pink: oklch(0.959 0.021 351.9);
  --pill-pink-ink: oklch(0.625 0.260 323.5);
  --pill-amber: oklch(0.964 0.052 92.9);
  --pill-amber-strong: oklch(0.927 0.094 90.2);
  --pill-amber-ink: oklch(0.674 0.146 69.4);
  --danger: oklch(0.621 0.212 26.0);
  --danger-soft: oklch(0.956 0.022 17.5);
  --warning: oklch(0.674 0.146 69.4);
  --warning-soft: oklch(0.964 0.052 92.9);
  --success: oklch(0.659 0.152 158.6);
  --success-soft: oklch(0.967 0.035 162.4);
}
```

Primary filled controls use white text. Soft pills use their paired ink token on pale fills.

## Typography

Use one product sans stack:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Type scale:

- `12px`: metadata, compact labels, table secondary text
- `13px`: table cells, sidebar items, toolbar controls
- `14px`: default UI text
- `16px`: section titles and form labels
- `20px`: page titles

Keep weights mostly between 450 and 650. Avoid display typography in the app shell.

## Layout

The primary app shape is:

- left sidebar for workspace navigation and Sheet Forms
- top bar for current Sheet Form, sharing, account, and process status
- view toolbar for filters, sorting, field controls, import/export, and view settings
- main Spreadsheet UI table

Spacing should be compact:

- `4px` for tight icon/text gaps
- `8px` for control interiors and row gaps
- `12px` for toolbar groups
- `16px` for panel padding
- `24px` for major app regions

Avoid large marketing margins inside the authenticated product.

## Components

### App Shell

Use a light sidebar with subtle borders, not a saturated navigation rail. The sidebar should support workspace switcher, quick actions, primary navigation, favorites, and Sheet Forms.

### Toolbar

Toolbar controls should be compact rounded rectangles with 8px radius, 1px borders, and clear hover/focus states. Use icons plus text for important commands, icons alone for repeated utility actions with tooltips.

### Spreadsheet UI

The table is the hero component. It should use:

- sticky Header Row
- row selection checkboxes
- light grid lines
- 40px to 44px row height
- compact cells with inline editing
- visible focus ring for the active cell
- column type indicators in headers
- subtle selected row and selected cell states

Cells should feel editable without heavy input chrome. The active cell can show a stronger border and a small fill handle later, but v1 should prioritize clear keyboard editing.

### Pills And Tags

Use pill styling for field types, validation states, linked values, and API status. Pills should be small, readable, and content-sized. Avoid saturated inactive pills.

### Empty States

Empty states should teach the next action inline:

- blank Sheet Form: focus the first Header Row cell
- no records: keep the Header Row visible and provide the first editable row
- no Sheet Forms: show one compact creation action, not a marketing panel

### Modals

Avoid modals for routine table actions. Prefer inline panels, popovers, and side panels. Use modals only for destructive confirmation, authentication, or operations that require blocking focus.

## Motion

Use 150ms to 220ms transitions for hover, selection, popover, and side-panel changes. Motion should communicate state. Do not animate page load sequences.

Respect reduced motion by disabling transform motion and keeping opacity changes instant or near-instant.

## Attio Reference Translation

Borrow:

- quiet white workspace
- Attio-derived cool neutral palette
- crisp grid and toolbar structure
- compact sidebar
- rounded but restrained controls
- colored pills for high-signal metadata
- dense table-first layout
- subtle top-right collaboration/account area

Do not copy:

- Attio logos, exact iconography, product names, or CRM-specific interaction flows
- CRM-specific language such as companies, deals, or ARR unless used only as demo data
- decorative screenshot composition from marketing material

## Responsive Behavior

Desktop is the primary target for v1. Tablet should preserve the table with horizontal scrolling and collapsed sidebar. Mobile can be read/edit-light, but bulk spreadsheet editing is not a v1 optimization target.

## Quality Bar

Every interactive component needs default, hover, focus, active, disabled, loading, and error states. The Spreadsheet UI must be usable by keyboard. Text must not overflow controls at narrow widths.
