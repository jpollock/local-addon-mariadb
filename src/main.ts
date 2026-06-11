import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { downloadBinaries } from './downloader';
import { MARIADB_VERSION, SUPPORTED_VERSIONS } from './constants';
import { createServiceDirectory } from './serviceTemplate';

const SERVICE_DIR = path.join(__dirname, '..');
const ADDON_LIB_DIR = __dirname;                      // compiled lib/ files live here
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

/** For non-bundled versions: create the full service directory, then download binaries. */
async function setupNewServiceVersion(userDataPath: string, version: string): Promise<void> {
    const serviceName = `mariadb-${version}+0`;
    const serviceDir = path.join(userDataPath, 'lightning-services', serviceName);

    try {
        await createServiceDirectory(serviceDir, version, ADDON_LIB_DIR, ADDON_CONF_DIR);
        console.log(`[local-addon-mariadb] Ensured service directory for ${serviceName}`);
    } catch (err: any) {
        console.error(`[local-addon-mariadb] Failed to create service dir for ${serviceName}:`, err.message);
        return;
    }

    downloadBinaries(serviceDir, version).catch((err: Error) => {
        console.error(`[local-addon-mariadb] Failed to download binaries for ${version}:`, err.message);
    });
}

export default function main(context: any): void {
    const userDataPath: string =
        context?.environment?.userDataPath || getDefaultUserDataPath();

    console.log(`[local-addon-mariadb] userDataPath: ${userDataPath}`);

    for (const { version, bundled } of SUPPORTED_VERSIONS) {
        if (bundled) {
            patchBundledService(userDataPath);
        } else {
            // Fire-and-forget — errors caught inside setupNewServiceVersion
            setupNewServiceVersion(userDataPath, version);
        }
    }

    // Download binaries for the bundled version into the addon dir (via symlink)
    downloadBinaries(SERVICE_DIR, MARIADB_VERSION).catch((err: Error) => {
        console.error('[local-addon-mariadb] Failed to download binaries:', err.message);
    });
}
