import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import {
    generateMainJs,
    generateConstantsJs,
    generatePackageJson,
    createServiceDirectory,
} from '../src/serviceTemplate';

describe('generateMainJs', () => {
    it('exports a default function that calls registerLightningService', () => {
        const code = generateMainJs();
        expect(code).toContain('registerLightningService');
        expect(code).toContain("require('./MariadbService')");
        expect(code).toContain("require('./constants')");
        expect(code).toContain('MARIADB_VERSION');
        expect(code).toContain('exports.default');
    });
});

describe('generateConstantsJs', () => {
    it('exports the given version as MARIADB_VERSION', () => {
        const code = generateConstantsJs('10.11.11');
        expect(code).toContain("exports.MARIADB_VERSION = '10.11.11'");
        expect(code).toContain('exports.GITHUB_REPO');
    });

    it('produces different output for different versions', () => {
        const a = generateConstantsJs('10.6.23');
        const b = generateConstantsJs('10.11.11');
        expect(a).not.toBe(b);
    });
});

describe('generatePackageJson', () => {
    it('contains the correct version and lightning service tags', () => {
        const pkg = generatePackageJson('10.11.11');
        expect(pkg.version).toBe('10.11.11+0');
        expect(pkg.name).toBe('mariadb');
        expect(pkg.tags).toContain('local-lightning-service');
        expect(pkg.main).toBe('lib/main.js');
    });
});

describe('createServiceDirectory', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-svc-'));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    it('creates the expected directory structure', async () => {
        const addonLibDir = path.resolve(__dirname, '..', 'lib');
        const addonConfDir = path.resolve(__dirname, '..', 'conf');
        await createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir);

        expect(await fs.pathExists(path.join(tmpDir, 'package.json'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'lib', 'main.js'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'lib', 'MariadbService.js'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'lib', 'constants.js'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'conf', 'my.cnf.hbs'))).toBe(true);
    });

    it('writes version-specific constants.js', async () => {
        const addonLibDir = path.resolve(__dirname, '..', 'lib');
        const addonConfDir = path.resolve(__dirname, '..', 'conf');
        await createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir);

        const constants = await fs.readFile(path.join(tmpDir, 'lib', 'constants.js'), 'utf8');
        expect(constants).toContain("'10.11.11'");
        expect(constants).not.toContain('10.6.23');
    });

    it('pre-creates darwin-arm64 and linux bin subdirs for platform discovery', async () => {
        const addonLibDir = path.resolve(__dirname, '..', 'lib');
        const addonConfDir = path.resolve(__dirname, '..', 'conf');
        await createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir);

        expect(await fs.pathExists(path.join(tmpDir, 'bin', 'darwin-arm64', 'bin'))).toBe(true);
        expect(await fs.pathExists(path.join(tmpDir, 'bin', 'linux', 'bin'))).toBe(true);
    });

    it('is idempotent — running twice does not throw', async () => {
        const addonLibDir = path.resolve(__dirname, '..', 'lib');
        const addonConfDir = path.resolve(__dirname, '..', 'conf');
        await createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir);
        await expect(createServiceDirectory(tmpDir, '10.11.11', addonLibDir, addonConfDir))
            .resolves.not.toThrow();
    });
});
