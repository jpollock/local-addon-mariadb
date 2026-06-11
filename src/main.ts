import { registerLightningService } from '@getflywheel/local/main';
import path from 'path';
import MariadbService from './MariadbService';
import { downloadBinaries } from './downloader';

const SERVICE_DIR = path.join(__dirname, '..');

export default async function main(): Promise<void> {
    try {
        await downloadBinaries(SERVICE_DIR);
    } catch (err: any) {
        // Log but don't crash — service will fail gracefully if binaries are missing
        // rather than preventing Local from starting entirely
        console.error('[local-addon-mariadb] Failed to download binaries:', err.message);
    }

    registerLightningService(MariadbService, 'mariadb', '10.6.23');
}
