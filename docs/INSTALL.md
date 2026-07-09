# Install Sheetbase

Sheetbase v1 is a single Linux binary that manages PostgreSQL and PostgREST through Docker.

## Prerequisites

- Linux server
- Docker daemon running
- permission for the Sheetbase process to run Docker commands

On a development Mac, Colima is fine for running the same Docker-backed commands.

## Build

```sh
make release
```

This writes:

- `bin/release/sheetbase-linux-amd64`
- `bin/release/sheetbase-linux-amd64.sha256`

Copy the binary to the server as `/usr/local/bin/sheetbase`.

## First Run

```sh
sudo mkdir -p /var/lib/sheetbase
sudo chown "$USER" /var/lib/sheetbase

sheetbase doctor --home /var/lib/sheetbase
sheetbase init --home /var/lib/sheetbase
sheetbase start --home /var/lib/sheetbase
sheetbase serve --home /var/lib/sheetbase -addr :8080
```

Open `http://SERVER:8080`, create the first admin user, then create a Sheet Form.

## Inspect

```sh
sheetbase status --home /var/lib/sheetbase
```

`status` shows the app health plus the managed Postgres/PostgREST Docker containers, images, IDs, and published ports.

## systemd

Generate a unit:

```sh
sheetbase systemd --home /var/lib/sheetbase --bin /usr/local/bin/sheetbase > sheetbase.service
```

Install it:

```sh
sudo cp sheetbase.service /etc/systemd/system/sheetbase.service
sudo systemctl daemon-reload
sudo systemctl enable --now sheetbase
```

## Backup And Restore

```sh
sheetbase backup --home /var/lib/sheetbase
sheetbase export --home /var/lib/sheetbase
sheetbase restore --home /var/lib/sheetbase --in /var/lib/sheetbase/backups/sheetbase-YYYYMMDDTHHMMSSZ.dump
```

## Stop

```sh
sheetbase stop --home /var/lib/sheetbase
```
