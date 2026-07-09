# Postgres functions for schema changes

Sheetbase should perform schema-changing operations through PostgreSQL functions exposed as PostgREST RPC endpoints, not through a custom control API. Creating a Sheet Form requires metadata writes and `CREATE TABLE` to succeed together, so the safest small design is to keep the operation inside one database transaction.
