# MariaDB Addon v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Local by Flywheel lightning service addon that provides MariaDB 10.6.23 for macOS (arm64 + Intel) and Linux, auto-downloading platform binaries from GitHub Releases on first use.

**Architecture:** The addon is a lightning service package that installs into `userDataPath/lightning-services/mariadb-10.6.23+0/`. Its `main.ts` checks for platform binaries on load, downloads them from GitHub Releases if absent, then calls `registerLightningService()`. The `MariadbService.ts` extends the existing Windows-only service with darwin, darwin-arm64, and linux platform support and cross-platform `mysql_install_db` invocation.

**Tech Stack:** TypeScript 4.x, CommonJS output (ES2020 target), `fs-extra`, `node-fetch@2` (CJS-compatible), `tar` (extraction), `@getflywheel/local` (service API)

---

## Context: What Local Expects

When Local loads addons from `userDataPath/lightning-services/`, it:
1. Reads `package.json` for `main` entry and `tags`
2. Calls the default export of `lib/main.js` (the compiled `main.ts`)
3. Expects `registerLightningService(ServiceClass, name, binVersion)` to be called
4. The service class's `$PATHs` getter tells it where to find platform binaries
5. Binary layout must be: `bin/{platform}/bin/mysqld`, `bin/{platform}/lib/*.dylib`, `bin/{platform}/share/*.sql`

GitHub Releases URL pattern:
`https://github.com/jpollock/local-addon-mariadb/releases/download/v10.6.23/bin-{platform}-10.6.23.tar.gz`

Platforms: `darwin-arm64`, `darwin`, `linux`

---

## File Structure

```
local-addon-mariadb/
├── src/
│   ├── main.ts           CREATE - entry point: download binaries + register service
│   ├── MariadbService.ts CREATE - cross-platform service class
│   └── downloader.ts     CREATE - binary download + extraction logic
├── conf/
│   └── my.cnf.hbs        CREATE - MariaDB config template
├── tests/
│   ├── downloader.test.ts  CREATE - unit tests for platform detection + URL building
│   └── MariadbService.test.ts CREATE - unit tests for path resolution
├── package.json          CREATE - addon manifest + build config
├── tsconfig.json         CREATE - TypeScript config
└── .gitignore            UPDATE - ignore bin/ downloads
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "local-addon-mariadb",
  "productName": "MariaDB for Local",
  "version": "0.1.0",
  "description": "Adds MariaDB 10.6.23 support to Local on macOS and Linux",
  "author": "Jeremy Pollock",
  "license": "MIT",
  "main": "lib/main.js",
  "tags": [
    "local-lightning-service",
    "local-site-service"
  ],
  "local": {
    "hidden": false
  },
  "localAddon": {
    "minimumLocalVersion": "9.0.0"
  },
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "install-addon": "node scripts/install-addon.js"
  },
  "dependencies": {
    "delay": "^4.3.0",
    "fs-extra": "^10.1.0",
    "node-fetch": "^2.7.0",
    "slash": "^3.0.0",
    "tar": "^6.2.0"
  },
  "bundleDependencies": [
    "delay",
    "fs-extra",
    "node-fetch",
    "slash",
    "tar"
  ],
  "devDependencies": {
    "@getflywheel/local": "^9.2.6",
    "@types/fs-extra": "^11.0.4",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "@types/node-fetch": "^2.6.11",
    "@types/tar": "^6.1.13",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^4.9.5"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./lib",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "lib", "tests"]
}
```

- [ ] **Step 3: Update .gitignore**

```
node_modules/
lib/
bin/
*.tar.gz
```

- [ ] **Step 4: Install dependencies**

```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-mariadb
npm install
```

Expected: `node_modules/` populated, no errors.

- [ ] **Step 5: Commit scaffold**

```bash
git add package.json tsconfig.json .gitignore
git commit -m "feat: project scaffold — package.json, tsconfig, deps"
```

---

