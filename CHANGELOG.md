# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-06-11

### Added
- MariaDB 10.6.23 support for Local on macOS Apple Silicon (arm64) and Linux (x86_64)
- Automatic binary download from GitHub Releases on first use
- Site provisioning using `mysqld --bootstrap` (bypasses `mysql_install_db` space-in-path limitation)
- Cross-platform `MariadbService` with darwin, darwin-arm64, and linux support
- GitHub Actions CI workflow for building and publishing platform binaries
- Ad-hoc signing of all binaries and bundled dylibs

### Known Limitations
- macOS Intel (x86_64) binary build pending
- Windows not supported (Local's built-in MariaDB handles Windows)
- No automated MySQL→MariaDB migration tooling
