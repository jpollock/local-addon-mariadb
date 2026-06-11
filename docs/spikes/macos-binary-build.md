# Spike: MariaDB macOS Binary Build

**Question:** Can we produce a self-contained MariaDB binary for macOS that Local can launch?

## Background

MariaDB has no official macOS binary download. Local bundles MySQL for macOS via
`cdn.localwp.com/site-services-lightning`, but the MariaDB entry in
`tasks/download-lightning-services.ts` only targets `BinPlatform.Win32`.

The `mariadb-10.6.23+0` lightning service (wrapper + config) already exists in
`extraResources/` — it just has no `bin/darwin` or `bin/darwin-arm64` directory.

## Approach

Build MariaDB from source on GitHub Actions macOS runners, bundle non-system dylibs
using `install_name_tool`, and produce a tarball matching Local's expected layout:

```
bin/
  mysqld
  mysql
  mysqladmin
  mysqldump
  mysqlcheck
  mysql_install_db
lib/
  libssl.X.dylib        (if not statically linked)
  libcrypto.X.dylib     (if not statically linked)
```

Key CMake flags:
- `WITH_SSL=bundled` — builds OpenSSL statically into MariaDB, eliminating the main external dylib dependency
- `WITH_ZLIB=bundled` — same for zlib
- Storage engines disabled: RocksDB, TokuDB, Mroonga, Spider, Connect, OQGraph (reduces build time and binary size)

## Files

- `build-mariadb-macos.yml` — GitHub Actions workflow (manual trigger via `workflow_dispatch`)
- `test-binary-locally.sh` — validates a built tarball against a local Local install

## Running the Spike

### Step 1: Trigger the build

Push the workflow file to a branch and trigger it manually from the GitHub Actions UI:

```
Actions → Build MariaDB for macOS → Run workflow → version: 10.6.23
```

Both `darwin` (Intel) and `darwin-arm64` (Apple Silicon) build in parallel.
Expect ~20-30 minutes build time.

### Step 2: Download the artifact

Download the `.tar.gz` artifact from the completed workflow run.

### Step 3: Test locally

```bash
chmod +x test-binary-locally.sh
./test-binary-locally.sh bin-darwin-arm64-10.6.23.tar.gz
```

Restart Local and try creating a new site — MariaDB should appear as a database option.

## Success Criteria

- [ ] `mysqld --version` runs without dylib errors on both arm64 and x86_64
- [ ] `otool -L mysqld` shows only `@loader_path` and system (`/usr/lib`, `/System`) references
- [ ] Local can provision and start a site using the MariaDB service
- [ ] Site database is accessible (wp-admin loads, `mysql -u root -proot local` works)

## Known Risks

- **Build time** — MariaDB is large; first build may hit GitHub Actions time limits. Mitigated by disabling unused storage engines.
- **mysql_install_db on macOS** — MariaDB uses `mysql_install_db` (not `--initialize`) for data dir setup. The existing `MariadbService.js` already handles this but it's Windows-only tested.
- **Codesigning** — binaries built in CI are unsigned. macOS Gatekeeper may block them. Local's existing services are codesigned as part of the app bundle; this spike skips that — it's a known gap for productionization.
