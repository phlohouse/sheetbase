# Sheetbase Plan

Working name: **Sheetbase**.

Sheetbase is a Linux server application that lets users create spreadsheet-like forms in the browser. Each Sheet Form becomes a real PostgreSQL table, and PostgreSQL is exposed as the API through PostgREST-style endpoints.

## Product Shape

V1 has one primary workflow:

1. A user opens the browser UI.
2. They create a new Sheet Form by typing column names into the Header Row.
3. They type data into cells below the Header Row.
4. Sheetbase creates one Generated Table for that Sheet Form.
5. The UI stores rows in the Generated Table.
6. PostgREST exposes the Generated Table as a rich API resource.

There are no Excel files, Excel templates, workbook uploads, or ExcelJS dependency in the core workflow. The UI should feel familiar to Excel users, but the system is browser-first and database-first.

As an optional shortcut, a user can import a Stencil config to create a Sheet Form's Header Row fields. This imports schema shape only, not workbook data.

## Architecture

One deployable Linux binary owns the operator experience:

- serves the built React UI
- supervises PostgreSQL in Docker
- supervises PostgREST in Docker
- initializes and migrates Control Tables
- exposes tiny operational endpoints only when PostgREST cannot do the job

PostgreSQL owns product state:

- Control Tables store Sheet Forms, fields, UI metadata, users, roles, and permissions
- Generated Tables store user-entered form rows
- database functions perform privileged actions such as creating Generated Tables

PostgREST exposes PostgreSQL:

- Control Tables are API resources
- Generated Tables are API resources
- RPC endpoints call database functions for controlled schema changes

The app server should not grow a parallel business API unless PostgREST cannot safely express the operation.

## V1 Decisions

- Use React/Vite/Tailwind for the UI, following an Attio-style product palette and density.
- Build a small editable spreadsheet grid instead of adopting a heavy grid dependency first.
- Header Row defines fields.
- Stencil Config Import can create Header Row fields.
- Generated Table columns start as `text`.
- Type Tightening is allowed only after every existing value validates.
- Existing Sheet Forms support additive changes only.
- Generated Tables are real PostgreSQL tables, not JSON blobs.
- PostgREST is the main API surface.
- Linux is the only supported deployment target.

## Database Model

Control Tables:

- `sheet_forms`: id, slug, name, generated_table_name, timestamps
- `sheet_fields`: id, sheet_form_id, name, column_name, type, position, hidden, timestamps
- `sheet_views`: id, sheet_form_id, name, frozen_rows, frozen_columns, column_widths, sort/filter state
- `users`: id, email/name, auth fields
- `roles`: id, name
- `permissions`: role/user access to Sheet Forms

Generated Tables:

- one table per Sheet Form
- internal `id` primary key
- created/updated timestamps
- one column per visible or deprecated field
- columns start as `text`

Database functions:

- `create_sheet_form(name text, headers text[])`
- `create_sheet_form_from_stencil_config(name text, config jsonb)`
- `add_sheet_field(sheet_form_id uuid, name text)`
- `hide_sheet_field(sheet_form_id uuid, field_id uuid)`
- `tighten_sheet_field_type(sheet_form_id uuid, field_id uuid, target_type text)`

## Binary And Process Model

The binary manages an app home directory:

- `bin/postgres`
- `bin/postgrest`
- `data/postgres`
- `config/postgrest.conf`
- `logs/`

Commands:

- `sheetbase init`
- `sheetbase serve`
- `sheetbase start`
- `sheetbase stop`
- `sheetbase restart`
- `sheetbase status`

V1 uses Docker images for PostgreSQL and PostgREST. Native PostgreSQL/PostgREST installers can come later if needed.

## Auth

V1 should include local auth, but keep it boring:

- email/password users
- session cookie for the UI
- JWT issued for PostgREST
- database roles/claims used by PostgREST policies

Skip OAuth/SAML until someone needs it.

## Stencil Relationship

Stencil is useful as design and vocabulary reference and as an optional schema input, not as a core extraction dependency for v1.

Reuse:

- React/Vite/Tailwind setup
- address helpers if they stay small
- `.stencil.yaml` field definitions as an optional Sheet Form creation input

Skip:

- workbook upload
- extraction pipeline
- Pydantic model generation

Later, Sheetbase can export Sheet Form schemas into a Stencil-compatible format if that becomes useful.

## Milestones

See [ROADMAP.md](ROADMAP.md) for the phase-by-phase implementation plan.

1. Bootstrap Go server with embedded React build.
2. Add process supervisor for local PostgreSQL.
3. Create Control Tables and schema-management SQL functions.
4. Add PostgREST supervision/config generation.
5. Build Attio-style Spreadsheet UI: headers, rows, save, edit cells.
6. Add optional Stencil Config Import for Header Row creation.
7. Wire UI to PostgREST for Control Tables and Generated Tables.
8. Add local auth and PostgREST JWT claims.
9. Package `sheetbase` Linux binary.

## Skipped For V1

- browser-based destructive migrations
- arbitrary column type changes
- Excel import/export
- ExcelJS
- Stencil workbook extraction
- PostgREST replacement API
- multi-OS support
- OAuth/SAML
- native PostgreSQL/PostgREST installer
