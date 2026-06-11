import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { downloadBinaries } from './downloader';

const SERVICE_DIR = path.join(__dirname, '..');

// The bundled lightning-services/mariadb-10.6.23+0 loads AFTER this addon and
// overwrites any registerLightningService call we make. Instead, we patch its
// MariadbService.js with our cross-platform version before it gets loaded.
// The lightning service then registers our version.
function patchBundledService(): void {
    const ourService = path.join(__dirname, 'MariadbService.js');
    const lightningServiceLib = path.join(
        os.homedir(),
        'Library/Application Support/Local/lightning-services/mariadb-10.6.23+0/lib'
    );
    const target = path.join(lightningServiceLib, 'MariadbService.js');

    try {
        if (fs.pathExistsSync(lightningServiceLib)) {
            fs.copySync(ourService, target, { overwrite: true });
            console.log('[local-addon-mariadb] Patched bundled MariadbService.js with cross-platform version');
        }
    } catch (err: any) {
        console.error('[local-addon-mariadb] Failed to patch MariadbService:', err.message);
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
