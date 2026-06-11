export enum LightningServicePlatform {
    Darwin = 'darwin',
    DarwinArm64 = 'darwin-arm64',
    Linux = 'linux',
    Win32 = 'win32',
    Win32x64 = 'win64',
}

export class LightningService {
    _logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    runPath = '/tmp/run/site123/mariadb';
    configPath = '/tmp/run/site123/conf/mariadb';
    port = 10053;
    bin: Record<string, string> = {};
}

export const execFilePromise = jest.fn();
export const registerLightningService = jest.fn();
