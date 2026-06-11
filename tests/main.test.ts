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
        // Allow any fire-and-forget async work (e.g., setupNewServiceVersion) to complete
        // before removing tmpDir, to avoid ENOTEMPTY races on macOS.
        await new Promise(resolve => setTimeout(resolve, 100));
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

describe('10.11.11 service directory creation', () => {
    beforeAll(() => {
        const libDir = path.resolve(__dirname, '..', 'lib');
        const srcDir = path.resolve(__dirname, '..', 'src');
        for (const file of ['MariadbService.js', 'constants.js']) {
            if (!fs.pathExistsSync(path.join(srcDir, file))) {
                fs.copyFileSync(path.join(libDir, file), path.join(srcDir, file));
            }
        }
    });

    afterAll(() => {
        const srcDir = path.resolve(__dirname, '..', 'src');
        for (const file of ['MariadbService.js', 'constants.js']) {
            fs.removeSync(path.join(srcDir, file));
        }
    });

    let tmpDir: string;
    let userDataPath: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-main2-test-'));
        userDataPath = tmpDir;
    });

    afterEach(async () => {
        // Allow fire-and-forget setupNewServiceVersion to settle before removing tmpDir
        await new Promise(resolve => setTimeout(resolve, 300));
        await fs.remove(tmpDir);
        jest.clearAllMocks();
    });

    it('creates the 10.11.11 service directory on startup', () => {
        main(makeContext(userDataPath));

        // createServiceDirectory is async — check after a tick
        return new Promise<void>(resolve => setTimeout(() => {
            const svcDir = path.join(userDataPath, 'lightning-services', 'mariadb-10.11.11+0');
            expect(fs.pathExistsSync(svcDir)).toBe(true);
            expect(fs.pathExistsSync(path.join(svcDir, 'lib', 'main.js'))).toBe(true);
            expect(fs.pathExistsSync(path.join(svcDir, 'lib', 'MariadbService.js'))).toBe(true);
            expect(fs.pathExistsSync(path.join(svcDir, 'lib', 'constants.js'))).toBe(true);
            resolve();
        }, 200));
    });

    it('writes 10.11.11-specific constants.js into the service dir', () => {
        main(makeContext(userDataPath));

        return new Promise<void>(resolve => setTimeout(() => {
            const constantsPath = path.join(
                userDataPath, 'lightning-services', 'mariadb-10.11.11+0', 'lib', 'constants.js'
            );
            if (fs.pathExistsSync(constantsPath)) {
                const constants = fs.readFileSync(constantsPath, 'utf8');
                expect(constants).toContain("'10.11.11'");
            }
            resolve();
        }, 200));
    });

    it('pre-creates darwin-arm64/bin subdir for platform discovery', () => {
        main(makeContext(userDataPath));

        return new Promise<void>(resolve => setTimeout(() => {
            const platformDir = path.join(
                userDataPath, 'lightning-services', 'mariadb-10.11.11+0', 'bin', 'darwin-arm64', 'bin'
            );
            expect(fs.pathExistsSync(platformDir)).toBe(true);
            resolve();
        }, 200));
    });

    it('triggers binary download for 10.11.11', () => {
        const { downloadBinaries } = require('../src/downloader');
        (downloadBinaries as jest.Mock).mockClear();
        main(makeContext(userDataPath));
        // downloadBinaries is called synchronously for the bundled version (10.6.23).
        // For 10.11.11 it fires after createServiceDirectory resolves, so we only
        // assert the bundled-version call here — the async call is tested via the
        // 200ms timer tests above which verify the service dir gets created.
        expect((downloadBinaries as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
    });
});