## Task 2: Binary Downloader

**Files:**
- Create: `src/downloader.ts`
- Create: `tests/downloader.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/downloader.test.ts
import { getPlatform, getBinaryUrl, hasBinaries } from '../src/downloader';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('getPlatform', () => {
    it('returns darwin-arm64 on Apple Silicon', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        Object.defineProperty(process, 'arch', { value: 'arm64' });
        expect(getPlatform()).toBe('darwin-arm64');
    });

    it('returns darwin on Intel Mac', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        Object.defineProperty(process, 'arch', { value: 'x64' });
        expect(getPlatform()).toBe('darwin');
    });

    it('returns linux on Linux', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        Object.defineProperty(process, 'arch', { value: 'x64' });
        expect(getPlatform()).toBe('linux');
    });

    it('returns null on Windows (binaries bundled)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        expect(getPlatform()).toBeNull();
    });
});

describe('getBinaryUrl', () => {
    it('constructs the correct GitHub Releases URL', () => {
        const url = getBinaryUrl('darwin-arm64', '10.6.23');
        expect(url).toBe(
            'https://github.com/jpollock/local-addon-mariadb/releases/download/v10.6.23/bin-darwin-arm64-10.6.23.tar.gz'
        );
    });
});

describe('hasBinaries', () => {
    it('returns true when mysqld exists', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-test-'));
        const binDir = path.join(tmpDir, 'bin', 'darwin-arm64', 'bin');
        await fs.ensureDir(binDir);
        await fs.writeFile(path.join(binDir, 'mysqld'), '');
        expect(await hasBinaries(tmpDir, 'darwin-arm64')).toBe(true);
        await fs.remove(tmpDir);
    });

    it('returns false when mysqld is missing', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-test-'));
        expect(await hasBinaries(tmpDir, 'darwin-arm64')).toBe(false);
        await fs.remove(tmpDir);
    });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern=downloader
```

Expected: FAIL — `Cannot find module '../src/downloader'`

- [ ] **Step 3: Write the downloader**

```typescript
// src/downloader.ts
import fs from 'fs-extra';
import path from 'path';
import fetch from 'node-fetch';
import tar from 'tar';

const GITHUB_REPO = 'jpollock/local-addon-mariadb';
const MARIADB_VERSION = '10.6.23';

export function getPlatform(): string | null {
    if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
    if (process.platform === 'darwin') return 'darwin';
    if (process.platform === 'linux') return 'linux';
    return null; // Windows — binaries are bundled, no download needed
}

export function getBinaryUrl(platform: string, version: string): string {
    return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/bin-${platform}-${version}.tar.gz`;
}

export async function hasBinaries(serviceDir: string, platform: string): Promise<boolean> {
    const mysqldPath = path.join(serviceDir, 'bin', platform, 'bin', 'mysqld');
    return fs.pathExists(mysqldPath);
}

