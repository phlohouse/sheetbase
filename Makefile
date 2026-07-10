.PHONY: api-test app-test build db-test linux managed-test release release-smoke serve test ui-build verify

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

serve: ui-build
	go run . serve

ui-build:
	cd ui && npm run build
