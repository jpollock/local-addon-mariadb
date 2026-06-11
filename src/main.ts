import { registerLightningService } from '@getflywheel/local/main';
import path from 'path';
import MariadbService from './MariadbService';
import { downloadBinaries } from './downloader';

const SERVICE_DIR = path.join(__dirname, '..');

// Local calls `new AddonClass(context)` — export a constructor function, not async
export default function main(_context: any): void {
    // Register the service immediately so it appears in the database selector
    registerLightningService(MariadbService, 'mariadb', '10.6.23');

    // Download binaries in the background — non-blocking
    // If binaries aren't ready when a site is created, preprovision() will fail gracefully
    downloadBinaries(SERVICE_DIR).catch((err: Error) => {
        console.error('[local-addon-mariadb] Failed to download binaries:', err.message);
    });
}
