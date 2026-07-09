# No Excel core workflow

Sheetbase should not use Excel files, Excel templates, workbook uploads, or ExcelJS in the core v1 workflow. The product should feel familiar to spreadsheet users through a browser Spreadsheet UI, but the source of truth is PostgreSQL tables created from user-entered Header Rows; optional Stencil Config Import may create those Header Row fields from schema, but it must not import workbook data.
