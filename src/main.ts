import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { downloadBinaries } from './downloader';
import { MARIADB_VERSION } from './constants';

const SERVICE_DIR = path.join(__dirname, '..');
const SERVICE_NAME = `mariadb-${MARIADB_VERSION}+0`;

function patchBundledService(userDataPath: string): void {
    const lightningServiceDir = path.join(
        userDataPath, 'lightning-services', SERVICE_NAME
    );

    try {
        if (!fs.pathExistsSync(lightningServiceDir)) return;

        // Replace MariadbService.js with cross-platform version.
        // Also copy constants.js — MariadbService.js imports MARIADB_VERSION from it.
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

        // Symlink lightning-services/mariadb-{ver}/bin → addon's bin/
        // getPlatformFromService() scans this dir to detect available platforms.
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

        console.log('[local-addon-mariadb] Patched bundled service and linked bin/');
    } catch (err: any) {
        console.error('[local-addon-mariadb] Failed to patch bundled service:', err.message);
    }
}

function getDefaultUserDataPath(): string {
    if (process.platform === 'linux') {
        return path.join(os.homedir(), '.config', 'Local');
    }
    return path.join(os.homedir(), 'Library', 'Application Support', 'Local');
}

export default function main(context: any): void {
    // Prefer userDataPath from context (cross-platform), fall back to OS default
    const userDataPath: string =
        context?.environment?.userDataPath || getDefaultUserDataPath();

    console.log(`[local-addon-mariadb] userDataPath: ${userDataPath}`);
    patchBundledService(userDataPath);

    downloadBinaries(SERVICE_DIR).catch((err: Error) => {
        console.error('[local-addon-mariadb] Failed to download binaries:', err.message);
    });
}
