# Multi-Version MariaDB (v1.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MariaDB 10.11.11 (LTS) as a second selectable database version alongside 10.6.23 in Local's Custom environment dropdown.

**Architecture:** Each MariaDB version gets its own `lightning-services/mariadb-{version}+0/` directory in Local's userDataPath. For 10.6.23 (bundled by Local), we continue patching the existing service. For 10.11.11 (new, not bundled), the addon creates the full service directory from scratch — generating a version-specific `main.js` and `constants.js`, copying shared `MariadbService.js` and `conf/my.cnf.hbs`, and downloading platform binaries from GitHub Releases into that directory's `bin/` folder. Local discovers both service directories at startup and lists them both in the database dropdown.

**Tech Stack:** TypeScript, CommonJS, `fs-extra`, GitHub Actions (CI builds for 10.11.11), `node-fetch`, `tar`

---

## Context: How Local Discovers Versions

When Local starts, `AddonLoaderService` scans `userDataPath/lightning-services/` and loads every directory with a `package.json`. Each service calls `registerLightningService(MariadbService, 'mariadb', version)`. Local then shows all registered mariadb versions in the dropdown.

For `getPlatformFromService()` to detect the platform (and show the service in the dropdown), the service's `bin/` directory must exist and contain a platform subdirectory (e.g. `darwin-arm64/`). We pre-create the platform subdirectory so the service appears immediately — even before binaries finish downloading.

---

## File Structure

```
src/
├── constants.ts        MODIFY — add SUPPORTED_VERSIONS array
├── downloader.ts       MODIFY — accept explicit version param
├── main.ts             MODIFY — loop over all versions; create non-bundled service dirs
└── serviceTemplate.ts  CREATE — generates main.js, constants.js, package.json for new versions

tests/
├── downloader.test.ts  MODIFY — add version-param tests
├── main.test.ts        MODIFY — add tests for 10.11.11 service creation
└── serviceTemplate.test.ts CREATE — tests for generated file content

.github/workflows/
└── build-mariadb.yml   MODIFY — add 10.11.11 to the versions that get built
```

---

## Task 1: Update Constants for Multi-Version

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Update constants.ts**

```typescript
// src/constants.ts
export const MARIADB_VERSION = '10.6.23';  // bundled by Local — patched at startup
export const GITHUB_REPO = 'jpollock/local-addon-mariadb';

export interface ServiceVersion {
    version: string;
    /** True = Local bundles this version; use patch approach. False = create from scratch. */
    bundled: boolean;
}

export const SUPPORTED_VERSIONS: ServiceVersion[] = [
    { version: '10.6.23',  bundled: true  },
    { version: '10.11.11', bundled: false },
];
```

