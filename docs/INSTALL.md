# Install Sheetbase

Sheetbase is a single binary that downloads and manages its own PostgreSQL and PostgREST runtime under `~/.sheetbase`.

## Prerequisites

- macOS 12 or newer, Debian/Ubuntu Linux, or a RHEL-compatible Linux distribution
- `tar` with xz support
- Linux package extraction tools: `dpkg-deb` on Debian/Ubuntu, or `rpm2cpio` and `cpio` on RHEL-compatible systems

## Build

```sh
make release
```

This writes the Linux amd64 binary and checksum:

- `bin/release/sheetbase-linux-amd64`
- `bin/release/sheetbase-linux-amd64.sha256`

For another supported target, use `make release-target`, for example:

```sh
make release-target GOOS=darwin GOARCH=arm64
```

Copy the binary to the server as `/usr/local/bin/sheetbase`.

Tagged GitHub releases run the full verification suite before publishing archives for Linux and macOS on both `amd64` and `arm64`. Create one by pushing a version tag, such as `v0.1.0`.

## First Run

```sh
sudo mkdir -p /var/lib/sheetbase
sudo chown "$USER" /var/lib/sheetbase

sheetbase runtime install --home /var/lib/sheetbase
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

`status` shows app health plus the managed PostgreSQL and PostgREST process versions, PIDs, and ports.

`start` also installs a missing runtime automatically. Downloads are pinned, verified against upstream checksums where published, and cached under `/var/lib/sheetbase/runtime/downloads`. Run `sheetbase runtime update --home /var/lib/sheetbase` to reinstall the pinned versions. Docker remains available as an explicit fallback with `--runtime docker`.

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

## Upgrade

```sh
sheetbase upgrade --home /var/lib/sheetbase
```

## Stop

```sh
sheetbase stop --home /var/lib/sheetbase
```

## See Also

- [CLI Reference](CLI.md) — every command, flag, and env var
- [Architecture](ARCHITECTURE.md) — system components, request flow, data model
- [API Reference](API.md) — auth endpoints, API keys, PostgREST query syntax
- [Usage Guide](USAGE.md) — creating Sheet Forms, entering data, using the API
