# PostgREST-style API for data and metadata

V1 should expose both Generated Tables and Control Tables through a PostgREST-style API, preferably by managing PostgREST as a sidecar process alongside Managed Postgres. The product goal is that PostgreSQL becomes the API, so Sheet Form metadata should live in normal PostgreSQL tables rather than a custom control API; the app server should mostly serve the UI and supervise processes.
