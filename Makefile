.PHONY: api-test app-test build db-test dev-services linux managed-test release release-smoke serve test ui-build verify

SHEETBASE_DEV_HOME ?= .sheetbase
SHEETBASE_DEV_POSTGRES_PORT ?= 55532
SHEETBASE_DEV_POSTGREST_PORT ?= 3010

build: ui-build
	go build -o bin/sheetbase .

linux: ui-build
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bin/sheetbase-linux-amd64 .

test: ui-build
	cd ui && npm test
	go test ./...

verify: test db-test api-test app-test managed-test release-smoke

db-test:
	./scripts/test-postgres.sh

api-test:
	./scripts/test-postgrest.sh

app-test:
	./scripts/test-app-auth.sh

managed-test:
	./scripts/test-managed-docker.sh

release:
	./scripts/release-linux.sh

release-smoke:
	./scripts/test-release-smoke.sh

dev-services:
	go run . start --home "$(SHEETBASE_DEV_HOME)" --postgres-port "$(SHEETBASE_DEV_POSTGRES_PORT)" --postgrest-port "$(SHEETBASE_DEV_POSTGREST_PORT)"

serve: ui-build dev-services
	go run . serve --home "$(SHEETBASE_DEV_HOME)" --postgres-port "$(SHEETBASE_DEV_POSTGRES_PORT)" --postgrest-port "$(SHEETBASE_DEV_POSTGREST_PORT)"

ui-build:
	cd ui && npm run build
