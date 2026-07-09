# Sheetbase Spec

## Problem Statement

People need a way to create simple data-entry tools without building a custom application for each dataset. The desired interaction should feel like using a spreadsheet: create columns, type data into cells, and immediately have that data stored somewhere reliable.

The current gap is that spreadsheets are easy to use but weak as shared systems of record, while PostgreSQL is a strong system of record but requires technical setup before non-technical users can enter data. Sheetbase should bridge that gap: users create Sheet Forms in a browser Spreadsheet UI, the data lands in real PostgreSQL tables, and those tables become a fully featured API.

## Solution

Sheetbase provides a browser Spreadsheet UI where users create Sheet Forms by typing field names into the Header Row and then entering records into cells beneath it. Users may optionally import a Stencil config to create the Header Row fields for a new Sheet Form. Each Sheet Form creates one Generated Table in Managed Postgres. Generated Tables and Control Tables are exposed through a PostgREST-style API, so PostgreSQL remains the source of truth and the API surface.

A single Linux binary owns the operator experience. It serves the UI, manages PostgreSQL and PostgREST through Docker, initializes Control Tables, runs migrations, and exposes only tiny operational endpoints where PostgREST cannot do the job.

V1 keeps schema changes additive. Users can create Sheet Forms, add fields, hide or deprecate fields, and tighten field types only when existing values validate. Destructive migrations and arbitrary type rewrites are left for later.

## User Stories

1. As a user, I want to create a Sheet Form from a blank Spreadsheet UI, so that I can start collecting data without designing an app first.
2. As a user, I want to type field names into the Header Row, so that defining a form feels like creating a spreadsheet.
3. As a user, I want Sheetbase to create storage from my Header Row, so that I do not need to understand SQL tables.
4. As a user, I want to enter records into cells, so that data entry is fast and familiar.
5. As a user, I want edits in the Spreadsheet UI to save to PostgreSQL, so that the browser is not the source of truth.
6. As a user, I want each Sheet Form to have its own Generated Table, so that the API has a clear resource for each dataset.
7. As a user, I want generated columns to start permissive, so that early data entry is not blocked by type mistakes.
8. As a user, I want to tighten a field type later, so that a mature Sheet Form can become more structured.
9. As a user, I want Sheetbase to reject Type Tightening when existing values do not fit, so that data is not silently corrupted.
10. As a user, I want to add fields to an existing Sheet Form, so that forms can evolve as needs become clearer.
11. As a user, I want to hide fields I no longer use, so that the UI can stay tidy without deleting data.
12. As a user, I want existing fields with data protected from deletion in v1, so that accidental destructive changes do not lose records.
13. As a user, I want to rename a Sheet Form, so that the visible name can change without rebuilding storage.
14. As a user, I want column order and widths remembered, so that repeated data entry stays comfortable.
15. As a user, I want the UI to feel like a spreadsheet rather than a wizard, so that I can work quickly.
16. As a user, I want no Excel file or template requirement, so that I can use Sheetbase directly in the browser.
17. As a user, I want to import a Stencil config to create Header Row fields, so that existing Stencil schemas can bootstrap a Sheet Form.
18. As a user, I want Stencil Config Import to avoid importing workbook data, so that Sheetbase remains browser-first and database-first.
19. As an API consumer, I want a PostgREST-style endpoint for each Generated Table, so that I can query Sheet Form data programmatically.
20. As an API consumer, I want filtering, ordering, and pagination, so that Sheetbase APIs are useful for real integrations.
21. As an API consumer, I want predictable table-backed resource names, so that I can build stable integrations.
22. As an API consumer, I want metadata exposed through Control Tables, so that I can discover Sheet Forms and fields.
23. As an administrator, I want a single Linux binary, so that deployment does not require assembling multiple app services by hand.
24. As an administrator, I want the binary to manage PostgreSQL through Docker, so that setup is repeatable.
25. As an administrator, I want the binary to initialize PostgreSQL, so that a fresh server can become usable quickly.
26. As an administrator, I want the binary to start PostgreSQL and PostgREST, so that one command brings the system online.
27. As an administrator, I want the binary to stop PostgreSQL and PostgREST, so that shutdown is controlled.
28. As an administrator, I want the binary to restart managed processes, so that recovery is straightforward.
29. As an administrator, I want process status, so that I can see whether Sheetbase, PostgreSQL, and PostgREST are healthy.
30. As an administrator, I want logs kept under the app home directory, so that troubleshooting has one obvious place to start.
31. As an administrator, I want schema migrations for Control Tables, so that upgrades are repeatable.
32. As an administrator, I want local authentication, so that the UI and API are not open by default.
33. As a signed-in user, I want a session cookie for the UI, so that browser use feels normal.
34. As an API caller, I want JWT-based access to PostgREST, so that API permissions can flow through PostgreSQL.
35. As a product owner, I want PostgreSQL to be the API source of truth, so that Sheetbase does not grow a duplicate business API.
36. As a developer, I want schema-changing actions implemented as PostgreSQL functions, so that metadata writes and table creation happen transactionally.
37. As a developer, I want the app server to stay small, so that PostgREST and PostgreSQL carry the data surface.
38. As a user, I want Sheetbase to use an Attio-style palette and density, so that the product feels quiet, modern, and trustworthy during repeated data-entry work.
39. As a developer, I want the Stencil Editor used as technical reference, so that Sheetbase can borrow proven pieces without inheriting workbook extraction complexity.
40. As a developer, I want v1 limited to Linux, so that process supervision and packaging can be solved well before expanding platforms.
41. As a future maintainer, I want architectural decisions recorded, so that obvious alternatives such as a custom REST API or Excel workflow are not reintroduced accidentally.

