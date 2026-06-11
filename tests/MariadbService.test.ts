import path from 'path';
import { LightningServicePlatform } from '@getflywheel/local/main';
import MariadbService from '../src/MariadbService';

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
