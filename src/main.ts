import path from 'path';
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

        // Replace MariadbService.js with cross-platform version
        fs.copySync(
            path.join(__dirname, 'MariadbService.js'),
            path.join(lightningServiceDir, 'lib', 'MariadbService.js'),
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

export default function main(context: any): void {
    const userDataPath: string = context?.environment?.userDataPath ?? '';
    if (!userDataPath) {
        console.error('[local-addon-mariadb] No userDataPath in context — cannot patch bundled service');
        return;
    }

    patchBundledService(userDataPath);

    downloadBinaries(SERVICE_DIR).catch((err: Error) => {
        console.error('[local-addon-mariadb] Failed to download binaries:', err.message);
    });
}
