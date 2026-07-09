# Linux-only Managed Postgres

The first deployment target is Linux only, with the application binary responsible for installing, initializing, starting, stopping, monitoring, and restarting a real PostgreSQL server. We are not embedding Postgres into the binary; the binary owns the operator experience around a managed Postgres data directory and process.
