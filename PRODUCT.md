# Product

## Register

product

## Users

Sheetbase is for people who need to create and maintain simple operational datasets without commissioning a custom app. They are spreadsheet-comfortable users, technical operators, and API consumers working inside a browser-based tool backed by PostgreSQL.

Users are usually in a task: defining a Sheet Form, entering rows, checking data, sharing an API endpoint, or operating a Linux server process. The interface should help them stay oriented in dense information without becoming decorative.

## Product Purpose

Sheetbase turns spreadsheet-like data entry into real PostgreSQL tables exposed through a PostgREST-style API. Success means a user can define fields in a Header Row, enter data in cells, and immediately have a trustworthy database-backed resource.

## Brand Personality

Quiet, precise, capable.

The product should feel like a serious operations tool: calm enough for repeated use, polished enough to trust with production data, and direct enough that users always understand where the data lives.

## Anti-references

Avoid marketing-page SaaS gloss: oversized heroes, decorative gradients, floating card piles, bubbly illustrations, and one-note purple or beige palettes.

Avoid spreadsheet cosplay that copies Excel chrome. Sheetbase should feel familiar to spreadsheet users, but it should look like a modern database product, not a web clone of desktop Excel.

Avoid overbuilt admin dashboards with heavy shadows, loud sidebars, large empty margins, and modal-first workflows.

Use Attio as the primary UI reference for palette, density, and feel: white workspace, cool gray structure, blue action states, and soft colored pills.

## Design Principles

1. **Database confidence**: every screen should make it clear that the data is structured, saved, and API-addressable.
2. **Spreadsheet speed**: data entry should feel direct, keyboard-friendly, and low-friction.
3. **Quiet density**: show a lot of information without visual shouting.
4. **Schema without ceremony**: Header Rows and field controls should expose structure without turning the experience into a wizard.
5. **Operations stay visible**: managed PostgreSQL and PostgREST should feel understandable to operators, not hidden behind magic.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Body text and placeholders must meet contrast requirements. Keyboard navigation is a core requirement for the Spreadsheet UI, not an enhancement. Motion should be brief, state-driven, and reduced under `prefers-reduced-motion`.