- [ ] **Step 2: Rebuild**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-mariadb
npm run build
```

Expected: no TypeScript errors, `lib/constants.js` updated.

- [ ] **Step 3: Verify tests still pass**

```bash
npm test
```

Expected: 35 tests pass (constants change is additive).

- [ ] **Step 4: Commit**

```bash
git add src/constants.ts
git commit -m "feat(v1.1): add SUPPORTED_VERSIONS with 10.6.23 and 10.11.11"
```

---

## Task 2: Version-Parameterized Downloader

**Files:**
- Modify: `src/downloader.ts`
- Modify: `tests/downloader.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/downloader.test.ts`:

```typescript
describe('downloadBinaries with explicit version', () => {
    it('downloads 10.11.11 binaries to the correct subdir', async () => {
        // hasBinaries checks for bin/{platform}/bin/mysqld
        // We just verify the URL used is version-specific
        const url = getBinaryUrl('darwin-arm64', '10.11.11');
        expect(url).toContain('/v10.11.11/');
        expect(url).toContain('bin-darwin-arm64-10.11.11.tar.gz');
    });

    it('hasBinaries returns false when version-specific mysqld missing', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-v2-'));
        // darwin-arm64 dir exists but no mysqld
        await fs.ensureDir(path.join(tmpDir, 'bin', 'darwin-arm64', 'bin'));
        expect(await hasBinaries(tmpDir, 'darwin-arm64')).toBe(false);
        await fs.remove(tmpDir);
    });
});
```

- [ ] **Step 2: Run to confirm PASS** (these tests don't require code changes — they verify existing behaviour with the new URL)

```bash
npx jest --testPathPattern=downloader
```

Expected: all downloader tests pass (the new tests pass trivially since `getBinaryUrl` already accepts any version).

- [ ] **Step 3: Update `downloadBinaries` signature to accept explicit version**

In `src/downloader.ts`, change the function signature so callers can pass a version (defaults to `MARIADB_VERSION` for backward compat):

```typescript
export async function downloadBinaries(serviceDir: string, version: string = MARIADB_VERSION): Promise<void> {
    const platform = getPlatform();
    if (!platform) return;

    if (await hasBinaries(serviceDir, platform)) return;

    const url = getBinaryUrl(platform, version);
    const checksumUrl = getChecksumUrl(platform, version);
    const destDir = path.join(serviceDir, 'bin', platform);
    const tmpFile = path.join(serviceDir, `bin-${platform}.tar.gz`);

    await fs.ensureDir(destDir);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download MariaDB ${version} binaries (${response.status}): ${url}`);
    }

    try {
        await new Promise<void>((resolve, reject) => {
            const fileStream = fs.createWriteStream(tmpFile);
            response.body!.pipe(fileStream);
            response.body!.on('error', (err) => {
                fileStream.destroy();
                reject(err);
            });
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
        });

        const checksumResponse = await fetch(checksumUrl);
        if (checksumResponse.ok) {
            const checksumContent = await checksumResponse.text();
            await verifyChecksum(tmpFile, checksumContent);
        } else {
            console.warn(`[local-addon-mariadb] Checksum not available for ${version} (${checksumResponse.status})`);
        }

        await tar.extract({ file: tmpFile, cwd: destDir });
    } finally {
        await fs.remove(tmpFile).catch(() => {});
    }
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: 35+ tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/downloader.ts tests/downloader.test.ts
git commit -m "feat(v1.1): version param on downloadBinaries (default = 10.6.23)"
```

---

## Task 3: Service Template Generator

**Files:**
- Create: `src/serviceTemplate.ts`
- Create: `tests/serviceTemplate.test.ts`

This module generates the files needed to create a complete lightning service directory for non-bundled versions.

- [ ] **Step 1: Write failing tests**

Create `tests/serviceTemplate.test.ts`:

```typescript
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import {
    generateMainJs,
    generateConstantsJs,
    generatePackageJson,
    createServiceDirectory,
} from '../src/serviceTemplate';

describe('generateMainJs', () => {
    it('exports a default function that calls registerLightningService', () => {
        const code = generateMainJs();
        expect(code).toContain('registerLightningService');
        expect(code).toContain("require('./MariadbService')");
        expect(code).toContain("require('./constants')");
        expect(code).toContain('MARIADB_VERSION');
        expect(code).toContain('exports.default');
    });
});

describe('generateConstantsJs', () => {
    it('exports the given version as MARIADB_VERSION', () => {
        const code = generateConstantsJs('10.11.11');
        expect(code).toContain("exports.MARIADB_VERSION = '10.11.11'");
        expect(code).toContain('exports.GITHUB_REPO');
    });

    it('produces different output for different versions', () => {
        const a = generateConstantsJs('10.6.23');
        const b = generateConstantsJs('10.11.11');
        expect(a).not.toBe(b);
    });
});

describe('generatePackageJson', () => {
    it('contains the correct version and lightning service tags', () => {
        const pkg = generatePackageJson('10.11.11');
        expect(pkg.version).toBe('10.11.11+0');
        expect(pkg.name).toBe('mariadb');
        expect(pkg.tags).toContain('local-lightning-service');
        expect(pkg.main).toBe('lib/main.js');
    });
});

describe('createServiceDirectory', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-svc-'));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    it('creates the expected directory structure', async () => {
        const addonLibDir = path.resolve(__dirname, '..', 'lib');
        const addonConfDir = path.resolve(__dirname, '..', 'conf');
        await createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir);

        expect(await fs.pathExists(path.join(tmpDir, 'package.json'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'lib', 'main.js'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'lib', 'MariadbService.js'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'lib', 'constants.js'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'conf', 'my.cnf.hbs'))).toBe(true);
    });

    it('writes version-specific constants.js', async () => {
        const addonLibDir = path.resolve(__dirname, '..', 'lib');
        const addonConfDir = path.resolve(__dirname, '..', 'conf');
        await createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir);

        const constants = await fs.readFile(path.join(tmpDir, 'lib', 'constants.js'), 'utf8');
        expect(constants).toContain("'10.11.11'");
        expect(constants).not.toContain('10.6.23');
    });

    it('pre-creates darwin-arm64 bin subdir for getPlatformFromService discovery', async () => {
        const addonLibDir = path.resolve(__dirname, '..', 'lib');
        const addonConfDir = path.resolve(__dirname, '..', 'conf');
        await createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir);

        expect(await fs.pathExists(path.join(tmpDir, 'bin', 'darwin-arm64', 'bin'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'bin', 'linux', 'bin'))).toBe(true);
    });

    it('is idempotent — running twice does not throw', async () => {
        const addonLibDir = path.resolve(__dirname, '..', 'lib');
        const addonConfDir = path.resolve(__dirname, '..', 'conf');
        await createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir);
        await expect(createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir))
            .resolves.not.toThrow();
    });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npx jest --testPathPattern=serviceTemplate
```

Expected: FAIL — `Cannot find module '../src/serviceTemplate'`

- [ ] **Step 3: Write the implementation**

Create `src/serviceTemplate.ts`:

```typescript
import path from 'path';
import fs from 'fs-extra';
import { GITHUB_REPO } from './constants';

/** Generated main.js for a non-bundled lightning service.
 *  Reads MARIADB_VERSION from ./constants so one file works for any version. */
export function generateMainJs(): string {
    return `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const main_1 = require("@getflywheel/local/main");
const MariadbService_1 = require("./MariadbService");
const { MARIADB_VERSION } = require("./constants");
function main() {
    (0, main_1.registerLightningService)(MariadbService_1.default, 'mariadb', MARIADB_VERSION);
}
exports.default = main;
`;
}

/** Generated constants.js — pins the version for this service directory. */
export function generateConstantsJs(version: string): string {
    return `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GITHUB_REPO = exports.MARIADB_VERSION = void 0;
exports.MARIADB_VERSION = '${version}';
exports.GITHUB_REPO = '${GITHUB_REPO}';
`;
}

/** Generated package.json — required for Local's AddonLoaderService to load the service. */
export function generatePackageJson(version: string): Record<string, unknown> {
    return {
        name: 'mariadb',
        version: `${version}+0`,
        productName: `Lightning Service: MariaDB Server ${version}`,
        main: 'lib/main.js',
        tags: ['local-lightning-service', 'local-site-service'],
        local: { hidden: true },
        license: 'MIT',
    };
}

/**
 * Creates a complete lightning service directory for a non-bundled MariaDB version.
 *
 * Directory layout:
 *   serviceDir/
 *   ├── package.json
 *   ├── lib/
 *   │   ├── main.js           (generated — reads version from constants)
 *   │   ├── MariadbService.js (copied from addon lib/)
 *   │   └── constants.js      (generated — pins version)
 *   ├── conf/
 *   │   └── my.cnf.hbs        (copied from addon conf/)
 *   └── bin/
 *       ├── darwin-arm64/bin/ (pre-created so getPlatformFromService can scan)
 *       ├── darwin/bin/
 *       └── linux/bin/
 *
 * Binaries are downloaded separately into bin/{platform}/ by downloadBinaries().
 * The bin/ platform subdirs are pre-created so Local discovers the service
 * in the dropdown immediately (before download completes).
 */
export async function createServiceDirectory(
    serviceDir: string,
    version: string,
    addonLibDir: string,
    addonConfDir: string,
): Promise<void> {
    await fs.ensureDir(path.join(serviceDir, 'lib'));
    await fs.ensureDir(path.join(serviceDir, 'conf'));

    // package.json
    await fs.writeJson(path.join(serviceDir, 'package.json'), generatePackageJson(version), { spaces: 4 });

    // lib/main.js — generated, reads MARIADB_VERSION from constants at runtime
    await fs.writeFile(path.join(serviceDir, 'lib', 'main.js'), generateMainJs());

    // lib/constants.js — version-specific
    await fs.writeFile(path.join(serviceDir, 'lib', 'constants.js'), generateConstantsJs(version));

    // lib/MariadbService.js — same cross-platform class for all versions
    await fs.copy(
        path.join(addonLibDir, 'MariadbService.js'),
        path.join(serviceDir, 'lib', 'MariadbService.js'),
        { overwrite: true },
    );

    // conf/my.cnf.hbs — same template for all versions
    await fs.copy(
        path.join(addonConfDir, 'my.cnf.hbs'),
        path.join(serviceDir, 'conf', 'my.cnf.hbs'),
        { overwrite: true },
    );

    // Pre-create bin platform subdirs so getPlatformFromService() can scan
    // them at startup and include this service in the dropdown.
    // Actual binaries are downloaded separately.
    for (const platform of ['darwin-arm64', 'darwin', 'linux']) {
        await fs.ensureDir(path.join(serviceDir, 'bin', platform, 'bin'));
    }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest --testPathPattern=serviceTemplate
```

Expected: all serviceTemplate tests pass.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: 35+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/serviceTemplate.ts tests/serviceTemplate.test.ts
git commit -m "feat(v1.1): serviceTemplate — generates lightning service dir for non-bundled versions"
```

---

## Task 4: Update main.ts for Multi-Version

**Files:**
- Modify: `src/main.ts`
- Modify: `tests/main.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/main.test.ts` (inside the existing `describe` block or as a new block):

```typescript
describe('10.11.11 service directory creation', () => {
    let tmpDir: string;
    let userDataPath: string;

    beforeAll(() => {
        // Ensure src/ has the built files ts-jest needs
        const libDir = path.resolve(__dirname, '..', 'lib');
        const srcDir = path.resolve(__dirname, '..', 'src');
        for (const file of ['MariadbService.js', 'constants.js']) {
            if (!fs.pathExistsSync(path.join(srcDir, file))) {
                fs.copyFileSync(path.join(libDir, file), path.join(srcDir, file));
            }
        }
    });

    afterAll(() => {
        const srcDir = path.resolve(__dirname, '..', 'src');
        for (const file of ['MariadbService.js', 'constants.js']) {
            fs.removeSync(path.join(srcDir, file));
        }
    });

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-main2-test-'));
        userDataPath = tmpDir;
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    it('creates the 10.11.11 service directory on startup', () => {
        main(makeContext(userDataPath));

        const svcDir = path.join(userDataPath, 'lightning-services', 'mariadb-10.11.11+0');
        expect(fs.pathExistsSync(svcDir)).toBe(true);
        expect(fs.pathExistsSync(path.join(svcDir, 'lib', 'main.js'))).toBe(true);
        expect(fs.pathExistsSync(path.join(svcDir, 'lib', 'MariadbService.js'))).toBe(true);
        expect(fs.pathExistsSync(path.join(svcDir, 'lib', 'constants.js'))).toBe(true);
    });

    it('writes 10.11.11-specific constants.js into the service dir', () => {
        main(makeContext(userDataPath));

        const constants = fs.readFileSync(
            path.join(userDataPath, 'lightning-services', 'mariadb-10.11.11+0', 'lib', 'constants.js'),
            'utf8'
        );
        expect(constants).toContain("'10.11.11'");
    });

    it('pre-creates darwin-arm64/bin subdir for platform discovery', () => {
        main(makeContext(userDataPath));

        const platformDir = path.join(
            userDataPath, 'lightning-services', 'mariadb-10.11.11+0', 'bin', 'darwin-arm64', 'bin'
        );
        expect(fs.pathExistsSync(platformDir)).toBe(true);
    });

    it('triggers binary download for 10.11.11', () => {
        const { downloadBinaries } = require('../src/downloader');
        main(makeContext(userDataPath));
        // downloadBinaries should be called at least twice (once per version)
        expect(downloadBinaries.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npx jest --testPathPattern=main
```

Expected: new tests fail — 10.11.11 service dir not created yet.

- [ ] **Step 3: Update main.ts**

Replace the contents of `src/main.ts`:

```typescript
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { downloadBinaries } from './downloader';
import { MARIADB_VERSION, SUPPORTED_VERSIONS } from './constants';
import { createServiceDirectory } from './serviceTemplate';

const SERVICE_DIR = path.join(__dirname, '..');
const ADDON_LIB_DIR = path.join(__dirname);         // compiled lib/ files
const ADDON_CONF_DIR = path.join(__dirname, '../conf');

function getDefaultUserDataPath(): string {
    if (process.platform === 'linux') {
        return path.join(os.homedir(), '.config', 'Local');
    }
    return path.join(os.homedir(), 'Library', 'Application Support', 'Local');
}

/** For 10.6.23: patch the bundled lightning service with our cross-platform version. */
function patchBundledService(userDataPath: string): void {
    const serviceName = `mariadb-${MARIADB_VERSION}+0`;
    const lightningServiceDir = path.join(userDataPath, 'lightning-services', serviceName);

    try {
        if (!fs.pathExistsSync(lightningServiceDir)) return;

        fs.copySync(
            path.join(__dirname, 'MariadbService.js'),
            path.join(lightningServiceDir, 'lib', 'MariadbService.js'),
            { overwrite: true }
        );
        fs.copySync(
            path.join(__dirname, 'constants.js'),
            path.join(lightningServiceDir, 'lib', 'constants.js'),
            { overwrite: true }
        );

        const lightningBinDir = path.join(lightningServiceDir, 'bin');
        const addonBinDir = path.join(SERVICE_DIR, 'bin');

        if (fs.pathExistsSync(lightningBinDir)) {
            const stat = fs.lstatSync(lightningBinDir);
            if (stat.isSymbolicLink() || stat.isDirectory()) {
                fs.removeSync(lightningBinDir);
            }
        }
        fs.ensureDirSync(addonBinDir);
        fs.symlinkSync(addonBinDir, lightningBinDir);

        console.log(`[local-addon-mariadb] Patched bundled service ${serviceName}`);
    } catch (err: any) {
        console.error(`[local-addon-mariadb] Failed to patch ${serviceName}:`, err.message);
    }
}

/** For non-bundled versions: create the full service directory from scratch. */
async function ensureNewServiceVersion(userDataPath: string, version: string): Promise<void> {
    const serviceName = `mariadb-${version}+0`;
    const serviceDir = path.join(userDataPath, 'lightning-services', serviceName);

    try {
        await createServiceDirectory(serviceDir, version, ADDON_LIB_DIR, ADDON_CONF_DIR);
        console.log(`[local-addon-mariadb] Ensured service directory for ${serviceName}`);
    } catch (err: any) {
        console.error(`[local-addon-mariadb] Failed to create service dir for ${serviceName}:`, err.message);
    }
}

export default function main(context: any): void {
    const userDataPath: string =
        context?.environment?.userDataPath || getDefaultUserDataPath();

    console.log(`[local-addon-mariadb] userDataPath: ${userDataPath}`);

    for (const { version, bundled } of SUPPORTED_VERSIONS) {
        if (bundled) {
            patchBundledService(userDataPath);
        } else {
            // Fire-and-forget — errors are caught inside ensureNewServiceVersion
            ensureNewServiceVersion(userDataPath, version).then(() => {
                // Download into the service dir itself (not the addon dir)
                const serviceName = `mariadb-${version}+0`;
                const serviceDir = path.join(userDataPath, 'lightning-services', serviceName);
                return downloadBinaries(serviceDir, version);
            }).catch((err: Error) => {
                console.error(`[local-addon-mariadb] Failed to set up ${version}:`, err.message);
            });
        }
    }

    // 10.6.23 binaries live in the addon dir (via symlink from lightning-services)
    downloadBinaries(SERVICE_DIR, MARIADB_VERSION).catch((err: Error) => {
        console.error('[local-addon-mariadb] Failed to download binaries:', err.message);
    });
}
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all tests pass including the new 10.11.11 tests.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts tests/main.test.ts
git commit -m "feat(v1.1): create 10.11.11 service directory from scratch at startup"
```

---

## Task 5: Build 10.11.11 Binaries in CI

**Files:**
- Modify: `.github/workflows/build-mariadb.yml`

The CI workflow already accepts `mariadb_version` as input. No structural change needed — just trigger a new build for `10.11.11`.

- [ ] **Step 1: Trigger the CI build for 10.11.11**

```bash
gh workflow run build-mariadb.yml \
  --repo jpollock/local-addon-mariadb \
  --field mariadb_version=10.11.11
```

Expected: run queued at `https://github.com/jpollock/local-addon-mariadb/actions`

- [ ] **Step 2: Wait for arm64 and linux to complete, download artifacts**

```bash
RUN_ID=$(gh run list --repo jpollock/local-addon-mariadb --workflow=build-mariadb.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch $RUN_ID --repo jpollock/local-addon-mariadb
```

Then download:
```bash
mkdir -p /tmp/mariadb-10.11.11-artifacts
gh run download $RUN_ID \
  --repo jpollock/local-addon-mariadb \
  --dir /tmp/mariadb-10.11.11-artifacts
ls /tmp/mariadb-10.11.11-artifacts/
```

Expected: `mariadb-10.11.11-darwin-arm64/`, `mariadb-10.11.11-linux/`

- [ ] **Step 3: Create GitHub Release v10.11.11**

```bash
gh release create v10.11.11 \
  --repo jpollock/local-addon-mariadb \
  --title "MariaDB 10.11.11 (LTS)" \
  --notes "MariaDB 10.11.11 LTS binaries for Local by Flywheel.

## Platforms
- darwin-arm64 (macOS Apple Silicon) ✅
- linux (x86_64) ✅
- darwin (Intel Mac) 🔄 coming soon"
```

- [ ] **Step 4: Upload artifacts to the release**

```bash
gh release upload v10.11.11 \
  /tmp/mariadb-10.11.11-artifacts/mariadb-10.11.11-darwin-arm64/bin-darwin-arm64-10.11.11.tar.gz \
  /tmp/mariadb-10.11.11-artifacts/mariadb-10.11.11-darwin-arm64/bin-darwin-arm64-10.11.11.tar.gz.sha256 \
  /tmp/mariadb-10.11.11-artifacts/mariadb-10.11.11-linux/bin-linux-10.11.11.tar.gz \
  /tmp/mariadb-10.11.11-artifacts/mariadb-10.11.11-linux/bin-linux-10.11.11.tar.gz.sha256 \
  --repo jpollock/local-addon-mariadb
```

- [ ] **Step 5: Verify release URLs work**

```bash
curl -sI "https://github.com/jpollock/local-addon-mariadb/releases/download/v10.11.11/bin-darwin-arm64-10.11.11.tar.gz" | head -3
```

Expected: `HTTP/2 302`

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: note 10.11.11 release published" --allow-empty
```

---

## Task 6: Local E2E Verification

- [ ] **Step 1: Build and install**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-mariadb
npm run build
# Addon is already symlinked — no reinstall needed
```

- [ ] **Step 2: Restart Local**

Quit Local (Cmd+Q) and reopen.

Check logs for:
```
[local-addon-mariadb] Ensured service directory for mariadb-10.11.11+0
```

- [ ] **Step 3: Verify both versions appear in dropdown**

Add Site → Custom environment → Database dropdown should show:
- MariaDB 10.6.23
- MariaDB 10.11.11

- [ ] **Step 4: Create a 10.11.11 site**

Select MariaDB 10.11.11, complete site creation.

Note: binaries download (~25MB) on first use. Site creation may take a moment.

- [ ] **Step 5: Verify in wp-admin**

wp-admin → Tools → Site Health → Info → Database

Expected: `Server version: 10.11.11-MariaDB`

---

## Task 7: Update Docs

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Update platform support table in README.md**

Change the database versions section to:

```markdown
## Supported MariaDB Versions

| Version | Status | Notes |
|---------|--------|-------|
| 10.6.23 | ✅ Stable | Bundled with Local |
| 10.11.11 (LTS) | ✅ Stable | Downloaded on first use |

## Platform Support

| Platform | Status |
|----------|--------|
| macOS Apple Silicon (arm64) | ✅ Both versions |
| macOS Intel (x86_64) | 🔄 Coming soon |
| Linux (x86_64) | ✅ Both versions |
| Windows | ❌ Not supported |
```

- [ ] **Step 2: Add v1.1.0 entry to CHANGELOG.md**

```markdown
## [1.1.0] - 2026-06-11

### Added
- MariaDB 10.11.11 (LTS) as a second selectable database version
- Multi-version architecture: addon creates full service directories for non-bundled versions
- `SUPPORTED_VERSIONS` constant for easy addition of future versions

### Changed
- `downloadBinaries()` accepts an explicit `version` parameter
- `main.ts` loops over all supported versions at startup
```

- [ ] **Step 3: Add to ARCHITECTURE.md — non-bundled version creation**

Append a new section explaining the difference between bundled (10.6.23) and created-from-scratch (10.11.11) approaches.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md ARCHITECTURE.md
git commit -m "docs: update for v1.1 multi-version support"
```

---

## Self-Review

**Spec coverage:**
- ✅ 10.11.11 appears in dropdown
- ✅ 10.6.23 continues to work unchanged
- ✅ Binaries download from GitHub Releases for 10.11.11
- ✅ Service directory created from scratch for non-bundled versions
- ✅ TDD throughout (serviceTemplate.test.ts, main.test.ts additions)
- ✅ CI builds 10.11.11 binaries using existing workflow

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `ServiceVersion` interface defined in Task 1, used in Task 4 ✓
- `createServiceDirectory(serviceDir, version, addonLibDir, addonConfDir)` — 4-arg signature matches between Task 3 definition and Task 4 call ✓
- `downloadBinaries(serviceDir, version)` — 2-arg signature matches between Task 2 definition and Task 4 call ✓
- `SUPPORTED_VERSIONS` imported from constants in Task 4 ✓

**Gap check:** The pre-created empty `bin/darwin-arm64/bin` dirs ensure `getPlatformFromService` finds the platform. But `hasBinaries()` checks for `mysqld` specifically — the service is listed in dropdown (platform found) but site creation succeeds only after download completes. This is by design and noted in the E2E step.
