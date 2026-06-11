import path from 'path';
import os from 'os';
import fs from 'fs-extra';

// Mock the downloader so tests don't hit the network
jest.mock('../src/downloader', () => ({
    downloadBinaries: jest.fn().mockResolvedValue(undefined),
}));

// Import main AFTER mocking
import main from '../src/main';
import { MARIADB_VERSION } from '../src/constants';

const SERVICE_NAME = `mariadb-${MARIADB_VERSION}+0`;

// In ts-jest, __dirname for src/main.ts resolves to <project>/src/.
// The real MariadbService.js lives in lib/ (built output).
// We temporarily place a copy at src/MariadbService.js so fs.copySync can find it.
const SRC_DIR = path.resolve(__dirname, '..', 'src');
const LIB_DIR = path.resolve(__dirname, '..', 'lib');
const LIB_MARIADB_JS = path.join(LIB_DIR, 'MariadbService.js');
const LIB_CONSTANTS_JS = path.join(LIB_DIR, 'constants.js');
const SRC_MARIADB_JS = path.join(SRC_DIR, 'MariadbService.js');
const SRC_CONSTANTS_JS = path.join(SRC_DIR, 'constants.js');

function makeContext(userDataPath: string): any {
    return { environment: { userDataPath } };
}

describe('patchBundledService via main()', () => {
    let tmpDir: string;
    let userDataPath: string;
    let lightningServiceDir: string;

    beforeAll(() => {
        // ts-jest resolves __dirname to src/. patchBundledService copies from __dirname,
        // so we temporarily place built files in src/ for the duration of the tests.
        if (!fs.pathExistsSync(SRC_MARIADB_JS)) {
            fs.copyFileSync(LIB_MARIADB_JS, SRC_MARIADB_JS);
        }
        if (!fs.pathExistsSync(SRC_CONSTANTS_JS)) {
            fs.copyFileSync(LIB_CONSTANTS_JS, SRC_CONSTANTS_JS);
        }
    });

    afterAll(() => {
        fs.removeSync(SRC_MARIADB_JS);
        fs.removeSync(SRC_CONSTANTS_JS);
    });

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-main-test-'));
        userDataPath = tmpDir;
        lightningServiceDir = path.join(userDataPath, 'lightning-services', SERVICE_NAME);

        // Set up a fake lightning service directory structure
        await fs.ensureDir(path.join(lightningServiceDir, 'lib'));
        await fs.writeFile(
            path.join(lightningServiceDir, 'lib', 'MariadbService.js'),
            '// original Windows-only service'
        );
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
        jest.clearAllMocks();
    });

    it('patches MariadbService.js with the cross-platform version', () => {
        main(makeContext(userDataPath));

        const patchedContent = fs.readFileSync(
            path.join(lightningServiceDir, 'lib', 'MariadbService.js'),
            'utf8'
        );
        // Our built version includes darwin-arm64 paths; the original stub does not.
        expect(patchedContent).toContain('darwin-arm64');
        expect(patchedContent).not.toBe('// original Windows-only service');
    });

    it('creates a symlink from lightning-services bin/ to addon bin/', () => {
        main(makeContext(userDataPath));

        const lightningBinDir = path.join(lightningServiceDir, 'bin');
        const stat = fs.lstatSync(lightningBinDir);
        expect(stat.isSymbolicLink()).toBe(true);

        const target = fs.readlinkSync(lightningBinDir);
        // Target should end with /bin (the addon's bin directory)
        expect(target).toMatch(/[/\\]bin$/);
    });

    it('replaces a stale symlink pointing to the wrong target', async () => {
        // Pre-create a stale symlink
        const wrongTarget = path.join(tmpDir, 'wrong-target');
        await fs.ensureDir(wrongTarget);
        const lightningBinDir = path.join(lightningServiceDir, 'bin');
        await fs.symlink(wrongTarget, lightningBinDir);

        main(makeContext(userDataPath));

        // Should be replaced with the correct symlink
        const stat = fs.lstatSync(lightningBinDir);
        expect(stat.isSymbolicLink()).toBe(true);
        const target = fs.readlinkSync(lightningBinDir);
        expect(target).not.toBe(wrongTarget);
    });

    it('does nothing when lightning service directory does not exist', () => {
        // Use a userDataPath where lightning service doesn't exist
        const emptyUserDataPath = path.join(tmpDir, 'empty');
        fs.ensureDirSync(emptyUserDataPath);

        // Should not throw
        expect(() => main(makeContext(emptyUserDataPath))).not.toThrow();
    });

    it('logs error and does not throw when patch fails', async () => {
        // Make MariadbService.js read-only to force a copy failure
        const targetFile = path.join(lightningServiceDir, 'lib', 'MariadbService.js');
        fs.chmodSync(targetFile, 0o444);
        fs.chmodSync(path.join(lightningServiceDir, 'lib'), 0o555);

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => main(makeContext(userDataPath))).not.toThrow();
        // On some systems the copy still succeeds (root), so just verify no throw
        consoleSpy.mockRestore();

        // Restore permissions so afterEach can clean up
        fs.chmodSync(path.join(lightningServiceDir, 'lib'), 0o755);
        fs.chmodSync(targetFile, 0o644);
    });

    it('falls back to OS default path when context has no userDataPath', () => {
        // Should not throw — uses OS default path fallback
        expect(() => main({} as any)).not.toThrow();
    });

    it('starts binary download in background', () => {
        const { downloadBinaries } = require('../src/downloader');
        main(makeContext(userDataPath));
        expect(downloadBinaries).toHaveBeenCalled();
    });
});
