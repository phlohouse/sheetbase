# Sheetbase Roadmap

This roadmap turns the Sheetbase spec into implementation slices. Each phase should leave the repo in a runnable state with one useful check.

## Phase 0: Project Skeleton

Goal: create the smallest runnable Sheetbase project.

Build:

- Go module with `sheetbase` CLI entrypoint
- React/Vite/Tailwind app under a UI package
- Go server that serves the built UI
- embedded UI build in the Go binary
- `sheetbase serve` command for local development
- basic README commands

Acceptance:

- `sheetbase serve` serves the UI
- UI build can be embedded into the Go binary
- one smoke test or script verifies the server returns the app shell

Skipped:

- PostgreSQL
- PostgREST
- auth
- real grid persistence

## Phase 1: Attio-style App Shell

Goal: make the product visible and aligned with `DESIGN.md`.

Build:

- app shell with sidebar, top bar, view toolbar, and main table region
- Attio-derived OKLCH design tokens
- compact navigation for Sheet Forms
- static sample Spreadsheet UI using fake data
- loading and empty states for the shell
- keyboard focus styles for controls

Acceptance:

- desktop screenshot matches the intended Attio-like density and palette
- sidebar, toolbar, and table remain usable at tablet width
- visible text meets contrast expectations
- one Playwright visual smoke test covers the shell

Skipped:

- cell editing persistence
- process management
- API calls

## Phase 2: Editable Spreadsheet UI

Goal: users can define fields and enter rows locally.

Build:

- editable Header Row
- editable body cells
- row creation
- column creation from Header Row edits
- active cell state
- keyboard navigation for arrow keys, Enter, Tab, Escape
- row selection checkboxes
- column type pills defaulting to `text`
- local in-memory Sheet Form model

Acceptance:

- user can create headers, add rows, edit cells, and navigate by keyboard
- hidden implementation details are not tested directly
- one UI test covers the local Sheet Form lifecycle

Skipped:

- database persistence
- Type Tightening
- Stencil Config Import

## Phase 3: Control Schema And Database Functions

Goal: PostgreSQL can create and manage Sheet Forms transactionally.

Build:

- SQL migrations for Control Tables
- `create_sheet_form(name text, headers text[])`
- `add_sheet_field(sheet_form_id uuid, name text)`
- `hide_sheet_field(sheet_form_id uuid, field_id uuid)`
- `tighten_sheet_field_type(sheet_form_id uuid, field_id uuid, target_type text)`
- generated table naming and identifier sanitization
- `text` columns by default
- additive-only enforcement

Acceptance:

- creating a Sheet Form writes metadata and creates one Generated Table in one transaction
- unsafe identifiers are rejected or normalized predictably
- Type Tightening succeeds only when existing values convert
- database-level tests cover create, add field, hide field, and reject unsafe tightening

Skipped:

- app-managed Postgres install
- PostgREST integration
- auth policies

## Phase 4: PostgREST Data Surface

Goal: PostgreSQL becomes the API surface.

Build:

- PostgREST config generation
- expose Control Tables
- expose Generated Tables
- expose schema functions as RPC endpoints
- API discovery path for Sheet Forms and fields
- minimal API client in the UI

Acceptance:

- API can create a Sheet Form through RPC
- API can insert, list, filter, order, and paginate Generated Table rows
- UI can load Sheet Forms and rows through PostgREST
- one end-to-end test creates a form, writes rows, and queries rows through PostgREST

Skipped:

- PostgREST process supervision
- JWT auth
- permissions

## Phase 5: Managed Postgres And PostgREST

Goal: the binary owns the local database/API processes.

Build:

- app home directory layout
- `sheetbase init`
- managed PostgreSQL Docker container
- managed PostgREST Docker container
- PostgREST config/env generation
- `start`, `stop`, `restart`, `status`
- logs under app home
- basic process health checks

Acceptance:

- fresh Linux machine with Docker can run `sheetbase init && sheetbase start`
- `status` reports app, PostgreSQL, and PostgREST state
- `restart` recovers both managed processes
- one command-boundary test covers init/start/status/stop with temp app home

Skipped:

- native PostgreSQL/PostgREST installers
- systemd integration
- multi-OS support

## Phase 6: Persisted Spreadsheet UI

Goal: connect the Spreadsheet UI to real Sheet Forms and Generated Tables.

Build:

- create Sheet Form from Header Row through RPC
- save edited rows through PostgREST
- load rows from Generated Tables
- add fields through RPC
- hide fields from the UI while preserving data
- column width/order persistence through Control Tables
- optimistic editing with visible save/error states

