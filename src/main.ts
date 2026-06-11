import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { downloadBinaries } from './downloader';

const SERVICE_DIR = path.join(__dirname, '..');

// The bundled lightning-services/mariadb-10.6.23+0 loads AFTER this addon and
// overwrites any registerLightningService call we make. Instead, we patch its
// MariadbService.js with our cross-platform version before it gets loaded.
// The lightning service then registers our version.
const LIGHTNING_SERVICE_DIR = path.join(
    os.homedir(),
    'Library/Application Support/Local/lightning-services/mariadb-10.6.23+0'
);

function patchBundledService(): void {
    try {
        if (!fs.pathExistsSync(LIGHTNING_SERVICE_DIR)) return;

        // 1. Replace MariadbService.js with cross-platform version
        fs.copySync(
            path.join(__dirname, 'MariadbService.js'),
            path.join(LIGHTNING_SERVICE_DIR, 'lib', 'MariadbService.js'),
            { overwrite: true }
        );

        // 2. Symlink lightning-services/mariadb-10.6.23+0/bin → addon's bin/
        //    getPlatformFromService() scans this dir to detect available platforms.
        //    Our patched MariadbService.$PATHs uses __dirname relative paths which
        //    resolve to lightning-services/.../bin/{platform}/bin when loaded from there.
        const lightningBinDir = path.join(LIGHTNING_SERVICE_DIR, 'bin');
        const addonBinDir = SERVICE_DIR + '/bin';

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

export default function main(_context: any): void {
    // Patch the bundled lightning service's MariadbService.js with our cross-platform
    // version before AddonLoaderService loads it. Order guaranteed: addons/ loads first.
    patchBundledService();

    // Download platform binaries in the background
    downloadBinaries(SERVICE_DIR).catch((err: Error) => {
        console.error('[local-addon-mariadb] Failed to download binaries:', err.message);
    });
}
