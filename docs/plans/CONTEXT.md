# Sheetbase

Sheetbase turns spreadsheet-like data entry into stored PostgreSQL records that can be served through a PostgREST-style API.

## Language

**Spreadsheet UI**:
A browser-based, Excel-like data-entry surface where users type records into rows and cells.
_Avoid_: ExcelJS UI, workbook upload UI, Excel template

**Stencil Editor**:
The existing React/Vite/Tailwind spreadsheet-mapping app in `~/Developer/stencil/editor`; this project should reuse its UI style and spreadsheet-addressing ideas where useful.
_Avoid_: External spreadsheet grid

**Attio-style UI**:
A quiet, dense product interface with a white workspace, cool gray structure, blue action states, compact navigation, crisp tables, and soft colored metadata pills.
_Avoid_: Marketing SaaS gloss, Excel clone, heavy admin dashboard

**Stencil Config Import**:
An optional Sheet Form creation path that reads a Stencil schema and creates Header Row fields from it.
_Avoid_: Stencil workbook import, Stencil extraction

**Sheet Form**:
A user-created spreadsheet-like data-entry interface whose columns map to one generated PostgreSQL table.
_Avoid_: Sheet, form, grid, table definition

**Header Row**:
The first row of a Spreadsheet UI; users type column names there to define the Sheet Form's fields.
_Avoid_: Schema builder first

**Generated Table**:
A PostgreSQL table created from a Sheet Form schema and used as that Sheet Form's storage and API resource.
_Avoid_: JSON row store, generic table

**Type Tightening**:
Changing a Generated Table column from `text` to a stricter type only after all existing values can be converted safely.
_Avoid_: Destructive migration, guessed type migration

**Managed Postgres**:
A real PostgreSQL server installed, initialized, started, stopped, monitored, and restarted by the application binary.
_Avoid_: Embedded Postgres, user-managed database

**Control Tables**:
PostgreSQL tables that store product metadata such as Sheet Forms, fields, UI state, and permissions, exposed through the same PostgREST-style API as Generated Tables.
_Avoid_: Control API, app metadata API
