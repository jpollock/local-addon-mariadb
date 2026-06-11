import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import fetch from 'node-fetch';
import tar from 'tar';
import { MARIADB_VERSION, GITHUB_REPO } from './constants';

export function getPlatform(): string | null {
    if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64';
    if (process.platform === 'darwin') return 'darwin';
    if (process.platform === 'linux') return 'linux';
    return null;
}

export function getBinaryUrl(platform: string, version: string): string {
    return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/bin-${platform}-${version}.tar.gz`;
}

export function getChecksumUrl(platform: string, version: string): string {
    return `${getBinaryUrl(platform, version)}.sha256`;
}

async function verifyChecksum(filePath: string, expectedChecksumLine: string): Promise<void> {
    // checksum file format: "<hash>  <filename>"
    const expectedHash = expectedChecksumLine.trim().split(/\s+/)[0];
    const fileBuffer = await fs.readFile(filePath);
    const actualHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (actualHash !== expectedHash) {
        throw new Error(
            `Checksum mismatch for ${path.basename(filePath)}: expected ${expectedHash}, got ${actualHash}`
        );
    }
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
    const checksumUrl = getChecksumUrl(platform, MARIADB_VERSION);
    const destDir = path.join(serviceDir, 'bin', platform);
    const tmpFile = path.join(serviceDir, `bin-${platform}.tar.gz`);

    await fs.ensureDir(destDir);

    // Download tarball
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download MariaDB binaries (${response.status}): ${url}`);
    }

    try {
        await new Promise<void>((resolve, reject) => {
            const fileStream = fs.createWriteStream(tmpFile);
            response.body!.pipe(fileStream);
            response.body!.on('error', (err) => {
                fileStream.destroy();
                reject(err);
            });
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
        });

        // Download and verify checksum
        const checksumResponse = await fetch(checksumUrl);
        if (checksumResponse.ok) {
            const checksumContent = await checksumResponse.text();
            await verifyChecksum(tmpFile, checksumContent);
        } else {
            // Checksum file not found (e.g. older releases) — warn but don't fail
            console.warn(`[local-addon-mariadb] Checksum file not available (${checksumResponse.status}), skipping verification`);
        }

        await tar.extract({ file: tmpFile, cwd: destDir });
    } finally {
        // Always clean up the temp file, even on failure
        await fs.remove(tmpFile).catch(() => {});
    }
}
