// Creates a symlink from Local's lightning-services dir to this repo.
// After running this once, `npm run build` is all you need — no re-install.
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const SERVICE_NAME = 'mariadb-10.6.23+0';
const SERVICES_DIR = path.join(os.homedir(), 'Library/Application Support/Local/lightning-services');
const LINK = path.join(SERVICES_DIR, SERVICE_NAME);
const TARGET = path.resolve(__dirname, '..');

async function install() {
    await fs.ensureDir(SERVICES_DIR);

    // Remove existing copy or stale symlink
    if (await fs.pathExists(LINK)) {
        const stat = await fs.lstat(LINK);
        if (stat.isSymbolicLink()) {
            await fs.remove(LINK);
            console.log('Removed stale symlink.');
        } else {
            await fs.remove(LINK);
            console.log('Removed previous copy.');
        }
    }

    await fs.symlink(TARGET, LINK);
    console.log(`✓ Symlinked: ${LINK}`);
    console.log(`  → ${TARGET}`);
    console.log('\nRun `npm run build` to compile, then restart Local to load the addon.');
}

install().catch(err => {
    console.error('Install failed:', err.message);
    process.exit(1);
});
