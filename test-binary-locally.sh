#!/usr/bin/env bash
# Validates a built MariaDB tarball by dropping it into Local's service dir
# and confirming mysqld starts without dylib errors.
#
# Usage: ./test-binary-locally.sh <path-to-tarball> [version]
# Example: ./test-binary-locally.sh bin-darwin-arm64-10.6.23.tar.gz 10.6.23+0

set -e

TARBALL="${1:?Usage: $0 <tarball> [version]}"
VERSION="${2:-10.6.23+0}"
PLATFORM=$(uname -m | sed 's/x86_64/darwin/;s/arm64/darwin-arm64/')

LOCAL_SERVICES_DIR="$HOME/Library/Application Support/Local/lightning-services"
SERVICE_DIR="$LOCAL_SERVICES_DIR/mariadb-${VERSION}"
BIN_DIR="$SERVICE_DIR/bin/$PLATFORM"

echo "==> Installing to: $BIN_DIR"
mkdir -p "$BIN_DIR"
tar xzf "$TARBALL" -C "$BIN_DIR"

echo ""
echo "==> Checking dylib links on mysqld:"
otool -L "$BIN_DIR/bin/mysqld"

echo ""
echo "==> Smoke test — mysqld --version:"
"$BIN_DIR/bin/mysqld" --version

echo ""
echo "==> Smoke test — mysql_install_db --help (first line):"
"$BIN_DIR/bin/mysql_install_db" --help 2>&1 | head -3 || true

echo ""
echo "All checks passed. Restart Local and try creating a site with MariaDB."
echo "Service dir: $SERVICE_DIR"
