import fs from 'fs-extra';
import path from 'path';
import fetch from 'node-fetch';
import tar from 'tar';

const GITHUB_REPO = 'jpollock/local-addon-mariadb';
const MARIADB_VERSION = '10.6.23';

export function getPlatform(): string | null {
    if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
    if (process.platform === 'darwin') return 'darwin';
    if (process.platform === 'linux') return 'linux';
    return null;
}

export function getBinaryUrl(platform: string, version: string): string {
    return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/bin-${platform}-${version}.tar.gz`;
}

export async function hasBinaries(serviceDir: string, platform: string): Promise<boolean> {
    const mysqldPath = path.join(serviceDir, 'bin', platform, 'bin', 'mysqld');
    return fs.pathExists(mysqldPath);
}

export async function downloadBinaries(serviceDir: string): Promise<void> {
    const platform = getPlatform();
    if (!platform) return;

    if (await hasBinaries(serviceDir, platform)) return;

    const url = getBinaryUrl(platform, MARIADB_VERSION);
    const destDir = path.join(serviceDir, 'bin', platform);
    const tmpFile = path.join(serviceDir, `bin-${platform}.tar.gz`);

    await fs.ensureDir(destDir);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download MariaDB binaries (${response.status}): ${url}`);
    }

    await new Promise<void>((resolve, reject) => {
        const fileStream = fs.createWriteStream(tmpFile);
        response.body!.pipe(fileStream);
        response.body!.on('error', reject);
        fileStream.on('finish', resolve);
    });

    await tar.extract({ file: tmpFile, cwd: destDir });
    await fs.remove(tmpFile);
}
