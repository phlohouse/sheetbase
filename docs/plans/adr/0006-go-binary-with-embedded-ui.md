# Go binary with embedded UI

Sheetbase should use a Go server binary that embeds the built React UI and supervises PostgreSQL and PostgREST as managed processes. Go is the shortest path to a portable Linux server binary with process management, static asset serving, and small operational commands without adding a separate runtime.
