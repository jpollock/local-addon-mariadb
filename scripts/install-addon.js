// Copies the built addon into Local's lightning-services dir for local development
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const SERVICE_NAME = 'mariadb-10.6.23+0';
const DEST = path.join(
    os.homedir(),
    'Library/Application Support/Local/lightning-services',
    SERVICE_NAME
);

const filesToCopy = ['package.json', 'lib', 'conf'];
const bundledDeps = ['delay', 'fs-extra', 'node-fetch', 'slash', 'tar'];

async function install() {
    await fs.ensureDir(DEST);

    for (const file of filesToCopy) {
        const src = path.join(__dirname, '..', file);
        const dst = path.join(DEST, file);
        if (await fs.pathExists(src)) {
            await fs.copy(src, dst, { overwrite: true });
            console.log(`Copied ${file}`);
        } else {
            console.warn(`Skipping ${file} (not found — run npm run build first?)`);
        }
    }

    for (const dep of bundledDeps) {
        const src = path.join(__dirname, '..', 'node_modules', dep);
        const dst = path.join(DEST, 'node_modules', dep);
        if (await fs.pathExists(src)) {
            await fs.copy(src, dst, { overwrite: true });
            console.log(`Copied node_modules/${dep}`);
        }
    }

    console.log(`\n✓ Installed to: ${DEST}`);
    console.log('Restart Local to load the addon.');
}

install().catch(err => {
    console.error('Install failed:', err.message);
    process.exit(1);
});