Acceptance:

- user can create a Sheet Form from headers, save rows, reload, and see persisted data
- adding a field updates metadata and the Generated Table
- hiding a field removes it from the default view without dropping the column
- one browser test covers the persisted Sheet Form lifecycle

Skipped:

- auth
- Stencil Config Import
- advanced filtering UI

## Phase 7: Local Auth And Permissions

Goal: the UI and API are not open by default.

Build:

- local email/password users
- password hashing
- session cookie for UI
- JWT issuance for PostgREST
- PostgreSQL roles/claims
- permissions table enforcement
- first-run admin user creation
- sign in/sign out screens

Acceptance:

- unauthenticated users cannot access protected UI or API data
- signed-in users can access permitted Sheet Forms
- PostgREST receives usable JWT claims
- one HTTP-level test covers sign in, API access, and denied access

Skipped:

- OAuth
- SAML
- SCIM

## Phase 8: Stencil Config Import

Goal: existing Stencil schemas can create Sheet Form headers.

Build:

- `.stencil.yaml` parser or JSON-compatible config ingestion
- field extraction from Stencil versions
- mapping Stencil field names to Header Row fields
- create Sheet Form from imported config
- import preview UI
- clear rejection for unsupported Stencil field shapes

Acceptance:

- importing a simple Stencil config creates expected Sheet Form fields
- import creates no workbook data
- unsupported computed/table/range shapes fail with useful messages
- one test imports a fixture config and verifies fields plus Generated Table columns

Skipped:

- workbook upload
- Stencil extraction
- Pydantic model generation

## Phase 9: Operator Polish

Goal: make v1 deployable and diagnosable.

Build:

- structured logs
- clearer `status` output
- backup/export command for app home metadata and Postgres dump
- config file for ports, app home, and download URLs
- systemd unit template generation
- upgrade/migration command
- release build script for Linux

Acceptance:

- operator can install, start, inspect, back up, stop, and upgrade Sheetbase from documented commands
- release artifact contains one app binary and documented managed dependencies flow
- smoke test runs against release build

Skipped:

- hosted update service
- multi-node deployment
- managed cloud Postgres

## Phase 10: V1 Hardening

Goal: close gaps before calling v1 usable.

Build:

- accessibility pass for keyboard and contrast
- responsive pass for desktop/tablet
- error states for failed saves, failed RPC, and process-down states
- empty states for no forms and blank forms
- API documentation page generated from Control Tables and PostgREST
- performance pass for large tables

Acceptance:

- core workflow passes browser test: sign in, create Sheet Form, enter rows, query API
- process workflow passes command test: init, start, status, restart, stop
- no known P0/P1 accessibility failures
- docs explain install, first run, creating a Sheet Form, and using the API

Skipped:

- destructive migrations
- arbitrary type rewrites
- Excel import/export
- multi-OS packaging

## Dependency Order

1. Phase 0 must come first.
2. Phases 1 and 2 can happen before backend work.
3. Phase 3 must precede real PostgREST usage.
4. Phase 4 must precede persisted UI wiring.
5. Phase 5 can run in parallel with Phase 4 after database assumptions settle.
6. Phase 6 depends on Phases 3 and 4.
7. Phase 7 depends on Phase 4.
8. Phase 8 depends on Phase 3.
9. Phase 9 depends on Phase 5.
10. Phase 10 depends on all v1 features.

## First Implementation Tickets

1. Scaffold Go CLI and React/Vite/Tailwind app.
2. Serve embedded UI from `sheetbase serve`.
3. Add Attio-derived tokens and app shell.
4. Build static Spreadsheet UI with sample data.
5. Add local editing and keyboard navigation.
6. Add Control Table migration files.
7. Add `create_sheet_form` database function and tests.
8. Add local PostgREST config for development.
9. Wire UI to create and load Sheet Forms through PostgREST.
10. Add Managed Postgres/PostgREST commands.

## Key Risks

- **PostgREST dynamic schema reload**: Generated Tables must become visible without fragile restarts. Start with explicit schema reload or managed restart after schema changes.
- **Identifier safety**: user headers must never become raw SQL identifiers without validation.
- **Grid complexity**: keyboard navigation and selection can expand quickly. Keep v1 to cells, rows, headers, and simple selection.
- **Process management**: Managed Postgres is operationally sensitive. Keep app home explicit and commands boring.
- **Auth with PostgREST**: JWT claims and row-level policies can get complex. Start with simple roles and Sheet Form permissions.