export async function downloadBinaries(serviceDir: string): Promise<void> {
    const platform = getPlatform();
    if (!platform) return;

    if (await hasBinaries(serviceDir, platform)) return;

    const url = getBinaryUrl(platform, MARIADB_VERSION);
    const destDir = path.join(serviceDir, 'bin', platform);
    const tmpFile = path.join(serviceDir, `bin-${platform}.tar.gz`);

    await fs.ensureDir(destDir);

    // Download
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download MariaDB binaries: ${response.status} ${url}`);
    }

    const fileStream = fs.createWriteStream(tmpFile);
    await new Promise<void>((resolve, reject) => {
        response.body!.pipe(fileStream);
        response.body!.on('error', reject);
        fileStream.on('finish', resolve);
    });

    // Extract
    await tar.extract({ file: tmpFile, cwd: destDir });
    await fs.remove(tmpFile);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=downloader
```

Expected: PASS (3 suites, 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/downloader.ts tests/downloader.test.ts
git commit -m "feat: binary downloader — platform detection, URL building, extraction"
```

---

## Task 3: MariaDB Service Class

**Files:**
- Create: `src/MariadbService.ts`
- Create: `tests/MariadbService.test.ts`

- [ ] **Step 1: Add jest config to package.json**

Add this to `package.json`:
```json
"jest": {
  "preset": "ts-jest",
  "testEnvironment": "node",
  "testMatch": ["**/tests/**/*.test.ts"],
  "moduleNameMapper": {
    "@getflywheel/local/main": "<rootDir>/tests/__mocks__/local-main.ts"
  }
}
```

- [ ] **Step 2: Write the Local mock**

```typescript
// tests/__mocks__/local-main.ts
export enum LightningServicePlatform {
    Darwin = 'darwin',
    DarwinArm64 = 'darwin-arm64',
    Linux = 'linux',
    Win32 = 'win32',
    Win32x64 = 'win64',
}

export class LightningService {
    _logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    runPath = '/tmp/run/site123/mariadb';
    configPath = '/tmp/run/site123/conf/mariadb';
    port = 10053;
    bin: Record<string, string> = {};
}

export const execFilePromise = jest.fn();
export const registerLightningService = jest.fn();
```

- [ ] **Step 3: Write failing tests**

```typescript
// tests/MariadbService.test.ts
import path from 'path';
import { LightningServicePlatform } from '@getflywheel/local/main';
import MariadbService from '../src/MariadbService';

const SERVICE_DIR = path.join(__dirname, '..');

describe('MariadbService.$PATHs', () => {
    it('has darwin-arm64 path pointing inside bin/', () => {
        const svc = new MariadbService();
        const p = svc.$PATHs[LightningServicePlatform.DarwinArm64];
        expect(p).toContain(path.join('bin', 'darwin-arm64', 'bin'));
    });

    it('has darwin path pointing inside bin/', () => {
        const svc = new MariadbService();
        const p = svc.$PATHs[LightningServicePlatform.Darwin];
        expect(p).toContain(path.join('bin', 'darwin', 'bin'));
    });

    it('has linux path pointing inside bin/', () => {
        const svc = new MariadbService();
        const p = svc.$PATHs[LightningServicePlatform.Linux];
        expect(p).toContain(path.join('bin', 'linux', 'bin'));
    });

    it('has win32 path pointing inside bin/', () => {
        const svc = new MariadbService();
        const p = svc.$PATHs[LightningServicePlatform.Win32];
        expect(p).toContain(path.join('bin', 'win32', 'bin'));
    });
});

describe('MariadbService.bins', () => {
    it('includes mysql_install_db for darwin-arm64', () => {
        const svc = new MariadbService();
        const bins = svc.bins[LightningServicePlatform.DarwinArm64];
        expect(bins.mysql_install_db).toBeDefined();
        expect(bins.mysql_install_db).not.toContain('.exe');
    });

    it('includes .exe extension for win32', () => {
        const svc = new MariadbService();
        const bins = svc.bins[LightningServicePlatform.Win32];
        expect(bins.mysqld).toContain('.exe');
        expect(bins.mysql_install_db).toContain('.exe');
    });
});

describe('MariadbService.basedir', () => {
    it('returns the platform bin parent directory', () => {
        const svc = new MariadbService();
        const basedir = svc.getBasedir(LightningServicePlatform.DarwinArm64);
        expect(basedir).toContain(path.join('bin', 'darwin-arm64'));
        expect(basedir).not.toContain('bin/bin');
    });
});
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern=MariadbService
```

Expected: FAIL — `Cannot find module '../src/MariadbService'`

- [ ] **Step 5: Write MariadbService.ts**

```typescript
// src/MariadbService.ts
import * as LocalMain from '@getflywheel/local/main';
import path from 'path';
import slash from 'slash';
import fs from 'fs-extra';
import delay from 'delay';

const MARIADB_VERSION = '10.6.23';

export default class MariadbService extends LocalMain.LightningService {
    serviceName = 'mariadb';
    binVersion = MARIADB_VERSION;

    get configTemplatePath(): string {
        return path.join(__dirname, '../conf');
    }

    get $PATHs(): Record<string, string> {
        return {
            [LocalMain.LightningServicePlatform.Darwin]: path.join(__dirname, '../bin/darwin/bin'),
            [LocalMain.LightningServicePlatform.DarwinArm64]: path.join(__dirname, '../bin/darwin-arm64/bin'),
            [LocalMain.LightningServicePlatform.Linux]: path.join(__dirname, '../bin/linux/bin'),
            [LocalMain.LightningServicePlatform.Win32]: path.join(__dirname, '../bin/win32/bin'),
        };
    }

    /** Parent of bin/, lib/, share/ — needed by mysql_install_db --basedir */
    getBasedir(platform: string): string {
        return path.join(__dirname, '..', 'bin', platform);
    }

    get bins(): Record<string, Record<string, string>> {
        const unix = (platform: string) => ({
            mysql:            path.join(this.$PATHs[platform], 'mysql'),
            mysqld:           path.join(this.$PATHs[platform], 'mysqld'),
            mysqladmin:       path.join(this.$PATHs[platform], 'mysqladmin'),
            mysqldump:        path.join(this.$PATHs[platform], 'mysqldump'),
            mysqlcheck:       path.join(this.$PATHs[platform], 'mysqlcheck'),
            mysql_install_db: path.join(this.$PATHs[platform], 'mysql_install_db'),
        });
        const win32 = (platform: string, ext = '.exe') => ({
            mysql:            path.join(this.$PATHs[platform], `mysql${ext}`),
            mysqld:           path.join(this.$PATHs[platform], `mysqld${ext}`),
            mysqladmin:       path.join(this.$PATHs[platform], `mysqladmin${ext}`),
            mysqldump:        path.join(this.$PATHs[platform], `mysqldump${ext}`),
            mysqlcheck:       path.join(this.$PATHs[platform], `mysqlcheck${ext}`),
            mysql_install_db: path.join(this.$PATHs[platform], `mysql_install_db${ext}`),
        });
        return {
            [LocalMain.LightningServicePlatform.Darwin]:      unix(LocalMain.LightningServicePlatform.Darwin),
            [LocalMain.LightningServicePlatform.DarwinArm64]: unix(LocalMain.LightningServicePlatform.DarwinArm64),
            [LocalMain.LightningServicePlatform.Linux]:       unix(LocalMain.LightningServicePlatform.Linux),
            [LocalMain.LightningServicePlatform.Win32]:       win32(LocalMain.LightningServicePlatform.Win32),
        };
    }

    get requiredPorts(): Record<string, number> {
        return { MYSQL: 1 };
    }

    get socket(): string {
        return path.join(this.runPath, 'mysqld.sock');
    }

    get dataPath(): string {
        return slash(path.join(this.runPath, 'data'));
    }

    async preprovision(): Promise<void> {
        await this.setupMysqlDatadir();
    }

    async provision(): Promise<void> {
        await this.setupMysqlUser();
        await this.setupDatabase();
    }

    private async setupMysqlDatadir(): Promise<void> {
        this._logger.info('Initializing MariaDB datadir...', { dataPath: this.dataPath });
        await fs.ensureDir(this.dataPath);

        // Determine current platform to find basedir
        const platform = process.platform === 'darwin' && process.arch === 'arm64'
            ? LocalMain.LightningServicePlatform.DarwinArm64
            : process.platform === 'darwin'
                ? LocalMain.LightningServicePlatform.Darwin
                : process.platform === 'linux'
                    ? LocalMain.LightningServicePlatform.Linux
                    : LocalMain.LightningServicePlatform.Win32;

        const isWindows = process.platform === 'win32';
        const args = [
            `--datadir=${this.dataPath}`,
            `--port=${this.port}`,
            `--socket=${this.socket}`,
            `--password=root`,
            `--default-user=root`,
        ];

        // On macOS/Linux, mysql_install_db is a shell script that needs --basedir
        // to locate the share/ SQL init files
        if (!isWindows) {
            args.push(`--basedir=${this.getBasedir(platform)}`);
        }

        await LocalMain.execFilePromise(this.bin.mysql_install_db, args);
    }

    private async setupMysqlUser(): Promise<void> {
        this._logger.info('Setting up MariaDB user...');
        await this.waitForDB(true);
        try {
            await LocalMain.execFilePromise(this.bin.mysql, [
                '--password=',
                '-e',
                `ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'root';`,
            ], { env: { MYSQL_HOME: this.configPath } });
        } catch (e: any) {
            this._logger.error('Error setting up MariaDB user', { stack: e.stack });
        }
    }

    private async waitForDB(noPassword = false): Promise<boolean> {
        let latestError: Error | undefined;
        const maxTries = 5;
        const baseDelay = 1000;
        const maxDelay = 10000;

        for (let i = 0; i < maxTries; i++) {
            try {
                await LocalMain.execFilePromise(this.bin.mysqladmin, [
                    ...(noPassword ? ['--password='] : []),
                    'ping',
                ], { env: { MYSQL_HOME: this.configPath } });
                this._logger.debug('Database responded to ping.');
                return true;
            } catch (e: any) {
                const delayMs = Math.min(maxDelay, baseDelay * Math.pow(2, i));
                this._logger.info(`Database connection attempt ${i + 1} failed. Retrying in ${delayMs} ms.`);
                await delay(delayMs);
                latestError = e;
            }
        }
        this._logger.error(`Database did NOT respond to ping after ${maxTries} tries.`, { stack: latestError?.stack });
        throw latestError;
    }

    private async setupDatabase(): Promise<void> {
        this._logger.info('Creating MariaDB database...');
        try {
            await LocalMain.execFilePromise(this.bin.mysql, [
                '-e', 'CREATE DATABASE local;',
            ], { env: { MYSQL_HOME: this.configPath } });
        } catch (e: any) {
            this._logger.error('Error creating database.', { stack: e.stack });
            throw e;
        }
    }

    get configVariables(): Record<string, string | number> {
        return {
            datadir:       this.dataPath,
            port:          this.port,
            socket:        this.socket.replace('\\', '\\\\'),
            clientAddress: '127.0.0.1',
            bindAddress:   '127.0.0.1',
        };
    }

    start(): LocalMain.ProcessDescriptor[] {
        fs.ensureDirSync(this.runPath);
        return [{
            name:    'mariadb',
            binPath: this.bin.mysqld,
            args:    [`--defaults-file=${slash(path.join(this.configPath, 'my.cnf'))}`],
        }];
    }
}
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=MariadbService
```

Expected: PASS (3 suites, 6 tests)

- [ ] **Step 7: Commit**

```bash
git add src/MariadbService.ts tests/MariadbService.test.ts tests/__mocks__/local-main.ts
git commit -m "feat: MariadbService — cross-platform paths and mysql_install_db with basedir"
```

---

## Task 4: Config Template

**Files:**
- Create: `conf/my.cnf.hbs`

- [ ] **Step 1: Write the config template**

```handlebars
[mysqld]
{{#unless os.windows}}
skip-name-resolve
{{/unless}}

datadir = {{datadir}}
port = {{port}}
bind-address = {{bindAddress}}
socket = {{socket}}

{{#if os.windows}}
console
{{/if}}

# Fine Tuning
performance_schema = off
max_allowed_packet = 16M
thread_stack = 192K
thread_cache_size = 8

# InnoDB
innodb_buffer_pool_size = 32M
innodb_log_file_size = 96M

[client]
{{#unless os.windows}}
socket = {{socket}}
{{else}}
host = {{clientAddress}}
port = {{port}}
{{/unless}}
user = root
```

Note: No `password =` in the `[client]` section. `mysql_install_db --password=root` sets it at init time, so `mysqladmin ping` connects without a password on first provision. After `setupMysqlUser()` sets it to 'root', subsequent connections use the stored credentials in wp-config.php.

- [ ] **Step 2: Commit**

```bash
git add conf/my.cnf.hbs
git commit -m "feat: my.cnf.hbs config template — no client password (set via mysql_install_db)"
```

---

## Task 5: Main Entry Point

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Write main.ts**

```typescript
// src/main.ts
import { registerLightningService } from '@getflywheel/local/main';
import path from 'path';
import MariadbService from './MariadbService';
import { downloadBinaries } from './downloader';

const SERVICE_DIR = path.join(__dirname, '..');

export default async function main(): Promise<void> {
    try {
        await downloadBinaries(SERVICE_DIR);
    } catch (err: any) {
        // Log but don't crash — the service will fail gracefully if binaries
        // are missing, which is better than preventing Local from starting
        console.error('[local-addon-mariadb] Failed to download binaries:', err.message);
    }

    registerLightningService(MariadbService, 'mariadb', '10.6.23');
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: `lib/main.js`, `lib/MariadbService.js`, `lib/downloader.js` created. No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: main entry point — download binaries then register service"
```

---

## Task 6: Install Script

**Files:**
- Create: `scripts/install-addon.js`

This script copies the built addon into Local's `userDataPath/lightning-services/` for local development testing.

- [ ] **Step 1: Write install-addon.js**

```javascript
// scripts/install-addon.js
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const SERVICE_NAME = 'mariadb-10.6.23+0';
const DEST = path.join(
    os.homedir(),
    'Library/Application Support/Local/lightning-services',
    SERVICE_NAME
);

const filesToCopy = [
    'package.json',
    'lib',
    'conf',
];

async function install() {
    await fs.ensureDir(DEST);

    for (const file of filesToCopy) {
        const src = path.join(__dirname, '..', file);
        const dst = path.join(DEST, file);
        await fs.copy(src, dst, { overwrite: true });
        console.log(`Copied ${file} → ${dst}`);
    }

    // Copy node_modules for bundled deps
    const bundledDeps = ['delay', 'fs-extra', 'node-fetch', 'slash', 'tar'];
    for (const dep of bundledDeps) {
        const src = path.join(__dirname, '..', 'node_modules', dep);
        const dst = path.join(DEST, 'node_modules', dep);
        if (await fs.pathExists(src)) {
            await fs.copy(src, dst, { overwrite: true });
            console.log(`Copied node_modules/${dep}`);
        }
    }

    // Preserve existing bin/ (already-downloaded platform binaries)
    console.log(`\nInstalled to: ${DEST}`);
    console.log('Restart Local to load the addon.');
}

install().catch(err => {
    console.error('Install failed:', err.message);
    process.exit(1);
});
```

- [ ] **Step 2: Run build + install**

```bash
npm run build && npm run install-addon
```

Expected output:
```
Copied package.json → .../lightning-services/mariadb-10.6.23+0/package.json
Copied lib → .../lightning-services/mariadb-10.6.23+0/lib
Copied conf → .../lightning-services/mariadb-10.6.23+0/conf
...
Installed to: /Users/.../Library/Application Support/Local/lightning-services/mariadb-10.6.23+0
Restart Local to load the addon.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/install-addon.js
git commit -m "feat: install-addon script for local development"
```

---

## Task 7: Create GitHub Release and Publish Artifacts

Before testing end-to-end, a GitHub Release must exist for the download URLs to work.

- [ ] **Step 1: Create release v10.6.23**

```bash
gh release create v10.6.23 \
  --repo jpollock/local-addon-mariadb \
  --title "MariaDB 10.6.23" \
  --notes "Initial binary release for macOS (arm64 + Intel) and Linux." \
  --draft
```

- [ ] **Step 2: Download the CI artifacts from the latest successful build**

```bash
# Get the latest successful run ID
RUN_ID=$(gh run list --repo jpollock/local-addon-mariadb --status success --limit 1 --json databaseId -q '.[0].databaseId')

gh run download $RUN_ID --repo jpollock/local-addon-mariadb --dir /tmp/mariadb-artifacts
ls /tmp/mariadb-artifacts/
```

Expected: directories `mariadb-10.6.23-darwin-arm64/`, `mariadb-10.6.23-darwin/`, `mariadb-10.6.23-linux/`

- [ ] **Step 3: Upload artifacts to release**

```bash
cd /tmp/mariadb-artifacts

gh release upload v10.6.23 \
  mariadb-10.6.23-darwin-arm64/bin-darwin-arm64-10.6.23.tar.gz \
  mariadb-10.6.23-linux/bin-linux-10.6.23.tar.gz \
  --repo jpollock/local-addon-mariadb

# Upload darwin (Intel) when that build completes
# gh release upload v10.6.23 mariadb-10.6.23-darwin/bin-darwin-10.6.23.tar.gz --repo jpollock/local-addon-mariadb
```

- [ ] **Step 4: Publish the release**

```bash
gh release edit v10.6.23 --repo jpollock/local-addon-mariadb --draft=false
```

- [ ] **Step 5: Verify URLs are accessible**

```bash
curl -I https://github.com/jpollock/local-addon-mariadb/releases/download/v10.6.23/bin-darwin-arm64-10.6.23.tar.gz
```

Expected: `HTTP/2 302` (redirect to S3) — not 404.

---

## Task 8: End-to-End Test

- [ ] **Step 1: Run build and install**

```bash
npm run build && npm run install-addon
```

- [ ] **Step 2: Restart Local**

Quit Local completely (Cmd+Q), reopen.

- [ ] **Step 3: Create a new site with MariaDB**

In Local:
1. Click "Add Site"
2. Name: `mariadb-e2e-test`
3. Click "Custom" environment tab
4. Database dropdown → should show "MariaDB 10.6.23"
5. Select it, click Continue
6. Complete site creation

Expected: Site creates and starts successfully. No errors in Local's log about database.

- [ ] **Step 4: Verify the site works**

Open `http://mariadb-e2e-test.local/wp-admin` in browser.

Expected: WordPress admin login page loads.

- [ ] **Step 5: Verify MariaDB is running**

```bash
ls ~/Library/Application\ Support/Local/run/*/mariadb/mysqld.sock
```

Expected: socket file exists.

- [ ] **Step 6: Commit any fixes, tag**

```bash
git add -A
git commit -m "feat: v1 complete — MariaDB 10.6.23 addon for macOS and Linux"
git tag v0.1.0
git push && git push --tags
```

---

## Self-Review

**Spec coverage:**
- R1 Binary Distribution ✓ — Task 2 (downloader) + Task 7 (release)
- R2 Service Registration ✓ — Task 5 (main.ts) + Task 1 (package.json tags)
- R3 Data Dir Initialization ✓ — Task 3 (mysql_install_db with --basedir)
- R4 Site Creation ✓ — Task 8 (e2e)
- R5 Import/Export — not explicitly tested but works via existing Local flows (uses MYSQL_HOME)
- R6 MySQL → MariaDB Migration — not in v1 scope
- R7 Updates — not in v1 scope

**Gap:** No test for `downloadBinaries()` with an actual network call. This is intentional — integration tests with network calls are slow and fragile. The unit tests cover the pure logic; real download is validated in Task 8.

**Placeholder scan:** No TBDs. All code blocks complete.

**Type consistency:** `bin` accessor uses `this.bin.mysql_install_db` (singular) — matches `bins` getter key `mysql_install_db`. `getBasedir()` is public (needed by tests). `LightningServicePlatform` enum values match the string literals used in `$PATHs`.
