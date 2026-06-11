import { getPlatform, getBinaryUrl, getChecksumUrl, hasBinaries } from '../src/downloader';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('getPlatform', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');

    afterEach(() => {
        if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
        if (originalArch) Object.defineProperty(process, 'arch', originalArch);
    });

    it('returns darwin-arm64 on Apple Silicon', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
        expect(getPlatform()).toBe('darwin-arm64');
    });

    it('returns darwin on Intel Mac', () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
        expect(getPlatform()).toBe('darwin');
    });

    it('returns linux on Linux', () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
        expect(getPlatform()).toBe('linux');
    });

    it('returns null on Windows', () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        expect(getPlatform()).toBeNull();
    });
});

describe('getBinaryUrl', () => {
    it('constructs the correct GitHub Releases URL', () => {
        const url = getBinaryUrl('darwin-arm64', '10.6.23');
        expect(url).toBe(
            'https://github.com/jpollock/local-addon-mariadb/releases/download/v10.6.23/bin-darwin-arm64-10.6.23.tar.gz'
        );
    });

    it('works for linux platform', () => {
        const url = getBinaryUrl('linux', '10.6.23');
        expect(url).toBe(
            'https://github.com/jpollock/local-addon-mariadb/releases/download/v10.6.23/bin-linux-10.6.23.tar.gz'
        );
    });
});

describe('getChecksumUrl', () => {
    it('appends .sha256 to the binary URL', () => {
        const url = getChecksumUrl('darwin-arm64', '10.6.23');
        expect(url).toBe(
            'https://github.com/jpollock/local-addon-mariadb/releases/download/v10.6.23/bin-darwin-arm64-10.6.23.tar.gz.sha256'
        );
    });
});

describe('hasBinaries', () => {
    it('returns true when mysqld exists', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-test-'));
        const binDir = path.join(tmpDir, 'bin', 'darwin-arm64', 'bin');
        await fs.ensureDir(binDir);
        await fs.writeFile(path.join(binDir, 'mysqld'), '');
        expect(await hasBinaries(tmpDir, 'darwin-arm64')).toBe(true);
        await fs.remove(tmpDir);
    });

    it('returns false when mysqld is missing', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-test-'));
        expect(await hasBinaries(tmpDir, 'darwin-arm64')).toBe(false);
        await fs.remove(tmpDir);
    });
});

describe('downloadBinaries with explicit version', () => {
    it('uses the correct URL for 10.11.11', () => {
        const url = getBinaryUrl('darwin-arm64', '10.11.11');
        expect(url).toContain('/v10.11.11/');
        expect(url).toContain('bin-darwin-arm64-10.11.11.tar.gz');
    });

    it('hasBinaries returns false when darwin-arm64 dir exists but mysqld missing', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mariadb-v2-'));
        await fs.ensureDir(path.join(tmpDir, 'bin', 'darwin-arm64', 'bin'));
        expect(await hasBinaries(tmpDir, 'darwin-arm64')).toBe(false);
        await fs.remove(tmpDir);
    });
});
