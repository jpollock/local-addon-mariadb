import path from 'path';
import fs from 'fs-extra';
import { GITHUB_REPO } from './constants';

/** Generated main.js for a non-bundled lightning service.
 *  Reads MARIADB_VERSION from ./constants so one file works for any version. */
export function generateMainJs(): string {
    return `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const main_1 = require('@getflywheel/local/main');
const MariadbService_1 = require('./MariadbService');
const { MARIADB_VERSION } = require('./constants');
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

/** Generated package.json — required for Local's AddonLoaderService to load the service.
 *
 *  IMPORTANT: `name` must be unique per version. Both this service and the bundled
 *  mariadb-10.6.23+0 use `"name": "mariadb"` which causes Local's isAddonLoaded()
 *  dedup to skip whichever loads second (same package name = treated as competing
 *  versions of the same addon). Using "mariadb-{version}" as package name gives each
 *  a distinct identity so both load. The service name passed to registerLightningService
 *  is still 'mariadb' (set in lib/main.js), which is what the dropdown reads.
 */
export function generatePackageJson(version: string): Record<string, unknown> {
    return {
        name: `mariadb-${version}`,
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
 * Idempotent — safe to call on every addon startup.
 *
 * Layout:
 *   serviceDir/
 *   ├── package.json          (generated — version-specific)
 *   ├── lib/
 *   │   ├── main.js           (generated — reads version from constants at runtime)
 *   │   ├── MariadbService.js (copied from addon lib/)
 *   │   └── constants.js      (generated — pins MARIADB_VERSION for this dir)
 *   ├── conf/
 *   │   └── my.cnf.hbs        (copied from addon conf/)
 *   └── bin/
 *       ├── darwin-arm64/bin/ (pre-created so getPlatformFromService can scan)
 *       ├── darwin/bin/
 *       └── linux/bin/
 */
export async function createServiceDirectory(
    serviceDir: string,
    version: string,
    addonLibDir: string,
    addonConfDir: string,
): Promise<void> {
    await fs.ensureDir(path.join(serviceDir, 'lib'));
    await fs.ensureDir(path.join(serviceDir, 'conf'));

    await fs.writeJson(
        path.join(serviceDir, 'package.json'),
        generatePackageJson(version),
        { spaces: 4 },
    );

    await fs.writeFile(path.join(serviceDir, 'lib', 'main.js'), generateMainJs());
    await fs.writeFile(path.join(serviceDir, 'lib', 'constants.js'), generateConstantsJs(version));

    await fs.copy(
        path.join(addonLibDir, 'MariadbService.js'),
        path.join(serviceDir, 'lib', 'MariadbService.js'),
        { overwrite: true },
    );

    await fs.copy(
        path.join(addonConfDir, 'my.cnf.hbs'),
        path.join(serviceDir, 'conf', 'my.cnf.hbs'),
        { overwrite: true },
    );

    // Pre-create bin platform subdirs so getPlatformFromService() can scan them
    // and include this service in the dropdown before download completes.
    for (const platform of ['darwin-arm64', 'darwin', 'linux']) {
        await fs.ensureDir(path.join(serviceDir, 'bin', platform, 'bin'));
    }
}

/**
 * Synchronous version of createServiceDirectory.
 *
 * MUST be used from the addon's main() function. Local's loadAddonsInRepos()
 * scans lightning-services/ synchronously immediately after addons/ are loaded.
 * If we create the service directory asynchronously, it won't exist yet when
 * Local scans for it, so the version never appears in the database dropdown.
 */
export function createServiceDirectorySync(
    serviceDir: string,
    version: string,
    addonLibDir: string,
    addonConfDir: string,
): void {
    fs.ensureDirSync(path.join(serviceDir, 'lib'));
    fs.ensureDirSync(path.join(serviceDir, 'conf'));

    fs.writeJsonSync(
        path.join(serviceDir, 'package.json'),
        generatePackageJson(version),
        { spaces: 4 },
    );

    fs.writeFileSync(path.join(serviceDir, 'lib', 'main.js'), generateMainJs());
    fs.writeFileSync(path.join(serviceDir, 'lib', 'constants.js'), generateConstantsJs(version));

    fs.copySync(
        path.join(addonLibDir, 'MariadbService.js'),
        path.join(serviceDir, 'lib', 'MariadbService.js'),
        { overwrite: true },
    );

    fs.copySync(
        path.join(addonConfDir, 'my.cnf.hbs'),
        path.join(serviceDir, 'conf', 'my.cnf.hbs'),
        { overwrite: true },
    );

    for (const platform of ['darwin-arm64', 'darwin', 'linux']) {
        fs.ensureDirSync(path.join(serviceDir, 'bin', platform, 'bin'));
    }
}
