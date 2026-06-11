import path from 'path';
import fs from 'fs-extra';
import { LightningServicePlatform, execFilePromise } from '@getflywheel/local/main';
import MariadbService from '../src/MariadbService';

// Mock delay so waitForDB retry loops don't actually sleep during tests
jest.mock('delay', () => jest.fn().mockResolvedValue(undefined));

describe('MariadbService.$PATHs', () => {
    it('has darwin-arm64 path containing bin/darwin-arm64/bin', () => {
        const svc = new MariadbService();
        const p = svc.$PATHs[LightningServicePlatform.DarwinArm64];
        expect(p).toContain(path.join('bin', 'darwin-arm64', 'bin'));
    });

    it('has darwin path containing bin/darwin/bin', () => {
        const svc = new MariadbService();
        const p = svc.$PATHs[LightningServicePlatform.Darwin];
        expect(p).toContain(path.join('bin', 'darwin', 'bin'));
    });

    it('has linux path containing bin/linux/bin', () => {
        const svc = new MariadbService();
        const p = svc.$PATHs[LightningServicePlatform.Linux];
        expect(p).toContain(path.join('bin', 'linux', 'bin'));
    });

    it('has win32 path containing bin/win32/bin', () => {
        const svc = new MariadbService();
        const p = svc.$PATHs[LightningServicePlatform.Win32];
        expect(p).toContain(path.join('bin', 'win32', 'bin'));
    });
});

describe('MariadbService.bins', () => {
    it('includes mysql_install_db for darwin-arm64 without .exe', () => {
        const svc = new MariadbService();
        const bins = svc.bins[LightningServicePlatform.DarwinArm64];
        expect(bins.mysql_install_db).toBeDefined();
        expect(bins.mysql_install_db).not.toContain('.exe');
    });

    it('includes mysql_install_db.exe for win32', () => {
        const svc = new MariadbService();
        const bins = svc.bins[LightningServicePlatform.Win32];
        expect(bins.mysql_install_db).toContain('.exe');
        expect(bins.mysqld).toContain('.exe');
    });

    it('all unix platforms have the same binary names without .exe', () => {
        const svc = new MariadbService();
        for (const platform of [LightningServicePlatform.Darwin, LightningServicePlatform.DarwinArm64, LightningServicePlatform.Linux]) {
            const bins = svc.bins[platform];
            expect(bins.mysqld).not.toContain('.exe');
            expect(bins.mysql).not.toContain('.exe');
            expect(bins.mysqladmin).not.toContain('.exe');
        }
    });
});

describe('MariadbService.getBasedir', () => {
    it('returns platform parent dir (parent of bin/ not bin/bin/)', () => {
        const svc = new MariadbService();
        const basedir = svc.getBasedir('darwin-arm64');
        expect(basedir).toContain(path.join('bin', 'darwin-arm64'));
        // should NOT end with an extra /bin
        expect(path.basename(basedir)).toBe('darwin-arm64');
    });
});

describe('MariadbService properties', () => {
    it('has serviceName = mariadb', () => {
        const svc = new MariadbService();
        expect(svc.serviceName).toBe('mariadb');
    });

    it('has binVersion = 10.6.23', () => {
        const svc = new MariadbService();
        expect(svc.binVersion).toBe('10.6.23');
    });

    it('requiredPorts has MYSQL key', () => {
        const svc = new MariadbService();
        expect(svc.requiredPorts).toHaveProperty('MYSQL');
    });
});

describe('MariadbService.configVariables vs my.cnf.hbs template', () => {
    it('configVariables contains all keys referenced in my.cnf.hbs', () => {
        const svc = new MariadbService();
        const templatePath = path.join(__dirname, '../conf/my.cnf.hbs');
        const template = fs.readFileSync(templatePath, 'utf8');

        // Extract {{variableName}} placeholders, excluding block helpers like {{#if}}, {{/if}}, {{#unless}}, {{else}}
        const placeholders = [...template.matchAll(/\{\{([^#/^][^}]+)\}\}/g)]
            .map(m => m[1].trim())
            .filter(k => k !== 'else');

        const configVars = svc.configVariables;
        for (const placeholder of placeholders) {
            expect(configVars).toHaveProperty(placeholder);
        }
    });
});

describe('MariadbService.start()', () => {
    it('returns a process descriptor for mariadb', () => {
        const svc = new MariadbService();
        const descriptors = svc.start();
        expect(descriptors).toHaveLength(1);
        expect(descriptors[0].name).toBe('mariadb');
        expect(descriptors[0].binPath).toContain('mysqld');
        expect(descriptors[0].args[0]).toMatch(/--defaults-file=/);
    });
});

describe('MariadbService.waitForDB()', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('resolves true when mysqladmin ping succeeds', async () => {
        (execFilePromise as jest.Mock).mockResolvedValueOnce(undefined);
        const svc = new MariadbService();
        const result = await svc['waitForDB']();
        expect(result).toBe(true);
        expect(execFilePromise).toHaveBeenCalledTimes(1);
    });

    it('retries up to 5 times before throwing', async () => {
        const error = new Error('connection refused');
        (execFilePromise as jest.Mock).mockRejectedValue(error);
        const svc = new MariadbService();
        await expect(svc['waitForDB']()).rejects.toThrow('connection refused');
        expect(execFilePromise).toHaveBeenCalledTimes(5);
    });

    it('passes --password= flag when noPassword is true', async () => {
        (execFilePromise as jest.Mock).mockResolvedValueOnce(undefined);
        const svc = new MariadbService();
        await svc['waitForDB'](true);
        expect(execFilePromise).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining(['--password=']),
            expect.anything()
        );
    });

    it('omits --password= flag when noPassword is false', async () => {
        (execFilePromise as jest.Mock).mockResolvedValueOnce(undefined);
        const svc = new MariadbService();
        await svc['waitForDB'](false);
        const [, args] = (execFilePromise as jest.Mock).mock.calls[0];
        expect(args).not.toContain('--password=');
    });
});

describe('MariadbService.setupDatabase()', () => {
    beforeEach(() => jest.clearAllMocks());

    it('throws when CREATE DATABASE mysql command fails', async () => {
        const dbError = new Error('DB error');
        (execFilePromise as jest.Mock).mockRejectedValueOnce(dbError);
        const svc = new MariadbService();
        await expect(svc['setupDatabase']()).rejects.toThrow('DB error');
    });

    it('resolves when CREATE DATABASE succeeds', async () => {
        (execFilePromise as jest.Mock).mockResolvedValueOnce(undefined);
        const svc = new MariadbService();
        await expect(svc['setupDatabase']()).resolves.toBeUndefined();
    });
});
