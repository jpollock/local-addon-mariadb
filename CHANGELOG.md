# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-06-11

### Added
- MariaDB 10.11.11 (LTS) as a second selectable database version
- `SUPPORTED_VERSIONS` constant — add new versions by editing one array
- Multi-version architecture: addon creates complete service directories for non-bundled versions
- Version-specific `constants.js` and `main.js` generated for each non-bundled service directory
- Binary subdirectories pre-created at startup so versions appear in dropdown before download completes

### Changed
- `downloadBinaries()` now accepts an explicit `version` parameter (defaults to 10.6.23 for backward compat)
- `main()` loops over `SUPPORTED_VERSIONS` at startup instead of handling a single version

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
