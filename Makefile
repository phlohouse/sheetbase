.PHONY: api-test app-test build db-test linux test serve ui-build

build: ui-build
	go build -o bin/sheetbase .

linux: ui-build
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bin/sheetbase-linux-amd64 .

test: ui-build
	cd ui && npm test
	go test ./...

db-test:
	./scripts/test-postgres.sh

api-test:
	./scripts/test-postgrest.sh

app-test:
	./scripts/test-app-auth.sh

serve: ui-build
	go run . serve

ui-build:
	cd ui && npm run build
