# Own REST API before PostgREST

Status: superseded by discussion

V1 exposes Sheet Forms and Generated Tables through the application server's own REST API instead of managing PostgREST as a second sidecar process. The server already has to own the UI, authentication, Sheet Form creation, additive schema changes, and Managed Postgres supervision, so a small direct API is the shortest working path; PostgREST can be revisited if the API layer grows beyond simple table-oriented endpoints.