## Implementation Decisions

- Use the working name Sheetbase.
- Keep the core workflow browser-first and database-first. Do not require Excel files, Excel templates, workbook uploads, or ExcelJS for v1.
- Support optional Stencil Config Import to create Header Row fields for a new Sheet Form.
- Treat Stencil Config Import as schema import only, not workbook data import or extraction.
- Build a Spreadsheet UI that feels familiar to Excel users.
- Use React, Vite, and Tailwind for the UI.
- Use an Attio-style visual direction: white workspace, cool gray structure, near-black ink, blue action/focus states, compact navigation, crisp tables, and soft colored metadata pills.
- Build a small editable spreadsheet grid first. Avoid adding a heavy grid dependency until the native implementation fails a concrete need.
- Define Sheet Forms from the Header Row.
- Create one Generated Table per Sheet Form.
- Store product metadata in Control Tables.
- Expose both Control Tables and Generated Tables through a PostgREST-style API.
- Prefer managed PostgREST as the data API sidecar.
- Avoid a separate large control API. Use PostgreSQL and PostgREST for product metadata operations wherever possible.
- Use PostgreSQL functions exposed through PostgREST RPC for schema-changing operations such as creating Sheet Forms, adding fields, hiding fields, and Type Tightening.
- Use PostgreSQL functions exposed through PostgREST RPC for Stencil Config Import when it creates Sheet Forms.
- Keep schema-changing operations transactional where possible.
- Generated Table columns start as `text`.
- Type Tightening is allowed only when all existing values can be converted safely.
- V1 supports additive Sheet Form changes only: rename forms, add fields, hide fields, and deprecate fields.
- V1 does not delete fields with data or arbitrarily change field types.
- Use Managed Postgres: a real PostgreSQL server started, stopped, monitored, and restarted by the application binary through Docker for v1.
- Support Linux only for v1.
- Use a Go binary for the server and process supervisor.
- Embed the built React UI in the Go binary.
- Manage a local app home directory containing PostgreSQL data, generated PostgREST config, and logs.
- Provide operational commands: `init`, `serve`, `start`, `stop`, `restart`, and `status`.
- Use pinned PostgreSQL and PostgREST Docker images for v1.
- Keep native/offline bundled installs out of v1.
- Include local auth in v1.
- Use email/password users, UI session cookies, JWTs for PostgREST, and PostgreSQL roles/claims for permissions.
- Keep OAuth and SAML out of v1.
- Treat Stencil as technical reference material and an optional schema input, not a core extraction dependency.
- Reuse small Stencil ideas such as address helpers only when they stay simpler than rewriting them.

## Testing Decisions

- Test external behavior, not implementation details.
- The highest-value test seam is the Sheet Form lifecycle through the public product boundary: create a Sheet Form from headers, verify the Generated Table exists, enter rows, query them through the PostgREST-style API, add a field, hide a field, and reject unsafe Type Tightening.
- Test PostgreSQL functions at the database boundary because they are the critical seam for metadata writes plus schema changes.
- Test process supervision at the command boundary: `init`, `start`, `status`, `stop`, and `restart` should leave Managed Postgres and PostgREST in the expected states.
- Test auth at the HTTP boundary: a user can sign in, receive a UI session, receive or use a PostgREST JWT, and access only permitted Sheet Forms.
- Test the Spreadsheet UI through user-visible behavior: headers create fields, cells save values, rows reload from PostgreSQL, and hidden fields no longer appear by default.
- Test Stencil Config Import at the Sheet Form creation boundary: importing a config creates the expected fields and Generated Table without importing workbook data.
- There is no existing code test prior art in this repo yet. The first implementation should create the smallest runnable checks around these boundaries rather than low-level unit suites.

## Out of Scope

- Excel files, Excel templates, workbook uploads, Excel import/export, and ExcelJS.
- Stencil workbook extraction and Pydantic model generation.
- Destructive migrations.
- Arbitrary existing-column type changes.
- Deleting fields with data.
- Replacing PostgREST with a custom full data API.
- Multi-OS support.
- OAuth and SAML.
- Offline bundled PostgreSQL/PostgREST installers.
- Browser-based advanced migration tooling.
- Rich relationship modeling between Sheet Forms.

## Further Notes

The current docs include ADRs for additive Sheet Form changes, Linux-only Managed Postgres, PostgREST-style APIs, PostgreSQL functions for schema changes, a Go binary with embedded UI, and the no-Excel core workflow.

The superseded custom REST API ADR should remain as historical context unless the ADR set is later cleaned up.
