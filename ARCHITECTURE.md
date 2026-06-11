# Architecture

This document explains the non-obvious design decisions in `local-addon-mariadb`.

## The Patching Approach

### Why not call `registerLightningService()` directly?

The obvious approach would be:

```typescript
import { registerLightningService } from '@getflywheel/local/main';
registerLightningService(MariadbService, 'mariadb', '10.6.23');
```

This doesn't work because of Local's addon load order:

1. Addons in `userDataPath/addons/` load first
2. Lightning services in `userDataPath/lightning-services/` load second

Local bundles `mariadb-10.6.23+0` as a Windows-only lightning service. When it loads (step 2), it calls `registerLightningService(WindowsOnlyMariadbService, 'mariadb', '10.6.23')` — **overwriting** our registration from step 1.

### The solution: patch before load

Since our addon loads *before* the bundled lightning service, we can replace the bundled `MariadbService.js` with our cross-platform version before it gets loaded:

```
Startup sequence:
1. maybeCopyBundledServices() — restores mariadb-10.6.23+0 from extraResources
2. addons/local-addon-mariadb loads:
   a. Copies our cross-platform MariadbService.js → lightning-services/mariadb-10.6.23+0/lib/MariadbService.js
   b. Creates symlink: lightning-services/mariadb-10.6.23+0/bin/ → addons/local-addon-mariadb/bin/
3. lightning-services/mariadb-10.6.23+0 loads:
   a. Reads our patched MariadbService.js (now cross-platform)
   b. Calls registerLightningService(CrossPlatformMariadbService, 'mariadb', '10.6.23') ✓
```

### The bin/ symlink

`LightningServicesService.getPlatformFromService()` detects which platforms a service supports by reading the `bin/` directory of the service package. Without the symlink, that directory doesn't exist (the binaries live in the addon directory, not the lightning-services directory), and the service is silently excluded from the database selector dropdown.

The symlink makes the addon's `bin/darwin-arm64/` visible at `lightning-services/mariadb-10.6.23+0/bin/darwin-arm64/`, which is where `getPlatformFromService()` expects to find it.

## Why `mysqld --bootstrap` instead of `mysql_install_db`

MariaDB's `mysql_install_db` is a shell script that uses unquoted variable expansions like `dirname $0` and `for dir in $basedir/bin`. This breaks on any path containing spaces.

Local's `userDataPath` is `~/Library/Application Support/Local/` on macOS — "Application Support" contains a space. Every invocation of `mysql_install_db` fails with "FATAL ERROR: Could not find my_print_defaults".

The fix: pipe the SQL init files directly into `mysqld --bootstrap`:

```bash
{
  echo "CREATE DATABASE IF NOT EXISTS mysql; USE mysql;"
  cat share/mysql_system_tables.sql
  cat share/mysql_system_tables_data.sql
  echo "UPDATE mysql.global_priv SET priv=json_set(...) WHERE user='root'..."
} | mysqld --no-defaults --bootstrap --datadir=... --basedir=...
```

`mysqld` accepts the data directory path as a flag (not via shell expansion), so spaces are handled correctly.

## Binary Directory Layout

```
addons/local-addon-mariadb/        ← addon root (__dirname/../)
├── lib/
│   ├── main.js                    ← addon entry point
│   └── MariadbService.js          ← cross-platform service class
├── conf/
│   └── my.cnf.hbs                 ← MariaDB config template
└── bin/
    └── darwin-arm64/              ← downloaded on first use
        ├── bin/
        │   ├── mysqld             ← server binary (ad-hoc signed)
        │   ├── mysqladmin
        │   ├── mysql
        │   ├── mysqldump
        │   ├── mysqlcheck
        │   ├── my_print_defaults
        │   └── mysql_install_db   ← shell script (not used on macOS/Linux)
        ├── lib/
        │   └── *.dylib            ← bundled dylibs (libgnutls, etc.)
        └── share/
            ├── mysql_system_tables.sql
            └── mysql_system_tables_data.sql

lightning-services/mariadb-10.6.23+0/   ← patched at addon load time
├── lib/
│   ├── main.js                    ← bundled (unchanged)
│   └── MariadbService.js          ← REPLACED by our cross-platform version
├── conf/
│   └── my.cnf.hbs                 ← bundled (unchanged)
└── bin/                           ← SYMLINK → addons/local-addon-mariadb/bin/
```

## Binary Build Pipeline

Binaries are built via GitHub Actions (`.github/workflows/build-mariadb.yml`):

1. Download MariaDB source from mariadb.org
2. Build with CMake (`WITH_SSL=bundled`, `WITH_ZLIB=bundled` — no external SSL deps)
3. Run `dylibbundler` to bundle transitive dylib dependencies
4. Ad-hoc sign all binaries and dylibs (`codesign --sign -`)
5. Package as `bin-{platform}-{version}.tar.gz`
6. Upload to GitHub Releases

To publish a new MariaDB version: bump `MARIADB_VERSION` in `src/constants.ts`, trigger the workflow, upload artifacts to a new GitHub Release, update `package.json` version.

## Multi-Version Support

### Adding a New MariaDB Version

To add a new version (e.g. 11.4.x), edit `src/constants.ts`:

```typescript
export const SUPPORTED_VERSIONS: ServiceVersion[] = [
    { version: '10.6.23',  bundled: true  },
    { version: '10.11.11', bundled: false },
    { version: '11.4.2',   bundled: false }, // add here
];
```

Then build the binaries using the CI workflow (`workflow_dispatch` with the new version), create a GitHub Release, and upload the artifacts.

### Bundled vs. Created Service Directories

**Bundled (10.6.23):** Local ships this version as a Windows-only service. At startup, the addon patches `lightning-services/mariadb-10.6.23+0/lib/MariadbService.js` with the cross-platform version and symlinks `bin/` to the addon's downloaded binaries.

**Non-bundled (10.11.11+):** The addon creates the entire service directory from scratch in `lightning-services/mariadb-{version}+0/`:
- `package.json` — generated with the correct version tag
- `lib/main.js` — generated; reads `MARIADB_VERSION` from `./constants` at runtime
- `lib/constants.js` — generated with `MARIADB_VERSION = '{version}'`
- `lib/MariadbService.js` — copied from the addon's `lib/` (same class for all versions)
- `conf/my.cnf.hbs` — copied from the addon's `conf/`
- `bin/{platform}/bin/` — pre-created empty stubs so `getPlatformFromService()` can detect the platform and list the version in the dropdown before download completes

Binaries are downloaded into `lightning-services/mariadb-{version}+0/bin/{platform}/` (the service directory itself is the download destination for non-bundled versions).
