// Creates a symlink from Local's addons dir to this repo.
// After running this once, `npm run build` is all you need — no re-install.
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const ADDON_NAME = 'local-addon-mariadb';
const ADDONS_DIR = path.join(os.homedir(), 'Library/Application Support/Local/addons');
const LINK = path.join(ADDONS_DIR, ADDON_NAME);
const TARGET = path.resolve(__dirname, '..');

async function install() {
    await fs.ensureDir(ADDONS_DIR);

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
    console.log('The addon will install the MariaDB lightning service on first load.');
}

install().catch(err => {
    console.error('Install failed:', err.message);
    process.exit(1);
});
