.PHONY: all build dist test test-race lint fmt vet check clean

BINARY_NAME=go-sd
BUILD_DIR=bin
DIST_DIR=dist
VERSION?=$(shell git describe --tags --always --dirty 2>/dev/null || echo 0.1.0-dev)
LDFLAGS=-s -w -X main.version=$(VERSION)

all: check build

build:
	@mkdir -p $(BUILD_DIR)
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd

dist:
	@rm -rf $(DIST_DIR) && mkdir -p $(DIST_DIR)
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)_$(VERSION)_linux_amd64 ./cmd
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)_$(VERSION)_linux_arm64 ./cmd
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags="$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)_$(VERSION)_darwin_amd64 ./cmd
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)_$(VERSION)_darwin_arm64 ./cmd
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)_$(VERSION)_windows_amd64.exe ./cmd
	cd $(DIST_DIR) && sha256sum * > checksums.txt

fmt:
	go fmt ./...

vet:
	go vet ./...

test:
	CGO_ENABLED=0 go test -v ./...

test-race:
	go test -race ./...

lint:
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run ./...; \
	else \
		echo "golangci-lint not installed, skipping (go vet passed)"; \
	fi

check: fmt vet test lint

clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)
